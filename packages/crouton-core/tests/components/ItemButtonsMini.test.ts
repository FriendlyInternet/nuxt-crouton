import { describe, it, expect } from 'vitest'
import { computed } from 'vue'
import { mount } from '@vue/test-utils'

// The SFC relies on Nuxt auto-imports (useT, computed); useT interpolates so the name is visible
Object.assign(globalThis, {
  computed,
  useT: () => ({
    t: (k: string, o?: Record<string, string>) => o ? Object.values(o).join(' ') : k
  })
})

const stubs = {
  UButton: { inheritAttrs: false, template: '<button v-bind="$attrs"></button>' },
  UTooltip: {
    props: ['text', 'content'],
    template: '<div class="tooltip"><div class="tooltip-content"><slot name="content">{{ text }}</slot></div><slot /></div>'
  }
}

async function mountButtons(props: Record<string, any>) {
  const ItemButtonsMini = (await import('../../app/components/ItemButtonsMini.vue')).default
  return mount(ItemButtonsMini, { props, global: { stubs } })
}

describe('ItemButtonsMini', () => {
  // covers: T1
  it('gives each icon-only button an accessible name', async () => {
    const w = await mountButtons({ view: true, delete: true, update: true })
    const labels = w.findAll('button').map(b => b.attributes('aria-label'))
    expect(labels).toEqual(['common.view', 'common.delete', 'common.edit'])
  })

  // covers: T2
  it('includes the item name in every label', async () => {
    const w = await mountButtons({ view: true, delete: true, update: true, itemName: 'Summer fair' })
    const buttons = w.findAll('button')
    expect(buttons).toHaveLength(3)
    for (const b of buttons) expect(b.attributes('aria-label')).toContain('Summer fair')
  })

  // covers: T3
  it('renders the tooltip text in the v4 content slot', async () => {
    const w = await mountButtons({ update: true, updateTooltip: 'Edit it' })
    expect(w.find('.tooltip-content').text()).toContain('Edit it')
  })

  // covers: T4
  it('shows the preview-only fallback and disables every button when disabled', async () => {
    const w = await mountButtons({ view: true, delete: true, update: true, disabled: true })
    const tips = w.findAll('.tooltip-content')
    expect(tips).toHaveLength(3)
    for (const tip of tips) expect(tip.text()).toContain('table.previewOnly')
    const buttons = w.findAll('button')
    expect(buttons).toHaveLength(3)
    for (const b of buttons) expect(b.attributes('disabled')).toBeDefined()
  })
})
