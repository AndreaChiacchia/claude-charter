import { expect, test } from 'claude-code/testing'

import type { Chart, ChartItem, CheckRun, CrewMember, Peer } from '../types'
import { BEACON_MIX, DOT_BREATHE, createAnim, fillValue, headValue, syncTargets } from '../hooks/anim'
import type { Anim, Scene } from '../hooks/anim'
import {
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
  PEER_COLORS,
  TINT_MIX,
  TRACK,
  TRACK_HEAVY,
  TRACK_STYLES,
  TRACK_STYLE_IDS,
  WHITE,
  lighten,
  mixColor,
} from '../hooks/cells'
import type { Cell } from '../hooks/cells'
import { progress } from '../hooks/route'
import {
  DEFAULT_COLUMNS,
  HINT_INDENT,
  OPEN_GLYPH,
  OPEN_HOTKEY,
  OPEN_KEY,
  PROBE_KEY,
  composeRow,
  composeTrack,
  normalizeSettings,
  openCells,
  ownIndex,
  posOf,
} from '../hooks/row'
import { fixtureChart, item } from './fixture'

const S = normalizeSettings({})
const text = (cells: Cell[]): string => cells.map(c => String.fromCodePoint(c.cp)).join('')
const trimmed = (cells: Cell[]): string => text(cells).replace(/ +$/, '')

const scene = (over: Partial<Scene> = {}): Scene => ({
  chart: fixtureChart(),
  share: null,
  agents: [],
  checks: [],
  lastCheck: null,
  commit: null,
  isWorking: false,
  ...over,
})

const agent = (id: string, description: string, startedAt = 0): CrewMember => ({
  id,
  description,
  type: 'general-purpose',
  model: 'sonnet',
  startedAt,
  endedAt: null,
  word: null,
})

const check = (over: Partial<CheckRun> = {}): CheckRun => ({
  id: 'c1',
  label: 'npm test',
  startedAt: 0,
  endedAt: null,
  ok: null,
  isBackground: false,
  ...over,
})

const peer = (label: string, current: string | null, over: Partial<Peer> = {}): Peer => ({
  sessionId: label + '0000',
  label,
  color: PEER_COLORS[0] ?? 0,
  isLive: true,
  seenAt: 0,
  current,
  holds: [],
  ...over,
})

const shareWith = (...peers: Peer[]) => ({ chartId: 'c1', meLabel: 'aaaa', peers, held: {}, unclaimed: [], myHolds: [] })

const closeAll = (items: ChartItem[]): ChartItem[] =>
  items.map(i => ({ ...i, status: 'done' as const, phase: null, items: closeAll(i.items) }))

const finished = (): Chart => ({ ...fixtureChart(), items: closeAll(fixtureChart().items), current: null, finishedAt: 9 })

/** An animation synced to the scene with every position snapped, as a still frame would leave it. */
const primed = (sc: Scene): Anim => {
  const a = createAnim()
  syncTargets(a, sc, S, true)

  return a
}

test('the settings default to all on, mirror off', async () => {
  expect(S.effects).toEqual({ glide: true, roll: true, activity: true, celebrate: true })
  expect(S.toast).toBe(true)
  expect(S.nudge).toBe(true)
  expect(normalizeSettings({ nudge: 'off' }).nudge).toBe(false)
  expect(S.mirror).toBe(false)
  expect(S.mirrorFile).toBe('PROGRESS.md')
  const custom = normalizeSettings({ glide: 'off', toast: 'off', mirror: 'on', mirrorFile: 'docs/route.md' })
  expect(custom.effects.glide).toBe(false)
  expect(custom.effects.roll).toBe(true)
  expect(custom.toast).toBe(false)
  expect(custom.mirror).toBe(true)
  expect(custom.mirrorFile).toBe('docs/route.md')
  expect(S.placement).toBe('under')
  expect(S.track).toBe('heavy')
  expect(S.trackEnds).toBe('capsule')
  expect(normalizeSettings({ trackEnds: 'corners' }).trackEnds).toBe('corners')
  expect(normalizeSettings({ trackEnds: 'auto' }).trackEnds).toBe('auto')
  expect(normalizeSettings({ trackEnds: 'arrows' }).trackEnds).toBe('capsule')
  expect(normalizeSettings({ trackEnds: 7 }).trackEnds).toBe('capsule')
  expect(S.gapBelow).toBe(true)
  expect(normalizeSettings({ gapBelow: 'off' }).gapBelow).toBe(false)
  expect(normalizeSettings({ gapBelow: 'on' }).gapBelow).toBe(true)
  const placed = normalizeSettings({ placement: 'above', track: 'ascii' })
  expect(placed.placement).toBe('above')
  expect(placed.track).toBe('ascii')
  expect(normalizeSettings({ placement: 'panel' }).placement).toBe('panel')
  const unknown = normalizeSettings({ placement: 'side', track: 'diamonds' })
  expect(unknown.placement).toBe('under')
  expect(unknown.track).toBe('heavy')
})

