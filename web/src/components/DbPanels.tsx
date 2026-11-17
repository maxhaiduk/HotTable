import type { ReactNode } from 'react'
import type { DbState, Lock } from '../types'
import { bytes, docsPages, docsUrl, duration } from '../format'

interface PanelProps {
  title: string
  // The view the panel reads, linked to its page in the documentation.
  hint?: string
  href?: string
  children: ReactNode
}

function Panel({ title, hint, href, children }: PanelProps) {
  return (
    <section className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h3>
        {hint &&
          (href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-[10px] text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-accent hover:decoration-accent"
              title="Документація PostgreSQL"
            >
              {hint} ↗
            </a>
          ) : (
            <span className="truncate font-mono text-[10px] text-slate-600">{hint}</span>
          ))}
      </div>
      {children}
    </section>
  )
}

const pids = (list: number[] | null) => (list && list.length ? list.join(', ') : '')

// Locks of one app, table and mode collapse into one row: four waiting writers are one fact.
function groupLocks(locks: Lock[]) {
  const rows = new Map<string, Lock & { count: number; pidList: number[] }>()
  for (const l of locks) {
    const key = `${l.app}|${l.relation}|${l.mode}|${l.granted}`
    const row = rows.get(key)
    if (row) {
      row.count++
      row.pidList.push(l.pid)
    } else rows.set(key, { ...l, count: 1, pidList: [l.pid] })
  }
  return [...rows.values()]
}

// Panels with nothing to show fold into one status line, so what does happen fits on the screen.
export function DbPanels({ db, table }: { db: DbState | undefined; table: string }) {
  if (!db) return null
  if (db.error) {
    return (
      <div className="rounded-lg border border-stuck/50 bg-stuck/10 p-3 font-mono text-xs text-stuck">
        labd не бачить базу: {db.error}. Чи запущено стенд (make up)?
      </div>
    )
  }
  const docs = (page: keyof typeof docsPages) => docsUrl(db.version, docsPages[page])
  const locks = groupLocks(db.locks ?? [])
  const progress = db.progress ?? []
  const sessions = db.sessions ?? []
  const loadgen = db.loadgen ?? []
  const quiet = [
    !locks.length && 'блокувань немає',
    !progress.length && 'індекс не будується',
    !sessions.length && 'інших сесій немає',
    !loadgen.length && 'loadgen не підключений',
  ].filter((text): text is string => Boolean(text))

  return (
    <div className="space-y-3">
      {quiet.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-slate-500">
          {quiet.map((text) => (
            <span key={text}>· {text}</span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        {locks.length > 0 && (
          <Panel title="Блокування" hint="pg_locks" href={docs('locks')}>
            <ul className="space-y-1 font-mono text-xs">
              {locks.map((l) => (
                <li key={`${l.app}${l.relation}${l.mode}${l.granted}`} className="flex items-baseline gap-2">
                  <span className={`whitespace-nowrap ${l.granted ? 'text-accent' : 'animate-pulse text-amber-400'}`}>
                    {l.granted ? '■ тримає' : '◷ чекає'}
                  </span>
                  <span className="text-slate-100">{l.mode}</span>
                  <span className="text-slate-300">на {l.relation}</span>
                  <span className="text-slate-400">
                    {l.app || '—'}
                    {l.count > 1 ? ` ×${l.count}` : ''} · pid {l.pidList.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {progress.length > 0 && (
          <Panel title="Побудова індексу" hint="pg_stat_progress_create_index" href={docs('progress')}>
            {progress.map((b) => {
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
            })}
          </Panel>
        )}

        {sessions.length > 0 && (
          <Panel title="Сесії, крім loadgen" hint="pg_stat_activity" href={docs('activity')}>
            <table className="w-full table-fixed font-mono text-xs">
              <tbody>
                {sessions.map((s) => (
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
          </Panel>
        )}

        {loadgen.length > 0 && (
          <Panel title="loadgen" hint="wait events" href={docs('waitEvents')}>
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
                {loadgen.map((l) => (
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
          </Panel>
        )}

        <Panel title="Індекси" hint="pg_index" href={docs('index')}>
          <ul className="space-y-1.5 text-xs">
            {(db.indexes ?? []).map((i, n, all) => (
              <li key={i.name}>
                {/* A table's name heads its indexes; partitions come as tables of their own. */}
                {all[n - 1]?.table !== i.table && (
                  <div
                    className={`font-mono text-[11px] ${i.table === table ? 'text-slate-300' : 'text-slate-500'} ${n > 0 ? 'mt-2.5' : ''}`}
                  >
                    {i.table}
                  </div>
                )}
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
                  {/* A partitioned table's index holds no data itself: its partitions' indexes do. */}
                  <span className="ml-auto text-slate-500">{i.bytes ? bytes(i.bytes) : '—'}</span>
                </div>
                <div className="truncate font-mono text-[11px] text-slate-500" title={i.definition}>
                  {i.definition}
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Репліка" hint="pg_stat_replication" href={docs('replication')}>
          {(db.replicas ?? []).length === 0 ? (
            <div className="text-xs text-stuck">Репліка не підключена.</div>
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
    </div>
  )
}
