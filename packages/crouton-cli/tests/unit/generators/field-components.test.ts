import { describe, it, expect } from 'vitest'
import { generateFieldComponents } from '../../../lib/generators/field-components.ts'

// Repeater item inputs (#2286, table 1b): the manifest decides the control for a
// repeater property exactly as it does for a top-level field. loadFields attaches
// `component` to each `meta.properties[*]`; the generator renders that. Owner
// decision 2026-10-16: booleans are UCheckbox everywhere (repeaters included) —
// the old private map rendered USwitch here and UCheckbox in forms.
const collectionData = { pascalCase: 'Location', pascalCasePlural: 'Locations', layerPascalCase: 'Bookings' }

function repeater(properties: Record<string, any>, extraMeta: Record<string, any> = {}) {
  return { name: 'slots', type: 'repeater', component: 'CroutonFormRepeater', meta: { properties, ...extraMeta } }
}

describe('repeater item Input.vue renders the manifest component', () => {
  it('renders a boolean property as UCheckbox when the manifest says so', () => {
    const { input } = generateFieldComponents(repeater({ active: { type: 'boolean', component: 'UCheckbox' } }), collectionData)
    expect(input).toContain('<UCheckbox v-model="model.active"')
    expect(input).not.toContain('USwitch')
  })

  it('renders a date property as CroutonCalendar with the v-model:date binding', () => {
    const { input } = generateFieldComponents(repeater({ when: { type: 'date', component: 'CroutonCalendar' } }), collectionData)
    expect(input).toContain('<CroutonCalendar v-model:date="model.when"')
  })

  it('keeps the number/text presets and falls back to UInput without a component', () => {
    const { input } = generateFieldComponents(repeater({
      qty: { type: 'number', component: 'UInputNumber', min: 0 },
      note: { type: 'text', component: 'UTextarea' },
      raw: { type: 'string' }
    }), collectionData)
    expect(input).toContain('<UInputNumber')
    expect(input).toContain(':min="0"')
    expect(input).toContain('<UTextarea')
    expect(input).toContain('<UInput\n          v-model="model.raw"')
  })

  it('translatable repeater: a non-translatable boolean property renders UCheckbox too', () => {
    const { input } = generateFieldComponents(repeater(
      { label: { type: 'string', component: 'UInput' }, active: { type: 'boolean', component: 'UCheckbox' } },
      { translatableProperties: ['label'] }
    ), collectionData)
    expect(input).toContain('<UCheckbox')
    expect(input).toContain('v-model="model.active"')
    expect(input).not.toContain('USwitch')
  })
})
