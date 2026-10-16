import { expect, test } from 'claude-code/testing'

import { PEER_COLORS } from '../hooks/cells'
import { DEMO_END_MS, DEMO_TICK_MS, demoAt, isDemoChangeAt } from '../hooks/demo'

test('the demo starts with the scaffolding done and the first part under way', async () => {
  const d = demoAt(0, 0)
  expect(d.chart.title).toBe('M1.6 Planet catalogue')
  expect(d.chart.items[0]?.status).toBe('done')
  expect(d.chart.items[0]?.commit).toBe('a1b2c3d')
  expect(d.chart.current).toBe('S2.P1')
  expect(d.chart.items[1]?.items[0]?.phase).toBe('plan')
  expect(d.agents).toEqual([])
  expect(d.checks).toEqual([])
  expect(d.commit).toBeNull()
  expect(d.share.meLabel).toBe('demo')
  expect(d.share.myHolds).toEqual(['S2'])
  expect(d.share.peers[0]?.current).toBeNull()
  expect(d.share.peers[0]?.holds).toEqual([])
})

test('a subagent runs, and a second session works a stage in parallel', async () => {
  const d = demoAt(4000, 0)
  expect(d.agents.length).toBe(1)
  expect(d.agents[0]?.description).toBe('implement data model')
  expect(d.agents[0]?.type).toBe('general-purpose')
  expect(d.agents[0]?.endedAt).toBeNull()
  const peer = d.share.peers[0]
  expect(peer?.label).toBe('b7e2')
  expect(peer?.isLive).toBe(true)
  expect(peer?.color).toBe(PEER_COLORS[0])
  expect(peer?.current).toBe('S3')
  expect(peer?.holds).toEqual(['S3'])
  expect(d.share.held.S3?.sessionId).toBe('b7e2')
  expect(d.share.held.S2?.isMe).toBe(true)
  expect(d.share.unclaimed).toEqual(['S4', 'S5'])
  // Each session has its own current step.
  expect(d.chart.current).toBe('S2.P1')
  expect(d.chart.items[2]?.phase).toBe('plan')
  expect(d.chart.items[1]?.items[0]?.phase).toBe('implement')
})

test('a check runs, then shows its result for six seconds', async () => {
  const running = demoAt(8000, 0)
  expect(running.checks.length).toBe(1)
  expect(running.checks[0]?.label).toBe('npm test')
  expect(running.agents).toEqual([])
  expect(running.lastCheck).toBeNull()
  const ended = demoAt(9500, 0)
  expect(ended.checks).toEqual([])
  expect(ended.lastCheck?.label).toBe('npm test')
  expect(ended.lastCheck?.ok).toBe(true)
  expect(demoAt(15000, 0).lastCheck).not.toBeNull()
  expect(demoAt(15100, 0).lastCheck).toBeNull()
})

test('commits and parts finish in order', async () => {
  expect(demoAt(11500, 0).commit).toEqual({ seq: 1, hash: 'b2c3d4e' })
  const first = demoAt(12500, 0)
  expect(first.chart.items[1]?.items[0]?.status).toBe('done')
  expect(first.chart.items[1]?.items[0]?.commit).toBe('b2c3d4e')
  expect(first.chart.current).toBe('S2.P2')
  const second = demoAt(17000, 0)
  expect(second.commit).toEqual({ seq: 2, hash: 'c3d4e5f' })
  expect(second.chart.items[1]?.items[1]?.status).toBe('done')
  expect(second.chart.items[1]?.items[1]?.commit).toBe('c3d4e5f')
  expect(second.chart.current).toBe('S2.P3')
  expect(second.agents.map(a => a.id)).toEqual(['demo-a3'])
  const third = demoAt(19500, 0)
  expect(third.chart.items[1]?.status).toBe('done')
  expect(third.chart.current).toBe('S4')
  expect(third.agents).toEqual([])
  expect(demoAt(21000, 0).chart.current).toBe('S5')
  expect(demoAt(21000, 0).share.unclaimed).toEqual(['S5'])
})

test('the other session finishes its stage in the middle of the demo', async () => {
  const d = demoAt(16500, 0)
  expect(d.chart.items[2]?.status).toBe('done')
  expect(d.chart.items[2]?.commit).toBe('9e8d7c6')
  expect(d.share.peers[0]?.holds).toEqual([])
  expect(d.share.peers[0]?.current).toBeNull()
  expect(d.share.held.S3).toBeUndefined()
})

test('the route completes', async () => {
  const d = demoAt(23000, 0)
  expect(d.chart.finishedAt).not.toBeNull()
  expect(d.chart.items.every(i => i.status === 'done')).toBe(true)
  expect(d.chart.current).toBeNull()
  expect(demoAt(22900, 0).chart.finishedAt).toBeNull()
  expect(demoAt(DEMO_END_MS, 0).chart.finishedAt).not.toBeNull()
})

test('the demo is deterministic and follows the start time', async () => {
  expect(demoAt(12345, 5)).toEqual(demoAt(12345, 5))
  expect(demoAt(0, 1000).chart.startedAt).toBe(1000)
  expect(demoAt(3500, 1000).agents[0]?.startedAt).toBe(4500)
})

test('the demo keeps the signals of its session for the pane, the other session produces none', async () => {
  expect(demoAt(0, 0).log).toEqual([])
  const log = demoAt(12_000, 0).log
  expect(log.map(s => [s.seq, s.kind, s.text, s.detail, s.ok])).toEqual([
    [1, 'agent', 'implement data model', 'general-purpose · sonnet', null],
    [2, 'agent-end', 'implement data model', 'done · 3s', true],
    [3, 'check', 'npm test', '2s', true],
    [4, 'commit', 'b2c3d4e', '', true],
  ])
  expect(log.map(s => s.at)).toEqual([3500, 7000, 9000, 11_500])
  // The item each signal belongs to is the session's current one after the step's acts.
  expect(log.map(s => s.itemId)).toEqual(['S2.P1', 'S2.P1', 'S2.P1', 'S2.P1'])
  // Within one step: agent end, agent start, then the commit (the peer's finished stage adds nothing).
  const late = demoAt(17_000, 0).log
  expect(late.slice(4).map(s => [s.seq, s.kind, s.text])).toEqual([
    [5, 'agent', 'catalogue UI'],
    [6, 'agent-end', 'catalogue UI'],
    [7, 'agent', 'search index'],
    [8, 'commit', 'c3d4e5f'],
  ])
  expect(late[5]?.detail).toBe('done · 2s')
  expect(late[5]?.itemId).toBe('S2.P3')
  expect(demoAt(3000, 0).log.some(s => s.text.includes('S3'))).toBe(false)
})

test('the band is redrawn on the ticks where something changes', async () => {
  expect(isDemoChangeAt(2000)).toBe(true)
  expect(isDemoChangeAt(2100)).toBe(false)
  expect(isDemoChangeAt(0)).toBe(true)
  expect(isDemoChangeAt(100)).toBe(false)
  expect(isDemoChangeAt(3500)).toBe(true)
  expect(isDemoChangeAt(15000)).toBe(true)
  expect(isDemoChangeAt(1000)).toBe(false)
  expect(DEMO_TICK_MS).toBe(100)
  expect(DEMO_END_MS).toBe(26000)
})
