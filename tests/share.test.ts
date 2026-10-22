import { expect, test } from 'claude-code/testing'

import type { Chart, OpInput, Participant } from '../types'
import { PEER_COLORS } from '../hooks/cells'
import { progress } from '../hooks/route'
import {
  CLAIM_LAPSE_MS,
  LIVE_MS,
  addClaim,
  autoClaimTarget,
  chartSummary,
  coverOf,
  dropClaim,
  holderOf,
  labelOf,
  mergeChart,
  newChartId,
  newParticipant,
  nextT,
  normalizeParticipant,
  slugOf,
} from '../hooks/share'

const NOW = 1_000_000_000_000
const A = 'aaaa1111'
const B = 'bbbb2222'
const C = 'cccc3333'

const part = (sessionId: string, over: Partial<Participant> = {}): Participant => ({
  ...newParticipant('c1', sessionId, NOW - 1000),
  seenAt: NOW,
  ...over,
})

const op = (t: number, input: OpInput, n = 1) => ({ t, n, input })

const PLAN: OpInput = {
  action: 'plan',
  title: 'R',
  items: [
    { id: 'S1', title: 'One' },
    {
      id: 'S2',
      title: 'Two',
      items: [
        { id: 'S2.P1', title: 'Part one' },
        { id: 'S2.P2', title: 'Part two' },
      ],
    },
    { id: 'S3', title: 'Three' },
    { id: 'S4', title: 'Four' },
  ],
}

test('slugs, ids, labels and the hybrid clock', async () => {
  expect(slugOf('C:\\Users\\A\\proj')).toBe('c-users-a-proj')
  expect(slugOf('/home/u/My Proj/')).toBe('home-u-My-Proj')
  expect(slugOf('')).toBe('unknown')
  expect(slugOf('x'.repeat(200)).length).toBe(120)
  expect(newChartId(1000, 'abcd-efgh-1234')).toBe('rs-abcdef')
  expect(labelOf('ab-cd-ef')).toBe('abcd')
  expect(nextT(5, 9)).toBe(10)
  expect(nextT(20, 9)).toBe(20)
})

test('normalizeParticipant drops malformed entries and rejects other versions', async () => {
  const raw = {
    ...part(A),
    takes: [{ sessionId: 'x', t: 1 }, { sessionId: 5, t: 1 }, null],
    claims: [{ id: 'S1', at: 3, force: true }, { id: 4, at: 1 }, { id: 'S2', at: 'x' }],
    ops: [op(1, PLAN), { t: 'x', n: 1, input: { action: 'plan' } }, op(2, { action: 'zap' as never }), { t: 3, n: 1 }],
    endedAt: 'soon',
    current: 5,
  }
  const p = normalizeParticipant(JSON.parse(JSON.stringify(raw)))
  expect(p?.takes).toEqual([{ sessionId: 'x', t: 1 }])
  expect(p?.claims).toEqual([{ id: 'S1', at: 3, force: true }])
  expect(p?.ops.length).toBe(1)
  expect(p?.endedAt).toBeNull()
  expect(p?.current).toBeNull()
  expect(normalizeParticipant({ ...raw, v: 2 })).toBeNull()
  expect(normalizeParticipant('text')).toBeNull()
  expect(normalizeParticipant({ ...raw, chartId: 3 })).toBeNull()
})

test('two participants build one route; each viewer has its own current step', async () => {
  const a = part(A, {
    current: 'S2.P2',
    ops: [op(1, PLAN), op(3, { action: 'done', id: 'S2.P1' }, 2)],
  })
  const b = part(B, {
    current: null,
    ops: [op(2, { action: 'done', id: 'S1', commit: 'a1b2c3d' }), op(4, { action: 'start', id: 'S2.P2', phase: 'implement' }, 2)],
  })
  const asA = mergeChart([a, b], A, NOW)
  const asB = mergeChart([a, b], B, NOW)
  expect(asA.chart?.items.map(i => i.status)).toEqual(['done', 'active', 'pending', 'pending'])
  expect(asA.chart?.items[0]?.commit).toBe('a1b2c3d')
  expect(asA.chart?.items[1]?.items.map(i => i.status)).toEqual(['done', 'active'])
  expect(asA.chart?.current).toBe('S2.P2')
  expect(asB.chart?.current).toBeNull()
  expect(JSON.stringify({ ...asA.chart, current: null })).toBe(JSON.stringify({ ...asB.chart, current: null }))
  expect(asA.maxT).toBe(4)
  // S1 done, S2 half way (one of two parts), S3 and S4 pending.
  expect(Math.abs(progress(asA.chart as Chart) - 0.375) < 0.0001).toBe(true)
  expect(asA.share.peers.map(p => p.label)).toEqual(['bbbb'])
  expect(asA.share.peers[0]?.color).toBe(PEER_COLORS[0])
  expect(asA.share.meLabel).toBe('aaaa')
  expect(asA.members.length).toBe(2)
  expect(asA.liveOthers).toBe(1)
})

