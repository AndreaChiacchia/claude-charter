import { expect, test } from 'claude-code/testing'

import { checkLabel, cut, formatDuration, gitCommitInfo, isGitCommit, modelLabel, stamp, wordForReason } from '../hooks/signals'

test('cut keeps n code points and marks the cut', async () => {
  expect(cut('abcdef', 6)).toBe('abcdef')
  expect(cut('abcdef', 4)).toBe('abc…')
  expect(Array.from(cut('x'.repeat(50), 32)).length).toBe(32)
  expect(cut('ab', 5)).toBe('ab')
})

test('checkLabel recognizes test, build and lint runs', async () => {
  expect(checkLabel('npm test')).toBe('npm test')
  expect(checkLabel('cd app && pnpm run build')).toBe('pnpm run build')
  expect(checkLabel('FOO=1 cargo test --all')).toBe('cargo test --all')
  expect(checkLabel('python -m pytest -q')).toBe('python -m pytest -q')
  expect(checkLabel('claude plugin test .')).toBe('claude plugin test .')
  expect(checkLabel('make')).toBe('make')
  expect(checkLabel('yarn build')).toBe('yarn build')
  expect(checkLabel('bun test')).toBe('bun test')
  expect(checkLabel('./gradlew test')).toBe('./gradlew test')
  expect(checkLabel('go test ./...')).toBe('go test ./...')
  expect(checkLabel('dotnet build')).toBe('dotnet build')
  expect(checkLabel('deno lint')).toBe('deno lint')
  expect(checkLabel('cd x; npm run lint')).toBe('npm run lint')
  expect(checkLabel('npx prettier --check .')).toBe('npx prettier --check .')
  expect(checkLabel('npx -y eslint src')).toBe('npx -y eslint src')
  expect(checkLabel('claude plugin validate .')).toBe('claude plugin validate .')
})

test('checkLabel ignores everything else', async () => {
  expect(checkLabel('git status')).toBeNull()
  expect(checkLabel('echo npm test')).toBeNull()
  expect(checkLabel('npm install')).toBeNull()
  expect(checkLabel('npx prettier .')).toBeNull()
  expect(checkLabel('cargo run')).toBeNull()
  expect(checkLabel('python script.py')).toBeNull()
  expect(checkLabel('cd app')).toBeNull()
  expect(checkLabel('')).toBeNull()
})

test('checkLabel cuts a long label to 32 code points', async () => {
  const label = checkLabel('npm run test:' + 'x'.repeat(27))
  expect(Array.from(label ?? '').length).toBe(32)
  expect(label?.endsWith('…')).toBe(true)
  // The plan's own example is 35 characters, so it is cut too.
  expect(checkLabel('npx -y -p typescript@5.6.3 tsc -p .')).toBe('npx -y -p typescript@5.6.3 tsc …')
})

test('isGitCommit skips global options', async () => {
  expect(isGitCommit('git commit -m x')).toBe(true)
  expect(isGitCommit('git -C /x commit -m y')).toBe(true)
  expect(isGitCommit('git -c user.name=a commit -m z')).toBe(true)
  expect(isGitCommit('git add . && git commit -m z')).toBe(true)
  expect(isGitCommit('git status')).toBe(false)
  expect(isGitCommit('git commit-tree x')).toBe(false)
  expect(isGitCommit('echo git commit')).toBe(false)
})

test('gitCommitInfo reads the record or the commit line', async () => {
  const withSha = { result: { stdout: '', gitOperation: { commit: { sha: 'ABCDEF1234' } } } }
  expect(gitCommitInfo('git commit -m x', withSha)).toEqual({ hash: 'abcdef1', message: '' })
  const line = { result: { stdout: '[main 1a2b3c4] add planets\n 1 file changed, 2 insertions(+)\n' } }
  expect(gitCommitInfo('git commit -m x', line)).toEqual({ hash: '1a2b3c4', message: 'add planets' })
  const root = { result: { stdout: '[main (root-commit) 9f8e7d6] init\n' } }
  expect(gitCommitInfo('git commit -m init', root)).toEqual({ hash: '9f8e7d6', message: 'init' })
  expect(gitCommitInfo('git -C /x commit -m y', { result: { stdout: '[dev 1234567] y' } })?.hash).toBe('1234567')
  const both = { result: { stdout: '[main 1a2b3c4] msg', gitOperation: { commit: { sha: 'fedcba9876' } } } }
  expect(gitCommitInfo('git commit -m msg', both)).toEqual({ hash: 'fedcba9', message: 'msg' })
  const long = { result: { stdout: `[main 1a2b3c4] ${'m'.repeat(60)}` } }
  expect(Array.from(gitCommitInfo('git commit -m m', long)?.message ?? '').length).toBe(40)
})

test('gitCommitInfo ignores failures and other commands', async () => {
  const line = { result: { stdout: '[main 1a2b3c4] add planets' } }
  expect(gitCommitInfo('git commit -m x', { ...line, isError: true })).toBeNull()
  expect(gitCommitInfo('git commit -m x', { deny: 'no' })).toBeNull()
  expect(gitCommitInfo('git log', line)).toBeNull()
  expect(gitCommitInfo('git commit -m x', { result: { stdout: 'nothing to commit' } })).toBeNull()
  expect(gitCommitInfo('git commit -m x', { result: 'text' })).toBeNull()
  expect(gitCommitInfo('git commit -m x', null)).toBeNull()
})

test('small formatters', async () => {
  expect(wordForReason('answer')).toBe('done')
  expect(wordForReason('aborted')).toBe('stopped')
  expect(wordForReason('refusal')).toBe('failed')
  expect(wordForReason('error')).toBe('failed')
  expect(modelLabel('claude-sonnet-5-5')).toBe('sonnet 5.5')
  expect(modelLabel('sonnet')).toBe('sonnet')
  expect(modelLabel('claude-opus-4-1[1m]')).toBe('opus 4.1')
  expect(formatDuration(5000)).toBe('5s')
  expect(formatDuration(72000)).toBe('1m12s')
  expect(formatDuration(3_900_000)).toBe('1h05m')
  expect(formatDuration(0)).toBe('0s')
  expect(stamp(Date.UTC(2026, 9, 14, 10, 5), 120)).toBe('14/10 12:05')
  expect(stamp(Date.UTC(2026, 0, 3, 23, 59), 0)).toBe('03/01 23:59')
})
