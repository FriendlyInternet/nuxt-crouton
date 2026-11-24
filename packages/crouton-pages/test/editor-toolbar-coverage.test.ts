// @vitest-environment node
//
// The rule (#4437): every block kind the page editor's toolbar can insert
// renders on the public page as that block — never as "Unknown block type".
// This walks the editor's REAL toolbar list, so a new toolbar button without
// a public renderer fails here.
import { describe, it, expect } from 'vitest'
import { blockTypesGroup } from '@fyit/crouton-editor/app/utils/toolbarPresets'
import { PUBLIC_NATIVE_BLOCK_TYPES, blockHtmlRenderers, blockToHtml } from '../app/utils/block-html'

type ToolbarNode = { kind?: string, items?: ToolbarNode[] }

function collectKinds(items: ToolbarNode[]): string[] {
  return items.flatMap(item => [item.kind ?? '', ...collectKinds(item.items ?? [])])
}

describe('editor toolbar block kinds all render publicly (#4437)', () => {
  // covers: T5
  it('every kind in blockTypesGroup has a public renderer', () => {
    const kinds = [...new Set(collectKinds(blockTypesGroup as ToolbarNode[]))].filter(Boolean)
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds).toEqual(expect.arrayContaining(['heading', 'blockquote', 'codeBlock', 'horizontalRule']))

    const missing = kinds.filter(k => !PUBLIC_NATIVE_BLOCK_TYPES.includes(k))
    expect(missing).toEqual([])

    for (const kind of kinds) {
      if (kind in blockHtmlRenderers) {
        expect(blockToHtml({ type: kind, content: [] }), kind).not.toBe('')
      }
    }
  })
})
