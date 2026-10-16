import { atom, read, update } from 'claude-code'
import type {
  ElementTable,
  EngineInterface,
  Register,
  RenderChildren,
  RenderElement,
  RenderNode,
  Timer,
} from 'claude-code'

import type { Chart, ChartItem, ChartSummary, CheckRun, Claim, CrewMember, OpInput, Participant, Signal } from '../types'
import { FRAME_MS, advance, createAnim, isSettled, syncTargets } from './anim'
import type { Anim, Scene, Settings } from './anim'
import { FIGURES, GOLD, LIVE, encodeCells, hex, runs } from './cells'
import type { Cell } from './cells'
import { DEMO_END_MS, DEMO_TICK_MS, demoAt, isDemoChangeAt } from './demo'
import { isWriter, mayWrite, mirrorOwner, renderMirror } from './mirror'
import {
  BADGE_ROOM,
  PERCENT_CELLS,
  advancePane,
  composeBlocked,
  composeDone,
  composeMine,
  composePills,
  composeRunGlyph,
  composeSignalGlyph,
  composeTrackLine,
  createPaneMotion,
  isPaneMoving,
  isRasterSafe,
  syncPane,
} from './pane'
import type { PaneMotion, PanePiece } from './pane'
import { ERR, NO_ROUTE_ERROR, applyAction, findItem, percentOf, progress, routeText, topCounts, unknownIdError } from './route'
import type { ProgressInput } from './route'
import {
  DEFAULT_COLUMNS,
  HINT_INDENT,
  OPEN_GLYPH,
  OPEN_HOTKEY,
  OPEN_KEY,
  PROBE_KEY,
  anyEffect,
  composeRow,
  composeTrack,
  normalizeSettings,
  openCells,
  ownIndex,
} from './row'
import {
  CHARTS_LISTED,
  HEARTBEAT_MS,
  LIVE_MS,
  MAX_OPS,
  POLL_IDLE_EVERY,
  POLL_MS,
  RETAIN_MS,
  addClaim,
  autoClaimTarget,
  chartSummary,
  dropClaim,
  holderOf,
  labelOf,
  mergeChart,
  newChartId,
  newParticipant,
  nextT,
  normalizeParticipant,
  slugOf,
} from './share'
import { INIT_PROMPT, INPUT_SCHEMA, NUDGE_TEXT, TOOL_DESCRIPTION, USAGE } from './texts'
import { CHECK_SHOW_MS, checkLabel, formatDuration, gitCommitInfo, modelLabel, stamp, wordForReason } from './signals'

const TOOL = 'mcp__claudecharter__progress'
const AGENT_TOOL = 'Agent'
const PUBLIC_ACTIONS: readonly string[] = ['plan', 'add', 'start', 'done', 'skip', 'block', 'get', 'claim', 'release']
const PANE = 'charter'
const RASTER_KEY = 'charter-row'
/** The prefix of the keys of the pane's Rasters. */
const PANE_KEY = 'charter-pane-'
/** The band is not drawn under this many columns. */
const MIN_COLS = 20
/** First blits refused this many times in a row (none ever accepted) switch the band to a still draw. */
const MAX_REFUSED_MOUNTS = 3
/** A finished route stays on the band this long (ms). */
const COMPLETE_SHOW_MS = 600_000
const LOG_KEPT = 40
const CHECKS_KEPT = 20
const CREW_KEPT = 50
const MIRROR_DELAY_MS = 400

const chartAtom = atom({ plugin: 'claudecharter', key: 'chart' } as const, null)
const shareAtom = atom({ plugin: 'claudecharter', key: 'share' } as const, null)
const mineAtom = atom({ plugin: 'claudecharter', key: 'mine' } as const, null)
const sessionAtom = atom({ plugin: 'claudecharter', key: 'session' } as const, { id: null, carry: false })
const chartsAtom = atom({ plugin: 'claudecharter', key: 'charts' } as const, [])
const crewAtom = atom({ plugin: 'claudecharter', key: 'crew' } as const, {})
const checksAtom = atom({ plugin: 'claudecharter', key: 'checks' } as const, {})
const logAtom = atom({ plugin: 'claudecharter', key: 'log' } as const, [])

// State of the running module. It is lost on a reload by design: the next render rebuilds it.
// `register` resets it, so a module instance shared by several loads starts each one clean.
let settings: Settings = normalizeSettings({})
let timer: Timer | null = null
let isBlitting = false
/** The mounted Raster the timer repaints: the render's request and the band width. */
let band: { requestId: string; cols: number } | null = null
/** The cells the row may take under the prompt, as the width probe measured them, by drawing (requestId). */
const slotCols = new Map<string, number>()
/** What the band shows, as the last render read it. */
let scene: Scene | null = null
let anim: Anim = createAnim()
/** Blits accepted since the last render that drew the Raster. */
let framesSinceMount = 0
/** Fresh draws whose first blit was refused, while no blit has ever been accepted. */
let refusedMounts = 0
let everBlitted = false
/** Set when this slot keeps refusing the first blit: the band is drawn still from then on. */
let isStaticFallback = false
let lastEncoded = ''
/** The pane's frame timer, and the guard that keeps a frame from starting while another still blits. */
let paneTimer: Timer | null = null
let paneBlitting = false
/** The Rasters of the pane as it was last drawn live: the request and the pieces the timer repaints. */
let paneSite: { requestId: string; pieces: PanePiece[] } | null = null
/** The cells last taken by each piece of the pane, by piece key. */
const lastPaneBlit = new Map<string, string>()
/** Blits accepted since the last render that drew the pane's Rasters. */
let paneFramesSinceMount = 0
let paneAnim: Anim = createAnim()
let paneMotion: PaneMotion = createPaneMotion()
/** The pane's own counters for the still fallback, independent of the band's. */
let paneRefusedMounts = 0
let paneEverBlitted = false
let isPaneStatic = false
/** True from the main conversation's turn start to its turn end. */
let mainWorking = false
/** Running subagents plus checks at the pane's last live render. */
let paneRunning = 0
let chartsRoot: string | null = null
let projectRoot: string | null = null
/** The participant files read so far, by path: re-read only when their size or time changed. */
const cache = new Map<string, { mtimeMs: number; size: number; data: Participant }>()
/** The largest op time seen: the hybrid clock's floor. */
let maxT = 0
let liveOthers = 0
let syncTimer: Timer | null = null
let syncTicks = 0
let isSyncing = false
let hideTimerFor: string | null = null
let mirrorBlocked = false
let mirrorClaim = false
let mirrorTimer: Timer | null = null
let initPending = false
/** Set once this session's nudge is decided; cleared when the session has an open route again, leaves or clears its route, or changes id. */
let nudgeSpent = false
/** Set by an eligible spawn; the next main-conversation Agent result carries the nudge. */
let nudgePending = false
/** Set once the load-order toast has been raised for this load. */
let orderWarned = false
/** The running `/charter demo`: counted in its own ticks, so it is deterministic. */
type Demo = { ticks: number; startedAt: number; timer: Timer }
let demo: Demo | null = null

type Out = { text: string } | { error: string }

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const idOf = (v: unknown): string | null => {
  const s = String(v ?? '').trim()

  return s === '' ? null : s
}

/** An error text as a command answers it: the prefix removed, the first letter a capital. */
function plain(error: string): string {
  const s = error.startsWith(ERR) ? error.slice(ERR.length) : error

  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---- where the routes live ------------------------------------------------------------------------------

const slash = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Finds the project root and the folder this project's routes live in. */
async function ensureBase($: EngineInterface): Promise<void> {
  if (chartsRoot !== null) return
  let root = ''
  try {
    root = await $.session.root()
  } catch {
    root = ''
  }
  let config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config === undefined || config === '') {
    // USERPROFILE first: it is only set on Windows, where HOME may be a Git Bash path (`/c/Users/x`) the host cannot resolve.
    const profile = await $.env.get('USERPROFILE')
    if (profile !== undefined && profile !== '') config = profile + '/.claude'
    else {
      const home = await $.env.get('HOME')
      config = home !== undefined && home !== '' ? home + '/.claude' : undefined
    }
  }
  projectRoot = root
  if (config !== undefined) {
    chartsRoot = `${slash(config)}/claudecharter/${slugOf(root)}`

    return
  }
  const fallback = `${slash(root)}/.claude/charter`
  chartsRoot = fallback
  try {
    if (!(await $.fs.exists(`${fallback}/.gitignore`))) await $.fs.write(`${fallback}/.gitignore`, '*\n')
  } catch {
    // The fallback folder cannot be written: routes stay in memory.
  }
}

const dirOf = (chartId: string): string => `${chartsRoot ?? ''}/${chartId}`
const fileOf = (chartId: string, sessionId: string): string => `${dirOf(chartId)}/${sessionId}.json`

/** The participant files of a route, re-reading only what changed. A file that fails to parse keeps its last good copy. */
async function readChart($: EngineInterface, chartId: string): Promise<Participant[]> {
  const dir = dirOf(chartId)
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const out: Participant[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const path = `${dir}/${entry.name}`
    const hit = cache.get(path)
    if (hit !== undefined && hit.mtimeMs === entry.mtimeMs && hit.size === entry.size) {
      out.push(hit.data)
      continue
    }
    try {
      const data = normalizeParticipant(JSON.parse(await $.fs.read(path)))
      if (data === null) throw new Error('not a participant')
      cache.set(path, { mtimeMs: entry.mtimeMs, size: entry.size, data })
      out.push(data)
    } catch {
      if (hit !== undefined) out.push(hit.data)
    }
  }

  return out
}

/** A queue that runs one job at a time, in order, whatever each job does. */
function queue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()

  return <T,>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job)
    tail = run.then(
      () => undefined,
      () => undefined,
    )

    return run
  }
}

/** Serializes the changes of this session's own file, so two calls at once (parallel tool calls, a heartbeat) never lose an op. */
let inMine = queue()
/** Serializes the merges, so an older reading never lands over a newer one. */
let inRefresh = queue()

