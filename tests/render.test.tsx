import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { Participant } from '../types'
import { FAIL, LIVE, OK, PEER_COLORS, TRACK, decodeCells, lighten, mixColor } from '../hooks/cells'
import type { Cell } from '../hooks/cells'
import { mirrorMarker } from '../hooks/mirror'
import { newChartId } from '../hooks/share'
import { splitHint } from '../hooks/route'
import { INIT_PROMPT, NUDGE_TEXT, TOOL_DESCRIPTION, USAGE } from '../hooks/texts'

const NOW = Date.parse('2026-10-14T10:00:00Z')
const TOOL = 'mcp__claudecharter__progress'
const ROOT = '/home/u/.claude/claudecharter/x-proj'
const MIRROR = '/x/proj/PROGRESS.md'

/** The hint slot is indented by 2, so a 122 column window gives the row 120 columns. */
const HINT = {
  plugin: 'claudecharter',
  surface: 'terminal',
  component: 'PromptHint',
  requestId: 'hint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } as never,
  viewport: { columns: 122, rows: 40 } as never,
} as const

/** The band directly above the prompt: 125 columns less the engine's five for its `[-]` leaves 120. */
const ABOVE = {
  plugin: 'claudecharter',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'above',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never,
  viewport: { columns: 125, rows: 40 } as never,
} as const

const PANE = {
  plugin: 'claudecharter',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'charter',
  props: { title: 'Claude-Charter', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
} as const

/** The same pane on the desktop, which has no Raster: it is drawn still. */
const PANE_DESKTOP = { ...PANE, surface: 'desktop' } as const

/** All four effects off: a still band and no timer. */
const STILL = { glide: 'off', roll: 'off', activity: 'off', celebrate: 'off' }

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function text(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  const { type, props, children } = node as Node
  // A Button of a label alone keeps it in `props.label` and has no `children` (the Button's contract in the types).
  if (type === 'Button' && (children ?? []).length === 0 && typeof props?.label === 'string') return props.label
  return (children ?? []).map(text).join('')
}

function walk(node: unknown, out: Node[] = []): Node[] {
  if (node === null || typeof node !== 'object') return out
  out.push(node as Node)
  for (const child of (node as Node).children ?? []) walk(child, out)
  return out
}

/** Like `text`, but a Raster contributes the characters of its cells. */
function seen(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  const { type, props, children } = node as Node
  if (type === 'Raster') return cellText(decodeCells(String(props?.cells ?? '')))
  if (type === 'Button' && (children ?? []).length === 0 && typeof props?.label === 'string') return props.label
  return (children ?? []).map(seen).join('')
}

const raster = (node: unknown) => walk(node).find(n => n.type === 'Raster')
const cellText = (cells: Cell[]): string => cells.map(c => String.fromCodePoint(c.cp)).join('')
const rowCells = (node: unknown): Cell[] => decodeCells(String(raster(node)?.props?.cells ?? ''))
const rowText = (node: unknown): string => cellText(rowCells(node))
const blitText = (b: { cells?: string } | undefined): string => cellText(decodeCells(b?.cells ?? ''))

const PH = ['plan', 'approve', 'implement', 'checks', 'accept', 'commit']
const ITEMS = [
  { id: 'S1', title: 'Scaffolding' },
  {
    id: 'S2',
    title: 'Planet catalogue',
    items: [
      { id: 'S2.P1', title: 'Data model', phases: PH },
      { id: 'S2.P2', title: 'Catalogue UI', phases: PH },
      { id: 'S2.P3', title: 'Search', phases: PH },
    ],
  },
  { id: 'S3', title: 'Orbit view' },
]
const PLAN = { action: 'plan', title: 'M1.6', items: ITEMS }

/**
 * A path as the stub keys it: forward slashes, no drive prefix, no trailing slash. The engine hands an `fs.*` hook the path
 * in the host's form (`C:\home\u\...` on Windows for the `/home/u/...` the mod wrote), so the stub keys by this form and
 * every path a test compares is the POSIX spelling, whatever the platform.
 */
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/|$)/, '').replace(/\/+$/, '')

/** The engine beneath the mod: an in-memory file system, the session, the recorders. */
function world(on: On, stacked: string[] = [], above?: string) {
  const state = {
    sid: 'aaaa1111',
    root: '/x/proj',
    blitAnswer: {} as { deny?: string },
    bash: { stdout: '', isError: false, sha: undefined as string | undefined },
  }
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const writes: { path: string; text: string }[] = []
  const toasts: string[] = []
  const blits: { requestId: string; key: string; cells?: string }[] = []
  const submits: string[] = []
  const fills: { text: string; mode: string }[] = []
  const opens: string[] = []
  const tools: { name: string; description: string; isDeferred?: boolean }[] = []
  const commands: string[] = []
  let stamp = 0
  const put = (path: string, body: string) => {
    files.set(norm(path), { text: body, mtimeMs: ++stamp })
  }
  const clock = mock.clock(on, { now: NOW })

  on('fs.exists', (_$, e) => {
    const p = norm(e.path)
    return { value: files.has(p) || [...files.keys()].some(k => k.startsWith(p + '/')) }
  })
  on('fs.read', (_$, e) => {
    const f = files.get(norm(e.path))
    if (f === undefined) throw new Error('ENOENT')
    return { value: f.text }
  })
  on('fs.write', (_$, e) => {
    put(e.path, e.text)
    writes.push({ path: norm(e.path), text: e.text })
    return { value: undefined }
  })
  on('fs.list', (_$, e) => {
    const prefix = norm(e.path) + '/'
    const seen = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: false }>()
    for (const [path, f] of files) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash < 0) seen.set(rest, { name: rest, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })
      else if (!seen.has(rest.slice(0, slash))) {
        seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
      }
    }
    if (seen.size === 0) throw new Error('ENOENT')
    return { value: [...seen.values()] }
  })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.id', () => ({ value: state.sid }))
  on('session.root', () => ({ value: state.root }))
  on('tool.register', (_$, e) => {
    const spec = e as unknown as { name: string; description: string; isDeferred?: boolean }
    tools.push(spec)
    return { value: { tool: 'mcp__claudecharter__' + spec.name } }
  })
  on('command.register', (_$, e) => {
    commands.push((e as unknown as { name: string }).name)
    return { value: { command: 'charter' } }
  })
  on('prompt.submit', (_$, e) => {
    submits.push(e.text)
    return {} as never
  })
  on('prompt.fill', (_$, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.blit', (_$, e) => {
    blits.push({ requestId: e.requestId, key: e.key, cells: (e as unknown as { cells?: string }).cells })
    return { value: state.blitAnswer }
  })
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', () => ({ value: undefined }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.call', (_$, e) => {
    if (String(e.tool) === 'Bash') {
      if (state.bash.isError) return { isError: true, result: 'boom', text: 'boom' } as never
      const result: Record<string, unknown> = { stdout: state.bash.stdout, stderr: '', interrupted: false }
      if (state.bash.sha !== undefined) result.gitOperation = { commit: { sha: state.bash.sha } }
      return { result } as never
    }
    return { result: 'ok' } as never
  })
  // The engine's own hint line, with the rows other mods stacked under it.
  on('ui.render', ({ ui }, e) => {
    const { Box, Text } = ui.resolve(e)
    // The band above the prompt: empty, or one row another mod drew there.
    if (e.component === 'AbovePrompt') return above === undefined ? <Box /> : <Text>{above}</Text>
    if (stacked.length === 0) return <Text>? for shortcuts</Text>
    return (
      <Box flexDirection="column">
        <Text>? for shortcuts</Text>
        {stacked.map(row => (
          <Text>{row}</Text>
        ))}
      </Box>
    )
  })

  /** Writes a participant file as another process would. */
  const peerFile = (chartId: string, sessionId: string, over: Partial<Participant> = {}) => {
    const p: Participant = {
      v: 1,
      chartId,
      sessionId,
      joinedAt: NOW,
      seenAt: NOW,
      endedAt: null,
      detached: false,
      discarded: false,
      takes: [],
      current: null,
      claims: [],
      ops: [],
      ...over,
    }
    put(`${ROOT}/${chartId}/${sessionId}.json`, JSON.stringify(p))
  }
  /** A participant file as it is on disk now. */
  const fileOf = (sessionId: string): Participant | undefined => {
    const key = [...files.keys()].find(k => k.endsWith(`/${sessionId}.json`))
    return key === undefined ? undefined : (JSON.parse(files.get(key)?.text ?? 'null') as Participant)
  }
  const chartId = (): string => fileOf('aaaa1111')?.chartId ?? newChartId(NOW, 'aaaa1111')

  return { state, files, writes, toasts, blits, submits, fills, opens, tools, commands, clock, put, peerFile, fileOf, chartId }
}

