import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

// #4263 C5 — the real entry point: `crouton init <name> --site --poc --dry-run`
// accepts the flag (citty silently drops unknown flags, so before #4263 it was
// ignored) and the scaffold extends crouton-pages without writing any page or
// middleware. Runs from the repo root so the monorepo is detected.
const exec = promisify(execFile)
const CLI_PATH = resolve(__dirname, '../../bin/crouton-generate.js')
const REPO_ROOT = resolve(__dirname, '../../../..')

function runCLI(args: string[], cwd: string) {
  return exec('node', [CLI_PATH, ...args], {
    cwd,
    timeout: 120_000,
    env: { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' }
  }).then(
    ({ stdout, stderr }) => ({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 }),
    (err: any) => ({
      stdout: (err.stdout as string) ?? '',
      stderr: (err.stderr as string) ?? '',
      exitCode: typeof err.code === 'number' ? err.code : 1
    })
  )
}

describe('crouton init --site (#4263)', () => {
  // covers: T3
  it('dry-run extends crouton-pages and lists no page or middleware file', async () => {
    const { stdout, stderr, exitCode } = await runCLI(['init', 'demo-site', '--site', '--poc', '--dry-run'], REPO_ROOT)
    expect(exitCode, stderr).toBe(0)
    const extendsLine = stdout.split('\n').find(l => l.includes('Extends:')) ?? ''
    expect(extendsLine).toContain('@fyit/crouton-pages')
    expect(stdout).not.toMatch(/\+ app\/pages\//)
    expect(stdout).not.toMatch(/\+ server\/middleware\//)
  }, 120_000)
})
