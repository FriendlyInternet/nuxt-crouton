<script setup lang="ts">
/**
 * e2e surface page (#224): mounts the real CroutonFormReferenceSelect pointed
 * at the parent `mainCategories` collection — the same component + collection
 * key the generated products form uses for its `categoryId → refTarget:
 * categories` field. The select fetches its options from the parent
 * collection's list endpoint on mount; it renders its trigger button only
 * once that fetch resolves (it awaits the query), so the surface goes red if
 * the relation UI or the parent collection's registration regresses.
 */
definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'team-admin']
})

const categoryId = ref<string | null>(null)
</script>

<template>
  <UDashboardPanel id="relations-check">
    <UDashboardNavbar title="Relations Check">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
    </UDashboardNavbar>

    <div
      data-testid="relations-check"
      class="p-6"
    >
      <CroutonFormReferenceSelect
        v-model="categoryId"
        collection="mainCategories"
        label="Category"
      />
    </div>
  </UDashboardPanel>
</template>
