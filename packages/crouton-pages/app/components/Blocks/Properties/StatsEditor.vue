<script setup lang="ts">
/**
 * Stats Items Editor
 *
 * Editor for managing stat items (value + label + prefix/suffix) in stats blocks.
 */
import type { StatItem } from '../../../types/blocks'

interface Props {
  modelValue: StatItem[]
}

const props = defineProps<Props>()
const { t } = useT()

const emit = defineEmits<{
  'update:modelValue': [value: StatItem[]]
}>()

const stats = ref<StatItem[]>([...props.modelValue])

watch(() => props.modelValue, (newVal) => {
  stats.value = [...newVal]
}, { deep: true })

function emitChange() {
  emit('update:modelValue', [...stats.value])
}

function addStat() {
  stats.value.push({
    value: 100,
    label: t('pages.blockEditors.newStat'),
    prefix: '',
    suffix: ''
  })
  emitChange()
}

function removeStat(index: number) {
  stats.value.splice(index, 1)
  emitChange()
}

function updateStat(index: number, field: keyof StatItem, value: any) {
  const parsed = field === 'value' ? Number(value) || 0 : value
  stats.value[index] = { ...stats.value[index], [field]: parsed } as StatItem
  emitChange()
}

function moveStat(index: number, direction: 'up' | 'down') {
  const newIndex = direction === 'up' ? index - 1 : index + 1
  if (newIndex < 0 || newIndex >= stats.value.length) return

  const temp = stats.value[index]!
  stats.value[index] = stats.value[newIndex]!
  stats.value[newIndex] = temp
  emitChange()
}
</script>

<template>
  <div class="stats-editor space-y-3">
    <div
      v-for="(stat, index) in stats"
      :key="index"
      class="p-3 border border-default rounded-lg space-y-2"
    >
      <!-- Header with move/delete -->
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">{{ t('pages.blockEditors.statN', { n: index + 1 }) }}</span>
        <div class="flex items-center gap-1">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-up"
            size="xs"
            :disabled="index === 0"
            @click="moveStat(index, 'up')"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-down"
            size="xs"
            :disabled="index === stats.length - 1"
            @click="moveStat(index, 'down')"
          />
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            size="xs"
            @click="removeStat(index)"
          />
        </div>
      </div>

      <!-- Value -->
      <UFormField :label="t('pages.blockEditors.value')">
        <UInput
          :model-value="String(stat.value)"
          type="number"
          :placeholder="t('pages.blockEditors.valuePlaceholder')"
          size="sm"
          @update:model-value="updateStat(index, 'value', $event)"
        />
      </UFormField>

      <!-- Label -->
      <UFormField :label="t('pages.blockEditors.label')">
        <UInput
          :model-value="stat.label"
          :placeholder="t('pages.blockEditors.labelPlaceholder')"
          size="sm"
          @update:model-value="updateStat(index, 'label', $event)"
        />
      </UFormField>

      <!-- Prefix + Suffix row -->
      <div class="grid grid-cols-2 gap-2">
        <UFormField :label="t('pages.blockEditors.prefix')">
          <UInput
            :model-value="stat.prefix || ''"
            :placeholder="t('pages.blockEditors.prefixPlaceholder')"
            size="sm"
            @update:model-value="updateStat(index, 'prefix', $event)"
          />
        </UFormField>
        <UFormField :label="t('pages.blockEditors.suffix')">
          <UInput
            :model-value="stat.suffix || ''"
            :placeholder="t('pages.blockEditors.suffixPlaceholder')"
            size="sm"
            @update:model-value="updateStat(index, 'suffix', $event)"
          />
        </UFormField>
      </div>
    </div>

    <!-- Add Button -->
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-plus"
      size="sm"
      block
      @click="addStat"
    >
      {{ t('pages.blockEditors.addStat') }}
    </UButton>
  </div>
</template>
