/** A finished check stays on the band this long (ms). */
export const CHECK_SHOW_MS = 6000

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `s` cut to `n` code points; when it was cut, the last kept code point is replaced by `…` (the result is `n` long). */
export function cut(s: string, n: number): string {
  const chars = Array.from(s)
  if (chars.length <= n) return s
  if (n <= 0) return ''

  return chars.slice(0, n - 1).join('') + '…'
}

const ENV_ASSIGNMENTS = /^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/
const SKIPPED_FIRST = new Set(['cd', 'pushd', 'Set-Location', 'sl'])

/** The command split into its simple commands, as token lists; `cd` and its kin, and empty ones, dropped. */
export function segments(command: string): string[][] {
  const out: string[][] = []
  for (const raw of command.split(/&&|\|\||;|\||\r?\n/)) {
    let seg = raw.trim()
    if (seg.startsWith('(')) seg = seg.slice(1).trim()
    seg = seg.replace(ENV_ASSIGNMENTS, '').trim()
    if (seg === '') continue
    const tokens = seg.split(/\s+/)
    const first = tokens[0] ?? ''
    if (SKIPPED_FIRST.has(first)) continue
    out.push(tokens)
  }

  return out
}

const TASK = /^(test|build|lint|check|typecheck|type-check|tsc|ci|verify)(:\S*)?$/
const JS_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const NPX_TOOLS = new Set(['tsc', 'jest', 'vitest', 'mocha', 'eslint', 'playwright', 'biome'])
const DIRECT_TOOLS = new Set([
  'tsc',
  'jest',
  'vitest',
  'mocha',
  'eslint',
  'pytest',
  'ruff',
  'mypy',
  'ctest',
  'gradle',
  'gradlew',
  './gradlew',
  'mvn',
  'mvnw',
  './mvnw',
  'make',
])
const SUBCOMMANDS: Record<string, readonly string[]> = {
  cargo: ['test', 'build', 'check', 'clippy', 'nextest'],
  go: ['test', 'build', 'vet'],
  dotnet: ['test', 'build'],
  swift: ['test', 'build'],
  deno: ['test', 'check', 'lint'],
}

function isCheck(tokens: string[]): boolean {
  const t0 = tokens[0] ?? ''
  const t1 = tokens[1]
  const t2 = tokens[2]
  if (JS_RUNNERS.has(t0)) {
    if (t1 === 'test' || t1 === 't') return true
    if (t1 !== undefined && TASK.test(t1)) return true

    return t1 === 'run' && t2 !== undefined && TASK.test(t2)
  }
  if (t0 === 'npx' || t0 === 'bunx') {
    let i = 1
    while (i < tokens.length) {
      const tok = tokens[i] ?? ''
      if (!tok.startsWith('-')) break
      i += tok === '-p' || tok === '--package' ? 2 : 1
    }
    const tool = tokens[i] ?? ''
    if (NPX_TOOLS.has(tool)) return true

    return tool === 'prettier' && tokens.slice(i + 1).includes('--check')
  }
  if (DIRECT_TOOLS.has(t0)) return true
  const subs = SUBCOMMANDS[t0]
  if (subs !== undefined) return t1 !== undefined && subs.includes(t1)
  if (t0 === 'python' || t0 === 'python3' || t0 === 'py') {
    return t1 === '-m' && (t2 === 'pytest' || t2 === 'unittest' || t2 === 'mypy')
  }

  return t0 === 'claude' && t1 === 'plugin' && (t2 === 'test' || t2 === 'validate')
}

/** The label of the first simple command that is a test, build or lint run (its tokens, cut to 32), else null. */
export function checkLabel(command: string): string | null {
  for (const tokens of segments(command)) {
    if (isCheck(tokens)) return cut(tokens.join(' '), 32)
  }

  return null
}

/** True when some simple command of `command` is `git commit` (global options such as `-C <dir>` skipped). */
export function isGitCommit(command: string): boolean {
  for (const tokens of segments(command)) {
    if (tokens[0] !== 'git') continue
    let i = 1
    while (i < tokens.length) {
      const tok = tokens[i] ?? ''
      if (tok === '-C' || tok === '-c') i += 2
      else if (tok.startsWith('-')) i += 1
      else break
    }
    if (tokens[i] === 'commit') return true
  }

  return false
}

const COMMIT_LINE = /^\[[^\]\n]*\s([0-9a-f]{7,40})\]\s*(.*)$/m

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * The commit a Bash or PowerShell call made, from the tool's own record (`gitOperation.commit.sha`) or from the
 * `[branch hash] message` line of a `git commit`; null when the call was denied or failed, or made none.
 */
export function gitCommitInfo(command: string, ran: unknown): { hash: string; message: string } | null {
  if (!isRecord(ran)) return null
  if (typeof ran.deny === 'string' || ran.isError === true) return null
  const rec = ran.result
  if (!isRecord(rec)) return null
  const stdout = typeof rec.stdout === 'string' ? rec.stdout : ''
  const m = COMMIT_LINE.exec(stdout)
  const op = rec.gitOperation
  const commit = isRecord(op) ? op.commit : undefined
  const sha = isRecord(commit) ? commit.sha : undefined
  let hash: string | null = null
  if (typeof sha === 'string' && sha.length >= 7) hash = sha.slice(0, 7).toLowerCase()
  else if (isGitCommit(command) && m !== null && m[1] !== undefined) hash = m[1].slice(0, 7).toLowerCase()
  if (hash === null) return null

  return { hash, message: m !== null ? cut((m[2] ?? '').trim(), 40) : '' }
}

/** How a subagent's turn ended, from `turn.complete`'s reason. */
export function wordForReason(reason: string): 'done' | 'stopped' | 'failed' {
  if (reason === 'answer') return 'done'
  if (reason === 'aborted') return 'stopped'

  return 'failed'
}

/** `claude-sonnet-5-5` as `sonnet 5.5`; a bare `sonnet` stays. */
export function modelLabel(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '').replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2')
}

/** `5s`, `1m12s`, `1h05m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m${pad2(total % 60)}s`

  return `${Math.floor(total / 3600)}h${pad2(Math.floor((total % 3600) / 60))}m`
}

/** `DD/MM HH:MM` in the local time `offsetMin` minutes east of UTC. */
export function stamp(at: number, offsetMin: number): string {
  const d = new Date(at + offsetMin * 60_000)

  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}