test('where a session stands on the route', async () => {
  const f = fixtureChart()
  expect(Math.abs(posOf(f, 'S2.P2') - 0.28889) < 0.0001).toBe(true)
  expect(posOf(f, 'S4')).toBe(0.6)
  expect(Math.abs(posOf(f, null) - posOf(f, 'S2.P2')) < 1e-9).toBe(true)
  expect(posOf(f, 'nope')).toBe(posOf(f, null))
})

test('the track at two widths', async () => {
  const sc = scene()
  const wide = composeTrack(sc, createAnim(), S, 24, true)
  expect(text(wide)).toBe('◖━━━◆━━►━◇━━━◇━━━━◇━━━━◗')
  expect(wide.length).toBe(24)
  expect(text(composeTrack(sc, createAnim(), S, 10, true))).toBe('◖━━►━━━━━◗')
  // The capsule caps wear the colour of the bar beside them; filled cells teal, the head warm white, the empty track a
  // dim heavy line, markers by passed or to come.
  expect(wide[0]?.cp).toBe(0x25d6)
  expect(wide[0]?.fg).toBe(FILL)
  expect(wide[1]?.fg).toBe(FILL)
  expect(wide[4]?.cp).toBe(GLYPH.markDone)
  expect(wide[7]?.fg).toBe(HEAD)
  expect(wide[8]?.fg).toBe(TRACK_HEAVY)
  expect(wide[9]?.cp).toBe(GLYPH.markTodo)
  expect(wide[9]?.fg).toBe(TRACK)
  expect(wide[23]?.cp).toBe(0x25d7)
  expect(wide[23]?.fg).toBe(TRACK_HEAVY)
})

test('another session shows as a marker in its color', async () => {
  const sc = scene({ share: shareWith(peer('cd34', 'S4')) })
  const track = composeTrack(sc, createAnim(), S, 24, true)
  expect(text(track)).toBe('◖━━━◆━━►━◇━━━◇►━━━◇━━━━◗')
  expect(track[14]?.fg).toBe(PEER_COLORS[0])
  expect(track[7]?.fg).toBe(HEAD)
  // An idle peer or one with no step leaves no marker.
  const none = scene({ share: shareWith(peer('cd34', null), peer('ef56', 'S4', { isLive: false })) })
  expect(text(composeTrack(none, createAnim(), S, 24, true))).toBe('◖━━━◆━━►━◇━━━◇━━━━◇━━━━◗')
})

const atS4 = (): Chart => ({ ...fixtureChart(), current: 'S4' })

test('every style draws its caps and glyphs', async () => {
  const sc = scene()
  for (const id of TRACK_STYLE_IDS) {
    const track = composeTrack(sc, createAnim(), normalizeSettings({ track: id, trackEnds: 'auto' }), 24, true)
    expect(track.length).toBe(24)
    expect(track[0]?.cp).toBe(TRACK_STYLES[id].start)
    expect(track[23]?.cp).toBe(TRACK_STYLES[id].end)
    // The default ends are one cell each, whatever the style.
    expect(composeTrack(sc, createAnim(), normalizeSettings({ track: id }), 24, true).length).toBe(24)
  }
  const draw = (id: string, chart?: Chart): string =>
    text(
      composeTrack(
        chart === undefined ? sc : scene({ chart }),
        createAnim(),
        normalizeSettings({ track: id, trackEnds: 'auto' }),
        24,
        true,
      ),
    )
  expect(draw('heavy')).toBe('┣━━━◆━━►━◇━━━◇━━━━◇━━━━┫')
  expect(draw('line')).toBe('┠━━━◆━━►─◇───◇────◇────┨')
  expect(draw('blocks')).toBe('▐███◆██►░◇░░░◇░░░░◇░░░░▌')
  expect(draw('ascii')).toBe('[###+##>-+---+----+----]')
  // The smooth fill edge is an eighth block.
  const smooth = composeTrack(
    scene({ chart: atS4() }),
    createAnim(),
    normalizeSettings({ track: 'smooth', trackEnds: 'auto' }),
    24,
    true,
  )
  expect(text(smooth)).toBe('▐███◆██▍░◇░░░◇►░░░◇░░░░▌')
  expect(smooth[7]?.cp).toBe(EIGHTHS[3])
  expect(smooth[7]?.fg).toBe(FILL)
})

