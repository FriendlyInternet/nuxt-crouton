<template>
  <!-- For delete action, show delete confirmation -->
  <CroutonFormDeleteConfirm
    v-if="action === 'delete'"
    :collection="collection!"
    :items="(items as string[])"
    class="w-full h-full"
  />
  <!-- For other actions, load the form component -->
  <component
    :is="currentComponent"
    v-else-if="currentComponent"
    v-bind="componentProps"
    class="w-full h-full"
  />
  <div v-else>
    Component not found for collection: {{ collection }}
  </div>
</template>

<script setup lang="ts">
import { collectionForms } from '#build/crouton-collection-forms.mjs'

const props = defineProps({
  collection: String,
  loading: String,
  action: String,
  items: {
    type: Array,
    default: () => []
  },
  activeItem: {
    type: Object,
    default: () => ({})
  }
})

// Build-time map of every *Form / *Detail component (Nuxt's resolved winner, lazy chunk).
// Keyed by unprefixed name; the resolver chain asks for Lazy<Name>.
const unlazy = (name: string) => name.replace(/^Lazy/, '')
const has = (name: string) => Object.hasOwn(collectionForms, unlazy(name))

const resolution = computed(() =>
  resolveFormChain(props.collection, props.action, has)
)

const isGenericDetail = computed(() => {
  const r = resolution.value
  return r.kind === 'component' && !!r.generic
})

const currentComponent = computed(() => {
  const r = resolution.value
  return r.kind === 'component' ? collectionForms[unlazy(r.name)] : null
})

// Determine mode based on route context
const route = useRoute()
const mode = computed(() => {
  // Only set mode for translationsUi collection
  if (props.collection === 'translationsUi') {
    return route.path.includes('/super-admin/') ? 'system' : 'team'
  }
  return undefined
})

// Combine all props to pass through to the dynamic component
const componentProps = computed(() => {
  // CroutonDetail expects { item, collection } instead of form-oriented props
  if (isGenericDetail.value) {
    return {
      item: props.activeItem,
      collection: props.collection,
      ...useAttrs()
    }
  }

  const baseProps = {
    collection: props.collection,
    loading: props.loading,
    action: props.action,
    items: props.items,
    activeItem: props.activeItem,
    ...useAttrs() // Also include any additional attrs that might be passed
  }

  // Add mode prop for translationsUi collection
  if (mode.value !== undefined) {
    ;(baseProps as any).mode = mode.value
  }

  return baseProps
})
</script>
