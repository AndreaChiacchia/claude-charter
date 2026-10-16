import { expect, test } from 'claude-code/testing'

import type { Chart, ShareView } from '../types'
import {
  NO_ROUTE_ERROR,
  applyAction,
  cloneChart,
  currentPath,
  nextItem,
  percentOf,
  progress,
  replay,
  routeText,
} from '../hooks/route'
import type { ReplayOp } from '../hooks/route'
import { fixtureChart } from './fixture'

const ERR = 'claudecharter: '

/** Applies an action and returns the chart, failing the test on an error. */
function ok(chart: Chart | null, input: Record<string, unknown>, now = 100): Chart {
  const r = applyAction(chart, input, now)
  expect(r.error).toBeUndefined()
  if (r.chart === null) throw new Error('no chart')

  return r.chart
}

const small = (): Chart =>
  ok(null, {
    action: 'plan',
    title: 'T',
    items: [
      { id: 'A', title: 'Alpha' },
      { id: 'B', title: 'Beta' },
    ],
  })

test('plan cleans titles, phases and ids', async () => {
  const phases = ['plan ', 'plan', '  ', 'x'.repeat(30), 'go']
  const c = ok(null, {
    action: 'plan',
    title: '  My   route  ',
    items: [{ id: ' A1 ', title: '  Do   this  ', phases }],
  })
  expect(c.title).toBe('My route')
  const a = c.items[0]
  expect(a?.id).toBe('A1')
  expect(a?.title).toBe('Do this')
  expect(a?.phases).toEqual(['plan', 'x'.repeat(20), 'go'])
  expect(a?.status).toBe('pending')
  expect(c.revision).toBe(1)
  const many = Array.from({ length: 15 }, (_, i) => 'p' + i)
  const b = ok(null, { action: 'plan', title: 'T', items: [{ id: 'A', title: 'a', phases: many }] })
  expect(b.items[0]?.phases.length).toBe(12)
  const long = ok(null, { action: 'plan', title: 't'.repeat(100), items: [{ id: 'A', title: 'x'.repeat(100) }] })
  expect(Array.from(long.title).length).toBe(80)
  expect(Array.from(long.items[0]?.title ?? '').length).toBe(80)
})

test('plan errors are exact', async () => {
  const err = (input: Record<string, unknown>): string | undefined => applyAction(null, input, 1).error
  const item = (id: string) => ({ id, title: 't' })
  expect(err({ action: 'plan', title: 'T', items: [item('A'), item('A')] })).toBe(ERR + 'the id "A" is used twice.')
  expect(err({ action: 'plan', title: 'T', items: [{ id: 'a b', title: 't' }] })).toBe(
    ERR + 'item 1: the id must be 1 to 24 characters with no spaces.',
  )
  expect(err({ action: 'plan', title: 'T', items: [item('A'), { id: 'B', title: 'b', items: [item('C'), { id: '', title: 'x' }] }] })).toBe(
    ERR + 'item 2.2: the id must be 1 to 24 characters with no spaces.',
  )
  expect(err({ action: 'plan', title: 'T', items: [{ id: 'x'.repeat(25), title: 't' }] })).toBe(
    ERR + 'item 1: the id must be 1 to 24 characters with no spaces.',
  )
  const deep = { id: 'L1', title: 't', items: [{ id: 'L2', title: 't', items: [{ id: 'L3', title: 't', items: [{ id: 'L4', title: 't', items: [item('L5')] }] }] }] }
  expect(err({ action: 'plan', title: 'T', items: [deep] })).toBe(ERR + 'items nest at most 4 levels.')
  const fine = { id: 'L1', title: 't', items: [{ id: 'L2', title: 't', items: [{ id: 'L3', title: 't', items: [item('L4')] }] }] }
  expect(err({ action: 'plan', title: 'T', items: [fine] })).toBeUndefined()
  const lots = Array.from({ length: 201 }, (_, i) => item('i' + i))
  expect(err({ action: 'plan', title: 'T', items: lots })).toBe(ERR + 'a route holds at most 200 items.')
  expect(err({ action: 'plan', title: '', items: [item('A')] })).toBe(ERR + 'plan needs a title and at least one item.')
  expect(err({ action: 'plan', title: 'T', items: [] })).toBe(ERR + 'plan needs a title and at least one item.')
  expect(err({ action: 'plan', title: 'T' })).toBe(ERR + 'plan needs a title and at least one item.')
  expect(err({ action: 'plan', title: 'T', items: [{ id: 'A', title: '  ' }] })).toBe(ERR + 'item A: the title is empty.')
})

