import { useEffect, useState } from 'react'
import type { Frame } from './types'
import { wsUrl } from './format'

// Keeps the last `limit` seconds of labd's live stream, reconnecting when labd restarts.
export function useLive(limit = 300) {
  const [frames, setFrames] = useState<Frame[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let retry: number | undefined

    const connect = () => {
      ws = new WebSocket(wsUrl('/ws/live'))
      ws.onopen = () => setConnected(true)
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.history) setFrames(msg.history.slice(-limit))
        else if (msg.frame) setFrames((prev) => [...prev.slice(-(limit - 1)), msg.frame])
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = window.setTimeout(connect, 1000)
      }
    }
    connect()

    return () => {
      closed = true
      window.clearTimeout(retry)
      ws?.close()
    }
  }, [limit])

  return { frames, connected }
}