const begin = ($: Engine) => $.session.start({ cwd: '/x/proj', surface: 'terminal', isInteractive: true } as never)
const mount = ($: Engine, target: object = HINT) => $.ui.mount(target as never)

/** One call of the progress tool: the result text, or the refusal. */
async function call($: Engine, input: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const r = (await $.tool.call({ tool: TOOL, ...input, ...extra } as never)) as {
    result?: unknown
    text?: string
    deny?: string
    isError?: boolean
  }

  return {
    text: typeof r.result === 'string' ? r.result : (r.text ?? ''),
    deny: r.deny ?? (r.isError === true ? (r.text ?? '') : undefined),
  }
}

/** A `/charter` command. */
async function cmd($: Engine, args: string): Promise<string> {
  const r = (await $.command.run({ command: 'charter', args, origin: { kind: 'composer' } } as never)) as { text: string }

  return r.text
}

/** Sessions start, a route is charted and the first part is under way. */
async function charted($: Engine) {
  await begin($)
  await call($, PLAN)
  await call($, { action: 'start', id: 'S2.P1', phase: 'plan' })
}

test('the tool and the command are registered', async ($, on) => {
  const w = world(on)
  await begin($)
  expect(w.tools.length).toBe(1)
  expect(w.tools[0]?.name).toBe('progress')
  expect(w.tools[0]?.isDeferred).toBe(false)
  expect(w.tools[0]?.description).toBe(TOOL_DESCRIPTION)
  expect(TOOL_DESCRIPTION).toContain('call plan first')
  expect(TOOL_DESCRIPTION).toContain('Chart what you know; when planning splits a step into parts, add them under it.')
  expect(TOOL_DESCRIPTION).not.toContain('Use it only when')
  expect(TOOL_DESCRIPTION).not.toContain('never for a single small task')
  expect(w.commands).toEqual(['charter'])
})

test('with no route the hint slot is the bottom drawing, unchanged', async ($, on) => {
  world(on)
  await begin($)
  const ui = await mount($)
  const drawn = (await ui.drawn()) as Node
  expect(raster(drawn)).toBeUndefined()
  expect(drawn.type).toBe('Text')
  expect(text(drawn)).toBe('? for shortcuts')
})

test('the tool charts a route, the band draws it, one participant file holds it', async ($, on) => {
  const w = world(on)
  await begin($)
  const ui = await mount($)
  const r = await call($, PLAN)
  expect(r.text.startsWith('Route "M1.6"')).toBe(true)
  const drawn = await ui.drawn()
  // The stub lays the probe out at the viewport's size at mount (documented for MountTarget.viewport), so the row takes
  // the 122 columns it measures; the viewport fallback (120 less the glyph's 2) only applies before a measurement.
  expect(raster(drawn)?.props?.columns).toBe(122)
  expect(raster(drawn)?.props?.rows).toBe(1)
  expect(rowText(drawn)).toContain('M1.6')
  const jsons = [...w.files.keys()].filter(k => k.endsWith('.json'))
  expect(jsons).toEqual([`${ROOT}/${w.chartId()}/aaaa1111.json`])
  const mine = w.fileOf('aaaa1111')
  expect(mine?.ops.length).toBe(1)
  expect(mine?.ops[0]?.input.action).toBe('plan')
  expect(mine?.detached).toBe(false)
})

test('start and done move the route, record ops and claim the stage', async ($, on) => {
  const w = world(on)
  await begin($)
  const ui = await mount($)
  await call($, PLAN)
  const started = await call($, { action: 'start', id: 'S2.P1', phase: 'plan' })
  expect(started.text).toContain('▸ S2.P1 Data model')
  expect(started.text).toContain('Now: S2 Planet catalogue › S2.P1 Data model · phase plan (1/6)')
  // The first drawing of a route primes the band: it shows the route as it stands.
  expect(rowText(await ui.drawn())).toContain('Data model › ● plan')
  let mine = w.fileOf('aaaa1111')
  expect(mine?.ops.at(-1)?.input).toMatchObject({ action: 'start', id: 'S2.P1', phase: 'plan' })
  expect(mine?.claims.map(c => c.id)).toEqual(['S2'])
  expect(mine?.current).toBe('S2.P1')
  const done = await call($, { action: 'done', commit: 'abc1234' })
  expect(done.text).toContain('✓ S2.P1 Data model · abc1234')
  mine = w.fileOf('aaaa1111')
  expect(mine?.ops.at(-1)?.input).toMatchObject({ action: 'done', id: 'S2.P1', commit: 'abc1234' })
  const count = mine?.ops.length
  // A subagent's call changes nothing.
  const sub = await call($, { action: 'done', id: 'S1' }, { agentId: 'sub1' })
  expect(sub.text).toBe('claudecharter: the route is kept by the main conversation; this call from a subagent changed nothing.')
  expect(w.fileOf('aaaa1111')?.ops.length).toBe(count)
  // The model can never reset, and a wrong id is refused with the route's ids.
  const reset = await call($, { action: 'reset', id: 'S1' })
  expect(reset.deny).toBe('claudecharter: action must be one of plan, add, start, done, skip, block, get, claim, release.')
  const wrong = await call($, { action: 'start', id: 'nope' })
  expect(wrong.deny?.startsWith('claudecharter: no item "nope". Ids: S1, S2')).toBe(true)
  const get = await call($, { action: 'get' })
  expect(get.text).toContain('Route "M1.6"')
})

test('a test or build command shows its result on the band', async ($, on) => {
  const w = world(on)
  await charted($)
  const ui = await mount($)
  w.state.bash.stdout = 'ok'
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(rowText(await ui.drawn())).toContain('✓ npm test')
  await w.clock.advance(100)
  w.state.bash.isError = true
  await $.tool.call({ tool: 'Bash', command: 'npm run build' } as never)
  expect(rowText(await ui.drawn())).toContain('✗ npm run build')
  const pane = await mount($, PANE)
  const shown = text(await pane.drawn())
  expect(shown).toContain(' npm test')
  expect(shown).toContain(' npm run build')
})

test('a git commit is attached to the current step', async ($, on) => {
  const w = world(on)
  await charted($)
  w.state.bash.sha = 'deadbeefcafe'
  w.state.bash.stdout = '[main deadbee] add model'
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
  const op = w.fileOf('aaaa1111')?.ops.at(-1)
  expect(op?.input).toMatchObject({ action: 'commit', id: 'S2.P1', commit: 'deadbee' })
  const pane = await mount($, PANE)
  const shown = text(await pane.drawn())
  expect(shown).toContain('◈ deadbee')
  expect(shown).toContain('add model')
  expect(shown).toContain(' · deadbee')
  // The same commit seen again changes nothing.
  const count = w.fileOf('aaaa1111')?.ops.length
  await $.tool.call({ tool: 'Bash', command: 'git commit --amend --no-edit' } as never)
  expect(w.fileOf('aaaa1111')?.ops.length).toBe(count)
})

test('a subagent shows on the band until its turn ends', async ($, on) => {
  world(on)
  await charted($)
  const ui = await mount($)
  await $.agent.spawn({
    tool_use_id: 't',
    prompt: 'p',
    description: 'coverage matrix',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: true,
    fork: false,
  } as never)
  expect(rowText(await ui.drawn())).toContain('◐ coverage matrix')
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' } as never)
  expect(rowText(await ui.drawn())).not.toContain('coverage matrix')
})

/** A subagent spawn raised by the main conversation, unless `over` says otherwise. */
const spawn = ($: Engine, over: Record<string, unknown> = {}) =>
  $.agent.spawn({
    tool_use_id: 't',
    prompt: 'p',
    description: 'coverage matrix',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: true,
    fork: false,
    ...over,
  } as never)

/** The `context` an Agent call comes back with. */
async function agentCall($: Engine, extra: Record<string, unknown> = {}) {
  const r = (await $.tool.call({
    tool: 'Agent',
    description: 'x',
    prompt: 'p',
    subagent_type: 'general-purpose',
    ...extra,
  } as never)) as { context?: readonly string[] }

  return r.context
}

test('the first subagent of a session with no route carries the nudge, once', async ($, on) => {
  world(on)
  await begin($)
  await spawn($)
  expect(await agentCall($)).toEqual([NUDGE_TEXT])
  await spawn($)
  expect(await agentCall($)).toBeUndefined()
})

