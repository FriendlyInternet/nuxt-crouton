<script setup lang="ts">
// crouton-themes playground (#1306) — the daily dev surface AND the theme
// gallery this epic (#1303) uses for ui-proposal sign-off. Every themed
// component below is rendered once; flipping <ThemeSwitcher> restyles the
// whole page live via useThemeSwitcher()'s updateAppConfig() swap.
const { variant } = useThemeSwitcher()

const colors = ['primary', 'neutral', 'error'] as const

const dropdownItems = [
  [{ label: 'Profile', icon: 'i-lucide-user' }, { label: 'Settings', icon: 'i-lucide-settings' }],
  [{ label: 'Log out', icon: 'i-lucide-log-out' }]
]

const isModalOpen = ref(false)

const switchValue = ref(true)
</script>

<template>
  <div class="min-h-screen bg-[var(--ui-bg,white)] p-6 max-w-5xl mx-auto space-y-10">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">
          crouton-themes playground
        </h1>
        <p class="text-sm text-neutral-500">
          Every current theme, one component set. Switch themes to compare —
          nothing here is hand-drawn per theme, it's the same markup restyled.
        </p>
      </div>
      <ThemeSwitcher />
    </header>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Buttons
      </h2>
      <div class="flex flex-wrap items-center gap-3">
        <UButton
          v-for="color in colors"
          :key="`solid-${color}`"
          :color="color"
          :variant="variant"
        >
          {{ color }}
        </UButton>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <UButton color="primary" variant="outline">Outline</UButton>
        <UButton color="primary" variant="soft">Soft</UButton>
        <UButton color="primary" variant="ghost">Ghost</UButton>
        <UButton color="primary" variant="link">Link</UButton>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Inputs
      </h2>
      <div class="flex flex-wrap items-center gap-3 max-w-sm">
        <UInput placeholder="Text input" />
        <UInput placeholder="Disabled" disabled />
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Card
      </h2>
      <UCard class="max-w-sm">
        <template #header>
          <p class="font-medium">Card header</p>
        </template>
        <p class="text-sm">
          A themed card body, restyled by the active theme's card variants.
        </p>
        <template #footer>
          <UButton color="primary" size="sm">Action</UButton>
        </template>
      </UCard>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Separator
      </h2>
      <USeparator label="Section" />
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Badge &amp; Switch
      </h2>
      <div class="flex flex-wrap items-center gap-4">
        <UBadge color="primary">Primary</UBadge>
        <UBadge color="neutral" variant="outline">Neutral</UBadge>
        <USwitch v-model="switchValue" label="Enabled" />
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Dropdown &amp; Modal
      </h2>
      <div class="flex flex-wrap items-center gap-3">
        <UDropdownMenu :items="dropdownItems">
          <UButton color="neutral" variant="outline" trailing-icon="i-lucide-chevron-down">
            Menu
          </UButton>
        </UDropdownMenu>
        <UButton color="neutral" variant="outline" @click="isModalOpen = true">
          Open modal
        </UButton>
        <UModal v-model:open="isModalOpen" title="Themed modal">
          <template #body>
            <p class="text-sm">
              Modal body content, restyled per-theme like every other surface.
            </p>
          </template>
          <template #footer>
            <UButton color="neutral" variant="outline" @click="isModalOpen = false">
              Close
            </UButton>
            <UButton color="primary" @click="isModalOpen = false">
              Confirm
            </UButton>
          </template>
        </UModal>
      </div>
    </section>
  </div>
</template>