test('an error returns the input chart and no events', async () => {
  const f = fixtureChart()
  const r = applyAction(f, { action: 'done', id: 'nope' }, 5)
  expect(r.chart).toBe(f)
  expect(r.events).toEqual([])
  expect(r.target).toBeNull()
  expect(applyAction(null, { action: 'start', id: 'A' }, 1).error).toBe(NO_ROUTE_ERROR)
  expect(applyAction(null, { action: 'zap' }, 1).error).toBe(ERR + 'action must be one of plan, add, start, done, skip, block, get.')
  expect(applyAction(f, { action: 'start' }, 1).error).toBe(ERR + 'start needs an id.')
  expect(applyAction(f, { action: 'block' }, 1).error).toBe(ERR + 'block needs an id.')
  expect(applyAction(f, { action: 'reset' }, 1).error).toBe(ERR + 'reset needs an id.')
  const idle: Chart = { ...cloneChart(f), current: null }
  expect(applyAction(idle, { action: 'done' }, 1).error).toBe(ERR + 'nothing is current; pass id.')
})

test('the unknown-id error lists ids', async () => {
  const f = fixtureChart()
  expect(applyAction(f, { action: 'done', id: 'ZZ' }, 1).error).toBe(
    ERR + 'no item "ZZ". Ids: S1, S2, S2.P1, S2.P2, S2.P3, S3, S4, S5.',
  )
  const lots = ok(null, { action: 'plan', title: 'T', items: Array.from({ length: 31 }, (_, i) => ({ id: 'i' + i, title: 't' })) })
  const error = applyAction(lots, { action: 'done', id: 'zz' }, 1).error ?? ''
  expect(error.endsWith('i29, ….')).toBe(true)
  expect(error).not.toContain('i30')
})

test('re-planning keeps the progress of ids that remain', async () => {
  let c = ok(null, {
    action: 'plan',
    title: 'T',
    items: [
      { id: 'A', title: 'a', phases: ['p', 'q'] },
      { id: 'B', title: 'b' },
    ],
  }, 10)
  c = ok(c, { action: 'start', id: 'A', phase: 'q' }, 20)
  c = ok(c, { action: 'done', id: 'B', commit: 'ABCDEF1234', note: 'ok' }, 30)
  const again = ok(
    c,
    {
      action: 'plan',
      title: 'T2',
      items: [
        { id: 'A', title: 'a2', phases: ['p', 'z'] },
        { id: 'B', title: 'b' },
        { id: 'C', title: 'c' },
      ],
    },
    40,
  )
  expect(again.title).toBe('T2')
  expect(again.startedAt).toBe(10)
  expect(again.revision).toBe(c.revision + 1)
  const a = again.items[0]
  expect(a?.title).toBe('a2')
  expect(a?.status).toBe('active')
  expect(a?.phase).toBeNull()
  const b = again.items[1]
  expect(b?.status).toBe('done')
  expect(b?.commit).toBe('abcdef1')
  expect(b?.note).toBe('ok')
  expect(again.items[2]?.status).toBe('pending')
  expect(again.current).toBe('A')
  const dropped = ok(again, { action: 'plan', title: 'T2', items: [{ id: 'B', title: 'b' }] }, 50)
  expect(dropped.current).toBeNull()
})