test('no nudge for a subagent, a teammate, a workflow agent or a resumed run', async ($, on) => {
  world(on)
  await begin($)
  await spawn($, { parentAgentId: 'sub1' })
  expect(await agentCall($)).toBeUndefined()
  await spawn($, { isTeammate: true })
  expect(await agentCall($)).toBeUndefined()
  await spawn($, { workflow: { runId: 'wf_1', agentIndex: 1 } })
  expect(await agentCall($)).toBeUndefined()
  await spawn($, { resume: { agentId: 'a0' } })
  expect(await agentCall($)).toBeUndefined()
  // A plain spawn is pending; a subagent's own Agent call does not take it, the main conversation's does.
  await spawn($)
  expect(await agentCall($, { agentId: 'sub1' })).toBeUndefined()
  expect(await agentCall($)).toEqual([NUDGE_TEXT])
})

test('no nudge while the session has an open route', async ($, on) => {
  world(on)
  await begin($)
  await call($, PLAN)
  await spawn($)
  expect(await agentCall($)).toBeUndefined()
})

test('the nudge comes back after a route is complete or cleared', async ($, on) => {
  world(on)
  await begin($)
  const planned = await call($, { action: 'plan', title: 'T', items: [{ id: 'A', title: 'Alpha' }] })
  expect(planned.text.endsWith(splitHint('A'))).toBe(true)
  await call($, { action: 'done', id: 'A' })
  await spawn($)
  expect(await agentCall($)).toEqual([NUDGE_TEXT])
  await spawn($)
  expect(await agentCall($)).toBeUndefined()
  await cmd($, 'clear')
  await spawn($)
  expect(await agentCall($)).toEqual([NUDGE_TEXT])
})

test('the nudge setting off', { options: { nudge: 'off' } }, async ($, on) => {
  world(on)
  await begin($)
  await spawn($)
  expect(await agentCall($)).toBeUndefined()
})

/** The element children of a node (a conditional child that drew nothing is left out). */
const kids = (node: unknown): Node[] =>
  ((node as Node | undefined)?.children ?? []).filter((c): c is Node => c !== null && typeof c === 'object')

/** Every margin or padding prop anywhere in a tree. */
const spacing = (node: unknown): string[] =>
  walk(node).flatMap(n => Object.keys(n.props ?? {}).filter(k => /^(margin|padding|gap)/.test(k)))

test('the route is the first row after the hint, with the other mods rows after it', async ($, on) => {
  world(on, ['PEEKER-LINE', 'SPOTTER-ROW', 'TICKER-ROW'])
  await charted($)
  const drawn = (await (await mount($)).drawn()) as Node
  expect(drawn.type).toBe('Box')
  expect(drawn.props?.flexDirection).toBe('column')
  const children = (drawn.children ?? []) as Node[]
  // Flattened, not nested: hint, route, the blank line (setting gapBelow, on by default), then the rows the hooks beneath stacked.
  expect(children.length).toBe(6)
  expect(text(children[0])).toBe('? for shortcuts')
  // The route is one row Box: the width probe (absolute, no room in the flow), the Raster, the spacer, a one-cell gap and
  // the open glyph (a plain, dim Button, no hotkey under the prompt).
  expect(children[1]?.type).toBe('Box')
  expect(children[1]?.props?.flexDirection).toBe('row')
  const rowParts = kids(children[1])
  expect(rowParts.length).toBe(5)
  expect(rowParts[0]?.type).toBe('Box')
  expect(rowParts[0]?.props?.position).toBe('absolute')
  expect(rowParts[1]?.type).toBe('Raster')
  // The probe starts laid out at the viewport's 122 columns in the stub, and the row takes what it measured.
  expect(rowParts[1]?.props?.columns).toBe(122)
  expect(rowParts[1]?.props?.rows).toBe(1)
  expect(rowParts[2]?.type).toBe('Box')
  expect(rowParts[2]?.props?.flexGrow).toBe(1)
  expect(text(rowParts[3])).toBe(' ')
  expect(rowParts[4]?.type).toBe('Button')
  expect(rowParts[4]?.props?.key).toBe('charter-open')
  expect(rowParts[4]?.props?.label).toBe('⋯')
  expect(rowParts[4]?.props?.plain).toBe(true)
  expect(rowParts[4]?.props?.dimColor).toBe(true)
  expect(rowParts[4]?.props?.hotkey).toBeUndefined()
  expect(children[2]?.type).toBe('Text')
  expect(text(children[2])).toBe(' ')
  expect(children.slice(3).map(text)).toEqual(['PEEKER-LINE', 'SPOTTER-ROW', 'TICKER-ROW'])
  // The blank line is a row of its own, not a margin or padding.
  expect(spacing(drawn)).toEqual([])
})

test('gapBelow off: the other mods rows sit right under the route, no blank line', { options: { gapBelow: 'off' } }, async ($, on) => {
  world(on, ['PEEKER-LINE', 'SPOTTER-ROW', 'TICKER-ROW'])
  await charted($)
  const drawn = (await (await mount($)).drawn()) as Node
  const children = (drawn.children ?? []) as Node[]
  expect(children.length).toBe(5)
  expect(text(children[0])).toBe('? for shortcuts')
  expect(children[1]?.type).toBe('Box')
  expect(raster(children[1])).toBeDefined()
  expect(children.slice(2).map(text)).toEqual(['PEEKER-LINE', 'SPOTTER-ROW', 'TICKER-ROW'])
  expect(spacing(drawn)).toEqual([])
})

test('under the prompt with no rows stacked under the hint there is no trailing blank line', async ($, on) => {
  world(on)
  await charted($)
  const drawn = (await (await mount($)).drawn()) as Node
  const children = (drawn.children ?? []) as Node[]
  expect(children.length).toBe(2)
  expect(text(children[0])).toBe('? for shortcuts')
  expect(children[1]?.type).toBe('Box')
  expect(raster(children[1])).toBeDefined()
})

test('with no route, or under 20 columns, the hint slot has no blank line either', async ($, on) => {
  world(on, ['PEEKER-LINE'])
  await begin($)
  const none = (await (await mount($)).drawn()) as Node
  expect(raster(none)).toBeUndefined()
  expect(text(none)).toBe('? for shortcutsPEEKER-LINE')
  expect((none.children ?? []).length).toBe(2)
  await call($, PLAN)
  const tiny = await mount($, { ...HINT, requestId: 'hint-21', viewport: { columns: 21, rows: 40 } as never })
  const drawn = (await tiny.drawn()) as Node
  expect(raster(drawn)).toBeUndefined()
  expect((drawn.children ?? []).length).toBe(2)
})

test('the row takes the slot the probe measures, and under 20 columns nothing is drawn', async ($, on) => {
  world(on)
  await charted($)
  const narrow = (await mount($, { ...HINT, requestId: 'hint-62', viewport: { columns: 62, rows: 40 } as never })) as unknown as Probed
  // The stub starts the probe laid out at the viewport's 62 columns; a resize gives the row the slot's cells exactly.
  expect(raster(await narrow.drawn())?.props?.columns).toBe(62)
  await narrow.resize({ columns: 58, rows: 1, in: 'charter-probe' })
  expect(raster(await narrow.drawn())?.props?.columns).toBe(58)
  const tiny = await mount($, { ...HINT, requestId: 'hint-21', viewport: { columns: 21, rows: 40 } as never })
  const drawn = (await tiny.drawn()) as Node
  expect(raster(drawn)).toBeUndefined()
  expect(text(drawn)).toBe('? for shortcuts')
})

test('no load-order toast when the plugin is outermost', async ($, on) => {
  const w = world(on)
  await charted($)
  await (await mount($)).drawn()
  await w.clock.advance(500)
  expect(w.toasts.filter(t => t.includes('CLAUDE_CODE_PLUGIN_DIRS'))).toEqual([])
})

test('the desktop draws the row still, as colored text', async ($, on) => {
  world(on)
  await charted($)
  const ui = await mount($, { ...HINT, surface: 'desktop', requestId: 'hint-desktop' })
  const drawn = (await ui.drawn()) as Node
  expect(raster(drawn)).toBeUndefined()
  expect(text(drawn)).toContain('M1.6 ›')
  expect(text((drawn.children ?? [])[0])).toBe('? for shortcuts')
})

const buttons = (node: unknown): Node[] => walk(node).filter(n => n.type === 'Button')

test('the desktop draws the open glyph beside the still row', async ($, on) => {
  world(on)
  await charted($)
  const ui = await mount($, { ...HINT, surface: 'desktop', requestId: 'hint-desktop-open' })
  const drawn = (await ui.drawn()) as Node
  expect(raster(drawn)).toBeUndefined()
  expect(buttons(drawn).map(b => b.props?.key)).toEqual(['charter-open'])
  expect(text(drawn)).toContain('⋯')
})

