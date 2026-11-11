<script setup lang="ts">
/**
 * Card Grid Block Public Renderer
 *
 * Renders a card grid using UPageGrid and UPageCard for public display.
 */
import type { CardGridBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: CardGridBlockAttrs
}

const props = defineProps<Props>()
</script>

<template>
  <div class="card-grid-block">
    <!-- Header if present -->
    <div
      v-if="attrs.headline || attrs.title || attrs.description"
      class="text-center mb-8"
    >
      <p v-if="attrs.headline" class="text-sm font-medium text-primary mb-2">
        {{ attrs.headline }}
      </p>
      <h2 v-if="attrs.title" class="text-2xl sm:text-3xl font-bold mb-4">
        {{ attrs.title }}
      </h2>
      <p v-if="attrs.description" class="text-lg text-muted max-w-2xl mx-auto">
        {{ attrs.description }}
      </p>
    </div>

    <!-- Cards Grid -->
    <UPageGrid>
      <UPageCard
        v-for="(card, index) in attrs.cards || []"
        :key="index"
        :icon="card.icon"
        :title="card.title"
        :description="card.description"
        :to="safeUrl(card.to)"
        :highlight="card.highlight"
        :highlight-color="card.highlightColor"
      />
    </UPageGrid>
  </div>
</template>