/** Writes this session's own file (and the atom): the only file this session ever writes in a route's folder. */
async function putMine($: EngineInterface, p: Participant): Promise<void> {
  await update($, mineAtom, () => p)
  const path = fileOf(p.chartId, p.sessionId)
  try {
    await $.fs.write(path, JSON.stringify(p))
  } catch {
    // The folder cannot be written: the route lives in memory for this session.
  }
  cache.set(path, { mtimeMs: -1, size: -1, data: p })
}

/**
 * Changes this session's participant file from its latest content: `change` gets what the atom holds now and answers
 * the new content (or the same object, or null, for no write). Resolves what was kept.
 */
function mutateMine(
  $: EngineInterface,
  change: (cur: Participant | null) => Participant | null,
): Promise<Participant | null> {
  return inMine(async () => {
    const cur = await read($, mineAtom)
    const next = change(cur)
    if (next === null || next === cur) return cur
    await putMine($, next)

    return next
  })
}

async function currentId($: EngineInterface): Promise<string> {
  return (await read($, sessionAtom)).id ?? (await $.session.id())
}

function stopSync(): void {
  syncTimer?.cancel()
  syncTimer = null
}

/** Starts the poll/heartbeat timer when the session is on a route. */
async function ensureSync($: EngineInterface): Promise<void> {
  if (syncTimer !== null) return
  const me = await read($, mineAtom)
  if (me === null || me.detached || syncTimer !== null) return
  syncTimer = $.clock.every(POLL_MS, () => void syncTick($))
}

async function syncTick($: EngineInterface): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const me = await read($, mineAtom)
    if (me === null || me.detached) {
      stopSync()

      return
    }
    syncTicks += 1
    if (syncTicks % (HEARTBEAT_MS / POLL_MS) === 0) {
      const seen = await $.clock.now()
      await mutateMine($, cur => (cur === null || cur.detached ? cur : { ...cur, seenAt: seen }))
    }
    if (liveOthers > 0 || syncTicks % POLL_IDLE_EVERY === 0) await refresh($)
  } catch {
    // A failed poll is tried again on the next tick.
  } finally {
    isSyncing = false
  }
}

/** Merges every file of the route and brings the atoms up to date. */
function refresh($: EngineInterface): Promise<void> {
  return inRefresh(() => merge($))
}

async function merge($: EngineInterface): Promise<void> {
  const me = await read($, mineAtom)
  if (me === null || me.detached) return
  await ensureBase($)
  const now = await $.clock.now()
  const files = (await readChart($, me.chartId)).filter(p => p.sessionId !== me.sessionId)
  files.push(me)
  const m = mergeChart(files, me.sessionId, now)
  maxT = Math.max(maxT, m.maxT)
  liveOthers = m.liveOthers
  if (m.isSuperseded) {
    const taker = files.find(f => f.takes.some(k => k.sessionId === me.sessionId))
    $.ui.toast(
      `Claude-Charter: session ${labelOf(taker?.sessionId ?? '')} took over the route "${m.chart?.title ?? ''}"; this session no longer shows it.`,
    )
    await mutateMine($, cur => (cur === null ? cur : { ...cur, detached: true, claims: [] }))
    await update($, chartAtom, () => null)
    await update($, shareAtom, () => null)
    stopSync()

    return
  }
  // An open route re-arms the nudge: it comes back once the session has none, or only a finished one.
  if (m.chart !== null && m.chart.finishedAt === null) nudgeSpent = false
  const before = await read($, chartAtom)
  const changed = !same(before, m.chart)
  if (changed) await update($, chartAtom, () => m.chart)
  // Written only when changed, so a repeated reading does not redraw.
  if (!same(await read($, shareAtom), m.share)) await update($, shareAtom, () => m.share)
  const finishedAt = m.chart?.finishedAt ?? null
  if (finishedAt !== null && hideTimerFor !== me.chartId && now - finishedAt < COMPLETE_SHOW_MS) {
    hideTimerFor = me.chartId
    $.clock.after(COMPLETE_SHOW_MS - (now - finishedAt) + 100, () => $.ui.invalidate('ui.render'))
  }
  if (changed) scheduleMirror($)
}

/** Appends an op to this session's log. Returns an error text or null. */
async function recordOp(
  $: EngineInterface,
  input: OpInput,
  current: string | null,
  claims: Claim[],
  now: number,
): Promise<string | null> {
  const failure: { text: string | null } = { text: null }
  await mutateMine($, cur => {
    if (cur === null || cur.detached) {
      failure.text = ERR + 'this session is not on a route.'

      return cur
    }
    if (cur.ops.length >= MAX_OPS) {
      failure.text = ERR + "this route's log is full; declare a new route."

      return cur
    }
    const op = { t: nextT(now, maxT), n: (cur.ops.at(-1)?.n ?? 0) + 1, input }
    maxT = op.t

    return { ...cur, ops: [...cur.ops, op], current, claims, seenAt: now }
  })
  if (failure.text !== null) return failure.text
  await refresh($)

  return null
}

/** A change without an op (current step, claims, flags). */
async function setMine($: EngineInterface, change: Partial<Participant>): Promise<void> {
  const seen = await $.clock.now()
  await mutateMine($, cur => (cur === null ? cur : { ...cur, ...change, seenAt: seen }))
  await refresh($)
}

/** The session's own file in a project route folder, if this session has joined one: the newest that is not detached. */
async function findMine($: EngineInterface, id: string): Promise<Participant | null> {
  await ensureBase($)
  let dirs: string[] = []
  try {
    dirs = (await $.fs.list(chartsRoot ?? '')).filter(e => e.kind === 'dir').map(e => e.name)
  } catch {
    return null
  }
  let best: Participant | null = null
  for (const dir of dirs) {
    try {
      const path = fileOf(dir, id)
      if (!(await $.fs.exists(path))) continue
      const p = normalizeParticipant(JSON.parse(await $.fs.read(path)))
      if (p === null || p.detached) continue
      if (best === null || p.seenAt > best.seenAt) best = p
    } catch {
      // A broken file is skipped.
    }
  }

  return best
}

/** The other routes of this project, newest first; writes the `charts` atom. */
async function listCharts($: EngineInterface): Promise<ChartSummary[]> {
  await ensureBase($)
  const id = await currentId($)
  const now = await $.clock.now()
  const me = await read($, mineAtom)
  let dirs: string[] = []
  try {
    dirs = (await $.fs.list(chartsRoot ?? '')).filter(e => e.kind === 'dir').map(e => e.name)
  } catch {
    dirs = []
  }
  const found: ChartSummary[] = []
  for (const dir of dirs) {
    const m = mergeChart(await readChart($, dir), id, now)
    if (m.chart === null || m.isDiscarded || m.updatedAt < now - RETAIN_MS) continue
    if (me !== null && !me.detached && me.chartId === dir) continue
    found.push(chartSummary(dir, m, now))
  }
  const listed = found.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CHARTS_LISTED)
  // Written only when changed, so a repeated reading does not redraw.
  if (!same(await read($, chartsAtom), listed)) await update($, chartsAtom, () => listed)

  return listed
}

// ---- session scope --------------------------------------------------------------------------------------

/**
 * Makes the atoms follow the session id. The same id: nothing. A /clear carried the route: the new id joins it with a
 * take of the old id. Any other change of id: the route that id has (or none).
 */
async function ensureSession($: EngineInterface): Promise<void> {
  await ensureBase($)
  const id = await $.session.id()
  const s = await read($, sessionAtom)
  if (s.id === id) {
    await ensureSync($)

    return
  }
  const now = await $.clock.now()
  const old = await read($, mineAtom)
  if (s.carry && s.id !== null && old !== null && !old.detached) {
    const next: Participant = {
      ...newParticipant(old.chartId, id, now),
      takes: [{ sessionId: s.id, t: nextT(now, maxT) }],
      current: old.current,
      claims: old.claims,
    }
    await update($, sessionAtom, () => ({ id, carry: false }))
    nudgeSpent = false
    nudgePending = false
    await mutateMine($, () => next)
    await refresh($)
    await ensureSync($)

    return
  }
  await update($, sessionAtom, () => ({ id, carry: false }))
  stopSync()
  await update($, crewAtom, () => ({}))
  await update($, checksAtom, () => ({}))
  await update($, logAtom, () => [])
  anim = createAnim()
  mirrorBlocked = false
  mirrorClaim = false
  initPending = false
  nudgeSpent = false
  nudgePending = false
  const found = await findMine($, id)
  if (found !== null) {
    await mutateMine($, () => ({ ...found, endedAt: null, seenAt: now }))
    await refresh($)
    await ensureSync($)
  } else {
    await update($, mineAtom, () => null)
    await update($, chartAtom, () => null)
    await update($, shareAtom, () => null)
  }
}

// ---- signals --------------------------------------------------------------------------------------------

async function pushSignal($: EngineInterface, sig: Omit<Signal, 'seq'>): Promise<void> {
  await update($, logAtom, old => [...old, { ...sig, seq: (old.at(-1)?.seq ?? 0) + 1 }].slice(-LOG_KEPT))
}

const currentOf = async ($: EngineInterface): Promise<string | null> => (await read($, chartAtom))?.current ?? null

// ---- the actions ------------------------------------------------------------------------------------------

function heldError(label: string, node: string, target: string, unclaimed: string[]): string {
  return `${ERR}${target} is held by session ${label} (it holds ${node}). Work on a part this session holds or an unclaimed one: ${unclaimed.length > 0 ? unclaimed.join(', ') : 'none'}.`
}

