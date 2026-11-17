import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import type { Frame } from '../types'

export interface Series {
  label: string
  color: string
  value: (frame: Frame) => number | null
  dash?: number[]
}

interface Props {
  title: string
  frames: Frame[]
  series: Series[]
  format: (value: number) => string
  log?: boolean
  height?: number
}

const axis = {
  stroke: '#64748b',
  grid: { stroke: '#1e2a44', width: 1 },
  ticks: { stroke: '#1e2a44', width: 1 },
  font: '11px ui-sans-serif, system-ui',
}

// A live time series. The plot is created once and fed new data on every frame.
export function TimeChart({ title, frames, series, format, log = false, height = 150 }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const latest = useRef({ frames, series })
  latest.current = { frames, series }

  useEffect(() => {
    const el = box.current
    if (!el) return
    const color = (css: string) => getComputedStyle(el).getPropertyValue(css.slice(4, -1)).trim() || css
    const options: uPlot.Options = {
      width: el.clientWidth,
      height,
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: {
        x: { time: true },
        y: log
          ? { distr: 3, log: 10, range: (_u, _min, max) => [0.0005, Math.max(max || 1, 1) * 2] }
          : { range: (_u, _min, max) => [0, Math.max(max || 0, 1) * 1.1] },
      },
      axes: [
        {
          ...axis,
          space: 70,
          values: (_u, ticks) =>
            ticks.map((t) =>
              new Date(t * 1000).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            ),
        },
        { ...axis, size: 64, values: (_u, values) => values.map((v) => (v == null ? '' : format(v))) },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color.startsWith('var(') ? color(s.color) : s.color,
          width: 1.5,
          dash: s.dash,
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v == null ? '—' : format(v)),
        })),
      ],
    }
    plot.current = new uPlot(options, toData(latest.current.frames, latest.current.series), el)
    const observer = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height }))
    observer.observe(el)
    return () => {
      observer.disconnect()
      plot.current?.destroy()
      plot.current = null
    }
    // The plot's shape is fixed for the component's life; only its data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    plot.current?.setData(toData(frames, series))
  }, [frames, series])

  const last = frames.at(-1)
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</div>
      <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px]">
        {series.map((s) => {
          const value = last ? s.value(last) : null
          return (
            <span key={s.label} className="flex items-center gap-1 whitespace-nowrap text-slate-400">
              <span className="inline-block h-0.5 w-2.5" style={{ background: s.color }} />
              {s.label} <span className="text-slate-200">{value == null ? '—' : format(value)}</span>
            </span>
          )
        })}
      </div>
      <div ref={box} />
    </div>
  )
}

function toData(frames: Frame[], series: Series[]): uPlot.AlignedData {
  return [frames.map((f) => f.t), ...series.map((s) => frames.map((f) => s.value(f)))] as uPlot.AlignedData
}
