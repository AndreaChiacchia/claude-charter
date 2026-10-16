import { expect, test } from 'claude-code/testing'

import type { Chart, Signal } from '../types'
import {
  FLASH_FRAMES,
  MARKER_SPARK_FRAMES,
  SPARK_FRAMES,
  advance,
  createAnim,
  syncTargets,
} from '../hooks/anim'
import type { Effects, Scene } from '../hooks/anim'
import { DEFAULT, FAIL, GLYPH, GOLD, HEAD, LIVE, OK, TRACK, WHITE, FIGURES, lighten, mixColor, textCells } from '../hooks/cells'
import {
  ARRIVAL_FRAMES,
  BLOCK_PULSE_FRAMES,
  MAX_ARRIVALS,
  PILL_DONE_BG,
  PILL_FRAMES,
  PILL_INK,
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
} from '../hooks/pane'
import type { PaneMotion } from '../hooks/pane'
import { applyAction } from '../hooks/route'
import { composeTrack, normalizeSettings } from '../hooks/row'
import { cut } from '../hooks/signals'
import { fixtureChart } from './fixture'

const S = normalizeSettings({})
const ON: Effects = { glide: true, roll: true, activity: true, celebrate: true }

const sig = (seq: number): Signal => ({ seq, at: 0, kind: 'check', text: 'npm test', detail: '1s', ok: true, itemId: null })

/** The fixture route after one action. */
function acted(input: Parameters<typeof applyAction>[1]): Chart {
  const r = applyAction(fixtureChart(), input, 10)
  if (r.chart === null) throw new Error('no chart')

  return r.chart
}

/** A pane motion primed on the fixture route (the first sync is silent). */
function primed(log: Signal[] = [], effects: Effects = ON): PaneMotion {
  const m = createPaneMotion()
  syncPane(m, 0, fixtureChart(), log, effects, false)

  return m
}

test('syncPane: the first call and a jump prime silently', () => {
  const m = primed()
  expect(m.isPrimed).toBe(true)
  expect([...m.doneIds].sort()).toEqual(['S1', 'S2.P1'])
  expect(m.phaseAt.get('S2.P2')).toBe(2)
  expect(m.marks.size + m.pulses.size + m.pills.size + m.arrivals.size).toBe(0)
  const j = primed()
  syncPane(j, 3, acted({ action: 'done', id: 'S2.P2' }), [sig(1)], ON, true)
  expect(isPaneMoving(j)).toBe(false)
  expect(j.doneIds.has('S2.P2')).toBe(true)
  expect(j.lastSeq).toBe(1)
})

test('syncPane: a newly done item twinkles, gold for a stage and green for a part', () => {
  const m = primed()
  syncPane(m, 5, acted({ action: 'done', id: 'S3' }), [], ON, false)
  expect(m.marks.get('S3')).toEqual({ start: 5, color: GOLD, frames: MARKER_SPARK_FRAMES })
  const n = primed()
  syncPane(n, 7, acted({ action: 'done', id: 'S2.P2' }), [], ON, false)
  expect(n.marks.get('S2.P2')).toEqual({ start: 7, color: OK, frames: SPARK_FRAMES })
  // Items that were done already do not twinkle.
  expect(n.marks.has('S1')).toBe(false)
  expect(n.marks.has('S2.P1')).toBe(false)
})

test('syncPane: celebrate off gives no marks and no arrivals', () => {
  const off: Effects = { ...ON, celebrate: false }
  const m = primed([], off)
  syncPane(m, 5, acted({ action: 'done', id: 'S2.P2' }), [sig(1)], off, false)
  expect(m.marks.size).toBe(0)
  expect(m.arrivals.size).toBe(0)
})

test('syncPane: a newly blocked item pulses with activity on, and not with it off', () => {
  const m = primed()
  syncPane(m, 4, acted({ action: 'block', id: 'S2.P2' }), [], ON, false)
  expect(m.pulses.get('S2.P2')).toBe(4)
  const off: Effects = { ...ON, activity: false }
  const n = primed([], off)
  syncPane(n, 4, acted({ action: 'block', id: 'S2.P2' }), [], off, false)
  expect(n.pulses.size).toBe(0)
})

