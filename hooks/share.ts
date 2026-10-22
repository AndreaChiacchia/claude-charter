import type { Chart, ChartSummary, Claim, Holder, Op, OpAction, OpInput, Participant, Peer, ShareView, Take } from '../types'
import { LIVE, PEER_COLORS } from './cells'
import { cloneChart, findItem, isClosed, percentOf, progress, replay, topCounts, walk } from './route'
import type { ReplayOp } from './route'

/** A session is live when seen in the last 3 minutes. */
export const LIVE_MS = 180_000
/** A claim lapses 10 minutes after its session was last seen. */
export const CLAIM_LAPSE_MS = 600_000
/** A session writes its liveness this often. */
export const HEARTBEAT_MS = 60_000
/** The route is re-read this often while another member is live. */
export const POLL_MS = 2000
/** Otherwise every this many polls (16 s). */
export const POLL_IDLE_EVERY = 8
/** A route not touched for 30 days is no longer offered. */
export const RETAIN_MS = 30 * 86_400_000
/** The most routes `/charter` lists. */
export const CHARTS_LISTED = 20
/** The most ops one session's log holds. */
export const MAX_OPS = 5000

/** The folder name of a project root: separators and every other symbol become `-`. */
export function slugOf(root: string): string {
  let s = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-z]:\//i.test(s)) s = s.toLowerCase()
  s = s
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)

  return s === '' ? 'unknown' : s
}

/** The id of a new route: the time in base 36 and the first characters of the session id. */
export function newChartId(now: number, sessionId: string): string {
  return now.toString(36) + '-' + sessionId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6)
}

/** The four characters that name a session. */
export function labelOf(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)
}

/** The time of the next op: a hybrid clock, so an op made after seeing another sorts after it even when clocks drift. */
export function nextT(now: number, maxT: number): number {
  return Math.max(now, maxT + 1)
}

