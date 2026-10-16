import type { Chart, ChartItem, ShareView } from '../types'
import { percentOf, progress, topCounts } from './route'
import { LIVE_MS } from './share'
import type { Merged } from './share'
import { stamp } from './signals'

/** The first line of a mirror file: it names the route the file mirrors. */
export function mirrorMarker(chartId: string): string {
  return `<!-- claudecharter chart ${chartId}: this file mirrors that route; edits here are overwritten -->`
}

/** The route id a mirror file names in its first line; null for a file claudecharter did not write. */
export function mirrorOwner(text: string): string | null {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const m = /^<!-- claudecharter chart (\S+): /.exec(first)

  return m === null ? null : (m[1] ?? null)
}

/** The mirror file setting as a safe relative `.md` path; `PROGRESS.md` when it is not one. */
export function mirrorPathOf(v: unknown): string {
  const s = String(v ?? '').trim()
  const valid =
    s !== '' &&
    /\.md$/i.test(s) &&
    !s.startsWith('/') &&
    !s.startsWith('\\') &&
    !/^[A-Za-z]:/.test(s) &&
    !s.split(/[\\/]/).includes('..')

  return valid ? s : 'PROGRESS.md'
}

function itemLines(items: ChartItem[], depth: number, share: ShareView | null, out: string[]): void {
  const hasPeers = share !== null && share.peers.length > 0
  for (const item of items) {
    const id = `**${item.id}** ${item.title}`
    let line: string
    if (item.status === 'done') {
      line = `- [x] ${id}` + (item.commit !== null ? ` · \`${item.commit}\`` : '')
    } else if (item.status === 'skipped') {
      line = `- [x] ~~${id}~~ (skipped)`
    } else if (item.status === 'blocked') {
      line = `- [ ] ${id} · ⊘ blocked` + (item.note !== null ? `: ${item.note}` : '')
    } else {
      line = `- [ ] ${id}`
      if (item.phase !== null && item.phases.length > 0) {
        line += ` · ${item.phase} (${item.phases.indexOf(item.phase) + 1}/${item.phases.length})`
      }
    }
    const holder = hasPeers && share !== null ? share.held[item.id] : undefined
    if (holder !== undefined) line += ` (session ${holder.label})`
    if (item.note !== null && item.status !== 'blocked') line += ` — ${item.note}`
    out.push('  '.repeat(depth) + line)
    itemLines(item.items, depth + 1, share, out)
  }
}

/** The markdown checklist of a route. Every item is listed; the first line names the route. */
export function renderMirror(chart: Chart | null, chartId: string, share: ShareView | null, now: number, offsetMin: number): string {
  const lines: string[] = [mirrorMarker(chartId), `# ${chart === null ? 'Route' : chart.title}`, '']
  if (chart === null) {
    lines.push('_No route charted._')

    return lines.join('\n') + '\n'
  }
  const finished = chart.finishedAt !== null
  const { done, total } = topCounts(chart)
  lines.push(`${done}/${total} done · ${percentOf(progress(chart), finished)}% · updated ${stamp(now, offsetMin)}`)
  if (share !== null && share.peers.length > 0) {
    lines.push(`Shared by sessions ${[share.meLabel, ...share.peers.map(p => p.label)].join(', ')}.`)
  }
  if (finished) {
    lines.push('')
    lines.push('**Complete**: everything is done.')
  }
  lines.push('')
  itemLines(chart.items, 0, share, lines)

  return lines.join('\n') + '\n'
}

/** True when this session is the live member with the smallest session id; a solo session always is. */
export function isWriter(merged: Merged, meId: string, now: number): boolean {
  const live = merged.members.filter(p => p.endedAt === null && now - p.seenAt < LIVE_MS).map(p => p.sessionId)
  if (!live.includes(meId)) live.push(meId)
  const smallest = live.reduce((a, b) => (b < a ? b : a))

  return smallest === meId
}

/**
 * Whether the mirror file may be written: no file, or one this route wrote (or another route no member of which is
 * live) may; a file claudecharter did not write is foreign, one another live route owns is owned.
 */
export function mayWrite(text: string | null, chartId: string, otherChartActive: boolean): 'write' | 'foreign' | 'owned' {
  if (text === null) return 'write'
  const owner = mirrorOwner(text)
  if (owner === null) return 'foreign'
  if (owner === chartId) return 'write'

  return otherChartActive ? 'owned' : 'write'
}
