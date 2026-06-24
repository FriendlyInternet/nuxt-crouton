import { describe, it, expect } from 'vitest'
import {
  resolveLayoutBlockComponentName,
  sanitizeLayoutBlockConfig,
} from '../useCroutonLayoutBlocks'
import type {
  CroutonLayoutBlockDefinition,
  CroutonLayoutBlockRegistry,
} from '@fyit/crouton-core/app/types/layout-block'

const registry: CroutonLayoutBlockRegistry = {
  'entity-form': {
    id: 'entity-form',
    name: 'Form',
    description: 'A form surface',
    icon: 'i-lucide-square-pen',
    component: 'CroutonLayoutSpikeForm',
    configSchema: [
      { name: 'heading', type: 'text', default: 'Items' },
      { name: 'count', type: 'number' },
      { name: 'open', type: 'boolean' },
    ],
  },
}

describe('layout block registry — allowlisted resolution', () => {
  it('resolves a known id to its registered component name', () => {
    expect(resolveLayoutBlockComponentName(registry, 'entity-form')).toBe('CroutonLayoutSpikeForm')
  })

  it('returns null for an unknown id (the allowlist guard)', () => {
    expect(resolveLayoutBlockComponentName(registry, 'totally-not-a-real-block')).toBeNull()
  })
})

describe('layout block registry — config sanitization', () => {
  const def = registry['entity-form'] as CroutonLayoutBlockDefinition

  it('keeps only declared keys with matching primitive types; drops the rest', () => {
    const out = sanitizeLayoutBlockConfig(def, {
      heading: 'Hi',
      count: 5,
      open: true,
      danger: '<script>alert(1)</script>',
    })
    expect(out).toEqual({ heading: 'Hi', count: 5, open: true })
  })

  it('falls back to default on a wrong-typed value, drops wrong-typed without default', () => {
    const out = sanitizeLayoutBlockConfig(def, { heading: 123, count: 'nope' })
    expect(out).toEqual({ heading: 'Items' })
  })

  it('returns an empty object when the block declares no schema', () => {
    const noSchema: CroutonLayoutBlockDefinition = {
      id: 'x', name: 'x', description: '', icon: '', component: 'X',
    }
    expect(sanitizeLayoutBlockConfig(noSchema, { a: 1, b: 'two' })).toEqual({})
  })

  it('returns an empty object for an undefined block', () => {
    expect(sanitizeLayoutBlockConfig(undefined, { a: 1 })).toEqual({})
  })
})