test('start activates the parents and handles phases', async () => {
  let c = ok(null, {
    action: 'plan',
    title: 'T',
    items: [{ id: 'S2', title: 'Two', items: [{ id: 'P1', title: 'One', phases: ['plan', 'go'] }] }],
  })
  c = ok(c, { action: 'start', id: 'P1' })
  const s2 = c.items[0]
  expect(s2?.status).toBe('active')
  expect(s2?.items[0]?.status).toBe('active')
  expect(s2?.items[0]?.phase).toBe('plan')
  expect(c.current).toBe('P1')
  c = ok(c, { action: 'start', id: 'P1', phase: 'extra' })
  expect(c.items[0]?.items[0]?.phases).toEqual(['plan', 'go', 'extra'])
  expect(c.items[0]?.items[0]?.phase).toBe('extra')
  const full = ok(null, {
    action: 'plan',
    title: 'T',
    items: [{ id: 'P', title: 'p', phases: Array.from({ length: 12 }, (_, i) => 'ph' + i) }],
  })
  expect(applyAction(full, { action: 'start', id: 'P', phase: 'new' }, 1).error).toBe(ERR + 'item P already has 12 phases.')
})

test('done cascades to children and finishes the route', async () => {
  const c = ok(null, {
    action: 'plan',
    title: 'T',
    items: [{ id: 'S', title: 'S', items: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] }],
  })
  const r = applyAction(c, { action: 'done', id: 'S', commit: 'abc1234' }, 50)
  expect(r.chart?.items[0]?.status).toBe('done')
  expect(r.chart?.items[0]?.items.map(i => i.status)).toEqual(['done', 'done'])
  expect(r.chart?.items[0]?.commit).toBe('abc1234')
  expect(r.events.map(e => e.kind)).toEqual(['stage-done', 'finished'])
  expect(r.chart?.finishedAt).toBe(50)
  expect(r.chart?.current).toBeNull()
})

test('closing the parts rolls a stage up and moves the current step', async () => {
  const f = fixtureChart()
  const first = applyAction(f, { action: 'done', id: 'S2.P2' }, 10)
  expect(first.events).toEqual([{ kind: 'item-done', id: 'S2.P2', title: 'Catalogue UI', pos: 2, count: 3 }])
  expect(first.chart?.current).toBe('S2')
  expect(first.chart?.items[1]?.status).toBe('active')
  const second = applyAction(first.chart, { action: 'done', id: 'S2.P3' }, 20)
  expect(second.events.map(e => e.kind)).toEqual(['item-done', 'stage-done'])
  expect(second.events[1]).toEqual({ kind: 'stage-done', id: 'S2', title: 'Planet catalogue', pos: 2, count: 5 })
  expect(second.chart?.items[1]?.status).toBe('done')
  expect(second.chart?.items[1]?.doneAt).toBe(20)
  expect(second.chart?.current).toBeNull()
  expect(second.chart?.finishedAt).toBeNull()
})

test('a finished route reports one finished event', async () => {
  let c = small()
  c = ok(c, { action: 'done', id: 'A' })
  const last = applyAction(c, { action: 'done', id: 'B' }, 60)
  expect(last.events.filter(e => e.kind === 'finished').length).toBe(1)
  expect(last.events.at(-1)).toEqual({ kind: 'finished', id: '', title: 'T', pos: 2, count: 2 })
  expect(last.chart?.finishedAt).toBe(60)
  expect(progress(last.chart as Chart)).toBe(1)
  expect(percentOf(0.5, true)).toBe(100)
})

test('skip raises no event for its target; block keeps the current step', async () => {
  const f = fixtureChart()
  const s = applyAction(f, { action: 'skip', id: 'S2.P3', note: 'not needed' }, 7)
  expect(s.events).toEqual([])
  expect(s.chart?.items[1]?.items[2]?.status).toBe('skipped')
  expect(s.chart?.items[1]?.items[2]?.note).toBe('not needed')
  expect(s.chart?.items[1]?.items[2]?.doneAt).toBe(7)
  const b = applyAction(f, { action: 'block', id: 'S3', note: 'waiting for  data' }, 8)
  expect(b.chart?.items[2]?.status).toBe('blocked')
  expect(b.chart?.items[2]?.note).toBe('waiting for data')
  expect(b.chart?.current).toBe('S2.P2')
  expect(b.events).toEqual([])
})

test('done without an id uses the current step and reports it as the target', async () => {
  const r = applyAction(fixtureChart(), { action: 'done' }, 9)
  expect(r.target).toBe('S2.P2')
  expect(r.chart?.items[1]?.items[1]?.status).toBe('done')
  expect(r.chart?.items[1]?.items[1]?.phase).toBeNull()
})