/** One action of the progress tool (or a person's command, or a signal): the model, `/charter` and the commit signal share it. */
async function runAction($: EngineInterface, input: ProgressInput, opts: { isPerson: boolean }): Promise<Out> {
  await ensureSession($)
  const now = await $.clock.now()
  await refresh($)
  const c = await read($, chartAtom)
  const sh = await read($, shareAtom)
  let me = await read($, mineAtom)
  const action = String(input.action ?? '')
  if (action === 'get') return { text: routeText(c, sh, now) }

  if (action === 'plan') {
    if (me === null || me.detached) {
      const sessionId = await currentId($)
      await mutateMine($, () => newParticipant(newChartId(now, sessionId), sessionId, now))
      maxT = 0
      await ensureSync($)
      me = await read($, mineAtom)
    } else if (!opts.isPerson && sh !== null && sh.peers.some(p => p.isLive)) {
      const labels = sh.peers.filter(p => p.isLive).map(p => p.label)

      return {
        error: `${ERR}this route is shared with session ${labels.join(', ')}; extend it with add instead of declaring a new one.`,
      }
    }
  }

  if (action === 'claim' || action === 'release') {
    const id = idOf(input.id)
    if (id === null) return { error: `${ERR}${action} needs an id.` }
    if (c === null || me === null) return { error: NO_ROUTE_ERROR }
    if (findItem(c, id) === null) return { error: unknownIdError(c, id) }
    if (action === 'claim') {
      const holder = opts.isPerson ? null : holderOf(c, sh, id, me.sessionId)
      if (holder !== null) return { error: heldError(holder.label, holder.node, id, sh?.unclaimed ?? []) }
      await setMine($, { claims: addClaim(me.claims, id, now, opts.isPerson, c) })
    } else {
      if (!me.claims.some(k => k.id === id)) return { error: `${ERR}this session holds no claim on ${id}.` }
      await setMine($, { claims: dropClaim(me.claims, id) })
    }

    return { text: routeText(await read($, chartAtom), await read($, shareAtom), now) }
  }

  // The part the action touches, for the claim check.
  let target: string | null = null
  if (action === 'start' || action === 'block' || action === 'reset' || action === 'commit') target = idOf(input.id)
  else if (action === 'done' || action === 'skip') target = idOf(input.id) ?? c?.current ?? null
  else if (action === 'add') target = idOf(input.parent)
  if (!opts.isPerson && target !== null && c !== null && me !== null) {
    const holder = holderOf(c, sh, target, me.sessionId)
    if (holder !== null) return { error: heldError(holder.label, holder.node, target, sh?.unclaimed ?? []) }
  }

  const r = applyAction(c, input, now)
  if (r.error !== undefined) return { error: r.error }
  if (action === 'commit' && r.chart === c) return { text: routeText(c, sh, now) }
  if (me === null || me.detached) return { error: NO_ROUTE_ERROR }

  const opInput: Record<string, unknown> = { action }
  for (const key of ['title', 'items', 'parent', 'phase', 'commit', 'note'] as const) {
    if (input[key] !== undefined) opInput[key] = input[key]
  }
  const explicit = r.target ?? idOf(input.id)
  if (explicit !== null) opInput.id = explicit
  let claims = me.claims
  if (action === 'start') {
    const t = autoClaimTarget(c, sh, r.target, me.sessionId)
    if (t !== null) claims = addClaim(claims, t, now, false, r.chart)
  }
  const err = await recordOp($, opInput as OpInput, r.chart?.current ?? null, claims, now)
  if (err !== null) return { error: err }

  if (settings.toast) {
    if (r.events.some(e => e.kind === 'finished')) {
      const done = r.events.find(e => e.kind === 'finished')
      $.ui.toast(`Claude-Charter: "${done?.title ?? ''}" complete (${done?.pos ?? 0}/${done?.count ?? 0})`)
    } else {
      for (const e of r.events) {
        if (e.kind === 'stage-done') $.ui.toast(`Claude-Charter: stage ${e.pos}/${e.count} "${e.title}" done`)
      }
    }
  }
  // Panel only: nothing else says a route exists, so say it once (the /charter init flow opens the pane itself).
  if (settings.placement === 'panel' && settings.toast && action === 'plan' && c === null && !initPending) {
    $.ui.toast(`Claude-Charter: charted "${r.chart?.title ?? ''}"; /charter shows the route.`)
  }
  if (initPending && action === 'plan' && !opts.isPerson) {
    initPending = false
    void $.ui.open({ id: PANE, title: 'Claude-Charter' })
  }

  return { text: routeText(await read($, chartAtom), await read($, shareAtom), now) }
}

// ---- leaving, joining, adopting ------------------------------------------------------------------------

async function detachMine($: EngineInterface, discard: boolean): Promise<void> {
  const me = await read($, mineAtom)
  if (me === null || me.detached) return
  const now = await $.clock.now()
  await mutateMine($, cur => (cur === null ? cur : { ...cur, detached: true, discarded: discard || cur.discarded, claims: [], seenAt: now }))
  await update($, chartAtom, () => null)
  await update($, shareAtom, () => null)
  stopSync()
  nudgeSpent = false
}

async function leaveChart($: EngineInterface): Promise<string> {
  const me = await read($, mineAtom)
  if (me === null || me.detached) return 'This session is not on a route.'
  const title = (await read($, chartAtom))?.title ?? ''
  await detachMine($, false)

  return `Left the route "${title}".`
}

async function clearRoute($: EngineInterface): Promise<string> {
  const me = await read($, mineAtom)
  if (me === null || me.detached) return 'There is no route to clear.'
  const sh = await read($, shareAtom)
  const live = (sh?.peers ?? []).filter(p => p.isLive)
  if (live.length > 0) {
    const title = (await read($, chartAtom))?.title ?? ''
    await detachMine($, false)

    return `Left the shared route "${title}"; session ${live.map(p => p.label).join(', ')} still work on it.`
  }
  await detachMine($, true)

  return 'Cleared the route of this session.'
}

async function attach($: EngineInterface, chartId: string, isAdopt: boolean): Promise<string> {
  const me = await read($, mineAtom)
  if (me !== null && !me.detached && me.chartId === chartId) return 'This session is already on that route.'
  if (me !== null && !me.detached) await detachMine($, false)
  await ensureBase($)
  const sessionId = await currentId($)
  const now = await $.clock.now()
  const files = await readChart($, chartId)
  const merged = mergeChart(files, sessionId, now)
  const taken = isAdopt ? merged.members.filter(p => p.sessionId !== sessionId) : []
  const prior = files.find(p => p.sessionId === sessionId)
  const base = prior ?? newParticipant(chartId, sessionId, now)
  const file: Participant = {
    ...base,
    detached: false,
    discarded: false,
    endedAt: null,
    joinedAt: now,
    seenAt: now,
    claims: [],
    takes: [...base.takes, ...taken.map(p => ({ sessionId: p.sessionId, t: nextT(now, merged.maxT) }))],
  }
  maxT = Math.max(maxT, merged.maxT)
  await mutateMine($, () => file)
  anim = createAnim()
  resetPane()
  await refresh($)
  await ensureSync($)
  await listCharts($)
  const title = (await read($, chartAtom))?.title ?? merged.chart?.title ?? ''
  if (isAdopt) {
    return taken.length > 0
      ? `Adopted "${title}"; session ${taken.map(p => labelOf(p.sessionId)).join(', ')} no longer show it.`
      : `Adopted "${title}".`
  }
  const others = merged.members.filter(p => p.sessionId !== sessionId && p.endedAt === null && now - p.seenAt < LIVE_MS)
  if (others.length === 0) return `Joined "${title}".`

  return `Joined "${title}" with session ${others.map(p => labelOf(p.sessionId)).join(', ')}. Claude claims a part when it starts one, or claim one with /charter claim <id>.`
}

const joinChart = ($: EngineInterface, chartId: string): Promise<string> => attach($, chartId, false)
const adoptChart = ($: EngineInterface, chartId: string): Promise<string> => attach($, chartId, true)

// ---- the mirror ------------------------------------------------------------------------------------------

function scheduleMirror($: EngineInterface): void {
  if (!settings.mirror) return
  mirrorTimer?.cancel()
  mirrorTimer = $.clock.after(MIRROR_DELAY_MS, () => void writeMirror($))
}

async function writeMirror($: EngineInterface): Promise<void> {
  try {
    if (!settings.mirror) return
    await ensureSession($)
    const me = await read($, mineAtom)
    if (me === null || me.detached) return
    const now = await $.clock.now()
    const files = (await readChart($, me.chartId)).filter(p => p.sessionId !== me.sessionId)
    files.push(me)
    const m = mergeChart(files, me.sessionId, now)
    if (m.chart === null) return
    if (!mirrorClaim && !isWriter(m, me.sessionId, now)) return
    const root = (projectRoot ?? '').replace(/[\\/]+$/, '')
    const path = root === '' ? settings.mirrorFile : root + '/' + settings.mirrorFile
    const text = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : null
    const owner = text === null ? null : mirrorOwner(text)
    let otherActive = false
    if (owner !== null && owner !== me.chartId) {
      const other = mergeChart(await readChart($, owner), me.sessionId, now)
      otherActive =
        other.members.some(p => p.endedAt === null && now - p.seenAt < LIVE_MS) &&
        !other.isDiscarded &&
        other.chart?.finishedAt == null
    }
    const verdict = mirrorClaim ? 'write' : mayWrite(text, me.chartId, otherActive)
    if (verdict === 'write') {
      await $.fs.write(path, renderMirror(m.chart, me.chartId, m.share, now, -new Date(now).getTimezoneOffset()))
      mirrorBlocked = false
      mirrorClaim = false
    } else if (!mirrorBlocked) {
      mirrorBlocked = true
      if (verdict === 'foreign') {
        $.ui.toast(`Claude-Charter: ${settings.mirrorFile} exists and was not written by claudecharter; the mirror leaves it alone.`)
      } else {
        $.ui.toast(`Claude-Charter: ${settings.mirrorFile} mirrors another route; /charter mirror claim takes it over.`)
      }
    }
  } catch {
    // The mirror is best effort: a failure does nothing.
  }
}

// ---- the demo ----------------------------------------------------------------------------------------------

