import { useState } from 'react'
import type { LoadStatus, Summary } from '../types'
import { duration, groupColor } from '../format'

interface Props {
  running: boolean
  onChange: (status: LoadStatus) => void
}

export function LoadButton({ running, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ running: !running }),
      })
      if (!response.ok) throw new Error(await response.text())
      onChange(await response.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="max-w-md truncate text-xs text-stuck" title={error}>{error}</span>}
      <button
        onClick={toggle}
        disabled={busy}
        className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
          running
            ? 'border border-stuck/60 text-stuck hover:bg-stuck/10'
            : 'bg-accent text-ink hover:bg-lime-300'
        }`}
      >
        {busy ? '…' : running ? '■ Зупинити й підсумувати' : '▶ Запустити навантаження'}
      </button>
    </div>
  )
}

// The run's summary: the numbers the lab's success criterion is checked against.
export function SummaryCard({ summary, onClose }: { summary: Summary[]; onClose: () => void }) {
  return (
    <div className="rounded-lg border border-accent/30 bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-accent uppercase">Підсумок прогону</h3>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-200">
          закрити
        </button>
      </div>
      <table className="w-full font-mono text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="text-left font-normal">група</th>
            <th className="text-right font-normal">ok</th>
            <th className="text-right font-normal">err</th>
            <th className="text-right font-normal">p50</th>
            <th className="text-right font-normal">p99</th>
            <th className="text-right font-normal">max</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.group}>
              <td style={{ color: groupColor[s.group] }}>{s.group}</td>
              <td className="text-right">{s.ok}</td>
              <td className={`text-right ${s.errors ? 'text-stuck' : ''}`}>{s.errors}</td>
              <td className="text-right">{duration(s.p50)}</td>
              <td className="text-right">{duration(s.p99)}</td>
              <td className={`text-right ${s.group === 'write' && s.max >= 10 ? 'text-stuck' : ''}`}>
                {duration(s.max)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-500">
        max враховує і запити, що не встигли завершитись до зупинки.
      </p>
    </div>
  )
}
