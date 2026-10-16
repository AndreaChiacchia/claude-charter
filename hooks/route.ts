import type { Chart, ChartItem, ItemStatus, OpInput, ShareView } from '../types'

export const MAX_DEPTH = 4
export const MAX_ITEMS = 200
export const ID_MAX = 24
export const TITLE_MAX = 80
export const PHASE_MAX = 20
export const PHASES_MAX = 12
export const NOTE_MAX = 60
/** The prefix of every error text this module returns. */
export const ERR = 'claudecharter: '

// ---- small text helpers ---------------------------------------------------------------------------

const clip = (s: string, n: number): string => Array.from(s).slice(0, n).join('')
const collapse = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim()

function normTitle(v: unknown): string {
  return clip(collapse(v), TITLE_MAX)
}

function normPhase(v: unknown): string | null {
  const s = clip(collapse(v), PHASE_MAX)

  return s === '' ? null : s
}

function normNote(v: unknown): string | null {
  const s = clip(collapse(v), NOTE_MAX)

  return s === '' ? null : s
}

function normCommit(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (s === '') return null
  if (/^[0-9a-f]{7,40}$/i.test(s)) return s.slice(0, 7).toLowerCase()

  return clip(s, 12)
}

function normId(v: unknown): string | null {
  const s = String(v ?? '').trim()

  return s === '' ? null : s
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---- normalization ----------------------------------------------------------------------------------

/**
 * The items of a plan or an add, as route items: ids, titles and phases cleaned, limits checked. `at` is the
 * 1-based position chain of the parent (`''` at the top), `seen` the ids taken so far, `count` the items counted.
 */
export function normalizeItems(
  raw: unknown,
  depth: number,
  seen: Set<string>,
  count: { n: number },
  at: string,
): { items: ChartItem[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: ERR + 'items must be a list.' }
  const items: ChartItem[] = []
  let index = 0
  for (const entry of raw as unknown[]) {
    index += 1
    const pos = at === '' ? String(index) : `${at}.${index}`
    const x: Record<string, unknown> = isRecord(entry) ? entry : {}
    const id = String(x.id ?? '').trim()
    if (!/^\S{1,24}$/.test(id)) {
      return { error: ERR + `item ${pos}: the id must be 1 to 24 characters with no spaces.` }
    }
    if (seen.has(id)) return { error: ERR + `the id "${id}" is used twice.` }
    seen.add(id)
    const title = normTitle(x.title)
    if (title === '') return { error: ERR + `item ${id}: the title is empty.` }
    const phases: string[] = []
    if (Array.isArray(x.phases)) {
      for (const p of x.phases as unknown[]) {
        const name = normPhase(p)
        if (name !== null && !phases.includes(name) && phases.length < PHASES_MAX) phases.push(name)
      }
    }
    count.n += 1
    if (count.n > MAX_ITEMS) return { error: ERR + `a route holds at most ${MAX_ITEMS} items.` }
    let children: ChartItem[] = []
    const nested = x.items
    const hasNested = nested !== undefined && nested !== null && !(Array.isArray(nested) && nested.length === 0)
    if (hasNested) {
      if (depth + 1 > MAX_DEPTH) return { error: ERR + `items nest at most ${MAX_DEPTH} levels.` }
      const r = normalizeItems(nested, depth + 1, seen, count, pos)
      if ('error' in r) return r
      children = r.items
    }
    items.push({ id, title, status: 'pending', phases, phase: null, commit: null, note: null, doneAt: null, items: children })
  }

  return { items }
}

/** A deep copy of the route. */
export function cloneChart(c: Chart): Chart {
  return JSON.parse(JSON.stringify(c)) as Chart
}

// ---- helpers ----------------------------------------------------------------------------------------

/** Visits every item in pre-order with its ancestors (outermost first), its index and its siblings. */
export function walk(
  items: ChartItem[],
  fn: (item: ChartItem, parents: ChartItem[], index: number, siblings: ChartItem[]) => void,
  parents: ChartItem[] = [],
): void {
  items.forEach((item, index) => {
    fn(item, parents, index, items)
    if (item.items.length > 0) walk(item.items, fn, [...parents, item])
  })
}

export type Found = { item: ChartItem; parents: ChartItem[]; index: number; siblings: ChartItem[] }

/** The item with this id, with its ancestors (outermost first), its index and its siblings; null when none. */
export function findItem(chart: Chart, id: string): Found | null {
  let found: Found | null = null
  walk(chart.items, (item, parents, index, siblings) => {
    if (found === null && item.id === id) found = { item, parents, index, siblings }
  })

  return found
}

/** Every item id, in pre-order. */
export function allIds(chart: Chart): string[] {
  const ids: string[] = []
  walk(chart.items, item => {
    ids.push(item.id)
  })

  return ids
}

export const isClosed = (s: ItemStatus): boolean => s === 'done' || s === 'skipped'

/** How far an item is, 0..1. */
export function itemProgress(item: ChartItem): number {
  if (isClosed(item.status)) return 1
  if (item.items.length > 0) return item.items.reduce((s, c) => s + itemProgress(c), 0) / item.items.length
  if ((item.status === 'active' || item.status === 'blocked') && item.phases.length > 0 && item.phase !== null) {
    const at = item.phases.indexOf(item.phase)

    return at < 0 ? 0 : at / item.phases.length
  }

  return 0
}

/** How far the route is, 0..1: the mean of its top-level items; exactly 1 once finished. */
export function progress(chart: Chart): number {
  if (chart.finishedAt !== null) return 1
  if (chart.items.length === 0) return 0

  return chart.items.reduce((s, i) => s + itemProgress(i), 0) / chart.items.length
}

/** The percent shown: 100 when finished, else at most 99. */
export function percentOf(p: number, finished: boolean): number {
  if (finished) return 100

  return Math.min(99, Math.max(0, Math.floor(p * 100)))
}

/** Top-level items closed, and top-level items. */
export function topCounts(chart: Chart): { done: number; total: number } {
  return { done: chart.items.filter(i => isClosed(i.status)).length, total: chart.items.length }
}

export type PathEntry = { item: ChartItem; pos: number; count: number }

/** The route from the top level down to `id`, each entry with its 1-based place among its siblings; `[]` when unknown. */
export function pathTo(chart: Chart, id: string | null): PathEntry[] {
  if (id === null) return []
  const f = findItem(chart, id)
  if (f === null) return []
  const out: PathEntry[] = []
  const chain = [...f.parents, f.item]
  let level: ChartItem[] = chart.items
  for (const item of chain) {
    out.push({ item, pos: level.indexOf(item) + 1, count: level.length })
    level = item.items
  }

  return out
}

/** The path down to the session's current step; `[]` when there is none. */
export function currentPath(chart: Chart): PathEntry[] {
  return pathTo(chart, chart.current)
}

/**
 * Where a session stands on the route, 0..1: the route's progress for no (or an unknown) step; else the place of the
 * step's top-level stage plus that stage's own progress. In solo sequential work it equals `progress(chart)`.
 */
export function posOf(chart: Chart, id: string | null): number {
  if (id === null) return progress(chart)
  const f = findItem(chart, id)
  if (f === null) return progress(chart)
  const top = f.parents[0] ?? f.item
  const k = chart.items.indexOf(top)

  return (k + itemProgress(top)) / chart.items.length
}

export type NextItem = { item: ChartItem; pos: number; count: number; topPos: number; topCount: number }

/** The first pending item after the current step in pre-order (from the start with none), skipping closed branches. */
export function nextItem(chart: Chart): NextItem | null {
  const flat: { item: ChartItem; parents: ChartItem[]; index: number; siblings: ChartItem[] }[] = []
  walk(chart.items, (item, parents, index, siblings) => {
    flat.push({ item, parents, index, siblings })
  })
  const from = chart.current === null ? -1 : flat.findIndex(f => f.item.id === chart.current)
  for (let i = from + 1; i < flat.length; i++) {
    const f = flat[i]
    if (f === undefined || f.item.status !== 'pending') continue
    if (f.parents.some(p => isClosed(p.status))) continue
    const top = f.parents[0] ?? f.item

    return {
      item: f.item,
      pos: f.index + 1,
      count: f.siblings.length,
      topPos: chart.items.indexOf(top) + 1,
      topCount: chart.items.length,
    }
  }

  return null
}

// ---- actions ----------------------------------------------------------------------------------------

export type ProgressInput = {
  action?: unknown
  title?: unknown
  items?: unknown
  parent?: unknown
  id?: unknown
  phase?: unknown
  commit?: unknown
  note?: unknown
}

export type RouteEvent = {
  kind: 'item-done' | 'stage-done' | 'finished'
  id: string
  title: string
  pos: number
  count: number
}

export type ActionResult = { chart: Chart | null; error?: string; events: RouteEvent[]; target: string | null }

/** The error for an id the route does not have: it lists the first 30 ids. */
export function unknownIdError(chart: Chart, id: string): string {
  const ids = allIds(chart)

  return ERR + `no item "${id}". Ids: ${ids.slice(0, 30).join(', ')}${ids.length > 30 ? ', …' : ''}.`
}

export const NO_ROUTE_ERROR = ERR + 'no route yet; declare one with action "plan".'

const NEEDS_ROUTE = new Set(['add', 'start', 'done', 'skip', 'block', 'reset', 'commit'])

function fail(chart: Chart | null, error: string): ActionResult {
  return { chart, error, events: [], target: null }
}

function stageOrItem(f: Found): RouteEvent {
  const isTop = f.parents.length === 0

  return {
    kind: isTop ? 'stage-done' : 'item-done',
    id: f.item.id,
    title: f.item.title,
    pos: f.index + 1,
    count: f.siblings.length,
  }
}

/** The nearest ancestor (innermost first) that is not closed, else null. */
function nearestOpen(parents: ChartItem[]): string | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i]
    if (p !== undefined && !isClosed(p.status)) return p.id
  }

  return null
}