/** Starts (or restarts) the demo; the row and an open pane follow it through the invalidations of its ticks. */
async function startDemo($: EngineInterface): Promise<void> {
  demo?.timer.cancel()
  const startedAt = await $.clock.now()
  demo = { ticks: 0, startedAt, timer: $.clock.every(DEMO_TICK_MS, () => onDemoTick($)) }
  anim = createAnim()
  resetPane()
  stopTimer()
  band = null
  $.ui.invalidate('ui.render')
}

function endDemo($: EngineInterface): void {
  if (demo === null) return
  demo.timer.cancel()
  demo = null
  anim = createAnim()
  resetPane()
  stopTimer()
  band = null
  $.ui.invalidate('ui.render')
}

function onDemoTick($: EngineInterface): void {
  if (demo === null) return
  demo.ticks += 1
  const ms = demo.ticks * DEMO_TICK_MS
  if (ms >= DEMO_END_MS) {
    endDemo($)

    return
  }
  if (isDemoChangeAt(ms)) $.ui.invalidate('ui.render')
}

// ---- painting ------------------------------------------------------------------------------------------------

function stopTimer(): void {
  timer?.cancel()
  timer = null
}

/** True while there is a band to repaint and something to move in it. */
function needsTimer(): boolean {
  if (band === null || scene === null || isStaticFallback || !anyEffect(settings.effects)) return false
  const busy = settings.effects.activity && (scene.agents.length + scene.checks.length > 0 || scene.isWorking)

  return !isSettled(anim) || busy
}

function kick($: EngineInterface): void {
  if (timer === null && needsTimer()) timer = $.clock.every(FRAME_MS, () => void step($))
}

/** One frame: the animation advances and the Raster is repainted in place. */
async function step($: EngineInterface): Promise<void> {
  if (isBlitting || band === null || scene === null) return
  isBlitting = true
  try {
    const target = band
    advance(anim, settings.effects)
    const cells = encodeCells(composeRow(scene, anim, settings, target.cols, false))
    if (cells === lastEncoded) {
      if (!needsTimer()) stopTimer()

      return
    }
    const r = await $.ui.blit({ requestId: target.requestId, key: RASTER_KEY, cells })
    if (r.deny === undefined) {
      everBlitted = true
      framesSinceMount += 1
      lastEncoded = cells
      if (!needsTimer()) stopTimer()
    } else if (framesSinceMount === 0 && !everBlitted) {
      // The first blit after a fresh draw was refused: this slot may not take blits. A fresh mount retries.
      refusedMounts += 1
      stopTimer()
      if (refusedMounts >= MAX_REFUSED_MOUNTS) {
        isStaticFallback = true
        band = null
      }
      $.ui.invalidate('ui.render')
    } else {
      // Refused after earlier successes (a dialog, a resize, the prompt hidden): a later render restarts the timer.
      stopTimer()
    }
  } finally {
    isBlitting = false
  }
}

// ---- painting the pane -------------------------------------------------------------------------------------

function stopPaneTimer(): void {
  paneTimer?.cancel()
  paneTimer = null
}

/** Forgets what the pane drew and where it moved: the next live draw starts clean (and primes silently). */
function resetPane(): void {
  stopPaneTimer()
  paneSite = null
  lastPaneBlit.clear()
  paneFramesSinceMount = 0
  paneAnim = createAnim()
  paneMotion = createPaneMotion()
}

/** True while Claude works or a subagent or a check runs (and the activity effect is on). */
function paneBusy(): boolean {
  return settings.effects.activity && (mainWorking || paneRunning > 0)
}

/** True while the pane has Rasters to repaint and something in it moves or runs. */
function needsPaneTimer(): boolean {
  return (
    paneSite !== null &&
    !isPaneStatic &&
    anyEffect(settings.effects) &&
    (!isSettled(paneAnim) || isPaneMoving(paneMotion) || paneBusy())
  )
}

function kickPane($: EngineInterface): void {
  if (paneTimer === null && needsPaneTimer()) paneTimer = $.clock.every(FRAME_MS, () => void paneStep($))
}

/** One frame of the pane: its animation advances and each piece that changed is repainted in place. */
async function paneStep($: EngineInterface): Promise<void> {
  if (paneBlitting || paneSite === null) return
  paneBlitting = true
  try {
    const target = paneSite
    advance(paneAnim, settings.effects)
    advancePane(paneMotion, paneAnim.tick)
    for (const piece of target.pieces) {
      const cells = piece.compose()
      if (cells.length !== piece.width) {
        // A piece changed its width: only a redraw can resize a Raster.
        stopPaneTimer()
        $.ui.invalidate('ui.render')

        return
      }
      const encoded = encodeCells(cells)
      if (encoded === lastPaneBlit.get(piece.key)) continue
      const r = await $.ui.blit({ requestId: target.requestId, key: piece.key, cells: encoded })
      if (r.deny === undefined) {
        paneEverBlitted = true
        paneFramesSinceMount += 1
        lastPaneBlit.set(piece.key, encoded)
      } else if (paneFramesSinceMount === 0 && !paneEverBlitted) {
        // The first blit after a fresh draw was refused: this pane may not take blits. A fresh mount retries.
        paneRefusedMounts += 1
        stopPaneTimer()
        if (paneRefusedMounts >= MAX_REFUSED_MOUNTS) {
          isPaneStatic = true
          paneSite = null
        }
        $.ui.invalidate('ui.render')

        return
      } else {
        // Refused after earlier successes (another tab, a resize): a later render restarts the timer.
        stopPaneTimer()

        return
      }
      if (paneSite !== target) return
    }
    if (!needsPaneTimer()) stopPaneTimer()
  } finally {
    paneBlitting = false
  }
}

/** The rows of a column another mod stacked under the hint, the hint first; else the hint alone. */
function stacked(drawn: RenderElement): RenderNode[] {
  if (drawn.type === 'Box' && drawn.props?.flexDirection === 'column' && drawn.children?.length) {
    return [...drawn.children]
  }

  return [drawn]
}

// ---- the pane --------------------------------------------------------------------------------------------------

/** Opens the route chart as /charter does: the project's routes listed first, the pane focused. */
async function openPane($: EngineInterface): Promise<void> {
  await listCharts($)
  await $.ui.open({ id: PANE, title: 'Claude-Charter', focus: true, closeOnEscape: true })
}

const SESSION_COLOR = '#afafd7'

function glyphOf(kind: Signal['kind'], ok: boolean | null): { glyph: string; color: string | undefined } {
  if (kind === 'agent') return { glyph: '◐', color: SESSION_COLOR }
  if (kind === 'commit') return { glyph: '◈', color: '#fff5d7' }
  if (ok === null) return { glyph: '⠿', color: undefined }

  return ok ? { glyph: '✓', color: '#5fff00' } : { glyph: '✗', color: '#ff0000' }
}

// ---- the route row, shared by the two slots ------------------------------------------------------------

/**
 * What the row shows right now: a running demo, else the atoms (which subscribes the calling render). Null when there
 * is no route to show (none, or a finished one past its time on the row). Does not touch the module `scene`.
 */
async function sceneNow($: EngineInterface, isWorking: boolean): Promise<Scene | null> {
  const [chartNow, shareNow, , crew, checks, log] = await Promise.all([
    read($, chartAtom),
    read($, shareAtom),
    read($, mineAtom),
    read($, crewAtom),
    read($, checksAtom),
    read($, logAtom),
  ])
  const now = await $.clock.now()
  await ensureSync($)

  let chart: Chart | null
  let share: Scene['share']
  let agents: CrewMember[]
  let running: CheckRun[]
  let lastCheck: CheckRun | null
  let commit: Scene['commit']
  if (demo !== null) {
    const d = demoAt(demo.ticks * DEMO_TICK_MS, demo.startedAt)
    chart = d.chart
    share = d.share
    agents = d.agents
    running = d.checks
    lastCheck = d.lastCheck
    commit = d.commit
  } else {
    chart = chartNow
    share = shareNow !== null && shareNow.peers.length > 0 ? shareNow : null
    agents = Object.values(crew)
      .filter(a => a.endedAt === null)
      .sort((a, b) => a.startedAt - b.startedAt)
    running = Object.values(checks)
      .filter(c => c.endedAt === null && !c.isBackground)
      .sort((a, b) => a.startedAt - b.startedAt)
    lastCheck =
      Object.values(checks)
        .filter(c => c.endedAt !== null && !c.isBackground && c.endedAt >= now - CHECK_SHOW_MS)
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0] ?? null
    const last = [...log].reverse().find(s => s.kind === 'commit')
    commit = last === undefined ? null : { seq: last.seq, hash: last.text }
  }
  const isExpired = demo === null && chart !== null && chart.finishedAt !== null && now - chart.finishedAt >= COMPLETE_SHOW_MS
  if (chart === null || isExpired) return null

  return { chart, share, agents, checks: running, lastCheck, commit, isWorking }
}

/** The still row: colored Text runs. The frame timer stops and nothing is blitted. */
function stillRow(Text: ElementTable['Text'], cols: number): RenderElement {
  stopTimer()
  band = null
  const cells = scene === null ? [] : composeRow(scene, anim, settings, cols, true)

  return (
    <Text wrap="truncate-end">
      {runs(cells).map(r => (
        <Text color={hex(r.fg)} backgroundColor={hex(r.bg)}>
          {r.text}
        </Text>
      ))}
    </Text>
  )
}

/** The live row: a Raster the frame timer repaints in place (terminal only). */
function liveRow($: EngineInterface, Raster: ElementTable<'terminal'>['Raster'], requestId: string, cols: number): RenderElement {
  const cells = encodeCells(scene === null ? [] : composeRow(scene, anim, settings, cols, false))
  band = { requestId, cols }
  lastEncoded = cells
  framesSinceMount = 0
  kick($)

  return <Raster key={RASTER_KEY} columns={cols} rows={1} cells={cells} />
}

