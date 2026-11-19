/**
 * #4175 — on a connected domain the team name never shows in the address bar,
 * and an in-site link reaches this team. Uses the real vue-router with the two
 * public page route shapes, wrapped by teamHostHistory(…, 'acme').
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { teamHostHistory } from '../app/utils/team-host-history'

const C = defineComponent({ render: () => null })
const routes: RouteRecordRaw[] = [
  { path: '/account', name: 'account', component: C },
  { path: '/onboarding/create-team', name: 'onboarding-create-team', component: C },
  { path: '/admin/:team', name: 'admin-team', component: C },
  { path: '/:team/:locale/:slug(.*)*', name: 'team-locale-slug', component: C },
  { path: '/:team/:slug(.*)*', name: 'team-slug', component: C }
]
const APP = ['account', 'onboarding']

function webRouter() {
  return createRouter({ history: teamHostHistory(createWebHistory(), 'acme', APP), routes })
}

const bar = () => window.location.pathname + window.location.search

describe('teamHostHistory (web history)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/fr/about')
  })

  it('reads the plain address as this team, and keeps it plain after Nuxt\'s first-load replace', async () => {
    const router = webRouter()
    await router.push(router.options.history.location)
    expect(router.currentRoute.value.params.team).toBe('acme')
    expect(bar()).toBe('/fr/about')

    // Nuxt's app:created step
    await router.replace({ path: '/acme/fr/about', force: true })
    expect(bar()).toBe('/fr/about')
    expect(router.currentRoute.value.params.team).toBe('acme')
  })

  it('team-ful links reach this team with a plain address and href', async () => {
    const router = webRouter()
    await router.push(router.options.history.location)

    await router.push('/acme/fr/contact')
    expect(router.currentRoute.value.params.team).toBe('acme')
    expect(bar()).toBe('/fr/contact')

    await router.push('/acme')
    expect(bar()).toBe('/')

    await router.push('/acme/fr/x?y=1')
    expect(bar()).toBe('/fr/x?y=1')

    expect(router.resolve('/acme/fr/contact').href).toBe('/fr/contact')
    expect(router.resolve('/admin/acme').href).toBe('/admin/acme')
  })

  it('app-owned pages keep their own address and route', async () => {
    window.history.replaceState(null, '', '/account')
    let router = webRouter()
    await router.push(router.options.history.location)
    expect(router.currentRoute.value.name).toBe('account')
    expect(bar()).toBe('/account')

    window.history.replaceState(null, '', '/onboarding/create-team')
    router = webRouter()
    await router.push(router.options.history.location)
    expect(router.currentRoute.value.name).toBe('onboarding-create-team')
    expect(bar()).toBe('/onboarding/create-team')
  })

  it("the user menu's /account link opens the account page", async () => {
    const router = webRouter()
    await router.push(router.options.history.location)
    await router.push('/account')
    expect(router.currentRoute.value.name).toBe('account')
    expect(bar()).toBe('/account')
    expect(router.resolve('/account').href).toBe('/account')
  })
})

describe('teamHostHistory (memory history)', () => {
  it('back maps the plain address back to the team route', async () => {
    const inner = createMemoryHistory()
    const router = createRouter({ history: teamHostHistory(inner, 'acme', APP), routes })
    await router.push('/acme/fr/a')
    await router.push('/acme/fr/b')
    const done = new Promise<void>(resolve => router.afterEach(() => resolve()))
    router.back()
    await done
    expect(router.currentRoute.value.fullPath).toBe('/acme/fr/a')
    expect(inner.location).toBe('/fr/a')
  })
})
