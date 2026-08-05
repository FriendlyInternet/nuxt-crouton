<script setup lang="ts">
/**
 * Block Content Renderer
 *
 * Renders page content that is stored in block format (JSON).
 * Routes each block type to its appropriate render component.
 */
import type { PageBlockContent, PageBlock, BlockSize, BlockAudienceContext, BlockAudienceRole } from '../types/blocks'
import { parseBlockContent } from '../utils/content-detector'
import { hasAudienceGate, matchesAudience, viewportClasses } from '../utils/block-visibility'

// Addon blocks from croutonBlocks registry
const { getBlock: getAddonBlock } = useCroutonBlocks()

/**
 * Minimal XSS sanitizer — strips <script> tags and on* event handler attributes.
 * SSR-safe: returns the original string unchanged when running server-side.
 */
function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return html
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('script').forEach(el => el.remove())
  div.querySelectorAll('*').forEach(el => {
    ;[...el.attributes].forEach(attr => {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name)
    })
  })
  return div.innerHTML
}

interface Props {
  /** Raw JSON content string or parsed PageBlockContent */
  content: string | PageBlockContent | null | undefined
  /**
   * Render every block regardless of its `blockVisibility`.
   * Used by the editor previews, where an author must always see the block
   * they are configuring — even one they have just hidden from themselves.
   */
  ignoreVisibility?: boolean
}

const props = defineProps<Props>()

// Parse content if string
const blocks = computed<PageBlock[]>(() => {
  if (!props.content) return []

  if (typeof props.content === 'string') {
    const parsed = parseBlockContent(props.content)
    return parsed?.content || []
  }

  // Already parsed
  return props.content.content || []
})

// Component mapping for core blocks
const blockComponents: Record<string, string> = {
  heroBlock: 'CroutonPagesBlocksRenderHeroBlock',
  sectionBlock: 'CroutonPagesBlocksRenderSectionBlock',
  ctaBlock: 'CroutonPagesBlocksRenderCTABlock',
  cardGridBlock: 'CroutonPagesBlocksRenderCardGridBlock',
  separatorBlock: 'CroutonPagesBlocksRenderSeparatorBlock',
  richTextBlock: 'CroutonPagesBlocksRenderRichTextBlock',
  collectionBlock: 'CroutonPagesBlocksRenderCollectionBlock',
  faqBlock: 'CroutonPagesBlocksRenderFaqBlock',
  twoColumnBlock: 'CroutonPagesBlocksRenderTwoColumnBlock',
  embedBlock: 'CroutonPagesBlocksRenderEmbedBlock',
  imageBlock: 'CroutonPagesBlocksRenderImageBlock',
  logoBlock: 'CroutonPagesBlocksRenderLogoBlock',
  videoBlock: 'CroutonPagesBlocksRenderVideoBlock',
  fileBlock: 'CroutonPagesBlocksRenderFileBlock',
  buttonRowBlock: 'CroutonPagesBlocksRenderButtonRowBlock',
  statsBlock: 'CroutonPagesBlocksRenderStatsBlock',
  galleryBlock: 'CroutonPagesBlocksRenderGalleryBlock',
  contactBlock: 'CroutonPagesBlocksRenderContactBlock',
  mailingBlock: 'CroutonPagesBlocksRenderMailingBlock',
  qrCodeBlock: 'CroutonPagesBlocksRenderQrCodeBlock',
  // Bridge block (#716): hosts a pane LayoutTree inside the document flow,
  // delegating to crouton-core's CroutonLayoutRenderer.
  paneBlock: 'CroutonPagesBlocksRenderPaneBlock'
}

// Get component name for a block type — checks core blocks then addon blocks
function getBlockComponent(type: string): string | null {
  if (blockComponents[type]) return blockComponents[type]
  // Fall back to addon block renderer
  const addonDef = getAddonBlock(type)
  return addonDef?.components?.renderer || null
}

