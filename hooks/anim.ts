import type { Chart, CheckRun, CrewMember, ShareView } from '../types'
import { GOLD, HEAD, OK } from './cells'
import type { TrackEndsId, TrackStyleId } from './cells'
import { currentPath, percentOf, posOf, progress, walk } from './route'
import { cut } from './signals'

/** One animation frame lasts this long. */
export const FRAME_MS = 50
/** A glide of the track takes this many frames (0.8 s). */
export const GLIDE_FRAMES = 16
/** The odometers step every this many frames. */
export const ROLL_EVERY = 2
/** The changed digits stay flashed this many frames after each roll step. */
export const FLASH_FRAMES = 6
export const GLINT_FRAMES = 12
export const GLINT_PASSES = 2
export const SPARK_FRAMES = 16
export const MARKER_SPARK_FRAMES = 24
export const TWINKLE_EVERY = 4
export const ITEM_BADGE_FRAMES = 50
export const STAGE_BADGE_FRAMES = 60
export const COMPLETE_BADGE_FRAMES = 80
export const COMMIT_BADGE_FRAMES = 40
export const PULSE_PROFILE: readonly number[] = [0.2, 0.6, 1, 1, 0.6, 0.2]
export const PULSE_COUNT = 3
export const SHIMMER_PAD = 4
/** The phase dot dims and brightens every this many frames (0.5 s) while Claude works. */
export const DOT_BREATHE = 10
/** How much `HEAD` the five filled cells behind the head take, nearest first (the comet). */
export const COMET_MIX: readonly number[] = [0.4, 0.28, 0.18, 0.1, 0.04]
/** One beacon pulse lasts this many frames (1.6 s). */
export const BEACON_FRAMES = 32
/** How far the beacon's peak goes toward `MARK_DONE`. */
export const BEACON_MIX = 0.7

/** Which motions are on. */
export type Effects = { glide: boolean; roll: boolean; activity: boolean; celebrate: boolean }

/** Where the route row shows: under the prompt, above it, or nowhere (only in the pane). */
export type Placement = 'under' | 'above' | 'panel'

/** The settings of the mod. */
export type Settings = {
  effects: Effects
  placement: Placement
  track: TrackStyleId
  /** The glyphs at the two ends of the track. */
  trackEnds: TrackEndsId
  /** One blank line under the route row, before what is drawn under it. */
  gapBelow: boolean
  toast: boolean
  /** The one-line nudge on the first subagent of a session with no open route. */
  nudge: boolean
  mirror: boolean
  mirrorFile: string
}

/** What the band shows. */
export type Scene = {
  /** The merged route; `chart.current` is this session's. */
  chart: Chart
  /** Null when solo or not attached. */
  share: ShareView | null
  /** Running subagents (endedAt null), oldest first. */
  agents: CrewMember[]
  /** Running checks, not background, oldest first. */
  checks: CheckRun[]
  /** The newest ended non-background check within the show window. */
  lastCheck: CheckRun | null
  /** The newest commit signal. */
  commit: { seq: number; hash: string } | null
  isWorking: boolean
}

/** A figure on its way to a target; the characters from `flashFrom` flash until `flashUntil`. */
export type Odo = { shown: number; target: number; flashFrom: number; flashUntil: number }
/** A position 0..1 gliding from `from` to `to`, begun at tick `start`. */
export type Glide = { from: number; to: number; start: number }
/** Badge priority is the order of this list. */
export type BadgeKind = 'none' | 'commit' | 'item' | 'stage' | 'complete'

export type Anim = {
  tick: number
  key: string | null
  isPrimed: boolean
  /** The shared progress. */
  fill: Glide
  /** This session's position. */
  head: Glide
  pct: Odo
  stage: Odo
  doneIds: Set<string>
  completed: boolean
  lastCommitSeq: number
  badge: { kind: BadgeKind; text: string; color: number; until: number }
  /** `number` is a stage marker (the boundary after that stage). */
  spark: { at: 'head' | number; color: number; until: number } | null
  glint: { start: number } | null
  pulse: { start: number } | null
}

