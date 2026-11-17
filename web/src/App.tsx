import { useEffect, useState } from 'react'
import type { LabInfo, Summary } from './types'
import { useLive } from './useLive'
import { LabText } from './components/LabText'
import { GroupCards } from './components/GroupCards'
import { Charts } from './components/Charts'
import { DbPanels } from './components/DbPanels'
import { Terminals } from './components/Terminals'
import { LoadButton, SummaryCard } from './components/LoadControl'
import { CheckButton, CheckCard, type CheckResult } from './components/Check'

export function App() {
  const [info, setInfo] = useState<LabInfo | null>(null)
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<Summary[] | null>(null)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const { frames, connected } = useLive()
  const frame = frames.at(-1)

  useEffect(() => {
    fetch('/api/lab').then((r) => r.json()).then(setInfo)
    fetch('/api/load')
      .then((r) => r.json())
      .then((s) => setRunning(s.running))
  }, [])

  // The stream tells whether the load runs, so a second tab or a restart of labd stays in sync.
  const streamRunning = frame ? frame.load != null : running
  useEffect(() => setRunning(streamRunning), [streamRunning])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-line bg-panel/60 px-5 py-2.5">
        <div className="flex items-center gap-2 font-mono text-sm font-bold text-accent">
          <span className="grid h-6 w-6 place-items-center rounded bg-accent text-ink">▚</span>
          db-labs
        </div>
        <div className="h-5 w-px bg-line" />
        <h1 className="truncate text-sm font-semibold text-slate-100">{info?.lab.title ?? '…'}</h1>
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
              if (status.running) setSummary(null)
            }}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,36%)_1fr]">
        <aside className="overflow-y-auto border-r border-line px-6 py-5">
          {info ? <LabText markdown={info.readme} /> : <div className="text-sm text-slate-500">Завантаження…</div>}
        </aside>

        <main className="@container flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {check && <CheckCard result={check} onClose={() => setCheck(null)} />}
            {summary && <SummaryCard summary={summary} onClose={() => setSummary(null)} />}
            <GroupCards frame={frame} />
            <Charts frames={frames} />
            <DbPanels db={frame?.db} table={info?.lab.table ?? ''} />
          </div>
          <div className="h-[36%] min-h-[220px] border-t border-line">
            <Terminals />
          </div>
        </main>
      </div>
    </div>
  )
}