/**
 * The row with the open glyph at the slot's right end: the row, a flexible spacer, a one-cell gap, then a plain dim
 * Button. Under the prompt on the terminal a zero-height width probe comes first: it is absolute, from the row's left
 * edge to the cells the glyph takes, so its region is exactly the cells the row may take, and it takes no room in the
 * flow. The Box has no key, margin, padding or gap (a keyed Box is a hover scope). The hotkey is given only in the
 * band, the one focus site.
 */
function withOpen(
  $: EngineInterface,
  t: {
    Box: ElementTable['Box']
    Text: ElementTable['Text']
    Button: ElementTable['Button']
  },
  row: RenderElement,
  probe: { requestId: string; Client: ElementTable<'terminal'>['Client'] } | null,
): RenderElement {
  const { Box, Text, Button } = t
  const press = (): void => {
    void openPane($)
  }
  const Client = probe?.Client

  return (
    <Box flexDirection="row">
      {probe === null || Client === undefined ? null : (
        <Box position="absolute" top={0} left={0} right={openCells(settings.placement)}>
          <Client
            key={PROBE_KEY}
            module="./probe.ts"
            width="100%"
            props={{ ask: slotCols.get(probe.requestId) === undefined }}
          />
        </Box>
      )}
      {row}
      <Box flexGrow={1} />
      <Text> </Text>
      {settings.placement === 'above' ? (
        <Button key={OPEN_KEY} label={OPEN_GLYPH} plain dimColor hotkey={OPEN_HOTKEY} onPress={press} />
      ) : (
        <Button key={OPEN_KEY} label={OPEN_GLYPH} plain dimColor onPress={press} />
      )}
    </Box>
  )
}

/** False for anything that draws nothing: no node, an empty string, a Box or Text without children. */
function hasContent(n: RenderNode): boolean {
  if (n === null || n === undefined || (n as unknown) === false || n === '') return false
  if (typeof n === 'string') return true
  if (n.type === 'Box' || n.type === 'Text') return (n.children?.length ?? 0) > 0

  return true
}

