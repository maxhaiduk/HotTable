import { useState } from 'react'
import type { LoadStatus } from '../types'

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
      {error && (
        <span className="max-w-md truncate text-xs text-stuck" title={error}>
          {error}
        </span>
      )}
      <button
        onClick={toggle}
        disabled={busy}
        className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
          running ? 'border border-stuck/60 text-stuck hover:bg-stuck/10' : 'bg-accent text-ink hover:bg-lime-300'
        }`}
      >
        {busy ? '…' : running ? '■ Зупинити й підсумувати' : '▶ Запустити навантаження'}
      </button>
    </div>
  )
}
