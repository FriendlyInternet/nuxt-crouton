import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { computed, createSSRApp, defineComponent, h, onMounted, ref, resolveComponent, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loginHrefFor } from '../app/utils/walk'

// Server-renders the REAL pages/apps.vue and the REAL components/dashboard/* tabs (compiled from
// source) with one fixture per branch, so splitting the page into tab components (#3763) is held
// to the same output. Stubbed: Nuxt auto-imports (useFetch returns the fixture for each endpoint),
// the Nuxt UI components (plain tags that print their label/title and every slot), and
// ReplyButtons (prints kind + number), CroutonKanban (prints `readonly` and each column's cards
// through the card component it was given). UTabs renders all six tab slots at once.

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../app')
const pagePath = resolve(appDir, 'pages/apps.vue')
const dashboardDir = resolve(appDir, 'components/dashboard')

let tmp: string | null = null
afterEach(() => {
  vi.unstubAllGlobals()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

async function compile(path: string) {
  const { descriptor } = parse(readFileSync(path, 'utf8'), { filename: path })
  const out = compileScript(descriptor, { id: basename(path), inlineTemplate: true, templateOptions: { ssr: true } })
  tmp ??= mkdtempSync(join(here, '.ssr-'))
  const file = join(tmp, `${basename(path, '.vue')}.${Math.random().toString(36).slice(2)}.ts`)
  // Every `~/utils/<name>` import points at the real util file.
  const src = out.content.replace(/(['"])~\/utils\/([\w-]+)\1/g, (_m, _q, name: string) => JSON.stringify(resolve(appDir, 'utils', `${name}.ts`)))
  writeFileSync(file, src)
  return (await import(/* @vite-ignore */ file)).default
}

const label = (attrs: Record<string, unknown>) => (attrs.label ?? attrs.title ?? '') as string
const ui = (tag: string) => defineComponent({
  inheritAttrs: false,
  setup: (_, { slots, attrs }) => () => h(tag, { 'data-c': label(attrs), 'data-href': attrs.href, 'data-color': attrs.color, 'data-variant': attrs.variant }, [label(attrs), ...Object.values(slots).map(s => s?.())])
})
// UTabs prints each tab's label (data-tab) and its label class (data-tab-label) before every slot.
const tabsStub = defineComponent({
  inheritAttrs: false,
  setup: (_, { slots, attrs }) => () => h('div', [
    ...((attrs.items ?? []) as Array<{ label: string, ui?: { label?: string } }>).map(i => h('span', { 'data-tab': i.label, 'data-tab-label': i.ui?.label ?? '' })),
    ...Object.values(slots).map(s => s?.())
  ])
})
// UCollapsible renders its content only while open, like the real one (unmountOnHide is on by default).
const collapsibleStub = defineComponent({
  inheritAttrs: false,
  setup: (_, { slots, attrs }) => () => h('div', { 'data-open': String(!!attrs.open) }, [slots.default?.(), attrs.open ? slots.content?.() : null])
})
const replyButtons = defineComponent({ props: ['kind', 'number'], setup: p => () => h('reply', `${p.kind}:${p.number}`) })
// The kanban prints whether it is read-only, then each static column with its cards, sorted by `order`.
const kanbanStub = defineComponent({
  props: ['rows', 'groupField', 'orderField', 'columns', 'cardComponent', 'readonly', 'collection'],
  setup: p => () => h('kanban', { 'data-readonly': String(p.readonly === true || p.readonly === '') }, (p.columns as Array<{ value: string, label: string }>).map(c =>
    h('column', { 'data-column': c.label }, (p.rows as Array<Record<string, unknown>>)
      .filter(r => r[p.groupField as string] === c.value)
      .sort((a, b) => Number(a[p.orderField as string]) - Number(b[p.orderField as string]))
      .map(r => h(p.cardComponent as Component, { item: r, layout: 'kanban', collection: p.collection })))))
})

const FIXTURES: Record<string, unknown> = {
  '/api/status/apps': {
    data: [
      { app: 'velo', stagingUrl: 'https://velo.staging', hasSignIn: true, previews: [{ pr: 77, title: 'Velo preview', updatedAt: '2026-11-15T09:00:00Z', url: 'u' }] },
      { app: 'kassa', stagingUrl: null, hasSignIn: false, previews: [] },
      { app: 'notes', stagingUrl: 'https://notes.staging', hasSignIn: true, previews: [] }
    ],
    error: null
  },
  '/api/status/totest': {
    data: [
      { kind: 'epic', number: 11, title: 'Velo epic to test', url: 'https://gh/11', app: 'velo', what: 'Velo changed', steps: ['Open it', 'Tap it'], to: '/x', stagingUrl: 'https://velo.staging', mergedAt: null },
      { kind: 'pr', number: 12, title: 'Velo merged PR', url: 'https://gh/12', app: 'velo', what: '', steps: [], to: '', stagingUrl: null, mergedAt: '2026-11-14T08:00:00Z' },
      { kind: 'pr', number: 13, title: 'General merged PR', url: 'https://gh/13', app: null, what: 'Docs', steps: [], to: '', stagingUrl: null, mergedAt: null }
    ],
    error: 'GitHub was slow'
  },
  '/api/status/decisions': {
    data: {
      decisions: [{ date: '2026-11-10', epic: 3763, decision: 'Cards over tabs', why: 'Fewer taps', rejected: 'Keep tabs' }],
      openQuestions: [{ number: 99, title: 'Pick a colour', url: 'https://gh/99' }]
    },
    error: null
  },
  '/api/status/changelog': {
    data: [{ date: '2026-11-12', number: 21, title: 'Inbox first', area: 'status', url: 'https://gh/21' }],
    error: null
  },
  '/api/status/clock': {
    data: [
      { workflow: 'pipeline-metrics.yml', schedule: 'every hour, :20–:30', about: 'Copies the run history.', lastDue: '2026-11-19T10:20:00Z', nextDue: '2026-11-19T11:20:00Z', lastRun: { id: 5, url: 'https://gh/runs/5', createdAt: '2026-11-19T10:22:00Z', status: 'completed', conclusion: 'success' }, state: 'ok' },
      { workflow: 'housekeeping.yml', schedule: 'daily 06:00 UTC', about: 'Emails the weekly drift report.', lastDue: '2026-11-19T06:00:00Z', nextDue: '2026-11-20T06:00:00Z', lastRun: null, state: 'missed' },
      { workflow: 'weekly.yml', schedule: 'Mondays 06:30 UTC', about: 'Monday chores in order.', lastDue: '2026-11-16T06:30:00Z', nextDue: '2026-11-23T06:30:00Z', lastRun: null, state: 'before-clock' }
    ],
    error: null
  },
  '/api/status/board': {
    data: [
      { id: 'b1', number: 501, title: 'Board working ticket', url: 'https://gh/501', column: 'working', since: null, checksRed: false, pkg: 'crouton-core', order: 2 },
      { id: 'b2', number: 502, title: 'Board review ticket', url: 'https://gh/502', column: 'review', since: null, checksRed: true, pkg: null, order: 1 }
    ],
    error: null
  }
}

async function renderPage(path = pagePath, fixtures = FIXTURES, status = 'success') {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('loginHrefFor', loginHrefFor)
  vi.stubGlobal('definePageMeta', () => {})
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('resolveComponent', resolveComponent)
  vi.stubGlobal('useIntervalFn', () => {})
  vi.stubGlobal('useDocumentVisibility', () => ref('visible'))
  vi.stubGlobal('useFetch', async (url: string) => ({ data: ref(fixtures[url] ?? null), status: ref(status), refresh: async () => {} }))
  const Page = await compile(path)
  const app = createSSRApp(defineComponent({ setup: () => () => h(Page) }))
  for (const n of ['UContainer', 'UButton', 'UAlert', 'UBadge', 'UCard', 'UInput']) app.component(n, ui('div'))
  app.component('UTabs', tabsStub)
  app.component('UCollapsible', collapsibleStub)
  app.component('ReplyButtons', replyButtons)
  app.component('CroutonKanban', kanbanStub)
  for (const f of readdirSync(dashboardDir).filter(f => f.endsWith('.vue'))) {
    app.component(`Dashboard${basename(f, '.vue')}`, await compile(join(dashboardDir, f)))
  }
  return renderToString(app)
}

// HTML comments are Vue's v-if / fragment placeholders — not part of what the browser shows.
const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('apps dashboard page server render', () => {
  it('Apps tab: apps with the most to test come first, each with its to-test items, staging and previews', async () => {
    const html = visible(await renderPage())
    expect(html.indexOf('>velo<')).toBeLessThan(html.indexOf('>kassa<'))
    expect(html.indexOf('>kassa<')).toBeLessThan(html.indexOf('>notes<')) // ties sort by name
    expect(html).toContain('2 to test')
    expect(html).toContain('Velo changed')
    expect(html).toContain('<li>Open it</li><li>Tap it</li>')
    expect(html).toContain('No staging URL configured.') // kassa
    expect(html).toContain('data-href="/api/status/login/notes?key=main"')
    expect(html).toContain('Updated 2026-11-15')
    expect(html).toContain('data-href="/api/status/login/velo?key=pr77"')
    expect(html).toContain('<reply>pr:77</reply>')
    expect(html).toContain('href="https://github.com/FriendlyInternet/nuxt-crouton/pull/77"')
  })

  it('To test tab: app filter, groups with staging link, waiting vs merged badge, sign-in only when the item has an app', async () => {
    const html = visible(await renderPage())
    expect(html).toContain('data-c="All"')
    expect(html).toContain('data-c="general"')
    expect(html).toContain('data-c="GitHub was slow"') // the endpoint's error shows
    expect(html).toContain('Waiting for you')
    expect(html).toContain('Merged')
    expect(html).toContain('2026-11-14') // mergedAt shown
    expect(html).toContain('What changed')
    expect(html).toContain('How to check')
    expect(html).toContain('<reply>issue:11</reply>')
    // General item (no app) has no sign-in button: the only login links are app ones.
    expect(html).not.toContain('/api/status/login/null')
  })

  it('Decisions + Changelog tabs: open questions, decision row (closed), changelog rows', async () => {
    const html = visible(await renderPage())
    expect(html).toContain('Waiting on you (1)')
    expect(html).toContain('Pick a colour')
    expect(html).toContain('Cards over tabs')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Fewer taps') // detail only after a tap
    expect(html).not.toContain('No decisions yet.')
    expect(html).toContain('Inbox first')
    expect(html).toContain('data-c="status"') // area filter
  })

  it('loading and empty states', async () => {
    const loading = visible(await renderPage(pagePath, {}, 'pending'))
    expect(loading.match(/Loading…/g)?.length).toBe(6)
    expect(loading).not.toContain('No apps found.')
    const empty = visible(await renderPage(pagePath, {}))
    expect(empty).toContain('No apps found.')
    expect(empty).toContain('Nothing to test yet.')
    expect(empty).toContain('No decisions yet.')
    expect(empty).toContain('No changes yet.')
    expect(empty).toContain('No clock jobs.')
    expect(empty).toContain('Nothing in the pipeline right now.')
    expect(empty).not.toContain('data-c="All"') // no filter buttons without options
  })

  // covers: T4
  it('Clock tab: six tabs ending in Pipeline, a missed job listed before an ok one, badge words + run link', async () => {
    const html = visible(await renderPage())
    expect(html.match(/data-tab="[^"]+"/g)).toEqual(['Apps', 'To test', 'Decisions', 'Changelog', 'Clock', 'Pipeline'].map(t => `data-tab="${t}"`))
    expect(html.indexOf('>housekeeping<')).toBeGreaterThan(-1)
    expect(html.indexOf('>housekeeping<')).toBeLessThan(html.indexOf('>pipeline-metrics<'))
    expect(html).toContain('daily 06:00 UTC')
    expect(html).toContain('data-color="error"')
    expect(html).toContain('>missed<')
    expect(html).toContain('>ran<')
    expect(html).toContain('href="https://gh/runs/5"')
    expect(html).toContain('Thu 19 Nov, 11:22') // last run in Europe/Brussels (UTC+1)
  })

  it('Clock tab: a job before its move to the clock is a grey "not on the clock yet", after the red rows', async () => {
    const html = visible(await renderPage())
    expect(html).toContain('>not on the clock yet<')
    expect(html.indexOf('>housekeeping<')).toBeLessThan(html.indexOf('>weekly<'))
    expect(html).not.toMatch(/data-color="error"[^>]*>not on the clock yet</)
  })

  it('Clock tab: each row is closed by default — the job description only shows after a tap', async () => {
    const html = visible(await renderPage())
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-open="false"')
    expect(html).not.toContain('data-open="true"')
    expect(html).not.toContain('Emails the weekly drift report.')
    expect(html).not.toContain('Copies the run history.')
  })

  it('tabs: below sm only the selected tab (Apps, at first) shows its label; from sm all do', async () => {
    const html = visible(await renderPage())
    expect(html).toContain('data-tab="Apps" data-tab-label>') // empty class: label always shown
    for (const t of ['To test', 'Decisions', 'Changelog', 'Clock', 'Pipeline']) expect(html).toContain(`data-tab="${t}" data-tab-label="hidden sm:inline"`)
  })

  // covers: T6 (#4349)
  it('Pipeline tab: a read-only kanban with the six columns in order; each card links to GitHub in a new tab', async () => {
    const html = visible(await renderPage())
    expect(html).toContain('<kanban data-readonly="true">')
    expect(html.match(/data-column="[^"]+"/g)).toEqual(['Queued', 'Working', 'In review', 'Waits on you', 'To test', 'Done today'].map(c => `data-column="${c}"`))
    expect(html).toMatch(/data-column="Working"><a href="https:\/\/gh\/501" target="_blank" rel="noopener"/)
    expect(html).toContain('#501')
    expect(html).toContain('Board working ticket')
    expect(html).toContain('crouton-core') // package label without its prefix
    expect(html).toMatch(/data-column="In review">.*Board review ticket.*red check/)
    expect(html).toContain('2 tickets')
  })
})
