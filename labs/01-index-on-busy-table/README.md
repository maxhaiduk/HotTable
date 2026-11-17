# Лаба 1. Індекс на великій таблиці під навантаженням

У `orders` 20 млн рядків (2,2 ГБ), щосекунди ~200 записів і ~200 читань. Новому ендпоінту потрібні
останні замовлення клієнта:

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT id, status, amount, created_at FROM orders
WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;
```

Зараз це `Seq Scan` по всій таблиці, ~1,5 с на виклик. Додай індекс і не зупини сервіс.

**Критерій успіху** (крок 3):
- перевірка зелена: валідний індекс на primary і репліці, запит іде через нього без окремого
  сортування, невалідних індексів немає;
- за весь прогін навантаження `write err = 0` і `write max < 10s`. Наївно виходить ~30 с; чому не
  нуль, побачиш на кроці 2.

Запусти навантаження і запам'ятай базову лінію: write p99, lookup, відставання репліки.

## Крок 1. Наївно

```sql
\timing on
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at);
```

Поки йде побудова (~30 с):

1. Що із записами? А з читаннями?
2. Який lock тримає твоя сесія на `orders`, і який чекають writers? Чому SELECT не чекає?
3. Скільки стояли записи? Що це означало б на проді?
4. Як змінились lookup і план `EXPLAIN`?

<details><summary>Розбір</summary>

`CREATE INDEX` тримає на таблиці `ShareLock` усю побудову. Він конфліктує з `RowExclusiveLock`
(INSERT/UPDATE/DELETE), але не з `AccessShareLock` (SELECT): читання йдуть, записи стоять.

У моєму прогоні побудова тривала 28 с, і всі 28 с не пройшов жоден запис. Lookup прискорився з
1,3 с до 1 мс. На проді за цей час пул з'єднань забивається запитами, що чекають, а на більшій
таблиці пауза триває хвилини чи години.
</details>

Прибери індекс:

```sql
DROP INDEX orders_customer_created_idx;
```

Який lock бере `DROP INDEX`, і чим це небезпечно на проді?

<details><summary>Розбір</summary>

`AccessExclusiveLock`, що конфліктує з усім, навіть із SELECT. Сам drop миттєвий, але якщо таблицю
тримає довга транзакція, він стане в чергу, а за ним усі нові запити (лаба 2). Безпечний варіант:
`DROP INDEX CONCURRENTLY`.
</details>

## Крок 2. Не блокуючи записи

Побудуй той самий індекс, не зупиняючи записи:
[CREATE INDEX → Building Indexes Concurrently](https://www.postgresql.org/docs/17/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).

1. Який lock тепер на `orders`, і чому він не заважає writers?
2. Які фази проходить побудова? Чому вона довша, ніж на кроці 1?
3. Що показують `indisvalid` і `indisready` нового індексу під час побудови?
4. Записи не стоять, але `write p99` росте. Чому? Подивись, на що чекають writers.
5. Що з відставанням репліки?

<details><summary>Розбір</summary>

`CREATE INDEX CONCURRENTLY` (далі CIC) бере `ShareUpdateExclusiveLock`, який конфліктує з іншим DDL
і VACUUM, але не із записами. Ціна:

- **два проходи:** побудова за snapshot (`building index`), потім validation дописує рядки,
  змінені за цей час (`index validation`);
- **очікування між фазами** (`waiting for …`) на транзакції, які могли не бачити новий індекс;
- **індекс існує вже під час побудови** з `indisvalid = f`. Після першого проходу
  `indisready = t`: записи його оновлюють, але запити ще не використовують.

**p99 записів.** Побудова пише у WAL ~600 МБ, а commit кожного запису чекає, поки WAL дійде до
диска. У моєму прогоні writers чекали на `IO:WalSync` і `LWLock:WALWrite`, а не на блокування.
Найдовша пауза запису була 1,5 с проти 28 с на кроці 1. Регулятора швидкості, як у gh-ost, у
PostgreSQL немає, тому CIC запускають у тихий час і стежать за latency.

**Репліка** не будує індекс, а програє WAL: відставання до 20 МБ і менше секунди. У MySQL
`ALTER TABLE` виконується на репліці заново після primary, і вона відстає на весь час побудови.
</details>

```sql
DROP INDEX CONCURRENTLY orders_customer_created_idx;
```

### 2.1. Пастка: міграція в транзакції

Doctrine Migrations за замовчуванням загортає міграцію в транзакцію:

```sql
BEGIN;
CREATE INDEX CONCURRENTLY orders_customer_created_idx ON orders (customer_id, created_at);
ROLLBACK;
```

Що сталося? Як написати таку міграцію в Doctrine, і що ти втрачаєш без транзакції?

<details><summary>Розбір</summary>

`ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`: CIC сам комітить між
фазами. У Doctrine міграція оголошує `isTransactional(): bool { return false; }`.

Без транзакції міграція не атомарна: якщо впав другий statement, перший лишиться. Тому одна така
операція на міграцію, і `down()` теж через `DROP INDEX CONCURRENTLY`.
</details>

### 2.2. Пастка: забута транзакція

В іншій сесії psql:

```sql
\i labs/01-index-on-busy-table/forgotten_tx.sql
```

Ця сесія відкрила транзакцію, прочитала з `orders` і замовкла, як завислий процес або psql колеги,
відкритий з обіду. Enter поки не тисни. У першій сесії запусти CIC.

1. Чи закінчується побудова? На якій фазі вона стоїть і на кого чекає?
2. Чи страждають записи?
3. Як знайти винуватця на проді, і що з ним робити?

Тепер натисни Enter в іншій сесії.

<details><summary>Розбір</summary>

Побудова стоїть у фазі `waiting for old snapshots`, а сесія CIC чекає на `Lock:virtualxid` від pid
забутої транзакції: остання фаза CIC чекає всі транзакції зі старішим snapshot. Записи не
страждають, але міграція, а з нею й деплой, висить, доки транзакція жива. У моєму прогоні CIC
тривав 66 с замість 30, рівно до Enter.

Винуватця видно в `pg_stat_activity`:

```sql
SELECT pid, application_name, client_addr, state, now() - xact_start AS in_tx, query
FROM pg_stat_activity
WHERE xact_start < now() - interval '5 minutes'
ORDER BY xact_start;
```

Далі залежно від того, чия це сесія: `pg_cancel_backend(pid)`, `pg_terminate_backend(pid)` або
дочекатися. Профілактика: `idle_in_transaction_session_timeout` для ролей застосунку і перевірка
довгих транзакцій **до** старту міграції.
</details>

### 2.3. Пастка: недобудований індекс

Запусти CIC і через ~20 с перерви його (Ctrl+C), як буває, коли деплой падає по таймауту.

1. Що показує `\d orders`? Які в індексу `indisvalid` та `indisready`?
2. Чи використовує його lookup? Чи коштує він щось записам?
3. Повтори міграцію як `CREATE INDEX CONCURRENTLY IF NOT EXISTS …` з тим самим ім'ям. Що
   сталося, і що покаже перевірка?
4. Як прибрати такий індекс і збудувати правильно?
5. Прибери індекс і повтори 2.2, але перед CIC виконай `SET lock_timeout = '3s';`. Що стане з
   індексом?

<details><summary>Розбір</summary>

Перерваний CIC лишає індекс `INVALID`. Якщо його перервали після першого проходу
(`indisready = t`), записи його оновлюють, а запити не використовують: платиш і нічого не маєш.
Через WAL він є і на репліці.

`IF NOT EXISTS` перевіряє лише ім'я. У моєму прогоні:
`NOTICE: relation "orders_customer_created_idx" already exists, skipping`, міграція успішна,
індекс `INVALID`, lookup іде через `Seq Scan`. «Зелена» міграція без індексу — найгірший варіант;
перевірка його ловить.

Виправлення: `DROP INDEX CONCURRENTLY` і CIC ще раз, або
`REINDEX INDEX CONCURRENTLY orders_customer_created_idx`.

**`lock_timeout`** для звичайного DDL — правильна порада, але CIC чекає на старі транзакції теж
через блокування (`Lock:virtualxid`). У моєму прогоні CIC через 34 с упав з
`canceling statement due to lock timeout` і лишив `INVALID` індекс: «висить» стало «впав і лишив
сміття». В обох випадках спершу шукай довгі транзакції.
</details>

## Крок 3. Як на проді

Прибери залишки експериментів (має лишитися тільки `orders_pkey`) і перезапусти навантаження, щоб
підсумок рахувався з нуля. Зроби міграцію так, як зробив би на проді, дочекайся кінця, запусти
перевірку і зупини навантаження. Критерій успіху — на початку лаби.

<details><summary>Чекліст</summary>

1. **Чи потрібен індекс і який:** `EXPLAIN (ANALYZE)`; колонки спершу під `WHERE`, потім під
   `ORDER BY`. Індекс лише по `customer_id` прибере seq scan, але лишить окреме сортування.
2. **Місце на диску:** ~600 МБ індексу плюс тимчасові файли сортування.
3. **Довгі транзакції:** запит із 2.2, до старту.
4. **Сесія міграції:** `SET statement_timeout = 0`, якщо в ролі є дефолтний;
   `SET maintenance_work_mem = '1GB'` у межах вільної пам'яті сервера.
5. **CIC** в окремій нетранзакційній міграції, без `IF NOT EXISTS` або з перевіркою `indisvalid`.
6. **Після:** `indisvalid` на primary, `EXPLAIN`, latency записів, репліка.
</details>

## Крок 4. Без CONCURRENTLY

CIC не підходить, коли таблиця партиціонована, коли інструмент міграцій усе виконує в транзакції
або коли довгі транзакції не дають йому закінчити. Прибери індекс із кроку 3
(`DROP INDEX CONCURRENTLY`) і спробуй обхідні шляхи.

### 4.1. Вікно: коротша побудова

Звичайний `CREATE INDEX` блокує записи на весь час побудови. Цей час можна лише скоротити й
перенести туди, де записів мало. Зупини навантаження (це твоє «вікно») і збудуй індекс з
налаштуваннями стенда:

```sql
\timing on
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at);
DROP INDEX orders_customer_created_idx;
```

Тепер з більшою пам'яттю на сортування і паралельною побудовою:

```sql
SET maintenance_work_mem = '1GB';
SET max_parallel_maintenance_workers = 2;
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at);
DROP INDEX orders_customer_created_idx;
RESET maintenance_work_mem;
RESET max_parallel_maintenance_workers;
```

1. Наскільки коротшою стала побудова?
2. На стенді 2 CPU. Чого чекати на сервері з 16 ядрами?

<details><summary>Розбір</summary>

У моєму прогоні без навантаження:

| Налаштування | Побудова |
|---|---|
| стенд: 64 МБ, без паралельності | 19,1 с |
| `maintenance_work_mem = '1GB'` | 18,8 с |
| `1GB` + 2 паралельні процеси | 13,8 с (−28%) |

`maintenance_work_mem` зменшує запис тимчасових файлів сортування. Тут він майже не допоміг:
ймовірно, ці файли лягли в кеш ОС (на стенді не міряно). `max_parallel_maintenance_workers` додає
процеси, що читають і сортують частини таблиці, а злиття робить один процес. На 16 ядрах
паралельність дасть більше, ніж на 2 CPU стенда. За замовчуванням у PostgreSQL це 2; на стенді 0,
щоб побудову було видно.

Пауза записів однаково дорівнює часу побудови: вікно робить її коротшою й запланованою, але не
прибирає.
</details>

### 4.2. Вікно й забута транзакція: `lock_timeout`

Запусти навантаження. В іншій сесії psql:

```sql
\i labs/01-index-on-busy-table/forgotten_write_tx.sql
```

Ця транзакція змінила одне замовлення й замовкла. Вона тримає `RowExclusiveLock` на `orders`, як
будь-який writer. У першій сесії:

```sql
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at);
```

1. Чи почалася побудова? Що із записами? А з читаннями?
2. Хто кого чекає?

Перерви `CREATE INDEX` і спробуй так:

```sql
SET lock_timeout = '2s';
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at);
```

3. Що сталося, і скільки цього разу стояли записи?
4. Чи лишився `INVALID` індекс, як у 2.3?

Заверши забуту транзакцію: Enter в іншій сесії.

<details><summary>Розбір</summary>

У моєму прогоні без `lock_timeout` `CREATE INDEX` простояв у черзі 10 с, поки я його не перервав.
Побудова так і не почалась, усі 4 writers стояли, читання йшли (192–196/s). У `pg_locks`:
забута транзакція тримає `RowExclusiveLock`, psql чекає `ShareLock`, 4 writers чекають
`RowExclusiveLock`.

**Черга блокувань.** `CREATE INDEX` чекає, бо `ShareLock` несумісний із `RowExclusiveLock` забутої
транзакції. Нові writers просять `RowExclusiveLock`, а він конфліктує з `ShareLock`, на який уже
чекають, і в обхід черги PostgreSQL не пускає. Тож записи стоять ще до початку побудови і доти,
доки жива забута транзакція. SELECT бере `AccessShareLock`, сумісний зі `ShareLock`, тому читання
йдуть.

З `lock_timeout = '2s'`: `ERROR: canceling statement due to lock timeout` рівно через 2,0 с, записи
стояли ~2 с (`write max 9.98s` у підсумку — від першої спроби). Звичайний `CREATE INDEX` — одна
транзакція, тож після помилки, на відміну від CIC, нічого не лишається. У міграції це
`lock_timeout` і повтор пізніше. Отримавши lock, побудова однаково йде до кінця, тож це спосіб
вчасно відступити, а не обійтися без вікна.

Та сама черга з `ALTER TABLE` — тема лаби 2; там у черзі стоять навіть SELECT.
</details>

### 4.3. Партиції: індекс частинами

Створи партиціоновану копію `orders` (~15 с): кожне четверте замовлення, партиція на рік.

```sql
\i labs/01-index-on-busy-table/partitions.sql
```

Перезапусти навантаження: група `write-part` пише нові замовлення в `orders_part`, тобто лише в
партицію поточного року. У старі, «холодні» партиції ніхто не пише.

Спершу очевидне:

```sql
CREATE INDEX CONCURRENTLY orders_part_cust_idx ON orders_part (customer_id, created_at);
```

1. Що відповів PostgreSQL?

Тепер частинами. Індекс лише на батьківській таблиці:

```sql
CREATE INDEX orders_part_cust_idx ON ONLY orders_part (customer_id, created_at);
```

Звичайний `CREATE INDEX` на кожній холодній партиції (запит складає команди, `\gexec` виконує їх
по черзі):

```sql
SELECT format('CREATE INDEX %I ON %I (customer_id, created_at)', c.relname || '_cust_idx', c.relname)
FROM pg_inherits AS i JOIN pg_class AS c ON c.oid = i.inhrelid
WHERE i.inhparent = 'orders_part'::regclass
  AND c.relname <> 'orders_part_' || extract(year FROM now())
