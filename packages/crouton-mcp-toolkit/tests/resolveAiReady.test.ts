/**
 * #3982 — nuxt-ai-ready's MCP tools/resources default off when the app sets nothing,
 * and an app's own `aiReady` settings are kept as given. `setup` assigns exactly this
 * return value to nuxt.options.aiReady.
 */
import { describe, it, expect } from 'vitest'
import { resolveAiReady } from '../lib/ai-ready'

describe('resolveAiReady', () => {
  it('turns tools and resources off when the app sets nothing', () => {
    expect(resolveAiReady(undefined)).toEqual({ mcp: { tools: false, resources: false } })
  })

  it('keeps the app\'s own aiReady values as given', () => {
    expect(resolveAiReady({ mcp: { tools: true, resources: true } }))
      .toEqual({ mcp: { tools: true, resources: true } })
    expect(resolveAiReady({ mcp: { tools: true }, other: 1 }))
      .toEqual({ mcp: { tools: true, resources: false }, other: 1 })
  })

  it('leaves aiReady: false (module disabled) untouched', () => {
    expect(resolveAiReady(false)).toBe(false)
  })
})
