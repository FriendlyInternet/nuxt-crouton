<template>
  <div :class="containerClass">
    <!-- Inline preview (compact) -->
    <div
      v-if="mode === 'inline'"
      class="flex justify-between items-center border border-default rounded-md p-2 gap-2"
    >
      <div
        class="bg-muted/50 h-10 overflow-hidden prose prose-sm flex-1 text-[4px] rounded"
        v-html="renderedContent"
      />
      <UModal :title="title || 'Content preview'">
        <UButton
          icon="i-lucide-eye"
          size="xs"
          color="neutral"
          variant="ghost"
        />
        <template #body>
          <div
            class="prose prose-sm max-w-none dark:prose-invert"
            v-html="renderedContent"
          />
        </template>
      </UModal>
    </div>

    <!-- Thumbnail preview (zoomed-out webpage) -->
    <div
      v-else-if="mode === 'thumbnail'"
      class="relative border border-default rounded-lg overflow-hidden bg-default cursor-pointer group"
      :style="{ width: thumbnailWidth + 'px', height: thumbnailHeight + 'px' }"
    >
      <div
        class="absolute top-0 left-0 origin-top-left prose prose-sm max-w-none dark:prose-invert p-4"
        :style="{ width: thumbnailInnerWidth + 'px', transform: `scale(${thumbnailScale})` }"
        v-html="renderedContent"
      />
      <div class="absolute inset-0 bg-transparent group-hover:bg-black/5 dark:group-hover:bg-white/5 transition-colors" />
      <UModal v-if="expandable" :title="title || 'Content preview'">
        <div class="absolute inset-0 cursor-pointer" />
        <template #body>
          <div
            class="prose prose-sm max-w-none dark:prose-invert"
            v-html="renderedContent"
          />
        </template>
      </UModal>
    </div>

    <!-- Panel preview (full) -->
    <div
      v-else
      class="border border-default rounded-lg overflow-hidden"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-default">
        <span class="text-sm font-medium text-muted">{{ title || 'Preview' }}</span>
        <div class="flex items-center gap-2">
          <!-- Variable indicators -->
          <div v-if="showVariableCount && variableCount > 0" class="flex items-center gap-1 text-xs text-muted">
            <UIcon name="i-lucide-braces" class="size-3" />
            <span>{{ variableCount }} variable{{ variableCount !== 1 ? 's' : '' }}</span>
          </div>
          <!-- Expand button -->
          <UModal v-if="expandable" :title="title || 'Preview'">
            <UButton
              icon="i-lucide-maximize-2"
              size="xs"
              color="neutral"
              variant="ghost"
            />
            <template #body>
              <div
                class="prose prose-sm max-w-none dark:prose-invert"
                v-html="renderedContent"
              />
            </template>
          </UModal>
        </div>
      </div>

      <!-- Content -->
      <div
        class="p-4 prose prose-sm max-w-none dark:prose-invert overflow-auto"
        :class="contentClass"
        v-html="renderedContent"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeHtml } from '../utils/sanitize-html'
import type { EditorVariable } from '../types/editor'