/** A fresh participant file. */
export function newParticipant(chartId: string, sessionId: string, now: number): Participant {
  return {
    v: 1,
    chartId,
    sessionId,
    joinedAt: now,
    seenAt: now,
    endedAt: null,
    detached: false,
    discarded: false,
    takes: [],
    current: null,
    claims: [],
    ops: [],
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const ACTIONS: readonly string[] = ['plan', 'add', 'start', 'done', 'skip', 'block', 'reset', 'commit']

/** A participant file's content, cleaned; null when it is not a version 1 participant. Malformed entries are dropped. */
export function normalizeParticipant(raw: unknown): Participant | null {
  if (!isRecord(raw) || raw.v !== 1) return null
  if (typeof raw.chartId !== 'string' || typeof raw.sessionId !== 'string') return null
  if (!isNum(raw.joinedAt) || !isNum(raw.seenAt)) return null
  if (!Array.isArray(raw.takes) || !Array.isArray(raw.claims) || !Array.isArray(raw.ops)) return null
  const takes: Take[] = []
  for (const t of raw.takes as unknown[]) {
    if (isRecord(t) && typeof t.sessionId === 'string' && isNum(t.t)) takes.push({ sessionId: t.sessionId, t: t.t })
  }
  const claims: Claim[] = []
  for (const c of raw.claims as unknown[]) {
    if (isRecord(c) && typeof c.id === 'string' && isNum(c.at)) claims.push({ id: c.id, at: c.at, force: c.force === true })
  }
  const ops: Op[] = []
  for (const o of raw.ops as unknown[]) {
    if (!isRecord(o) || !isNum(o.t) || !isNum(o.n) || !isRecord(o.input)) continue
    const action = o.input.action
    if (typeof action !== 'string' || !ACTIONS.includes(action)) continue
    ops.push({ t: o.t, n: o.n, input: { ...o.input, action: action as OpAction } as OpInput })
  }

  return {
    v: 1,
    chartId: raw.chartId,
    sessionId: raw.sessionId,
    joinedAt: raw.joinedAt,
    seenAt: raw.seenAt,
    endedAt: isNum(raw.endedAt) ? raw.endedAt : null,
    detached: raw.detached === true,
    discarded: raw.discarded === true,
    takes,
    current: typeof raw.current === 'string' ? raw.current : null,
    claims,
    ops,
  }
}

export type Merged = {
  chart: Chart | null
  share: ShareView
  maxT: number
  updatedAt: number
  isSuperseded: boolean
  isDiscarded: boolean
  members: Participant[]
  liveOthers: number
}

/** The routes whose replay is kept, by route id: the most recently used. */
const REPLAY_KEPT = 64
const replays = new Map<string, { key: string; chart: Chart | null }>()

/**
 * The route the ops of every file give. Replay is pure on those ops, so the result for the very same ops (compared as
 * their exact serialization) is reused instead of replayed again. Every caller gets its own deep copy: the kept route
 * is never handed out.
 */
function replayOf(files: Participant[]): Chart | null {
  const key = files.map(f => f.sessionId + '\u0000' + JSON.stringify(f.ops)).join('\u0001')
  const slot = files[0]?.chartId ?? ''
  const hit = replays.get(slot)
  let base: Chart | null
  if (hit !== undefined && hit.key === key) {
    base = hit.chart
  } else {
    const ops: ReplayOp[] = []
    for (const f of files) {
      for (const o of f.ops) ops.push({ t: o.t, s: f.sessionId, n: o.n, input: o.input })
    }
    base = replay(ops)
  }
  replays.delete(slot)
  replays.set(slot, { key, chart: base })
  for (const k of replays.keys()) {
    if (replays.size <= REPLAY_KEPT) break
    replays.delete(k)
  }

  return base === null ? null : cloneChart(base)
}

/** Every ancestor id (outermost first) of every item. */
function ancestry(chart: Chart): Map<string, string[]> {
  const map = new Map<string, string[]>()
  walk(chart.items, (item, parents) => {
    map.set(item.id, parents.map(p => p.id))
  })

  return map
}

/**
 * The route a folder of participant files gives to the session `meId`: the replay of every op, the members and their
 * liveness, and the effective claims.
 */
export function mergeChart(files: Participant[], meId: string, now: number): Merged {
  // 1. A file is superseded when another file took its session over (an adopt, or a /clear carry).
  const superseded = new Set<string>()
  for (const f of files) {
    for (const t of f.takes) {
      const x = files.find(p => p.sessionId === t.sessionId)
      if (x !== undefined && x.sessionId !== f.sessionId && t.t >= x.joinedAt) superseded.add(x.sessionId)
    }
  }
  // 2. Members and liveness.
  const members = files.filter(p => !superseded.has(p.sessionId) && !p.detached)
  const isLive = (p: Participant): boolean => p.endedAt === null && now - p.seenAt < LIVE_MS
  const claimLive = (p: Participant): boolean => p.endedAt === null && now - p.seenAt < CLAIM_LAPSE_MS

  // 3. The route: every file's ops, members or not.
  const chart = replayOf(files)
  const meFile = files.find(p => p.sessionId === meId)
  if (chart !== null) {
    const mine = meFile?.current ?? null
    chart.current = mine !== null && findItem(chart, mine) !== null ? mine : null
  }

  // 4. Effective claims.
  const held: Record<string, Holder> = {}
  const peerOrder = members
    .filter(p => p.sessionId !== meId)
    .sort((a, b) => a.joinedAt - b.joinedAt || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
  const colorOf = (sessionId: string): number => {
    if (sessionId === meId) return LIVE
    const i = peerOrder.findIndex(p => p.sessionId === sessionId)

    return PEER_COLORS[(i < 0 ? 0 : i) % PEER_COLORS.length] ?? LIVE
  }
  if (chart !== null) {
    const parentsOf = ancestry(chart)
    const related = (a: string, b: string): boolean =>
      a === b || (parentsOf.get(a) ?? []).includes(b) || (parentsOf.get(b) ?? []).includes(a)
    const candidates: { sessionId: string; claim: Claim }[] = []
    for (const p of members) {
      if (!claimLive(p)) continue
      for (const c of p.claims) {
        const f = findItem(chart, c.id)
        if (f !== null && !isClosed(f.item.status)) candidates.push({ sessionId: p.sessionId, claim: c })
      }
    }
    candidates.sort((a, b) => {
      if (a.claim.force !== b.claim.force) return a.claim.force ? -1 : 1
      const byTime = a.claim.force ? b.claim.at - a.claim.at : a.claim.at - b.claim.at
      if (byTime !== 0) return byTime

      return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0
    })
    const accepted: { sessionId: string; node: string }[] = []
    for (const cand of candidates) {
      const node = cand.claim.id
      if (accepted.some(a => a.sessionId !== cand.sessionId && related(a.node, node))) continue
      accepted.push({ sessionId: cand.sessionId, node })
      held[node] = {
        sessionId: cand.sessionId,
        label: labelOf(cand.sessionId),
        color: colorOf(cand.sessionId),
        node,
        force: cand.claim.force,
        isMe: cand.sessionId === meId,
      }
    }
  }

  // 5. Peers.
  const holdsOf = (sessionId: string): string[] =>
    Object.values(held)
      .filter(h => h.sessionId === sessionId)
      .map(h => h.node)
  const peers: Peer[] = peerOrder.map((p, i) => ({
    sessionId: p.sessionId,
    label: labelOf(p.sessionId),
    color: PEER_COLORS[i % PEER_COLORS.length] ?? LIVE,
    isLive: isLive(p),
    seenAt: p.seenAt,
    current: p.current !== null && chart !== null && findItem(chart, p.current) !== null ? p.current : null,
    holds: holdsOf(p.sessionId),
  }))

  // 6. Unclaimed: open top-level items with no held node inside.
  const unclaimed: string[] = []
  if (chart !== null) {
    for (const top of chart.items) {
      if (isClosed(top.status)) continue
      let anyHeld = held[top.id] !== undefined
      walk(top.items, item => {
        if (held[item.id] !== undefined) anyHeld = true
      })
      if (!anyHeld) unclaimed.push(top.id)
    }
  }

  // 7. The rest.
  let maxT = 0
  for (const f of files) for (const o of f.ops) maxT = Math.max(maxT, o.t)
  let updatedAt = 0
  let newest: Participant | undefined
  for (const f of files) {
    if (f.seenAt >= updatedAt) {
      updatedAt = f.seenAt
      newest = f
    }
  }
  const share: ShareView = {
    chartId: files[0]?.chartId ?? '',
    meLabel: labelOf(meId),
    peers,
    held,
    unclaimed,
    myHolds: holdsOf(meId),
  }

  return {
    chart,
    share,
    maxT,
    updatedAt,
    isSuperseded: superseded.has(meId),
    isDiscarded: newest?.discarded === true,
    members,
    liveOthers: peers.filter(p => p.isLive).length,
  }
}

// ---- claims -------------------------------------------------------------------------------------------

type Pick = (h: Holder) => boolean

function findHolder(chart: Chart, share: ShareView | null, id: string, pick: Pick): Holder | null {
  if (share === null) return null
  const f = findItem(chart, id)
  if (f === null) return null
  const own = share.held[id]
  if (own !== undefined && pick(own)) return own
  for (let i = f.parents.length - 1; i >= 0; i--) {
    const p = f.parents[i]
    const h = p === undefined ? undefined : share.held[p.id]
    if (h !== undefined && pick(h)) return h
  }
  let found: Holder | null = null
  walk(f.item.items, item => {
    const h = share.held[item.id]
    if (found === null && h !== undefined && pick(h)) found = h
  })

  return found
}

/** The holder of `id` itself, of its nearest held ancestor, or of a held descendant (first in pre-order), whoever it is. */
export function coverOf(chart: Chart, share: ShareView | null, id: string): Holder | null {
  return findHolder(chart, share, id, () => true)
}

/** `coverOf` restricted to holders other than `meId`. */
export function holderOf(chart: Chart, share: ShareView | null, id: string, meId: string): Holder | null {
  return findHolder(chart, share, id, h => h.sessionId !== meId)
}

/**
 * What starting `id` should claim for this session: null when it (or an ancestor) is already held by it; the
 * top-level stage when no other session holds part of it; else `id` itself.
 */
export function autoClaimTarget(chart: Chart | null, share: ShareView | null, id: string | null, meId: string): string | null {
  if (chart === null || id === null) return null
  const f = findItem(chart, id)
  if (f === null) return null
  if (share !== null) {
    if (share.held[id]?.sessionId === meId) return null
    if (f.parents.some(p => share.held[p.id]?.sessionId === meId)) return null
  }
  const top = f.parents[0] ?? f.item
  if (share === null) return top.id
  let othersInside = share.held[top.id] !== undefined && share.held[top.id]?.sessionId !== meId
  walk(top.items, item => {
    const h = share.held[item.id]
    if (h !== undefined && h.sessionId !== meId) othersInside = true
  })

  return othersInside ? id : top.id
}

/** This session's claims without those on `id` or under it (resolved in `chart`), plus the new one. */
export function addClaim(claims: Claim[], id: string, at: number, force: boolean, chart: Chart | null = null): Claim[] {
  const under = new Set<string>([id])
  if (chart !== null) {
    const f = findItem(chart, id)
    if (f !== null) {
      walk(f.item.items, item => {
        under.add(item.id)
      })
    }
  }

  return [...claims.filter(c => !under.has(c.id)), { id, at, force }]
}

/** The claims without the one on `id`. */
export function dropClaim(claims: Claim[], id: string): Claim[] {
  return claims.filter(c => c.id !== id)
}

/** A route as `/charter join` lists it; `now` (default: the newest sighting) decides which members are live. */
export function chartSummary(chartId: string, merged: Merged, now: number = merged.updatedAt): ChartSummary {
  const chart = merged.chart
  const counts = chart === null ? { done: 0, total: 0 } : topCounts(chart)

  return {
    chartId,
    title: chart?.title ?? '',
    pct: chart === null ? 0 : percentOf(progress(chart), chart.finishedAt !== null),
    done: counts.done,
    total: counts.total,
    members: merged.members.length,
    live: merged.members.filter(p => p.endedAt === null && now - p.seenAt < LIVE_MS).length,
    updatedAt: merged.updatedAt,
    labels: merged.members.map(p => labelOf(p.sessionId)),
  }
}
