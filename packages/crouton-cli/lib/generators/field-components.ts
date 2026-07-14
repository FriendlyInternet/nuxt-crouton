// Generator for Field component folder (Input.vue, Select.vue, CardMini.vue)
import { toCase } from '../utils/helpers.ts'

/**
 * Generate field-specific components for dependent field rendering
 * Creates [FieldName]/Input.vue, Select.vue, and CardMini.vue
 *
 * @param {string|object} fieldOrName - Field name string or field object
 * @param {object} collectionData - Collection data with layer info
 */
export function generateFieldComponents(fieldOrName: string | Record<string, any>, collectionData: Record<string, any>): { input: string; select: string; cardMini: string } {
  // Support both old signature (fieldName string) and new signature (field object)
  const field = typeof fieldOrName === 'object' ? fieldOrName : { name: fieldOrName }
  const fieldName = field.name
  const { pascalCase: fieldPascalCase } = toCase(fieldName)
  const { pascalCase, pascalCasePlural, layerPascalCase } = collectionData

  // Check if this field has translatable properties
  const hasTranslatableProperties = field.meta?.translatableProperties?.length > 0

  return {
    input: hasTranslatableProperties
      ? generateTranslatableInputComponent(field, fieldPascalCase, collectionData)
      : generateInputComponent(field, fieldPascalCase, collectionData),
    select: generateSelectComponent(fieldName, fieldPascalCase, collectionData),
    cardMini: generateCardMiniComponent(fieldName, fieldPascalCase, collectionData)
  }
}

/**
 * Generate Input.vue - for editing a single item (used as repeater item component)
 * When meta.properties is defined, generates typed interface and proper form fields.
 * Otherwise falls back to a simple label-only stub.
 */
function generateInputComponent(field: Record<string, any>, fieldPascalCase: string, collectionData: Record<string, any>): string {
  const { layerPascalCase, pascalCasePlural } = collectionData
  const interfaceName = `${layerPascalCase}${pascalCasePlural}${fieldPascalCase}Item`
  const properties = field.meta?.properties || {}
  const hasProperties = Object.keys(properties).length > 0

  // Generate interface fields from schema properties
  const interfaceFields = ['id: string']
  if (hasProperties) {
    for (const [propName, propDef] of Object.entries(properties)) {
      const tsType = mapPropertyTypeToTS((propDef as any).type)
      const optional = (propDef as any).required !== true ? '?' : ''
      interfaceFields.push(`${propName}${optional}: ${tsType}`)
    }
  } else {
    interfaceFields.push('label?: string', 'value?: string')
  }

  // Generate template form fields
  const formFields = []
  if (hasProperties) {
    for (const [propName, propDef] of Object.entries(properties)) {
      const def = propDef as any
      const label = def.label || capitalizeFirst(propName)
      const inputInfo = getInputInfoForProperty(def.type)

      if (inputInfo.component === 'UInputNumber') {
        const minAttr = def.min != null ? ` :min="${def.min}"` : ''
        const placeholder = def.default != null ? ` placeholder="${def.default}"` : ''
        formFields.push(`      <UFormField class="w-24">
        <UInputNumber
          v-model="model.${propName}"
          size="xl"${minAttr}${placeholder}
        />
      </UFormField>`)
      } else if (inputInfo.component === 'USwitch') {
        formFields.push(`      <UFormField>
        <USwitch v-model="model.${propName}" />
        <span class="text-sm ml-2">${label}</span>
      </UFormField>`)
      } else if (inputInfo.component === 'UTextarea') {
        formFields.push(`      <UFormField class="flex-1">
        <UTextarea
          v-model="model.${propName}"
          class="w-full"
          size="xl"
          placeholder="Enter ${label.toLowerCase()}"
        />
      </UFormField>`)
      } else {
        formFields.push(`      <UFormField class="flex-1">
        <UInput
          v-model="model.${propName}"
          class="w-full"
          size="xl"
          placeholder="Enter ${label.toLowerCase()}"
        />
      </UFormField>`)
      }
    }
  } else {
    formFields.push(`      <UFormField class="flex-1">
        <UInput
          v-model="model.label"
          class="w-full"
          size="xl"
          placeholder="Enter label"
        />
      </UFormField>`)
  }

  return `<script setup lang="ts">
import { nanoid } from 'nanoid'

interface ${interfaceName} {
  ${interfaceFields.join('\n  ')}
}

const model = defineModel<${interfaceName}>({ required: true })

// Ensure stable ID on first creation
if (model.value && !model.value.id) {
  model.value = { ...model.value, id: nanoid() }
}
</script>

<template>
  <div class="flex items-center gap-2 w-full">
${formFields.join('\n')}
  </div>
</template>
`
}

