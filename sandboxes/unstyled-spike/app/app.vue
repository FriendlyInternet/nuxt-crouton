<script setup lang="ts">
// unstyled-spike — theme.unstyled: true cost sandbox (#1305, epic #1303).
//
// `ui: { theme: { unstyled: true } }` (nuxt.config.ts, this app) blanks EVERY
// generated slot/variant/compoundVariant class of EVERY Nuxt UI component —
// including the structural/layout classes (Modal's fixed overlay + centering,
// DropdownMenu's floating positioning), not just the decorative ones a
// subtractive replacer targets. What survives: `class=`, the `:ui` prop, and
// `app.config.ui`. Everything below is restyled using ONLY those three
// surfaces, from bare (unstyled) structure — that's the re-supply cost this
// spike measures. See `packages/crouton-themes/CLAUDE.md` § "Three theming
// modes" for the write-up this app produced.

const isOpen = ref(false)

const items = [
  [{ label: 'Profile', icon: 'i-lucide-user' }, { label: 'Settings', icon: 'i-lucide-settings' }],
  [{ label: 'Sign out', icon: 'i-lucide-log-out' }]
]

const brokeChecklist = [
  'UButton: ALL decorative + layout classes gone (no padding, no border, no color, no focus ring) — had to re-supply the entire look via `:ui.base`.',
  'UInput: same — no border/padding/focus ring by default; text was indistinguishable from a bare <input>.',
  'UCard: `divide-y` + `rounded` + `shadow` + `ring` all gone — header/body/footer render as unstyled <div>s stacked with zero visual separation until `:ui` supplies borders.',
  'USeparator: the `<hr>`-equivalent has NO border/margin at all — invisible until styled (a 1px line took an explicit `border-top`).',
  'UModal (structural, the worst case): the overlay loses `fixed inset-0` positioning + the dim background — it does not even visually cover the page. The content panel loses its centering (`flex items-center justify-center` lives on the overlay slot) — without re-supplying both, the modal renders as an unstyled block sitting at the top of the DOM in normal document flow, not "on top of" anything.',
  'UDropdownMenu (structural, the worst case): the content panel loses `position`/`z-index`/floating placement classes — it renders inline, pushing page content down, instead of floating over it. Items lose hover/highlight affordance entirely (no default `data-highlighted` styling).'
]
</script>

<template>
  <div class="min-h-screen bg-white text-black p-8 max-w-3xl mx-auto space-y-10">
    <header class="space-y-2">
      <h1 class="text-2xl font-bold">unstyled: true — cost sandbox</h1>
      <p class="text-sm text-neutral-600">
        Spike #1305 · epic #1303 · <code>ui: {{ '{' }} theme: {{ '{' }} unstyled: true {{ '}' }} {{ '}' }}</code>
        in <code>nuxt.config.ts</code> — every component below starts from ZERO Nuxt UI
        styling; everything visible was re-supplied via <code>:ui</code> / <code>class</code>.
      </p>
    </header>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide">UButton</h2>
      <div class="flex flex-wrap gap-3">
        <UButton
          label="Restyled button"
          :ui="{ base: 'spike-btn' }"
        />
        <UButton
          label="Disabled"
          disabled
          :ui="{ base: 'spike-btn opacity-40 cursor-not-allowed' }"
        />
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide">UInput</h2>
      <UInput
        placeholder="Restyled input"
        :ui="{ base: 'spike-input' }"
      />
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide">UCard</h2>
      <UCard :ui="{ root: 'spike-card', header: 'spike-card-header', body: 'spike-card-body' }">
        <template #header>
          Restyled card header
        </template>
        Bare structure + re-supplied border/padding. Without <code>:ui</code> this card is
        three plain, unbordered <code>&lt;div&gt;</code>s.
      </UCard>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide">USeparator</h2>
      <p class="text-sm text-neutral-600">Above this line: no separator styling supplied (invisible). Below: re-supplied.</p>
      <USeparator :ui="{ border: 'spike-separator' }" />
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide">UModal (structural)</h2>
      <UButton label="Open modal" :ui="{ base: 'spike-btn' }" @click="isOpen = true" />
      <UModal
        v-model:open="isOpen"
        title="Restyled modal"
        description="Overlay + centering + panel border are all re-supplied via :ui — none of it exists by default under unstyled."
        :ui="{
          overlay: 'spike-modal-overlay',
          content: 'spike-modal-content'
        }"
      >
        <template #body>
          <p class="text-sm">
            This overlay/centering is hand-written CSS (<code>.spike-modal-overlay</code> /
            <code>.spike-modal-content</code>) — under plain <code>unstyled</code> this panel
            would render inline in the document, not floating over a dimmed backdrop.
          </p>
          <UButton label="Close" class="mt-4" :ui="{ base: 'spike-btn' }" @click="isOpen = false" />
        </template>
      </UModal>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide">UDropdownMenu (structural)</h2>
      <UDropdownMenu
        :items="items"
        :ui="{
          content: 'spike-dropdown-content',
          item: 'spike-dropdown-item',
          label: 'text-xs uppercase text-neutral-500 px-3 py-1',
          separator: 'my-1 border-t border-neutral-200'
        }"
      >
        <UButton label="Open dropdown" :ui="{ base: 'spike-btn' }" />
      </UDropdownMenu>
    </section>

    <section class="border-2 border-black p-4 space-y-2">
      <h2 class="text-sm font-semibold uppercase tracking-wide">Re-supply checklist (what broke under `unstyled: true`)</h2>
      <ul class="list-disc list-inside text-sm space-y-1">
        <li v-for="(c, i) in brokeChecklist" :key="i">{{ c }}</li>
      </ul>
    </section>
  </div>
</template>
