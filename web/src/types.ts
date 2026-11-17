// Mirrors labd's JSON (internal/load, internal/observe, internal/server). Durations are seconds.

export interface LoadWindow {
  group: string
  count: number
  errors: number
  p50: number
  p99: number
  max: number
  stuck: number
  stuck_after: number
  last: number
  last_error?: string
}

export interface Session {
  pid: number
  app: string
  state: string
  waits_on: string
  blocked_by: number[] | null
  in_tx: number | null
  query: string
}

export interface LoadgenSessions {
  app: string
  sessions: number
  waiting_on_lock: number
  top_wait: string
  blocked_by: number[] | null
}

export interface Lock {
  pid: number
  app: string
  relation: string
  mode: string
  granted: boolean
}

export interface Build {
  pid: number
  command: string
  phase: string
  blocks_total: number
  blocks_done: number
  tuples_total: number
  tuples_done: number
  lockers_total: number
  lockers_done: number
  waits_for_pid: number | null
  running: number
}

export interface Index {
  name: string
  table: string
  valid: boolean
  ready: boolean
  bytes: number
  definition: string
}

export interface Replica {
  name: string
  state: string
  behind_bytes: number
  lag_seconds: number
}

export interface TableStats {
  rows: number
  dead_rows: number
  bytes: number
}

export interface DbState {
  version: string
  table: TableStats | null
  sessions: Session[] | null
  loadgen: LoadgenSessions[] | null
  locks: Lock[] | null
  progress: Build[] | null
  indexes: Index[] | null
  replicas: Replica[] | null
  wal_rate: number
  error?: string
}

export interface Frame {
  t: number
  load: LoadWindow[] | null
  db: DbState
}

export interface Summary {
  group: string
  ok: number
  errors: number
  p50: number
  p99: number
  max: number
}

export interface LoadStatus {
  running: boolean
  since?: string
  summary?: Summary[]
}

export interface LabInfo {
  lab: {
    id: string
    title: string
    table: string
    watch?: string[]
    load: { name: string; workers: number; rate?: number; requires?: string }[]
  }
  readme: string
}