test('every track ends choice draws its glyphs on the heavy style and on a block style', async () => {
  const sc = scene()
  const heavy = '━━━◆━━►━◇━━━◇━━━━◇━━━━'
  const blocks = '███◆██►░◇░░░◇░░░░◇░░░░'
  const ends: Record<string, [string, string]> = {
    capsule: ['◖', '◗'],
    'start-finish': ['◉', '◎'],
    tapered: ['╺', '╸'],
    'half-blocks': ['▐', '▌'],
    brackets: ['[', ']'],
    corners: ['｢', '｣'],
    shells: ['❲', '❳'],
  }
  for (const [id, [start, end]] of Object.entries(ends)) {
    const onHeavy = composeTrack(sc, createAnim(), normalizeSettings({ track: 'heavy', trackEnds: id }), 24, true)
    expect(text(onHeavy)).toBe(start + heavy + end)
    expect(onHeavy.length).toBe(24)
    const onBlocks = composeTrack(sc, createAnim(), normalizeSettings({ track: 'blocks', trackEnds: id }), 24, true)
    expect(text(onBlocks)).toBe(start + blocks + end)
    expect(onBlocks.length).toBe(24)
  }
  // The default is the capsule.
  expect(text(composeTrack(sc, createAnim(), normalizeSettings({}), 24, true))).toBe('◖' + heavy + '◗')
  // auto keeps each style's own caps.
  const auto = (track: string): string =>
    text(composeTrack(sc, createAnim(), normalizeSettings({ track, trackEnds: 'auto' }), 24, true))
  expect([auto('heavy')[0], auto('heavy')[23]]).toEqual(['┣', '┫'])
  expect([auto('line')[0], auto('line')[23]]).toEqual(['┠', '┨'])
  expect([auto('blocks')[0], auto('blocks')[23]]).toEqual(['▐', '▌'])
  expect([auto('ascii')[0], auto('ascii')[23]]).toEqual(['[', ']'])
})

test('the capsule caps wear the colour of the bar beside them, the other ends keep the figures grey', async () => {
  const sc = scene()
  const capsule = normalizeSettings({})
  // Progress beyond 0: the start is the fill colour, the end the track colour.
  const part = composeTrack(sc, createAnim(), capsule, 24, true)
  expect(part[0]?.fg).toBe(FILL)
  expect(part[23]?.fg).toBe(TRACK_HEAVY)
  // At 0% (the head sits on the first cell) the start is the track colour too.
  const empty = composeTrack(sc, createAnim(), capsule, 24, false)
  expect(empty[1]?.cp).toBe(GLYPH.head)
  expect(empty[0]?.fg).toBe(TRACK_HEAVY)
  expect(empty[23]?.fg).toBe(TRACK_HEAVY)
  // A full bar before the route is finished: the end takes the fill colour.
  const full = createAnim()
  full.fill = { from: 1, to: 1, start: 0 }
  full.head = { from: 0.5, to: 0.5, start: 0 }
  const whole = composeTrack(sc, full, capsule, 24, false)
  expect(whole[0]?.fg).toBe(FILL)
  expect(whole[23]?.fg).toBe(FILL)
  // On the other styles the empty track colour follows the style.
  const blocks = composeTrack(sc, createAnim(), normalizeSettings({ track: 'blocks' }), 24, true)
  expect(blocks[0]?.fg).toBe(FILL)
  expect(blocks[23]?.fg).toBe(TRACK)
  // Every other choice keeps the figures grey.
  for (const id of ['start-finish', 'tapered', 'half-blocks', 'brackets', 'corners', 'shells', 'auto']) {
    const track = composeTrack(sc, createAnim(), normalizeSettings({ trackEnds: id }), 24, true)
    expect(track[0]?.fg).toBe(FIGURES)
    expect(track[23]?.fg).toBe(FIGURES)
  }
})

test('a finished route gilds the caps of every ends choice, and the pulse and the beacon still find them', async () => {
  const done = scene({ chart: finished() })
  for (const id of ['auto', 'capsule', 'start-finish', 'tapered', 'half-blocks', 'brackets', 'corners', 'shells']) {
    const settings = normalizeSettings({ trackEnds: id })
    const track = composeTrack(done, createAnim(), settings, 24, true)
    expect(track[0]?.fg).toBe(GOLD)
    expect(track[23]?.fg).toBe(GOLD)
    const pulsing = createAnim()
    pulsing.pulse = { start: 0 }
    pulsing.tick = 2
    const lit = composeTrack(done, pulsing, settings, 24, false)
    expect(lit[0]?.fg).toBe(lighten(GOLD, 0.55))
    expect(lit[23]?.fg).toBe(lighten(GOLD, 0.55))
  }
  // In the last stage the beacon breathes on the end cap of a non-capsule choice, from the figures grey.
  const last = scene({ isWorking: true, chart: { ...fixtureChart(), current: 'S5' } })
  const a = primed(last)
  a.tick = 16
  const track = composeTrack(last, a, normalizeSettings({ trackEnds: 'corners' }), 24, false)
  expect(track[23]?.cp).toBe(0xff63)
  expect(track[23]?.fg).toBe(mixColor(FIGURES, MARK_DONE, BEACON_MIX))
})

