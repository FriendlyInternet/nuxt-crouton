import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createSSRApp, defineComponent, h, ref, computed, onMounted } from 'vue'
import { renderToString } from 'vue/server-renderer'

// Server-renders the REAL pages/index.vue (compiled from source) and checks the first HTML the
// browser gets. The PR preview capture (and a phone on a slow line) only sees that HTML until the
// app hydrates: when the page fetched nothing on the server, it was the 33-character shell
// "Waiting for you · All apps · Loading…", and the capture reloaded it until it gave up (#3892).
// Stubbed: Nuxt auto-imports (useFetch returns the stored list, as the real list endpoint would)
// and the UI/card components (plain wrappers that print the card title). $fetch — the GitHub
// sync — must NOT be called during the server render.

const here = dirname(fileURLToPath(import.meta.url))
const pagePath = resolve(here, '../app/pages/index.vue')
const corePath = resolve(here, '../app/utils/inbox-core.ts')

const CARD = {
  id: 'c1', kind: 'review', state: 'waiting', askedAt: '2026-11-16T10:00:00Z', title: 'Card waiting on you',
  ask: 'Look at it', link: 'https://github.com/x/y/pull/1', payload: null, sourceType: 'pr', sourceNumber: 1
}

let tmp: string | null = null
afterEach(() => {
  vi.unstubAllGlobals()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

async function loadPage() {
  const { descriptor } = parse(readFileSync(pagePath, 'utf8'), { filename: pagePath })
  const out = compileScript(descriptor, { id: 'inbox-page', inlineTemplate: true, templateOptions: { ssr: true } })
  tmp = mkdtempSync(join(here, '.ssr-'))
  const file = join(tmp, 'index.page.ts')
  // Every `~/utils/<name>` import the page makes points at the real util file.
  // Every `~/components/cards/<name>.vue` import points at a stub card that prints the card title.
  const stub = join(tmp, 'card-stub.ts')
  writeFileSync(stub, `import { defineComponent, h } from 'vue'\nexport default defineComponent({ props: ['card', 'send'], setup: p => () => h('article', p.card?.title ?? '') })\n`)
  const src = out.content
    .replace(/(['"])~\/utils\/([\w-]+)\1/g, (_m, _q, name: string) => JSON.stringify(resolve(dirname(corePath), `${name}.ts`)))
    .replace(/(['"])~\/components\/cards\/[\w-]+\.vue\1/g, () => JSON.stringify(stub))
  writeFileSync(file, src)
  return (await import(/* @vite-ignore */ file)).default
}

const wrap = (tag: string) => defineComponent({ inheritAttrs: false, setup: (_, { slots, attrs }) => () => h(tag, { 'data-c': attrs.label ?? attrs.title }, [attrs.label as string ?? attrs.title as string ?? '', slots.default?.()]) })
const card = defineComponent({ props: ['card', 'send'], setup: p => () => h('article', p.card.title) })

async function renderPage(fetchCalls: unknown[]) {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('definePageMeta', () => {})
  vi.stubGlobal('useTeamContext', () => ({ getTeamId: () => 'team1' }))
  vi.stubGlobal('useFetch', async (url: string) => ({ data: ref(url === '/api/teams/team1/inbox-cards' ? [CARD] : null), error: ref(null) }))
  vi.stubGlobal('$fetch', (...a: unknown[]) => { fetchCalls.push(a); return new Promise(() => {}) })
  const Page = await loadPage()
  const app = createSSRApp(defineComponent({ setup: () => () => h(Page) }))
  for (const n of ['UContainer', 'UButton', 'UAlert']) app.component(n, wrap('div'))
  for (const n of ['CardsEdit', 'CardsReview', 'CardsIssue', 'CardsDelivery', 'CardsPlaceholder']) app.component(n, card)
  // Suspense-free async setup: renderToString awaits the page's top-level await.
  return renderToString(app)
}

describe('inbox page server render', () => {
  it('the first HTML already shows the stored cards, without waiting on GitHub', async () => {
    const fetchCalls: unknown[] = []
    const html = await renderPage(fetchCalls)
    expect(html).toContain('Card waiting on you')
    expect(html).not.toContain('Loading…')
    expect(fetchCalls).toEqual([]) // no sync (or any $fetch) during the server render
  })
})