// Resolve the `Lazy`-prefixed variant so each block renderer is a code-split
// chunk, loaded only when a page actually contains that block type. Without
// this, resolving renderers by dynamic string name pulls *every* registered
// block renderer (charts, gallery, video, 3D, …) into the initial bundle.
// SSR markup is preserved — Nuxt resolves async components server-side — so
// this defers JS/hydration without affecting first paint.
function getLazyBlockComponent(type: string): string | null {
  const name = getBlockComponent(type)
  return name ? `Lazy${name}` : null
}

// Check if a block requires client-only rendering
function isClientOnlyBlock(type: string): boolean {
  // Core blocks that need ClientOnly
  if (type === 'collectionBlock' || type === 'embedBlock') return true
  // Addon blocks with clientOnly flag
  const addonDef = getAddonBlock(type)
  return addonDef?.clientOnly === true
}

/**
 * Check if a block is an empty paragraph (no text content)
 * TipTap creates empty paragraphs as structural elements - we skip those
 * But paragraphs with text content should be rendered
 */
function isEmptyParagraph(block: PageBlock): boolean {
  if (block.type !== 'paragraph') return false
  // Check if paragraph has any text content
  const content = (block as any).content
  if (!content || !Array.isArray(content) || content.length === 0) {
    return true
  }
  // Check if content has any text
  return !content.some((node: any) => node.type === 'text' && node.text?.trim())
}

/**
 * Convert paragraph block to HTML for rendering
 */
function paragraphToHtml(block: PageBlock): string {
  return sanitizeHtml(inlineContentToHtml((block as any).content))
}

// Filter blocks to render (skip only truly empty structural blocks)
const renderableBlocks = computed(() => {
  return blocks.value.filter(block => !isEmptyParagraph(block))
})

// Check if block is a paragraph (for special rendering)
function isParagraph(type: string): boolean {
  return type === 'paragraph'
}

// Check if block is a heading (native TipTap node)
function isHeading(type: string): boolean {
  return type === 'heading'
}

// Check if block is a list (native TipTap node)
function isList(type: string): boolean {
  return type === 'bulletList' || type === 'orderedList'
}

/**
 * Convert inline content (text nodes with marks) to HTML.
 * Shared by paragraph, heading, and list item renderers.
 */
function inlineContentToHtml(content: any[]): string {
  if (!content || !Array.isArray(content)) return ''

  return content.map((node: any) => {
    if (node.type === 'hardBreak') return '<br>'
    if (node.type === 'text') {
      let text = node.text || ''
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === 'bold') text = `<strong>${text}</strong>`
          else if (mark.type === 'italic') text = `<em>${text}</em>`
          else if (mark.type === 'underline') text = `<u>${text}</u>`
          else if (mark.type === 'strike') text = `<s>${text}</s>`
          else if (mark.type === 'code') text = `<code>${text}</code>`
          else if (mark.type === 'highlight') text = `<mark>${text}</mark>`
          else if (mark.type === 'link' && mark.attrs?.href) {
            text = `<a href="${mark.attrs.href}"${mark.attrs.target ? ` target="${mark.attrs.target}"` : ''}>${text}</a>`
          }
        }
      }
      return text
    }
    return ''
  }).join('')
}

/**
 * Convert a list block (bulletList/orderedList) to HTML.
 * Handles nested listItem > paragraph structure from TipTap.
 */
function listToHtml(block: PageBlock): string {
  const tag = block.type === 'orderedList' ? 'ol' : 'ul'
  const content = (block as any).content
  if (!content || !Array.isArray(content)) return `<${tag}></${tag}>`

  const items = content.map((listItem: any) => {
    if (listItem.type !== 'listItem' || !listItem.content) return '<li></li>'

    // Each listItem can contain paragraphs (and nested lists)
    const innerHtml = listItem.content.map((child: any) => {
      if (child.type === 'paragraph') {
        return inlineContentToHtml(child.content)
      }
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        return listToHtml(child as PageBlock)
      }
      return ''
    }).join('')

    return `<li>${innerHtml}</li>`
  }).join('')

  return sanitizeHtml(`<${tag}>${items}</${tag}>`)
}

/**
 * Convert heading block to HTML for rendering
 */
function headingToHtml(block: PageBlock): string {
  return sanitizeHtml(inlineContentToHtml((block as any).content))
}

