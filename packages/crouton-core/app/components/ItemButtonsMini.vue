<template>
  <div :class="containerClasses">
    <!-- VIEW -->
    <div v-if="view">
      <!-- With tooltip (always show when disabled) -->
      <UTooltip
        v-if="effectiveViewTooltip.length > 0 || disabled"
        :popper="{ placement: 'left', arrow: false }"
      >
        <template #text>
          <span class="italic">{{ effectiveViewTooltip || t('table.previewOnly') }}</span>
        </template>

        <UButton
          :loading="viewLoading"
          :disabled="disabled"
          icon="i-lucide-eye"
          color="neutral"
          variant="soft"
          size="xs"
          :class="buttonClasses"
          @click="!disabled && $emit('view')"
        />
      </UTooltip>

      <!-- Without tooltip -->
      <UButton
        v-else
        :loading="viewLoading"
        :disabled="disabled"
        icon="i-lucide-eye"
        color="neutral"
        variant="soft"
        size="xs"
        :class="buttonClasses"
        @click="!disabled && $emit('view')"
      />
    </div>

    <!-- DELETE -->
    <div v-if="delete">
      <!-- With tooltip (always show when disabled) -->
      <UTooltip
        v-if="effectiveDeleteTooltip.length > 0 || disabled"
        :popper="{ placement: 'left', arrow: false }"
      >
        <template #text>
          <span class="italic">{{ effectiveDeleteTooltip || t('table.previewOnly') }}</span>
        </template>

        <UButton
          :loading="deleteLoading"
          :disabled="disabled"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          size="xs"
          :class="buttonClasses"
          @click="!disabled && $emit('delete')"
        />
      </UTooltip>

      <!-- Without tooltip -->
      <UButton
        v-else
        :loading="deleteLoading"
        :disabled="disabled"
        icon="i-lucide-trash-2"
        color="error"
        variant="soft"
        size="xs"
        :class="buttonClasses"
        @click="!disabled && $emit('delete')"
      />
    </div>

    <!-- UPDATE -->
    <div v-if="update">
      <!-- With tooltip (always show when disabled) -->
      <UTooltip
        v-if="effectiveUpdateTooltip.length > 0 || disabled"
        :popper="{ placement: 'left', arrow: false }"
      >
        <template #text>
          <span class="italic">{{ effectiveUpdateTooltip || t('table.previewOnly') }}</span>
        </template>
        <UButton
          :loading="updateLoading"
          :disabled="disabled"
          icon="i-lucide-pencil"
          color="neutral"
          size="xs"
          :class="buttonClasses"
          @click="!disabled && $emit('update')"
        />
      </UTooltip>
      <!-- Without tooltip -->
      <UButton
        v-else
        :loading="updateLoading"
        :disabled="disabled"
        icon="i-lucide-pencil"
        color="primary"
        variant="soft"
        size="xs"
        :class="buttonClasses"
        @click="!disabled && $emit('update')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useT()

const props = defineProps({
  view: {
    type: Boolean,
    default: false
  },
  delete: {
    type: Boolean,
    default: false
  },
  update: {
    type: Boolean,
    default: false
  },
  buttonClasses: {
    type: String,
    default: ''
  },
  containerClasses: {
    type: String,
    default: 'flex flex-row gap-2'
  },
  viewTooltip: {
    type: String,
    default: ''
  },
  updateTooltip: {
    type: String,
    default: ''
  },
  deleteTooltip: {
    type: String,
    default: ''
  },
  viewLoading: {
    type: Boolean,
    default: false
  },
  updateLoading: {
    type: Boolean,
    default: false
  },
  deleteLoading: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  disabledTooltip: {
    type: String,
    default: ''
  }
})

// Use disabled tooltip when disabled, otherwise use button-specific tooltip
const effectiveViewTooltip = computed(() => props.disabled && props.disabledTooltip ? props.disabledTooltip : props.viewTooltip)
const effectiveUpdateTooltip = computed(() => props.disabled && props.disabledTooltip ? props.disabledTooltip : props.updateTooltip)
const effectiveDeleteTooltip = computed(() => props.disabled && props.disabledTooltip ? props.disabledTooltip : props.deleteTooltip)
</script>