/**
 * Generate translatable Input.vue - for editing items with translations
 * When meta.translatableProperties is present, generates component with:
 * - Language tabs [EN] [NL] [FR] with completion indicators
 * - getValue(prop) / setValue(prop, val) helpers
 * - Fallback placeholder showing English value
 * - Non-translatable fields only shown in English locale
 */
function generateTranslatableInputComponent(field: Record<string, any>, fieldPascalCase: string, collectionData: Record<string, any>): string {
  const { layerPascalCase, pascalCasePlural, layerCamelCase } = collectionData
  const interfaceName = `${layerPascalCase}${pascalCasePlural}${fieldPascalCase}Item`

  const translatableProps = field.meta?.translatableProperties || []
  const properties = field.meta?.properties || {}

  // Generate interface fields
  const interfaceFields = ['id: string']
  for (const [propName, propDef] of Object.entries(properties)) {
    const tsType = mapPropertyTypeToTS(propDef.type)
    const optional = propDef.required !== true ? '?' : ''
    interfaceFields.push(`${propName}${optional}: ${tsType}`)
  }

  // Add translations interface with index signature for dynamic access
  if (translatableProps.length > 0) {
    // Use Record type for dynamic property access in getValue/setValue functions
    interfaceFields.push(`translations?: Record<string, Record<string, string>>`)
  }

  // Generate form fields for English locale
  const englishFormFields = []
  for (const [propName, propDef] of Object.entries(properties)) {
    const isTranslatable = translatableProps.includes(propName)
    const label = propDef.label || capitalizeFirst(propName)
    const isRequired = propDef.required === true

    if (isTranslatable) {
      // Translatable field - shown in all locales with translation support
      englishFormFields.push(generateTranslatableFormField(propName, label, propDef, isRequired))
    } else {
      // Non-translatable field - only shown when editing English
      englishFormFields.push(generateNonTranslatableFormField(propName, label, propDef, isRequired))
    }
  }

  return `<script setup lang="ts">
/**
 * Translatable repeater item component
 * Supports multiple languages with item-level translations
 */
import { nanoid } from 'nanoid'

interface ${interfaceName} {
  ${interfaceFields.join('\n  ')}
}

const model = defineModel<${interfaceName}>({ required: true })

const { locale, locales } = useI18n()

// Track which locale we're editing
const editingLocale = ref(locale.value)

// Ensure stable ID on first creation
if (model.value && !model.value.id) {
  model.value = { ...model.value, id: nanoid() }
}

// Get value for a property (respects current editing locale)
function getValue(propName: string): string {
  if (!model.value) return ''

  if (editingLocale.value === 'en') {
    return (model.value as any)[propName] || ''
  }

  // Return translated value or empty string
  return model.value.translations?.[propName]?.[editingLocale.value] || ''
}

// Set value for a property (respects current editing locale)
function setValue(propName: string, value: string) {
  if (!model.value) return

  if (editingLocale.value === 'en') {
    // English is stored in the main property
    model.value = {
      ...model.value,
      [propName]: value
    }
  } else {
    // Other languages stored in translations
    const currentTranslations = model.value.translations || {}
    const propTranslations = { ...(currentTranslations[propName] || {}) }

    if (value) {
      propTranslations[editingLocale.value] = value
    } else {
      delete propTranslations[editingLocale.value]
    }

    model.value = {
      ...model.value,
      translations: {
        ...currentTranslations,
        [propName]: propTranslations
      }
    }
  }
}

// Check if a locale has a translation for a property
function hasTranslation(propName: string, localeCode: string): boolean {
  if (!model.value) return false

  if (localeCode === 'en') {
    return !!((model.value as any)[propName]?.trim?.())
  }
  return !!(model.value.translations?.[propName]?.[localeCode]?.trim?.())
}

// Check if a locale has ALL required translations
function localeComplete(localeCode: string): boolean {
  const requiredProps = ${JSON.stringify(translatableProps.filter(p => properties[p]?.required))}
  if (requiredProps.length === 0) return true
  return requiredProps.every(prop => hasTranslation(prop, localeCode))
}

// Get English value for fallback display
function getEnglishValue(propName: string): string {
  if (!model.value) return ''
  return (model.value as any)[propName] || ''
}
</script>

<template>
  <div class="space-y-3">
    <!-- Language selector -->
    <div class="flex items-center gap-1">
      <UButton
        v-for="loc in locales"
        :key="typeof loc === 'string' ? loc : loc.code"
        :variant="editingLocale === (typeof loc === 'string' ? loc : loc.code) ? 'solid' : 'ghost'"
        :color="editingLocale === (typeof loc === 'string' ? loc : loc.code) ? 'primary' : 'neutral'"
        size="xs"
        @click="editingLocale = typeof loc === 'string' ? loc : loc.code"
      >
        <span class="flex items-center gap-1">
          {{ (typeof loc === 'string' ? loc : loc.code).toUpperCase() }}
          <UIcon
            v-if="localeComplete(typeof loc === 'string' ? loc : loc.code)"
            name="i-lucide-check"
            class="w-3 h-3 text-success"
          />
        </span>
      </UButton>
    </div>

${englishFormFields.join('\n\n')}
  </div>
</template>
`
}

