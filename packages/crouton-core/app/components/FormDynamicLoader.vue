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

// Registered-component check without resolveComponent's "failed to resolve" warning.
// Nuxt registers both <Name> and Lazy<Name>; prefer the lazy one so forms stay out of the entry chunk.
const instance = getCurrentInstance()
const lookup = (name: string): unknown => {
  const registry = instance?.appContext.components
  if (!registry) return undefined
  return registry[name] ? resolveComponent(name) : undefined
}
const isRegistered = (name: string) => {
  const found = lookup(name)
  return !!found && typeof found !== 'string'
}

const resolution = computed(() =>
  resolveFormChain(props.collection, props.action, name =>
    isRegistered(name) || isRegistered(name.replace(/^Lazy/, ''))
  )
)

const isGenericDetail = computed(() => {
  const r = resolution.value
  return r.kind === 'component' && !!r.generic
})

const currentComponent = computed(() => {
  const r = resolution.value
  if (r.kind !== 'component') return null
  const lazy = lookup(r.name)
  if (lazy && typeof lazy !== 'string') return lazy
  return lookup(r.name.replace(/^Lazy/, '')) as any
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