test('the smooth edge glides by eighths', async () => {
  const smooth = normalizeSettings({ track: 'smooth' })
  const sc = scene({ chart: atS4() })
  const a = primed(sc)
  a.fill = { from: 0.25, to: progress(sc.chart), start: 0 }
  a.tick = 4
  const e8 = Math.round(fillValue(a) * 22 * 8)
  expect(e8 % 8 > 0).toBe(true)
  const track = composeTrack(sc, a, smooth, 24, false)
  expect(track[Math.floor(e8 / 8) + 1]?.cp).toBe(EIGHTHS[e8 % 8])
})

test('a stage another session holds is tinted', async () => {
  const hold = (node: string, isMe = false) => ({
    ...shareWith(peer('cd34', 'S4')),
    held: { [node]: { sessionId: 'cd340000', label: 'cd34', color: PEER_COLORS[0] ?? 0, node, force: false, isMe } },
  })
  const track = composeTrack(scene({ share: hold('S4') }), createAnim(), S, 24, true)
  expect(text(track)).toBe('◖━━━◆━━►━◇━━━◇►━━━◇━━━━◗')
  const tinted = mixColor(TRACK_HEAVY, PEER_COLORS[0] ?? 0, TINT_MIX)
  expect(track[14]?.fg).toBe(PEER_COLORS[0])
  expect([15, 16, 17].every(i => track[i]?.fg === tinted)).toBe(true)
  expect(track[18]?.fg).toBe(mixColor(TRACK, PEER_COLORS[0] ?? 0, TINT_MIX))
  expect(track[13]?.fg).toBe(TRACK)
  expect(track[19]?.fg).toBe(TRACK_HEAVY)
  // A hold of this session, or one on a part, tints nothing.
  const mine = composeTrack(scene({ share: hold('S4', true) }), createAnim(), S, 24, true)
  expect([15, 16, 17, 18].every(i => mine[i]?.fg === (i === 18 ? TRACK : TRACK_HEAVY))).toBe(true)
  const part = composeTrack(scene({ share: hold('S2.P3') }), createAnim(), S, 24, true)
  expect([15, 16, 17, 18].every(i => part[i]?.fg === (i === 18 ? TRACK : TRACK_HEAVY))).toBe(true)
})

test('the comet brightens the fill toward the head', async () => {
  const sc = scene()
  const comet = composeTrack(sc, primed(sc), S, 24, false)
  expect(comet[6]?.fg).toBe(mixColor(FILL, HEAD, 0.4))
  expect(comet[5]?.fg).toBe(mixColor(FILL, HEAD, 0.28))
  expect(comet[4]?.fg).toBe(MARK_DONE)
  expect(comet[3]?.fg).toBe(mixColor(FILL, HEAD, 0.1))
  expect(comet[2]?.fg).toBe(mixColor(FILL, HEAD, 0.04))
  expect(comet[1]?.fg).toBe(FILL)
  const flat = (cells: Cell[]): boolean => [1, 2, 3, 5, 6].every(i => cells[i]?.fg === FILL)
  expect(flat(composeTrack(sc, primed(sc), normalizeSettings({ glide: 'off' }), 24, false))).toBe(true)
  expect(flat(composeTrack(sc, primed(sc), S, 24, true))).toBe(true)
})

test('a backward glide draws no trail', async () => {
  const sc = scene()
  const L = 22
  const trailCell = (from: number, to: number): Cell | undefined => {
    const a = primed(sc)
    a.head = { from, to, start: 0 }
    a.fill = { from, to, start: 0 }
    a.tick = 4
    const headAt = Math.min(L - 1, Math.round(headValue(a) * L))

    return composeTrack(sc, a, S, 24, false)[headAt]
  }
  // Forward: the bright trail sits right behind the head.
  expect(trailCell(0.1, 0.5)?.fg).toBe(mixColor(FILL, HEAD, 0.6))
  // Back: only the static comet, no trail on the side the head moves toward.
  expect(trailCell(0.5, 0.1)?.fg).not.toBe(mixColor(FILL, HEAD, 0.6))
})

