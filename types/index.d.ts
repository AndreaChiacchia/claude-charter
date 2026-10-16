/** The state of a route item. `blocked` keeps the item open; `skipped` and `done` close it. */
export type ItemStatus = 'pending' | 'active' | 'done' | 'skipped' | 'blocked'

/** One stage, part or step of the route, nested up to four levels. */
export type ChartItem = {
  /** Short, unique in the route (S2, S2.P1); no spaces, at most 24 characters. */
  id: string
  title: string
  status: ItemStatus
  /** The phases the item goes through (plan, approve, implement, ...); empty for a plain item. */
  phases: string[]
  /** The phase the item is in now; always a member of `phases` when not null. */
  phase: string | null
  /** The short hash of the commit that finished it, when one did. */
  commit: string | null
  note: string | null
  doneAt: number | null
  items: ChartItem[]
}

/** A route: its items, the current step of the session that reads it, and its clocks. */
export type Chart = {
  title: string
  items: ChartItem[]
  /** An item id or null. In a merged chart this is the reading session's own current step. */
  current: string | null
  startedAt: number
  updatedAt: number
  finishedAt: number | null
  revision: number
}

/** The actions a session records in its log; `reset` and `commit` are never offered to the model. */
export type OpAction = 'plan' | 'add' | 'start' | 'done' | 'skip' | 'block' | 'reset' | 'commit'

/** The input of one recorded action. */
export type OpInput = {
  action: OpAction
  title?: string
  items?: unknown[]
  parent?: string
  id?: string
  phase?: string
  commit?: string
  note?: string
}

/** One entry of a session's op log: a hybrid-clock time `t`, the session's own counter `n`, and the action. */
export type Op = { t: number; n: number; input: OpInput }

/** A hold on a node and its subtree; `force` is set by a person's command and beats a model's. */
export type Claim = { id: string; at: number; force: boolean }

/** A record in a participant file that another session's file took over (an adopt, or a /clear carry). */
export type Take = { sessionId: string; t: number }

/** One session's file in a route's folder: everything that session wrote, and only it. */
export type Participant = {
  v: 1
  chartId: string
  sessionId: string
  joinedAt: number
  seenAt: number
  endedAt: number | null
  detached: boolean
  discarded: boolean
  takes: Take[]
  current: string | null
  claims: Claim[]
  ops: Op[]
}

/** Who holds a node. */
export type Holder = { sessionId: string; label: string; color: number; node: string; force: boolean; isMe: boolean }

/** Another member of a shared route. */
export type Peer = {
  sessionId: string
  label: string
  color: number
  isLive: boolean
  seenAt: number
  current: string | null
  holds: string[]
}

/** Who else works on the route and the effective claims. */
export type ShareView = {
  chartId: string
  meLabel: string
  peers: Peer[]
  /** Every claimed node id to its holder (subtree coverage is computed by `holderOf`). */
  held: Record<string, Holder>
  /** Open top-level ids with no held node inside. */
  unclaimed: string[]
  myHolds: string[]
}

/** A route of the project as `/charter join` lists it. */
export type ChartSummary = {
  chartId: string
  title: string
  pct: number
  done: number
  total: number
  members: number
  live: number
  updatedAt: number
  labels: string[]
}

/** The session id the route atoms belong to, and whether a /clear asked to carry the route to the next id. */
export type RouteSession = { id: string | null; carry: boolean }

/** A subagent seen this session. */
export type CrewMember = {
  id: string
  description: string
  type: string
  model: string
  startedAt: number
  endedAt: number | null
  word: 'done' | 'stopped' | 'failed' | null
}

/** A test/build/lint command seen this session; `id` is the tool_use_id. */
export type CheckRun = {
  id: string
  label: string
  startedAt: number
  endedAt: number | null
  ok: boolean | null
  isBackground: boolean
}

export type SignalKind = 'agent' | 'agent-end' | 'check' | 'commit'

/** One hard signal the mod saw by itself. */
export type Signal = {
  seq: number
  at: number
  kind: SignalKind
  text: string
  detail: string
  ok: boolean | null
  itemId: string | null
}

declare module 'claude-code' {
  interface PluginState {
    claudecharter: {
      /** The merged route this session is attached to, with this session's own current position; null when none. */
      chart: Chart | null
      /** Who else works on the route, and the effective claims; null when not attached. */
      share: ShareView | null
      /** This session's own participant file, as last written; null when not attached. */
      mine: Participant | null
      /** The session id that owns `mine`, and whether a /clear asked to carry it to the next id. */
      session: RouteSession
      /** The other routes of this project, as last listed for /charter (newest first). */
      charts: ChartSummary[]
      /** Subagents seen this session, by agent id. */
      crew: Record<string, CrewMember>
      /** Test/build/lint commands seen this session, by tool_use_id. */
      checks: Record<string, CheckRun>
      /** The latest hard signals, oldest first, at most 40. */
      log: Signal[]
    }
  }
}
