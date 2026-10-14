<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

interface Props {
  data: {
    title: string
    properties: Record<string, unknown>
    url: string
    grouped: boolean
  }
  selected: boolean
}

const props = defineProps<Props>()

const statusValue = computed(() => {
  const p = props.data.properties
  return (p.Status || p.status) as string | null
})

const tagsValue = computed(() => {
  const p = props.data.properties
  const tags = (p.Tags || p.tags || p.Labels || p.labels) as string[] | null
  return tags?.slice(0, 3) || []
})

const riceScore = computed(() => {
  const p = props.data.properties
  const r = (p.Reach ?? p.reach) as number | null
  const i = (p.Impact ?? p.impact) as number | null
  const c = (p.Confidence ?? p.confidence) as number | null
  const e = (p.Effort ?? p.effort) as number | null
  if (r == null || i == null || c == null || e == null || e === 0) return null
  return Math.round((r * i * c) / e)
})

const riceColor = computed(() => {
  if (riceScore.value == null) return ''
  if (riceScore.value >= 10) return 'rice-high'
  if (riceScore.value >= 5) return 'rice-med'
  return 'rice-low'
})
</script>

<template>
  <div
    class="notion-card-node"
    :class="[{ selected, grouped: data.grouped }, riceColor]"
  >
    <Handle type="target" :position="Position.Top" class="!opacity-0" />

    <div class="card-title">
      {{ data.title }}
    </div>

    <div class="card-meta">
      <span v-if="statusValue" class="card-status">
        {{ statusValue }}
      </span>

      <span v-for="tag in tagsValue" :key="tag" class="card-tag">
        {{ tag }}
      </span>
    </div>

    <Handle type="source" :position="Position.Bottom" class="!opacity-0" />
  </div>
</template>

<style scoped>
.notion-card-node {
  background: white;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  min-width: 180px;
  max-width: 240px;
  cursor: grab;
  transition: box-shadow 0.15s, border-color 0.15s;
  font-size: 13px;
}

.notion-card-node:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.notion-card-node.selected {
  border-color: var(--color-primary-500, #3b82f6);
  border-left-color: var(--color-primary-500, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.notion-card-node.grouped {
  /* grouped cards keep their rice color if present */
}

/* RICE color accents — left border */
.notion-card-node.rice-high {
  border-left-color: #16a34a;
}
.notion-card-node.rice-med {
  border-left-color: #d97706;
}
.notion-card-node.rice-low {
  border-left-color: #dc2626;
}

.card-title {
  font-weight: 500;
  color: #1f2937;
  line-height: 1.3;
}

.card-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.card-status {
  font-size: 11px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
}

.card-tag {
  font-size: 10px;
  color: #4b5563;
  background: #e5e7eb;
  padding: 1px 5px;
  border-radius: 3px;
}

/* Dark mode */
:root.dark .notion-card-node {
  background: #1f2937;
  border-color: #374151;
  border-left-color: #374151;
}

:root.dark .notion-card-node.rice-high {
  border-left-color: #16a34a;
}
:root.dark .notion-card-node.rice-med {
  border-left-color: #d97706;
}
:root.dark .notion-card-node.rice-low {
  border-left-color: #dc2626;
}

:root.dark .card-title {
  color: #f3f4f6;
}

:root.dark .card-status {
  background: #374151;
  color: #9ca3af;
}

:root.dark .card-tag {
  background: #374151;
  color: #9ca3af;
}
</style>