test('a route of one stage has no stage marker', async () => {
  const PH6 = ['plan', 'approve', 'implement', 'checks', 'accept', 'commit']
  const one = (items: ChartItem[] = []): Chart => ({
    title: 'M1',
    items: [item('T1', 'Build it', 'active', { phases: PH6, phase: 'approve', items })],
    current: 'T1',
    startedAt: 0,
    updatedAt: 0,
    finishedAt: null,
    revision: 1,
  })
  const track = '◖' + '━'.repeat(4) + '►' + '━'.repeat(17) + '◗'
  const still = composeTrack(scene({ chart: one() }), createAnim(), S, 24, true)
  expect(still.some(c => c.cp === 0x25c6 || c.cp === 0x25c7)).toBe(false)
  expect(still.filter(c => c.cp === 0x25ba).length).toBe(1)
  expect(text(still)).toBe(track)
  const row = composeRow(scene({ chart: one() }), createAnim(), S, 120, true)
  expect(trimmed(row)).toBe(track + '  16%  M1 › 1/1 Build it › ● approve')
  // With three pending parts under it: still no marker, 4%, the head one cell in.
  const parts = [item('T1.P1', 'One', 'pending'), item('T1.P2', 'Two', 'pending'), item('T1.P3', 'Three', 'pending')]
  const split = composeTrack(scene({ chart: one(parts) }), createAnim(), S, 24, true)
  expect(split.some(c => c.cp === 0x25c6 || c.cp === 0x25c7)).toBe(false)
  expect(text(split)).toBe('◖━►' + '━'.repeat(20) + '◗')
  expect(text(composeRow(scene({ chart: one(parts) }), createAnim(), S, 120, true))).toContain('  4%')
})

test('the next stage marker pulses while Claude works', async () => {
  const working = scene({ isWorking: true })
  const at = (tick: number, cell: number, sc = working, settings = S, isStill = false): number | undefined => {
    const a = primed(sc)
    a.tick = tick

    return composeTrack(sc, a, settings, 24, isStill)[cell]?.fg
  }
  expect(at(0, 9)).toBe(TRACK)
  expect(at(16, 9)).toBe(mixColor(TRACK, MARK_DONE, BEACON_MIX))
  // In the last stage the end cap pulses instead (the capsule's end is the track colour).
  const last = scene({ isWorking: true, chart: { ...fixtureChart(), current: 'S5' } })
  expect(at(16, 23, last)).toBe(mixColor(TRACK_HEAVY, MARK_DONE, BEACON_MIX))
  // Not with the effect off, not while Claude is idle, not in a still frame.
  expect(at(16, 9, working, normalizeSettings({ activity: 'off' }))).toBe(TRACK)
  expect(at(16, 9, scene())).toBe(TRACK)
  expect(at(16, 9, working, S, true)).toBe(TRACK)
})

test('the still row at each width', async () => {
  const still = (cols: number) => composeRow(scene(), createAnim(), S, cols, true)
  const expectRow = (cols: number, row: string) => {
    expect(still(cols).length).toBe(cols)
    expect(trimmed(still(cols))).toBe(row)
  }
  expectRow(120, '◖━━━◆━━►━◇━━━◇━━━━◇━━━━◗  28%  M1.6 › 2/5 Planet catalogue › 2/3 Catalogue UI › ● implement')
  expectRow(80, '◖━━►━━━━━◗  28%  M1.6 › 2/5 Planet catalogue › 2/3 Catalogue UI › ● implement')
  expectRow(60, '◖━━►━━━━━◗  28%  2/5 › 2/3 Catalogue UI › ● implement')
  expectRow(30, ' 28%  2/5 › 2/3 › ● implement')
  expectRow(24, ' 28%  2/5 › 2/3 › ● imp…')
  expect(trimmed(still(120)).length).toBe(91)
  // The phase dot and name are lavender, the leaf title the terminal default.
  const row = still(120)
  const at = text(row).indexOf('● implement')
  expect(row[at]?.fg).toBe(LIVE)
  expect(row[at + 2]?.fg).toBe(LIVE)
  expect(row[text(row).indexOf('Catalogue UI')]?.fg).toBe(0x01000000)
  expect(row[text(row).indexOf('Planet')]?.fg).toBe(FIGURES)
})