/**
 * Generate form field markup for a translatable property
 */
function generateTranslatableFormField(propName: string, label: string, propDef: Record<string, any>, isRequired: boolean): string {
  const inputType = propDef.type === 'text' ? 'UTextarea' : 'UInput'
  const placeholder = propDef.placeholder || `Enter ${label.toLowerCase()}`

  // Generate proper label with optional required asterisk
  const labelExpr = isRequired
    ? `\`${label} (\${editingLocale.toUpperCase()})\${editingLocale === 'en' ? ' *' : ''}\``
    : `\`${label} (\${editingLocale.toUpperCase()})\``

  return `    <!-- ${label} (translatable) -->
    <UFormField
      :label="${labelExpr}"
      ${isRequired ? `:required="editingLocale === 'en'"` : ''}
    >
      <${inputType}
        :model-value="getValue('${propName}')"
        :placeholder="editingLocale !== 'en' && getEnglishValue('${propName}')
          ? \`Fallback: \${getEnglishValue('${propName}')}\`
          : '${placeholder}'"
        class="w-full"
        @update:model-value="setValue('${propName}', $event)"
      />
      <template v-if="editingLocale !== 'en' && getEnglishValue('${propName}')" #hint>
        <span class="text-xs text-muted">English: {{ getEnglishValue('${propName}') }}</span>
      </template>
    </UFormField>`
}

/**
 * Generate form field markup for a non-translatable property
 */
function generateNonTranslatableFormField(propName: string, label: string, propDef: Record<string, any>, isRequired: boolean): string {
  const inputType = getInputTypeForProperty(propDef.type)
  const placeholder = propDef.placeholder || `Enter ${label.toLowerCase()}`

  // Non-translatable fields only shown in English locale
  // Use v-if with model check to ensure model is defined before accessing properties
  return `    <!-- ${label} (non-translatable, English only) -->
    <UFormField
      v-if="editingLocale === 'en' && model"
      label="${label}"
      ${isRequired ? 'required' : ''}
    >
      <${inputType}
        v-model="model.${propName}"
        placeholder="${placeholder}"
        class="w-full"
      />
    </UFormField>`
}

/**
 * Get appropriate input component for property type (legacy, used by translatable generator)
 */
function getInputTypeForProperty(type: string): string {
  const inputMap: Record<string, string> = {
    string: 'UInput',
    text: 'UTextarea',
    number: 'UInputNumber',
    boolean: 'USwitch',
    date: 'UInput type="date"'
  }
  return inputMap[type] || 'UInput'
}

/**
 * Get component name for property type (clean, no inline attrs)
 */
