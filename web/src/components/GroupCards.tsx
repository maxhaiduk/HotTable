import type { Frame } from '../types'
import { duration, groupColor } from '../format'

// One card per load group: this second's throughput and latency, and STUCK when queries hang.
export function GroupCards({ frame }: { frame: Frame | undefined }) {
  if (!frame?.load) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-5 text-sm text-slate-400">
        Навантаження вимкнене. Натисни <span className="font-semibold text-accent">Запустити навантаження</span>{' '}
        угорі, щоб у таблицю почали писати й читати.
      </div>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-3">
      {frame.load.map((w) => {
        const stuck = w.stuck >= w.stuck_after
        return (
          <div
            key={w.group}
            className={`rounded-lg border bg-panel px-4 py-3 transition-colors ${
              stuck ? 'border-stuck/70 shadow-[0_0_24px_-8px] shadow-stuck' : 'border-line'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: groupColor[w.group] }}>
                {w.group}
              </span>
              {stuck && (
                <span className="animate-pulse rounded bg-stuck/15 px-1.5 py-0.5 font-mono text-xs font-bold text-stuck">
                  STUCK {duration(w.stuck)}
                </span>
              )}
            </div>
            {w.group === 'lookup' ? (
              <div className="mt-1 font-mono text-2xl text-slate-100">
                {duration(w.last)} <span className="text-xs text-slate-500">останній</span>
              </div>
            ) : (
              <div className="mt-1 flex items-baseline gap-3 font-mono">
                <span className={`text-2xl ${w.count === 0 ? 'text-stuck' : 'text-slate-100'}`}>{w.count}/s</span>
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