test('the track stays while the breadcrumb is shortened, and goes only after it', async () => {
  const still = (cols: number) => composeRow(scene(), createAnim(), S, cols, true)
  // Full crumbs (60) do not fit beside a 10-cell track (77 in all), the short crumbs (36) do: the track is kept.
  const row = still(60)
  expect(row.length).toBe(60)
  expect(row[0]?.cp).toBe(0x25d6)
  expect(row[9]?.cp).toBe(0x25d7)
  expect(text(row).slice(0, 10)).toBe('◖━━►━━━━━◗')
  expect(trimmed(row).endsWith('2/5 › 2/3 Catalogue UI › ● implement')).toBe(true)
  expect(trimmed(row).includes('M1.6')).toBe(false)
  // The track is kept down to the width of a 10-cell track with the short crumbs (53), and goes below it.
  expect(text(still(77)).startsWith('◖━━►━━━━━◗  28%  M1.6 › 2/5 Planet catalogue')).toBe(true)
  expect(text(still(76)).startsWith('◖━━►━━━━━◗  28%  2/5 › 2/3 Catalogue UI')).toBe(true)
  expect(text(still(53)).startsWith('◖━━►━━━━━◗  28%  2/5 › 2/3 Catalogue UI › ● implement')).toBe(true)
  expect(trimmed(still(52))).toBe(' 28%  2/5 › 2/3 Catalogue UI › ● implement')
  // With a subagent: the signal goes before the track does.
  const withAgent = composeRow(scene({ agents: [agent('a1', 'dig')] }), createAnim(), S, 53, true)
  expect(withAgent.length).toBe(53)
  expect(text(withAgent).startsWith('◖━━►━━━━━◗  28%  2/5 › 2/3 Catalogue UI › ● implement')).toBe(true)
  expect(trimmed(withAgent).includes('◐')).toBe(false)
})

test('a subagent, checks and a check result sit at the end of the row', async () => {
  const draw = (sc: Scene, cols = 120) => composeRow(sc, createAnim(), S, cols, true)
  const one = draw(scene({ agents: [agent('a1', 'coverage matrix')] }))
  expect(trimmed(one).endsWith('● implement  ◐ coverage matrix')).toBe(true)
  expect(trimmed(one).length).toBe(110)
  const three = draw(scene({ agents: [agent('a1', 'first', 1), agent('a2', 'second', 2), agent('a3', 'third', 3)] }))
  expect(trimmed(three).endsWith('◐ third +2')).toBe(true)
  const running = draw(scene({ checks: [check()], agents: [agent('a1', 'x')] }))
  expect(trimmed(running).endsWith('⠿ npm test')).toBe(true)
  expect(running[text(running).indexOf('⠿')]?.fg).toBe(GOLD)
  const good = draw(scene({ lastCheck: check({ endedAt: 5, ok: true }) }))
  expect(trimmed(good).endsWith('✓ npm test')).toBe(true)
  expect(good[text(good).indexOf('✓')]?.fg).toBe(OK)
  const bad = draw(scene({ lastCheck: check({ endedAt: 5, ok: false }) }))
  expect(trimmed(bad).endsWith('✗ npm test')).toBe(true)
  expect(bad[text(bad).indexOf('✗')]?.fg).toBe(FAIL)
  // At a narrow width the tail shrinks first, then goes.
  const narrow = draw(scene({ agents: [agent('a1', 'coverage matrix of everything')] }), 100)
  expect(narrow.length).toBe(100)
  expect(text(narrow).startsWith('◖━━►━━━━━◗')).toBe(true)
  expect(trimmed(narrow).endsWith('◐ coverage matrix…')).toBe(true)
})

test('another session in the tail, one name or a count', async () => {
  const one = composeRow(scene({ share: shareWith(peer('cd34', 'S4')) }), createAnim(), S, 120, true)
  expect(trimmed(one).endsWith('  ⇄ cd34 · Polish')).toBe(true)
  const arrow = text(one).indexOf('⇄')
  expect(one[arrow]?.fg).toBe(PEER_COLORS[0])
  const idle = composeRow(scene({ share: shareWith(peer('cd34', null)) }), createAnim(), S, 120, true)
  expect(trimmed(idle).endsWith('⇄ cd34 · idle')).toBe(true)
  const two = composeRow(scene({ share: shareWith(peer('cd34', 'S4'), peer('ef56', 'S3')) }), createAnim(), S, 120, true)
  expect(trimmed(two).endsWith('  ⇄ 2 sessions')).toBe(true)
  // A peer that is not live shows nothing.
  const gone = composeRow(scene({ share: shareWith(peer('cd34', 'S4', { isLive: false })) }), createAnim(), S, 120, true)
  expect(trimmed(gone).includes('⇄')).toBe(false)
})

