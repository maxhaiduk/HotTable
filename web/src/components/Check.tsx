import { useState } from 'react'

export interface CheckResult {
  ok: boolean
  output: string
}

// Runs the lab's check (check.py, the same as `make check`) through labd.
export function CheckButton({ onResult }: { onResult: (result: CheckResult) => void }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const response = await fetch('/api/check', { method: 'POST' })
      onResult(response.ok ? await response.json() : { ok: false, output: await response.text() })
    } catch (e) {
      onResult({ ok: false, output: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      onClick={run}
      disabled={busy}
      className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-slate-200 hover:border-accent/60 hover:text-accent disabled:opacity-50"
    >
      {busy ? 'Перевіряю…' : '✓ Перевірити'}
    </button>
  )
}

export function CheckCard({ result, onClose }: { result: CheckResult; onClose: () => void }) {
  return (
    <div className={`rounded-lg border bg-panel p-3 ${result.ok ? 'border-accent/40' : 'border-stuck/40'}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className={`text-xs font-semibold tracking-wide uppercase ${result.ok ? 'text-accent' : 'text-stuck'}`}>
          {result.ok ? 'Перевірка пройдена' : 'Перевірка не пройдена'}
        </h3>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-200">
          закрити
        </button>
      </div>
      <pre className="font-mono text-xs leading-5 whitespace-pre-wrap">
        {result.output.split('\n').map((line, i) => (
          <div
            key={i}
            className={line.includes('✓') ? 'text-accent' : line.includes('✗') ? 'text-stuck' : 'text-slate-300'}
          >
            {line}
          </div>
        ))}
      </pre>
    </div>
  )
}
