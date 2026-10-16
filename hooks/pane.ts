import type { Chart, Signal } from '../types'
import {
  DOT_BREATHE,
  FLASH_FRAMES,
  MARKER_SPARK_FRAMES,
  PULSE_COUNT,
  PULSE_PROFILE,
  SPARK_FRAMES,
  TWINKLE_EVERY,
} from './anim'
import type { Anim, Effects, Scene, Settings } from './anim'
import {
  DEFAULT,
  FAIL,
  FIGURES,
  GLYPH,
  GOLD,
  HEAD,
  LIVE,
  OK,
  TRACK,
  WHITE,
  blank,
  lighten,
  mixColor,
  safeCp,
  textCells,
} from './cells'
import type { Cell } from './cells'
import { composeTrack } from './row'
import { walk } from './route'
import { cut } from './signals'

/** A phase pill fills in over this many frames (0.4 s). */
export const PILL_FRAMES = 8
/** A new signal's glyph flashes `FLASH_FRAMES` and then blends back to its colour: 14 frames in all (0.7 s). */
export const ARRIVAL_FRAMES = 14
/** At most this many new signals flash at once. */
export const MAX_ARRIVALS = 3
/** The background of a passed phase pill. */
export const PILL_DONE_BG = 0x005f5f
/** The ink of the current phase pill. */
export const PILL_INK = 0x1c1c1c
/** The cells the track line may give a badge. */
export const BADGE_ROOM = 30
/** The percent beside the track: a space and up to three digits and the sign. */
export const PERCENT_CELLS = 5
/** A blocked mark pulses three times (18 frames, 0.9 s). */
export const BLOCK_PULSE_FRAMES = PULSE_PROFILE.length * PULSE_COUNT

/** What the pane has seen and what is moving in it. `pulses` and `arrivals` hold start ticks. */
export type PaneMotion = {
  key: string | null
  isPrimed: boolean
  doneIds: Set<string>
  blockedIds: Set<string>
  phaseAt: Map<string, number>
  lastSeq: number
  marks: Map<string, { start: number; color: number; frames: number }>
  pulses: Map<string, number>
  pills: Map<string, { start: number; from: number; to: number }>
  arrivals: Map<number, number>
}

/** A fixed-width piece of the pane that the timer repaints: the Raster's key, its width, and how to compose it now. */
export type PanePiece = { key: string; width: number; compose: () => Cell[] }

const ease = (q: number): number => {
  const c = Math.max(0, Math.min(1, q))

  return 1 - (1 - c) * (1 - c)
}

const cellOf = (cp: number, fg: number, bg: number = DEFAULT): Cell => ({ cp: safeCp(cp), fg, bg })

export function createPaneMotion(): PaneMotion {
  return {
    key: null,
    isPrimed: false,
    doneIds: new Set(),
    blockedIds: new Set(),
    phaseAt: new Map(),
    lastSeq: 0,
    marks: new Map(),
    pulses: new Map(),
    pills: new Map(),
    arrivals: new Map(),
  }
}

/**
 * Points the pane's motion at the route and the log: starts the one-off events (a finished item, a blocked item, a
 * phase moving forward, new signals). The first call for a route primes silently; `jump` raises nothing.
 */
