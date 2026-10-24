/**
 * Addon Block Factory
 *
 * Creates TipTap Node extensions dynamically from CroutonBlockDefinition.
 * Addon packages (crouton-charts, crouton-maps) register block definitions
 * in app.config.ts, and this factory converts them to TipTap extensions.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import type { CroutonBlockDefinition, CroutonBlockTipTapAttribute } from '@fyit/crouton-core/app/types/block-definition'
import { generateBlockId, blockIdAttribute, blockSizeAttribute, blockVisibilityAttribute } from './block-utils'
import AddonBlockView from '../../components/Blocks/Views/AddonBlockView.vue'

/**
 * Convert a PascalCase or camelCase type name to a command name.
 * e.g. 'chartBlock' → 'ChartBlock'
 */
function pascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Build TipTap attribute config from declarative definition.
 */
function buildAttributes(attrs: Record<string, CroutonBlockTipTapAttribute>) {
  const result: Record<string, any> = { ...blockIdAttribute, ...blockSizeAttribute, ...blockVisibilityAttribute }

  for (const [name, config] of Object.entries(attrs)) {
    const attrDef: any = {
      default: config.default
    }

    if (config.htmlAttr) {
      const htmlAttrName = config.htmlAttr
      const parseType = config.parseType

      attrDef.parseHTML = (element: Element) => {
        const raw = element.getAttribute(htmlAttrName)
        if (raw === null) return config.default
        if (parseType === 'int') return parseInt(raw, 10) || config.default
        if (parseType === 'float') return parseFloat(raw) || config.default
        if (parseType === 'boolean') return raw === 'true'
        return raw
      }

      attrDef.renderHTML = (attributes: Record<string, any>) => {
        return { [htmlAttrName]: String(attributes[name] ?? config.default ?? '') }
      }
    }

    result[name] = attrDef
  }

  return result
}

/**
 * Create a TipTap Node extension from a CroutonBlockDefinition.
 */
export function createAddonBlockExtension(def: CroutonBlockDefinition): Node {
  const insertCmd = `insert${pascalCase(def.type)}`
  const updateCmd = `update${pascalCase(def.type)}`

  return Node.create({
    name: def.type,

    group: 'block',

    atom: true,

    draggable: true,

    addStorage() {
      return { blockDefinition: def }
    },

    addAttributes() {
      return buildAttributes(def.tiptap.attributes)
    },

    parseHTML() {
      return [{ tag: def.tiptap.parseHTMLTag }]
    },

    renderHTML({ HTMLAttributes }) {
      // Extract data-type from parseHTMLTag selector (e.g. 'div[data-type="chart-block"]' → 'chart-block')
      const match = def.tiptap.parseHTMLTag.match(/data-type="([^"]+)"/)
      const dataType = match ? match[1] : def.type

      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': dataType })]
    },

    addCommands() {
      return {
        [insertCmd]: (attrs?: Record<string, unknown>) => ({ commands }: any) => {
          return commands.insertContent({
            type: def.type,
            attrs: {
              blockId: generateBlockId(),
              ...def.defaultAttrs,
              ...attrs
            }
          })
        },
        [updateCmd]: (attrs: Record<string, unknown>) => ({ commands }: any) => {
          return commands.updateAttributes(def.type, attrs)
        }
      } as any
    },

    addNodeView() {
      return VueNodeViewRenderer(AddonBlockView as any)
    }
  })
}
