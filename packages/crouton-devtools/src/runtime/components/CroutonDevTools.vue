<script setup lang="ts">
import { computed } from 'vue'
import { useCroutonDevTools } from '../composables/useCroutonDevTools'

/**
 * The unified dev-tools launcher (#809).
 *
 * One neutral glasses button (bottom-right) → a Nuxt UI dropdown of the
 * registered tools, each a toggle row. The launcher only renders the registry
 * (`useCroutonDevTools`); it owns no tool logic. Hidden when no tool is
 * available in the current context. Console + Annotate register in #810.
 *
 * Built entirely on Nuxt UI 4 (UPopover / UButton / USwitch / UIcon). It is
 * mounted into the host app's context by `crouton-devtools.client.ts`, so the
 * global U* components resolve.
 */
const { tools, isActive, toggle } = useCroutonDevTools()

const hasTools = computed(() => tools.value.length > 0)
</script>

<template>
  <UPopover
    v-if="hasTools"
    :content="{ side: 'top', align: 'end', sideOffset: 8 }"
    :ui="{ content: 'z-[100000]' }"
  >
    <UButton
      icon="i-lucide-glasses"
      color="neutral"
      variant="outline"
      size="lg"
      square
      aria-label="Crouton dev tools"
      class="fixed bottom-4 right-4 z-[99999] rounded-xl bg-default shadow-lg"
    />

    <template #content>
      <!-- data-crouton-ui: this popover is teleported to <body> (outside the launcher root), so the
           Annotate select-mode guard (`isOurs`) keys off this marker to never annotate our own UI. -->
      <div class="w-64 p-1" data-crouton-ui>
        <p class="px-2.5 py-1.5 text-[11px] font-medium tracking-wide text-muted">
          Crouton tools
        </p>

        <div
          v-for="tool in tools"
          :key="tool.id"
          class="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-elevated/50"
        >
          <UIcon :name="tool.icon" class="size-4 shrink-0 text-dimmed" />
          <span class="flex-1 truncate text-sm">{{ tool.label }}</span>
          <UBadge
            v-if="tool.badge?.() != null"
            color="neutral"
            variant="soft"
            size="sm"
          >
            {{ tool.badge() }}
          </UBadge>
          <USwitch
            :model-value="isActive(tool.id)"
            size="sm"
            :aria-label="`Toggle ${tool.label}`"
            @update:model-value="toggle(tool)"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>