function getInputInfoForProperty(type: string): { component: string } {
  const map: Record<string, string> = {
    string: 'UInput',
    text: 'UTextarea',
    number: 'UInputNumber',
    decimal: 'UInputNumber',
    boolean: 'USwitch',
    date: 'UInput'
  }
  return { component: map[type] || 'UInput' }
}

/**
 * Map property type to TypeScript type
 */
function mapPropertyTypeToTS(type: string): string {
  const typeMap = {
    string: 'string',
    text: 'string',
    number: 'number',
    decimal: 'number',
    boolean: 'boolean',
    date: 'Date | null',
    json: 'Record<string, any>',
    array: 'string[]'
  }
  return typeMap[type] || 'string'
}

/**
 * Capitalize first letter of a string
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Generate Select.vue - for selecting from options in dependent forms
 * Supports both single and multiple selection with array-based values
 * Uses CroutonFormDependentSelectOption for card-based rendering
 */
function generateSelectComponent(fieldName: string, fieldPascalCase: string, collectionData: Record<string, any>): string {
  const { layerPascalCase, layerCamelCase, pascalCasePlural } = collectionData
  // Build the dependent collection name for component resolution
  const dependentCollection = `${layerCamelCase}${pascalCasePlural}`

  return `<template>
  <div>
    <div v-if="pending" class="flex items-center gap-2 text-sm text-gray-500">
      <UIcon name="i-lucide-refresh-cw" class="animate-spin" />
      Loading options...
    </div>

    <div v-else-if="error" class="text-sm text-red-500">
      Failed to load options
    </div>

    <div v-else-if="!dependentValue" class="text-sm text-gray-500">
      {{ dependentLabel }} required
    </div>

    <div v-else-if="!options || options.length === 0" class="text-sm text-gray-500">
      No options available
    </div>

    <CroutonFormDependentSelectOption
      v-else
      v-model="localValue"
      :options="options"
      :multiple="multiple"
      dependent-collection="${dependentCollection}"
      dependent-field="${fieldName}"
      :card-variant="cardVariant"
    />
  </div>
</template>

<script setup lang="ts">
interface Option {
  id: string
  label: string
  value?: string
}

interface Props {
  modelValue?: string[] | null     // Array for consistent handling
  options?: Option[]
  pending?: boolean
  error?: any
  dependentValue?: string | null
  dependentLabel?: string
  multiple?: boolean               // Support multiple selection
  cardVariant?: string             // Card size: 'Mini', 'Medium', 'Huge', etc.
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  options: () => [],
  pending: false,
  error: null,
  dependentValue: null,
  dependentLabel: 'Selection',
  multiple: false,
  cardVariant: 'Mini'
})

const emit = defineEmits<{
  'update:modelValue': [value: string[] | null]
}>()

// Local model for v-model binding
const localValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})
</script>
`
}

/**
 * Generate CardMini.vue - for displaying the field in tables/lists
 * Handles both source collection (array of objects) and target collection (resolved objects)
 */
function generateCardMiniComponent(fieldName: string, fieldPascalCase: string, collectionData: Record<string, any>): string {
  return `<template>
  <div class="text-sm">
    <template v-if="normalizedValue.length > 0">
      <div class="flex flex-wrap gap-1">
        <UBadge
          v-for="(item, index) in normalizedValue.slice(0, 3)"
          :key="\`\${index}-\${item.value ?? item.label ?? item}\`"
          color="neutral"
          variant="subtle"
        >
          {{ item.label || item.value || item }}
        </UBadge>
        <UBadge v-if="normalizedValue.length > 3" color="neutral" variant="subtle">
          +{{ normalizedValue.length - 3 }} more
        </UBadge>
      </div>
    </template>
    <span v-else class="text-gray-400">—</span>
  </div>
</template>

<script setup lang="ts">
interface Props {
  value?: any[] | any | null  // Can be array of objects OR single object OR null
}

const props = defineProps<Props>()

// Normalize to array for consistent handling
// Handles both source (repeater with array) and target (dependent field with resolved objects)
const normalizedValue = computed(() => {
  if (!props.value) return []
  return Array.isArray(props.value) ? props.value : [props.value]
})
</script>
`
}
