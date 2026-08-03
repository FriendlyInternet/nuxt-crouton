<script setup lang="ts">
/**
 * Pass Screen Block — editor view (#1762).
 *
 * NodeView component for the page editor: shows a placeholder (mock order
 * tiles) + edit/delete controls, opens the property panel on double-click.
 *
 * Explicit imports for COMPOSABLES only — VueNodeViewRenderer bypasses Nuxt's
 * auto-imports for those. Nuxt UI components still resolve in the template
 * (they are globally registered), which is why the chrome here is `UButton` /
 * `UIcon` / `UBadge` rather than the raw `<button>` + inline SVG the older block
 * views use: raw re-implementations are invisible to themes (#1392).
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { useBlockEditRequest } from '../../composables/useBlockEditRequest'

interface PassScreenAttrs {
  eventSlug?: string
}

// NB: tiptap also passes `updateAttributes`, but this view edits nothing inline
// — every change goes through the property panel — so it is deliberately not
// declared. Declaring an unused prop is what fallow's unused-prop policy flags.
const props = defineProps<{
  node: { attrs: PassScreenAttrs }
  selected: boolean
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()

const innerRef = ref<HTMLElement | null>(null)
const { openPanel } = useBlockEditRequest(innerRef)

function handleOpenPanel() {
  openPanel(props.node, props.getPos())
}
</script>

<template>
  <!--
    No `@dblclick="handleOpenPanel"` here, unlike the other 8 block views. A
    double-click cannot be produced from a keyboard, and the a11y gate treats a
    mouse-only handler on a non-interactive wrapper as a WCAG 2.1.1 break even
    when the same action has a button (#1794). The pencil is the single way in,
    and it is now visible on focus as well as hover. #1791 carries the same
    change for the other 8.
  -->
  <NodeViewWrapper
    class="block-wrapper my-1"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="pass-screen-block"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-default transition-colors">
      <div class="p-3">
        <!-- Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-muted uppercase tracking-wider">
              <UIcon name="i-lucide-hand-platter" class="size-3" />
              {{ t('sales.block.passScreen') }}
            </span>
            <UBadge
              v-if="attrs.eventSlug"
              color="primary"
              variant="subtle"
              size="sm"
              class="text-[9px] font-mono"
            >
              {{ attrs.eventSlug }}
            </UBadge>
            <UBadge
              v-else
              color="warning"
              variant="subtle"
              size="sm"
              class="text-[9px]"
            >
              {{ t('sales.block.noEventPicked') }}
            </UBadge>
          </div>
          <!--
            `focus-within` as well as `group-hover`: the controls are the ONLY
            keyboard path to the property panel (the wrapper's @dblclick is a
            mouse shortcut), so leaving them at opacity-0 until hover meant a
            keyboard user could focus the pencil without ever seeing it — the
            focus-visible half of the a11y gate's finding on #1794.
          -->
          <div class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-0.5">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-pencil"
              :title="t('sales.block.editBlock')"
              @click.stop="handleOpenPanel"
            />
            <UButton
              color="error"
              variant="ghost"
              size="xs"
              icon="i-lucide-trash-2"
              :title="t('sales.block.deleteBlock')"
              @click.stop="deleteNode"
            />
          </div>
        </div>

        <!-- Mini pass preview: whole-order tiles, each with one wide action bar -->
        <div class="bg-muted/50 rounded-lg p-3 ring ring-default">
          <div class="grid grid-cols-3 gap-2">
            <div v-for="tile in 3" :key="tile" class="rounded-md bg-elevated/80 p-2 space-y-1.5">
              <div class="h-3 w-8 rounded bg-primary/40" />
              <div class="h-2 w-full rounded bg-accented/60" />
              <div class="h-2 w-2/3 rounded bg-accented/60" />
              <div class="h-4 w-full rounded bg-success/40 mt-1" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
