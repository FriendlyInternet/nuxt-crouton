/**
 * Rich Text Block TipTap Extension
 *
 * Holds a ready-made chunk of HTML (`content`). The public site renders it via
 * `Blocks/Render/RichTextBlock.vue`; this node exists so the editor can OPEN
 * and SAVE pages that contain one without dropping it (#4436). Without it,
 * TipTap rejects the whole document ("Unknown node type") and shows a blank page.
 *
 * Read-only in the editor and deliberately not offered in the insert menus —
 * normal typing already produces text. No insert command for that reason.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import type { RichTextBlockAttrs } from '../../types/blocks'
import { richTextBlockDefinition } from '../../utils/block-registry'
import { blockIdAttribute } from './block-utils'
import RichTextBlockView from '../../components/Blocks/Views/RichTextBlockView.vue'

export interface RichTextBlockOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    richTextBlock: {
      updateRichTextBlock: (attrs: Partial<RichTextBlockAttrs>) => ReturnType
    }
  }
}

export const RichTextBlock = Node.create<RichTextBlockOptions>({
  name: 'richTextBlock',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {}
    }
  },

  addAttributes() {
    return {
      ...blockIdAttribute,
      content: {
        default: richTextBlockDefinition.defaultAttrs.content,
        parseHTML: (element: Element) =>
          element.getAttribute('data-content') ?? richTextBlockDefinition.defaultAttrs.content,
        renderHTML: (attributes: { content?: string }) => ({ 'data-content': attributes.content })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="rich-text-block"]'
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes,
      { 'data-type': 'rich-text-block' }
    )]
  },

  addCommands() {
    return {
      updateRichTextBlock: (attrs: Partial<RichTextBlockAttrs>) => ({ commands }) => {
        return commands.updateAttributes(this.name, attrs)
      }
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(RichTextBlockView as any)
  }
})

export default RichTextBlock
