/**
 * Media + Text Block TipTap Extension
 *
 * A photo beside free-form content. Unlike the other page blocks this node is
 * NOT an atom: it holds child blocks (`content: 'block+'`), edited in place via
 * NodeViewContent, so the text keeps every formatting/block option of the page.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import type { MediaTextBlockAttrs } from '../../types/blocks'
import { mediaTextBlockDefinition } from '../../utils/block-registry'
import { generateBlockId, blockIdAttribute } from './block-utils'
import MediaTextBlockView from '../../components/Blocks/Views/MediaTextBlockView.vue'

interface MediaTextBlockOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaTextBlock: {
      insertMediaTextBlock: (attrs?: Partial<MediaTextBlockAttrs>) => ReturnType
      updateMediaTextBlock: (attrs: Partial<MediaTextBlockAttrs>) => ReturnType
    }
  }
}

/** Boolean attr that survives the HTML round trip ('false' strings) */
function booleanAttr(name: string, fallback: boolean) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(`data-${name}`)
      return v === null ? fallback : v !== 'false'
    },
    renderHTML: (attrs: Record<string, unknown>) => ({ [`data-${name}`]: String(attrs[name] !== false && attrs[name] !== 'false') })
  }
}

export const MediaTextBlock = Node.create<MediaTextBlockOptions>({
  name: 'mediaTextBlock',

  group: 'block',

  content: 'block+',

  draggable: true,

  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {}
    }
  },

  addAttributes() {
    return {
      ...blockIdAttribute,
      src: {
        default: mediaTextBlockDefinition.defaultAttrs.src,
        parseHTML: el => el.getAttribute('data-src') || '',
        renderHTML: attrs => ({ 'data-src': attrs.src || '' })
      },
      alt: {
        default: mediaTextBlockDefinition.defaultAttrs.alt,
        parseHTML: el => el.getAttribute('data-alt') || '',
        renderHTML: attrs => ({ 'data-alt': attrs.alt || '' })
      },
      side: {
        default: mediaTextBlockDefinition.defaultAttrs.side,
        parseHTML: el => (el.getAttribute('data-side') === 'right' ? 'right' : 'left'),
        renderHTML: attrs => ({ 'data-side': attrs.side === 'right' ? 'right' : 'left' })
      },
      sticky: booleanAttr('sticky', true),
      frame: booleanAttr('frame', true)
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="media-text-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes,
      { 'data-type': 'media-text-block' }
    ), 0]
  },

  addCommands() {
    return {
      insertMediaTextBlock: (attrs?: Partial<MediaTextBlockAttrs>) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: {
            blockId: generateBlockId(),
            ...mediaTextBlockDefinition.defaultAttrs,
            ...attrs
          },
          content: [{ type: 'paragraph' }]
        })
      },
      updateMediaTextBlock: (attrs: Partial<MediaTextBlockAttrs>) => ({ commands }) => {
        return commands.updateAttributes(this.name, attrs)
      }
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(MediaTextBlockView as any)
  }
})

