import { expect, test } from 'claude-code/testing'

import type { Chart } from '../types'
import {
  COMMIT_BADGE_FRAMES,
  GLIDE_FRAMES,
  GLINT_FRAMES,
  GLINT_PASSES,
  ITEM_BADGE_FRAMES,
  advance,
  createAnim,
  fillValue,
  glideAt,
  headValue,
  isSettled,
  syncTargets,
} from '../hooks/anim'
import type { Anim, Scene } from '../hooks/anim'
import { GOLD, HEAD, OK } from '../hooks/cells'
import { applyAction, percentOf, posOf, progress } from '../hooks/route'
import { normalizeSettings } from '../hooks/row'
import { fixtureChart } from './fixture'

const S = normalizeSettings({})

const scene = (chart: Chart, over: Partial<Scene> = {}): Scene => ({
  chart,
  share: null,
  agents: [],
  checks: [],
  lastCheck: null,
  commit: null,
  isWorking: false,
  ...over,
})

/** The fixture route after the given `done` actions, in order. */
function after(...ids: string[]): Chart {
  let chart = fixtureChart()
  for (const id of ids) {
    const r = applyAction(chart, { action: 'done', id }, 10)
    if (r.chart === null) throw new Error('no chart')
    chart = r.chart
  }

  return chart
}

/** An animation primed on the fixture route (the first sync is silent). */
function primed(): Anim {
  const anim = createAnim()
  syncTargets(anim, scene(fixtureChart()), S, false)

  return anim
}

test('the first sync primes silently', async () => {
  const anim = primed()
  expect(anim.isPrimed).toBe(true)
  expect(anim.badge.kind).toBe('none')
  expect(anim.glint).toBeNull()
  expect([...anim.doneIds].sort()).toEqual(['S1', 'S2.P1'])
  expect(anim.pct.shown).toBe(28)
  expect(anim.pct.target).toBe(28)
  expect(anim.stage.shown).toBe(2)
  expect(anim.completed).toBe(false)
  expect(anim.fill.from).toBe(anim.fill.to)
  // Syncing the same route again changes nothing.
  syncTargets(anim, scene(fixtureChart()), S, false)
  expect(anim.badge.kind).toBe('none')
})

test('a finished item raises its badge, whoever finished it', async () => {
  const anim = primed()
  syncTargets(anim, scene(after('S2.P2')), S, false)
  expect(anim.badge.kind).toBe('item')
  expect(anim.badge.text).toBe('✦ Catalogue UI done')
  expect(anim.badge.color).toBe(OK)
  expect(anim.spark?.at).toBe('head')
  expect(anim.spark?.color).toBe(OK)
  expect(anim.glint).toBeNull()
})

test('a finished stage beats the item badge', async () => {
  const anim = primed()
  syncTargets(anim, scene(after('S2.P2', 'S2.P3')), S, false)
  expect(anim.badge.kind).toBe('stage')
  expect(anim.badge.text).toBe('✦ Stage 2/5 done ✦')
  expect(anim.badge.color).toBe(GOLD)
  expect(anim.glint).not.toBeNull()
  expect(anim.spark?.at).toBe(2)
})

test('completing the route raises the complete badge, the glint and the pulse', async () => {
  const anim = primed()
  const chart = after('S2.P2', 'S2.P3', 'S3', 'S4', 'S5')
  expect(chart.finishedAt).not.toBeNull()
  syncTargets(anim, scene(chart), S, false)
  expect(anim.badge.kind).toBe('complete')
  expect(anim.badge.text).toBe('✓ Complete · M1.6')
  expect(anim.glint).not.toBeNull()
  expect(anim.pulse).not.toBeNull()
  expect(anim.completed).toBe(true)
  expect(anim.pct.target).toBe(100)
  // It fires once.
  const badge = anim.badge
  syncTargets(anim, scene(chart), S, false)
  expect(anim.badge).toEqual(badge)
})

test('a commit flashes its hash unless something of higher priority shows', async () => {
  const anim = primed()
  syncTargets(anim, scene(fixtureChart(), { commit: { seq: 1, hash: 'abc1234' } }), S, false)
  expect(anim.badge.kind).toBe('commit')
  expect(anim.badge.text).toBe('◈ abc1234')
  expect(anim.badge.color).toBe(HEAD)
  expect(anim.lastCommitSeq).toBe(1)
  // The same commit is not raised twice.
  for (let i = 0; i < COMMIT_BADGE_FRAMES; i++) advance(anim, S.effects)
  expect(anim.badge.kind).toBe('none')
  syncTargets(anim, scene(fixtureChart(), { commit: { seq: 1, hash: 'abc1234' } }), S, false)
  expect(anim.badge.kind).toBe('none')
  // An item badge showing stays when a commit arrives.
  syncTargets(anim, scene(after('S2.P2'), { commit: { seq: 2, hash: 'def5678' } }), S, false)
  expect(anim.badge.kind).toBe('item')
  // Once it has expired a commit can show.
  for (let i = 0; i < ITEM_BADGE_FRAMES; i++) advance(anim, S.effects)
  expect(anim.badge.kind).toBe('none')
  syncTargets(anim, scene(after('S2.P2'), { commit: { seq: 3, hash: '0123456' } }), S, false)
  expect(anim.badge.text).toBe('◈ 0123456')
})