function closeDescendants(item: ChartItem, status: 'done' | 'skipped', now: number): void {
  if (item.status === 'pending' || item.status === 'active' || item.status === 'blocked') {
    item.status = status
    item.phase = null
    item.doneAt = now
  }
  for (const c of item.items) closeDescendants(c, status, now)
}

/** The finish check of 5.4: every top-level item closed, with at least one, sets `finishedAt`. */
function finishCheck(c: Chart, now: number, events: RouteEvent[] | null): void {
  if (c.items.length === 0 || c.finishedAt !== null) return
  if (!c.items.every(i => isClosed(i.status))) return
  c.finishedAt = now
  c.current = null
  if (events !== null) {
    const { done, total } = topCounts(c)
    events.push({ kind: 'finished', id: '', title: c.title, pos: done, count: total })
  }
}

/** After a done or a skip of `targetId`: the current step, the roll-up of parents, the finish. */
function afterClose(c: Chart, targetId: string, now: number, events: RouteEvent[]): void {
  const f = findItem(c, targetId)
  if (f === null) return
  if (c.current !== null) {
    const inside = findItem(c, c.current)
    const isInside = c.current === targetId || (inside !== null && inside.parents.some(p => p.id === targetId))
    if (isInside) c.current = nearestOpen(f.parents)
  }
  for (let level = f.parents.length - 1; level >= 0; level--) {
    const parent = f.parents[level]
    if (parent === undefined) break
    if (parent.phases.length !== 0 || isClosed(parent.status) || !parent.items.every(i => isClosed(i.status))) break
    parent.status = 'done'
    parent.doneAt = now
    parent.phase = null
    const pf = findItem(c, parent.id)
    if (pf !== null) events.push(stageOrItem(pf))
    if (c.current === parent.id) c.current = nearestOpen(f.parents.slice(0, level))
  }
  finishCheck(c, now, events)
}