export const register: Register = (on, options) => {
  settings = normalizeSettings(options)

  // A fresh load starts from a clean state.
  stopTimer()
  stopSync()
  mirrorTimer?.cancel()
  mirrorTimer = null
  demo?.timer.cancel()
  demo = null
  isBlitting = false
  band = null
  slotCols.clear()
  scene = null
  anim = createAnim()
  framesSinceMount = 0
  refusedMounts = 0
  everBlitted = false
  isStaticFallback = false
  lastEncoded = ''
  resetPane()
  paneRefusedMounts = 0
  paneEverBlitted = false
  isPaneStatic = false
  mainWorking = false
  paneRunning = 0
  chartsRoot = null
  projectRoot = null
  cache.clear()
  maxT = 0
  liveOthers = 0
  syncTicks = 0
  isSyncing = false
  hideTimerFor = null
  mirrorBlocked = false
  mirrorClaim = false
  initPending = false
  nudgeSpent = false
  nudgePending = false
  orderWarned = false
  inMine = queue()
  inRefresh = queue()

  on('session.start', async ($, e, next) => {
    endDemo($)
    stopTimer()
    stopSync()
    anim = createAnim()
    resetPane()
    mainWorking = false
    band = null
    scene = null
    cache.clear()
    maxT = 0
    liveOthers = 0
    chartsRoot = null
    projectRoot = null
    hideTimerFor = null
    nudgeSpent = false
    nudgePending = false
    await $.tool.register({ name: 'progress', description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    await $.command.register({
      name: 'charter',
      description: 'Open the route chart, correct a step, share or take over a route, or rebuild it',
      argumentHint:
        '[init | clear | done|start|skip|reset|claim|release <id> | adopt|join [n] | leave | mirror claim | demo | demo pane | demo stop]',
    })
    await update($, sessionAtom, () => ({ id: null, carry: false }))
    await ensureSession($)
    // A settings change reloads the plugin and raises this again: redraw both row slots and the pane at once.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      const me = await read($, mineAtom)
      const now = await $.clock.now()
      if (e.reason === 'clear') {
        endDemo($)
        if (me !== null && !me.detached) await mutateMine($, cur => (cur === null ? cur : { ...cur, endedAt: now, seenAt: now }))
        await update($, sessionAtom, s => ({ ...s, carry: true }))
        await update($, crewAtom, () => ({}))
        await update($, checksAtom, () => ({}))
        await update($, logAtom, () => [])
        stopSync()
      } else if (me !== null && !me.detached) {
        await mutateMine($, cur => (cur === null ? cur : { ...cur, endedAt: now, seenAt: now }))
        stopSync()
      }
    } catch {
      // Ending is best effort.
    }

    return next(e)
  })

  // The progress tool, and the signals seen on Bash and PowerShell calls. Every other tool passes through untouched.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === TOOL) {
      const input = e as unknown as ProgressInput
      const agentId = (e as unknown as { agentId?: string }).agentId
      if (agentId !== undefined && input.action !== 'get') {
        return { result: 'claudecharter: the route is kept by the main conversation; this call from a subagent changed nothing.' }
      }
      if (!PUBLIC_ACTIONS.includes(String(input.action))) {
        return { deny: 'claudecharter: action must be one of plan, add, start, done, skip, block, get, claim, release.' }
      }
      const out = await runAction($, input, { isPerson: false })
      await ensureSync($)
      if ('error' in out) return { deny: out.error }

      return { result: out.text }
    }
    if (tool === AGENT_TOOL) {
      const ran = await next(e)
      try {
        // Nothing after next may throw: the registration's catch would run next again.
        const callerId = (e as unknown as { agentId?: string }).agentId
        if (!nudgePending || callerId !== undefined) return ran
        nudgePending = false
        if (ran.deny !== undefined) {
          nudgeSpent = false

          return ran
        }
        const open = await read($, chartAtom)
        if (open !== null && open.finishedAt === null) return ran

        return { ...ran, context: [...(ran.context ?? []), NUDGE_TEXT] } as typeof ran
      } catch {
        return ran
      }
    }
    if (tool !== 'Bash' && tool !== 'PowerShell') return next(e)

    const raw = e as unknown as { command?: unknown; run_in_background?: unknown; tool_use_id: string }
    const command = String(raw.command ?? '')
    const isBg = raw.run_in_background === true
    const label = checkLabel(command)
    const toolUseId = raw.tool_use_id
    let startedAt = 0
    if (label !== null && !isBg) {
      try {
        startedAt = await $.clock.now()
        await update($, checksAtom, old => {
          const kept = Object.values(old).filter(x => x.endedAt === null || startedAt - x.endedAt < 60_000)
          const fresh: Record<string, CheckRun> = {}
          for (const x of [...kept].slice(-(CHECKS_KEPT - 1))) fresh[x.id] = x
          fresh[toolUseId] = { id: toolUseId, label, startedAt, endedAt: null, ok: null, isBackground: false }

          return fresh
        })
      } catch {
        // Not seen as a check; the command goes on.
      }
    }
    const ran = await next(e)
    try {
      await ensureSession($)
      if (label !== null && !isBg) {
        if (ran.deny !== undefined) {
          await update($, checksAtom, old => {
            const { [toolUseId]: _gone, ...rest } = old

            return rest
          })
        } else {
          const end = await $.clock.now()
          const ok =
            ran.isError !== true && (ran.result as { interrupted?: unknown } | undefined)?.interrupted !== true
          await update($, checksAtom, old => {
            const x = old[toolUseId]

            return x === undefined ? old : { ...old, [toolUseId]: { ...x, endedAt: end, ok } }
          })
          await pushSignal($, {
            at: end,
            kind: 'check',
            text: label,
            detail: formatDuration(end - startedAt),
            ok,
            itemId: await currentOf($),
          })
          $.clock.after(CHECK_SHOW_MS + 100, () => $.ui.invalidate('ui.render'))
        }
      } else if (label !== null && isBg && ran.deny === undefined) {
        await pushSignal($, {
          at: await $.clock.now(),
          kind: 'check',
          text: label,
          detail: 'background',
          ok: null,
          itemId: await currentOf($),
        })
      }
      const info = gitCommitInfo(command, ran)
      if (info !== null) {
        const current = await currentOf($)
        await pushSignal($, {
          at: await $.clock.now(),
          kind: 'commit',
          text: info.hash,
          detail: info.message,
          ok: true,
          itemId: current,
        })
        const chart = await read($, chartAtom)
        const me = await read($, mineAtom)
        const item = chart !== null && current !== null ? findItem(chart, current) : null
        if (me !== null && !me.detached && current !== null && item !== null && item.item.commit !== info.hash) {
          await runAction($, { action: 'commit', id: current, commit: info.hash }, { isPerson: true })
        }
      }
      await ensureSync($)
    } catch {
      // Observing is best effort: the call's own result goes back unchanged.
    }

    return ran
  }).catch(($, e, next) =>
    String(e.tool) === TOOL ? { deny: 'claudecharter: the progress tool failed; the route is unchanged.' } : next(e),
  )

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.workflow || e.isTeammate || 'deny' in r || r.agentId === undefined) return r
      const agentId = r.agentId
      await ensureSession($)
      if (settings.nudge && !nudgeSpent && e.parentAgentId === undefined && e.resume === undefined) {
        const open = await read($, chartAtom)
        if (open === null || open.finishedAt !== null) {
          nudgeSpent = true
          nudgePending = true
        }
      }
      const now = await $.clock.now()
      if (e.resume) {
        const known = (await read($, crewAtom))[e.resume.agentId]
        if (known !== undefined) {
          const id = e.resume.agentId
          await update($, crewAtom, old => {
            const x = old[id]

            return x === undefined ? old : { ...old, [id]: { ...x, endedAt: null, word: null } }
          })

          return r
        }
      }
      const description = e.description || e.subagentType
      const member: CrewMember = {
        id: agentId,
        description,
        type: e.subagentType,
        model: r.model,
        startedAt: now,
        endedAt: null,
        word: null,
      }
      await update($, crewAtom, old => {
        const kept = Object.values(old)
          .filter(x => x.endedAt === null || now - x.endedAt < 600_000)
          .sort((a, b) => a.startedAt - b.startedAt)
          .slice(-(CREW_KEPT - 1))
        const fresh: Record<string, CrewMember> = {}
        for (const x of kept) fresh[x.id] = x
        fresh[member.id] = member

        return fresh
      })
      await pushSignal($, {
        at: now,
        kind: 'agent',
        text: description,
        detail: `${e.subagentType} · ${modelLabel(r.model)}`,
        ok: null,
        itemId: await currentOf($),
      })
    } catch {
      // Observing only: the spawn goes on as it was settled.
    }

    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    try {
      if (e.agentId === undefined) mainWorking = false
      await ensureSession($)
      const agentId = e.agentId
      if (agentId !== undefined) {
        const member = (await read($, crewAtom))[agentId]
        if (member !== undefined && member.endedAt === null) {
          const now = await $.clock.now()
          const word = wordForReason(String(e.reason))
          await update($, crewAtom, old => {
            const x = old[agentId]

            return x === undefined ? old : { ...old, [agentId]: { ...x, endedAt: now, word } }
          })
          await pushSignal($, {
            at: now,
            kind: 'agent-end',
            text: member.description,
            detail: `${word} · ${formatDuration(now - member.startedAt)}`,
            ok: word === 'done',
            itemId: await currentOf($),
          })
        }
      }
    } catch {
      // Observing only.
    }

    return res
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    try {
      if (e.agentId === undefined) {
        mainWorking = true
        kickPane($)
        await ensureSession($)
      } else {
        const agentId = e.agentId
        const member = (await read($, crewAtom))[agentId]
        if (member !== undefined && member.endedAt !== null) {
          await update($, crewAtom, old => {
            const x = old[agentId]

            return x === undefined ? old : { ...old, [agentId]: { ...x, endedAt: null, word: null } }
          })
        }
      }
    } catch {
      // Observing only.
    }

    return next(e)
  })

  // /charter: the pane, a person's corrections, sharing, the rebuild, the mirror claim and the demo.
  on('command.run', { command: 'charter' }, async ($, e) => {
    await ensureSession($)
    const args = e.args.trim()
    const words = args === '' ? [] : args.split(/\s+/)
    const sub = (words[0] ?? '').toLowerCase()
    const open = async (): Promise<void> => {
      await $.ui.open({ id: PANE, title: 'Claude-Charter', focus: true, closeOnEscape: true })
    }
    const fix = async (input: ProgressInput, ok: string): Promise<{ text: string }> => {
      const out = await runAction($, input, { isPerson: true })

      return { text: 'error' in out ? plain(out.error) : ok }
    }
    const idArg = words[1]

    if (args === '') {
      await openPane($)

      return { text: 'Opened the route chart.' }
    }
    if (sub === 'done' || sub === 'skip' || sub === 'reset' || sub === 'claim' || sub === 'release') {
      if (idArg === undefined) return { text: USAGE }
      const done: Record<string, string> = {
        done: `Marked ${idArg} done.`,
        skip: `Skipped ${idArg}.`,
        reset: `${idArg} is pending again.`,
        claim: `This session now holds ${idArg}.`,
        release: `Released ${idArg}.`,
      }

      return fix({ action: sub, id: idArg }, done[sub] ?? '')
    }
    if (sub === 'start') {
      if (idArg === undefined) return { text: USAGE }
      const phase = words.slice(2).join(' ')

      return fix(
        { action: 'start', id: idArg, phase: phase === '' ? undefined : phase },
        phase === '' ? `${idArg} is now current.` : `${idArg} is now current, phase ${phase}.`,
      )
    }
    if (sub === 'clear' && words.length === 1) return { text: await clearRoute($) }
    if (sub === 'leave' && words.length === 1) return { text: await leaveChart($) }
    if ((sub === 'join' || sub === 'adopt') && words.length <= 2) {
      const listed = await listCharts($)
      if (idArg === undefined) {
        await open()
        if (listed.length === 0) return { text: 'No other routes in this project.' }
        const now = await $.clock.now()
        const offsetMin = -new Date(now).getTimezoneOffset()
        const lines = listed.map(
          (c, i) =>
            `${i + 1}. ${c.title} · ${c.pct}% · ${c.live} live of ${c.members} · updated ${stamp(c.updatedAt, offsetMin)} · ${c.chartId}`,
        )
        lines.push('Run /charter join <n> to share one, or /charter adopt <n> to take it over.')

        return { text: lines.join('\n') }
      }
      const n = /^\d+$/.test(idArg) ? Number(idArg) : 0
      const chosen = n > 0 ? listed[n - 1] : listed.find(c => c.chartId === idArg)
      if (chosen === undefined) return { text: `No route ${idArg} in the list; run /charter join to list them.` }

      return { text: sub === 'join' ? await joinChart($, chosen.chartId) : await adoptChart($, chosen.chartId) }
    }
    if (sub === 'init' && words.length === 1) {
      const me = await read($, mineAtom)
      if (me !== null && !me.detached) {
        const title = (await read($, chartAtom))?.title ?? ''

        return {
          text: `This session already has a route ("${title}"). Run /charter clear first (or /charter leave for a shared one), then /charter init.`,
        }
      }
      // A submit from a command hook would wait on the turn the hook holds, so the request goes in the prompt box as a draft.
      const filled = await $.prompt.fill({ text: INIT_PROMPT, mode: 'replace' })
      if (!filled.isFilled) return { text: 'The prompt box could not take the request: run /charter init again with an empty prompt.' }
      initPending = true

      return { text: 'Rebuild request placed in the prompt box: press Enter to send it.' }
    }
    if (sub === 'mirror' && words[1]?.toLowerCase() === 'claim' && words.length === 2) {
      if (!settings.mirror) return { text: 'The mirror is off: turn on "PROGRESS.md mirror" in /config.' }
      const me = await read($, mineAtom)
      if (me === null || me.detached) return { text: 'This session is not on a route.' }
      mirrorClaim = true
      mirrorBlocked = false
      await writeMirror($)

      return { text: `This route now writes ${settings.mirrorFile}.` }
    }
    const effectsOff = anyEffect(settings.effects) ? '' : ' Every effect is off in /config, so the route moves without its effects.'
    const isDemoPlain = sub === 'demo' && words.length === 1
    const isDemoPane = sub === 'demo' && words[1]?.toLowerCase() === 'pane' && words.length === 2
    if ((isDemoPlain || isDemoPane) && settings.placement === 'panel') {
      // No row anywhere: the demo plays in the pane, which the person asked for.
      await startDemo($)
      await open()

      return {
        text: 'Playing the charter demo for 26 s in the route pane, with a made-up route and a made-up second session; the route row is off (Route placement: panel). /charter demo stop ends it.',
      }
    }
    const slot = settings.placement === 'above' ? 'above the prompt' : 'under the prompt'
    if (isDemoPlain) {
      // Row only: no pane is opened (an already open pane does switch to the demo route).
      await startDemo($)

      return {
        text:
          `Playing the charter demo for 26 s ${slot}, with a made-up route and a made-up second session. /charter demo pane also shows it in the route pane; /charter demo stop ends it.` +
          effectsOff,
      }
    }
    if (isDemoPane) {
      await startDemo($)
      await open()

      return {
        text:
          `Playing the charter demo for 26 s ${slot} and in the route pane, with a made-up route and a made-up second session. /charter demo stop ends it.` +
          effectsOff,
      }
    }
    if (sub === 'demo' && words[1]?.toLowerCase() === 'stop' && words.length === 2) {
      if (demo === null) return { text: 'No demo is running.' }
      endDemo($)

      return {
        text:
          settings.placement === 'panel'
            ? 'Stopped the demo: the pane shows your route again.'
            : 'Stopped the demo: the route row and pane show your route again.',
      }
    }

    return { text: USAGE }
  })

  // The route row: the first row of the hint slot under the prompt, right after the hint line (the way claudepeeker
  // inserts its line). A Raster repainted by the timer while something moves; a still row of colored Text on the desktop,
  // with effects off, or where blits are refused. It flattens what the hooks beneath it drew one level and keeps the hint first.
  // Placement `under` only: with another placement this hook passes through before it reads or starts anything.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (settings.placement !== 'under') return next(e)
    const s = await sceneNow($, e.props.isWorking)
    if (s === null) {
      stopTimer()
      band = null
      scene = null

      return next(e)
    }
    // The conversation's columns are narrower than the footer when a pane is docked, so on the terminal the row is sized
    // from the slot the width probe measured; until a measurement exists it falls back to the conversation's width.
    const reserve = openCells(settings.placement)
    const fallback = Math.min(512, (e.viewport?.columns ?? DEFAULT_COLUMNS) - HINT_INDENT)
    const measured = e.surface === 'terminal' ? slotCols.get(e.requestId) : undefined
    const cols = measured === undefined ? fallback : Math.min(512, measured) + reserve
    if (cols < MIN_COLS) {
      stopTimer()
      band = null

      return next(e)
    }
    const rowCols = cols - reserve
    scene = s
    const isStill = e.surface !== 'terminal' || isStaticFallback || !anyEffect(settings.effects)
    syncTargets(anim, s, settings, isStill)

    const drawn = await next(e)
    // Another under-prompt hook outside this one puts its rows above the route: say so once per load. A timer raises
    // the toast, so nothing is raised from inside the render.
    const own = ownIndex(next.trace)
    if (own !== null && own > 0 && !orderWarned) {
      orderWarned = true
      $.clock.after(100, () => {
        $.ui.toast(
          'Claude-Charter: list claudecharter first in CLAUDE_CODE_PLUGIN_DIRS so the route sits right under the hint line, above claudepeeker.',
        )
      })
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    let node: RenderElement
    if (isStill) node = stillRow(Text, rowCols)
    else {
      // Terminal only: `isStill` is true on every other surface.
      const { Raster } = $.ui.resolve(e)
      node = liveRow($, Raster, e.requestId, rowCols)
    }
    // The probe is drawn on the terminal only, also when the row itself is still.
    const probe = e.surface === 'terminal' ? { requestId: e.requestId, Client: $.ui.resolve(e).Client } : null
    node = withOpen($, { Box, Text, Button }, node, probe)

    // The hint stays first and the route comes right after it, with no margin or padding above the route. With the
    // setting `gapBelow` one blank line follows the route, but only when something is drawn after it.
    // The wrapper has no key (a keyed Box is a hover scope).
    const [first, ...rest] = stacked(drawn)

    if (settings.gapBelow && rest.some(hasContent)) {
      return (
        <Box flexDirection="column">
          {first}
          {node}
          <Text> </Text>
          {rest}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {first}
        {node}
        {rest}
      </Box>
    )
  })

  // The same row in the band directly above the prompt (placement `above`). A survey holds the band and the hook yields.
  // Nothing else is expected in this band, so there is no load-order check. Otherwise it passes through untouched.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (settings.placement !== 'above') return next(e)
    if (e.props.hasSurvey) {
      stopTimer()
      band = null

      return next(e)
    }
    const s = await sceneNow($, e.props.isWorking)
    if (s === null) {
      stopTimer()
      band = null
      scene = null

      return next(e)
    }
    // The engine has already left out the five cells of its `[-]` mark.
    const cols = Math.min(512, e.props.bodyColumns)
    if (cols < MIN_COLS) {
      stopTimer()
      band = null

      return next(e)
    }
    const rowCols = cols - openCells(settings.placement)
    scene = s
    const isStill = e.surface !== 'terminal' || isStaticFallback || !anyEffect(settings.effects)
    syncTargets(anim, s, settings, isStill)

    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    let node: RenderElement
    if (isStill) node = stillRow(Text, rowCols)
    else {
      // Terminal only: `isStill` is true on every other surface.
      const { Raster } = $.ui.resolve(e)
      node = liveRow($, Raster, e.requestId, rowCols)
    }
    // Above the prompt the width is the band's own (bodyColumns): no probe, only the spacer.
    node = withOpen($, { Box, Text, Button }, node, null)

    // No margin, padding or key on the wrapper. With the setting `gapBelow` one blank line follows the row, whatever
    // is drawn after it (the prompt box comes next when the band holds nothing else).
    if (settings.gapBelow) {
      return hasContent(below) ? (
        <Box flexDirection="column">
          {node}
          <Text> </Text>
          {below}
        </Box>
      ) : (
        <Box flexDirection="column">
          {node}
          <Text> </Text>
        </Box>
      )
    }

    return hasContent(below) ? (
      <Box flexDirection="column">
        {node}
        {below}
      </Box>
    ) : (
      node
    )
  })

  // The width probe under the prompt posts the cells the row may take. The hook keeps them by drawing and redraws.
  // A terminal resize or a pane docking or undocking: the engine lays the slot out again, the probe's module is called
  // and posts only if the row's cells changed; this hook stores the width and invalidates, and the next render remounts
  // the Raster at it (a fresh mount resets `band`, as any redraw does). Between the two renders the spacer keeps the
  // glyph on the right edge when the slot widens; when it narrows the old Raster may be clipped for that one frame.
  // A pane opening changes the conversation's columns but not the slot: no post, and the row keeps the footer's width.
  // A reload clears `slotCols`: the probe is given `ask: true`, which differs from its kept state, so it posts again.
  on('ui.message', async ($, e, next) => {
    if (e.element !== PROBE_KEY) return next(e)
    try {
      const data = e.data as { columns?: unknown } | null
      const n = data === null || typeof data !== 'object' ? NaN : data.columns
      if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 512 && n !== slotCols.get(e.requestId)) {
        slotCols.set(e.requestId, n)
        $.ui.invalidate('ui.render')
      }
    } catch {
      // A malformed message is ignored.
    }

    return {}
  })

  // The pane closing (the Close button, Escape, another mod, an unload) ends its motion; this only observes.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) resetPane()

    return next(e)
  }).catch(($, e, next) => next(e))

  // The panel: the route as a checklist, who works on it, the latest signals, the project's other routes.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    /** The phases of an item as pills: done ones teal, the current one lavender, later ones gray, a plain space between. */
    const pillsOf = (phases: string[], at: number): RenderNode[] => {
      const out: RenderNode[] = [' ']
      phases.forEach((name, i) => {
        if (i > 0) out.push(' ')
        const label = ' ' + name + ' '
        if (at < 0 || i > at) out.push(<Text color="#585858">{label}</Text>)
        else if (i < at) {
          out.push(
            <Text color="#ffffff" backgroundColor="#005f5f">
              {label}
            </Text>,
          )
        } else {
          out.push(
            <Text color="#1c1c1c" backgroundColor="#afafd7">
              {label}
            </Text>,
          )
        }
      })

      return out
    }

    const [chartReal, shareReal, others, logReal, crew, checks] = await Promise.all([
      read($, chartAtom),
      read($, shareAtom),
      read($, chartsAtom),
      read($, logAtom),
      read($, crewAtom),
      read($, checksAtom),
    ])
    const now = await $.clock.now()
    // With the row off (placement panel) no row hook runs: an open pane keeps the poll going after a reload.
    await ensureSync($)
    // While a demo plays the pane shows the made-up route; the demo's ticks redraw it, and it returns to the real route when the demo ends.
    const d = demo === null ? null : demoAt(demo.ticks * DEMO_TICK_MS, demo.startedAt)
    const isDemo = d !== null
    const chart: Chart | null = d === null ? chartReal : d.chart
    const share = d === null ? shareReal : d.share
    const log: Signal[] = d === null ? logReal : d.log
    // The running work and the newest commit, as the row reads them (the filters and the order of `sceneNow`).
    const runningAgents: CrewMember[] =
      d === null
        ? Object.values(crew)
            .filter(a => a.endedAt === null)
            .sort((a, b) => a.startedAt - b.startedAt)
        : d.agents
    const runningChecks: CheckRun[] =
      d === null
        ? Object.values(checks)
            .filter(c => c.endedAt === null && !c.isBackground)
            .sort((a, b) => a.startedAt - b.startedAt)
        : d.checks
    const lastCommit = [...log].reverse().find(s => s.kind === 'commit')
    const paneCommit: Scene['commit'] =
      d === null ? (lastCommit === undefined ? null : { seq: lastCommit.seq, hash: lastCommit.text }) : d.commit
    const w = e.props.bodyColumns
    const offsetMin = -new Date(now).getTimezoneOffset()
    const peers = share?.peers ?? []

    const routes = isDemo ? (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>A made-up route: /charter demo stop returns to yours.</Text>
      </Box>
    ) : (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Other routes of this project</Text>
        {others.length === 0 ? (
          <Text dimColor>No other routes in this project.</Text>
        ) : (
          others.slice(0, 10).map((c, i) => (
            <Box flexDirection="row" columnGap={1}>
              <Text wrap="truncate-end">
                {`${i + 1}. ${c.title}`}
                <Text dimColor>{` · ${c.pct}% · ${c.live} live of ${c.members} · ${stamp(c.updatedAt, offsetMin)}`}</Text>
              </Text>
              <Button
                key={'join-' + c.chartId}
                plain
                onPress={async () => {
                  await joinChart($, c.chartId)
                }}
              >
                Join
              </Button>
              <Button
                key={'adopt-' + c.chartId}
                plain
                onPress={async () => {
                  await adoptChart($, c.chartId)
                }}
              >
                Adopt
              </Button>
            </Box>
          ))
        )}
      </Box>
    )
    const buttons = (
      <Box flexDirection="row" marginTop={1} columnGap={1}>
        {chart === null || isDemo ? null : peers.length > 0 ? (
          <Button
            key="leave"
            onPress={async () => {
              await leaveChart($)
            }}
          >
            Leave route
          </Button>
        ) : (
          <Button
            key="clear"
            onPress={async () => {
              await clearRoute($)
            }}
          >
            Clear route
          </Button>
        )}
        <Button
          key="close"
          role="dismiss"
          onPress={() => {
            // The pane's motion ends with the press itself; the `ui.close` hook above ends it for every other way to close.
            resetPane()

            return $.ui.close({ id: PANE })
          }}
        >
          Close
        </Button>
      </Box>
    )
    const footer = (
      <Text dimColor>
        {'Correct a step with /charter done, start, skip or reset <id>; share with /charter join, hand over with /charter adopt.'}
      </Text>
    )

    if (chart === null) {
      stopPaneTimer()
      paneSite = null

      return (
        <Box flexDirection="column">
          <Text dimColor>
            No route charted yet. An orchestrator charts one with the progress tool, /charter init rebuilds one from this conversation, and the routes below can be joined or adopted.
          </Text>
          {routes}
          {buttons}
          {footer}
        </Box>
      )
    }

    const finished = chart.finishedAt !== null
    const { done, total } = topCounts(chart)
    const pct = percentOf(progress(chart), finished)
    const paneScene: Scene = {
      chart,
      share,
      agents: runningAgents,
      checks: runningChecks,
      lastCheck: null,
      commit: paneCommit,
      isWorking: mainWorking,
    }
    // Live: the terminal, with an effect on and no still fallback. The pane's moving pieces are then Rasters.
    const PaneRaster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    const isLive = PaneRaster !== undefined && !isPaneStatic && anyEffect(settings.effects)
    // A fresh `paneAnim` and `paneMotion` prime silently on this call: nothing moves on the first draw.
    syncTargets(paneAnim, paneScene, settings, !isLive)
    syncPane(paneMotion, paneAnim.tick, chart, log, settings.effects, !isLive)
    const R = Math.max(8, Math.min(40, w - 6))
    const pieces: PanePiece[] = []
    let mk: ((key: string, compose: () => Cell[]) => RenderElement) | null = null
    let track: ReturnType<typeof runs> = []
    if (isLive && PaneRaster !== undefined) {
      const Raster = PaneRaster
      paneRunning = runningAgents.length + runningChecks.length
      lastPaneBlit.clear()
      // A Raster composed once now: it is mounted with these cells, and the timer repaints it by its key.
      mk = (key, compose) => {
        const cells = compose()
        const fullKey = PANE_KEY + key
        const encoded = encodeCells(cells)
        pieces.push({ key: fullKey, width: cells.length, compose })
        lastPaneBlit.set(fullKey, encoded)

        return <Raster key={fullKey} columns={cells.length} rows={1} cells={encoded} />
      }
    } else {
      stopPaneTimer()
      paneSite = null
      track = runs(composeTrack(paneScene, createAnim(), settings, R, true))
    }

    /** The glyph of a running row: the spinner Raster while the activity effect moves it, else the row's still glyph. */
    const runGlyph = (kind: 'check' | 'agent', id: string): RenderNode => {
      if (mk !== null && settings.effects.activity) return mk('run-' + id, () => composeRunGlyph(kind, paneAnim.tick, true))
      const still = composeRunGlyph(kind, 0, false)[0]

      return <Text color={hex(kind === 'check' ? GOLD : LIVE)}>{String.fromCodePoint(still?.cp ?? 0x20)}</Text>
    }
    const runRows: RenderNode[] = [
      ...runningChecks.map(c => (
        <Box flexDirection="row">
          {runGlyph('check', c.id)}
          <Text wrap="truncate-end" color={hex(FIGURES)}>
            {' ' + c.label}
          </Text>
        </Box>
      )),
      ...runningAgents.map(a => (
        <Box flexDirection="row">
          {runGlyph('agent', a.id)}
          <Text wrap="truncate-end" color={hex(FIGURES)}>
            {' ' + a.description}
          </Text>
        </Box>
      )),
    ]

    const tree: RenderNode[] = []
    const visit = (items: ChartItem[], depth: number): void => {
      for (const item of items) {
        const peerHere = peers.find(p => p.isLive && p.current === item.id)
        const isMine = item.id === chart.current
        let glyph = '○'
        let color: string | undefined
        let dim = false
        let bold = false
        if (item.status === 'done') {
          glyph = '✓'
          color = '#5fff00'
        } else if (item.status === 'skipped') {
          glyph = '–'
          dim = true
        } else if (item.status === 'blocked') {
          glyph = '⊘'
          color = '#ff0000'
        } else if (item.status === 'active') {
          if (isMine) {
            glyph = '▸'
            color = SESSION_COLOR
            bold = true
          } else if (peerHere !== undefined) {
            glyph = '▸'
            color = hex(peerHere.color)
          } else {
            glyph = '▹'
            color = SESSION_COLOR
          }
        } else {
          dim = true
        }
        const holder = peers.length > 0 && share !== null ? share.held[item.id] : undefined
        const hasPhases = (item.status === 'active' || item.status === 'blocked') && item.phases.length > 0
        const at = item.phase === null ? -1 : item.phases.indexOf(item.phase)
        // A piece that moves is a Raster (live pane only): the current step's marker, a finished step's twinkle, a
        // blocked step's pulse and a phase pill filling in. Anything else is drawn as Text, as it always was.
        let glyphNode: RenderNode = (
          <Text color={color} bold={bold} dimColor={dim}>
            {glyph}
          </Text>
        )
        let hasRaster = false
        if (mk !== null) {
          if (item.status === 'active' && isMine && settings.effects.activity) {
            glyphNode = mk('mark-' + item.id, () => composeMine(paneAnim.tick, paneBusy()))
            hasRaster = true
          } else if (item.status === 'done' && paneMotion.marks.has(item.id)) {
            glyphNode = mk('mark-' + item.id, () => composeDone(paneMotion, item.id, paneAnim.tick))
            hasRaster = true
          } else if (item.status === 'blocked' && paneMotion.pulses.has(item.id)) {
            glyphNode = mk('mark-' + item.id, () => composeBlocked(paneMotion, item.id, paneAnim.tick))
            hasRaster = true
          }
        }
        const pillsNode: RenderNode | null =
          mk !== null && hasPhases && w >= 60 && item.phases.every(isRasterSafe) && paneMotion.pills.has(item.id)
            ? mk('pills-' + item.id, () => composePills(item.phases, at, paneMotion.pills.get(item.id), paneAnim.tick))
            : null
        const bodyNodes: RenderChildren[] = [
          <Text dimColor>{' ' + item.id}</Text>,
          <Text bold={isMine} dimColor={item.status === 'skipped'}>
            {' ' + item.title}
          </Text>,
          item.commit === null ? null : <Text dimColor>{' · ' + item.commit}</Text>,
          holder === undefined ? null : (
            <Text color={holder.isMe ? SESSION_COLOR : hex(holder.color)}>{` ‹${holder.label}›`}</Text>
          ),
          item.note === null ? null : <Text dimColor>{' — ' + item.note}</Text>,
        ]
        const phaseTail: RenderChildren[] = [
          hasPhases && w >= 60 && pillsNode === null ? pillsOf(item.phases, at) : null,
          hasPhases && w < 60 && at >= 0 ? (
            <Text dimColor>{` · ${item.phase} ${at + 1}/${item.phases.length}`}</Text>
          ) : null,
        ]
        if (!hasRaster && pillsNode === null) {
          tree.push(
            <Text wrap="truncate-end">
              {'  '.repeat(depth)}
              {glyphNode}
              {bodyNodes}
              {phaseTail}
            </Text>,
          )
        } else {
          tree.push(
            <Box flexDirection="row">
              {depth > 0 ? <Text>{'  '.repeat(depth)}</Text> : null}
              {glyphNode}
              <Text wrap="truncate-end">
                {bodyNodes}
                {phaseTail}
              </Text>
              {pillsNode}
            </Box>,
          )
        }
        visit(item.items, depth + 1)
      }
    }
    visit(chart.items, 0)

    // The track line, live: one Raster with the row's track, the percent and the room for a badge.
    const badgeRoom = settings.effects.celebrate ? Math.max(0, Math.min(BADGE_ROOM, w - R - PERCENT_CELLS)) : 0
    const trackNode: RenderNode =
      mk !== null ? (
        mk('track', () => composeTrackLine({ ...paneScene, isWorking: mainWorking }, paneAnim, settings, R, badgeRoom))
      ) : (
        <Text wrap="truncate-end">
          {track.map(r => (
            <Text color={hex(r.fg)} backgroundColor={hex(r.bg)}>
              {r.text}
            </Text>
          ))}
          <Text dimColor>{` ${pct}%`}</Text>
        </Text>
      )
    // A new signal's glyph flashes: that line holds a Raster.
    const signalLines: RenderNode[] = [...log]
      .reverse()
      .slice(0, 10)
      .map(s => {
        const g = glyphOf(s.kind, s.ok)
        if (mk !== null && paneMotion.arrivals.has(s.seq)) {
          return (
            <Box flexDirection="row">
              <Text dimColor>{stamp(s.at, offsetMin) + '  '}</Text>
              {mk('sig-' + s.seq, () => composeSignalGlyph(s.kind, s.ok, paneMotion.arrivals.get(s.seq), paneAnim.tick))}
              <Text wrap="truncate-end">
                <Text>{' ' + s.text}</Text>
                <Text dimColor>{'  ' + s.detail}</Text>
              </Text>
            </Box>
          )
        }

        return (
          <Text wrap="truncate-end">
            <Text dimColor>{stamp(s.at, offsetMin) + '  '}</Text>
            <Text color={g.color} dimColor={g.color === undefined}>
              {g.glyph}
            </Text>
            <Text>{' ' + s.text}</Text>
            <Text dimColor>{'  ' + s.detail}</Text>
          </Text>
        )
      })
    if (mk !== null) {
      paneSite = { requestId: e.requestId, pieces }
      paneFramesSinceMount = 0
      kickPane($)
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold>{chart.title}</Text>
          <Text dimColor>
            {` · ${done}/${total} done · ${pct}% · started ${stamp(chart.startedAt, offsetMin)}` +
              (chart.finishedAt !== null ? ` · complete ${stamp(chart.finishedAt, offsetMin)}` : '') +
              (peers.length > 0 ? ` · shared with ${peers.length} ${peers.length === 1 ? 'session' : 'sessions'}` : '') +
              (isDemo ? ' · demo' : '')}
          </Text>
        </Box>
        {trackNode}
        {peers.length === 0 || share === null ? null : (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Sessions</Text>
            {[
              {
                label: share.meLabel,
                color: SESSION_COLOR,
                state: ' this session',
                current: chart.current,
                holds: share.myHolds,
              },
              ...peers.map(p => ({
                label: p.label,
                color: hex(p.color) ?? SESSION_COLOR,
                state: p.isLive ? ' live' : ` idle ${Math.floor((now - p.seenAt) / 60000)}m`,
                current: p.current,
                holds: p.holds,
              })),
            ].map(s => {
              const item = s.current === null ? null : findItem(chart, s.current)
              return (
                <Text wrap="truncate-end">
                  <Text color={s.color}>●</Text>
                  <Text>{' ' + s.label}</Text>
                  <Text dimColor>{s.state}</Text>
                  {item === null ? (
                    <Text dimColor>{' · nothing current'}</Text>
                  ) : (
                    <Text>{` · now ${item.item.id} ${item.item.title}`}</Text>
                  )}
                  {s.holds.length === 0 ? null : <Text dimColor>{` · holds ${s.holds.join(', ')}`}</Text>}
                </Text>
              )
            })}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {tree}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Signals</Text>
          {runRows}
          {log.length === 0 && runRows.length === 0 ? <Text dimColor>No signals yet.</Text> : signalLines}
        </Box>
        {routes}
        {buttons}
        {footer}
      </Box>
    )
  })
}