test('the open glyph opens the route chart', async ($, on) => {
  const w = world(on)
  await charted($)
  const ui = await mount($)
  await ui.drawn()
  expect(w.opens).toEqual([])
  await ui.press({ key: 'charter-open' })
  expect(w.opens).toEqual(['charter'])
})

test('placement above: the open glyph has the hotkey c', { options: { placement: 'above' } }, async ($, on) => {
  const w = world(on)
  await charted($)
  const ui = await mount($, ABOVE)
  const found = buttons(await ui.drawn()).filter(b => b.props?.key === 'charter-open')
  expect(found.length).toBe(1)
  expect(found[0]?.props?.hotkey).toBe('c')
  await ui.press({ key: 'charter-open' })
  expect(w.opens).toContain('charter')
})

test('no open glyph without a route or with placement panel', async ($, on) => {
  world(on)
  await begin($)
  expect(buttons(await (await mount($)).drawn())).toEqual([])
})

test('no open glyph with placement panel', { options: { placement: 'panel' } }, async ($, on) => {
  world(on)
  await begin($)
  const hint = await mount($)
  const above = await mount($, ABOVE)
  await call($, PLAN)
  expect(buttons(await hint.drawn())).toEqual([])
  expect(buttons(await above.drawn())).toEqual([])
})

const clients = (node: unknown): Node[] => walk(node).filter(n => n.type === 'Client')

/** A mounted drawing as the probe tests use it: the acts on a Client, typed for the terminal. */
type Probed = {
  drawn: () => Promise<unknown>
  resize: (size: { columns: number; rows: number; in?: string }) => Promise<void>
  post: (data: unknown, scope?: { in?: string }) => Promise<void>
}
const mountProbed = async ($: Engine, target: object = HINT): Promise<Probed> => (await mount($, target)) as unknown as Probed

test('the row fills the slot the probe measures, and the glyph takes its last column', async ($, on) => {
  world(on)
  await charted($)
  const ui = await mountProbed($)
  const first = await ui.drawn()
  const probes = clients(first)
  expect(probes.length).toBe(1)
  expect(probes[0]?.props?.key).toBe('charter-probe')
  // The engine reports the module's path under the plugin's folder.
  expect(probes[0]?.props?.module).toBe('hooks/probe.ts')
  // The probe sits in an absolute Box from the row's left edge to the cells the glyph takes.
  const holder = walk(first).find(n => n.type === 'Box' && n.props?.position === 'absolute')
  expect(holder?.props?.left).toBe(0)
  expect(holder?.props?.right).toBe(2)
  await ui.resize({ columns: 160, rows: 1, in: 'charter-probe' })
  const wide = await ui.drawn()
  expect(raster(wide)?.props?.columns).toBe(160)
  const row = walk(wide).find(n => n.type === 'Box' && n.props?.flexDirection === 'row')
  const parts = kids(row)
  expect(parts.map(n => n.type)).toEqual(['Box', 'Raster', 'Box', 'Text', 'Button'])
  expect(parts[0]?.props?.position).toBe('absolute')
  expect(parts[2]?.props?.flexGrow).toBe(1)
  expect(text(parts[3])).toBe(' ')
  expect(parts[4]?.props?.key).toBe('charter-open')
  await ui.resize({ columns: 90, rows: 1, in: 'charter-probe' })
  expect(raster(await ui.drawn())?.props?.columns).toBe(90)
  expect(spacing(await ui.drawn())).toEqual([])
})

test('a probe message sets the row width; a malformed one is ignored', async ($, on) => {
  world(on)
  await charted($)
  const ui = await mountProbed($)
  await ui.drawn()
  await ui.post({ columns: 150 })
  expect(raster(await ui.drawn())?.props?.columns).toBe(150)
  await ui.post({ columns: 'x' })
  await ui.post({ columns: 9999 })
  await ui.post({ columns: 0 })
  await ui.post({ columns: 12.5 })
  await ui.post(null)
  expect(raster(await ui.drawn())?.props?.columns).toBe(150)
})

test('a measured slot under 20 cells draws no row', async ($, on) => {
  world(on)
  await charted($)
  const ui = await mountProbed($)
  await ui.drawn()
  // 17 cells and the glyph's 2 make 19, under the 20 the band needs.
  await ui.post({ columns: 17 })
  const drawn = await ui.drawn()
  expect(raster(drawn)).toBeUndefined()
  expect(text(drawn)).toBe('? for shortcuts')
})

test('the probe is only under the prompt on the terminal', { options: { placement: 'above' } }, async ($, on) => {
  world(on)
  await charted($)
  const above = (await (await mount($, ABOVE)).drawn()) as Node
  expect(clients(above)).toEqual([])
  expect(walk(above).some(n => n.type === 'Box' && n.props?.flexGrow === 1)).toBe(true)
})

test('the desktop draws a spacer and no probe', async ($, on) => {
  world(on)
  await charted($)
  const ui = await mount($, { ...HINT, surface: 'desktop', requestId: 'hint-desktop-probe' })
  const drawn = (await ui.drawn()) as Node
  expect(clients(drawn)).toEqual([])
  expect(walk(drawn).some(n => n.type === 'Box' && n.props?.flexGrow === 1)).toBe(true)
})

test('the pane lists the route, and clears it', { options: STILL }, async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, PLAN)
  await call($, { action: 'done', id: 'S1' })
  await call($, { action: 'start', id: 'S2.P2', phase: 'implement' })
  const pane = await mount($, PANE)
  const drawn = await pane.drawn()
  const shown = text(drawn)
  expect(shown).toContain('M1.6')
  expect(shown).toContain('✓')
  expect(shown).toContain('▸')
  expect(shown).toContain('Catalogue UI')
  expect(walk(drawn).some(n => n.type === 'Text' && n.props?.backgroundColor === '#afafd7' && text(n) === ' implement ')).toBe(true)
  expect(walk(drawn).some(n => n.type === 'Text' && n.props?.backgroundColor === '#005f5f' && text(n) === ' plan ')).toBe(true)
  await pane.press({ key: 'clear' })
  expect(w.fileOf('aaaa1111')?.discarded).toBe(true)
  expect(w.fileOf('aaaa1111')?.detached).toBe(true)
  expect(text(await pane.drawn())).toContain('No route charted yet')
})

test('/charter corrects steps, claims, clears, and explains wrong arguments', async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, PLAN)
  await call($, { action: 'start', id: 'S2.P2', phase: 'implement' })
  expect(await cmd($, 'done S2.P2')).toBe('Marked S2.P2 done.')
  expect(w.fileOf('aaaa1111')?.ops.at(-1)?.input).toMatchObject({ action: 'done', id: 'S2.P2' })
  expect(await cmd($, 'reset S1')).toBe('S1 is pending again.')
  expect(await cmd($, 'skip S3')).toBe('Skipped S3.')
  expect(await cmd($, 'start S2.P3 review words')).toBe('S2.P3 is now current, phase review words.')
  expect(await cmd($, 'start S3')).toBe('S3 is now current.')
  expect(await cmd($, 'claim S3')).toBe('This session now holds S3.')
  expect(w.fileOf('aaaa1111')?.claims).toContainEqual({ id: 'S3', at: NOW, force: true })
  expect(await cmd($, 'release S3')).toBe('Released S3.')
  expect(w.fileOf('aaaa1111')?.claims.some(c => c.id === 'S3')).toBe(false)
  expect(await cmd($, 'release S3')).toBe('This session holds no claim on S3.')
  expect((await cmd($, 'done ZZ')).startsWith('No item "ZZ". Ids: S1,')).toBe(true)
  expect(await cmd($, 'x')).toBe(USAGE)
  expect(await cmd($, 'done')).toBe(USAGE)
  expect(await cmd($, 'clear now')).toBe(USAGE)
  expect(await cmd($, '')).toBe('Opened the route chart.')
  expect(w.opens).toContain('charter')
  expect(await cmd($, 'clear')).toBe('Cleared the route of this session.')
  expect(await cmd($, 'clear')).toBe('There is no route to clear.')
  expect(await cmd($, 'leave')).toBe('This session is not on a route.')
})

