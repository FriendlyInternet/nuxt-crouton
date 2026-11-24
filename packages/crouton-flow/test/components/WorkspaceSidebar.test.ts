import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, computed, Suspense } from 'vue'

const flowA = { id: 'a', name: 'Flow A', collection: 'x' }
const flowB = { id: 'b', name: 'Flow B', collection: 'y' }

// The SFC relies on Nuxt auto-imports
Object.assign(globalThis, {
  ref,
  computed,
  // Interpolating mock so the menu label carries the flow name
  useI18n: () => ({
    t: (k: string, p?: Record<string, unknown>) => (p?.name ? `${k}:${p.name}` : k)
  }),
  useTeamContext: () => ({ teamId: ref('t1') }),
  useFetch: async () => ({
    data: ref([flowA, flowB]),
    pending: ref(false),
    refresh: vi.fn()
  })
})

const stubs = {
  UInput: true,
  USkeleton: true,
  UIcon: true,
  UDropdownMenu: { template: '<div><slot /></div>' },
  // Mirrors Nuxt UI's UButton, which renders a native <button type="button"> by default
  UButton: { inheritAttrs: false, template: '<button type="button" v-bind="$attrs"><slot /></button>' }
}

async function mountSidebar(props: Record<string, any> = {}) {
  const Sidebar = (await import('../../app/components/Workspace/Sidebar.vue')).default
  let inner: any
  const w = mount(
    defineComponent({
      render: () => h(Suspense, null, {
        default: () => h(Sidebar as any, { ...props, ref: (el: any) => { inner = el } })
      })
    }),
    { global: { mocks: { $t: (k: string) => k }, stubs } }
  )
  await flushPromises()
  await flushPromises()
  return { w, sidebar: () => w.findComponent(Sidebar as any), inner: () => inner }
}

function selectButtons(w: any) {
  return w.findAll('li > button[type="button"]')
}

function selectButtonFor(w: any, name: string) {
  return selectButtons(w).find((b: any) => b.find('p').exists() && b.find('p').text() === name)
}

function triggers(w: any) {
  return w.findAll('li [aria-label^="flow.sidebar.flowMenu"]')
}

describe('Workspace Sidebar keyboard access', () => {
  // covers: T1
  it('renders one native select button per flow and clicking emits select', async () => {
    const { w, sidebar } = await mountSidebar()
    const buttons = w.findAll('li button').filter(b => b.text().includes(flowA.name) || b.text().includes(flowB.name))
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.text()).toContain(flowA.name)
    expect(buttons[1]!.text()).toContain(flowB.name)
    await buttons[1]!.trigger('click')
    const emitted = sidebar().emitted('select')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toEqual(flowB)
  })

  // covers: T2
  it("uses a native button with type=button for the flow's control", async () => {
    const { w } = await mountSidebar()
    const btn = selectButtonFor(w, flowB.name)
    expect(btn).toBeTruthy()
    expect(btn!.element.tagName).toBe('BUTTON')
    expect(btn!.attributes('type')).toBe('button')
  })

  // covers: T3
  it("labels each menu trigger with its flow's name", async () => {
    const { w } = await mountSidebar()
    const labels = triggers(w).map((t: any) => t.attributes('aria-label'))
    expect(labels).toEqual([
      `flow.sidebar.flowMenu:${flowA.name}`,
      `flow.sidebar.flowMenu:${flowB.name}`
    ])
  })

  // covers: T4
  it('marks only the selected flow with aria-current', async () => {
    const { w } = await mountSidebar({ selectedId: 'a' })
    expect(selectButtonFor(w, flowA.name)!.attributes('aria-current')).toBe('true')
    expect(selectButtonFor(w, flowB.name)!.attributes('aria-current')).toBeUndefined()
    expect(w.findAll('[aria-current]')).toHaveLength(1)
  })

  // covers: T5
  it('keeps the menu trigger outside the select button and visible on focus/open', async () => {
    const { w } = await mountSidebar()
    const select = selectButtonFor(w, flowB.name)!
    const trigger = triggers(w)[1]!
    expect(select.element.contains(trigger.element)).toBe(false)
    expect(w.findAll('button button')).toHaveLength(0)
    const cls = trigger.classes()
    expect(cls).toContain('focus-visible:opacity-100')
    expect(cls).toContain('data-[state=open]:opacity-100')
  })
})
