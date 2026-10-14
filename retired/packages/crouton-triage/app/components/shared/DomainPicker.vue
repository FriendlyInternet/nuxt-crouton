<script setup lang="ts">
interface Props {
  modelValue: string[]
  /** Allow adding new domains via text input */
  creatable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  creatable: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const DEFAULT_DOMAINS = ['design', 'frontend', 'backend', 'product', 'infrastructure', 'docs']

const isAdding = ref(false)
const newDomain = ref('')
const inputRef = ref<HTMLInputElement>()

const allDomains = computed(() => {
  const set = new Set([...DEFAULT_DOMAINS, ...props.modelValue])
  return [...set]
})

function isSelected(domain: string) {
  return props.modelValue.includes(domain)
}

function toggle(domain: string) {
  const selected = [...props.modelValue]
  const idx = selected.indexOf(domain)
  if (idx >= 0) {
    selected.splice(idx, 1)
  } else {
    selected.push(domain)
  }
  emit('update:modelValue', selected)
}

function startAdding() {
  isAdding.value = true
  newDomain.value = ''
  nextTick(() => inputRef.value?.focus())
}

function commitDomain() {
  const domain = newDomain.value.toLowerCase().trim()
  if (domain) {
    if (!allDomains.value.includes(domain)) {
      emit('update:modelValue', [...props.modelValue, domain])
    } else if (!isSelected(domain)) {
      emit('update:modelValue', [...props.modelValue, domain])
    }
  }
  isAdding.value = false
  newDomain.value = ''
}

function cancelAdding() {
  isAdding.value = false
  newDomain.value = ''
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <UBadge
      v-for="domain in allDomains"
      :key="domain"
      size="md"
      :color="isSelected(domain) ? 'primary' : 'neutral'"
      :variant="isSelected(domain) ? 'solid' : 'outline'"
      class="cursor-pointer select-none transition-colors"
      @click="toggle(domain)"
    >
      {{ domain }}
    </UBadge>

    <!-- Inline add: input styled as a badge -->
    <UBadge
      v-if="creatable"
      size="md"
      color="neutral"
      variant="outline"
      class="cursor-pointer select-none transition-opacity"
      :class="isAdding ? 'opacity-100 px-0' : 'opacity-60 hover:opacity-100'"
      @click="startAdding"
    >
      <UIcon v-if="!isAdding" name="i-lucide-plus" class="w-3 h-3" />
      <input
        v-else
        ref="inputRef"
        v-model="newDomain"
        class="text-sm bg-transparent outline-none w-[80px] placeholder:text-muted-foreground/40 px-1"
        placeholder="type..."
        @keydown.enter.prevent="commitDomain"
        @keydown.escape="cancelAdding"
        @blur="commitDomain"
        @click.stop
      />
    </UBadge>
  </div>
</template>