/**
 * Get the heading level (1-6) from block attrs, defaulting to 2
 */
function getHeadingLevel(block: PageBlock): number {
  const level = (block as any).attrs?.level
  return typeof level === 'number' && level >= 1 && level <= 6 ? level : 2
}

/** Get CSS class for a block's size setting */
function getBlockSizeClass(block: PageBlock): string | undefined {
  const size = (block.attrs as any)?.blockSize as BlockSize | undefined
  if (!size || size === 'default') return undefined
  if (size === 'narrow') return 'block-size-narrow'
  if (size === 'wide') return 'block-size-wide'
  if (size === 'full') return 'block-size-full'
  return undefined
}

// ---------------------------------------------------------------------------
// Block visibility
//
// The public page route is `swr: 3600` cached, so its HTML is shared between
// visitors. Auth state must therefore never be read while rendering on the
// server, or one visitor's session gets baked into the page everyone receives.
//
// So the two axes resolve differently:
//   - viewport → CSS classes, which resolve per-device in the browser
//   - audience/roles → after hydration only (see `audienceResolved`)
// ---------------------------------------------------------------------------

/**
 * False during SSR *and* the first client render — so both agree and hydration
 * matches — then true once mounted, when the session is safe to read.
 */
const audienceResolved = ref(false)
onMounted(() => { audienceResolved.value = true })

/**
 * Auth sources, resolved once in setup — composables must not be called from a
 * computed getter. Read defensively: crouton-auth is not a dependency of this
 * package and may not be installed, in which case these stay null and the
 * matcher treats the reader as unknowable (and shows the block).
 */
// Held as plain variables, not refs: they are bound once here and never
// reassigned, and the computed below still tracks reads of their `.value`.
// Typed structurally so any Ref/ComputedRef shape fits without importing
// anything from crouton-auth.
let sessionUser: { value: unknown } | null = null
let teamRole: { value: unknown } | null = null

try {
  sessionUser = useSession().user
} catch {
  // crouton-auth not installed.
}

try {
  teamRole = useTeam().currentRole
} catch {
  // No team context (or no auth package).
}

const audienceContext = computed<BlockAudienceContext>(() => {
  // Before hydration the session must not be read at all: this component's
  // markup is cached and shared between visitors.
  if (!audienceResolved.value) return { authenticated: null, role: null }

  const authenticated = sessionUser ? !!sessionUser.value : null

  const current = teamRole?.value
  const role: BlockAudienceRole | null
    = current === 'owner' || current === 'admin' || current === 'member' ? current : null

  return { authenticated, role }
})

/** The raw `blockVisibility` attr, if the block carries one. */
function getBlockVisibility(block: PageBlock): unknown {
  return (block.attrs as any)?.blockVisibility
}

/**
 * Whether to render this block at all.
 *
 * A block with no audience gate returns true immediately and takes no new
 * code path — identical to the behaviour before per-block visibility existed.
 * A gated block stays out of the cached SSR markup and appears on hydration.
 */
function shouldRenderBlock(block: PageBlock): boolean {
  if (props.ignoreVisibility) return true
  const visibility = getBlockVisibility(block)
  if (!hasAudienceGate(visibility)) return true
  return audienceResolved.value && matchesAudience(visibility, audienceContext.value)
}

/** Wrapper classes for a block: its size, plus any viewport restrictions. */
function getBlockWrapperClasses(block: PageBlock): (string | undefined)[] {
  const size = getBlockSizeClass(block)
  if (props.ignoreVisibility) return [size]
  return [size, ...viewportClasses(getBlockVisibility(block))]
}

/** Tailwind classes per heading level */
const headingClasses: Record<number, string> = {
  1: 'text-4xl font-bold tracking-tight text-[var(--ui-text-highlighted)] mt-8 mb-4',
  2: 'text-3xl font-bold tracking-tight text-[var(--ui-text-highlighted)] mt-8 mb-3',
  3: 'text-2xl font-semibold text-[var(--ui-text-highlighted)] mt-6 mb-3',
  4: 'text-xl font-semibold text-[var(--ui-text-highlighted)] mt-6 mb-2',
  5: 'text-lg font-medium text-[var(--ui-text-highlighted)] mt-4 mb-2',
  6: 'text-base font-medium text-[var(--ui-text-muted)] mt-4 mb-2'
}
</script>

