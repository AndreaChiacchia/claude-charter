/** The terminal's default color, as a Raster cell holds it (bit 24 alone). */
export const DEFAULT = 0x01000000

/** Empty track, separators, pending. */
export const TRACK = 0x585858
/** The empty track of the heavy style: a dim ━. */
export const TRACK_HEAVY = 0x444444
/** Ancestors, counters, percent, tail text, end cap. */
export const FIGURES = 0x8a8a8a
/** The filled track (the teal of claudeticker's ramp). */
export const FILL = 0x00afaf
/** A passed stage marker. */
export const MARK_DONE = 0x5fd7d7
/** The progress head, its trail, the roll flash and the commit badge: the siblings' warm white-gold glint. */
export const HEAD = 0xfff5d7
/** Stage and completion glints and badges, the end cap when complete, the check spinner. */
export const GOLD = 0xffd700
/** The phase dot and name, the agent spinner: the siblings' lavender. */
export const LIVE = 0xafafd7
/** A check mark and the badge of a finished item. */
export const OK = 0x5fff00
/** A cross and a blocked mark. */
export const FAIL = 0xff0000
/** The shimmer target. */
export const WHITE = 0xffffff

/** The colors of other sessions, assigned by their join order: amber, steel blue, pink, green. */
export const PEER_COLORS: readonly number[] = [0xd7af5f, 0x87afd7, 0xd787af, 0x87d787]

/** How far a stage another session holds is tinted toward that session's color. */
export const TINT_MIX = 0.55

/** Glyphs by code point. */
export const GLYPH = {
  full: 0x2501,
  empty: 0x2500,
  markDone: 0x25c6,
  markTodo: 0x25c7,
  head: 0x25ba,
  end: 0x252b,
  start: 0x2523,
  commit: 0x25c8,
  sep: 0x203a,
  dot: 0x25cf,
  check: 0x2713,
  cross: 0x2717,
  blocked: 0x2298,
  spark1: 0x2726,
  spark2: 0x2727,
  ellipsis: 0x2026,
  pending: 0x25cb,
  current: 0x25b8,
  activeOther: 0x25b9,
  skipped: 0x2013,
  peers: 0x21c4,
  agentSpin: [0x25d0, 0x25d3, 0x25d1, 0x25d2] as readonly number[],
  checkSpin: [0x280b, 0x2819, 0x2839, 0x2838, 0x283c, 0x2834, 0x2826, 0x2827, 0x2807, 0x280f] as readonly number[],
  checkStill: 0x283f,
}

/** The left blocks by eighths of a cell filled (index 0: none, then ▏ ▎ ▍ ▌ ▋ ▊ ▉). */
export const EIGHTHS: readonly number[] = [0, 0x258f, 0x258e, 0x258d, 0x258c, 0x258b, 0x258a, 0x2589]

/** The ids of the track styles. */
export type TrackStyleId =
  | 'heavy'
  | 'line'
  | 'smooth'
  | 'blocks'
  | 'shade'
  | 'parallelogram'
  | 'squares'
  | 'dots'
  | 'braille'
  | 'ascii'

/** The glyphs and colors of one track style. */
export type TrackStyle = {
  /** The filled-track glyph. */
  fill: number
  /** The empty-track glyph. */
  empty: number
  /** The color of the empty-track glyph. */
  emptyColor: number
  /** The start cap. */
  start: number
  /** The end cap. */
  end: number
  /** A passed stage marker. */
  markDone: number
  /** A stage marker still to come. */
  markTodo: number
  /** The head glyph (this session's and the other sessions'). */
  head: number
  /** The two glyphs of the twinkle. */
  spark: readonly [number, number]
  /** The fill edge is drawn by eighths of a cell. */
  isSmooth: boolean
}

/** The track style ids, in the order of plugin.json. */
export const TRACK_STYLE_IDS: readonly TrackStyleId[] = [
  'heavy',
  'line',
  'smooth',
  'blocks',
  'shade',
  'parallelogram',
  'squares',
  'dots',
  'braille',
  'ascii',
]