test('a finished route rests on a gold line', async () => {
  const sc = scene({ chart: finished() })
  const row = composeRow(sc, createAnim(), S, 120, true)
  expect(trimmed(row)).toContain('100%  ✓ Complete · M1.6 · 5/5')
  const from = text(row).indexOf('✓ Complete')
  expect(row.slice(from, from + 23).every(c => c.fg === GOLD)).toBe(true)
  expect(row[text(row).indexOf('◗')]?.fg).toBe(GOLD)
  expect(row[text(row).indexOf('◖')]?.fg).toBe(GOLD)
  // The track stays beside the short line (33 cells); below that the track goes and the short line stays.
  const mid = composeRow(sc, createAnim(), S, 36, true)
  expect(mid.length).toBe(36)
  expect(mid[0]?.cp).toBe(0x25d6)
  expect(mid[9]?.cp).toBe(0x25d7)
  expect(text(mid).slice(10).trimEnd()).toBe(' 100%  ✓ Complete · 5/5')
  expect(trimmed(composeRow(sc, createAnim(), S, 32, true))).toBe('100%  ✓ Complete · 5/5')
  expect(trimmed(composeRow(sc, createAnim(), S, 26, true))).toBe('100%  ✓ Complete · 5/5')
  expect(trimmed(composeRow(sc, createAnim(), S, 20, true))).toBe('100%  ✓ 5/5')
})

test('with no current step the row names the next one', async () => {
  const chart: Chart = {
    ...fixtureChart(),
    items: fixtureChart().items.map((i, k) => (k < 2 ? { ...i, status: 'done' as const, items: closeAll(i.items) } : i)),
    current: null,
  }
  const sc = scene({ chart })
  expect(trimmed(composeRow(sc, createAnim(), S, 120, true))).toContain('40%  M1.6 › next 3/5 Orbit view')
  // At 40 the track (10 cells) stays and the route title goes: 10 + 1 + 4 + 2 + 19 = 36.
  const mid = composeRow(sc, createAnim(), S, 40, true)
  expect(mid.length).toBe(40)
  expect(mid[0]?.cp).toBe(0x25d6)
  expect(mid[9]?.cp).toBe(0x25d7)
  expect(text(mid).slice(10).trimEnd()).toBe('  40%  next 3/5 Orbit view')
  expect(trimmed(composeRow(sc, createAnim(), S, 35, true))).toBe(' 40%  next 3/5 Orbit view')
  expect(trimmed(composeRow(sc, createAnim(), S, 26, true))).toBe(' 40%  next 3/5 Orbit view')
  expect(trimmed(composeRow(sc, createAnim(), S, 24, true))).toBe(' 40%  next 3/5')
})

test('the animated frame adds the effects over the still one', async () => {
  const sc = scene()
  // The glint sweeps along the track.
  const glinting = primed(sc)
  glinting.glint = { start: 0 }
  glinting.tick = 5
  const still = composeTrack(sc, primed(sc), S, 24, true)
  const lit = composeTrack(sc, glinting, S, 24, false)
  expect(text(lit)).toBe(text(still))
  expect(lit.some((c, i) => c.fg !== still[i]?.fg)).toBe(true)
  // Both caps pulse.
  const pulsing = primed(sc)
  pulsing.pulse = { start: 0 }
  pulsing.tick = 2
  expect(composeTrack(sc, pulsing, S, 24, false)[23]?.fg).toBe(lighten(GOLD, 0.55))
  expect(composeTrack(sc, pulsing, S, 24, false)[0]?.fg).toBe(lighten(GOLD, 0.55))
  // A spark twinkles on the head and turns over.
  const spark = primed(sc)
  spark.spark = { at: 'head', color: GOLD, until: 100 }
  expect(composeTrack(sc, spark, S, 24, false)[7]?.cp).toBe(GLYPH.spark1)
  spark.tick = 4
  const twinkle = composeTrack(sc, spark, S, 24, false)[7]
  expect(twinkle?.cp).toBe(GLYPH.spark2)
  expect(twinkle?.fg).toBe(GOLD)
  // The head trails a bright wake while it glides.
  const gliding = primed(sc)
  gliding.head = { from: 0.1, to: gliding.head.to, start: 0 }
  gliding.tick = 8
  const at = Math.round(headValue(gliding) * 22) + 1
  const wake = composeTrack(sc, gliding, S, 24, false)
  expect(wake[at]?.cp).toBe(GLYPH.head)
  expect(wake[at - 1]?.fg).toBe(mixColor(FILL, HEAD, 0.6))
  expect(wake[at - 2]?.fg).toBe(mixColor(FILL, HEAD, 0.3))
})

test('the open glyph reserves its cells', () => {
  expect(openCells('under')).toBe(2)
  expect(openCells('above')).toBe(5)
  expect(openCells('panel')).toBe(0)
  expect(OPEN_GLYPH).toBe('⋯')
  expect(OPEN_KEY).toBe('charter-open')
  expect(OPEN_HOTKEY).toBe('c')
  expect(PROBE_KEY).toBe('charter-probe')
})