const newOdo = (): Odo => ({ shown: 0, target: 0, flashFrom: 0, flashUntil: 0 })
const noBadge = (): Anim['badge'] => ({ kind: 'none', text: '', color: 0, until: 0 })

export function createAnim(tick = 0): Anim {
  return {
    tick,
    key: null,
    isPrimed: false,
    fill: { from: 0, to: 0, start: tick },
    head: { from: 0, to: 0, start: tick },
    pct: newOdo(),
    stage: newOdo(),
    doneIds: new Set(),
    completed: false,
    lastCommitSeq: 0,
    badge: noBadge(),
    spark: null,
    glint: null,
    pulse: null,
  }
}

/** The glide's value at `tick`: ease-out quadratic over `GLIDE_FRAMES`, exactly `to` at the end. */
export function glideAt(g: Glide, tick: number): number {
  if (g.from === g.to) return g.to
  const q = Math.max(0, Math.min(1, (tick - g.start) / GLIDE_FRAMES))
  if (q >= 1) return g.to

  return g.from + (g.to - g.from) * (1 - (1 - q) * (1 - q))
}

export const fillValue = (anim: Anim): number => glideAt(anim.fill, anim.tick)
export const headValue = (anim: Anim): number => glideAt(anim.head, anim.tick)

const PRIORITY: Record<BadgeKind, number> = { none: 0, commit: 1, item: 2, stage: 3, complete: 4 }

function raiseBadge(anim: Anim, kind: Exclude<BadgeKind, 'none'>, text: string, color: number, frames: number): void {
  const b = anim.badge
  const isShowing = b.kind !== 'none' && anim.tick < b.until
  if (isShowing && PRIORITY[b.kind] > PRIORITY[kind]) return
  anim.badge = { kind, text, color, until: anim.tick + frames }
}

function retarget(g: Glide, x: number, tick: number, snap: boolean): void {
  if (snap) {
    g.from = x
    g.to = x
    g.start = tick

    return
  }
  if (x !== g.to) {
    g.from = glideAt(g, tick)
    g.to = x
    g.start = tick
  }
}

/**
 * Points the animation at the scene: the glides and odometers to their targets, and the one-off events (a finished
 * item, stage or route, a commit) that raise badges. The first call for a route primes silently. `jump` snaps
 * everything and raises nothing (still frames).
 */
