import { describe, it, expect } from 'vitest'
import { installEarlyConsoleCapture } from '../src/runtime/tools/console-capture'

describe('early console capture (#1080)', () => {
  it('records console.* from install and still calls the original', () => {
    const seen: unknown[][] = []
    const original = console.warn
    console.warn = (...a: unknown[]) => { seen.push(a) }
    const cap = installEarlyConsoleCapture()

    console.warn('hello', 42)
    expect(cap.entries).toHaveLength(1)
    expect(cap.entries[0]).toMatchObject({ level: 'warn', args: ['hello', 42] })
    expect(seen).toEqual([['hello', 42]]) // original still invoked (nothing swallowed)

    cap.uninstall()
    console.warn('after uninstall')
    expect(cap.entries).toHaveLength(1) // no longer captured once uninstalled
    console.warn = original
  })

  it('replay emits every entry, and does NOT re-record during the replay', () => {
    const cap = installEarlyConsoleCapture()
    cap.record('error', ['boom'])
    cap.record('log', ['x'])

    const levels: string[] = []
    cap.replay((e) => {
      levels.push(e.level)
      cap.record('log', ['must not be recorded during replay'])
    })

    expect(levels).toEqual(['error', 'log'])
    expect(cap.entries).toHaveLength(2) // the replay-time record() calls were suspended
    cap.uninstall()
  })

  it('errorCount counts warn + error only', () => {
    const cap = installEarlyConsoleCapture()
    cap.record('log', ['a'])
    cap.record('warn', ['b'])
    cap.record('error', ['c'])
    expect(cap.errorCount()).toBe(2)
    cap.uninstall()
  })

  it('caps the buffer, dropping the oldest', () => {
    const cap = installEarlyConsoleCapture(3)
    for (let i = 0; i < 5; i++) cap.record('log', [i])
    expect(cap.entries).toHaveLength(3)
    expect(cap.entries[0]!.args).toEqual([2]) // 0 and 1 dropped
    cap.uninstall()
  })
})
