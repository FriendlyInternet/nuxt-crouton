import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'

/**
 * #4551 — the Uiterlijk page spun forever when the app booted on a page with
 * no team (the one-tap sign-in link boots on /auth/login), because only the
 * once-per-boot team-theme plugin ever loaded the theme. useTeamTheme() now
 * loads it itself once the team is known, without repeating the plugin's load.
 */

vi.mock('#imports', () => ({ updateAppConfig: vi.fn(), useAppConfig: () => ({}) }))

const state = new Map<string, Ref<unknown>>()
let teamId: Ref<string | null>
let fetchMock: ReturnType<typeof vi.fn>

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  state.clear()
  teamId = ref<string | null>(null)
  fetchMock = vi.fn(async () => ({ preset: 'custom', primary: 'blue' }))
  vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
    if (!state.has(key)) state.set(key, ref(init ? init() : undefined))
    return state.get(key)
  })
  vi.stubGlobal('useTeamContext', () => ({ teamId }))
  vi.stubGlobal('useColorMode', () => ({ preference: 'system' }))
  vi.stubGlobal('$fetch', fetchMock)
})

async function load() {
  const mod = await import('../app/composables/useTeamTheme')
  return mod.useTeamTheme
}

describe('useTeamTheme loading (#4551)', () => {
  it('T1: loads once the team becomes known after setup', async () => {
    const useTeamTheme = await load()
    const { isLoading } = useTeamTheme()
    expect(fetchMock).not.toHaveBeenCalled()

    teamId.value = 'team-1'
    await nextTick()
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/teams/team-1/settings/theme')
    expect(isLoading.value).toBe(false)
  })

  it('T2: does not fetch again when the plugin already loaded the theme', async () => {
    state.set('team-theme-fetched', ref(true))
    state.set('team-theme-team-id', ref('team-1'))
    teamId.value = 'team-1'
    const useTeamTheme = await load()
    const { isLoading, error } = useTeamTheme()
    await nextTick()
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('T3: a failed load ends the spinner and records the error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    teamId.value = 'team-1'
    const useTeamTheme = await load()
    const { isLoading, error } = useTeamTheme()
    await nextTick()
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(isLoading.value).toBe(false)
    expect(error.value).toBe('boom')
  })

  it('T5: two callers set up before the team is known fetch only once', async () => {
    const useTeamTheme = await load()
    useTeamTheme()
    useTeamTheme()

    teamId.value = 'team-1'
    await nextTick()
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
