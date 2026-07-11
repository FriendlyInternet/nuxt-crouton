<script setup lang="ts">
/**
 * SalesFormShell — the shared chrome of the sales collection forms: the
 * delete-mode action button, the UForm + CroutonFormLayout scaffold, and the
 * default footer (delete pill + save). Extracted from the per-form copies
 * (#1391 fallow audit). Fields go in the default slot; a form with bespoke
 * chrome (PrinterForm: custom schema wiring, validation footer, sections)
 * simply doesn't use this shell.
 */
const props = defineProps<{
  action: 'create' | 'update' | 'delete'
  collection: string
  items?: Array<{ id: string }>
  /** useCrouton()'s LoadingState string — forwarded to CroutonFormActionButton. */
  loading?: string
  schema?: any
  state: Record<string, any> & { id?: string | null }
  deleting?: boolean
  /** Override the main column classes (ProductForm uses a wider gap). */
  contentClass?: string
}>()

const emit = defineEmits<{ submit: [], delete: [] }>()

const showDelete = computed(() => props.action === 'update' && !!props.state.id)
const mainClass = computed(() => props.contentClass ?? 'flex flex-col gap-4 p-1')
</script>

<template>
  <CroutonFormActionButton
    v-if="action === 'delete'"
    :action="action"
    :collection="collection"
    :items="items"
    :loading="loading"
    @click="emit('submit')"
  />

  <UForm
    v-else
    :schema="schema"
    :state="state"
    @submit="emit('submit')"
  >
    <CroutonFormLayout>
      <template #main>
        <div :class="mainClass">
          <slot />
        </div>
      </template>

      <template #footer>
        <!-- Delete pill left, save stretches over the rest (items-stretch keeps
             the pill the same height as the save button). -->
        <div class="flex items-stretch gap-2">
          <CroutonDeleteButton
            v-if="showDelete"
            expanded
            :loading="deleting"
            @confirm="emit('delete')"
          />
          <CroutonFormActionButton
            class="flex-1"
            :action="action"
            :collection="collection"
            :items="items"
            :loading="loading"
          />
        </div>
      </template>
    </CroutonFormLayout>
  </UForm>
</template>
