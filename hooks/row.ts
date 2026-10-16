import {
  BEACON_FRAMES,
  BEACON_MIX,
  COMET_MIX,
  DOT_BREATHE,
  GLINT_FRAMES,
  PULSE_PROFILE,
  SHIMMER_PAD,
  TWINKLE_EVERY,
  fillValue,
  headValue,
  GLIDE_FRAMES,
} from './anim'
import type { Anim, Effects, Placement, Scene, Settings } from './anim'
import {
  DEFAULT,
  DEFAULT_TRACK_ENDS,
  DEFAULT_TRACK_STYLE,
  EIGHTHS,
  FAIL,
  FIGURES,
  FILL,
  GLYPH,
  GOLD,
  HEAD,
  LIVE,
  MARK_DONE,
  OK,
  TINT_MIX,
  TRACK,
  TRACK_ENDS,
  TRACK_STYLES,
  WHITE,
  blank,
  isTrackEnds,
  isTrackStyle,
  lighten,
  mixColor,
  safeCp,
  textCells,
} from './cells'
import type { Cell } from './cells'
import { mirrorPathOf } from './mirror'
import { currentPath, findItem, nextItem, percentOf, posOf, progress, topCounts } from './route'
import { cut } from './signals'

export { posOf }

/** The `PromptHint` slot is indented by this many columns: the row is that much narrower than the window. */
export const HINT_INDENT = 2
/** The address of the open glyph's Button: `ui.press` reaches it by this key. */
export const OPEN_KEY = 'charter-open'
/** The label of the open glyph: a midline horizontal ellipsis. */
export const OPEN_GLYPH = '⋯'
/** The open glyph's hotkey, given only with placement `above` (the band is a focus site). */
export const OPEN_HOTKEY = 'c'
/** The key of the width probe under the prompt: ui.message names it. */
export const PROBE_KEY = 'charter-probe'

/**
 * The cells the open glyph takes at the end of the row: a one-cell gap and the glyph, or with the band's hotkey "c: ⋯".
 */
export function openCells(placement: Placement): number {
  if (placement === 'under') return 2
  if (placement === 'above') return 5

  return 0
}
/** The window width assumed when the surface did not measure one. */
export const DEFAULT_COLUMNS = 80

/**
 * The calling hook's place in the chain, from what settled beneath it: the nearest link beneath it has index
 * `trace[0].index`, so the hook itself is one before that. 0 means outermost; null when nothing is beneath it.
 */
export function ownIndex(trace: readonly { index: number }[]): number | null {
  const nearest = trace[0]

  return nearest === undefined ? null : nearest.index - 1
}

/** The settings, each falling back to its default. */
export function normalizeSettings(options: Record<string, unknown>): Settings {
  const on = (key: string): boolean => options[key] !== 'off'

  return {
    effects: { glide: on('glide'), roll: on('roll'), activity: on('activity'), celebrate: on('celebrate') },
    placement: options.placement === 'above' || options.placement === 'panel' ? options.placement : 'under',
    track: isTrackStyle(options.track) ? options.track : DEFAULT_TRACK_STYLE,
    trackEnds: isTrackEnds(options.trackEnds) ? options.trackEnds : DEFAULT_TRACK_ENDS,
    gapBelow: on('gapBelow'),
    toast: on('toast'),
    nudge: on('nudge'),
    mirror: options.mirror === 'on',
    mirrorFile: mirrorPathOf(options.mirrorFile),
  }
}

