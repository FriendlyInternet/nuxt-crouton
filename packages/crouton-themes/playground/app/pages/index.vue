<script setup lang="ts">
// crouton-themes gallery (#1306) — every themed component rendered once;
// flipping <ThemeSwitcher> (in app.vue) restyles the whole page live.
const { getVariant } = useThemeSwitcher()
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
  <div class="space-y-10">
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
        <!-- getVariant follows the active theme's named variants (ko-outline,
             minimal-outline, ...) — an explicit variant string would stay
             default-styled by design (the runtime swap only remaps defaults). -->
        <UButton color="primary" :variant="getVariant('outline')">Outline</UButton>
        <UButton color="primary" :variant="getVariant('soft')">Soft</UButton>
        <UButton color="primary" :variant="getVariant('ghost')">Ghost</UButton>
        <UButton color="primary" :variant="getVariant('link')">Link</UButton>
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