test('the replay is reused only for the very same ops, and every merge gets its own copy', async () => {
  const a = part(A, { ops: [op(1, PLAN)] })
  const m1 = mergeChart([a], A, NOW)
  const m2 = mergeChart([a], A, NOW)
  expect(m2.chart).toEqual(m1.chart)
  expect(m2.chart === m1.chart).toBe(false)
  const first = m1.chart?.items[0]
  if (first !== undefined) first.status = 'done'
  expect(mergeChart([a], A, NOW).chart?.items[0]?.status).toBe('pending')
  // The same count and the same last op, but other content: not the same route.
  const other = part(A, { ops: [op(1, { ...PLAN, title: 'Other' })] })
  expect(mergeChart([other], A, NOW).chart?.title).toBe('Other')
  // A new op: replayed.
  const more = part(A, { ops: [op(1, PLAN), op(2, { action: 'done', id: 'S1' }, 2)] })
  expect(mergeChart([more], A, NOW).chart?.items[0]?.status).toBe('done')
})

test('a take supersedes a session; its ops still replay and its claims stop counting', async () => {
  const taken = part(A, { ops: [op(1, PLAN)], claims: [{ id: 'S2', at: 5, force: false }], current: 'S2' })
  const taker = part(B, { joinedAt: NOW - 500, takes: [{ sessionId: A, t: NOW - 400 }] })
  const asTaken = mergeChart([taken, taker], A, NOW)
  expect(asTaken.isSuperseded).toBe(true)
  const asTaker = mergeChart([taken, taker], B, NOW)
  expect(asTaker.isSuperseded).toBe(false)
  expect(asTaker.chart?.items.length).toBe(4)
  expect(asTaker.share.held).toEqual({})
  expect(asTaker.members.map(p => p.sessionId)).toEqual([B])
  expect(asTaker.share.peers).toEqual([])
  // A re-join after the take is not superseded.
  const back = { ...taken, joinedAt: NOW - 100 }
  expect(mergeChart([back, taker], A, NOW).isSuperseded).toBe(false)
})

test('liveness: a session is live for 3 minutes, a claim stands for 10', async () => {
  const claim = [{ id: 'S3', at: 5, force: false }]
  const at = (ago: number, over: Partial<Participant> = {}) => [
    part(A, { ops: [op(1, PLAN)] }),
    part(B, { seenAt: NOW - ago, claims: claim, ...over }),
  ]
  expect(mergeChart(at(2 * 60000), A, NOW).share.peers[0]?.isLive).toBe(true)
  expect(mergeChart(at(LIVE_MS + 60000), A, NOW).share.peers[0]?.isLive).toBe(false)
  expect(mergeChart(at(9 * 60000), A, NOW).share.held.S3?.sessionId).toBe(B)
  expect(mergeChart(at(CLAIM_LAPSE_MS + 60000), A, NOW).share.held.S3).toBeUndefined()
  expect(mergeChart(at(1000, { endedAt: NOW - 500 }), A, NOW).share.held.S3).toBeUndefined()
  expect(mergeChart(at(1000, { endedAt: NOW - 500 }), A, NOW).share.peers[0]?.isLive).toBe(false)
  expect(mergeChart(at(1000, { detached: true }), A, NOW).share.peers).toEqual([])
})

test('claim precedence', async () => {
  const held = (a: Participant['claims'], b: Participant['claims'], extra: OpInput[] = []) => {
    const files = [
      part(A, { ops: [op(1, PLAN), ...extra.map((x, i) => op(2 + i, x, 2 + i))], claims: a }),
      part(B, { claims: b }),
    ]

    return mergeChart(files, A, NOW).share.held
  }
  // First come, first served.
  expect(held([{ id: 'S2', at: 100, force: false }], [{ id: 'S2', at: 50, force: false }]).S2?.sessionId).toBe(B)
  expect(held([{ id: 'S2', at: 40, force: false }], [{ id: 'S2', at: 50, force: false }]).S2?.sessionId).toBe(A)
  // A person's claim beats both; the latest of them wins.
  const forced = held([{ id: 'S2', at: 200, force: true }], [{ id: 'S2', at: 50, force: false }])
  expect(forced.S2?.sessionId).toBe(A)
  expect(forced.S2?.force).toBe(true)
  expect(held([{ id: 'S2', at: 100, force: true }], [{ id: 'S2', at: 200, force: true }]).S2?.sessionId).toBe(B)
  // A claim on a node under (or over) another session's accepted claim is dropped.
  const nested = held([{ id: 'S2', at: 10, force: false }], [{ id: 'S2.P1', at: 20, force: false }])
  expect(Object.keys(nested)).toEqual(['S2'])
  const over = held([{ id: 'S2.P1', at: 20, force: false }], [{ id: 'S2', at: 10, force: false }])
  expect(Object.keys(over)).toEqual(['S2'])
  expect(over.S2?.sessionId).toBe(B)
  // The same session may hold a node and its parts.
  expect(Object.keys(held([{ id: 'S2', at: 10, force: false }, { id: 'S2.P1', at: 20, force: false }], [])).sort()).toEqual(['S2', 'S2.P1'])
  // Closed nodes cannot be held.
  expect(held([{ id: 'S4', at: 10, force: false }], [], [{ action: 'done', id: 'S4' }]).S4).toBeUndefined()
  // Unknown nodes cannot be held.
  expect(held([{ id: 'ZZ', at: 10, force: false }], []).ZZ).toBeUndefined()
})

