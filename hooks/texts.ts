/** The progress tool's description: a fixed text, never built from state. */
export const TOOL_DESCRIPTION = [
  'Keeps a live progress chart of multi-stage work, shown to the person as a one-line progress route and as a checklist in /charter. Use it only when you orchestrate work split into several stages or parts (a milestone split into stages, a stage split into parts, each part going through phases such as plan, approve, implement, checks, accept, commit); never for a single small task. Call it from the main conversation, not from a subagent.',
  'Actions:',
  '- plan: declare the route: title, and items, each {id, title, phases?, items?}, nested up to 4 levels. Ids are short and unique in the route (S2, S2.P1). Declaring it again keeps the progress of ids that already exist.',
  '- add: append items under parent, or at the top level.',
  '- start: make id your current step; its parents become active. Pass phase to set or change the phase the item is in. Starting a step also claims it for this session (its whole stage when no one else holds part of it).',
  '- done: mark id (default: your current step) done, with commit (the short hash) when a commit finished it. Its unfinished children are done too; a parent with no phases is done when all its children are.',
  '- skip, block: mark id skipped or blocked, with an optional note.',
  '- claim, release: hold or let go of id (and everything under it) for this session.',
  '- get: read the route. After a /clear, a resume or a compaction, call get to see where you are.',
  'A route belongs to the session working on it and stays with it across --resume and /clear. The person may share it with other sessions: each has its own current step and holds the parts it claimed. A part another session holds is refused; work on parts you hold or on unclaimed ones, as the result\'s Sessions and Unclaimed lines say.',
  'Every call returns the route as it stands; read it from the result rather than keeping your own copy. Subagents, test/build commands and git commits are seen by the mod itself: report only what it cannot see (the plan, where you are, what is finished), with one call when a stage, part or phase changes.',
].join('\n')

/** The progress tool's input schema. */
export const INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['plan', 'add', 'start', 'done', 'skip', 'block', 'get', 'claim', 'release'],
      description: 'What to do; see the tool description.',
    },
    title: { type: 'string', description: 'plan: the route\'s name, e.g. "M1.6 Planet catalogue".' },
    items: {
      type: 'array',
      description: 'plan, add: the items in order, each {id, title, phases?, items?}; items nest up to 4 levels.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          phases: { type: 'array', items: { type: 'string' } },
          items: { type: 'array', items: { type: 'object' } },
        },
        required: ['id', 'title'],
      },
    },
    parent: { type: 'string', description: 'add: the id to add under; omit for the top level.' },
    id: {
      type: 'string',
      description: 'start, done, skip, block, claim, release: the item. done and skip default to your current step.',
    },
    phase: { type: 'string', description: 'start: the phase the item is in now (one of its phases, or a new one).' },
    commit: { type: 'string', description: 'done: the short hash of the commit that finished it.' },
    note: { type: 'string', description: 'done, skip, block: a short note shown beside the item.' },
  },
  required: ['action'],
}

/** The message `/charter init` submits. */
export const INIT_PROMPT = [
  'The person ran /charter init: rebuild the progress route of this session\'s work with the claudecharter progress tool (mcp__claudecharter__progress).',
  'Use only what this conversation and the repository\'s git history show. Do not invent stages, parts or phases that were not proposed or worked on.',
  '1. Gather the structure discussed here: the milestone or task, its stages, their parts, and the phases each part goes through.',
  '2. Run git log --oneline -n 50 to find the commits that finished items.',
  '3. Call the tool with action plan, using the ids and titles as they were discussed (short ids such as S1, S1.P2 when none were given).',
  '4. For each finished item call done with id and, when a commit finished it, commit (its short hash); skip items that were dropped.',
  '5. Call start for the item work is on now, with its phase.',
  'Then answer with one short line saying what was charted. If this conversation shows no multi-stage work, say so and do not call the tool.',
].join('\n')

/** The answer to a /charter command that is not understood. */
export const USAGE =
  'Usage: /charter [init | clear | done|start|skip|reset|claim|release <id> | join|adopt [n] | leave | mirror claim | demo | demo pane | demo stop]'