ORDER BY c.relname \gexec
```

Гаряча партиція так само (або `CONCURRENTLY`, якщо пауза задовга):

```sql
SELECT format('CREATE INDEX %I ON %I (customer_id, created_at)', c.relname || '_cust_idx', c.relname)
FROM pg_class AS c
WHERE c.relname = 'orders_part_' || extract(year FROM now()) \gexec
```

Приєднай індекси партицій до батьківського:

```sql
SELECT format('ALTER INDEX orders_part_cust_idx ATTACH PARTITION %I', c.relname || '_cust_idx')
FROM pg_inherits AS i JOIN pg_class AS c ON c.oid = i.inhrelid
WHERE i.inhparent = 'orders_part'::regclass
ORDER BY c.relname \gexec
```

2. Що відбувалося з `write-part` і з `write`, поки будувались індекси холодних партицій?
3. Скільки стояв `write-part` під час побудови індексу гарячої партиції? Чому так мало?
4. Коли `orders_part_cust_idx` став `VALID`?
5. Що змінилося б, якби в холодні партиції теж писали, наприклад оновлювали старі замовлення?

<details><summary>Розбір</summary>

У моєму прогоні: 2023 — 0,46 млн рядків (рік неповний), 2024 і 2025 — по 1,58 млн, 2026 — 1,42 млн,
2027 — порожня.

- **CIC:** `ERROR: cannot create index on partitioned table "orders_part" concurrently`.
- **Холодні партиції:** 0,3–1,6 с кожна, `ShareLock` лише на свою партицію. `write-part` ішов
  96–98/s без затримок.
- **Гаряча партиція 2026:** 1,4 с, і стільки ж чекав `write-part` (`write-part max 1.36s` проти
  20–28 с для всієї таблиці на кроці 1).
- **`write` в `orders`** нічого не помітив: max 30 мс.
- **`ATTACH PARTITION`:** ~1 мс на партицію. Після останньої `orders_part_cust_idx` став `VALID`, і
  lookup пішов через `Index Scan Backward` у кожній партиції, `Append` і `Sort` згори, бо рядки з
  кількох партицій треба впорядкувати разом.

Новий запис блокує батьківську таблицю і свою партицію, тож із холодними не конфліктує, а пауза на
гарячій дорівнює побудові лише її індексу. Якби в холодні партиції писали, кожна поводилась би як
маленька `orders` на кроці 1. `ON ONLY` створює батьківський індекс `INVALID`; `VALID` він стає,
щойно приєднано індекси всіх партицій.
</details>

Прибери копію (вона займає місце на диску) і перезапусти навантаження:

```sql
DROP TABLE orders_part;
DROP SEQUENCE orders_part_id_seq;
```

### 4.4. Ще два способи

<details><summary>Тіньова таблиця, blue/green</summary>

**Тіньова таблиця й підміна** (pt-online-schema-change і gh-ost у MySQL,
[pg-osc](https://github.com/shayonj/pg-osc) у PostgreSQL): `orders_new` одразу з індексом, тригер
на `orders` повторює в ній кожну зміну, наявні рядки копіюються батчами, а в кінці таблиці
перейменовують у короткій транзакції. Блокування лише на мить перейменування, і заодно можна
змінити схему. Ціна: удвічі більше місця, тригер на кожен запис, складнощі з FK, послідовностями й
правами.

**Blue/green через логічну реплікацію:** новий кластер отримує зміни, індекс там будується
звичайним `CREATE INDEX` (відстає лише застосування змін), потім застосунок перемикається. Для
одного індексу це забагато; має сенс для великих змін або разом з оновленням версії PostgreSQL.

Обидва способи — окремі лаби в [ROADMAP](../../ROADMAP.md).
</details>

## Що відповісти на інтерв'ю

Спершу напиши свою відповідь (5–7 речень), потім порівняй.

<details><summary>Приклад відповіді</summary>

Спершу перевірю, що індекс потрібен: `EXPLAIN (ANALYZE)` запиту і колонки під `WHERE` та
`ORDER BY`. Звичайний `CREATE INDEX` тримає `ShareLock` усю побудову, і записи стоять хвилинами,
тому на живій таблиці беру `CREATE INDEX CONCURRENTLY`. Він не блокує записи, але проходить
таблицю двічі, вантажить диск і WAL і не працює в транзакції: у Doctrine це окрема міграція з
`isTransactional(): false`.

Перед стартом шукаю довгі транзакції в `pg_stat_activity`, бо CIC чекатиме на них у кінці. Під час
побудови дивлюся `pg_stat_progress_create_index`, latency записів і відставання реплік. Перерваний
CIC лишає `INVALID` індекс, який оновлюється на записах, але не працює для читання, а
`IF NOT EXISTS` його мовчки пропустить. Його видаляю через `DROP INDEX CONCURRENTLY` і будую знову.
Після міграції перевіряю `indisvalid` і план запиту.

Якщо `CONCURRENTLY` не підходить:
- звичайний `CREATE INDEX` у вікні, з `lock_timeout` і повтором, більшим `maintenance_work_mem` і
  паралельною побудовою: пауза записів лишається, але коротша й запланована;
- на партиціонованій таблиці — частинами: `CREATE INDEX … ON ONLY`, індекси партицій,
  `ALTER INDEX … ATTACH PARTITION`;
- для великих змін — тіньова таблиця (pg-osc) або blue/green через логічну реплікацію.

У MySQL та сама задача: online DDL (`ALGORITHM=INPLACE, LOCK=NONE`) з metadata lock на початку і в
кінці та відставанням реплік на весь час побудови, а для великих таблиць gh-ost або
pt-online-schema-change.
</details>

## Документація

PostgreSQL 17, як на стенді:

- [CREATE INDEX → Building Indexes Concurrently](https://www.postgresql.org/docs/17/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
- [Table-Level Locks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-TABLES): що з чим конфліктує
- [Progress Reporting → CREATE INDEX](https://www.postgresql.org/docs/17/progress-reporting.html#CREATE-INDEX-PROGRESS-REPORTING): фази побудови
- [`pg_stat_activity`](https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW),
  [wait events](https://www.postgresql.org/docs/17/monitoring-stats.html#WAIT-EVENT-TABLE),
  [`pg_locks`](https://www.postgresql.org/docs/17/view-pg-locks.html),
  [`pg_index`](https://www.postgresql.org/docs/17/catalog-pg-index.html)
- [Using EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html)
- [REINDEX CONCURRENTLY](https://www.postgresql.org/docs/17/sql-reindex.html#SQL-REINDEX-CONCURRENTLY),
  [DROP INDEX](https://www.postgresql.org/docs/17/sql-dropindex.html)
- [Partition Maintenance](https://www.postgresql.org/docs/17/ddl-partitioning.html#DDL-PARTITIONING-DECLARATIVE-MAINTENANCE),
  [ALTER INDEX](https://www.postgresql.org/docs/17/sql-alterindex.html)
- [`maintenance_work_mem`](https://www.postgresql.org/docs/17/runtime-config-resource.html#GUC-MAINTENANCE-WORK-MEM),
  [`max_parallel_maintenance_workers`](https://www.postgresql.org/docs/17/runtime-config-resource.html#GUC-MAX-PARALLEL-MAINTENANCE-WORKERS)
- [`lock_timeout`](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-LOCK-TIMEOUT),
  [`statement_timeout`](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-STATEMENT-TIMEOUT),
  [`idle_in_transaction_session_timeout`](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-IDLE-IN-TRANSACTION-SESSION-TIMEOUT)
- [Logical Replication](https://www.postgresql.org/docs/17/logical-replication.html)

Doctrine: [Migration Classes → isTransactional](https://www.doctrine-project.org/projects/doctrine-migrations/en/stable/reference/migration-classes.html#istransactional).

## Що далі

Лаба 2: `ALTER TABLE` і черга блокувань. Там блокує `AccessExclusiveLock`, і в черзі стоять навіть
SELECT.
