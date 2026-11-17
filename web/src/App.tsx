import { useCallback, useEffect, useState } from 'react'
import type { LabInfo, LoadStatus, Summary } from './types'
import { useLive } from './useLive'
import { useLayout } from './useLayout'
import { LabText } from './components/LabText'
import { GroupCards } from './components/GroupCards'
import { Charts } from './components/Charts'
import { DbPanels } from './components/DbPanels'
import { PASTE_EVENT, Terminals } from './components/Terminals'
import { LoadButton } from './components/LoadControl'
import { CheckButton, CheckCard, type CheckResult } from './components/Check'
import { Splitter } from './components/Splitter'
import { bytes, docsPages, docsUrl } from './format'

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high))

export function App() {
  const [info, setInfo] = useState<LabInfo | null>(null)
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<Summary[] | null>(null)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [termMax, setTermMax] = useState(false)
  const { layout, update, reset } = useLayout()
  const { frames, connected } = useLive()
  const frame = frames.at(-1)

  useEffect(() => {
    fetch('/api/lab').then((r) => r.json()).then(setInfo)
    fetch('/api/load')
      .then((r) => r.json())
      .then((s: LoadStatus) => setRunning(s.running))
  }, [])

  // The stream tells whether the load runs, so a second tab or a restart of labd stays in sync;
  // whenever the load is off, the cards show the latest run's summary.
  const streamRunning = frame ? frame.load != null : running
  useEffect(() => {
    setRunning(streamRunning)
    if (streamRunning) return
    fetch('/api/load')
      .then((r) => r.json())
      .then((s: LoadStatus) => s.summary && setSummary(s.summary))
  }, [streamRunning])

  const toggleConsole = useCallback(() => {
    setTermMax(false)
    update((l) => ({ consoleOpen: !l.consoleOpen }))
  }, [update])
  const toggleMax = useCallback(() => {
    update({ consoleOpen: true })
    setTermMax((max) => !max)
  }, [update])
  const toggleText = useCallback(() => update((l) => ({ textHidden: !l.textHidden })), [update])

  // Shortcuts match the physical key, so any keyboard layout works. They are caught in the capture
  // phase, before xterm.js, so none of them reaches psql.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      const action = e.shiftKey
        ? ({ KeyX: toggleMax, KeyL: toggleText } as Record<string, () => void>)[e.code]
        : e.code === 'Backquote'
          ? toggleConsole
          : undefined
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      action()
    }
    // "To psql" from the lab text opens the console if it is folded.
    const openConsole = () => update({ consoleOpen: true })
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener(PASTE_EVENT, openConsole)
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener(PASTE_EVENT, openConsole)
    }
  }, [toggleConsole, toggleMax, toggleText, update])

  const textHidden = layout.textHidden || termMax
  const consoleOpen = layout.consoleOpen || termMax

  return (
    // The page itself never scrolls; the lab text and the dashboard scroll inside their own areas.
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-4 border-b border-line bg-panel/60 px-5 py-2.5">
        <div className="flex items-center gap-2 font-mono text-sm font-bold text-accent">
          <span className="grid h-6 w-6 place-items-center rounded bg-accent text-ink">▚</span>
          hot-table
        </div>
        <button
          onClick={toggleText}
          className={`rounded px-1.5 py-0.5 text-sm hover:bg-line ${layout.textHidden ? 'text-slate-500' : 'text-slate-300'}`}
          title={`${layout.textHidden ? 'Показати' : 'Сховати'} текст лаби (Ctrl+Shift+L)`}
        >
          ◧
        </button>
        <h1 className="truncate text-sm font-semibold text-slate-100">{info?.lab.title ?? '…'}</h1>
        {frame?.db.version && (
          <a
            href={docsUrl(frame.db.version)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded border border-line px-2 py-0.5 font-mono text-xs text-slate-300 hover:border-accent/60 hover:text-accent"
            title="Документація PostgreSQL цієї версії"
          >
            PostgreSQL {frame.db.version} ↗
          </a>
        )}
        {frame?.db.table && info && (
          <a
            href={docsUrl(frame.db.version, docsPages.tableStats)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-mono text-xs text-slate-400 hover:text-accent"
            title={
              `Оцінка з pg_stat_user_tables.n_live_tup, оновлюється з кожним commit. ` +
              `Точний count(*) на мільйонах рядків — це повний прохід таблиці.\n` +
              `Мертвих рядків: ${frame.db.table.dead_rows.toLocaleString('uk-UA')}; ` +
              `розмір: ${bytes(frame.db.table.bytes)} (на час останнього VACUUM / ANALYZE).`
            }
          >
            {info.lab.table} ≈ <span className="text-slate-200">{frame.db.table.rows.toLocaleString('uk-UA')}</span> рядків
          </a>
        )}
        <span
          className={`ml-2 flex items-center gap-1.5 text-xs ${connected ? 'text-slate-400' : 'text-stuck'}`}
          title="Зв'язок з labd"
        >
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-accent' : 'animate-pulse bg-stuck'}`} />
          {connected ? 'live' : 'немає зв’язку з labd'}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <CheckButton onResult={setCheck} />
          <LoadButton
            running={running}
            onChange={(status) => {
              setRunning(status.running)
              if (!status.running && status.summary) setSummary(status.summary)
            }}
          />
        </div>
      </header>

      {/* Hidden areas stay mounted: psql sessions, charts and the text's scroll position live on. */}
      <div className="flex min-h-0 flex-1">
        <aside
          style={{ width: clamp(layout.textWidth, 280, window.innerWidth * 0.7) }}
          className={textHidden ? 'hidden' : 'shrink-0 overflow-y-auto px-6 py-5'}
        >
          {info ? <LabText markdown={info.readme} /> : <div className="text-sm text-slate-500">Завантаження…</div>}
        </aside>
        {!textHidden && (
          <Splitter
            axis="x"
            onMove={(x) => update({ textWidth: clamp(x, 280, window.innerWidth * 0.7) })}
            onReset={() => reset(['textWidth'])}
          />
        )}

        <main className="@container flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={termMax ? 'hidden' : 'min-h-0 flex-1 space-y-3 overflow-y-auto p-4'}>
            {check && <CheckCard result={check} onClose={() => setCheck(null)} />}
            <GroupCards frame={frame} summary={summary} />
            {/* The charts' series come from the lab's load groups, so they wait for the lab. */}
            {info && (
              <Charts
                key={info.lab.load.map((g) => g.name).join()}
                frames={frames}
                groups={info.lab.load.map((g) => g.name)}
              />
            )}
            <DbPanels db={frame?.db} table={info?.lab.table ?? ''} />
          </div>
          {consoleOpen && !termMax && (
            <Splitter
              axis="y"
              onMove={(y) => update({ consoleHeight: clamp(window.innerHeight - y, 120, window.innerHeight - 200) })}
              onReset={() => reset(['consoleHeight'])}
            />
          )}
          <div
            style={consoleOpen && !termMax ? { height: layout.consoleHeight } : undefined}
            className={termMax ? 'min-h-0 flex-1' : 'shrink-0'}
          >
            <Terminals
              open={consoleOpen}
              onToggleOpen={toggleConsole}
              maximized={termMax}
              onToggleMaximize={toggleMax}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
