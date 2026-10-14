import { describe, it, expect, vi } from 'vitest'
import { routeTaskToOutputs, validateFlowOutputs } from '../domain-routing'
import type { DetectedTask, FlowOutput } from '../../../app/types'

// Mock the logger
vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ============================================================================
// Helpers
// ============================================================================
function makeOutput(overrides: Partial<FlowOutput> = {}): FlowOutput {
  return {
    id: 'output-1',
    flowId: 'flow-1',
    outputType: 'notion',
    isDefault: false,
    outputConfig: {},
    active: true,
    ...overrides,
  }
}

function makeTask(overrides: Partial<DetectedTask> = {}): DetectedTask {
  return {
    title: 'Test Task',
    description: 'Test description',
    ...overrides,
  }
}

// ============================================================================
// routeTaskToOutputs
// ============================================================================
describe('routeTaskToOutputs', () => {
  it('throws when no default output is configured', () => {
    const outputs = [makeOutput({ isDefault: false })]
    const task = makeTask()

    expect(() => routeTaskToOutputs(task, outputs)).toThrow('No default output configured')
  })

  it('routes to default when task has no domain', () => {
    const defaultOutput = makeOutput({ id: 'default', isDefault: true })
    const outputs = [defaultOutput]
    const task = makeTask({ domain: undefined })

    const result = routeTaskToOutputs(task, outputs)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('default')
  })

  it('routes to default when task domain is null', () => {
    const defaultOutput = makeOutput({ id: 'default', isDefault: true })
    const outputs = [defaultOutput]
    const task = makeTask({ domain: null })

    const result = routeTaskToOutputs(task, outputs)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('default')
  })

  it('routes to matching domain output', () => {
    const defaultOutput = makeOutput({ id: 'default', isDefault: true })
    const designOutput = makeOutput({ id: 'design', domainFilter: ['design'] })
    const outputs = [defaultOutput, designOutput]
    const task = makeTask({ domain: 'design' })

    const result = routeTaskToOutputs(task, outputs)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('design')
  })

  it('routes to multiple matching outputs', () => {
    const defaultOutput = makeOutput({ id: 'default', isDefault: true })
    const output1 = makeOutput({ id: 'out1', domainFilter: ['frontend', 'design'] })
    const output2 = makeOutput({ id: 'out2', domainFilter: ['design'] })
    const outputs = [defaultOutput, output1, output2]
    const task = makeTask({ domain: 'design' })

    const result = routeTaskToOutputs(task, outputs)
    expect(result).toHaveLength(2)
    expect(result.map(o => o.id)).toContain('out1')
    expect(result.map(o => o.id)).toContain('out2')
  })

  it('routes to default when domain does not match any output', () => {
    const defaultOutput = makeOutput({ id: 'default', isDefault: true })
    const designOutput = makeOutput({ id: 'design', domainFilter: ['design'] })
    const outputs = [defaultOutput, designOutput]
    const task = makeTask({ domain: 'backend' })

    const result = routeTaskToOutputs(task, outputs)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('default')
  })

  it('skips outputs with empty domainFilter array', () => {
    const defaultOutput = makeOutput({ id: 'default', isDefault: true, domainFilter: [] })
    const outputs = [defaultOutput]
    const task = makeTask({ domain: 'design' })

    const result = routeTaskToOutputs(task, outputs)
    // Empty domainFilter is skipped in matching, falls back to default
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('default')
  })

  it('skips outputs with undefined domainFilter', () => {
    const defaultOutput = makeOutput({ id: 'default', isDefault: true, domainFilter: undefined })
    const outputs = [defaultOutput]
    const task = makeTask({ domain: 'frontend' })

    const result = routeTaskToOutputs(task, outputs)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('default')
  })
})

// ============================================================================
// validateFlowOutputs
// ============================================================================
describe('validateFlowOutputs', () => {
  it('throws when outputs array is empty', () => {
    expect(() => validateFlowOutputs([])).toThrow('at least one output')
  })

  it('throws when no default output exists', () => {
    const outputs = [makeOutput({ isDefault: false })]
    expect(() => validateFlowOutputs(outputs)).toThrow('exactly one default output')
  })

  it('passes with exactly one default output', () => {
    const outputs = [makeOutput({ isDefault: true })]
    expect(() => validateFlowOutputs(outputs)).not.toThrow()
  })

  it('warns but does not throw for multiple default outputs', () => {
    const outputs = [
      makeOutput({ id: '1', isDefault: true }),
      makeOutput({ id: '2', isDefault: true }),
    ]
    // Should not throw - just warns
    expect(() => validateFlowOutputs(outputs)).not.toThrow()
  })

  it('passes with mixed default and non-default outputs', () => {
    const outputs = [
      makeOutput({ id: '1', isDefault: true }),
      makeOutput({ id: '2', isDefault: false, domainFilter: ['design'] }),
      makeOutput({ id: '3', isDefault: false, domainFilter: ['backend'] }),
    ]
    expect(() => validateFlowOutputs(outputs)).not.toThrow()
  })
})