test('reset reopens done ancestors and clears the item', async () => {
  let c = fixtureChart()
  c = ok(c, { action: 'done', id: 'S2.P2', commit: 'abc1234', note: 'n' })
  c = ok(c, { action: 'done', id: 'S2.P3' })
  expect(c.items[1]?.status).toBe('done')
  const r = ok(c, { action: 'reset', id: 'S2.P2' })
  expect(r.items[1]?.status).toBe('active')
  expect(r.items[1]?.doneAt).toBeNull()
  const p2 = r.items[1]?.items[1]
  expect(p2?.status).toBe('pending')
  expect(p2?.commit).toBeNull()
  expect(p2?.note).toBeNull()
  expect(p2?.phase).toBeNull()
  expect(r.finishedAt).toBeNull()
})

test('commit sets the commit and returns the same chart when unchanged', async () => {
  const f = fixtureChart()
  const first = applyAction(f, { action: 'commit', id: 'S2.P2', commit: 'ABCDEF1234' }, 5)
  expect(first.chart?.items[1]?.items[1]?.commit).toBe('abcdef1')
  expect(first.chart?.items[1]?.items[1]?.status).toBe('active')
  const second = applyAction(first.chart, { action: 'commit', id: 'S2.P2', commit: 'abcdef1' }, 6)
  expect(second.chart).toBe(first.chart)
  expect(second.chart?.revision).toBe(first.chart?.revision)
  const odd = ok(f, { action: 'commit', id: 'S2.P2', commit: 'v1.2.3-long-name' })
  expect(odd.items[1]?.items[1]?.commit).toBe('v1.2.3-long-')
})

test('add appends under a parent or at the top, and reopens a done parent', async () => {
  const f = fixtureChart()
  const under = ok(f, { action: 'add', parent: 'S2', items: [{ id: 'S2.P4', title: 'New part' }] })
  expect(under.items[1]?.items.map(i => i.id)).toEqual(['S2.P1', 'S2.P2', 'S2.P3', 'S2.P4'])
  const top = ok(f, { action: 'add', items: [{ id: 'S6', title: 'Extra' }] })
  expect(top.items.at(-1)?.id).toBe('S6')
  const reopened = ok(f, { action: 'add', parent: 'S1', items: [{ id: 'S1.X', title: 'Late' }] })
  expect(reopened.items[0]?.status).toBe('active')
  expect(reopened.items[0]?.doneAt).toBeNull()
  expect(applyAction(f, { action: 'add', items: [{ id: 'S2', title: 'dup' }] }, 1).error).toBe(ERR + 'the id "S2" is used twice.')
  expect(applyAction(f, { action: 'add', parent: 'zz', items: [{ id: 'q', title: 'q' }] }, 1).error?.startsWith(ERR + 'no item "zz"')).toBe(true)
})

test('progress and percent', async () => {
  const f = fixtureChart()
  expect(Math.abs(progress(f) - 0.28889) < 0.0001).toBe(true)
  expect(percentOf(progress(f), false)).toBe(28)
  expect(percentOf(0.999, false)).toBe(99)
  expect(percentOf(1, true)).toBe(100)
  expect(currentPath(f).map(p => [p.item.id, p.pos, p.count])).toEqual([
    ['S2', 2, 5],
    ['S2.P2', 2, 3],
  ])
  const next = nextItem(f)
  expect(next?.item.id).toBe('S2.P3')
  expect([next?.pos, next?.count, next?.topPos, next?.topCount]).toEqual([3, 3, 2, 5])
})

