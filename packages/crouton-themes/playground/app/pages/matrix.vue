<script setup lang="ts">
// Full Nuxt UI matrix (#1405) — every component the monorepo uses (and the
// common rest), one page, so flipping themes × schemes exposes any surface a
// theme can't reach. /crouton stays the realistic CRUD acceptance page; this
// is the exhaustive zoo. Package (sales/pages/core) chrome is deliberately
// NOT here — it needs team context + a server; kassa staging is its surface.
const { getVariant } = useThemeSwitcher()
const toast = useToast()

const selectItems = ['Alpha', 'Beta', 'Gamma']
const radioItems = [
  { label: 'Optie A', value: 'a', description: 'De eerste keuze' },
  { label: 'Optie B', value: 'b', description: 'De tweede keuze' }
]
const checkGroupItems = ['E-mail', 'SMS', 'Push']
const tabItems = [
  { label: 'Eerste', value: 'one' },
  { label: 'Tweede', value: 'two' },
  { label: 'Derde', value: 'three' }
]
const accordionItems = [
  { label: 'Wat is dit?', content: 'Een accordion-item onder het actieve thema.' },
  { label: 'En dit?', content: 'Nog één, zodat de divider zichtbaar is.' }
]
const breadcrumbItems = [
  { label: 'Home', icon: 'i-lucide-house' },
  { label: 'Producten' },
  { label: 'Detail' }
]
const navItems = [
  { label: 'Overzicht', icon: 'i-lucide-layout-dashboard', active: true },
  { label: 'Producten', icon: 'i-lucide-package' },
  { label: 'Instellingen', icon: 'i-lucide-settings' }
]
const dropdownItems = [
  [{ label: 'Bewerken', icon: 'i-lucide-pencil' }, { label: 'Dupliceren', icon: 'i-lucide-copy' }],
  [{ label: 'Verwijderen', icon: 'i-lucide-trash', color: 'error' as const }]
]
const commandGroups = [
  {
    id: 'acties',
    label: 'Acties',
    items: [
      { label: 'Nieuw product', icon: 'i-lucide-plus' },
      { label: 'Zoek order', icon: 'i-lucide-search' }
    ]
  }
]
const stepperItems = [
  { title: 'Gegevens', description: 'Basis', icon: 'i-lucide-user' },
  { title: 'Betaling', description: 'Methode', icon: 'i-lucide-credit-card' },
  { title: 'Klaar', description: 'Bevestig', icon: 'i-lucide-check' }
]
const timelineItems = [
  { date: '09:00', title: 'Order geplaatst', icon: 'i-lucide-shopping-cart' },
  { date: '09:02', title: 'Ticket geprint', icon: 'i-lucide-printer' },
  { date: '09:10', title: 'Afgerond', icon: 'i-lucide-check' }
]
const treeItems = [
  {
    label: 'Dranken',
    icon: 'i-lucide-folder',
    defaultExpanded: true,
    children: [{ label: 'Pils', icon: 'i-lucide-beer' }, { label: 'Wijn', icon: 'i-lucide-wine' }]
  },
  { label: 'Eten', icon: 'i-lucide-folder' }
]
const tableRows = [
  { product: 'Frisdrank', prijs: '€ 2,00', status: 'active' },
  { product: 'Pils', prijs: '€ 2,50', status: 'low' }
]

const form = reactive({
  text: '',
  number: 5,
  area: '',
  select: 'Alpha',
  selectMenu: 'Beta',
  inputMenu: 'Gamma',
  tags: ['kassa'],
  pin: [] as string[],
  slider: 40,
  check: true,
  checks: ['E-mail'],
  radio: 'a',
  on: true,
  color: '#00C16A'
})

const modalOpen = ref(false)
const slideoverOpen = ref(false)
const drawerOpen = ref(false)
const collapsibleOpen = ref(true)
const page = ref(3)
const stepper = ref(1)

const colors = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'] as const
</script>

