import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colorsAreFlat, looksLikeErrorPage, looksLikeLoadingScreen, landedWhereAsked } from './capture-validate.mjs'

test('colorsAreFlat: uniform samples are flat', () => {
  const samples = Array.from({ length: 16 }, () => [255, 255, 255, 255])
  assert.equal(colorsAreFlat(samples), true)
})

test('colorsAreFlat: varied samples are not flat', () => {
  const samples = [
    [255, 255, 255, 255],
    [10, 20, 30, 255],
    [200, 100, 50, 255],
  ]
  assert.equal(colorsAreFlat(samples), false)
})

test('colorsAreFlat: empty/invalid input is not flat', () => {
  assert.equal(colorsAreFlat([]), false)
  assert.equal(colorsAreFlat(null), false)
})

test('colorsAreFlat: within-tolerance noise still counts as flat', () => {
  const samples = [
    [255, 255, 255, 255],
    [254, 255, 254, 255],
    [255, 254, 255, 255],
  ]
  assert.equal(colorsAreFlat(samples, 2), true)
})

test('looksLikeErrorPage: 4xx/5xx status is an error page', () => {
  assert.equal(looksLikeErrorPage({ status: 404, text: '', title: '' }), true)
  assert.equal(looksLikeErrorPage({ status: 500, text: '', title: '' }), true)
  assert.equal(looksLikeErrorPage({ status: 200, text: '', title: '' }), false)
})

test('looksLikeErrorPage: Nuxt/Nitro error text is an error page', () => {
  assert.equal(looksLikeErrorPage({ status: 200, text: 'This page could not be found', title: '' }), true)
  assert.equal(looksLikeErrorPage({ status: 200, text: '', title: 'Nuxt Error' }), true)
  assert.equal(looksLikeErrorPage({ status: 200, text: 'Internal Server Error', title: '' }), true)
})

test('looksLikeErrorPage: normal UI content is not an error page', () => {
  assert.equal(looksLikeErrorPage({ status: 200, text: 'Welcome to the dashboard', title: 'Dashboard' }), false)
})

test('looksLikeLoadingScreen: Nuxt dev loading template is rejected', () => {
  const html = '<!DOCTYPE html><html><head><title>Nuxt</title></head><body><div id="nuxt-loading"><p>generating types</p><span>step 4/7</span></div></body></html>'
  assert.equal(looksLikeLoadingScreen({ html }), true)
  assert.equal(looksLikeLoadingScreen({ text: 'Generating types · step 4/7' }), true)
})

test('landedWhereAsked: compares pathnames, ignores a trailing slash and the query (#4201)', () => {
  assert.equal(landedWhereAsked('/admin/x/media', 'https://h/admin/x/media/'), true)
  assert.equal(landedWhereAsked('/admin/x/media', 'https://h/auth/login?redirect=%2Fadmin'), false)
  assert.equal(landedWhereAsked('/admin/x/media', 'https://h/'), false)
  assert.equal(landedWhereAsked('/?tab=a', 'https://h/'), true)
})

test('looksLikeLoadingScreen: a real app page is not a loading screen', () => {
  assert.equal(looksLikeLoadingScreen({ html: '<div id="__nuxt"><main>Calendar</main></div>', text: 'Calendar', title: 'Velo' }), false)
})

// #4241: the gallery sends `/__review?file=<path>` on to `/__review/<ComponentName>` — the right page.
test('landedWhereAsked: a component link lands on that component\'s gallery page (#4241)', () => {
  const asked = '/__review?file=packages%2Fcrouton-core%2Fapp%2Fcomponents%2FAdminSidebar.vue'
  assert.equal(landedWhereAsked(asked, 'https://h/__review/CroutonAdminSidebar'), true)
  assert.equal(landedWhereAsked(asked, 'https://h/__review/CroutonAdminSidebar/'), true)
  // The file is not known to the gallery: the browser stays on the list of all components.
  assert.equal(landedWhereAsked(asked, `https://h${asked}`), false)
  assert.equal(landedWhereAsked(asked, 'https://h/'), false)
  assert.equal(landedWhereAsked(asked, 'https://h/auth/login'), false)
  assert.equal(landedWhereAsked(asked, 'https://h/__review/A/B'), false)
})

test('landedWhereAsked: the gallery list and a named component page compare as before (#4241)', () => {
  assert.equal(landedWhereAsked('/__review', 'https://h/__review'), true)
  assert.equal(landedWhereAsked('/__review?q=side', 'https://h/__review?q=side'), true)
  assert.equal(landedWhereAsked('/__review/CroutonAdminSidebar', 'https://h/__review/CroutonAdminSidebar'), true)
  assert.equal(landedWhereAsked('/__review/CroutonAdminSidebar', 'https://h/__review'), false)
})