export function syncTargets(anim: Anim, scene: Scene, settings: Settings, jump: boolean): void {
  const { effects } = settings
  const { chart } = scene
  const key = chart.title + '\u0000' + chart.startedAt
  if (anim.key !== key) {
    Object.assign(anim, createAnim(anim.tick))
    anim.key = key
  }
  const finished = chart.finishedAt !== null
  const snap = jump || !anim.isPrimed
  retarget(anim.fill, progress(chart), anim.tick, snap || !effects.glide)
  retarget(anim.head, posOf(chart, chart.current), anim.tick, snap || !effects.glide)
  anim.pct.target = percentOf(progress(chart), finished)
  anim.stage.target = currentPath(chart)[0]?.pos ?? 0
  if (snap || !effects.roll) {
    anim.pct.shown = anim.pct.target
    anim.pct.flashUntil = 0
    anim.stage.shown = anim.stage.target
    anim.stage.flashUntil = 0
  }

  const done = new Map<string, { title: string; depth: number }>()
  walk(chart.items, (item, parents) => {
    if (item.status === 'done') done.set(item.id, { title: item.title, depth: parents.length })
  })

  if (anim.isPrimed && !jump && effects.celebrate) {
    const newly = [...done.keys()].filter(id => !anim.doneIds.has(id))
    const size = chart.items.length
    const topNew = chart.items.findIndex(i => newly.includes(i.id))
    if (finished && !anim.completed) {
      raiseBadge(anim, 'complete', `✓ Complete · ${cut(chart.title, 20)}`, GOLD, COMPLETE_BADGE_FRAMES)
      anim.glint = { start: anim.tick }
      anim.pulse = { start: anim.tick }
    } else if (topNew >= 0) {
      const pos = topNew + 1
      raiseBadge(anim, 'stage', `✦ Stage ${pos}/${size} done ✦`, GOLD, STAGE_BADGE_FRAMES)
      anim.glint = { start: anim.tick }
      anim.spark = { at: pos < size ? pos : 'head', color: GOLD, until: anim.tick + MARKER_SPARK_FRAMES }
    } else if (newly.length > 0) {
      let deepest = done.get(newly[0] ?? '')
      for (const id of newly) {
        const d = done.get(id)
        if (d !== undefined && (deepest === undefined || d.depth > deepest.depth)) deepest = d
      }
      raiseBadge(anim, 'item', `✦ ${cut(deepest?.title ?? '', 20)} done`, OK, ITEM_BADGE_FRAMES)
      anim.spark = { at: 'head', color: OK, until: anim.tick + SPARK_FRAMES }
    }
    if (scene.commit !== null && scene.commit.seq > anim.lastCommitSeq) {
      raiseBadge(anim, 'commit', `◈ ${scene.commit.hash}`, HEAD, COMMIT_BADGE_FRAMES)
    }
  }

  anim.doneIds = new Set(done.keys())
  anim.completed = finished
  anim.lastCommitSeq = scene.commit?.seq ?? anim.lastCommitSeq
  anim.isPrimed = true
}

/** The index of the first character that differs between two figures (the shorter's length when one is a prefix). */
function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i
  }

  return n
}

function stepOdo(o: Odo, tick: number, roll: boolean): void {
  if (o.shown === o.target) return
  if (!roll) {
    o.shown = o.target

    return
  }
  const gap = o.target - o.shown
  const step = Math.min(Math.abs(gap), Math.max(1, Math.ceil(Math.abs(gap) / 4)))
  const before = String(o.shown)
  o.shown += Math.sign(gap) * step
  o.flashFrom = firstDiff(before, String(o.shown))
  o.flashUntil = tick + FLASH_FRAMES
}

/** One frame: the clock, the odometers on their roll ticks, the expiry of badge and effects. */
export function advance(anim: Anim, effects: Effects): void {
  anim.tick += 1
  if (!effects.roll) {
    stepOdo(anim.pct, anim.tick, false)
    stepOdo(anim.stage, anim.tick, false)
  } else if (anim.tick % ROLL_EVERY === 0) {
    stepOdo(anim.pct, anim.tick, true)
    stepOdo(anim.stage, anim.tick, true)
  }
  if (anim.badge.kind !== 'none' && anim.tick >= anim.badge.until) anim.badge = noBadge()
  if (anim.spark !== null && anim.tick >= anim.spark.until) anim.spark = null
  if (anim.glint !== null && anim.tick >= anim.glint.start + GLINT_FRAMES * GLINT_PASSES) anim.glint = null
  if (anim.pulse !== null && anim.tick >= anim.pulse.start + PULSE_PROFILE.length * PULSE_COUNT) anim.pulse = null
}

const isGlideSettled = (anim: Anim, g: Glide): boolean => g.from === g.to || anim.tick - g.start >= GLIDE_FRAMES

/** True when nothing is moving any more: the timer can stop. */
export function isSettled(anim: Anim): boolean {
  const odoDone = (o: Odo): boolean => o.shown === o.target && anim.tick >= o.flashUntil

  return (
    isGlideSettled(anim, anim.fill) &&
    isGlideSettled(anim, anim.head) &&
    odoDone(anim.pct) &&
    odoDone(anim.stage) &&
    anim.badge.kind === 'none' &&
    anim.spark === null &&
    anim.glint === null &&
    anim.pulse === null
  )
}