test('a route follows its session: end and resume, another session, /clear, retention, completion', async ($, on) => {
  const w = world(on)
  await begin($)
  const ui = await mount($)
  await call($, PLAN)
  await call($, { action: 'start', id: 'S2.P1', phase: 'plan' })

  // (a) The session ends and resumes under the same id: the route is found again.
  await $.session.end({ reason: 'other', sessionId: 'aaaa1111' } as never)
  expect(w.fileOf('aaaa1111')?.endedAt).toBe(NOW)
  await begin($)
  expect(w.fileOf('aaaa1111')?.endedAt).toBeNull()
  expect(raster(await ui.drawn())).toBeDefined()

  // (b) Another session in the same project does not share it.
  const before = w.files.get(`${ROOT}/${w.chartId()}/aaaa1111.json`)?.text
  w.state.sid = 'bbbb2222'
  await begin($)
  expect(raster(await ui.drawn())).toBeUndefined()
  expect(w.files.get(`${ROOT}/${w.chartId()}/aaaa1111.json`)?.text).toBe(before)
  expect(w.fileOf('bbbb2222')).toBeUndefined()

  // (c) /clear keeps the route under the new id.
  w.state.sid = 'aaaa1111'
  await begin($)
  await $.session.end({ reason: 'clear', sessionId: 'aaaa1111' } as never)
  w.state.sid = 'bbbb2222'
  await $.turn.start({ text: 'x', turnId: 't9' } as never)
  const carried = w.fileOf('bbbb2222')
  expect(carried?.chartId).toBe(w.chartId())
  expect(carried?.takes.map(t => t.sessionId)).toEqual(['aaaa1111'])
  expect(carried?.current).toBe('S2.P1')
  expect(carried?.claims.map(c => c.id)).toEqual(['S2'])
  expect(raster(await ui.drawn())).toBeDefined()
  expect(w.fileOf('aaaa1111')?.endedAt).not.toBeNull()
})

test('a route not touched for 31 days is not offered', async ($, on) => {
  const w = world(on)
  await begin($)
  w.peerFile('old-1', 'cccc9999', {
    seenAt: NOW - 31 * 86_400_000,
    ops: [{ t: NOW - 31 * 86_400_000, n: 1, input: { action: 'plan', title: 'Old', items: ITEMS } }],
  })
  expect(await cmd($, 'join')).toBe('No other routes in this project.')
  w.peerFile('new-1', 'dddd4444', { ops: [{ t: NOW, n: 1, input: { action: 'plan', title: 'Fresh', items: ITEMS } }] })
  expect((await cmd($, 'join')).startsWith('1. Fresh · 0% · 1 live of 1 · updated ')).toBe(true)
})

test('a finished route leaves the band after ten minutes but stays in the pane and in get', async ($, on) => {
  const w = world(on)
  await begin($)
  const ui = await mount($)
  await call($, { action: 'plan', title: 'M1.6', items: [{ id: 'A', title: 'Alpha' }] })
  await call($, { action: 'done', id: 'A' })
  expect(raster(await ui.drawn())).toBeDefined()
  expect(rowText(await ui.drawn())).toContain('Complete')
  // The done op sorts after the plan op at NOW (hybrid clock: NOW + 1), so the hide redraw is due at ten minutes + 101 ms.
  await w.clock.advance(600_200)
  expect(raster(await ui.drawn())).toBeUndefined()
  const pane = await mount($, PANE)
  expect(text(await pane.drawn())).toContain('complete')
  expect((await call($, { action: 'get' })).text).toContain('Complete: everything is done.')
})

test('another session shows on the band, holds parts, and the model is refused on them', async ($, on) => {
  const w = world(on)
  await begin($)
  const ui = await mount($)
  await call($, PLAN)
  await call($, { action: 'start', id: 'S1' })
  w.peerFile(w.chartId(), 'cccc9999', { claims: [{ id: 'S3', at: NOW, force: false }], current: 'S3' })
  // The other session is found by the idle poll within 16 s.
  await w.clock.advance(17_000)
  const drawn = await ui.drawn()
  expect(rowText(drawn)).toContain('⇄ cccc · Orbit view')
  expect(rowCells(drawn).some(c => c.cp === 0x25ba && c.fg === PEER_COLORS[0])).toBe(true)
  const get = await call($, { action: 'get' })
  expect(get.text).toContain('Sessions:')
  expect(get.text).toContain('holds S3')
  expect(get.text).toContain('Unclaimed: S2.')
  expect((await call($, { action: 'start', id: 'S3' })).deny).toContain('is held by session cccc')
  expect((await call($, { action: 'done', id: 'S3' })).deny).toContain('is held by session cccc')
  expect((await call($, PLAN)).deny).toBe(
    'claudecharter: this route is shared with session cccc; extend it with add instead of declaring a new one.',
  )
  // The person always goes through.
  expect(await cmd($, 'start S3')).toBe('S3 is now current.')
  // The other session goes quiet: its claim lapses after ten minutes and the model may work on S3.
  await w.clock.advance(600_000)
  const done = await call($, { action: 'done', id: 'S3' })
  expect(done.deny).toBeUndefined()
  expect(done.text.startsWith('Route "M1.6"')).toBe(true)
})

test('/charter join lists the routes of the project, joins one, and leaves it', async ($, on) => {
  const w = world(on)
  await begin($)
  const ui = await mount($)
  w.peerFile('ch-1', 'cccc9999', { ops: [{ t: NOW, n: 1, input: { action: 'plan', title: 'Shared route', items: ITEMS } }] })
  const listed = await cmd($, 'join')
  expect(listed.startsWith('1. Shared route · 0% · 1 live of 1 · updated ')).toBe(true)
  expect(listed).toContain(' · ch-1')
  expect(listed).toContain('Run /charter join <n> to share one, or /charter adopt <n> to take it over.')
  expect(w.opens).toContain('charter')
  expect(raster(await ui.drawn())).toBeUndefined()
  const joined = await cmd($, 'join 1')
  expect(joined).toBe(
    'Joined "Shared route" with session cccc. Claude claims a part when it starts one, or claim one with /charter claim <id>.',
  )
  const mine = w.fileOf('aaaa1111')
  expect(mine?.chartId).toBe('ch-1')
  expect(mine?.takes).toEqual([])
  expect(raster(await ui.drawn())).toBeDefined()
  expect(await cmd($, 'join 1')).toBe('No route 1 in the list; run /charter join to list them.')
  expect(await cmd($, 'leave')).toBe('Left the route "Shared route".')
  expect(w.fileOf('aaaa1111')?.detached).toBe(true)
  expect(raster(await ui.drawn())).toBeUndefined()
})

test('/charter adopt takes a route over and the other session drops it', async ($, on) => {
  const w = world(on)
  await begin($)
  w.peerFile('ch-1', 'cccc9999', { ops: [{ t: NOW, n: 1, input: { action: 'plan', title: 'Shared route', items: ITEMS } }] })
  expect(await cmd($, 'adopt 1')).toBe('Adopted "Shared route"; session cccc no longer show it.')
  expect(w.fileOf('aaaa1111')?.takes.map(t => t.sessionId)).toEqual(['cccc9999'])
  // The taken session finds its route taken over and drops it.
  w.state.sid = 'cccc9999'
  await begin($)
  expect(w.toasts.some(t => t.includes('took over the route "Shared route"'))).toBe(true)
  expect(w.fileOf('cccc9999')?.detached).toBe(true)
  const ui = await mount($)
  expect(raster(await ui.drawn())).toBeUndefined()
})

test('a person claim beats a session that claimed first', async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, PLAN)
  w.peerFile(w.chartId(), 'cccc9999', {
    joinedAt: NOW - 10_000,
    claims: [{ id: 'S2', at: NOW - 5000, force: false }],
  })
  // The earlier claim holds S2: the model here is refused.
  expect((await call($, { action: 'start', id: 'S2.P1' })).deny).toContain('is held by session cccc')
  // The person takes it over.
  expect(await cmd($, 'claim S2')).toBe('This session now holds S2.')
  expect((await call($, { action: 'get' })).text).toContain('○ S2 Planet catalogue (yours)')
  // From the other session the model is now refused on S2.
  w.state.sid = 'cccc9999'
  await begin($)
  const refused = await call($, { action: 'start', id: 'S2.P1' })
  expect(refused.deny).toContain('is held by session aaaa')
})

test('/charter init fills the prompt box once, and only for a session with no route', async ($, on) => {
  const w = world(on)
  await begin($)
  const answer = await cmd($, 'init')
  await w.clock.settle()
  expect(answer).toBe('Rebuild request placed in the prompt box: press Enter to send it.')
  expect(w.fills).toEqual([{ text: INIT_PROMPT, mode: 'replace' }])
  expect(w.submits).toEqual([])
  expect(w.opens.filter(id => id === 'charter').length).toBe(0)
  await call($, PLAN)
  await w.clock.settle()
  expect(w.opens.filter(id => id === 'charter').length).toBe(1)
  await call($, { action: 'start', id: 'S1' })
  await w.clock.settle()
  expect(w.opens.filter(id => id === 'charter').length).toBe(1)
  // With a route attached the command refuses.
  const refused = await cmd($, 'init')
  expect(refused.startsWith('This session already has a route ("M1.6"). Run /charter clear first')).toBe(true)
  expect(w.fills.length).toBe(1)
  expect(w.submits).toEqual([])
})