test('holderOf, coverOf and autoClaimTarget', async () => {
  const files = [
    part(A, { ops: [op(1, PLAN)], claims: [{ id: 'S3', at: 10, force: false }] }),
    part(B, { claims: [{ id: 'S2.P2', at: 10, force: false }] }),
  ]
  const m = mergeChart(files, A, NOW)
  const chart = m.chart as Chart
  expect(holderOf(chart, m.share, 'S2.P2', A)?.sessionId).toBe(B)
  // A descendant is held: asking about the parent finds it.
  expect(holderOf(chart, m.share, 'S2', A)?.node).toBe('S2.P2')
  // Ancestor of a held node, and an unrelated node.
  expect(holderOf(chart, m.share, 'S2.P1', A)).toBeNull()
  expect(holderOf(chart, m.share, 'S1', A)).toBeNull()
  // Holders of this session do not block it.
  expect(holderOf(chart, m.share, 'S3', A)).toBeNull()
  expect(coverOf(chart, m.share, 'S3')?.sessionId).toBe(A)
  // Starting a part claims the whole stage when no one else holds part of it.
  expect(autoClaimTarget(chart, m.share, 'S1', A)).toBe('S1')
  expect(autoClaimTarget(chart, m.share, 'S4', A)).toBe('S4')
  // Another session holds a part of S2: claim only the part.
  expect(autoClaimTarget(chart, m.share, 'S2.P1', A)).toBe('S2.P1')
  // Already covered by this session.
  expect(autoClaimTarget(chart, m.share, 'S3', A)).toBeNull()
  expect(autoClaimTarget(chart, null, 'S2.P1', A)).toBe('S2')
  expect(autoClaimTarget(null, null, 'S2.P1', A)).toBeNull()
  // Unclaimed: open top-level items with nothing held inside.
  expect(m.share.unclaimed).toEqual(['S1', 'S4'])
  expect(m.share.myHolds).toEqual(['S3'])
})

test('claims are added and dropped under the new node', async () => {
  const chart = mergeChart([part(A, { ops: [op(1, PLAN)] })], A, NOW).chart as Chart
  const claims = [
    { id: 'S2.P1', at: 1, force: false },
    { id: 'S3', at: 2, force: false },
  ]
  expect(addClaim(claims, 'S2', 5, true, chart)).toEqual([
    { id: 'S3', at: 2, force: false },
    { id: 'S2', at: 5, force: true },
  ])
  expect(addClaim(claims, 'S2', 5, true)).toEqual([...claims, { id: 'S2', at: 5, force: true }])
  expect(dropClaim(claims, 'S3')).toEqual([{ id: 'S2.P1', at: 1, force: false }])
})

test('discarded follows the newest file; summaries describe the route', async () => {
  const files = [part(A, { ops: [op(1, PLAN)], seenAt: NOW - 5000, discarded: true }), part(B, { seenAt: NOW - 1000 })]
  expect(mergeChart(files, A, NOW).isDiscarded).toBe(false)
  expect(mergeChart([files[0] as Participant, part(B, { seenAt: NOW - 9000 })], A, NOW).isDiscarded).toBe(true)
  const m = mergeChart(files, A, NOW)
  const s = chartSummary('c1', m, NOW)
  expect(s.title).toBe('R')
  expect([s.pct, s.done, s.total, s.members]).toEqual([0, 0, 4, 2])
  expect(s.live).toBe(2)
  expect(s.labels).toEqual(['aaaa', 'bbbb'])
  expect(s.updatedAt).toBe(NOW - 1000)
  const third = mergeChart([...files, part(C, { seenAt: NOW - 10 * 60000 })], A, NOW)
  expect(chartSummary('c1', third, NOW).live).toBe(2)
})
