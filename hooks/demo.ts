import type { Chart, CheckRun, CrewMember, Holder, ItemStatus, ShareView, Signal } from '../types'
import { LIVE, PEER_COLORS } from './cells'
import { applyAction, isClosed } from './route'
import type { ProgressInput } from './route'
import { CHECK_SHOW_MS, formatDuration } from './signals'

/** The demo advances in steps of this many ms. */
export const DEMO_TICK_MS = 100
/** The demo ends this many ms after it starts. */
export const DEMO_END_MS = 26000

const PHASES = ['plan', 'approve', 'implement', 'checks', 'accept', 'commit']
const PEER = 'b7e2'

const PLAN: ProgressInput = {
  action: 'plan',
  title: 'M1.6 Planet catalogue',
  items: [
    { id: 'S1', title: 'Scaffolding' },
    {
      id: 'S2',
      title: 'Planet catalogue',
      items: [
        { id: 'S2.P1', title: 'Data model', phases: PHASES },
        { id: 'S2.P2', title: 'Catalogue UI', phases: PHASES },
        { id: 'S2.P3', title: 'Search', phases: PHASES },
      ],
    },
    { id: 'S3', title: 'Orbit view', phases: ['plan', 'implement', 'checks', 'commit'] },
    { id: 'S4', title: 'Polish' },
    { id: 'S5', title: 'Release' },
  ],
}

type Who = 'me' | 'peer'
type Step = {
  at: number
  acts?: { who: Who; input: ProgressInput }[]
  agentStart?: { id: string; description: string }
  agentEnd?: string
  checkStart?: { id: string; label: string }
  checkEnd?: string
  commit?: { seq: number; hash: string }
}

const me = (input: ProgressInput): { who: Who; input: ProgressInput } => ({ who: 'me', input })
const peer = (input: ProgressInput): { who: Who; input: ProgressInput } => ({ who: 'peer', input })
const start = (id: string, phase?: string): ProgressInput => ({ action: 'start', id, phase })

const RAW: Step[] = [
  { at: 0, acts: [me(PLAN), me({ action: 'done', id: 'S1', commit: 'a1b2c3d' }), me(start('S2.P1', 'plan'))] },
  { at: 2000, acts: [me(start('S2.P1', 'approve'))] },
  { at: 3000, acts: [peer(start('S3', 'plan'))] },
  {
    at: 3500,
    acts: [me(start('S2.P1', 'implement'))],
    agentStart: { id: 'demo-a1', description: 'implement data model' },
  },
  {
    at: 7000,
    acts: [me(start('S2.P1', 'checks'))],
    agentEnd: 'demo-a1',
    checkStart: { id: 'demo-c1', label: 'npm test' },
  },
  { at: 8000, acts: [peer(start('S3', 'implement'))] },
  { at: 9000, checkEnd: 'demo-c1' },
  { at: 10000, acts: [me(start('S2.P1', 'accept'))] },
  {
    at: 11500,
    acts: [me(start('S2.P1', 'commit')), me({ action: 'commit', id: 'S2.P1', commit: 'b2c3d4e' })],
    commit: { seq: 1, hash: 'b2c3d4e' },
  },
  { at: 12500, acts: [me({ action: 'done', id: 'S2.P1' }), me(start('S2.P2', 'plan'))] },
  { at: 13500, acts: [peer(start('S3', 'checks'))] },
  {
    at: 14500,
    acts: [me(start('S2.P2', 'implement'))],
    agentStart: { id: 'demo-a2', description: 'catalogue UI' },
  },
  // The check's line leaves the band six seconds after it ended.
  { at: 9000 + CHECK_SHOW_MS },
  { at: 16000, acts: [peer({ action: 'done', id: 'S3', commit: '9e8d7c6' })] },
  {
    at: 17000,
    acts: [me({ action: 'done', id: 'S2.P2', commit: 'c3d4e5f' }), me(start('S2.P3', 'implement'))],
    agentEnd: 'demo-a2',
    agentStart: { id: 'demo-a3', description: 'search index' },
    commit: { seq: 2, hash: 'c3d4e5f' },
  },
  { at: 19500, acts: [me({ action: 'done', id: 'S2.P3' }), me(start('S4'))], agentEnd: 'demo-a3' },
  { at: 21000, acts: [me({ action: 'done', id: 'S4' }), me(start('S5'))] },
  { at: 23000, acts: [me({ action: 'done', id: 'S5' })] },
]
const STEPS: Step[] = [...RAW].sort((a, b) => a.at - b.at)

