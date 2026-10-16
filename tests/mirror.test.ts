import { expect, test } from 'claude-code/testing'

import type { Chart, Participant, ShareView } from '../types'
import { isWriter, mayWrite, mirrorMarker, mirrorOwner, mirrorPathOf, renderMirror } from '../hooks/mirror'
import { mergeChart, newParticipant } from '../hooks/share'
import { fixtureChart, item } from './fixture'

const NOW = Date.UTC(2026, 9, 14, 10, 0)

test('the mirror path is a safe relative markdown file', async () => {
  expect(mirrorPathOf('PROGRESS.md')).toBe('PROGRESS.md')
  expect(mirrorPathOf('docs/route.md')).toBe('docs/route.md')
  expect(mirrorPathOf('  notes.MD ')).toBe('notes.MD')
  for (const bad of ['/etc/x.md', '\\x.md', 'C:\\x.md', 'c:/x.md', '../x.md', 'a/../x.md', 'a\\..\\x.md', 'notes.txt', '', '   ', undefined, 5]) {
    expect(mirrorPathOf(bad)).toBe('PROGRESS.md')
  }
})

test('the mirror renders the route as a checklist', async () => {
  const out = renderMirror(fixtureChart(), 'c1', null, NOW, 0)
  expect(out.startsWith('<!-- claudecharter chart c1: ')).toBe(true)
  expect(out.split('\n')[0]).toBe(mirrorMarker('c1'))
  expect(out.split('\n')[1]).toBe('# M1.6')
  expect(out).toContain('1/5 done · 28% · updated 14/10 10:00')
  expect(out).toContain('- [x] **S1** Scaffolding · `a1b2c3d`')
  expect(out).toContain('- [ ] **S2** Planet catalogue')
  expect(out).toContain('  - [x] **S2.P1** Data model')
  expect(out).toContain('  - [ ] **S2.P2** Catalogue UI · implement (3/6)')
  expect(out).toContain('  - [ ] **S2.P3** Search')
  expect(out).toContain('- [ ] **S5** Release')
  expect(out).not.toContain('← now')
  expect(out.endsWith('\n')).toBe(true)
  expect(out.endsWith('\n\n')).toBe(false)
  expect(out).not.toContain('Shared by')
})

test('skipped, blocked and noted items, and a finished route', async () => {
  const chart: Chart = {
    ...fixtureChart(),
    items: [
      item('A', 'Alpha', 'skipped'),
      item('B', 'Beta', 'blocked', { note: 'waiting' }),
      item('C', 'Gamma', 'blocked'),
      item('D', 'Delta', 'pending', { note: 'later' }),
      item('E', 'Epsilon', 'done', { commit: 'abc1234', note: 'ok' }),
    ],
  }
  const out = renderMirror(chart, 'c1', null, NOW, 0)
  expect(out).toContain('- [x] ~~**A** Alpha~~ (skipped)')
  expect(out).toContain('- [ ] **B** Beta · ⊘ blocked: waiting')
  expect(out).toContain('- [ ] **C** Gamma · ⊘ blocked\n')
  expect(out).toContain('- [ ] **D** Delta — later')
  expect(out).toContain('- [x] **E** Epsilon · `abc1234` — ok')
  const done = renderMirror({ ...chart, finishedAt: 5 }, 'c1', null, NOW, 0)
  expect(done).toContain('\n\n**Complete**: everything is done.\n')
})

test('a shared route names its sessions and who holds what', async () => {
  const share: ShareView = {
    chartId: 'c1',
    meLabel: 'aaaa',
    peers: [{ sessionId: 'cd34x', label: 'cd34', color: 0, isLive: true, seenAt: NOW, current: 'S3', holds: ['S3'] }],
    held: {
      S2: { sessionId: 'aaaa1111', label: 'aaaa', color: 0, node: 'S2', force: false, isMe: true },
      S3: { sessionId: 'cd34x', label: 'cd34', color: 0, node: 'S3', force: false, isMe: false },
    },
    unclaimed: [],
    myHolds: ['S2'],
  }
  const out = renderMirror(fixtureChart(), 'c1', share, NOW, 0)
  expect(out).toContain('Shared by sessions aaaa, cd34.')
  expect(out).toContain('- [ ] **S3** Orbit view (session cd34)')
  expect(out).toContain('- [ ] **S2** Planet catalogue (session aaaa)')
  // Held tags only show on shared routes.
  expect(renderMirror(fixtureChart(), 'c1', { ...share, peers: [] }, NOW, 0)).not.toContain('(session')
})

test('no route renders a stub', async () => {
  expect(renderMirror(null, 'c1', null, NOW, 0)).toBe(`${mirrorMarker('c1')}\n# Route\n\n_No route charted._\n`)
})

test('the first line says whose file it is', async () => {
  expect(mirrorOwner(renderMirror(fixtureChart(), 'c1', null, NOW, 0))).toBe('c1')
  expect(mirrorOwner(renderMirror(fixtureChart(), 'abc-def1', null, NOW, 0))).toBe('abc-def1')
  expect(mirrorOwner('# Notes\n')).toBeNull()
  expect(mirrorOwner('')).toBeNull()
  expect(mirrorOwner(mirrorMarker('c9') + '\r\n# T\r\n')).toBe('c9')
})

const part = (sessionId: string, over: Partial<Participant> = {}): Participant => ({
  ...newParticipant('c1', sessionId, NOW - 1000),
  seenAt: NOW,
  ...over,
})

test('one live session writes the mirror: the one with the smallest id', async () => {
  const solo = mergeChart([part('bbbb2222')], 'bbbb2222', NOW)
  expect(isWriter(solo, 'bbbb2222', NOW)).toBe(true)
  const two = mergeChart([part('aaaa1111'), part('bbbb2222')], 'bbbb2222', NOW)
  expect(isWriter(two, 'aaaa1111', NOW)).toBe(true)
  expect(isWriter(two, 'bbbb2222', NOW)).toBe(false)
  // A session that is not live does not write, nor hold the others back.
  const stale = mergeChart([part('aaaa1111', { seenAt: NOW - 10 * 60000 }), part('bbbb2222')], 'bbbb2222', NOW)
  expect(isWriter(stale, 'bbbb2222', NOW)).toBe(true)
  const ended = mergeChart([part('aaaa1111', { endedAt: NOW - 1 }), part('bbbb2222')], 'bbbb2222', NOW)
  expect(isWriter(ended, 'bbbb2222', NOW)).toBe(true)
})

test('the mirror never overwrites what it did not write, or another live route', async () => {
  expect(mayWrite(null, 'c1', false)).toBe('write')
  expect(mayWrite('# my own notes\n', 'c1', false)).toBe('foreign')
  expect(mayWrite('# my own notes\n', 'c1', true)).toBe('foreign')
  expect(mayWrite(mirrorMarker('c1') + '\n', 'c1', false)).toBe('write')
  expect(mayWrite(mirrorMarker('c1') + '\n', 'c1', true)).toBe('write')
  expect(mayWrite(mirrorMarker('c2') + '\n', 'c1', true)).toBe('owned')
  expect(mayWrite(mirrorMarker('c2') + '\n', 'c1', false)).toBe('write')
})
