<script setup lang="ts">
// Crouton surfaces (#1333, extended in #1393) — a realistic generated-CRUD
// composition, so every theme's coverage gaps are visible at sign-off time
// instead of discovered in an app. The chrome-vs-data rule: controls follow
// the theme; dense data surfaces (the table) stay calm and readable under
// every theme.
//
// #1393 acceptance matrix: tabs, select/selectMenu/textarea, switch, checkbox,
// radio cards, alerts, modal, slideover, toast, pagination — nothing on this
// page may render stock under a theme (or the pass must be documented).
const { getVariant } = useThemeSwitcher()
const toast = useToast()

const rows = [
  { id: 1, name: 'Frisdrank', price: '€ 2,00', status: 'active', stock: 140 },
  { id: 2, name: 'Pils', price: '€ 2,50', status: 'active', stock: 96 },
  { id: 3, name: 'Wijn', price: '€ 4,00', status: 'low', stock: 7 },
  { id: 4, name: 'Koffie', price: '€ 2,20', status: 'active', stock: 55 },
  { id: 5, name: 'Soep', price: '€ 3,50', status: 'inactive', stock: 0 }
]

const columns = [
  { accessorKey: 'name', header: 'Product' },
  { accessorKey: 'price', header: 'Prijs' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'stock', header: 'Voorraad' }
]

const tabItems = [
  { label: 'Producten', value: 'products' },
  { label: 'Categorieën', value: 'categories' },
  { label: 'Instellingen', value: 'settings' }
]

const categories = ['Dranken', 'Eten', 'Merch']
const locations = ['Kassa 1', 'Kassa 2', 'Bar']

const paymentOptions = [
  { label: 'Cash', value: 'cash', description: 'Fysiek geld in de lade' },
  { label: 'Payconiq', value: 'payconiq', description: 'QR-code betaling' },
  { label: 'Bonnetjes', value: 'tickets', description: 'Vooraf verkochte bonnen' }
]

const form = reactive({
  name: '',
  category: 'Dranken',
  location: 'Kassa 1',
  description: '',
  active: true,
  payment: 'cash',
  channels: { kassa: true, webshop: false }
})

const page = ref(1)
const isEditOpen = ref(false)
const isPanelOpen = ref(false)

function notify(type: 'success' | 'error') {
  if (type === 'success') {
    toast.add({ title: 'Product bewaard', description: 'De wijzigingen staan online.', color: 'success' })
  } else {
    toast.add({ title: 'Bewaren mislukt', description: 'Voorraad mag niet negatief zijn.', color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-10">
    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Collection list (table stays calm by design)
      </h2>
      <UTabs :items="tabItems" default-value="products" class="max-w-md" />
      <UTable :data="rows" :columns="columns" class="max-w-2xl" />
      <div class="flex items-center justify-between max-w-2xl">
        <UPagination v-model:page="page" :total="42" :items-per-page="10" />
        <UButton color="primary" @click="isEditOpen = true">Nieuw product</UButton>
      </div>
    </section>

    <section class="space-y-3 max-w-2xl">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Alerts
      </h2>
      <UAlert
        color="primary"
        title="Nieuwe bestelronde gestart"
        description="Bestellingen worden weer aangenomen."
        icon="i-lucide-info"
      />
      <UAlert
        color="error"
        title="Printer offline"
        description="Bonnetjes worden gebufferd tot de printer terug is."
        icon="i-lucide-alert-triangle"
      />
    </section>

    <section class="space-y-3 max-w-md">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Collection form
      </h2>
      <UFormField label="Naam" name="name">
        <UInput v-model="form.name" placeholder="Productnaam" />
      </UFormField>
      <UFormField label="Categorie" name="category">
        <USelect v-model="form.category" :items="categories" />
      </UFormField>
      <UFormField label="Locatie" name="location">
        <USelectMenu v-model="form.location" :items="locations" />
      </UFormField>
      <UFormField label="Omschrijving" name="description">
        <UTextarea v-model="form.description" placeholder="Korte omschrijving..." :rows="3" />
      </UFormField>
      <UFormField label="Betaalmethode" name="payment">
        <URadioGroup v-model="form.payment" :items="paymentOptions" />
      </UFormField>
      <UFormField label="Kanalen" name="channels">
        <div class="flex gap-6">
          <UCheckbox v-model="form.channels.kassa" label="Kassa" />
          <UCheckbox v-model="form.channels.webshop" label="Webshop" />
        </div>
      </UFormField>
      <div class="flex items-center justify-between">
        <USwitch v-model="form.active" label="Actief" />
        <div class="flex gap-2">
          <UButton color="neutral" :variant="getVariant('ghost')">Annuleren</UButton>
          <UButton color="primary" @click="notify('success')">Opslaan</UButton>
        </div>
      </div>
      <div class="flex gap-2">
        <UButton color="neutral" :variant="getVariant('outline')" @click="isPanelOpen = true">
          Open detailpaneel
        </UButton>
        <UButton color="error" :variant="getVariant('outline')" @click="notify('error')">
          Trigger fout-toast
        </UButton>
      </div>
    </section>

    <UModal v-model:open="isEditOpen" title="Product bewerken" description="Pas de productgegevens aan.">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Naam" name="edit-name">
            <UInput placeholder="Productnaam" />
          </UFormField>
          <UFormField label="Categorie" name="edit-category">
            <USelect :items="categories" :model-value="'Dranken'" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" :variant="getVariant('outline')" @click="isEditOpen = false">
          Sluiten
        </UButton>
        <UButton color="primary" @click="isEditOpen = false">Bewaren</UButton>
      </template>
    </UModal>

    <USlideover v-model:open="isPanelOpen" title="Product detail" description="Voorraad en verkoop per locatie.">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Voorraad" name="panel-stock">
            <UInput type="number" :model-value="96" />
          </UFormField>
          <UFormField label="Locatie" name="panel-location">
            <USelect :items="locations" :model-value="'Kassa 1'" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="primary" @click="isPanelOpen = false">Klaar</UButton>
      </template>
    </USlideover>
  </div>
</template>