test('the mirror writes PROGRESS.md, named for its route', { options: { mirror: 'on' } }, async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, PLAN)
  await w.clock.advance(400)
  const written = w.writes.filter(x => x.path === MIRROR)
  expect(written.length).toBe(1)
  expect(written[0]?.text.startsWith(`<!-- claudecharter chart ${w.chartId()}: `)).toBe(true)
  expect(written[0]?.text).toContain('- [ ] **S2.P1** Data model')
})

test('only the live session with the smallest id writes the mirror', { options: { mirror: 'on' } }, async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, PLAN)
  w.peerFile(w.chartId(), '0000peer')
  await call($, { action: 'start', id: 'S1' })
  await w.clock.advance(400)
  expect(w.writes.filter(x => x.path === MIRROR).length).toBe(0)
})

test('a hand-written PROGRESS.md is left alone, with one toast', { options: { mirror: 'on' } }, async ($, on) => {
  const w = world(on)
  w.put(MIRROR, '# my own notes\n')
  await begin($)
  await call($, PLAN)
  await w.clock.advance(400)
  expect(w.writes.filter(x => x.path === MIRROR).length).toBe(0)
  expect(w.toasts.filter(t => t.includes('PROGRESS.md'))).toEqual([
    'Claude-Charter: PROGRESS.md exists and was not written by claudecharter; the mirror leaves it alone.',
  ])
  await call($, { action: 'start', id: 'S1' })
  await w.clock.advance(400)
  expect(w.toasts.filter(t => t.includes('PROGRESS.md')).length).toBe(1)
  expect(w.files.get(MIRROR)?.text).toBe('# my own notes\n')
})

test('another live route owns the file until /charter mirror claim', { options: { mirror: 'on' } }, async ($, on) => {
  const w = world(on)
  w.put(MIRROR, mirrorMarker('other-chart') + '\n# Other\n')
  w.peerFile('other-chart', 'dddd4444')
  await begin($)
  await call($, PLAN)
  await w.clock.advance(400)
  expect(w.writes.filter(x => x.path === MIRROR).length).toBe(0)
  const toasts = w.toasts.filter(t => t.includes('PROGRESS.md'))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('/charter mirror claim')
  expect(await cmd($, 'mirror claim')).toBe('This route now writes PROGRESS.md.')
  expect(w.files.get(MIRROR)?.text.startsWith(mirrorMarker(w.chartId()))).toBe(true)
})

test('a file owned by a route with no live member is taken', { options: { mirror: 'on' } }, async ($, on) => {
  const w = world(on)
  w.put(MIRROR, mirrorMarker('old-chart') + '\n# Old\n')
  w.peerFile('old-chart', 'dddd4444', { seenAt: NOW - 3_600_000 })
  await begin($)
  await call($, PLAN)
  await w.clock.advance(400)
  expect(w.files.get(MIRROR)?.text.startsWith(mirrorMarker(w.chartId()))).toBe(true)
  expect(w.toasts.filter(t => t.includes('PROGRESS.md'))).toEqual([])
})

test('the mirror claim needs the mirror on and a route', async ($, on) => {
  world(on)
  await begin($)
  expect(await cmd($, 'mirror claim')).toBe('The mirror is off: turn on "PROGRESS.md mirror" in /config.')
})

test('a finished item moves the band: blits on its own key, with the badge', async ($, on) => {
  const w = world(on)
  await charted($)
  const ui = await mount($)
  await ui.drawn()
  await call($, { action: 'done', commit: 'abc1234' })
  await ui.drawn()
  await w.clock.advance(1000)
  const mine = w.blits.filter(b => b.key === 'charter-row')
  expect(mine.length).toBeGreaterThan(0)
  expect(mine.every(b => b.requestId === 'hint')).toBe(true)
  expect(mine.some(b => blitText(b).includes('done'))).toBe(true)
})

test('with every effect off the band is still: no blits', { options: STILL }, async ($, on) => {
  const w = world(on)
  await charted($)
  const ui = await mount($)
  await ui.drawn()
  await call($, { action: 'done', commit: 'abc1234' })
  const drawn = await ui.drawn()
  await w.clock.advance(1000)
  expect(w.blits.filter(b => b.key === 'charter-row')).toEqual([])
  expect(raster(drawn)).toBeUndefined()
  expect(text(drawn)).toContain('M1.6')
})

test('a stage and the route raise toasts for the session that made the change', async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, { action: 'plan', title: 'T', items: [{ id: 'A', title: 'Alpha' }, { id: 'B', title: 'Beta' }] })
  await call($, { action: 'done', id: 'A' })
  expect(w.toasts).toEqual(['Claude-Charter: stage 1/2 "Alpha" done'])
  await call($, { action: 'done', id: 'B' })
  expect(w.toasts).toEqual(['Claude-Charter: stage 1/2 "Alpha" done', 'Claude-Charter: "T" complete (2/2)'])
})

test('no stage toast with the setting off', { options: { toast: 'off' } }, async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, { action: 'plan', title: 'T', items: [{ id: 'A', title: 'Alpha' }, { id: 'B', title: 'Beta' }] })
  await call($, { action: 'done', id: 'A' })
  await call($, { action: 'done', id: 'B' })
  expect(w.toasts).toEqual([])
})

test('a stage finished by another session raises no toast here', async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, { action: 'plan', title: 'T', items: [{ id: 'A', title: 'Alpha' }, { id: 'B', title: 'Beta' }, { id: 'C', title: 'Gamma' }] })
  w.peerFile(w.chartId(), 'cccc9999', { ops: [{ t: NOW + 10, n: 1, input: { action: 'done', id: 'A' } }] })
  const get = await call($, { action: 'get' })
  expect(get.text).toContain('✓ A Alpha')
  expect(w.toasts).toEqual([])
})

test('the demo plays on the row, opens no pane, and never writes anything', async ($, on) => {
  const w = world(on)
  await begin($)
  const ui = await mount($)
  const text1 = await cmd($, 'demo')
  expect(text1.startsWith('Playing the charter demo for 26 s under the prompt')).toBe(true)
  expect(text1).toContain('/charter demo pane also shows it in the route pane')
  expect(w.opens).toEqual([])
  expect(rowText(await ui.drawn())).toContain('M1.6')
  await w.clock.advance(4000)
  expect(/[◐◓◑◒] implement data/.test(rowText(await ui.drawn()))).toBe(true)
  expect(rowText(await ui.drawn())).toContain('Data model')
  expect([...w.files.keys()]).toEqual([])
  expect(w.toasts).toEqual([])
  expect(await cmd($, 'demo stop')).toBe('Stopped the demo: the route row and pane show your route again.')
  expect(raster(await ui.drawn())).toBeUndefined()
  expect(await cmd($, 'demo stop')).toBe('No demo is running.')
})

test('/charter demo pane shows the demo route in the pane, then the real route again', { options: STILL }, async ($, on) => {
  const w = world(on)
  await begin($)
  const pane = await mount($, PANE)
  const answer = await cmd($, 'demo pane')
  expect(answer.startsWith('Playing the charter demo for 26 s under the prompt and in the route pane')).toBe(true)
  expect(w.opens).toEqual(['charter'])
  await w.clock.advance(4000)
  const drawn = await pane.drawn()
  const shown = text(drawn)
  expect(shown).toContain('M1.6 Planet catalogue')
  expect(shown).toContain(' · demo')
  expect(walk(drawn).some(n => n.type === 'Text' && text(n) === ' ‹b7e2›')).toBe(true)
  expect(walk(drawn).some(n => n.type === 'Text' && n.props?.backgroundColor === '#afafd7' && text(n) === ' implement ')).toBe(true)
  expect(shown).toContain('implement data model')
  expect(shown).toContain('A made-up route: /charter demo stop returns to yours.')
  expect(shown).not.toContain('Other routes of this project')
  // Only Close: nothing real can be changed from the demo.
  expect(walk(drawn).filter(n => n.type === 'Button').map(text)).toEqual(['Close'])
  // The signals grow as the demo plays.
  expect(shown).not.toContain('b2c3d4e')
  await w.clock.advance(8000)
  expect(text(await pane.drawn())).toContain('b2c3d4e')
  // Nothing real was written, and the row is a different mount of the same demo.
  expect([...w.files.keys()]).toEqual([])
  // Stopped: the pane shows the empty state of the real session again.
  expect(await cmd($, 'demo stop')).toBe('Stopped the demo: the route row and pane show your route again.')
  const after = text(await pane.drawn())
  expect(after).not.toContain(' · demo')
  expect(after).toContain('No route charted yet')
})