test('the head and the fill glide on their own', async () => {
  const anim = primed()
  const from = { fill: fillValue(anim), head: headValue(anim) }
  // The route moves on; this session stands on S3, a different place than the progress.
  const chart: Chart = { ...after('S2.P2'), current: 'S3' }
  syncTargets(anim, scene(chart), S, false)
  const toFill = progress(chart)
  const toHead = posOf(chart, 'S3')
  expect(anim.fill.to).toBe(toFill)
  expect(anim.head.to).toBe(toHead)
  expect(toFill).not.toBe(toHead)
  for (let i = 0; i < 8; i++) advance(anim, S.effects)
  const midFill = fillValue(anim)
  const midHead = headValue(anim)
  expect(midFill > from.fill && midFill < toFill).toBe(true)
  expect(midHead > from.head && midHead < toHead).toBe(true)
  for (let i = 0; i < 8; i++) advance(anim, S.effects)
  expect(fillValue(anim)).toBe(toFill)
  expect(headValue(anim)).toBe(toHead)
  expect(glideAt({ from: 0, to: 1, start: 0 }, GLIDE_FRAMES)).toBe(1)
  // A change in the middle of a glide starts from where it is.
  const again = primed()
  syncTargets(again, scene({ ...after('S2.P2'), current: 'S3' }), S, false)
  for (let i = 0; i < 8; i++) advance(again, S.effects)
  const here = headValue(again)
  syncTargets(again, scene({ ...after('S2.P2'), current: 'S4' }), S, false)
  expect(again.head.from).toBe(here)
})

test('the percent rolls like an odometer and its changed digits flash', async () => {
  const anim = primed()
  const chart = after('S2.P2', 'S2.P3')
  syncTargets(anim, scene(chart), S, false)
  const target = percentOf(progress(chart), false)
  expect(anim.pct.target).toBe(target)
  expect(anim.pct.shown).toBe(28)
  advance(anim, S.effects)
  expect(anim.pct.shown).toBe(28)
  advance(anim, S.effects)
  expect(anim.pct.shown > 28 && anim.pct.shown <= target).toBe(true)
  expect(anim.pct.flashUntil).toBeGreaterThan(anim.tick)
  for (let i = 0; i < 40; i++) advance(anim, S.effects)
  expect(anim.pct.shown).toBe(target)
  // Rolling off snaps.
  const flat = primed()
  const noRoll = normalizeSettings({ roll: 'off' })
  syncTargets(flat, scene(chart), noRoll, false)
  expect(flat.pct.shown).toBe(target)
  expect(flat.stage.shown).toBe(flat.stage.target)
})

test('a jump snaps everything and raises nothing', async () => {
  const anim = primed()
  syncTargets(anim, scene(after('S2.P2', 'S2.P3')), S, true)
  expect(anim.badge.kind).toBe('none')
  expect(anim.fill.from).toBe(anim.fill.to)
  expect(anim.head.from).toBe(anim.head.to)
  expect(anim.pct.shown).toBe(anim.pct.target)
  expect(isSettled(anim)).toBe(true)
  // What was done in the jump is not celebrated later.
  syncTargets(anim, scene(after('S2.P2', 'S2.P3')), S, false)
  expect(anim.badge.kind).toBe('none')
})

test('with celebrations off no badge is raised', async () => {
  const quiet = normalizeSettings({ celebrate: 'off' })
  const anim = createAnim()
  syncTargets(anim, scene(fixtureChart()), quiet, false)
  syncTargets(anim, scene(after('S2.P2', 'S2.P3'), { commit: { seq: 1, hash: 'abc1234' } }), quiet, false)
  expect(anim.badge.kind).toBe('none')
  expect(anim.glint).toBeNull()
  expect(anim.spark).toBeNull()
})

test('a new route starts the animation over', async () => {
  const anim = primed()
  syncTargets(anim, scene(after('S2.P2', 'S2.P3')), S, false)
  expect(anim.badge.kind).toBe('stage')
  const other: Chart = { ...fixtureChart(), title: 'Other', startedAt: 99 }
  syncTargets(anim, scene(other), S, false)
  expect(anim.badge.kind).toBe('none')
  expect(anim.doneIds.has('S1')).toBe(true)
})

test('the animation settles after enough frames', async () => {
  const anim = primed()
  syncTargets(anim, scene(after('S2.P2', 'S2.P3')), S, false)
  expect(isSettled(anim)).toBe(false)
  for (let i = 0; i < 100; i++) advance(anim, S.effects)
  expect(isSettled(anim)).toBe(true)
  expect(anim.badge.kind).toBe('none')
  expect(anim.spark).toBeNull()
  expect(anim.glint).toBeNull()
  // The glint ends after its passes.
  const lit = primed()
  syncTargets(lit, scene(after('S2.P2', 'S2.P3')), S, false)
  for (let i = 0; i < GLINT_FRAMES * GLINT_PASSES - 1; i++) advance(lit, S.effects)
  expect(lit.glint).not.toBeNull()
  advance(lit, S.effects)
  expect(lit.glint).toBeNull()
})
