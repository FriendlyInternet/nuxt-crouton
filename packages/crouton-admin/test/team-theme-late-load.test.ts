/**
 * Team theme follows the current team (#4563): the real team-theme plugin →
 * real useTeamFavicon → real useTeamTheme chain, only Nuxt globals stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, nextTick, type Ref } from 'vue'
import { THEME_PRESET_REGISTRY } from '@fyit/crouton-themes/presets'

const updateAppConfig = vi.fn()
const registered = {
  [THEME_PRESET_REGISTRY.editorial.checkVariant]: '',
  [THEME_PRESET_REGISTRY.ko.checkVariant]: ''
}
vi.mock('#imports', () => ({
  updateAppConfig: (...a: unknown[]) => updateAppConfig(...a),
  useAppConfig: () => ({ ui: { button: { variants: { variant: registered } } } })
}))

const state = new Map<string, Ref<unknown>>()
const storage = new Map<string, string>()
let teamId: Ref<string | null>
let themes: Record<string, object>
let gates: Record<string, Promise<void>>
let fetchMock: ReturnType<typeof vi.fn>

const flush = () => new Promise(r => setTimeout(r, 0))
const themeCalls = () => fetchMock.mock.calls.map(c => c[0]).filter((u: string) => u.endsWith('/settings/theme'))
const lastUi = () => updateAppConfig.mock.calls.at(-1)?.[0]?.ui

beforeEach(async () => {
  vi.resetModules()
  state.clear(); storage.clear(); updateAppConfig.mockClear()
  teamId = ref<string | null>(null)
  themes = { 'team-a': { preset: 'editorial' }, 'team-b': { preset: 'ko' } }
  gates = {}
  fetchMock = vi.fn(async (url: string) => {
    const id = url.split('/')[3]!
    if (url.endsWith('/settings/site')) return {}
    await gates[id]
    return themes[id]
  })
  vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
    if (!state.has(key)) state.set(key, ref(init ? init() : undefined))
    return state.get(key)
  })
  vi.stubGlobal('useTeamContext', () => ({ teamId }))
  vi.stubGlobal('useColorMode', () => ({ preference: 'system' }))
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) })
  vi.stubGlobal('defineNuxtPlugin', (p: unknown) => p)
  vi.stubGlobal('useTeam', () => ({ currentTeam: ref(null) }))
  vi.stubGlobal('useHead', vi.fn())
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useAppConfig', () => ({ ui: { button: { variants: { variant: registered } } } }))
  const theme = await import('../app/composables/useTeamTheme')
  vi.stubGlobal('useTeamTheme', theme.useTeamTheme)
  const favicon = await import('../app/composables/useTeamFavicon')
  vi.stubGlobal('useTeamFavicon', favicon.useTeamFavicon)
})

async function boot() {
  const plugin = (await import('../app/plugins/team-theme')).default as any
  await plugin.setup()
}

describe('team theme follows the current team (#4563)', () => {
  // covers: T1
  it('T1: boots with no team, team then set → fetched once and applied', async () => {
    await boot()
    expect(themeCalls()).toHaveLength(0)
    teamId.value = 'team-a'
    await nextTick(); await flush()
    expect(themeCalls()).toEqual(['/api/teams/team-a/settings/theme'])
    expect(lastUi()).toEqual(THEME_PRESET_REGISTRY.editorial.ui)
  })

  // covers: T2
  it('T2: hydrated for A, switch to B → B fetched once and applied', async () => {
    teamId.value = 'team-a'
    state.set('team-theme-fetched', ref(true))
    state.set('team-theme-data', ref({ preset: 'editorial' }))
    state.set('team-theme-team-id', ref('team-a'))
    await boot()
    await nextTick(); await flush()
    expect(themeCalls()).toHaveLength(0)
    teamId.value = 'team-b'
    await nextTick(); await flush()
    expect(themeCalls()).toEqual(['/api/teams/team-b/settings/theme'])
    expect(lastUi()).toEqual(THEME_PRESET_REGISTRY.ko.ui)
  })

  // covers: T3
  it('T3: a saved user pick still wins after a late load', async () => {
    themes['team-a'] = { preset: 'editorial', allowUserThemes: true }
    storage.set('nuxt-crouton-theme', 'ko')
    await boot()
    teamId.value = 'team-a'
    await nextTick(); await flush(); await flush()
    expect(lastUi()).toEqual(THEME_PRESET_REGISTRY.ko.ui)
    expect(state.get('crouton-theme')?.value).toBe('ko')
  })

  // covers: T4
  it('T4: team switches while A is still loading → B ends up applied', async () => {
    let release!: () => void
    gates['team-a'] = new Promise<void>(r => { release = r })
    await boot()
    teamId.value = 'team-a'
    await nextTick()
    teamId.value = 'team-b'
    await nextTick()
    release()
    await flush(); await flush(); await flush()
    expect(themeCalls()).toEqual(['/api/teams/team-a/settings/theme', '/api/teams/team-b/settings/theme'])
    expect(lastUi()).toEqual(THEME_PRESET_REGISTRY.ko.ui)
    expect(state.get('team-theme-data')?.value).toEqual({ preset: 'ko' })
  })
})
