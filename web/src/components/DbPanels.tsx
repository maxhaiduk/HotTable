import type { ReactNode } from 'react'
import type { DbState, Lock } from '../types'
import { bytes, duration } from '../format'

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h3>
        {hint && <span className="truncate font-mono text-[10px] text-slate-600">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <div className="text-xs text-slate-600">{children}</div>

const pids = (list: number[] | null) => (list && list.length ? list.join(', ') : '')

// Locks of one app and mode collapse into one row: four waiting writers are one fact.
function groupLocks(locks: Lock[]) {
  const rows = new Map<string, Lock & { count: number; pidList: number[] }>()
  for (const l of locks) {
    const key = `${l.app}|${l.mode}|${l.granted}`
    const row = rows.get(key)
    if (row) {
      row.count++
      row.pidList.push(l.pid)
    } else rows.set(key, { ...l, count: 1, pidList: [l.pid] })
  }
  return [...rows.values()]
}

export function DbPanels({ db, table }: { db: DbState | undefined; table: string }) {
  if (!db) return null
  if (db.error) {
    return (
      <div className="rounded-lg border border-stuck/50 bg-stuck/10 p-3 font-mono text-xs text-stuck">
        labd не бачить базу: {db.error}. Чи запущено стенд (make up)?
      </div>
    )
  }
  const locks = groupLocks(db.locks ?? [])
  return (
    <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
      <Panel title={`Блокування на ${table}`} hint="pg_locks">
        {locks.length === 0 ? (
          <Empty>Ніхто, крім звичайних запитів loadgen, не тримає і не чекає блокувань.</Empty>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {locks.map((l) => (
              <li key={`${l.app}${l.mode}${l.granted}`} className="flex items-baseline gap-2">
                <span className={`whitespace-nowrap ${l.granted ? 'text-accent' : 'animate-pulse text-amber-400'}`}>
                  {l.granted ? '■ тримає' : '◷ чекає'}
                </span>
                <span className="text-slate-100">{l.mode}</span>
                <span className="text-slate-400">
                  {l.app || '—'}
                  {l.count > 1 ? ` ×${l.count}` : ''} · pid {l.pidList.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Побудова індексу" hint="pg_stat_progress_create_index">
        {(db.progress ?? []).length === 0 ? (
          <Empty>Зараз жоден індекс не будується.</Empty>
        ) : (
          (db.progress ?? []).map((b) => {
            const share = b.blocks_total
              ? b.blocks_done / b.blocks_total
              : b.tuples_total
                ? b.tuples_done / b.tuples_total
                : 0
            return (
              <div key={b.pid} className="space-y-1.5 text-xs">
                <div className="flex justify-between font-mono">
                  <span className="text-slate-100">{b.command}</span>
                  <span className="text-slate-400">
                    pid {b.pid} · {duration(b.running)}
                  </span>
                </div>
                <div className="font-mono text-accent">{b.phase}</div>
                <div className="h-1.5 overflow-hidden rounded bg-line">
                  <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(share * 100)}%` }} />
                </div>
                {b.waits_for_pid && (
                  <div className="font-mono text-amber-400">
                    чекає на pid {b.waits_for_pid} ({b.lockers_done}/{b.lockers_total})
                  </div>
                )}
              </div>
            )
          })
        )}
      </Panel>

      <Panel title="Сесії, крім loadgen" hint="pg_stat_activity">
        {(db.sessions ?? []).length === 0 ? (
          <Empty>Немає інших сесій.</Empty>
        ) : (
          <table className="w-full table-fixed font-mono text-xs">
            <tbody>
              {(db.sessions ?? []).map((s) => (
                <tr key={s.pid} className="align-top">
                  <td className="w-12 text-slate-500">{s.pid}</td>
                  <td className="w-40 pr-2">
                    <div className="truncate text-slate-200">{s.app || '—'}</div>
                    <div
                      className={`truncate ${s.state === 'idle in transaction' ? 'text-amber-400' : 'text-slate-500'}`}
                    >
                      {s.state}
                      {s.in_tx != null && ` · tx ${duration(s.in_tx)}`}
                    </div>
                  </td>
                  <td className="pr-2">
                    <div className="truncate text-slate-300" title={s.query}>
                      {s.query}
                    </div>
                    {/* An idle session always waits for its client; that is not news. */}
                    {s.state !== 'idle' && (s.waits_on || pids(s.blocked_by)) && (
                      <div className="truncate text-amber-400">
                        {s.waits_on}
                        {pids(s.blocked_by) && ` · чекає на pid ${pids(s.blocked_by)}`}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="loadgen" hint="на що чекають сесії навантаження">
        {(db.loadgen ?? []).length === 0 ? (
          <Empty>Навантаження не підключене.</Empty>
        ) : (
          <table className="w-full font-mono text-xs">
            <thead className="text-left text-[10px] text-slate-600">
              <tr>
                <th className="font-normal">група</th>
                <th className="font-normal">чекають lock</th>
                <th className="font-normal">top_wait</th>
                <th className="font-normal">blocked_by</th>
              </tr>
            </thead>
            <tbody>
              {(db.loadgen ?? []).map((l) => (
                <tr key={l.app}>
                  <td className="text-slate-300">{l.app.replace('loadgen-', '')}</td>
                  <td className={l.waiting_on_lock ? 'text-stuck' : 'text-slate-500'}>
                    {l.waiting_on_lock}/{l.sessions}
                  </td>
                  <td className="text-slate-400">{l.top_wait || 'idle'}</td>
                  <td className="text-amber-400">{pids(l.blocked_by)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Індекси ${table}`} hint="pg_index">
        <ul className="space-y-1.5 text-xs">
          {(db.indexes ?? []).map((i) => (
            <li key={i.name}>
              <div className="flex items-center gap-2 font-mono">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    i.valid ? 'bg-accent/15 text-accent' : 'bg-stuck/15 text-stuck'
                  }`}
                >
                  {i.valid ? 'VALID' : 'INVALID'}
                </span>
                {!i.ready && <span className="text-[10px] text-amber-400">not ready</span>}
                <span className="text-slate-100">{i.name}</span>
                <span className="ml-auto text-slate-500">{bytes(i.bytes)}</span>
              </div>
              <div className="truncate font-mono text-[11px] text-slate-500" title={i.definition}>
                {i.definition}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Репліка" hint="pg_stat_replication">
        {(db.replicas ?? []).length === 0 ? (
          <Empty>Репліка не підключена.</Empty>
        ) : (
          (db.replicas ?? []).map((r) => (
            <div key={r.name} className="flex gap-4 font-mono text-xs">
              <span className="text-slate-200">{r.name}</span>
              <span className="text-slate-400">{r.state}</span>
              <span className={r.behind_bytes > 16 * 1024 * 1024 ? 'text-amber-400' : 'text-slate-400'}>
                позаду {bytes(r.behind_bytes)}
              </span>
              <span className="text-slate-400">lag {duration(r.lag_seconds)}</span>
            </div>
          ))
        )}
      </Panel>
    </div>
  )
}