test('rolling digits flash, the step shimmers and the dot breathes', async () => {
  const busy = scene({ agents: [agent('a1', 'dig')], isWorking: true })
  const a = primed(busy)
  a.pct = { shown: 28, target: 28, flashFrom: 1, flashUntil: 10 }
  const flashing = composeRow(busy, a, S, 30, false)
  expect(flashing[2]?.fg).toBe(HEAD)
  expect(flashing[1]?.fg).toBe(FIGURES)
  a.tick = 10
  expect(composeRow(busy, a, S, 30, false)[2]?.fg).toBe(FIGURES)

  // The shimmer starts on the first cell of the current step.
  const quiet = primed(busy)
  const title = text(composeRow(busy, quiet, S, 120, false)).indexOf('Catalogue UI')
  quiet.tick = 0
  expect(composeRow(busy, quiet, S, 120, false)[title]?.fg).toBe(0x01000000)
  quiet.tick = 4
  expect(composeRow(busy, quiet, S, 120, false)[title]?.fg).toBe(mixColor(0xbcbcbc, WHITE, 0.5))
  // Without a subagent or a check, nothing shimmers.
  const idle = scene({ isWorking: true })
  const b = primed(idle)
  b.tick = 4
  expect(composeRow(idle, b, S, 120, false)[text(composeRow(idle, b, S, 120, false)).indexOf('Catalogue UI')]?.fg).toBe(0x01000000)

  // The phase dot breathes while Claude works: always filled, its colour dims toward the track and back.
  const working = scene({ isWorking: true })
  const w = primed(working)
  w.tick = 0
  const dotIndex = text(composeRow(working, w, S, 120, false)).indexOf('●')
  expect(dotIndex).toBeGreaterThan(0)
  const dotAt = (tick: number, sc = working, a = w, settings = S, isStill = false): Cell | undefined => {
    a.tick = tick

    return composeRow(sc, a, settings, 120, isStill)[dotIndex]
  }
  expect(dotAt(0)?.cp).toBe(GLYPH.dot)
  expect(dotAt(0)?.fg).toBe(LIVE)
  expect(dotAt(DOT_BREATHE)?.cp).toBe(GLYPH.dot)
  expect(dotAt(DOT_BREATHE)?.fg).toBe(mixColor(LIVE, TRACK, 0.5))
  expect(dotAt(2 * DOT_BREATHE)?.cp).toBe(GLYPH.dot)
  expect(dotAt(2 * DOT_BREATHE)?.fg).toBe(LIVE)
  // At rest, with activity off, or on a still row, the dot stays at full colour.
  const rest = scene()
  expect(dotAt(DOT_BREATHE, rest, primed(rest))?.fg).toBe(LIVE)
  expect(dotAt(DOT_BREATHE, working, primed(working), normalizeSettings({ activity: 'off' }))?.fg).toBe(LIVE)
  expect(dotAt(DOT_BREATHE, working, primed(working), S, true)?.fg).toBe(LIVE)
})

test('spinners turn only with the activity effect', async () => {
  const sc = scene({ agents: [agent('a1', 'dig')], checks: [check()] })
  const a = primed(sc)
  const tail = (tick: number, settings = S): string => {
    a.tick = tick
    const row = composeRow(sc, a, settings, 120, false)

    return trimmed(row).slice(-10)
  }
  expect(tail(0)).toBe('⠋ npm test')
  expect(tail(2)).toBe('⠙ npm test')
  const agentOnly = scene({ agents: [agent('a1', 'dig')] })
  const b = primed(agentOnly)
  const spin = (tick: number): string => {
    b.tick = tick

    return trimmed(composeRow(agentOnly, b, S, 120, false)).slice(-5)
  }
  expect(spin(0)).toBe('◐ dig')
  expect(spin(4)).toBe('◓ dig')
  expect(spin(8)).toBe('◑ dig')
  const off = normalizeSettings({ activity: 'off' })
  b.tick = 4
  expect(trimmed(composeRow(agentOnly, b, off, 120, false)).slice(-5)).toBe('◐ dig')
})

test('the row is always exactly the width asked for', async () => {
  for (const cols of [20, 21, 33, 47, 64, 99, 120, 200, 512]) {
    expect(composeRow(scene(), createAnim(), S, cols, true).length).toBe(cols)
    expect(composeRow(scene({ agents: [agent('a1', 'dig')] }), primed(scene()), S, cols, false).length).toBe(cols)
  }
})

test('the hook knows its place in the chain from what settled beneath it', async () => {
  // The trace lists the links beneath, nearest first; index 0 is the outermost link.
  expect(ownIndex([])).toBeNull()
  expect(ownIndex([{ index: 1 }, { index: 2 }])).toBe(0)
  expect(ownIndex([{ index: 3 }])).toBe(2)
  expect(HINT_INDENT).toBe(2)
  expect(DEFAULT_COLUMNS).toBe(80)
})