test('syncPane: a phase forward fills a pill with glide on; backward or glide off gives none', () => {
  const m = primed()
  syncPane(m, 6, acted({ action: 'start', id: 'S2.P2', phase: 'checks' }), [], ON, false)
  expect(m.pills.get('S2.P2')).toEqual({ start: 6, from: 2, to: 3 })
  const back = primed()
  syncPane(back, 6, acted({ action: 'start', id: 'S2.P2', phase: 'plan' }), [], ON, false)
  expect(back.pills.size).toBe(0)
  const off: Effects = { ...ON, glide: false }
  const still = primed([], off)
  syncPane(still, 6, acted({ action: 'start', id: 'S2.P2', phase: 'checks' }), [], off, false)
  expect(still.pills.size).toBe(0)
})

test('syncPane: new signals flash, the three newest at most; a log that restarted flashes none', () => {
  const m = primed([sig(1)])
  syncPane(m, 9, fixtureChart(), [1, 2, 3, 4, 5].map(sig), ON, false)
  expect([...m.arrivals.keys()].sort()).toEqual([3, 4, 5])
  expect(m.arrivals.size).toBe(MAX_ARRIVALS)
  expect(m.arrivals.get(5)).toBe(9)
  expect(m.lastSeq).toBe(5)
  const k = primed([sig(1), sig(2), sig(3)])
  syncPane(k, 9, fixtureChart(), [sig(1)], ON, false)
  expect(k.arrivals.size).toBe(0)
  expect(k.lastSeq).toBe(1)
})

test('syncPane: a different route resets the motion and primes silently', () => {
  const m = primed()
  syncPane(m, 5, acted({ action: 'done', id: 'S2.P2' }), [], ON, false)
  expect(m.marks.size).toBe(1)
  syncPane(m, 6, { ...fixtureChart(), title: 'Other' }, [], ON, false)
  expect(m.marks.size).toBe(0)
  expect(m.key).toBe('Other\u00000')
  expect(m.isPrimed).toBe(true)
})

test('advancePane drops what ran its course; isPaneMoving follows', () => {
  const m = createPaneMotion()
  expect(isPaneMoving(m)).toBe(false)
  m.marks.set('a', { start: 0, color: OK, frames: 16 })
  m.pulses.set('b', 0)
  m.pills.set('c', { start: 0, from: 0, to: 1 })
  m.arrivals.set(7, 0)
  expect(isPaneMoving(m)).toBe(true)
  advancePane(m, PILL_FRAMES - 1)
  expect(m.pills.size).toBe(1)
  advancePane(m, PILL_FRAMES)
  expect(m.pills.size).toBe(0)
  advancePane(m, ARRIVAL_FRAMES - 1)
  expect(m.arrivals.size).toBe(1)
  advancePane(m, ARRIVAL_FRAMES)
  expect(m.arrivals.size).toBe(0)
  advancePane(m, 15)
  expect(m.marks.size).toBe(1)
  advancePane(m, 16)
  expect(m.marks.size).toBe(0)
  expect(BLOCK_PULSE_FRAMES).toBe(18)
  advancePane(m, BLOCK_PULSE_FRAMES - 1)
  expect(m.pulses.size).toBe(1)
  advancePane(m, BLOCK_PULSE_FRAMES)
  expect(m.pulses.size).toBe(0)
  expect(isPaneMoving(m)).toBe(false)
})

const PHASES = ['plan', 'approve', 'implement']
/** Layout of composePills(PHASES): a blank, ` plan ` (6), a blank, ` approve ` (9), a blank, ` implement ` (11). */
const PLAN_AT = 1
const APPROVE_AT = 8

test('composePills: the still colours', () => {
  const cells = composePills(PHASES, 1, undefined, 0)
  expect(cells.length).toBe(29)
  expect(cells[0]).toEqual({ cp: 0x20, fg: DEFAULT, bg: DEFAULT })
  expect(cells.slice(PLAN_AT, PLAN_AT + 6).every(c => c.fg === WHITE && c.bg === PILL_DONE_BG)).toBe(true)
  expect(cells.slice(APPROVE_AT, APPROVE_AT + 9).every(c => c.fg === PILL_INK && c.bg === LIVE)).toBe(true)
  expect(cells.slice(18).every(c => c.fg === TRACK && c.bg === DEFAULT)).toBe(true)
  expect(cells.slice(APPROVE_AT, APPROVE_AT + 9).map(c => String.fromCodePoint(c.cp)).join('')).toBe(' approve ')
})

