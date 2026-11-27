<script setup lang="ts">
/**
 * Team Theme Settings Component
 *
 * Form for customizing team visual appearance.
 * Supports named presets (e.g. Black & White) or fully custom color/radius.
 *
 * Shows the preset list only when this app ships more than one preset (or the
 * team saved one) — see utils/theme-picker.ts.
 */
import type {
  THEME_PRESETS } from '../composables/useTeamTheme'
import {
  PRIMARY_COLORS,
  NEUTRAL_COLORS,
  DEFAULT_THEME,
  useAvailableThemePresets,
  type ThemePreset,
  type TeamThemeSettings
} from '../composables/useTeamTheme'
import { showPresetPicker, colorLabel, radiusLabel } from '../utils/theme-picker'

const emit = defineEmits<{
  saved: [settings: TeamThemeSettings]
}>()

const { t } = useT()
// Editing the team theme is the `site:manage` action (#4105)
const isAdmin = useCan('site:manage')
const { currentTeam } = useTeam()
const notify = useNotify()
const { theme, isLoading, error, refresh, updateTheme, applyTheme } = useTeamTheme()

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

// Buttons of the unsaved-changes bar (UAlert actions). `size: 'md'` because
// UAlert defaults action buttons to `xs`.
const saveBarActions = computed(() => [
  { label: t('themeSettings.undo'), color: 'neutral' as const, variant: 'ghost' as const, size: 'md' as const, disabled: isSaving.value, onClick: revertChanges },
  { label: t('common.saveChanges'), color: 'primary' as const, size: 'md' as const, loading: isSaving.value, disabled: !isAdmin.value, onClick: handleSave }
])

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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('common.error')
    notify.error(t('common.error'), { description: message })
  } finally {
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

// Template helpers — keep the branching here, not in the template
const controlsDisabled = computed(() => !isAdmin.value || isSaving.value)
const presetListVisible = computed(() => showPresetPicker(availablePresets.value, localTheme.preset))
const previewTitle = computed(() => currentTeam.value?.name || t('themeSettings.previewAppName'))
const mainColorHeading = computed(() =>
  `${t('themeSettings.mainColor')} · ${colorLabel(localTheme.primary ?? DEFAULT_THEME.primary)}`)
const greysHeading = computed(() =>
  `${t('themeSettings.greys')} · ${colorLabel(localTheme.neutral ?? DEFAULT_THEME.neutral)}`)
const cornersHeading = computed(() =>
  `${t('themeSettings.corners')} · ${radiusLabel(localTheme.radius ?? DEFAULT_THEME.radius, t)}`)

function isSelectedPreset(key: ThemePreset): boolean {
  return localTheme.preset === key || (key === 'custom' && !localTheme.preset)
}

function presetTitle(key: ThemePreset, preset: (typeof THEME_PRESETS)['custom']): string {
  return key === 'custom' ? t('themeSettings.presetCustom') : preset.label
}

function presetDescription(key: ThemePreset, preset: (typeof THEME_PRESETS)['custom']): string {
  return key === 'custom' ? t('themeSettings.presetCustomDescription') : preset.description
}
</script>

<template>
  <div class="@container space-y-6">
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
        <p class="text-sm font-medium text-default">
          {{ $t('themeSettings.allowUserThemes') }}
        </p>
        <p class="text-xs text-muted mt-0.5">
          {{ $t('themeSettings.allowUserThemesDescription') }}
        </p>
      </div>
      <USwitch
        v-model="localTheme.allowUserThemes"
        :disabled="controlsDisabled"
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

    <!-- Load failed: hide the controls so the default theme can't be saved over the real one (#4551) -->
    <UAlert
      v-else-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      :title="t('themeSettings.loadFailed')"
      :description="error"
      :actions="[{ label: t('common.retry'), color: 'error', variant: 'outline', onClick: () => { refresh() } }]"
    />

    <template v-else>
      <!-- Controls + preview: side by side when the pane is wide, stacked (preview on top) when narrow -->
      <div
        data-testid="team-theme-controls"
        class="flex flex-col @2xl:flex-row gap-6 @2xl:gap-8 @2xl:items-start"
      >
        <!-- Preview: first in the DOM (top on a narrow pane), right on a wide pane -->
        <div class="space-y-2 @2xl:order-last @2xl:w-64 @2xl:shrink-0 @2xl:sticky @2xl:top-4">
          <div class="border border-muted rounded-(--ui-radius) overflow-hidden">
            <div class="bg-primary text-inverted px-3 py-2 text-sm font-medium">
              {{ previewTitle }}
            </div>
            <div class="p-3 space-y-3">
              <UInput
                :placeholder="t('themeSettings.previewInput')"
                icon="i-lucide-search"
              />
              <div class="flex justify-between items-center text-sm">
                <span>{{ t('themeSettings.previewItemOne') }}</span>
                <UBadge
                  color="primary"
                  variant="soft"
                >
                  {{ t('themeSettings.previewSoft') }}
                </UBadge>
              </div>
              <div class="flex justify-between items-center text-sm">
                <span>{{ t('themeSettings.previewItemTwo') }}</span>
                <UBadge
                  color="primary"
                  variant="outline"
                >
                  {{ t('themeSettings.previewOutline') }}
                </UBadge>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton
                  color="primary"
                  size="sm"
                >
                  {{ t('themeSettings.previewPrimary') }}
                </UButton>
                <UButton
                  color="primary"
                  variant="outline"
                  size="sm"
                >
                  {{ t('themeSettings.previewOutline') }}
                </UButton>
              </div>
            </div>
          </div>
          <p class="text-xs text-muted">
            {{ t('themeSettings.previewCaption') }}
          </p>
        </div>

        <!-- Selection controls -->
        <div class="flex-1 min-w-0 space-y-5">
          <!-- Preset Picker (vertical) — only when there is a real choice -->
          <div
            v-if="presetListVisible"
            class="space-y-2"
          >
            <p class="text-sm font-medium text-default">
              {{ $t('themeSettings.preset') }}
            </p>
            <!-- Preset cards — UButton (not raw buttons) so themes reach the
                 theme picker itself (#1410); selection ring wins via class merge -->
            <div class="flex flex-col gap-2">
              <UButton
                v-for="[key, preset] in presetEntries"
                :key="key"
                color="neutral"
                variant="outline"
                :disabled="controlsDisabled"
                class="relative w-full justify-start gap-3 p-3 text-left transition-colors"
                :class="isSelectedPreset(key)
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
                    {{ presetTitle(key, preset) }}
                  </div>
                  <div class="text-xs text-muted truncate">
                    {{ presetDescription(key, preset) }}
                  </div>
                </div>
                <UIcon
                  v-if="isSelectedPreset(key)"
                  name="i-lucide-check-circle"
                  class="size-4 text-primary shrink-0"
                />
              </UButton>
            </div>
          </div>

          <!-- Individual pickers (only when custom) -->
          <template v-if="isCustom">
            <USeparator v-if="presetListVisible" />

            <div class="p-4 border border-muted rounded-lg space-y-2">
              <TeamColorSwatchPicker
                v-model="localTheme.primary"
                :colors="PRIMARY_COLORS"
                :label="mainColorHeading"
                :disabled="controlsDisabled"
              />
            </div>

            <div class="p-4 border border-muted rounded-lg space-y-2">
              <TeamColorSwatchPicker
                v-model="localTheme.neutral"
                :colors="NEUTRAL_COLORS"
                :label="greysHeading"
                :disabled="controlsDisabled"
              />
            </div>

            <div class="p-4 border border-muted rounded-lg space-y-2">
              <TeamRadiusPicker
                v-model="localTheme.radius"
                :label="cornersHeading"
                :disabled="controlsDisabled"
              />
            </div>
          </template>

          <UButton
            variant="link"
            color="neutral"
            size="xs"
            :disabled="isSaving"
            @click="handleReset"
          >
            {{ t('themeSettings.resetToDefaults') }}
          </UButton>
        </div>

      </div>

      <!-- Unsaved-changes bar: only while something differs from the saved theme -->
      <UAlert
        v-if="hasChanges"
        color="primary"
        variant="outline"
        orientation="horizontal"
        :title="t('themeSettings.unsavedChanges')"
        :actions="saveBarActions"
        class="sticky bottom-4 bg-default p-3"
        :ui="{
          root: 'flex-col items-stretch sm:flex-row sm:items-center',
          title: 'text-default font-sans',
          actions: 'justify-end gap-2'
        }"
      />

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