// Render TipTap JSON document to simple HTML for preview
function renderTipTapToHtml(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node

  // Text node — apply marks
  if (node.type === 'text') {
    let html = escapeHtml(node.text || '')
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'bold') html = `<strong>${html}</strong>`
        else if (mark.type === 'italic') html = `<em>${html}</em>`
        else if (mark.type === 'link') html = `<a href="${escapeHtml(mark.attrs?.href || '#')}">${html}</a>`
        else if (mark.type === 'underline') html = `<u>${html}</u>`
        else if (mark.type === 'strike') html = `<s>${html}</s>`
        else if (mark.type === 'code') html = `<code>${html}</code>`
      }
    }
    return html
  }

  // Block nodes
  if (node.type === 'imageBlock' || node.type === 'image') {
    const src = node.attrs?.src || ''
    const alt = escapeHtml(node.attrs?.alt || '')
    const caption = node.attrs?.caption
    let html = `<img src="${escapeHtml(src)}" alt="${alt}" />`
    if (caption) html += `<p>${escapeHtml(caption)}</p>`
    return html
  }
  if (node.type === 'embedBlock') {
    // Shown as a plain link: the shared cleaner drops <iframe>, and the
    // pages embed node stores its address in `url` (older docs used `src`).
    const url = node.attrs?.url ?? node.attrs?.src ?? ''
    return url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` : ''
  }
  if (node.type === 'hardBreak') return '<br>'

  // Recurse into children
  const children = Array.isArray(node.content) ? node.content.map(renderTipTapToHtml).join('') : ''

  // Wrap in appropriate HTML tags
  switch (node.type) {
    case 'paragraph': return `<p>${children || '&nbsp;'}</p>`
    case 'heading': return `<h${node.attrs?.level || 2}>${children}</h${node.attrs?.level || 2}>`
    case 'blockquote': return `<blockquote>${children}</blockquote>`
    case 'bulletList': return `<ul>${children}</ul>`
    case 'orderedList': return `<ol>${children}</ol>`
    case 'listItem': return `<li>${children}</li>`
    case 'codeBlock': return `<pre><code>${children}</code></pre>`
    case 'horizontalRule': return '<hr>'
    case 'doc': return children
    default: return children
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Detect if content is TipTap JSON (object or JSON string with {"type":"doc"})
function parseTipTapJson(content: string | Record<string, any>): Record<string, any> | null {
  if (typeof content === 'object' && content?.type === 'doc') return content
  if (typeof content === 'string' && content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content)
      if (parsed?.type === 'doc') return parsed
    } catch { /* not JSON */ }
  }
  return null
}

interface Props {
  /** Raw content with {{variables}} — accepts HTML string or TipTap JSON */
  content?: string | Record<string, any>
  /** Title for the preview panel/modal */
  title?: string
  /** Values for variable interpolation */
  values?: Record<string, string>
  /** Variable definitions (for getting sample values) */
  variables?: EditorVariable[]
  /** Display mode: inline (compact), panel (full), or thumbnail (zoomed-out webpage) */
  mode?: 'inline' | 'panel' | 'thumbnail'
  /** Thumbnail scale factor (default 0.25 = 25%) */
  thumbnailScale?: number
  /** Thumbnail container width in px (default 280) */
  thumbnailWidth?: number
  /** Thumbnail container height in px (default 180) */
  thumbnailHeight?: number
  /** Allow expanding to modal */
  expandable?: boolean
  /** Show variable count in header */
  showVariableCount?: boolean
  /** Custom container class */
  containerClass?: string
  /** Custom content area class */
  contentClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'panel',
  expandable: true,
  showVariableCount: true,
  thumbnailScale: 0.25,
  thumbnailWidth: 280,
  thumbnailHeight: 180
})

/**
 * Computed inner width for thumbnail mode (inverse of scale to fill container)
 */
const thumbnailInnerWidth = computed(() => props.thumbnailWidth / props.thumbnailScale)

/**
 * Variable utilities (interpolation, extraction, sample values)
 */
const { getSampleValues, interpolate, extractVariables } = useEditorVariables()
const sampleValues = computed(() => {
  if (!props.variables?.length) return {}
  return getSampleValues(props.variables)
})

/**
 * Merge provided values with sample values
 */
const mergedValues = computed(() => ({
  ...sampleValues.value,
  ...props.values
}))

/**
 * Decode HTML entities in content for processing
 * TipTap sometimes encodes {{ as &#123;&#123; or &lbrace;&lbrace;
 */
function decodeEntities(content: string): string {
  return content
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&lbrace;/g, '{')
    .replace(/&rbrace;/g, '}')
}

/**
 * Render undefined variables as a styled warning placeholder.
 */
const undefinedVarPlaceholder = (match: string) =>
  `<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-warning/20 text-warning text-xs font-mono">${match}</span>`

/**
 * Interpolate variables in content
 */
const renderedContent = computed(() => {
  if (!props.content) return ''

  // Handle TipTap JSON content — render to HTML preserving images/embeds
  const tiptapDoc = parseTipTapJson(props.content)
  if (tiptapDoc) {
    return sanitizeHtml(renderTipTapToHtml(tiptapDoc))
  }

  // Decode brace entities, clean the author's HTML, THEN interpolate: the
  // values are escaped and the warning chip is added after cleaning, so it
  // keeps its classes while no value can inject markup.
  const decoded = decodeEntities(props.content as string)
  const clean = sanitizeHtml(decoded)
  const escaped = Object.fromEntries(
    Object.entries(mergedValues.value).map(([k, v]) => [k, escapeHtml(String(v ?? ''))])
  )
  let result = interpolate(clean, escaped, undefinedVarPlaceholder)

  // If content doesn't have block-level HTML tags, convert line breaks to <br>
  // This handles plain text content or content with only inline formatting
  const hasBlockTags = /<(p|div|h[1-6]|ul|ol|li|blockquote|pre|table|hr)[>\s]/i.test(result)
  if (!hasBlockTags) {
    result = result.replace(/\n/g, '<br>')
  }

  return result
})

/**
 * Count unique variables in content
 */
const variableCount = computed(() => {
  if (!props.content || typeof props.content !== 'string') return 0
  return extractVariables(decodeEntities(props.content)).length
})
</script>

<style scoped>
/* Ensure prose styles work in dark mode */
:deep(.prose) {
  --tw-prose-body: var(--ui-text-default);
  --tw-prose-headings: var(--ui-text-highlighted);
  --tw-prose-links: var(--ui-primary);
}

/* Ensure paragraphs have proper spacing */
:deep(.prose p) {
  margin-top: 1em;
  margin-bottom: 1em;
}

:deep(.prose p:first-child) {
  margin-top: 0;
}

:deep(.prose p:last-child) {
  margin-bottom: 0;
}

/* Empty paragraphs (line breaks) should still take space */
:deep(.prose p:empty) {
  min-height: 1em;
}
</style>
