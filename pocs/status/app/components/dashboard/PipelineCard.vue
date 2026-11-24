<script setup lang="ts">
// One ticket on the Pipeline board (#4349): number, title, time in this column, package, red-check badge.
// The whole card is a link to the ticket on GitHub (new tab). Rendered by CroutonKanban's card slot.
import type { BoardRow } from '~/utils/dashboard'

// The kanban also passes `layout` and `collection`; this card needs neither, so they are not
// declared and must not land on the <a> as attributes.
defineOptions({ inheritAttrs: false })
defineProps<{ item: BoardRow & { age?: string } }>()
</script>

<template>
  <a
    :href="item.url"
    target="_blank"
    rel="noopener"
    class="block rounded-md border border-default bg-default p-2 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
  >
    <span class="block text-xs text-muted">#{{ item.number }}</span>
    <span class="block text-sm font-medium break-words">{{ item.title }}</span>
    <span class="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
      <span v-if="item.age">{{ item.age }}</span>
      <UBadge v-if="item.pkg" color="neutral" variant="subtle" size="sm">{{ item.pkg }}</UBadge>
      <UBadge v-if="item.checksRed" color="error" variant="subtle" size="sm" icon="i-lucide-circle-x">red check</UBadge>
    </span>
  </a>
</template>
