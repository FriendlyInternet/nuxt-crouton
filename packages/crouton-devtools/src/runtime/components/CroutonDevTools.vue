<script setup lang="ts">
import { computed } from 'vue'
import { useCroutonDevTools } from '../composables/useCroutonDevTools'

/**
 * The unified dev-tools launcher (#809).
 *
 * One neutral glasses button (bottom-right) → a Nuxt UI dropdown of the
 * registered tools, each a toggle row. ACTIVE tools also surface as small
 * quick-toggle chips STACKED ABOVE the glasses (#810 follow-up): you see at a
 * glance what's on, and one tap turns it off — no digging into the menu, and no
 * tool drawing its own floating button over the launcher (eruda's entry button
 * is hidden; the chip is its control instead).
 *
 * The launcher only renders the registry (`useCroutonDevTools`); it owns no tool
 * logic. Hidden when no tool is available. Built entirely on Nuxt UI 4. Mounted
 * into the host app's context by `crouton-devtools.client.ts`.
 */
const { tools, isActive, toggle } = useCroutonDevTools()

const hasTools = computed(() => tools.value.length > 0)
const activeTools = computed(() => tools.value.filter(t => isActive(t.id)))
</script>

<template>
  <!-- z above eruda's panel (~1e7): eruda is full-screen, so the active-Console chip must
       float OVER it to stay tappable — otherwise opening the console traps you with no close. -->
  <div
    v-if="hasTools"
    class="fixed bottom-4 right-4 z-[2147483646] flex flex-col items-end gap-2"
    data-crouton-ui
  >
    <!-- active-tool quick toggles: one filled chip per active tool, tap to turn off -->
    <TransitionGroup name="crouton-chip" tag="div" class="flex flex-col items-end gap-2">
      <button
        v-for="tool in activeTools"
        :key="tool.id"
        type="button"
        :title="`Turn off ${tool.label}`"
        :aria-label="`Turn off ${tool.label}`"
        class="group relative flex size-11 items-center justify-center rounded-xl bg-primary text-inverted shadow-lg ring-1 ring-primary/30 transition-transform active:scale-90"
        @click="toggle(tool)"
      >
        <UIcon :name="tool.icon" class="size-5" />
        <!-- ✕ hint on hover (pointer); the whole chip is the off switch -->
        <span class="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-default text-default opacity-0 shadow ring-1 ring-default transition-opacity group-hover:opacity-100">
          <UIcon name="i-lucide-x" class="size-3" />
        </span>
      </button>
    </TransitionGroup>

    <UPopover :content="{ side: 'top', align: 'end', sideOffset: 8 }" :ui="{ content: 'z-[2147483647]' }">
      <UButton
        icon="i-lucide-glasses"
        color="neutral"
        variant="outline"
        size="lg"
        square
        aria-label="Crouton dev tools"
        class="rounded-xl bg-default shadow-lg"
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
  </div>
</template>

<style scoped>
/* chips spring in/out as a tool toggles on/off */
.crouton-chip-enter-active { transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease; }
.crouton-chip-leave-active { transition: transform 0.18s ease, opacity 0.18s ease; }
.crouton-chip-enter-from,
.crouton-chip-leave-to { opacity: 0; transform: scale(0.6) translateY(8px); }
</style>