/**
 * Applies one action to a route and returns the new route (the input is never changed), what finished, and the id the
 * action resolved to. On error the input route comes back with the error text and no events.
 */
export function applyAction(chart: Chart | null, input: ProgressInput, now: number): ActionResult {
  const action = String(input.action ?? '')
  if (action === 'get') return { chart, events: [], target: null }
  if (action === 'plan') return planAction(chart, input, now)
  if (!NEEDS_ROUTE.has(action)) return fail(chart, ERR + 'action must be one of plan, add, start, done, skip, block, get.')
  if (chart === null) return fail(chart, NO_ROUTE_ERROR)

  if (action === 'commit') {
    const id = normId(input.id)
    const commit = normCommit(input.commit)
    if (id === null || commit === null) return fail(chart, ERR + 'commit needs an id and a commit.')
    const f0 = findItem(chart, id)
    if (f0 === null) return fail(chart, unknownIdError(chart, id))
    if (f0.item.commit === commit) return { chart, events: [], target: id }
  }

  const c = cloneChart(chart)
  const events: RouteEvent[] = []
  const revision = chart.revision + 1
  const bump = (): void => {
    c.updatedAt = now
    c.revision = revision
  }
  const need = (id: string | null, what: string): { f: Found } | { error: string } => {
    if (id === null) return { error: ERR + what }
    const f = findItem(c, id)

    return f === null ? { error: unknownIdError(c, id) } : { f }
  }

  switch (action) {
    case 'add': {
      const parentId = normId(input.parent)
      let level = 1
      let parentItem: ChartItem | null = null
      if (parentId !== null) {
        const r = need(parentId, '')
        if ('error' in r) return fail(chart, r.error)
        parentItem = r.f.item
        level = r.f.parents.length + 2
      }
      if (Array.isArray(input.items) && input.items.length === 0) return fail(chart, ERR + 'add needs at least one item.')
      const ids = allIds(c)
      const added = normalizeItems(input.items, level, new Set(ids), { n: ids.length }, '')
      if ('error' in added) return fail(chart, added.error)
      if (parentItem !== null) {
        parentItem.items.push(...added.items)
        if (parentItem.status === 'done') {
          parentItem.status = 'active'
          parentItem.doneAt = null
        }
      } else {
        c.items.push(...added.items)
      }
      c.finishedAt = null
      bump()

      return { chart: c, events, target: parentId }
    }
    case 'start': {
      const id = normId(input.id)
      const r = need(id, 'start needs an id.')
      if ('error' in r) return fail(chart, r.error)
      const { item, parents } = r.f
      const phase = normPhase(input.phase)
      if (phase !== null && !item.phases.includes(phase) && item.phases.length >= PHASES_MAX) {
        return fail(chart, ERR + `item ${item.id} already has ${PHASES_MAX} phases.`)
      }
      item.status = 'active'
      item.doneAt = null
      for (const p of parents) {
        if (p.status === 'pending' || p.status === 'done' || p.status === 'skipped') {
          p.status = 'active'
          p.doneAt = null
        }
      }
      c.finishedAt = null
      c.current = item.id
      if (phase !== null) {
        if (!item.phases.includes(phase)) item.phases.push(phase)
        item.phase = phase
      } else if (item.phase === null && item.phases.length > 0) {
        item.phase = item.phases[0] ?? null
      }
      bump()

      return { chart: c, events, target: item.id }
    }
    case 'done':
    case 'skip': {
      const id = normId(input.id) ?? chart.current
      const r = need(id, 'nothing is current; pass id.')
      if ('error' in r) return fail(chart, r.error)
      const { item } = r.f
      const wasOpen = !isClosed(item.status)
      const status = action === 'done' ? 'done' : 'skipped'
      closeDescendants(item, status, now)
      if (action === 'done') {
        item.commit = normCommit(input.commit) ?? item.commit
        item.note = normNote(input.note) ?? item.note
        if (wasOpen) events.push(stageOrItem(r.f))
      } else {
        item.note = normNote(input.note) ?? item.note
      }
      afterClose(c, item.id, now, events)
      bump()

      return { chart: c, events, target: item.id }
    }
    case 'block': {
      const id = normId(input.id)
      const r = need(id, 'block needs an id.')
      if ('error' in r) return fail(chart, r.error)
      r.f.item.status = 'blocked'
      r.f.item.note = normNote(input.note) ?? r.f.item.note
      bump()

      return { chart: c, events, target: r.f.item.id }
    }
    case 'reset': {
      const id = normId(input.id)
      const r = need(id, 'reset needs an id.')
      if ('error' in r) return fail(chart, r.error)
      const reopen = (it: ChartItem): void => {
        it.status = 'pending'
        it.phase = null
        it.doneAt = null
        it.commit = null
        it.note = null
        for (const child of it.items) reopen(child)
      }
      reopen(r.f.item)
      for (const p of r.f.parents) {
        if (p.status === 'done' || p.status === 'skipped') {
          p.status = 'active'
          p.doneAt = null
        }
      }
      c.finishedAt = null
      bump()

      return { chart: c, events, target: r.f.item.id }
    }
    default: {
      // commit
      const id = normId(input.id)
      const r = need(id, 'commit needs an id and a commit.')
      if ('error' in r) return fail(chart, r.error)
      r.f.item.commit = normCommit(input.commit)
      bump()

      return { chart: c, events, target: r.f.item.id }
    }
  }
}

