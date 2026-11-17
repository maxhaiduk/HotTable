import { useMemo } from 'react'
import type { Frame } from '../types'
import { bytes, duration } from '../format'
import { TimeChart, type Series } from './TimeChart'

const group = (frame: Frame, name: string) => frame.load?.find((w) => w.group === name)
const positive = (value: number | undefined) => (value && value > 0 ? value : null)

export function Charts({ frames }: { frames: Frame[] }) {
  const throughput = useMemo<Series[]>(
    () => [
      { label: 'write/s', color: 'var(--color-write)', value: (f) => group(f, 'write')?.count ?? null },
      { label: 'read/s', color: 'var(--color-read)', value: (f) => group(f, 'read')?.count ?? null },
    ],
    [],
  )
  const latency = useMemo<Series[]>(
    () => [
      { label: 'write p99', color: 'var(--color-write)', value: (f) => positive(group(f, 'write')?.p99) },
      { label: 'read p99', color: 'var(--color-read)', value: (f) => positive(group(f, 'read')?.p99) },
      { label: 'write stuck', color: 'var(--color-stuck)', value: (f) => positive(group(f, 'write')?.stuck), dash: [4, 3] },
      { label: 'lookup', color: 'var(--color-lookup)', value: (f) => positive(group(f, 'lookup')?.last) },
    ],
    [],
  )
  const replication = useMemo<Series[]>(
    () => [
      { label: 'WAL / s', color: '#94a3b8', value: (f) => (f.db.error ? null : f.db.wal_rate) },
      { label: 'репліка позаду', color: '#fbbf24', value: (f) => f.db.replicas?.[0]?.behind_bytes ?? null },
    ],
    [],
  )

  return (
    <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
      <TimeChart title="Пропускна здатність" frames={frames} series={throughput} format={(v) => `${Math.round(v)}/s`} />
      <TimeChart title="Затримка (лог. шкала)" frames={frames} series={latency} format={duration} log />
      <TimeChart title="WAL і репліка" frames={frames} series={replication} format={bytes} />
    </div>
  )
}