test('routeText shows the route to the model', async () => {
  const text = routeText(fixtureChart(), null, 0)
  expect(text).toContain('Route "M1.6": 1/5 done, 28%.')
  expect(text).toContain('Now: S2 Planet catalogue › S2.P2 Catalogue UI · phase implement (3/6)')
  expect(text).toContain('Next: S2.P3 Search')
  expect(text).toContain('✓ S1 Scaffolding · a1b2c3d')
  expect(text).toContain('▹ S2 Planet catalogue')
  expect(text).toContain('  ✓ S2.P1 Data model')
  expect(text).toContain('  ▸ S2.P2 Catalogue UI · [plan ✓ · approve ✓ · ▸implement · checks · accept · commit]')
  expect(text).toContain('  ○ S2.P3 Search')
  expect(text).toContain('○ S3 Orbit view')
  expect(text).not.toContain('Sessions:')
  expect(routeText(null, null, 0)).toBe('No route charted.')
  const idle = routeText({ ...fixtureChart(), current: null }, null, 0)
  expect(idle).toContain('Now: nothing current.')
})

test('routeText lists the sessions, holds and unclaimed parts when shared', async () => {
  const share: ShareView = {
    chartId: 'c1',
    meLabel: 'aaaa',
    peers: [{ sessionId: 'cccc9999', label: 'cccc', color: 0xd7af5f, isLive: false, seenAt: 0, current: 'S3', holds: ['S3'] }],
    held: {
      S2: { sessionId: 'aaaa1111', label: 'aaaa', color: 0, node: 'S2', force: false, isMe: true },
      S3: { sessionId: 'cccc9999', label: 'cccc', color: 0xd7af5f, node: 'S3', force: false, isMe: false },
    },
    unclaimed: ['S4', 'S5'],
    myHolds: ['S2'],
  }
  const text = routeText(fixtureChart(), share, 5 * 60000)
  expect(text).toContain('Sessions:')
  expect(text).toContain('- this session (aaaa): now S2.P2 Catalogue UI · holds S2')
  expect(text).toContain('- cccc (idle 5m): now S3 Orbit view · holds S3')
  expect(text).toContain('Unclaimed: S4, S5.')
  expect(text).toContain('Work only on parts this session holds or on unclaimed ones; a part another session holds is refused.')
  expect(text).toContain('▹ S2 Planet catalogue (yours)')
  expect(text).toContain('○ S3 Orbit view (held by cccc)')
})

const base: ReplayOp = { t: 0, s: 'aaaa', n: 1, input: { action: 'plan' } }
const plan = (items: unknown[], over: Partial<ReplayOp> = {}): ReplayOp => ({
  ...base,
  input: { action: 'plan', title: 'R', items },
  ...over,
})
const X = { id: 'X', title: 'x' }
const Y = { id: 'Y', title: 'y' }

test('replay orders ops by time, then session id, then counter', async () => {
  const ops: ReplayOp[] = [
    plan([X, Y], { t: 5 }),
    { t: 10, s: 'bbbb', n: 1, input: { action: 'done', id: 'X' } },
    { t: 10, s: 'aaaa', n: 1, input: { action: 'start', id: 'X' } },
  ]
  // Equal times: aaaa sorts first, so X is started and then done.
  expect(replay(ops)?.items[0]?.status).toBe('done')
  expect(replay([...ops].reverse())).toEqual(replay(ops))
  expect(replay([ops[1] as ReplayOp, ops[2] as ReplayOp, ops[0] as ReplayOp])).toEqual(replay(ops))
  // Two sessions interleave by time.
  const mixed: ReplayOp[] = [
    plan([X, Y], { t: 1 }),
    { t: 3, s: 'bbbb', n: 1, input: { action: 'done', id: 'Y' } },
    { t: 2, s: 'aaaa', n: 2, input: { action: 'done', id: 'X' } },
  ]
  const chart = replay(mixed)
  expect(chart?.items.map(i => i.status)).toEqual(['done', 'done'])
  expect(chart?.finishedAt).toBe(3)
  expect(chart?.current).toBeNull()
})

test('replay skips an op that fails', async () => {
  const ops: ReplayOp[] = [
    plan([X, Y], { t: 1 }),
    plan([Y], { t: 3, s: 'bbbb' }),
    { t: 4, s: 'aaaa', n: 2, input: { action: 'done', id: 'X' } },
  ]
  const chart = replay(ops)
  expect(chart?.items.map(i => i.id)).toEqual(['Y'])
  expect(chart?.items[0]?.status).toBe('pending')
  expect(replay([])).toBeNull()
})
