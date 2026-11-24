/**
 * TreeNode expand toggle — accessible name + state (#4463).
 *
 * Rule: the tree's open/close button always has a name that includes the
 * row's title, and its aria-expanded matches whether the children are shown.
 * Uses the real useTreeDrag / useTreeItemState composables.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, watchEffect } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

const stateStore: Record<string, any> = {}

vi.stubGlobal('ref', ref)
vi.stubGlobal('readonly', (val: any) => val)
vi.stubGlobal('watchEffect', watchEffect)
vi.stubGlobal('useState', (key: string, init: () => any) => {
  if (!stateStore[key]) stateStore[key] = ref(init())
  return stateStore[key]
})
vi.stubGlobal('useCrouton', () => ({ open: vi.fn() }))
vi.stubGlobal('useT', () => ({
  t: (k: string, o?: Record<string, unknown>) => [k, ...Object.values(o ?? {})].join(' ')
}))

const { useTreeDrag } = await import('../../app/composables/useTreeDrag')
const { useTreeItemState } = await import('../../app/composables/useTreeItemState')
vi.stubGlobal('useTreeDrag', useTreeDrag)
vi.stubGlobal('useTreeItemState', useTreeItemState)

const TreeNode = (await import('../../app/components/TreeNode.vue')).default

const stubs = {
  UButton: { inheritAttrs: false, template: '<button v-bind="$attrs"><slot /></button>' },
  UIcon: true,
  UBadge: true,
  UDropdownMenu: true,
  CroutonTreeNode: true
}

function mountNode(item: Record<string, any>) {
  return mount(TreeNode as any, {
    props: { item, collection: 'pages' },
    global: { stubs }
  })
}

const parent = () => ({
  id: 'p1',
  name: 'About us',
  children: [
    { id: 'c1', name: 'Team' },
    { id: 'c2', name: 'History' }
  ]
})

describe('TreeNode expand toggle', () => {
  beforeEach(() => {
    Object.keys(stateStore).forEach(key => delete stateStore[key])
  })

  // covers: T1
  it('an open row has aria-expanded="true", a name with title and count, and aria-controls on the children', async () => {
    const wrapper = mountNode(parent())
    await flushPromises()

    const toggle = wrapper.find('button')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-expanded')).toBe('true')
    const label = toggle.attributes('aria-label') ?? ''
    expect(label).toContain('tree.toggleChildren')
    expect(label).toContain('About us')
    expect(label).toContain('2')

    const children = wrapper.find('.tree-children')
    expect(children.exists()).toBe(true)
    expect(children.attributes('id')).toBeTruthy()
    expect(toggle.attributes('aria-controls')).toBe(children.attributes('id'))
  })

  // covers: T2
  it('after a click the toggle says aria-expanded="false", children are gone, aria-controls is dropped, name unchanged', async () => {
    const wrapper = mountNode(parent())
    await flushPromises()
    const before = wrapper.find('button').attributes('aria-label')

    await wrapper.find('button').trigger('click')
    await flushPromises()

    const toggle = wrapper.find('button')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.tree-children').exists()).toBe(false)
    expect(toggle.attributes('aria-controls')).toBeUndefined()
    expect(toggle.attributes('aria-label')).toBe(before)
  })

  // covers: T3
  it('a row with no children renders no toggle', async () => {
    const wrapper = mountNode({ id: 'p2', name: 'Leaf' })
    await flushPromises()
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
