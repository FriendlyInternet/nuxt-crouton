/**
 * Block Editor Utilities
 *
 * Shared utilities for block extensions.
 */

/**
 * Generate a unique block ID
 * Uses a timestamp prefix + random suffix for uniqueness
 */
export function generateBlockId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `block-${timestamp}-${random}`
}

/**
 * Block ID attribute definition for TipTap extensions
 * Add this to addAttributes() in each block extension
 */
export const blockIdAttribute = {
  blockId: {
    default: null,
    parseHTML: (element: Element) => element.getAttribute('data-block-id'),
    renderHTML: (attributes: { blockId?: string }) => {
      if (!attributes.blockId) return {}
      return { 'data-block-id': attributes.blockId }
    }
  }
}

/**
 * Block size attribute definition for TipTap extensions.
 * Controls the wrapper width when the block is rendered on the public page.
 */
export const blockSizeAttribute = {
  blockSize: {
    default: 'default',
    parseHTML: (element: Element) => element.getAttribute('data-block-size') || 'default',
    renderHTML: (attributes: { blockSize?: string }) => {
      if (!attributes.blockSize || attributes.blockSize === 'default') return {}
      return { 'data-block-size': attributes.blockSize }
    }
  }
}

/**
 * Block visibility attribute definition for TipTap extensions.
 * Holds the per-block display conditions (audience, roles, viewports) applied
 * when the block is rendered on the public page — see `app/utils/block-visibility.ts`.
 *
 * Defaults to null and serializes only when set, so a block that was never
 * configured adds nothing to the stored document.
 */
export const blockVisibilityAttribute = {
  blockVisibility: {
    default: null,
    parseHTML: (element: Element) => {
      const raw = element.getAttribute('data-block-visibility')
      if (!raw) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    },
    renderHTML: (attributes: { blockVisibility?: unknown }) => {
      const value = attributes.blockVisibility
      if (!value || typeof value !== 'object') return {}
      // An empty object carries no restriction — keep it out of the markup.
      if (Object.keys(value as Record<string, unknown>).length === 0) return {}
      return { 'data-block-visibility': JSON.stringify(value) }
    }
  }
}
