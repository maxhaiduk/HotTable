export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  if (seconds < 0.001) return `${(seconds * 1000).toFixed(2)} ms`
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  return `${Math.floor(seconds / 60)} m ${Math.round(seconds % 60)} s`
}

export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 0
  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

const groupColors: Record<string, string> = {
  write: 'var(--color-write)',
  read: 'var(--color-read)',
  lookup: 'var(--color-lookup)',
  'write-part': '#fb923c',
}
const spareColors = ['#f472b6', '#facc15', '#38bdf8', '#a3e635']

// A load group's color; groups a lab adds beyond the usual ones get spare colors by name.
export function groupColor(group: string): string {
  if (groupColors[group]) return groupColors[group]
  let hash = 0
  for (const ch of group) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return spareColors[hash % spareColors.length]
}

// PostgreSQL's documentation for the stand's major version, e.g. 17.12 → /docs/17/.
export function docsUrl(version: string | undefined, page = ''): string {
  const major = version?.split('.')[0]
  return `https://www.postgresql.org/docs/${major && /^\d+$/.test(major) ? major : 'current'}/${page}`
}

export const docsPages = {
  locks: 'view-pg-locks.html',
  activity: 'monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW',
  waitEvents: 'monitoring-stats.html#WAIT-EVENT-TABLE',
  progress: 'progress-reporting.html#CREATE-INDEX-PROGRESS-REPORTING',
  index: 'catalog-pg-index.html',
  replication: 'monitoring-stats.html#MONITORING-PG-STAT-REPLICATION-VIEW',
  tableStats: 'monitoring-stats.html#MONITORING-PG-STAT-ALL-TABLES-VIEW',
}

export function wsUrl(path: string): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`
}