test('composePills: the new pill wipes in left to right, the one before turns teal, the width never changes', () => {
  const blend = { start: 0, from: 0, to: 1 }
  const lit = (tick: number): number =>
    composePills(PHASES, 1, blend, tick).slice(APPROVE_AT, APPROVE_AT + 9).filter(c => c.bg === LIVE).length
  expect(lit(0)).toBe(0)
  expect(lit(4)).toBe(Math.round(0.75 * 9))
  expect(lit(8)).toBe(9)
  const wipe = composePills(PHASES, 1, blend, 4).slice(APPROVE_AT, APPROVE_AT + 9)
  expect(wipe.slice(0, 7).every(c => c.bg === LIVE)).toBe(true)
  expect(wipe.slice(7).every(c => c.bg === DEFAULT && c.fg === TRACK)).toBe(true)
  // The previous pill blends from lavender to teal.
  const mid = composePills(PHASES, 1, blend, 4).slice(PLAN_AT, PLAN_AT + 6)
  expect(mid.every(c => c.bg === mixColor(LIVE, PILL_DONE_BG, 0.75) && c.fg === mixColor(PILL_INK, WHITE, 0.75))).toBe(true)
  for (let t = 0; t <= PILL_FRAMES + 2; t++) expect(composePills(PHASES, 1, blend, t).length).toBe(29)
})

test('composeDone: the sparks alternate every 4 frames in the mark colour, then a check', () => {
  const m = createPaneMotion()
  m.marks.set('x', { start: 0, color: OK, frames: SPARK_FRAMES })
  const cp = (t: number): number => composeDone(m, 'x', t)[0]?.cp ?? 0
  expect([0, 3].map(cp)).toEqual([GLYPH.spark1, GLYPH.spark1])
  expect([4, 7].map(cp)).toEqual([GLYPH.spark2, GLYPH.spark2])
  expect(cp(8)).toBe(GLYPH.spark1)
  expect(composeDone(m, 'x', 5)[0]?.fg).toBe(OK)
  const end = composeDone(m, 'x', SPARK_FRAMES)[0]
  expect(end).toEqual({ cp: GLYPH.check, fg: OK, bg: DEFAULT })
  expect(composeDone(m, 'unknown', 0)[0]?.cp).toBe(GLYPH.check)
})

test('composeBlocked: the cap pulse on red, then plain red', () => {
  const m = createPaneMotion()
  m.pulses.set('x', 0)
  expect(composeBlocked(m, 'x', 0)[0]?.fg).toBe(lighten(FAIL, 0.2 * 0.55))
  expect(composeBlocked(m, 'x', 2)[0]?.fg).toBe(lighten(FAIL, 0.55))
  expect(composeBlocked(m, 'x', BLOCK_PULSE_FRAMES)[0]?.fg).toBe(FAIL)
  for (const t of [0, 1, 2, 17, 18, 40]) expect(composeBlocked(m, 'x', t)[0]?.cp).toBe(0x2298)
})

test('composeMine: steady when idle, breathing every 10 frames when busy', () => {
  for (const t of [0, 10, 20, 31]) expect(composeMine(t, false)[0]?.fg).toBe(LIVE)
  expect(composeMine(0, true)[0]?.fg).toBe(LIVE)
  expect(composeMine(10, true)[0]?.fg).toBe(mixColor(LIVE, TRACK, 0.5))
  expect(composeMine(19, true)[0]?.fg).toBe(mixColor(LIVE, TRACK, 0.5))
  expect(composeMine(20, true)[0]?.fg).toBe(LIVE)
  expect(composeMine(0, true)[0]?.cp).toBe(GLYPH.current)
})

test('composeRunGlyph: the row\'s spinners, or its still glyphs', () => {
  const spin = GLYPH.checkSpin
  expect([0, 1, 2, 4].map(t => composeRunGlyph('check', t, true)[0]?.cp)).toEqual([spin[0], spin[0], spin[1], spin[2]])
  expect(composeRunGlyph('check', 3, true)[0]?.fg).toBe(GOLD)
  const ag = GLYPH.agentSpin
  expect([0, 3, 4, 8, 12, 16].map(t => composeRunGlyph('agent', t, true)[0]?.cp)).toEqual([ag[0], ag[0], ag[1], ag[2], ag[3], ag[0]])
  expect(composeRunGlyph('agent', 5, true)[0]?.fg).toBe(LIVE)
  expect(composeRunGlyph('check', 9, false)[0]).toEqual({ cp: GLYPH.checkStill, fg: GOLD, bg: DEFAULT })
  expect(composeRunGlyph('agent', 9, false)[0]).toEqual({ cp: 0x25d0, fg: LIVE, bg: DEFAULT })
})

