import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, watch, onMounted, nextTick, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createRequire } from 'node:module'
import { collectionForms } from './mocks/collection-forms'

vi.mock('@vueuse/integrations/useSortable', () => ({ useSortable: () => {} }))
vi.mock('nanoid', () => ({ nanoid: () => 'x' }))

// The SFC relies on Nuxt auto-imports
Object.assign(globalThis, {
  ref, computed, watch, onMounted, nextTick,
  useT: () => ({ t: (k: string, p?: any) => (p?.name ? `${k}:${p.name}` : k) })
})

const guard = createRequire(import.meta.url)('../../../../../e2e/console-guard.cjs')

const stubs = {
  UCard: { template: '<div><slot /></div>' },
  UButton: true,
  UIcon: true,
  UAlert: { props: ['title'], template: '<div :data-testid="$attrs[\'data-testid\']">{{ title }}</div>' }
}

async function mountRepeater(componentName: string) {
  const FormRepeater = (await import('../FormRepeater.vue')).default
  return mount(FormRepeater, {
    props: { modelValue: [{ id: 'a' }], componentName },
    global: { stubs }
  })
}

describe('FormRepeater', () => {
  beforeEach(() => {
    collectionForms.KnownInput = { props: ['modelValue'], render: () => h('span', { class: 'known' }, 'known') }
    vi.restoreAllMocks()
  })

  it('shows a visible fallback for an unknown component name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = await mountRepeater('MisspelledInput')
    const notice = w.find('[data-testid="repeater-missing-component"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('MisspelledInput')
  })

  it('warns with text the e2e console guard fails on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountRepeater('MisspelledInput')
    const text = warn.mock.calls.map(c => String(c[0])).find(m => m.includes('[CroutonFormRepeater] Failed to resolve component: MisspelledInput'))
    expect(text).toBeTruthy()
    expect(guard.evaluate([{ type: 'warning', text, url: 'x' }])).toHaveLength(1)
  })

  it('renders a known component unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = await mountRepeater('KnownInput')
    expect(w.find('.known').exists()).toBe(true)
    expect(w.find('[data-testid="repeater-missing-component"]').exists()).toBe(false)
    expect(warn.mock.calls.some(c => String(c[0]).includes('CroutonFormRepeater'))).toBe(false)
  })
})