function planAction(old: Chart | null, input: ProgressInput, now: number): ActionResult {
  const title = normTitle(input.title)
  if (title === '' || !Array.isArray(input.items) || input.items.length === 0) {
    return fail(old, ERR + 'plan needs a title and at least one item.')
  }
  const r = normalizeItems(input.items, 1, new Set(), { n: 0 }, '')
  if ('error' in r) return fail(old, r.error)
  const next: Chart = {
    title,
    items: r.items,
    current: null,
    startedAt: old !== null && old.finishedAt === null ? old.startedAt : now,
    updatedAt: now,
    finishedAt: null,
    revision: (old?.revision ?? 0) + 1,
  }
  if (old !== null) {
    const before = new Map<string, ChartItem>()
    walk(old.items, item => {
      before.set(item.id, item)
    })
    walk(next.items, item => {
      const prev = before.get(item.id)
      if (prev === undefined) return
      item.status = prev.status
      item.phase = prev.phase !== null && item.phases.includes(prev.phase) ? prev.phase : null
      item.commit = prev.commit
      item.note = prev.note
      item.doneAt = prev.doneAt
    })
    if (old.current !== null && findItem(next, old.current) !== null) next.current = old.current
  }
  finishCheck(next, now, null)

  return { chart: next, events: [], target: null }
}

