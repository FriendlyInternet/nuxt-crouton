// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createConsoleTool, type ErudaLike } from '../src/runtime/tools/console'
import type { ConsoleCapture } from '../src/runtime/tools/console-capture'

describe('console tool', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('exposes the menu metadata', () => {
    const tool = createConsoleTool(null, async () => ({ init: vi.fn(), show: vi.fn(), hide: vi.fn() }))
    expect(tool.id).toBe('console')
    expect(tool.label).toBe('Console')
    expect(tool.order).toBe(1)
  })

  it('lazy-inits eruda once on first activate, then shows; hides on deactivate', async () => {
    const eruda: ErudaLike = { init: vi.fn(), show: vi.fn(), hide: vi.fn() }
    const load = vi.fn(async () => eruda)
    const tool = createConsoleTool(null, load)

    await tool.activate!()
    expect(load).toHaveBeenCalledOnce()
    expect(eruda.init).toHaveBeenCalledOnce()
    expect(eruda.show).toHaveBeenCalledOnce()

    await tool.activate!()
    expect(load).toHaveBeenCalledOnce() // not re-loaded
    expect(eruda.init).toHaveBeenCalledOnce() // not re-init
    expect(eruda.show).toHaveBeenCalledTimes(2)

    tool.deactivate!()
    expect(eruda.hide).toHaveBeenCalledOnce()
  })

  it('badges the captured warn/error count, and replays the buffer into eruda once (#1080)', async () => {
    const eruda: ErudaLike = { init: vi.fn(), show: vi.fn(), hide: vi.fn() }
    const replay = vi.fn()
    const capture: ConsoleCapture = {
      entries: [],
      errorCount: () => 3,
      record: vi.fn(),
      replay,
      uninstall: vi.fn(),
    }
    const tool = createConsoleTool(capture, async () => eruda)

    expect(tool.badge!()).toBe(3)

    await tool.activate!()
    expect(replay).toHaveBeenCalledOnce()

    await tool.activate!()
    expect(replay).toHaveBeenCalledOnce() // replayed only once, not on every open
  })

  it('badge is null when nothing was captured', () => {
    const capture: ConsoleCapture = { entries: [], errorCount: () => 0, record: vi.fn(), replay: vi.fn(), uninstall: vi.fn() }
    expect(createConsoleTool(capture).badge!()).toBeNull()
    expect(createConsoleTool(null).badge!()).toBeNull()
  })

  it('injects a reachable "Close console" ✕ on activate, wired to onRequestClose; removes it on deactivate (#1174)', async () => {
    const eruda: ErudaLike = { init: vi.fn(), show: vi.fn(), hide: vi.fn() }
    const onRequestClose = vi.fn()
    const tool = createConsoleTool(null, async () => eruda, onRequestClose)

    await tool.activate!()
    const btn = document.querySelector('button[aria-label="Close console"]') as HTMLButtonElement | null
    expect(btn, 'close ✕ present after activate').not.toBeNull()

    btn!.click()
    expect(onRequestClose, '✕ requests close via the registry, not a bare eruda.hide()').toHaveBeenCalledOnce()

    tool.deactivate!()
    expect(document.querySelector('button[aria-label="Close console"]'), 'close ✕ removed on deactivate').toBeNull()
    expect(eruda.hide).toHaveBeenCalledOnce()
  })

  it('falls back to eruda.hide() when no onRequestClose is wired', async () => {
    const eruda: ErudaLike = { init: vi.fn(), show: vi.fn(), hide: vi.fn() }
    const tool = createConsoleTool(null, async () => eruda)
    await tool.activate!()
    ;(document.querySelector('button[aria-label="Close console"]') as HTMLButtonElement).click()
    expect(eruda.hide).toHaveBeenCalledOnce()
  })
})
