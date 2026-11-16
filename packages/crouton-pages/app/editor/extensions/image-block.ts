/**
 * Image Block TipTap Extension
 *
 * Custom node for displaying standalone images in the block editor.
 * Supports paste/drop upload via /api/upload-image.
 * Renders using a Vue NodeView component.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { ImageBlockAttrs } from '../../types/blocks'
import { imageBlockDefinition } from '../../utils/block-registry'
import { generateBlockId, blockIdAttribute } from './block-utils'
import ImageBlockView from '../../components/Blocks/Views/ImageBlockView.vue'

export interface ImageBlockOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageBlock: {
      /**
       * Insert an image block
       */
      insertImageBlock: (attrs?: Partial<ImageBlockAttrs>) => ReturnType
      /**
       * Update image block attributes
       */
      updateImageBlock: (attrs: Partial<ImageBlockAttrs>) => ReturnType
    }
  }
}

const imageUploadPluginKey = new PluginKey('imageBlockUpload')

async function uploadImageFile(file: File): Promise<string | null> {
  try {
    const formData = new FormData()
    formData.append('file', file)
    const result = await globalThis.$fetch<{ pathname: string }>('/api/upload-image', {
      method: 'POST',
      body: formData
    })
    return `/images/${result.pathname}`
  }
  catch (err) {
    console.error('Image upload failed:', err)
    return null
  }
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

export const ImageBlock = Node.create<ImageBlockOptions>({
  name: 'imageBlock',

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
      src: {
        default: imageBlockDefinition.defaultAttrs.src
      },
      alt: {
        default: imageBlockDefinition.defaultAttrs.alt
      },
      caption: {
        default: imageBlockDefinition.defaultAttrs.caption
      },
      width: {
        default: imageBlockDefinition.defaultAttrs.width
      },
      frame: {
        default: true,
        parseHTML: el => el.getAttribute('data-frame') !== 'false',
        renderHTML: attrs => ({ 'data-frame': String(attrs.frame !== false) })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="image-block"]'
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes,
      { 'data-type': 'image-block' }
    )]
  },

  addCommands() {
    return {
      insertImageBlock: (attrs?: Partial<ImageBlockAttrs>) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: {
            blockId: generateBlockId(),
            ...imageBlockDefinition.defaultAttrs,
            ...attrs
          }
        })
      },
      updateImageBlock: (attrs: Partial<ImageBlockAttrs>) => ({ commands }) => {
        return commands.updateAttributes(this.name, attrs)
      }
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(ImageBlockView as any)
  },

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: imageUploadPluginKey,
        props: {
          handlePaste(_view, event) {
            const items = event.clipboardData?.items
            if (!items) return false

            const imageFiles: File[] = []
            for (const item of items) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile()
                if (file) imageFiles.push(file)
              }
            }

            if (imageFiles.length === 0) return false

            event.preventDefault()
            for (const file of imageFiles) {
              uploadImageFile(file).then((src) => {
                if (src) {
                  editor.chain().focus().insertImageBlock({ src, alt: file.name }).run()
                }
              })
            }
            return true
          },

          handleDrop(_view, event) {
            const files = event.dataTransfer?.files
            if (!files || files.length === 0) return false

            const imageFiles = Array.from(files).filter(isImageFile)
            if (imageFiles.length === 0) return false

            event.preventDefault()
            for (const file of imageFiles) {
              uploadImageFile(file).then((src) => {
                if (src) {
                  editor.chain().focus().insertImageBlock({ src, alt: file.name }).run()
                }
              })
            }
            return true
          }
        }
      })
    ]
  }
})

export default ImageBlock
