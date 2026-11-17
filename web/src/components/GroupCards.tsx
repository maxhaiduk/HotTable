import type { Frame, Summary } from '../types'
import { duration, groupColor } from '../format'

// Lab 1's criterion: a write may not wait this long. Stage 2 moves criteria into lab.yaml.
const WRITE_MAX_LIMIT = 10

// One card per load group: live numbers while the load runs, the latest run's summary when it is off.
export function GroupCards({ frame, summary }: { frame: Frame | undefined; summary: Summary[] | null }) {
  if (frame?.load) return <LiveCards windows={frame.load} />
  if (summary?.length) return <SummaryCards summary={summary} />
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-2 text-sm text-slate-400">
      Навантаження вимкнене: <span className="font-semibold text-accent">▶ Запустити навантаження</span> угорі.
    </div>
  )
}

function LiveCards({ windows }: { windows: NonNullable<Frame['load']> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
      {windows.map((w) => {
        const stuck = w.stuck >= w.stuck_after
        return (
          <div
            key={w.group}
            className={`rounded-lg border bg-panel px-4 py-2.5 transition-colors ${
              stuck ? 'border-stuck/70 shadow-[0_0_24px_-8px] shadow-stuck' : 'border-line'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: groupColor(w.group) }}>
                {w.group}
              </span>
              {stuck && (
                <span className="animate-pulse rounded bg-stuck/15 px-1.5 py-0.5 font-mono text-xs font-bold text-stuck">
                  STUCK {duration(w.stuck)}
                </span>
              )}
            </div>
            {w.group === 'lookup' ? (
              <div className="mt-0.5 font-mono text-xl text-slate-100">
                {duration(w.last)} <span className="text-xs text-slate-500">останній</span>
              </div>
            ) : (
              <div className="mt-0.5 flex items-baseline gap-3 font-mono">
                <span className={`text-xl ${w.count === 0 ? 'text-stuck' : 'text-slate-100'}`}>{w.count}/s</span>
                <span className="text-xs text-slate-400">p99 {duration(w.p99 || null)}</span>
              </div>
            )}
            {w.errors > 0 && (
              <div className="mt-1 truncate font-mono text-xs text-stuck" title={w.last_error}>
                {w.errors} err: {w.last_error}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SummaryCards({ summary }: { summary: Summary[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
      {summary.map((s) => {
        const tooLong = s.group === 'write' && s.max >= WRITE_MAX_LIMIT
        return (
          <div
            key={s.group}
            className={`rounded-lg border bg-panel px-4 py-2.5 ${s.errors || tooLong ? 'border-stuck/50' : 'border-line'}`}
            title="Останній прогін навантаження. max враховує і запити, що не встигли завершитись до зупинки."
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: groupColor(s.group) }}>
                {s.group}
              </span>
              <span className="text-[10px] tracking-wide text-slate-500 uppercase">останній прогін</span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-3 font-mono">
              <span className={`text-xl ${tooLong ? 'text-stuck' : 'text-slate-100'}`}>max {duration(s.max)}</span>
              <span className="truncate text-xs text-slate-400">
                p99 {duration(s.p99)} · ok {s.ok} ·{' '}
                <span className={s.errors ? 'text-stuck' : ''}>err {s.errors}</span>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