<template>
  <div class="block-content flex flex-col gap-12">

    <template v-if="renderableBlocks.length > 0">
      <template v-for="(block, index) in renderableBlocks" :key="(block as any).attrs?.blockId || `${block.type}-${index}`">
        <div v-if="shouldRenderBlock(block)" :class="getBlockWrapperClasses(block)">
          <!-- Dynamic blocks: fetch runtime data, must render client-side only -->
          <ClientOnly
            v-if="isClientOnlyBlock(block.type)"
          >
            <component
              :is="getLazyBlockComponent(block.type)"
              :attrs="block.attrs"
              :is-first="index === 0"
            />
            <template #fallback>
              <div class="animate-pulse rounded-xl bg-muted h-40" />
            </template>
          </ClientOnly>

          <!-- Static blocks: SSR/prerender safe; renderer chunk is code-split
               (Lazy) but resolved server-side so SSR markup is preserved -->
          <component
            v-else-if="getBlockComponent(block.type)"
            :is="getLazyBlockComponent(block.type)"
            :attrs="block.attrs"
            :is-first="index === 0"
          />

          <!-- Native TipTap image node fallback (legacy content) -->
          <figure
            v-else-if="block.type === 'image'"
          >
            <img
              :src="(block as any).attrs?.src"
              :alt="(block as any).attrs?.alt || ''"
              class="rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 max-w-full mx-auto"
            >
          </figure>

          <!-- Heading blocks (native TipTap heading nodes) -->
          <component
            v-else-if="isHeading(block.type)"
            :is="`h${getHeadingLevel(block)}`"
            :class="headingClasses[getHeadingLevel(block)]"
            v-html="headingToHtml(block)"
          />

          <!-- Paragraph blocks (rendered as prose) -->
          <p
            v-else-if="isParagraph(block.type)"
            class="prose prose-lg dark:prose-invert max-w-none"
            v-html="paragraphToHtml(block)"
          />

          <!-- List blocks (native TipTap bulletList/orderedList) -->
          <div
            v-else-if="isList(block.type)"
            class="block-content-list prose prose-lg dark:prose-invert max-w-none"
            v-html="listToHtml(block)"
          />

          <!-- Unknown block type warning -->
          <div
            v-else
            class="p-4 bg-warning/10 text-warning rounded-lg"
          >
            Unknown block type: {{ block.type }}
          </div>
        </div>
      </template>
    </template>

    <!-- Empty state -->
    <div
      v-else
      class="text-center py-12 text-muted"
    >
      <UIcon name="i-lucide-file-text" class="size-12 mb-4 mx-auto" />
      <p>{{ $t('pages.noContent') }}</p>
    </div>
  </div>
</template>

<style scoped>
/* Gap is handled by flex gap-12 on the container */

/* Default block constraint — comfortable content width */
.block-content > * {
  width: 100%;
  max-width: 64rem;
  margin-left: auto;
  margin-right: auto;
}

/* Block size presets */
.block-content > .block-size-narrow {
  max-width: 48rem;
}

.block-content > .block-size-wide {
  max-width: 80rem;
}

.block-content > .block-size-full {
  max-width: none;
}

/* List rendering — ensure bullets/numbers and proper spacing */
.block-content-list :deep(ul) {
  list-style-type: disc;
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.block-content-list :deep(ol) {
  list-style-type: decimal;
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.block-content-list :deep(li) {
  margin: 0.25em 0;
  padding-left: 0.25em;
}

.block-content-list :deep(li ul),
.block-content-list :deep(li ol) {
  margin: 0.25em 0;
}

/* Highlight mark — themed with Nuxt UI primary color */
.block-content :deep(mark) {
  background-color: color-mix(in srgb, var(--ui-primary) 15%, transparent);
  color: inherit;
  padding: 0.05em 0.3em;
  border-radius: 0.25em;
  border-bottom: 2px solid color-mix(in srgb, var(--ui-primary) 40%, transparent);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
</style>
