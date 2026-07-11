<script setup lang="ts">
/**
 * Team Theme Settings Component
 *
 * Form for customizing team visual appearance.
 * Supports named presets (e.g. Black & White) or fully custom color/radius.
 *
 * When @fyit/crouton-themes is active, also shows the global theme switcher
 * (ko/minimal/kr11) so changes are reflected here in real-time.
 */
import {
  PRIMARY_COLORS,
  NEUTRAL_COLORS,
  DEFAULT_THEME,
  THEME_PRESETS,
  useAvailableThemePresets,
  type ThemePreset,
  type TeamThemeSettings
} from '../composables/useTeamTheme'

const emit = defineEmits<{
  saved: [settings: TeamThemeSettings]
}>()

const { t } = useT()
const { isAdmin } = useTeam()
const notify = useNotify()
const { theme, isLoading, updateTheme, applyTheme } = useTeamTheme()

// Local form state for live preview
const localTheme = reactive<TeamThemeSettings>({
  preset: undefined,
  primary: undefined,
  neutral: undefined,
  radius: undefined,
  allowUserThemes: true
})

// Sync local state with fetched theme
watch(theme, (newTheme) => {
  localTheme.preset = newTheme.preset
  localTheme.primary = newTheme.primary
  localTheme.neutral = newTheme.neutral
  localTheme.radius = newTheme.radius
  localTheme.allowUserThemes = newTheme.allowUserThemes
}, { immediate: true })

// Track if form has unsaved changes
const hasChanges = computed(() => {
  return (
    localTheme.preset !== theme.value.preset
    || localTheme.primary !== theme.value.primary
    || localTheme.neutral !== theme.value.neutral
    || localTheme.radius !== theme.value.radius
    || localTheme.allowUserThemes !== theme.value.allowUserThemes
  )
})

// Whether the current selection is custom (no named preset)
const isCustom = computed(() =>
  !localTheme.preset || localTheme.preset === 'custom'
)

// Saving state
const isSaving = ref(false)

// Apply live preview whenever local theme changes
watch(localTheme, (newTheme) => {
  applyTheme(newTheme)
}, { deep: true })

// Select a preset
function selectPreset(preset: ThemePreset) {
  localTheme.preset = preset
}

// Handle save
async function handleSave() {
  if (!isAdmin.value) {
    notify.error(t('themeSettings.adminRequired'), { description: t('themeSettings.adminRequiredDescription') })
    return
  }

  isSaving.value = true
  try {
    const saved = await updateTheme({
      preset: localTheme.preset,
      primary: localTheme.primary,
      neutral: localTheme.neutral,
      radius: localTheme.radius
    })

    notify.success(t('themeSettings.saved'), { icon: 'i-lucide-palette' })

    emit('saved', saved)
  }
  catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('common.error')
    notify.error(t('common.error'), { description: message })
  }
  finally {
    isSaving.value = false
  }
}

// Handle reset to defaults
function handleReset() {
  localTheme.preset = DEFAULT_THEME.preset
  localTheme.primary = DEFAULT_THEME.primary
  localTheme.neutral = DEFAULT_THEME.neutral
  localTheme.radius = DEFAULT_THEME.radius
  localTheme.allowUserThemes = true
}

// Revert to last saved values
function revertChanges() {
  localTheme.preset = theme.value.preset
  localTheme.primary = theme.value.primary
  localTheme.neutral = theme.value.neutral
  localTheme.radius = theme.value.radius
  localTheme.allowUserThemes = theme.value.allowUserThemes
}