export function syncPane(
  m: PaneMotion,
  tick: number,
  chart: Chart,
  log: readonly Signal[],
  effects: Effects,
  jump: boolean,
): void {
  const key = chart.title + '\u0000' + chart.startedAt
  if (m.key !== key) {
    Object.assign(m, createPaneMotion())
    m.key = key
  }
  const done = new Map<string, number>()
  const blocked: string[] = []
  const phases = new Map<string, number>()
  walk(chart.items, (item, parents) => {
    if (item.status === 'done') done.set(item.id, parents.length)
    if (item.status === 'blocked') blocked.push(item.id)
    if (item.phase !== null) {
      const at = item.phases.indexOf(item.phase)
      if (at >= 0) phases.set(item.id, at)
    }
  })
  let newest = 0
  for (const s of log) newest = Math.max(newest, s.seq)

  if (m.isPrimed && !jump) {
    if (effects.celebrate) {
      for (const [id, depth] of done) {
        if (m.doneIds.has(id)) continue
        m.marks.set(
          id,
          depth === 0
            ? { start: tick, color: GOLD, frames: MARKER_SPARK_FRAMES }
            : { start: tick, color: OK, frames: SPARK_FRAMES },
        )
      }
    }
    if (effects.activity) {
      for (const id of blocked) {
        if (!m.blockedIds.has(id)) m.pulses.set(id, tick)
      }
    }
    if (effects.glide) {
      for (const [id, now] of phases) {
        const prev = m.phaseAt.get(id)
        if (prev !== undefined && prev < now) m.pills.set(id, { start: tick, from: prev, to: now })
      }
    }
    if (effects.celebrate && newest > m.lastSeq) {
      const fresh = log
        .filter(s => s.seq > m.lastSeq)
        .map(s => s.seq)
        .sort((a, b) => a - b)
        .slice(-MAX_ARRIVALS)
      for (const seq of fresh) m.arrivals.set(seq, tick)
    }
  }
  m.doneIds = new Set(done.keys())
  m.blockedIds = new Set(blocked)
  m.phaseAt = phases
  m.lastSeq = newest
  m.isPrimed = true
}

/** One frame: the effects that ran their course are dropped. */
export function advancePane(m: PaneMotion, tick: number): void {
  for (const [id, e] of m.marks) if (tick >= e.start + e.frames) m.marks.delete(id)
  for (const [id, start] of m.pulses) if (tick >= start + BLOCK_PULSE_FRAMES) m.pulses.delete(id)
  for (const [id, e] of m.pills) if (tick >= e.start + PILL_FRAMES) m.pills.delete(id)
  for (const [seq, start] of m.arrivals) if (tick >= start + ARRIVAL_FRAMES) m.arrivals.delete(seq)
}

/** True while a one-off effect of the pane is still running. */
export function isPaneMoving(m: PaneMotion): boolean {
  return m.marks.size > 0 || m.pulses.size > 0 || m.pills.size > 0 || m.arrivals.size > 0
}

/** True when a Raster would take every character of `text` as it is. */
export function isRasterSafe(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x3f
    if (safeCp(cp) !== cp) return false
  }

  return true
}

/** The current step's marker ▸: steady lavender, breathing as the row's phase dot does while Claude works. */
export function composeMine(tick: number, busy: boolean): Cell[] {
  const dim = busy && Math.floor(tick / DOT_BREATHE) % 2 === 1

  return [cellOf(GLYPH.current, dim ? mixColor(LIVE, TRACK, 0.5) : LIVE)]
}

/** A finished step: ✦ and ✧ twinkle in the mark's colour for its frames, then ✓. */
export function composeDone(m: PaneMotion, id: string, tick: number): Cell[] {
  const e = m.marks.get(id)
  if (e !== undefined && tick < e.start + e.frames) {
    const cp = Math.floor((tick - e.start) / TWINKLE_EVERY) % 2 === 0 ? GLYPH.spark1 : GLYPH.spark2

    return [cellOf(cp, e.color)]
  }

  return [cellOf(GLYPH.check, OK)]
}

/** A blocked step: ⊘ pulses red (the cap pulse's profile) three times, then stays red. */
export function composeBlocked(m: PaneMotion, id: string, tick: number): Cell[] {
  const s = m.pulses.get(id)
  if (s !== undefined && tick < s + BLOCK_PULSE_FRAMES) {
    const level = PULSE_PROFILE[(tick - s) % PULSE_PROFILE.length] ?? 0

    return [cellOf(GLYPH.blocked, lighten(FAIL, level * 0.55))]
  }

  return [cellOf(GLYPH.blocked, FAIL)]
}

/**
 * The pane's track line: the row's track exactly, then the percent (the changed digits flashing while it rolls), then
 * the room for a badge. Its width is `R + PERCENT_CELLS + badgeRoom` on every frame.
 */
