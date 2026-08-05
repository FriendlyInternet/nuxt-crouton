<script setup lang="ts">
/**
 * Sales Chart Block Editor View
 *
 * NodeView component for rendering the sales chart block inside the page
 * editor. Shows which chart + scope is configured and opens the block
 * property panel on edit.
 *
 * Uses explicit imports because VueNodeViewRenderer bypasses Nuxt's
 * auto-import machinery.
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { SALES_CHART_KINDS } from '../../utils/chart-blocks'
import { useBlockEditRequest } from '../../composables/useBlockEditRequest'

interface SalesChartBlockAttrs {
  chart?: string
  eventScope?: string
  chartTypeOverride?: string
  title?: string
  height?: number | string
}

const props = defineProps<{
  node: { attrs: SalesChartBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<SalesChartBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const attrs = computed(() => props.node.attrs)
const { t } = useI18n()

const kind = computed(() => (attrs.value.chart ? SALES_CHART_KINDS[attrs.value.chart] : undefined))
const scopeLabel = computed(() => (attrs.value.eventScope ? t('sales.block.scopedEvent') : t('sales.block.allEvents')))

const innerRef = ref<HTMLElement | null>(null)
const { openPanel } = useBlockEditRequest(innerRef)

function handleOpenPanel() {
  openPanel(props.node, props.getPos())
}
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="sales-chart-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-default transition-colors">
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-muted uppercase tracking-wider">
              <UIcon name="i-lucide-bar-chart-3" class="size-3" />
              {{ t('sales.block.salesChart') }}
            </span>
          </div>
          <!-- Action buttons -->
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
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

        <!-- Preview Content -->
        <div class="bg-muted/50 rounded-lg p-4 border border-default">
          <!-- Nothing picked -->
          <div
            v-if="!kind"
            class="flex items-center gap-2"
          >
            <UBadge color="warning" variant="subtle" class="gap-1">
              <UIcon name="i-lucide-triangle-alert" class="size-3.5" />
              {{ t('sales.block.noChartPicked') }}
            </UBadge>
          </div>

          <!-- Chart info -->
          <div v-else class="space-y-2">
            <h3 v-if="attrs.title" class="font-semibold text-highlighted">
              {{ attrs.title }}
            </h3>

            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
                <UIcon :name="kind.icon" class="size-3.5" />
                {{ kind.label }}
              </span>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-accented text-muted rounded text-xs">
                <UIcon name="i-lucide-calendar" class="size-3" />
                {{ scopeLabel }}
              </span>
              <span class="inline-flex items-center px-2 py-0.5 bg-accented text-muted rounded text-xs uppercase">
                {{ attrs.chartTypeOverride || kind.type }}
              </span>
            </div>

            <!-- Visual placeholder showing chart bars -->
            <div class="mt-3 flex items-end gap-1 h-12">
              <div class="flex-1 rounded-sm bg-primary/30" style="height: 60%" />
              <div class="flex-1 rounded-sm bg-primary/40" style="height: 85%" />
              <div class="flex-1 rounded-sm bg-primary/30" style="height: 45%" />
              <div class="flex-1 rounded-sm bg-primary/50" style="height: 100%" />
              <div class="flex-1 rounded-sm bg-primary/35" style="height: 70%" />
              <div class="flex-1 rounded-sm bg-primary/40" style="height: 55%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
