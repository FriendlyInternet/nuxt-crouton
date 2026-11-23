import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const ctor = vi.fn()
const destroySpy = vi.fn()

vi.mock('sortablejs', () => ({
  default: class {
    destroy = destroySpy
    constructor(...a: any[]) { ctor(...a) }
  }
}))

// The SFC relies on Nuxt auto-imports
Object.assign(globalThis, {
  useT: () => ({ t: (k: string) => k }),
  useCrouton: () => ({ open: vi.fn() })
})

const stubs = {
  UBadge: true,
  UIcon: true,
  UCard: { template: '<div><slot /></div>' },
  CroutonItemButtonsMini: true
}

const baseProps = {
  columnValue: 'todo',
  label: 'Todo',
  collection: 'tasks',
  items: [{ id: '1', name: 'One' }]
}

async function mountColumn(extra: Record<string, any> = {}) {
  const KanbanColumn = (await import('../../app/components/KanbanColumn.vue')).default
  const w = mount(KanbanColumn, {
    props: { ...baseProps, ...extra },
    global: { stubs },
    attachTo: document.body
  })
  await flushPromises()
  await flushPromises()
  return w
}

describe('KanbanColumn readonly', () => {
  beforeEach(() => {
    ctor.mockReset()
    destroySpy.mockReset()
  })

  // covers: T1
  it('constructs Sortable once without readonly', async () => {
    const w = await mountColumn()
    expect(ctor).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  // covers: T2
  it('never constructs Sortable with readonly, while a sibling without it does', async () => {
    const ro = await mountColumn({ readonly: true })
    expect(ctor).toHaveBeenCalledTimes(0)
    const rw = await mountColumn()
    expect(ctor).toHaveBeenCalledTimes(1)
    ro.unmount()
    rw.unmount()
  })

  // covers: T3
  it('destroys the Sortable instance when readonly turns on after mount', async () => {
    const w = await mountColumn()
    expect(ctor).toHaveBeenCalledTimes(1)
    await w.setProps({ readonly: true })
    await flushPromises()
    expect(destroySpy).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  // covers: T4
  it('still emits select when a readonly card is clicked', async () => {
    const w = await mountColumn({ readonly: true })
    await w.find('.kanban-card').trigger('click')
    const events = w.emitted('select')
    expect(events).toBeTruthy()
    expect(events![0][0]).toMatchObject({ id: '1' })
    w.unmount()
  })

  // covers: T5
  it('hides Edit/Delete buttons on the default card in readonly mode', async () => {
    const ro = await mountColumn({ readonly: true })
    expect(ro.findAllComponents({ name: 'CroutonItemButtonsMini' }).length).toBe(0)
    const rw = await mountColumn()
    expect(rw.findAllComponents({ name: 'CroutonItemButtonsMini' }).length).toBe(1)
    ro.unmount()
    rw.unmount()
  })
})