/** True when any of the four effects is on. */
export function anyEffect(e: Effects): boolean {
  return e.glide || e.roll || e.activity || e.celebrate
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

const cellOf = (cp: number, fg: number): Cell => ({ cp: safeCp(cp), fg, bg: DEFAULT })

// ---- the track ------------------------------------------------------------------------------------------

/** What a path cell of the track holds, so the overlays know what they may recolor. */
type Kind = 'fill' | 'empty' | 'marker' | 'peer' | 'head'

/** The path cells where the stage boundaries fall, for `S` stages on a path of `L` cells; empty below two stages. */
function boundsOf(S: number, L: number): number[] {
  if (S < 2) return []
  const out: number[] = []
  for (let j = 1; j <= S - 1; j++) out.push(clamp(Math.round((j * L) / S) - 1, 0, L - 1))

  return out
}

/**
 * The track: `R` cells in all, a start cap, a path of `R - 2` and an end cap, in the style of the settings. Still
 * frames show the plain state; others the effects.
 */
export function composeTrack(scene: Scene, anim: Anim, settings: Settings, R: number, isStill: boolean): Cell[] {
  const { chart, share } = scene
  const st = TRACK_STYLES[settings.track]
  const L = R - 2
  const S = chart.items.length
  const v = isStill ? progress(chart) : fillValue(anim)
  const f = Math.round(v * L)
  const path: Cell[] = []
  const kinds: Kind[] = []
  if (st.isSmooth) {
    const e8 = Math.round(v * L * 8)
    const full = Math.floor(e8 / 8)
    const rem = e8 % 8
    for (let p = 0; p < L; p++) {
      if (p < full) {
        path.push(cellOf(st.fill, FILL))
        kinds.push('fill')
      } else if (p === full && rem > 0) {
        path.push(cellOf(EIGHTHS[rem] ?? st.fill, FILL))
        kinds.push('fill')
      } else {
        path.push(cellOf(st.empty, st.emptyColor))
        kinds.push('empty')
      }
    }
  } else {
    for (let p = 0; p < L; p++) {
      if (p < f) {
        path.push(cellOf(st.fill, FILL))
        kinds.push('fill')
      } else {
        path.push(cellOf(st.empty, st.emptyColor))
        kinds.push('empty')
      }
    }
  }
  // What the bar's two outer cells are before any marker, head or tint lands on them (the capsule caps follow it).
  const baseStart = path[0]?.fg
  const baseEnd = path[L - 1]?.fg
  // Stage markers.
  const bounds = boundsOf(S, L)
  const markers = S >= 2 && L >= 2 * S ? bounds : []
  const isTodoMarker = (p: number): boolean => kinds[p] === 'marker' && p >= f
  markers.forEach(b => {
    path[b] = b < f ? cellOf(st.markDone, MARK_DONE) : cellOf(st.markTodo, TRACK)
    kinds[b] = 'marker'
  })
  // A stage another session holds is tinted toward that session's color.
  if (share !== null) {
    chart.items.forEach((item, k) => {
      const h = share.held[item.id]
      if (h === undefined || h.isMe) return
      const from = k === 0 ? 0 : (bounds[k - 1] ?? -1) + 1
      const to = k === S - 1 ? L - 1 : (bounds[k] ?? -1)
      for (let p = from; p <= to; p++) {
        const c = path[p]
        if (c === undefined) continue
        if (kinds[p] === 'empty' || isTodoMarker(p)) c.fg = mixColor(c.fg, h.color, TINT_MIX)
      }
    })
  }
  // Other sessions.
  if (share !== null) {
    for (const peer of share.peers) {
      if (!peer.isLive || peer.current === null) continue
      const at = Math.min(L - 1, Math.round(posOf(chart, peer.current) * L))
      path[at] = cellOf(st.head, peer.color)
      kinds[at] = 'peer'
    }
  }
  // This session's head.
  let headAt = -1
  if (chart.finishedAt === null) {
    const h = isStill ? posOf(chart, chart.current) : headValue(anim)
    if (h < 1) {
      headAt = Math.min(L - 1, Math.round(h * L))
      path[headAt] = cellOf(st.head, HEAD)
      kinds[headAt] = 'head'
    }
  }
  const ends = TRACK_ENDS[settings.trackEnds] ?? { start: st.start, end: st.end }
  const isFinished = chart.finishedAt !== null
  // The capsule caps take the colour of the path cell beside them in the base layer, so the bar reads as one piece.
  const isCapsule = settings.trackEnds === 'capsule'
  const startColor = isFinished ? GOLD : isCapsule && baseStart !== undefined ? baseStart : FIGURES
  const endColor = isFinished ? GOLD : isCapsule && baseEnd !== undefined ? baseEnd : FIGURES
  const startCap = cellOf(ends.start, startColor)
  const endCap = cellOf(ends.end, endColor)
  const cells: Cell[] = [startCap, ...path, endCap]
  if (isStill) return cells

  const { tick } = anim
  const { effects } = settings
  // Comet: the filled cells behind the head brighten toward it.
  if (effects.glide) {
    const anchor = headAt >= 0 ? Math.min(headAt, f) : f
    for (let j = 0; j < COMET_MIX.length; j++) {
      const p = anchor - 1 - j
      const c = path[p]
      if (p >= 0 && p < f && c !== undefined && kinds[p] === 'fill') c.fg = mixColor(FILL, HEAD, COMET_MIX[j] ?? 0)
    }
  }
  // Trail behind a head gliding forward; a head gliding back has none (it would fly ahead of the head).
  const isGliding = anim.head.to > anim.head.from && tick - anim.head.start < GLIDE_FRAMES
  if (isGliding && headAt >= 0) {
    const trail: [number, number][] = [
      [headAt - 1, 0.6],
      [headAt - 2, 0.3],
    ]
    for (const [i, mix] of trail) {
      const c = path[i]
      if (c !== undefined && i >= 0 && i < f) c.fg = mixColor(FILL, HEAD, mix)
    }
  }
  // Beacon: the next stage marker ahead of the head (else the end cap) breathes while Claude works.
  const isBusy = scene.isWorking || scene.agents.length + scene.checks.length > 0
  if (effects.activity && isBusy && headAt >= 0) {
    const ahead = markers.find(b => b > headAt && kinds[b] === 'marker')
    const target = ahead === undefined ? endCap : path[ahead]
    if (target !== undefined) {
      const level = (1 - Math.cos((2 * Math.PI * (tick % BEACON_FRAMES)) / BEACON_FRAMES)) / 2
      target.fg = mixColor(target.fg, MARK_DONE, BEACON_MIX * level)
    }
  }
  // Twinkle.
  if (anim.spark !== null) {
    const { at, color } = anim.spark
    let target: Cell | undefined
    if (at === 'head') target = headAt >= 0 ? path[headAt] : endCap
    else {
      const k = markers[at - 1]
      if (k !== undefined) target = path[k]
    }
    if (target !== undefined) {
      target.cp = safeCp(st.spark[Math.floor(tick / TWINKLE_EVERY) % 2] ?? st.spark[0])
      target.fg = color
    }
  }
  // Gold glint sweeping along the track.
  if (anim.glint !== null) {
    const q = ((tick - anim.glint.start) % GLINT_FRAMES) / (GLINT_FRAMES - 1)
    const h = Math.round(-1 + q * (R + 1))
    cells.forEach((c, i) => {
      const d = Math.abs(i - h)
      if (d === 0) c.fg = mixColor(c.fg, GOLD, 0.7)
      else if (d === 1) c.fg = mixColor(c.fg, GOLD, 0.35)
    })
  }
  // Both caps pulse together.
  if (anim.pulse !== null) {
    const level = PULSE_PROFILE[(tick - anim.pulse.start) % PULSE_PROFILE.length] ?? 0
    startCap.fg = lighten(GOLD, level * 0.55)
    endCap.fg = lighten(GOLD, level * 0.55)
  }

  return cells
}

// ---- the parts of the row -----------------------------------------------------------------------------

/** The percent: 4 cells (` 28%`), the changed digits flashing while the odometer rolls. */
function percentCells(scene: Scene, anim: Anim, isStill: boolean): Cell[] {
  const { chart } = scene
  const pct = isStill ? percentOf(progress(chart), chart.finishedAt !== null) : anim.pct.shown
  const text = String(pct)
  const cells = textCells(text.padStart(3) + '%', FIGURES)
  if (!isStill && anim.tick < anim.pct.flashUntil) {
    const offset = 3 - text.length
    for (let j = anim.pct.flashFrom; j < text.length; j++) {
      const c = cells[offset + j]
      if (c !== undefined) c.fg = HEAD
    }
  }

  return cells
}

type Mode = 'full' | 'short' | 'min'

/** The breadcrumb of the session's position, or the state of a route with none. */
function crumbCells(scene: Scene, anim: Anim, settings: Settings, mode: Mode, isStill: boolean): Cell[] {
  const { chart } = scene
  const { done, total } = topCounts(chart)
  const push = (cells: Cell[], text: string, fg: number): void => {
    cells.push(...textCells(text, fg))
  }
  const cells: Cell[] = []
  if (chart.finishedAt !== null) {
    if (mode === 'full') push(cells, `✓ Complete · ${cut(chart.title, 24)} · ${total}/${total}`, GOLD)
    else if (mode === 'short') push(cells, `✓ Complete · ${total}/${total}`, GOLD)
    else push(cells, `✓ ${total}/${total}`, GOLD)

    return cells
  }
  const path = currentPath(chart)
  if (path.length === 0) {
    const next = nextItem(chart)
    if (next === null) {
      if (mode === 'full') push(cells, cut(chart.title, 24), FIGURES)
      else push(cells, `${done}/${total}`, FIGURES)

      return cells
    }
    const where = `${next.topPos}/${next.topCount}`
    if (mode === 'full') {
      push(cells, cut(chart.title, 24), FIGURES)
      push(cells, ' › ', TRACK)
      push(cells, 'next ', TRACK)
      push(cells, `${where} ${cut(next.item.title, 24)}`, FIGURES)
    } else if (mode === 'short') {
      push(cells, 'next ', TRACK)
      push(cells, `${where} ${cut(next.item.title, 24)}`, FIGURES)
    } else {
      push(cells, 'next ', TRACK)
      push(cells, where, FIGURES)
    }

    return cells
  }

  if (mode === 'full') push(cells, cut(chart.title, 24), FIGURES)
  let shimmerFrom = -1
  path.forEach((entry, idx) => {
    const isLeaf = idx === path.length - 1
    if (cells.length > 0) push(cells, ' › ', TRACK)
    if (isLeaf && entry.item.status === 'blocked') push(cells, '⊘ ', FAIL)
    const posText = idx === 0 && !isStill ? String(anim.stage.shown) : String(entry.pos)
    const posStart = cells.length
    push(cells, `${posText}/${entry.count}`, FIGURES)
    if (idx === 0 && !isStill && anim.tick < anim.stage.flashUntil) {
      for (let j = anim.stage.flashFrom; j < posText.length; j++) {
        const c = cells[posStart + j]
        if (c !== undefined) c.fg = HEAD
      }
    }
    if (isLeaf) shimmerFrom = posStart
    if (mode === 'full' || (mode === 'short' && isLeaf)) {
      push(cells, ' ', FIGURES)
      if (isLeaf) shimmerFrom = cells.length
      push(cells, cut(entry.item.title, 24), isLeaf ? DEFAULT : FIGURES)
    }
  })
  const leaf = path[path.length - 1]?.item
  if (leaf !== undefined && leaf.phase !== null) {
    push(cells, ' › ', TRACK)
    const { effects } = settings
    const isBusy = scene.isWorking || scene.agents.length + scene.checks.length > 0
    const dim = effects.activity && !isStill && isBusy && Math.floor(anim.tick / DOT_BREATHE) % 2 === 1
    cells.push(cellOf(GLYPH.dot, dim ? mixColor(LIVE, TRACK, 0.5) : LIVE))
    push(cells, ' ' + cut(leaf.phase, 16), LIVE)
  }
  // A shimmer runs over the current step while a subagent or a check works.
  if (settings.effects.activity && !isStill && scene.agents.length + scene.checks.length > 0 && shimmerFrom >= 0) {
    const n = cells.length - shimmerFrom
    const h = (anim.tick % (n + 2 * SHIMMER_PAD)) - SHIMMER_PAD
    for (let i = 0; i < n; i++) {
      const c = cells[shimmerFrom + i]
      if (c === undefined) continue
      const d = Math.abs(i - h)
      const base = c.fg === DEFAULT ? 0xbcbcbc : c.fg
      if (d === 0) c.fg = mixColor(base, WHITE, 0.5)
      else if (d === 1) c.fg = mixColor(base, WHITE, 0.25)
    }
  }

  return cells
}

/** The signal beside the breadcrumb, by priority; empty when there is none. */
function tailCells(scene: Scene, anim: Anim, settings: Settings, isShort: boolean, isStill: boolean): Cell[] {
  const cap = isShort ? 16 : 28
  const cells: Cell[] = []
  const add = (text: string, fg: number): void => {
    cells.push(...textCells(text, fg))
  }
  const spins = settings.effects.activity && !isStill
  const badge = anim.badge
  if (!isStill && badge.kind !== 'none' && anim.tick < badge.until) {
    add(cut(badge.text, cap), badge.color)

    return cells
  }
  const check = scene.checks[0]
  if (check !== undefined) {
    const glyph = spins ? (GLYPH.checkSpin[Math.floor(anim.tick / 2) % GLYPH.checkSpin.length] ?? GLYPH.checkStill) : GLYPH.checkStill
    cells.push(cellOf(glyph, GOLD))
    add(' ' + cut(check.label, cap), FIGURES)

    return cells
  }
  const agent = scene.agents[scene.agents.length - 1]
  if (agent !== undefined) {
    const glyph = spins ? (GLYPH.agentSpin[Math.floor(anim.tick / 4) % GLYPH.agentSpin.length] ?? GLYPH.agentSpin[0] ?? 0x25d0) : 0x25d0
    cells.push(cellOf(glyph, LIVE))
    add(' ' + cut(agent.description, cap), FIGURES)
    if (!isShort && scene.agents.length > 1) add(` +${scene.agents.length - 1}`, FIGURES)

    return cells
  }
  const last = scene.lastCheck
  if (last !== null) {
    cells.push(cellOf(last.ok === true ? GLYPH.check : GLYPH.cross, last.ok === true ? OK : FAIL))
    add(' ' + cut(last.label, cap), FIGURES)

    return cells
  }
  const peers = (scene.share?.peers ?? []).filter(p => p.isLive)
  const first = peers[0]
  if (first !== undefined) {
    if (peers.length === 1) {
      cells.push(cellOf(GLYPH.peers, first.color))
      cells.push(cellOf(0x20, FIGURES))
      add(first.label, first.color)
      if (!isShort) {
        const found = first.current === null ? null : (findItem(scene.chart, first.current)?.item.title ?? null)
        add(' · ', FIGURES)
        add(cut(found ?? 'idle', cap), FIGURES)
      }
    } else if (isShort) {
      cells.push(cellOf(GLYPH.peers, first.color))
      add(` ${peers.length}`, FIGURES)
    } else {
      cells.push(cellOf(GLYPH.peers, first.color))
      add(` ${peers.length} sessions`, FIGURES)
    }
  }

  return cells
}

// ---- the row -----------------------------------------------------------------------------------------------

/**
 * The band's row, exactly `cols` cells: the first of the layouts that fits (the track and the full breadcrumb with
 * the signal, then the breadcrumb and the signal shortened while the track keeps at least 10 cells, and only then
 * the track dropped, down to the percent and the bare counters, cut with `…` at the end).
 */
export function composeRow(scene: Scene, anim: Anim, settings: Settings, cols: number, isStill: boolean): Cell[] {
  const Rw = clamp(Math.round(cols * 0.2), 12, 28)
  const P = percentCells(scene, anim, isStill)
  const Cfull = crumbCells(scene, anim, settings, 'full', isStill)
  const Cshort = crumbCells(scene, anim, settings, 'short', isStill)
  const Cmin = crumbCells(scene, anim, settings, 'min', isStill)
  const Sfull = tailCells(scene, anim, settings, false, isStill)
  const Sshort = tailCells(scene, anim, settings, true, isStill)

  const build = (track: number | null, crumbs: Cell[], tail: Cell[]): Cell[] => {
    const out: Cell[] = []
    if (track !== null) {
      out.push(...composeTrack(scene, anim, settings, track, isStill))
      out.push(...blank(1))
    }
    out.push(...P)
    out.push(...blank(2))
    out.push(...crumbs)
    if (tail.length > 0) {
      out.push(...blank(2))
      out.push(...tail)
    }

    return out
  }

  const candidates: (() => Cell[])[] = [
    () => build(Rw, Cfull, Sfull),
    () => build(Rw, Cfull, Sshort),
    () => build(10, Cfull, Sshort),
    () => build(10, Cshort, Sshort),
    () => build(10, Cshort, []),
    () => build(null, Cshort, Sshort),
    () => build(null, Cshort, []),
    () => build(null, Cmin, []),
  ]
  let row: Cell[] | null = null
  for (const make of candidates) {
    const cells = make()
    if (cells.length <= cols) {
      row = cells
      break
    }
  }
  if (row === null) {
    const cells = build(null, Cmin, [])
    row = cols <= 0 ? [] : [...cells.slice(0, cols - 1), cellOf(GLYPH.ellipsis, FIGURES)]
  }
  while (row.length < cols) row.push(...blank(1))

  return row
}
