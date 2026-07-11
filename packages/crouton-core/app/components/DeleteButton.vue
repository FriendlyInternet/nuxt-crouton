<!--
  CroutonDeleteButton
  Two-step pill delete (originated in crouton-triage's flow rows): idle shows a
  trash icon that expands to a "delete" label on hover; the first click arms it
  ("sure?"), the second click emits `confirm`. Moving the pointer away disarms.

  Props:
  - loading  — shows a spinner and ignores clicks (parent performs the delete)
  - expanded — always show the label (for form footers; collapsed icon-pill
               hover-expand needs a pointer, so touch-first surfaces want this)
-->
<script setup lang="ts">
const props = withDefaults(defineProps<{
  loading?: boolean
  expanded?: boolean
}>(), {
  loading: false,
  expanded: false
})

const emit = defineEmits<{ confirm: [] }>()
const { t } = useT()

const armed = ref(false)

function handleClick() {
  if (props.loading) return
  if (!armed.value) {
    armed.value = true
    return
  }
  armed.value = false
  emit('confirm')
}

function disarm() {
  if (!props.loading) armed.value = false
}
</script>

<template>
  <!-- UButton (not raw) so themes reach it (#1410). Explicit soft variant:
       quiet destructive chrome — neutral while idle-collapsed, error once the
       label shows. Free height (min-h-7, no fixed h) so it stretches to match
       neighbors in a `flex items-stretch` row. -->
  <UButton
    :color="armed || loading || expanded ? 'error' : 'neutral'"
    variant="soft"
    class="group/del min-h-7 flex-shrink-0 justify-center transition-all"
    :class="[
      armed || loading
        ? 'px-3 bg-error/20'
        : expanded
          ? 'px-3'
          : 'w-7 h-7 p-0 hover:!w-auto hover:!px-2.5 text-muted hover:!bg-error/20 hover:!text-error'
    ]"
    @click.stop="handleClick"
    @mouseleave="disarm"
  >
    <UIcon v-if="loading" name="i-lucide-loader-2" class="size-3.5 animate-spin" />
    <span v-else-if="armed" class="text-sm font-medium whitespace-nowrap">{{ t('deleteConfirm.sure') }}</span>
    <template v-else-if="expanded">
      <span class="text-sm font-medium whitespace-nowrap">{{ t('common.delete') }}</span>
    </template>
    <template v-else>
      <UIcon name="i-lucide-trash-2" class="size-3.5 group-hover/del:hidden" />
      <span class="hidden group-hover/del:inline text-xs font-medium whitespace-nowrap">{{ t('common.delete') }}</span>
    </template>
  </UButton>
</template>