/** The style used when the setting holds anything else. */
export const DEFAULT_TRACK_STYLE: TrackStyleId = 'heavy'

/** True when `v` is the id of a track style. */
export function isTrackStyle(v: unknown): v is TrackStyleId {
  return typeof v === 'string' && (TRACK_STYLE_IDS as readonly string[]).includes(v)
}

/** The ids of the track ends choices. */
export type TrackEndsId = 'auto' | 'capsule' | 'start-finish' | 'tapered' | 'half-blocks' | 'brackets' | 'corners' | 'shells'

/** The track ends ids, in the order of plugin.json. */
export const TRACK_ENDS_IDS: readonly TrackEndsId[] = [
  'auto',
  'capsule',
  'start-finish',
  'tapered',
  'half-blocks',
  'brackets',
  'corners',
  'shells',
]

/** The choice used when the setting holds anything else. */
export const DEFAULT_TRACK_ENDS: TrackEndsId = 'capsule'

/** True when `v` is the id of a track ends choice. */
export function isTrackEnds(v: unknown): v is TrackEndsId {
  return typeof v === 'string' && (TRACK_ENDS_IDS as readonly string[]).includes(v)
}

/** The start and end caps of every track ends choice; null (auto) keeps the style's own. */
export const TRACK_ENDS: Record<TrackEndsId, { start: number; end: number } | null> = {
  auto: null,
  capsule: { start: 0x25d6, end: 0x25d7 },
  'start-finish': { start: 0x25c9, end: 0x25ce },
  tapered: { start: 0x257a, end: 0x2578 },
  'half-blocks': { start: 0x2590, end: 0x258c },
  brackets: { start: 0x5b, end: 0x5d },
  // Halfwidth corner brackets ｢ ｣: one cell, unlike the wide 「 」.
  corners: { start: 0xff62, end: 0xff63 },
  // Tortoise shell bracket ornaments ❲ ❳: one cell, unlike the wide 〔 〕.
  shells: { start: 0x2772, end: 0x2773 },
}

const SPARKS: readonly [number, number] = [0x2726, 0x2727]
/** The caps of every block-like style: mirrored half blocks ▐ … ▌ hugging the bar. */
const BAR_START = 0x2590
const BAR_END = 0x258c

const blockStyle = (fill: number, empty: number, isSmooth = false): TrackStyle => ({
  fill,
  empty,
  emptyColor: TRACK,
  start: BAR_START,
  end: BAR_END,
  markDone: 0x25c6,
  markTodo: 0x25c7,
  head: 0x25ba,
  spark: SPARKS,
  isSmooth,
})

/** Every track style by id. */
export const TRACK_STYLES: Record<TrackStyleId, TrackStyle> = {
  heavy: {
    fill: 0x2501,
    empty: 0x2501,
    emptyColor: TRACK_HEAVY,
    start: 0x2523,
    end: 0x252b,
    markDone: 0x25c6,
    markTodo: 0x25c7,
    head: 0x25ba,
    spark: SPARKS,
    isSmooth: false,
  },
  line: {
    fill: 0x2501,
    empty: 0x2500,
    emptyColor: TRACK,
    start: 0x2520,
    end: 0x2528,
    markDone: 0x25c6,
    markTodo: 0x25c7,
    head: 0x25ba,
    spark: SPARKS,
    isSmooth: false,
  },
  smooth: blockStyle(0x2588, 0x2591, true),
  blocks: blockStyle(0x2588, 0x2591),
  shade: blockStyle(0x2593, 0x2591),
  parallelogram: blockStyle(0x25b0, 0x25b1),
  squares: blockStyle(0x25a0, 0x25a1),
  dots: blockStyle(0x25cf, 0x25cb),
  braille: blockStyle(0x28ff, 0x28c0),
  ascii: {
    fill: 0x23,
    empty: 0x2d,
    emptyColor: TRACK,
    start: 0x5b,
    end: 0x5d,
    markDone: 0x2b,
    markTodo: 0x2b,
    head: 0x3e,
    spark: [0x2a, 0x2b],
    isSmooth: false,
  },
}