/** What the band shows at `ms` into the demo, replayed from scratch so any moment is deterministic. */
export function demoAt(
  ms: number,
  startedAt: number,
): {
  chart: Chart
  share: ShareView
  agents: CrewMember[]
  checks: CheckRun[]
  lastCheck: CheckRun | null
  commit: { seq: number; hash: string } | null
  log: Signal[]
} {
  const log: Signal[] = []
  let chart: Chart | null = null
  let mine: string | null = null
  let theirs: string | null = null
  const agents = new Map<string, CrewMember>()
  const checks = new Map<string, CheckRun>()
  let commit: { seq: number; hash: string } | null = null
  for (const step of STEPS) {
    if (step.at > ms) break
    const t = startedAt + step.at
    for (const act of step.acts ?? []) {
      const cur = act.who === 'me' ? mine : theirs
      const r = applyAction(chart === null ? null : { ...chart, current: cur }, act.input, t)
      if (r.error !== undefined || r.chart === null) continue
      chart = r.chart
      if (act.who === 'me') mine = chart.current
      else theirs = chart.current
    }
    // The signals of this session, in the order they are produced within a step: agent end, agent start, check end, commit.
    const signal = (kind: Signal['kind'], text: string, detail: string): void => {
      log.push({ seq: log.length + 1, at: t, kind, text, detail, ok: true, itemId: mine })
    }
    if (step.agentEnd !== undefined) {
      const a = agents.get(step.agentEnd)
      if (a !== undefined) {
        agents.set(a.id, { ...a, endedAt: t, word: 'done' })
        signal('agent-end', a.description, 'done · ' + formatDuration(t - a.startedAt))
      }
    }
    if (step.agentStart !== undefined) {
      const { id, description } = step.agentStart
      agents.set(id, { id, description, type: 'general-purpose', model: 'sonnet', startedAt: t, endedAt: null, word: null })
      log.push({ seq: log.length + 1, at: t, kind: 'agent', text: description, detail: 'general-purpose · sonnet', ok: null, itemId: mine })
    }
    if (step.checkEnd !== undefined) {
      const c = checks.get(step.checkEnd)
      if (c !== undefined) {
        checks.set(c.id, { ...c, endedAt: t, ok: true })
        signal('check', c.label, formatDuration(t - c.startedAt))
      }
    }
    if (step.checkStart !== undefined) {
      const { id, label } = step.checkStart
      checks.set(id, { id, label, startedAt: t, endedAt: null, ok: null, isBackground: false })
    }
    if (step.commit !== undefined) {
      commit = step.commit
      signal('commit', step.commit.hash, '')
    }
  }
  const now = startedAt + ms
  const done: Chart = { ...(chart as Chart), current: mine }
  const status = (id: string): ItemStatus => done.items.find(i => i.id === id)?.status ?? 'pending'

  const held: Record<string, Holder> = {}
  const myHolds: string[] = []
  const theirHolds: string[] = []
  if (!isClosed(status('S2'))) {
    held.S2 = { sessionId: 'demo', label: 'demo', color: LIVE, node: 'S2', force: false, isMe: true }
    myHolds.push('S2')
  }
  if (ms >= 3000 && !isClosed(status('S3'))) {
    held.S3 = { sessionId: PEER, label: PEER, color: PEER_COLORS[0] ?? LIVE, node: 'S3', force: false, isMe: false }
    theirHolds.push('S3')
  }
  const share: ShareView = {
    chartId: 'demo',
    meLabel: 'demo',
    peers: [
      {
        sessionId: PEER,
        label: PEER,
        color: PEER_COLORS[0] ?? LIVE,
        isLive: true,
        seenAt: now,
        current: theirs,
        holds: theirHolds,
      },
    ],
    held,
    unclaimed: done.items.filter(i => !isClosed(i.status) && held[i.id] === undefined).map(i => i.id),
    myHolds,
  }
  const all = [...checks.values()]
  const ended = all
    .filter(c => c.endedAt !== null && c.endedAt >= now - CHECK_SHOW_MS)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

  return {
    chart: done,
    share,
    agents: [...agents.values()].filter(a => a.endedAt === null),
    checks: all.filter(c => c.endedAt === null),
    lastCheck: ended[0] ?? null,
    commit,
    log,
  }
}

/** True when a step of the demo falls in the tick that ends at `ms`: the band must be drawn again. */
export function isDemoChangeAt(ms: number): boolean {
  return STEPS.some(s => s.at > ms - DEMO_TICK_MS && s.at <= ms)
}
