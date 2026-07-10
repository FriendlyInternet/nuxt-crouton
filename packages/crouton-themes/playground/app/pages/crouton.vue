<script setup lang="ts">
// Crouton surfaces (#1333) — a realistic generated-CRUD composition, so every
// theme's coverage gaps are visible at sign-off time instead of discovered in
// an app. The chrome-vs-data rule: controls follow the theme; dense data
// surfaces (the table) stay calm and readable under every theme.
const { getVariant } = useThemeSwitcher()

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

const form = reactive({
  name: '',
  category: 'Dranken',
  description: '',
  active: true
})

const page = ref(1)
const isEditOpen = ref(false)
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
      <UFormField label="Omschrijving" name="description">
        <UTextarea v-model="form.description" placeholder="Korte omschrijving..." :rows="3" />
      </UFormField>
      <div class="flex items-center justify-between">
        <USwitch v-model="form.active" label="Actief" />
        <div class="flex gap-2">
          <UButton color="neutral" :variant="getVariant('ghost')">Annuleren</UButton>
          <UButton color="primary">Opslaan</UButton>
        </div>
      </div>
    </section>

    <UModal v-model:open="isEditOpen" title="Product bewerken">
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
  </div>
</template>
