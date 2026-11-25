import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, watch } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

// Per-test mutable collection config
let mockConfig: any = null
const mockFetch = vi.fn()

// The SFC and the real composable rely on Nuxt auto-imports
Object.assign(globalThis, {
  ref,
  computed,
  watch,
  useT: () => ({
    t: (k: string, o?: Record<string, any>) => o ? k + ' ' + Object.values(o).join(' ') : k,
    tString: (k: string) => k
  }),
  useRoute: () => ({ path: '/admin/team-a/sales/events', params: { team: 'team-a' } }),
  useTeam: () => ({ currentTeam: ref({ id: 'team-a' }) }),
  useTeamContext: () => ({ getTeamId: () => 'team-a' }),
  useNotify: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }),
  useNuxtApp: () => ({ payload: { data: {} } }),
  refreshNuxtData: vi.fn(),
  $fetch: mockFetch,
  useCollections: () => ({ getConfig: () => mockConfig })
})

const { useCollectionCacheKeys } = await import('../../app/composables/useCollectionCacheKeys')
const { useCollectionImport } = await import('../../app/composables/useCollectionImport')
Object.assign(globalThis, { useCollectionCacheKeys, useCollectionImport })

const stubs = {
  UModal: { template: '<div><slot name="content" /></div>' },
  UAlert: { props: ['title', 'description'], template: '<div class="alert">{{ title }} {{ description }}</div>' },
  UButton: {
    inheritAttrs: false,
    props: ['disabled'],
    template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>'
  },
  USelect: { props: ['modelValue', 'items'], template: '<div class="select">{{ modelValue }}</div>' },
  UIcon: { template: '<i />' },
  UBadge: { template: '<span><slot /></span>' },
  USwitch: { template: '<span />' },
  UProgress: { template: '<div />' }
}

function generatedFields() {
  return [
    { name: 'title', type: 'string', label: 'Event Name' },
    { name: 'slug', type: 'string', label: 'URL Slug' }
  ]
}

function configWithSchema() {
  const config: any = { apiPath: 'sales-events', fields: generatedFields() }
  Object.defineProperty(config, 'schema', {
    enumerable: false,
    value: {
      shape: {
        title: { isOptional: () => false },
        slug: { isOptional: () => true }
      }
    }
  })
  return config
}

const jsonFile = (text: string) => new File([text], 'x.json')

async function mountModal(file: File) {
  const ImportPreviewModal = (await import('../../app/components/ImportPreviewModal.vue')).default
  const w = mount(ImportPreviewModal, {
    props: { collection: 'events', file, open: true },
    global: { stubs }
  })
  await flushPromises()
  return w
}

function buttonByText(w: any, text: string) {
  return w.findAll('button').find((b: any) => b.text() === text)
}

describe('ImportPreviewModal (#4511)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ id: 'new' })
    mockConfig = { apiPath: 'sales-events', fields: generatedFields() }
  })

  // covers: T5
  it('shows read and no-field errors in the dialog, and clears them on a new file', async () => {
    const w = await mountModal(jsonFile('{ not json'))
    expect(w.text()).toContain('import.readFailed')

    await w.setProps({ file: jsonFile('[{"title":"a","slug":"a"}]') })
    await flushPromises()
    expect(w.text()).not.toContain('import.readFailed')

    mockConfig = { apiPath: 'sales-events', fields: [] }
    const empty = await mountModal(jsonFile('[{"title":"a"}]'))
    expect(empty.text()).toContain('import.noFields')
    expect(buttonByText(empty, 'common.next')?.attributes('disabled')).toBeDefined()
  })

  // covers: T6
  it('names the failed row by its row number in the file', async () => {
    mockConfig = configWithSchema()
    mockFetch.mockImplementation((_url: string, opts: any) =>
      opts.body.title === 'c' ? Promise.reject(new Error('boom')) : Promise.resolve({ id: 'new' })
    )
    const w = await mountModal(jsonFile('[{"title":"","slug":"a"},{"title":"b","slug":"b"},{"title":"c","slug":"c"}]'))

    await buttonByText(w, 'common.next')!.trigger('click')
    await flushPromises()
    await buttonByText(w, 'common.import')!.trigger('click')
    await flushPromises()

    expect(w.find('.failed-rows').exists()).toBe(true)
    expect(w.find('.failed-rows').text()).toContain('import.rowFailed 3 boom')
  })
})