// ---- replay -----------------------------------------------------------------------------------------

export type ReplayOp = { t: number; s: string; n: number; input: OpInput }

/**
 * The route every participant's ops give, applied in the fixed order (time, session id, counter). An op that fails
 * (it names something a concurrent op removed) is skipped. Pure: the same ops in any input order give the same route.
 */
export function replay(ops: ReplayOp[]): Chart | null {
  const sorted = [...ops].sort((a, b) => a.t - b.t || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0) || a.n - b.n)
  let chart: Chart | null = null
  for (const op of sorted) {
    const r = applyAction(chart === null ? null : { ...chart, current: null }, op.input, op.t)
    if (r.error !== undefined || r.chart === null) continue
    chart = r.chart
    chart.current = null
  }

  return chart
}

// ---- the model's view ---------------------------------------------------------------------------------

const STATUS_GLYPH: Record<ItemStatus, string> = {
  done: '✓',
  skipped: '–',
  blocked: '⊘',
  active: '▹',
  pending: '○',
}

function itemLabel(chart: Chart, id: string | null): string | null {
  if (id === null) return null
  const f = findItem(chart, id)

  return f === null ? null : `${f.item.id} ${f.item.title}`
}

/** The route as the progress tool's result shows it to the model. */
export function routeText(chart: Chart | null, share: ShareView | null, now: number): string {
  if (chart === null) return 'No route charted.'
  const finished = chart.finishedAt !== null
  const { done, total } = topCounts(chart)
  const lines: string[] = []
  lines.push(
    `Route "${chart.title}": ${done}/${total} done, ${percentOf(progress(chart), finished)}%.` +
      (finished ? ' Complete: everything is done.' : ''),
  )
  const path = currentPath(chart)
  const leaf = path.at(-1)
  if (leaf === undefined) {
    lines.push('Now: nothing current.')
  } else {
    let nowLine = `Now: ${path.map(p => `${p.item.id} ${p.item.title}`).join(' › ')}`
    if (leaf.item.phase !== null && leaf.item.phases.length > 0) {
      nowLine += ` · phase ${leaf.item.phase} (${leaf.item.phases.indexOf(leaf.item.phase) + 1}/${leaf.item.phases.length})`
    }
    lines.push(nowLine)
  }
  const next = nextItem(chart)
  if (next !== null) lines.push(`Next: ${next.item.id} ${next.item.title}`)

  const hasPeers = share !== null && share.peers.length > 0
  if (share !== null && hasPeers) {
    const nowOf = (id: string | null, holds: string[]): string => {
      const label = itemLabel(chart, id)

      return `${label === null ? 'nothing current' : `now ${label}`} · holds ${holds.length === 0 ? 'nothing' : holds.join(', ')}`
    }
    lines.push('Sessions:')
    lines.push(`- this session (${share.meLabel}): ${nowOf(chart.current, share.myHolds)}`)
    for (const p of share.peers) {
      const state = p.isLive ? 'live' : `idle ${Math.floor((now - p.seenAt) / 60000)}m`
      lines.push(`- ${p.label} (${state}): ${nowOf(p.current, p.holds)}`)
    }
    lines.push(share.unclaimed.length > 0 ? `Unclaimed: ${share.unclaimed.join(', ')}.` : 'Unclaimed: none.')
    lines.push('Work only on parts this session holds or on unclaimed ones; a part another session holds is refused.')
  }

  const ancestorsOfCurrent = new Set<string>(path.slice(0, -1).map(p => p.item.id))
  const emit = (items: ChartItem[], depth: number): void => {
    for (const item of items) {
      const isCurrent = item.id === chart.current
      const glyph = item.status === 'active' && isCurrent ? '▸' : STATUS_GLYPH[item.status]
      let line = `${'  '.repeat(depth)}${glyph} ${item.id} ${item.title}`
      if (item.commit !== null) line += ` · ${item.commit}`
      if ((item.status === 'active' || item.status === 'blocked') && item.phases.length > 0) {
        const at = item.phase === null ? -1 : item.phases.indexOf(item.phase)
        const pills = item.phases.map((name, i) => (at < 0 || i > at ? name : i < at ? `${name} ✓` : `▸${name}`))
        line += ` · [${pills.join(' · ')}]`
      }
      const holder = hasPeers && share !== null ? share.held[item.id] : undefined
      if (holder !== undefined) line += holder.isMe ? ' (yours)' : ` (held by ${holder.label})`
      if (item.note !== null) line += ` — ${item.note}`
      const listed =
        item.items.length > 0 &&
        (item.status === 'active' || item.status === 'blocked' || ancestorsOfCurrent.has(item.id) || holder !== undefined)
      if (item.items.length > 0 && !listed) line += ` (${item.items.length} items)`
      lines.push(line)
      if (listed) emit(item.items, depth + 1)
    }
  }
  emit(chart.items, 0)

  return lines.join('\n')
}
