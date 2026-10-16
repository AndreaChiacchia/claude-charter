import type { Chart, ChartItem } from '../types'

const PHASES = ['plan', 'approve', 'implement', 'checks', 'accept', 'commit']

/** A route item with every field given a default. */
export function item(id: string, title: string, status: ChartItem['status'], over: Partial<ChartItem> = {}): ChartItem {
  return { id, title, status, phases: [], phase: null, commit: null, note: null, doneAt: null, items: [], ...over }
}

/**
 * Fixture F: S1 done (a1b2c3d); S2 active with S2.P1 done, S2.P2 active in phase implement (3 of 6), S2.P3 pending;
 * S3, S4, S5 pending. Its progress is (1 + (1 + 2/6 + 0) / 3) / 5, about 0.28889 (28%).
 */
export function fixtureChart(): Chart {
  return {
    title: 'M1.6',
    items: [
      item('S1', 'Scaffolding', 'done', { commit: 'a1b2c3d', doneAt: 1 }),
      item('S2', 'Planet catalogue', 'active', {
        items: [
          item('S2.P1', 'Data model', 'done', { doneAt: 2 }),
          item('S2.P2', 'Catalogue UI', 'active', { phases: PHASES, phase: 'implement' }),
          item('S2.P3', 'Search', 'pending'),
        ],
      }),
      item('S3', 'Orbit view', 'pending'),
      item('S4', 'Polish', 'pending'),
      item('S5', 'Release', 'pending'),
    ],
    current: 'S2.P2',
    startedAt: 0,
    updatedAt: 0,
    finishedAt: null,
    revision: 1,
  }
}