test('the demo pane gives way to the real route when the demo ends by itself', async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, PLAN)
  const pane = await mount($, PANE)
  await cmd($, 'demo pane')
  expect(text(await pane.drawn())).toContain('M1.6 Planet catalogue')
  await w.clock.advance(26_000)
  const after = text(await pane.drawn())
  expect(after).not.toContain(' · demo')
  expect(after).not.toContain('M1.6 Planet catalogue')
  expect(after).toContain('Clear route')
})

test('/charter demo with an open pane switches the pane to the demo route too', async ($, on) => {
  const w = world(on)
  await begin($)
  const pane = await mount($, PANE)
  await cmd($, 'demo')
  await w.clock.advance(1000)
  expect(text(await pane.drawn())).toContain(' · demo')
  expect(w.opens).toEqual([])
})

test('by default the band above the prompt passes through', async ($, on) => {
  world(on)
  await charted($)
  const drawn = (await (await mount($, ABOVE)).drawn()) as Node
  expect(raster(drawn)).toBeUndefined()
  expect(drawn.type).toBe('Box')
})

test('placement above draws the row in the band, and the hint slot is left alone', { options: { placement: 'above' } }, async ($, on) => {
  const w = world(on)
  await charted($)
  const ui = await mount($, ABOVE)
  const drawn = (await ui.drawn()) as Node
  // The band under it is empty, so the drawing is the row and the blank line under it (setting gapBelow, on by default).
  expect(drawn.type).toBe('Box')
  expect(drawn.props?.flexDirection).toBe('column')
  const parts = (drawn.children ?? []) as Node[]
  expect(parts.length).toBe(2)
  expect(parts[0]?.type).toBe('Box')
  expect(parts[0]?.props?.flexDirection).toBe('row')
  expect(raster(parts[0])?.props?.columns).toBe(115)
  expect(raster(parts[0])?.props?.rows).toBe(1)
  const bandButton = walk(parts[0]).find(n => n.type === 'Button')
  expect(bandButton?.props?.key).toBe('charter-open')
  expect(bandButton?.props?.hotkey).toBe('c')
  // Above the prompt the width is the band's own: no probe, only the spacer that keeps the glyph on the right edge.
  expect(clients(parts[0])).toEqual([])
  expect(kids(parts[0]).map(n => n.type)).toEqual(['Raster', 'Box', 'Text', 'Button'])
  expect(kids(parts[0])[1]?.props?.flexGrow).toBe(1)
  expect(parts[1]?.type).toBe('Text')
  expect(text(parts[1])).toBe(' ')
  expect(rowCells(drawn)[0]?.cp).toBe(0x25d6)
  expect(rowText(drawn)).toContain('M1.6')
  // A survey holds the band: the hook yields.
  const survey = await mount($, { ...ABOVE, requestId: 'above-2', props: { hasSurvey: true, isWorking: false, maxRows: 10, bodyColumns: 120 } as never })
  const yielded = (await survey.drawn()) as Node
  expect(raster(yielded)).toBeUndefined()
  expect(yielded.type).toBe('Box')
  // The slot under the prompt shows nothing of the mod.
  const hint = (await (await mount($)).drawn()) as Node
  expect(raster(hint)).toBeUndefined()
  expect(hint.type).toBe('Text')
  expect(text(hint)).toBe('? for shortcuts')
  // The row moves with its animation, blitted to the band's own request.
  await call($, { action: 'done', commit: 'abc1234' })
  await ui.drawn()
  await w.clock.advance(1000)
  const mine = w.blits.filter(b => b.key === 'charter-row')
  expect(mine.length).toBeGreaterThan(0)
  expect(mine.every(b => b.requestId === 'above')).toBe(true)
  expect(w.toasts.filter(t => t.includes('list claudecharter first'))).toEqual([])
})

test('placement above keeps what another mod drew in the band', { options: { placement: 'above' } }, async ($, on) => {
  world(on, [], 'OTHER')
  await charted($)
  const drawn = (await (await mount($, ABOVE)).drawn()) as Node
  expect(drawn.type).toBe('Box')
  expect(drawn.props?.flexDirection).toBe('column')
  const children = (drawn.children ?? []) as Node[]
  // The row, the blank line under it (setting gapBelow, on by default), then what the other mod drew.
  expect(children.length).toBe(3)
  expect(children[0]?.type).toBe('Box')
  expect(text(children[1])).toBe(' ')
  expect(text(children[2])).toBe('OTHER')
})

test('placement above with gapBelow off: no blank line under the row', { options: { placement: 'above', gapBelow: 'off' } }, async ($, on) => {
  world(on)
  await charted($)
  const alone = (await (await mount($, ABOVE)).drawn()) as Node
  expect(alone.type).toBe('Box')
  expect(alone.props?.flexDirection).toBe('row')
  expect(raster(alone)?.props?.columns).toBe(115)
})

test('placement above with gapBelow off keeps what another mod drew right under the row', { options: { placement: 'above', gapBelow: 'off' } }, async ($, on) => {
  world(on, [], 'OTHER')
  await charted($)
  const drawn = (await (await mount($, ABOVE)).drawn()) as Node
  const children = (drawn.children ?? []) as Node[]
  expect(children.length).toBe(2)
  expect(children[0]?.type).toBe('Box')
  expect(text(children[1])).toBe('OTHER')
})

test('placement above with no route draws no blank line', { options: { placement: 'above' } }, async ($, on) => {
  world(on)
  await begin($)
  const drawn = (await (await mount($, ABOVE)).drawn()) as Node
  expect(raster(drawn)).toBeUndefined()
  expect(text(drawn)).toBe('')
})

test('placement panel draws no row, says once that a route is charted, and keeps the toasts and the pane', { options: { placement: 'panel' } }, async ($, on) => {
  const w = world(on)
  await begin($)
  const hint = await mount($)
  const above = await mount($, ABOVE)
  await call($, PLAN)
  const charted = 'Claude-Charter: charted "M1.6"; /charter shows the route.'
  expect(w.toasts).toEqual([charted])
  await call($, PLAN)
  expect(w.toasts).toEqual([charted])
  const bottomHint = (await hint.drawn()) as Node
  expect(raster(bottomHint)).toBeUndefined()
  expect(text(bottomHint)).toBe('? for shortcuts')
  const bottomAbove = (await above.drawn()) as Node
  expect(raster(bottomAbove)).toBeUndefined()
  expect(bottomAbove.type).toBe('Box')
  await call($, { action: 'start', id: 'S2.P1', phase: 'plan' })
  await call($, { action: 'done', id: 'S2.P1' })
  await w.clock.advance(1000)
  expect(w.blits).toEqual([])
  await call($, { action: 'done', id: 'S1' })
  expect(w.toasts).toEqual([charted, 'Claude-Charter: stage 1/3 "Scaffolding" done'])
  const shown = seen(await (await mount($, PANE)).drawn())
  expect(shown).toContain('M1.6')
  expect(shown).toContain('◖')
  expect(w.opens).toEqual([])
})

test('placement panel with the toast setting off raises no charted toast', { options: { placement: 'panel', toast: 'off' } }, async ($, on) => {
  const w = world(on)
  await begin($)
  await call($, PLAN)
  expect(w.toasts).toEqual([])
})

test('placement panel plays the demo in the pane only', { options: { placement: 'panel' } }, async ($, on) => {
  const w = world(on)
  await begin($)
  const pane = await mount($, PANE)
  expect(await cmd($, 'demo')).toBe(
    'Playing the charter demo for 26 s in the route pane, with a made-up route and a made-up second session; the route row is off (Route placement: panel). /charter demo stop ends it.',
  )
  expect(w.opens).toEqual(['charter'])
  expect(text(await pane.drawn())).toContain(' · demo')
  // The row is off, so every blit belongs to the pane (the demo's phase changes at 2 s and 3.5 s move it).
  await w.clock.advance(4000)
  await pane.drawn()
  await w.clock.advance(1000)
  expect(w.blits.filter(b => b.requestId !== 'charter')).toEqual([])
  expect(w.blits.some(b => b.requestId === 'charter')).toBe(true)
  expect(await cmd($, 'demo stop')).toBe('Stopped the demo: the pane shows your route again.')
})

test('placement above names the slot in the demo answer', { options: { placement: 'above' } }, async ($, on) => {
  world(on)
  await begin($)
  expect((await cmd($, 'demo')).startsWith('Playing the charter demo for 26 s above the prompt')).toBe(true)
})