// Only presets whose theme layer this app actually extends (#1332) — a
// preset without its layer would apply palette-only (inert classes).
const availablePresets = useAvailableThemePresets()
const presetEntries = computed(() =>
  Object.entries(availablePresets.value) as [ThemePreset, (typeof THEME_PRESETS)['custom']][]
)
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-lg font-semibold">
        {{ $t('themeSettings.title') }}
      </h3>
      <p class="text-sm text-muted mt-1">
        {{ $t('themeSettings.description') }}
      </p>
    </div>

    <!-- Allow users to switch themes -->
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-default">{{ $t('themeSettings.allowUserThemes') }}</p>
        <p class="text-xs text-muted mt-0.5">
          {{ $t('themeSettings.allowUserThemesDescription') }}
        </p>
      </div>
      <USwitch
        v-model="localTheme.allowUserThemes"
        :disabled="!isAdmin || isSaving"
      />
    </div>

    <USeparator />

    <!-- Loading State -->
    <div
      v-if="isLoading"
      class="flex items-center justify-center py-8"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="size-6 animate-spin text-muted"
      />
    </div>

    <template v-else>
      <!-- Two-column layout: controls left, preview right -->
      <div class="flex gap-8 items-start">
        <!-- Left: Selection Controls -->
        <div class="flex-1 min-w-0 space-y-5">
          <!-- Preset Picker (vertical) -->
          <div class="space-y-2">
            <label class="text-sm font-medium text-default">{{ $t('themeSettings.preset') }}</label>
            <!-- Preset cards — UButton (not raw buttons) so themes reach the
                 theme picker itself (#1410); selection ring wins via class merge -->
            <div class="flex flex-col gap-2">
              <UButton
                v-for="[key, preset] in presetEntries"
                :key="key"
                color="neutral"
                variant="outline"
                :disabled="!isAdmin || isSaving"
                class="relative w-full justify-start gap-3 p-3 text-left transition-colors"
                :class="(localTheme.preset === key) || (key === 'custom' && !localTheme.preset)
                  ? 'ring-primary bg-primary/5'
                  : 'hover:bg-elevated/50'"
                @click="selectPreset(key)"
              >
                <div class="flex shrink-0 gap-1">
                  <span
                    class="size-4 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                    :style="{ background: preset.previewPrimary }"
                  />
                  <span
                    class="size-4 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                    :style="{ background: preset.previewNeutral }"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium text-default">
                    {{ preset.label }}
                  </div>
                  <div class="text-xs text-muted truncate">
                    {{ preset.description }}
                  </div>
                </div>
                <UIcon
                  v-if="(localTheme.preset === key) || (key === 'custom' && !localTheme.preset)"
                  name="i-lucide-check-circle"
                  class="size-4 text-primary shrink-0"
                />
              </UButton>
            </div>
          </div>

          <!-- Individual pickers (only when custom) -->
          <template v-if="isCustom">
            <USeparator />

            <TeamColorSwatchPicker
              v-model="localTheme.primary"
              :colors="PRIMARY_COLORS"
              :label="$t('themeSettings.primaryColor')"
              :disabled="!isAdmin || isSaving"
            />

            <TeamColorSwatchPicker
              v-model="localTheme.neutral"
              :colors="NEUTRAL_COLORS"
              :label="$t('themeSettings.neutralColor')"
              :disabled="!isAdmin || isSaving"
            />

            <TeamRadiusPicker
              v-model="localTheme.radius"
              :disabled="!isAdmin || isSaving"
            />
          </template>
        </div>

        <!-- Right: Live Preview -->
        <div class="w-64 shrink-0 space-y-2 sticky top-4">
          <label class="text-sm font-medium text-default">{{ $t('themeSettings.livePreview') }}</label>
          <div class="p-4 border border-muted rounded-lg bg-muted/10 space-y-4">
            <div class="flex flex-wrap gap-2">
              <UButton
                color="primary"
                size="sm"
              >
                Primary
              </UButton>
              <UButton
                color="primary"
                variant="outline"
                size="sm"
              >
                Outline
              </UButton>
              <UButton
                color="primary"
                variant="soft"
                size="sm"
              >
                Soft
              </UButton>
              <UButton
                color="primary"
                variant="ghost"
                size="sm"
              >
                Ghost
              </UButton>
            </div>
            <div class="flex flex-wrap gap-2">
              <UBadge color="primary">
                Badge
              </UBadge>
              <UBadge
                color="primary"
                variant="outline"
              >
                Outline
              </UBadge>
              <UBadge
                color="primary"
                variant="soft"
              >
                Soft
              </UBadge>
            </div>
            <UInput
              placeholder="Sample input..."
              icon="i-lucide-search"
            />
          </div>
        </div>
      </div>

      <USeparator />

      <!-- Actions -->
      <div class="flex justify-between items-center">
        <UButton
          variant="ghost"
          color="neutral"
          :disabled="isSaving"
          @click="handleReset"
        >
          {{ $t('themeSettings.resetToDefaults') }}
        </UButton>

        <div class="flex gap-3">
          <UButton
            variant="ghost"
            :disabled="isSaving || !hasChanges"
            @click="revertChanges"
          >
            {{ $t('common.cancel') }}
          </UButton>
          <UButton
            color="primary"
            :loading="isSaving"
            :disabled="!hasChanges || !isAdmin"
            @click="handleSave"
          >
            {{ $t('common.saveChanges') }}
          </UButton>
        </div>
      </div>

      <!-- Admin Warning -->
      <UAlert
        v-if="!isAdmin"
        color="warning"
        icon="i-lucide-shield-alert"
        :title="$t('themeSettings.adminRequired')"
        :description="$t('themeSettings.adminRequiredDescription')"
      />
    </template>
  </div>
</template>
