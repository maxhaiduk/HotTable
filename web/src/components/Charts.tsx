import { useMemo } from 'react'
import type { Frame } from '../types'
import { bytes, duration, groupColor } from '../format'
import { TimeChart, type Series } from './TimeChart'

const group = (frame: Frame, name: string) => frame.load?.find((w) => w.group === name)
const positive = (value: number | undefined) => (value && value > 0 ? value : null)

// One line per load group of the lab: lookup groups show their latency, the rest their throughput.
export function Charts({ frames, groups }: { frames: Frame[]; groups: string[] }) {
  const traffic = groups.filter((g) => g !== 'lookup')
  const throughput = useMemo<Series[]>(
    () => traffic.map((g) => ({ label: `${g}/s`, color: groupColor(g), value: (f) => group(f, g)?.count ?? null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups.join()],
  )
  const latency = useMemo<Series[]>(
    () => [
      ...traffic.map((g) => ({
        label: `${g} p99`,
        color: groupColor(g),
        value: (f: Frame) => positive(group(f, g)?.p99),
      })),
      ...traffic
        .filter((g) => g.startsWith('write'))
        .map((g) => ({
          label: `${g} stuck`,
          color: g === 'write' ? 'var(--color-stuck)' : '#fca5a5',
          value: (f: Frame) => positive(group(f, g)?.stuck),
          dash: [4, 3],
        })),
      ...(groups.includes('lookup')
        ? [{ label: 'lookup', color: groupColor('lookup'), value: (f: Frame) => positive(group(f, 'lookup')?.last) }]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups.join()],
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
      <TimeChart
        title="Пропускна здатність"
        frames={frames}
        series={throughput}
        format={(v) => `${Math.round(v)}/s`}
        floor={10}
      />
      <TimeChart title="Затримка (лог. шкала)" frames={frames} series={latency} format={duration} log />
      <TimeChart title="WAL і репліка" frames={frames} series={replication} format={bytes} floor={1024} />
    </div>
  )
}