test('composeSignalGlyph: the base mapping, and the arrival flash', () => {
  const g = (kind: Signal['kind'], ok: boolean | null, arrival?: number, tick = 0) => composeSignalGlyph(kind, ok, arrival, tick)[0]
  expect(g('agent', null)).toEqual({ cp: 0x25d0, fg: LIVE, bg: DEFAULT })
  expect(g('commit', true)).toEqual({ cp: GLYPH.commit, fg: HEAD, bg: DEFAULT })
  expect(g('check', null)).toEqual({ cp: GLYPH.checkStill, fg: FIGURES, bg: DEFAULT })
  expect(g('check', true)).toEqual({ cp: GLYPH.check, fg: OK, bg: DEFAULT })
  expect(g('agent-end', false)).toEqual({ cp: GLYPH.cross, fg: FAIL, bg: DEFAULT })
  // A check arriving flashes in HEAD for FLASH_FRAMES, then blends back; a commit flashes in GOLD.
  expect(g('check', true, 10, 10)?.fg).toBe(HEAD)
  expect(g('check', true, 10, 10 + FLASH_FRAMES - 1)?.fg).toBe(HEAD)
  const blending = g('check', true, 10, 10 + FLASH_FRAMES + 4)?.fg
  expect(blending).not.toBe(HEAD)
  expect(blending).not.toBe(OK)
  expect(g('check', true, 10, 10 + ARRIVAL_FRAMES)?.fg).toBe(OK)
  expect(g('commit', true, 10, 12)?.fg).toBe(GOLD)
  expect(g('commit', true, 10, 10 + ARRIVAL_FRAMES)?.fg).toBe(HEAD)
})

const sceneOf = (chart: Chart, isWorking = false): Scene => ({
  chart,
  share: null,
  agents: [],
  checks: [],
  lastCheck: null,
  commit: null,
  isWorking,
})

test('composeTrackLine: a constant width through a glide, the badge cut to its room, the row\'s track inside', () => {
  const R = 20
  const room = 12
  const anim = createAnim()
  syncTargets(anim, sceneOf(fixtureChart()), S, false)
  const next = sceneOf(acted({ action: 'done', id: 'S2.P2' }))
  syncTargets(anim, next, S, false)
  expect(anim.badge.kind).toBe('item')
  for (let t = 0; t < 24; t++) {
    expect(composeTrackLine(next, anim, S, R, room).length).toBe(R + 5 + room)
    advance(anim, S.effects)
  }
  const fresh = createAnim()
  syncTargets(fresh, sceneOf(fixtureChart()), S, false)
  syncTargets(fresh, next, S, false)
  const line = composeTrackLine(next, fresh, S, R, room)
  const expected = textCells(cut(fresh.badge.text, room - 2), fresh.badge.color)
  expect(line.slice(R + 7, R + 7 + expected.length)).toEqual(expected)
  expect(line.slice(R + 5, R + 7).map(c => c.cp)).toEqual([0x20, 0x20])
  expect(line.slice(0, R)).toEqual(composeTrack(next, fresh, S, R, false))
  // No room, no badge cells.
  expect(composeTrackLine(next, fresh, S, R, 0).length).toBe(R + 5)
})

test('composeTrackLine: the percent, and the busy beacon of the row\'s track', () => {
  const R = 20
  const anim = createAnim()
  const idle = sceneOf(fixtureChart())
  syncTargets(anim, idle, S, false)
  const line = composeTrackLine(idle, anim, S, R, 0)
  expect(line.slice(R, R + 5).map(c => String.fromCodePoint(c.cp)).join('')).toBe(' 28% ')
  anim.tick = 16
  const busy = sceneOf(fixtureChart(), true)
  const breathing = composeTrackLine(busy, anim, S, R, 0)
  expect(breathing.slice(0, R)).toEqual(composeTrack(busy, anim, S, R, false))
  expect(breathing.slice(0, R)).not.toEqual(composeTrack(idle, anim, S, R, false))
})

test('isRasterSafe: ASCII passes, wide and non-BMP characters do not', () => {
  expect(isRasterSafe('plan')).toBe(true)
  expect(isRasterSafe('revisão')).toBe(true)
  expect(isRasterSafe('計画')).toBe(false)
  expect(isRasterSafe('ship 🚀')).toBe(false)
})
