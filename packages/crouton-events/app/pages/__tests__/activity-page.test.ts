import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { parse } from 'vue/compiler-sfc'

// Regression for #3987: UDashboardPanel renders header/body/footer INSIDE its
// default slot, so any non-<template> child replaces all three and the #body
// slot (CroutonActivityLog) never mounts — the page showed a blank body.

const pagePath = fileURLToPath(new URL('../admin/[team]/activity.vue', import.meta.url))

// Node types from @vue/compiler-core: 1 = ELEMENT, 2 = TEXT, 3 = COMMENT
function findElement(node: any, tag: string): any {
  if (node.type === 1 && node.tag === tag) return node
  for (const child of node.children ?? []) {
    const found = findElement(child, tag)
    if (found) return found
  }
  return null
}

function slotName(node: any): string | null {
  if (node.type !== 1 || node.tag !== 'template') return null
  const dir = (node.props ?? []).find((p: any) => p.type === 7 && p.name === 'slot')
  return dir ? (dir.arg?.content ?? 'default') : null
}

describe('activity page (admin/[team]/activity.vue)', () => {
  const { descriptor, errors } = parse(readFileSync(pagePath, 'utf8'))
  const panel = findElement(descriptor.template!.ast, 'UDashboardPanel')

  it('parses and contains a UDashboardPanel', () => {
    expect(errors).toEqual([])
    expect(panel).toBeTruthy()
  })

  it('passes the log through the panel #body slot with no default-slot content hiding it', () => {
    const children = panel.children.filter((c: any) => !(c.type === 3 || (c.type === 2 && !c.content.trim())))
    const slots = children.map(slotName)
    expect(slots).toContain('body')
    // Every child must be a named <template #…>; a bare element is default-slot content
    const bare = children.filter((c: any) => slotName(c) === null || slotName(c) === 'default')
    expect(bare.map((c: any) => c.tag ?? c.content)).toEqual([])
  })

  it('puts UDashboardNavbar under #header and CroutonActivityLog under #body', () => {
    const byName = (name: string) => panel.children.find((c: any) => slotName(c) === name)
    expect(findElement(byName('header') ?? {}, 'UDashboardNavbar')).toBeTruthy()
    expect(findElement(byName('body') ?? {}, 'CroutonActivityLog')).toBeTruthy()
  })
})