<template>
  <div class="space-y-12">
    <p class="text-sm text-muted max-w-2xl">
      De volledige Nuxt UI set onder het actieve thema — wissel thema's en
      kleurenschema om gaten te zien. Pakket-chrome (sales/pages) heeft team- en
      servercontext nodig en wordt op kassa-staging gecheckt.
    </p>

    <!-- ============ ACTIONS ============ -->
    <section class="space-y-4">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">Actions</h2>
      <div class="flex flex-wrap gap-2 items-center">
        <UButton v-for="c in colors" :key="c" :color="c">{{ c }}</UButton>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <UButton :variant="getVariant('outline')" color="primary">outline</UButton>
        <UButton :variant="getVariant('soft')" color="primary">soft</UButton>
        <UButton :variant="getVariant('ghost')" color="primary">ghost</UButton>
        <UButton :variant="getVariant('link')" color="primary">link</UButton>
        <UButton disabled>disabled</UButton>
        <UButton loading>loading</UButton>
        <UButton icon="i-lucide-plus" aria-label="Icon button" />
      </div>
      <div class="flex flex-wrap gap-4 items-center">
        <UFieldGroup>
          <UButton color="neutral" :variant="getVariant('outline')">Links</UButton>
          <UButton color="neutral" :variant="getVariant('outline')">Midden</UButton>
          <UButton color="neutral" :variant="getVariant('outline')">Rechts</UButton>
        </UFieldGroup>
        <UDropdownMenu :items="dropdownItems">
          <UButton color="neutral" :variant="getVariant('outline')" trailing-icon="i-lucide-chevron-down">Menu</UButton>
        </UDropdownMenu>
        <ULink to="/">Een ULink</ULink>
        <span class="text-sm">Sneltoets: <UKbd>⌘</UKbd> <UKbd>K</UKbd></span>
      </div>
    </section>

    <!-- ============ FORM CONTROLS ============ -->
    <section class="space-y-4 max-w-xl">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">Form controls</h2>
      <UFormField label="Input" name="text" description="Met beschrijving" required>
        <UInput v-model="form.text" placeholder="Typ iets..." icon="i-lucide-search" />
      </UFormField>
      <UFormField label="Input (error)" name="text-err" error="Dit veld is verplicht">
        <UInput placeholder="Foutstaat" />
      </UFormField>
      <div class="grid grid-cols-2 gap-4">
        <UFormField label="Number" name="number"><UInputNumber v-model="form.number" /></UFormField>
        <UFormField label="Tags" name="tags"><UInputTags v-model="form.tags" /></UFormField>
        <UFormField label="Select" name="select"><USelect v-model="form.select" :items="selectItems" /></UFormField>
        <UFormField label="SelectMenu" name="selectmenu"><USelectMenu v-model="form.selectMenu" :items="selectItems" /></UFormField>
        <UFormField label="InputMenu" name="inputmenu"><UInputMenu v-model="form.inputMenu" :items="selectItems" /></UFormField>
        <UFormField label="PIN" name="pin"><UPinInput v-model="form.pin" :length="4" /></UFormField>
      </div>
      <UFormField label="Textarea" name="area">
        <UTextarea v-model="form.area" :rows="2" placeholder="Meerregelig..." />
      </UFormField>
      <UFormField label="Slider" name="slider"><USlider v-model="form.slider" /></UFormField>
      <UFormField label="Checkbox" name="check"><UCheckbox v-model="form.check" label="Eén checkbox" /></UFormField>
      <UFormField label="CheckboxGroup" name="checks">
        <UCheckboxGroup v-model="form.checks" :items="checkGroupItems" orientation="horizontal" />
      </UFormField>
      <UFormField label="RadioGroup" name="radio"><URadioGroup v-model="form.radio" :items="radioItems" /></UFormField>
      <UFormField label="Switch" name="on"><USwitch v-model="form.on" label="Actief" /></UFormField>
      <UFormField label="ColorPicker" name="color"><UColorPicker v-model="form.color" /></UFormField>
      <UFormField label="FileUpload" name="file"><UFileUpload label="Sleep een bestand hierheen" /></UFormField>
    </section>

    <!-- ============ DATA DISPLAY ============ -->
    <section class="space-y-4">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">Data display</h2>
      <div class="flex flex-wrap gap-2 items-center">
        <UBadge v-for="c in colors" :key="c" :color="c">{{ c }}</UBadge>
        <UChip text="3" size="3xl"><UButton color="neutral" :variant="getVariant('outline')" icon="i-lucide-bell" aria-label="Meldingen" /></UChip>
        <UAvatar alt="Claude Verify" />
        <UAvatarGroup>
          <UAvatar alt="A B" />
          <UAvatar alt="C D" />
          <UAvatar alt="E F" />
        </UAvatarGroup>
        <UUser name="Claude Verify" description="kassahulp" :avatar="{ alt: 'Claude Verify' }" />
      </div>
      <div class="grid md:grid-cols-2 gap-6 max-w-4xl">
        <UCard>
          <template #header><span class="font-medium">Kaart met header</span></template>
          Inhoud van de kaart.
          <template #footer><span class="text-sm text-muted">En een footer.</span></template>
        </UCard>
        <div class="space-y-3">
          <UProgress :model-value="65" />
          <UProgress animation="carousel" />
          <USkeleton class="h-4 w-2/3" />
          <USkeleton class="h-4 w-1/2" />
          <USeparator label="separator" />
        </div>
      </div>
      <UTable :data="tableRows" class="max-w-xl" />
      <div class="grid md:grid-cols-3 gap-6 max-w-4xl">
        <UCalendar />
        <UAccordion :items="accordionItems" />
        <div class="space-y-4">
          <UTree :items="treeItems" />
          <UCollapsible v-model:open="collapsibleOpen">
            <UButton color="neutral" :variant="getVariant('ghost')" trailing-icon="i-lucide-chevron-down" block>Collapsible</UButton>
            <template #content>
              <p class="text-sm text-muted p-2">Opengeklapte inhoud.</p>
            </template>
          </UCollapsible>
        </div>
      </div>
      <UTimeline :items="timelineItems" orientation="horizontal" class="max-w-2xl" />
    </section>

    <!-- ============ FEEDBACK ============ -->
    <section class="space-y-4 max-w-2xl">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">Feedback</h2>
      <UAlert v-for="c in ['primary', 'warning', 'error', 'neutral'] as const" :key="c" :color="c" :title="`Alert ${c}`" description="Eén regel uitleg." icon="i-lucide-info" />
      <UBanner title="Een banner over de volle breedte." icon="i-lucide-megaphone" />
      <UEmpty icon="i-lucide-inbox" title="Niets gevonden" description="Empty-state onder het thema." />
      <div class="flex flex-wrap gap-2">
        <UButton color="success" @click="toast.add({ title: 'Gelukt', description: 'Succes-toast.', color: 'success' })">Succes-toast</UButton>
        <UButton color="error" :variant="getVariant('outline')" @click="toast.add({ title: 'Mislukt', description: 'Fout-toast.', color: 'error' })">Fout-toast</UButton>
        <UTooltip text="Een tooltip"><UButton color="neutral" :variant="getVariant('ghost')">Hover: tooltip</UButton></UTooltip>
        <UPopover>
          <UButton color="neutral" :variant="getVariant('outline')">Popover</UButton>
          <template #content><p class="text-sm p-3">Popover-inhoud.</p></template>
        </UPopover>
      </div>
    </section>

    <!-- ============ OVERLAYS ============ -->
    <section class="space-y-4">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">Overlays</h2>
      <div class="flex flex-wrap gap-2">
        <UButton @click="modalOpen = true">Modal</UButton>
        <UButton @click="slideoverOpen = true">Slideover</UButton>
        <UButton @click="drawerOpen = true">Drawer</UButton>
      </div>
      <UModal v-model:open="modalOpen" title="Modal" description="Chrome onder het thema.">
        <template #body><p class="text-sm">Inhoud.</p></template>
        <template #footer><UButton @click="modalOpen = false">Sluiten</UButton></template>
      </UModal>
      <USlideover v-model:open="slideoverOpen" title="Slideover" description="Zijpaneel.">
        <template #body><p class="text-sm">Inhoud.</p></template>
      </USlideover>
      <UDrawer v-model:open="drawerOpen" title="Drawer" description="Onderpaneel.">
        <template #body><p class="text-sm pb-6">Inhoud.</p></template>
      </UDrawer>
    </section>

    <!-- ============ NAVIGATION ============ -->
    <section class="space-y-4 max-w-2xl">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">Navigation</h2>
      <UBreadcrumb :items="breadcrumbItems" />
      <UTabs :items="tabItems" default-value="one" />
      <UNavigationMenu :items="navItems" />
      <UPagination v-model:page="page" :total="120" :items-per-page="10" />
      <UStepper v-model="stepper" :items="stepperItems" />
      <UCard><UCommandPalette :groups="commandGroups" placeholder="Zoek een actie..." class="h-48" /></UCard>
    </section>
  </div>
</template>