test('the pane draws the track in the chosen style', async ($, on) => {
  world(on)
  await charted($)
  const shown = seen(await (await mount($, PANE)).drawn())
  expect(shown).toContain('◖')
  expect(shown).toContain('◗ 0%')
})

test('the pane follows the track style setting', { options: { track: 'ascii', trackEnds: 'auto' } }, async ($, on) => {
  world(on)
  await charted($)
  const shown = seen(await (await mount($, PANE)).drawn())
  expect(shown).toContain('] 0%')
  expect(shown).not.toContain('◖')
})

test('the pane follows the track ends setting', { options: { trackEnds: 'corners' } }, async ($, on) => {
  world(on)
  await charted($)
  const shown = seen(await (await mount($, PANE)).drawn())
  expect(shown).toContain('｢')
  expect(shown).toContain('｣ 0%')
})

// ---- the pane moves ---------------------------------------------------------------------------------------------

/** The blits the pane took, all or those of one Raster key. */
const paneBlits = (w: ReturnType<typeof world>, key?: string) =>
  w.blits.filter(b => b.requestId === 'charter' && (key === undefined || b.key === key))
const blitFirst = (b: { cells?: string }): Cell | undefined => decodeCells(b.cells ?? '')[0]
const rasterKeys = (node: unknown): string[] => walk(node).filter(n => n.type === 'Raster').map(n => String(n.props?.key))
/** A running row of the pane: a row Box whose label Text is the row's grey ' coverage matrix'. */
const runRowOf = (node: unknown): Node | undefined =>
  walk(node).find(
    n =>
      n.type === 'Box' &&
      n.props?.flexDirection === 'row' &&
      kids(n).some(k => k.type === 'Text' && text(k) === ' coverage matrix' && k.props?.color === '#8a8a8a'),
  )

test('the pane primes silently, then its track moves and settles', async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE)
  expect(rasterKeys(await pane.drawn())).toContain('charter-pane-track')
  await w.clock.advance(1000)
  expect(paneBlits(w)).toEqual([])
  await call($, { action: 'done', id: 'S2.P1' })
  await pane.drawn()
  // The longest effect of a finished part is its badge (ITEM_BADGE_FRAMES = 50 frames, 2.5 s), whose removal repaints the track once.
  await w.clock.advance(3000)
  const moved = paneBlits(w, 'charter-pane-track').length
  expect(moved).toBeGreaterThan(0)
  await w.clock.advance(2000)
  expect(paneBlits(w, 'charter-pane-track').length).toBe(moved)
})

test('a finished part twinkles in the pane, then settles to a check', async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE)
  await pane.drawn()
  await call($, { action: 'done', id: 'S2.P1' })
  expect(rasterKeys(await pane.drawn())).toContain('charter-pane-mark-S2.P1')
  await w.clock.advance(2000)
  const marks = paneBlits(w, 'charter-pane-mark-S2.P1').map(blitFirst)
  expect(marks.some(c => c?.cp === 0x2726 || c?.cp === 0x2727)).toBe(true)
  expect(marks.at(-1)).toMatchObject({ cp: 0x2713, fg: OK })
  expect(paneBlits(w, 'charter-pane-track').some(b => blitText(b).includes('Data model done'))).toBe(true)
})

test('a phase pill fills in and the one before it turns teal', async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE)
  await pane.drawn()
  await call($, { action: 'start', id: 'S2.P1', phase: 'approve' })
  expect(rasterKeys(await pane.drawn())).toContain('charter-pane-pills-S2.P1')
  await w.clock.advance(1000)
  const last = paneBlits(w, 'charter-pane-pills-S2.P1').at(-1)
  const cells = decodeCells(last?.cells ?? '')
  // A blank, ` plan ` (6 cells), a blank, ` approve ` (9 cells).
  expect(cellText(cells.slice(1, 7))).toBe(' plan ')
  expect(cellText(cells.slice(8, 17))).toBe(' approve ')
  expect(cells.slice(8, 17).map(c => c.bg)).toEqual(Array<number>(9).fill(LIVE))
  expect(cells.slice(1, 7).map(c => c.bg)).toEqual(Array<number>(6).fill(0x005f5f))
})

test('your step breathes in the pane while Claude works, and rests when it stops', async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE)
  expect(rasterKeys(await pane.drawn())).toContain('charter-pane-mark-S2.P1')
  await $.turn.start({ text: '', turnId: 'm1' } as never)
  await w.clock.advance(1100)
  const fgs = paneBlits(w, 'charter-pane-mark-S2.P1').map(b => blitFirst(b)?.fg)
  expect(fgs).toContain(LIVE)
  expect(fgs).toContain(mixColor(LIVE, TRACK, 0.5))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'm1', reason: 'answer' } as never)
  await w.clock.advance(200)
  const count = paneBlits(w).length
  await w.clock.advance(2000)
  expect(paneBlits(w).length).toBe(count)
})

test('a running subagent is listed in the pane with the row\'s spinner, and leaves with its work', async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE)
  await pane.drawn()
  await spawn($)
  const drawn = await pane.drawn()
  expect(rasterKeys(drawn)).toContain('charter-pane-run-a1')
  expect(seen(drawn)).toContain('coverage matrix')
  await w.clock.advance(500)
  const cps = new Set(paneBlits(w, 'charter-pane-run-a1').map(b => blitFirst(b)?.cp ?? 0))
  expect(cps.size).toBeGreaterThanOrEqual(2)
  expect([...cps].every(cp => [0x25d0, 0x25d3, 0x25d1, 0x25d2].includes(cp))).toBe(true)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' } as never)
  expect(rasterKeys(await pane.drawn())).not.toContain('charter-pane-run-a1')
})

test('a blocked item pulses red in the pane three times, then stays red', async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE)
  await pane.drawn()
  await call($, { action: 'block', id: 'S2.P1' })
  expect(rasterKeys(await pane.drawn())).toContain('charter-pane-mark-S2.P1')
  await w.clock.advance(1500)
  const cells = paneBlits(w, 'charter-pane-mark-S2.P1').map(blitFirst)
  expect(cells.length).toBeGreaterThan(0)
  expect(cells.every(c => c?.cp === 0x2298)).toBe(true)
  expect(cells.some(c => c?.fg === lighten(FAIL, 0.55))).toBe(true)
  expect(cells.at(-1)?.fg).toBe(FAIL)
})

test('with every effect off the pane is still, and lists the running work with the still glyphs', { options: STILL }, async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE)
  await pane.drawn()
  await spawn($)
  await call($, { action: 'done', id: 'S2.P1' })
  await w.clock.advance(1000)
  const drawn = await pane.drawn()
  expect(raster(drawn)).toBeUndefined()
  expect(paneBlits(w)).toEqual([])
  expect(text(drawn)).toContain('◖')
  const row = runRowOf(drawn)
  expect(row).toBeDefined()
  const glyph = kids(row)[0]
  expect(text(glyph)).toBe('◐')
  expect(glyph?.props?.color).toBe('#afafd7')
})

test('the desktop pane is still, with the same running rows', async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE_DESKTOP)
  await pane.drawn()
  await spawn($)
  await call($, { action: 'done', id: 'S2.P1' })
  await w.clock.advance(1000)
  const drawn = await pane.drawn()
  expect(raster(drawn)).toBeUndefined()
  expect(paneBlits(w)).toEqual([])
  const row = runRowOf(drawn)
  expect(row).toBeDefined()
  expect(text(kids(row)[0])).toBe('◐')
  expect(kids(row)[0]?.props?.color).toBe('#afafd7')
})

test('three refused first blits draw the pane still', async ($, on) => {
  const w = world(on)
  w.state.blitAnswer = { deny: 'not mounted' }
  await charted($)
  const pane = await mount($, PANE)
  await pane.drawn()
  await call($, { action: 'done', id: 'S2.P1' })
  for (let i = 0; i < 4; i++) {
    await pane.drawn()
    await w.clock.advance(200)
  }
  expect(raster(await pane.drawn())).toBeUndefined()
})

test('closing the pane stops its timer', async ($, on) => {
  const w = world(on)
  await charted($)
  const pane = await mount($, PANE)
  await pane.drawn()
  await call($, { action: 'done', id: 'S2.P1' })
  await pane.drawn()
  await w.clock.advance(100)
  expect(paneBlits(w).length).toBeGreaterThan(0)
  await pane.press({ key: 'close' })
  const count = paneBlits(w).length
  await w.clock.advance(2000)
  expect(paneBlits(w).length).toBe(count)
})