/** `color` moved `amount` (0..1) toward white, per channel; the terminal default stays as it is. */
export function lighten(color: number, amount: number): number {
  if (color === DEFAULT) return DEFAULT
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  const up = (c: number): number => Math.round(c + (255 - c) * amount)

  return (up(r) << 16) | (up(g) << 8) | up(b)
}

/** `a` blended into `b` by `t` (0..1), per channel. A side that is the terminal default cannot blend: it switches at the half. */
export function mixColor(a: number, b: number, t: number): number {
  if (a === DEFAULT || b === DEFAULT) return t < 0.5 ? a : b
  const mix = (shift: number): number => {
    const ca = (a >> shift) & 0xff
    const cb = (b >> shift) & 0xff

    return Math.round(ca + (cb - ca) * t)
  }

  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}

/** `#rrggbb` for Text; undefined for the terminal default. */
export function hex(color: number): string | undefined {
  if (color === DEFAULT) return undefined

  return '#' + (color & 0xffffff).toString(16).padStart(6, '0')
}

export type Cell = { cp: number; fg: number; bg: number }

const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6)

const isZeroWidth = (cp: number): boolean => (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200f)

const isUnsafe = (cp: number): boolean =>
  cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp > 0xffff || isZeroWidth(cp) || isWide(cp)

/** A code point a Raster takes; anything it would refuse (control, wide, zero-width, beyond the BMP) becomes `?`. */
export function safeCp(cp: number): number {
  return isUnsafe(cp) ? 0x3f : cp
}

/** One cell per code point of `text`, each through `safeCp`. */
export function textCells(text: string, fg: number, bg: number = DEFAULT): Cell[] {
  const cells: Cell[] = []
  for (const ch of text) {
    cells.push({ cp: safeCp(ch.codePointAt(0) ?? 0x3f), fg, bg })
  }

  return cells
}

/** `n` spaces on `bg`. */
export function blank(n: number, bg: number = DEFAULT): Cell[] {
  const cells: Cell[] = []
  for (let i = 0; i < n; i++) cells.push({ cp: 0x20, fg: DEFAULT, bg })

  return cells
}

/** The Raster's `cells` prop: little-endian u32 triplets [code point, foreground, background], in base64. */
export function encodeCells(cells: Cell[]): string {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach((cell, i) => {
    words[i * 3] = cell.cp
    words[i * 3 + 1] = cell.fg
    words[i * 3 + 2] = cell.bg
  })
  const bytes = new Uint8Array(words.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(binary)
}

/** The inverse of `encodeCells`. */
export function decodeCells(b64: string): Cell[] {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const words = new Uint32Array(bytes.buffer)
  const cells: Cell[] = []
  for (let i = 0; i + 2 < words.length; i += 3) {
    cells.push({ cp: words[i] ?? 0, fg: words[i + 1] ?? 0, bg: words[i + 2] ?? 0 })
  }

  return cells
}

export type Run = { text: string; fg: number; bg: number }

/** Trailing default-background spaces dropped, then equal neighbours merged: the cells as colored Text runs. */
export function runs(cells: Cell[]): Run[] {
  let end = cells.length
  while (end > 0) {
    const last = cells[end - 1]
    if (last !== undefined && last.cp === 0x20 && last.bg === DEFAULT) end--
    else break
  }
  const out: Run[] = []
  for (let i = 0; i < end; i++) {
    const cell = cells[i]
    if (cell === undefined) continue
    const prev = out[out.length - 1]
    const ch = String.fromCodePoint(cell.cp)
    if (prev !== undefined && prev.fg === cell.fg && prev.bg === cell.bg) prev.text += ch
    else out.push({ text: ch, fg: cell.fg, bg: cell.bg })
  }

  return out
}
