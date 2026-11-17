import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { wsUrl } from '../format'

type Target = 'primary' | 'replica'

interface Tab {
  key: string
  target: Target
  label: string
}

// The lab text's "to psql" buttons type into the visible terminal through this event.
export const PASTE_EVENT = 'lab:paste'

let nextKey = 0
const newTab = (target: Target, label: string): Tab => ({ key: `t${nextKey++}`, target, label })

export function Terminals() {
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab('primary', 'psql 1'), newTab('replica', 'replica')])
  const [active, setActive] = useState(tabs[0].key)

  const addPrimary = () => {
    const n = tabs.filter((t) => t.target === 'primary').length + 1
    const tab = newTab('primary', `psql ${n}`)
    setTabs((list) => [...list.filter((t) => t.target === 'primary'), tab, ...list.filter((t) => t.target === 'replica')])
    setActive(tab.key)
  }
  const close = (key: string) => {
    const rest = tabs.filter((t) => t.key !== key)
    setTabs(rest)
    if (active === key) setActive(rest[0].key)
  }
  const restart = () => {
    const tab = tabs.find((t) => t.key === active)
    if (!tab) return
    const fresh = { ...newTab(tab.target, tab.label) }
    setTabs((list) => list.map((t) => (t.key === active ? fresh : t)))
    setActive(fresh.key)
  }
  const primaries = tabs.filter((t) => t.target === 'primary').length

  return (
    <div className="flex h-full flex-col bg-[#070b16]">
      <div className="flex items-center gap-1 border-b border-line px-2">
        {tabs.map((t) => (
          <div
            key={t.key}
            className={`flex items-center border-b-2 ${active === t.key ? 'border-accent' : 'border-transparent'}`}
          >
            <button
              onClick={() => setActive(t.key)}
              className={`py-1.5 pr-1 pl-3 font-mono text-xs ${
                active === t.key ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
            {t.target === 'primary' && primaries > 1 ? (
              <button
                onClick={() => close(t.key)}
                className="px-1 text-xs text-slate-600 hover:text-stuck"
                title="Закрити сесію"
              >
                ×
              </button>
            ) : (
              <span className="w-2" />
            )}
          </div>
        ))}
        <button
          onClick={addPrimary}
          className="px-2 py-1 font-mono text-xs text-accent hover:text-lime-300"
          title="Ще одна сесія psql на primary"
        >
          + psql
        </button>
        <button
          onClick={restart}
          className="ml-auto px-2 py-1 text-xs text-slate-500 hover:text-slate-200"
          title="Закрити цю сесію psql і відкрити нову"
        >
          ⟳ нова сесія
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((t) => (
          <TerminalView key={t.key} target={t.target} visible={active === t.key} />
        ))}
      </div>
    </div>
  )
}

function TerminalView({ target, visible }: { target: Target; visible: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const fitRef = useRef<() => void>(() => {})
  const typeRef = useRef<(text: string) => void>(() => {})
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#070b16', foreground: '#cbd5e1', cursor: '#a3e635', selectionBackground: '#334155' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term

    const ws = new WebSocket(wsUrl(`/ws/term?target=${target}`))
    ws.binaryType = 'arraybuffer'
    const encoder = new TextEncoder()
    const resize = () => {
      if (el.clientWidth === 0) return
      fit.fit()
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ resize: [term.cols, term.rows] }))
    }
    fitRef.current = resize
    // Typed, not pasted: psql would read a bracketed paste as one line, and a meta-command
    // such as \timing would swallow the SQL after it. The last line waits for Enter.
    typeRef.current = (text) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(text.split('\n').join('\r')))
    }
    ws.onopen = resize
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data))
    ws.onclose = () => term.write('\r\n\x1b[33m[сесію закрито: «⟳ нова сесія», щоб відкрити ще одну]\x1b[0m\r\n')
    const input = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data))
    })
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    return () => {
      observer.disconnect()
      input.dispose()
      ws.close()
      term.dispose()
      termRef.current = null
    }
  }, [target])

  useEffect(() => {
    if (!visible) return
    fitRef.current()
    termRef.current?.focus()
    const paste = (e: Event) => {
      typeRef.current((e as CustomEvent<string>).detail)
      termRef.current?.focus()
    }
    window.addEventListener(PASTE_EVENT, paste)
    return () => window.removeEventListener(PASTE_EVENT, paste)
  }, [visible])

  return <div ref={box} className={`absolute inset-0 p-2 ${visible ? '' : 'invisible'}`} />
}