export function composeTrackLine(scene: Scene, anim: Anim, settings: Settings, R: number, badgeRoom: number): Cell[] {
  const cells = composeTrack(scene, anim, settings, R, false)
  const digits = String(anim.pct.shown)
  const pct = textCells(' ' + digits + '%', FIGURES)
  if (anim.tick < anim.pct.flashUntil) {
    for (let j = anim.pct.flashFrom; j < digits.length; j++) {
      const c = pct[1 + j]
      if (c !== undefined) c.fg = HEAD
    }
  }
  while (pct.length < PERCENT_CELLS) pct.push(...blank(1))
  cells.push(...pct.slice(0, PERCENT_CELLS))
  if (badgeRoom > 0) {
    const room = blank(badgeRoom)
    const b = anim.badge
    if (b.kind !== 'none' && anim.tick < b.until && badgeRoom > 2) {
      const text = textCells(cut(b.text, badgeRoom - 2), b.color)
      text.forEach((c, i) => {
        room[2 + i] = c
      })
    }
    cells.push(...room)
  }

  return cells
}

/**
 * The phases of an item as pills: a blank, then each phase as ` name ` with a blank between. Passed phases are teal,
 * the current one lavender, later ones gray. While `blend` runs the newly reached pill fills in left to right and the
 * pill before it turns from lavender to teal.
 */
export function composePills(
  phases: string[],
  at: number,
  blend: { start: number; from: number; to: number } | undefined,
  tick: number,
): Cell[] {
  const out: Cell[] = blank(1)
  const k = blend === undefined ? 1 : ease((tick - blend.start) / PILL_FRAMES)
  phases.forEach((name, i) => {
    if (i > 0) out.push(...blank(1))
    const label = Array.from(' ' + name + ' ')
    const n = label.length
    const future = { fg: TRACK, bg: DEFAULT }
    const passed = { fg: WHITE, bg: PILL_DONE_BG }
    const current = { fg: PILL_INK, bg: LIVE }
    const base = at < 0 || i > at ? future : i < at ? passed : current
    label.forEach((ch, j) => {
      let style = base
      if (blend !== undefined && k < 1) {
        if (i === blend.to) style = j < Math.round(k * n) ? current : future
        else if (i >= blend.from && i < blend.to) {
          style = { fg: mixColor(PILL_INK, WHITE, k), bg: mixColor(LIVE, PILL_DONE_BG, k) }
        }
      }
      out.push(cellOf(ch.codePointAt(0) ?? 0x20, style.fg, style.bg))
    })
  })

  return out
}

/** A signal's glyph, as the pane lists it; a new one flashes (HEAD, a commit's GOLD) and blends back to its colour. */
export function composeSignalGlyph(
  kind: Signal['kind'],
  ok: boolean | null,
  arrival: number | undefined,
  tick: number,
): Cell[] {
  let cp: number
  let base: number
  if (kind === 'agent') {
    cp = GLYPH.agentSpin[0] ?? 0x25d0
    base = LIVE
  } else if (kind === 'commit') {
    cp = GLYPH.commit
    base = HEAD
  } else if (ok === null) {
    cp = GLYPH.checkStill
    base = FIGURES
  } else if (ok) {
    cp = GLYPH.check
    base = OK
  } else {
    cp = GLYPH.cross
    base = FAIL
  }
  let fg = base
  if (arrival !== undefined) {
    const flash = kind === 'commit' ? GOLD : HEAD
    const e = tick - arrival
    if (e < FLASH_FRAMES) fg = flash
    else if (e < ARRIVAL_FRAMES) fg = mixColor(flash, base, ease((e - FLASH_FRAMES) / (ARRIVAL_FRAMES - FLASH_FRAMES)))
  }

  return [cellOf(cp, fg)]
}

/** The glyph of a running row: exactly the row's tail glyph (the braille spinner for a check, ◐◓◑◒ for a subagent). */
export function composeRunGlyph(kind: 'check' | 'agent', tick: number, spins: boolean): Cell[] {
  if (kind === 'check') {
    const cp = spins
      ? (GLYPH.checkSpin[Math.floor(tick / 2) % GLYPH.checkSpin.length] ?? GLYPH.checkStill)
      : GLYPH.checkStill

    return [cellOf(cp, GOLD)]
  }
  const cp = spins
    ? (GLYPH.agentSpin[Math.floor(tick / 4) % GLYPH.agentSpin.length] ?? GLYPH.agentSpin[0] ?? 0x25d0)
    : (GLYPH.agentSpin[0] ?? 0x25d0)

  return [cellOf(cp, LIVE)]
}
