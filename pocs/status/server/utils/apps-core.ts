// Pure grouping for GET /api/status/apps — no Nitro auto-imports, so it unit-tests.
import type { LiveApp, Preview } from './live-apps-core'
import type { ToTestItem } from './totest-core'

export interface AppQuestion { number: number, title: string, url: string, app: string | null }
export interface AppDecision { app: string | null }

export interface AppCard<D extends AppDecision = AppDecision> {
  /** null = the General card: items with no app. */
  app: string | null
  stagingUrl: string | null
  hasSignIn: boolean
  /** Owner-only one-tap sign-in (302s to the staging review login); null when the app has none. */
  signInUrl: string | null
  previews: Array<Pick<Preview, 'pr' | 'title' | 'updatedAt' | 'url'>>
  toTest: ToTestItem[]
  questions: AppQuestion[]
  decisions: D[]
}

/** One card per live app plus any app named only by an item, and a General (null) card when something has no app. Most to-test first. */
export function buildAppCards<D extends AppDecision>(input: {
  apps: LiveApp[]
  previews: Preview[]
  toTest: ToTestItem[]
  questions: AppQuestion[]
  decisions: D[]
}): Array<AppCard<D>> {
  const known = new Map(input.apps.map(a => [a.app, a]))
  const names = new Set<string | null>(input.apps.map(a => a.app))
  for (const x of [...input.toTest, ...input.questions, ...input.decisions]) {
    if (x.app === null || known.has(x.app)) { if (x.app === null) names.add(null) } else names.add(x.app)
  }
  const cards = [...names].map((app): AppCard<D> => {
    const live = app ? known.get(app) : undefined
    const hasSignIn = !!app && !!live?.hasSignIn && !!live.stagingUrl
    return {
      app,
      stagingUrl: live?.stagingUrl ?? null,
      hasSignIn,
      signInUrl: hasSignIn ? `/api/status/login/${app}` : null,
      previews: input.previews.filter(p => p.app === app).map(({ pr, title, updatedAt, url }) => ({ pr, title, updatedAt, url })),
      toTest: input.toTest.filter(i => i.app === app),
      questions: input.questions.filter(q => q.app === app),
      decisions: input.decisions.filter(d => d.app === app)
    }
  })
  return cards.sort((a, b) =>
    b.toTest.length - a.toTest.length
    || (a.app === null ? 1 : 0) - (b.app === null ? 1 : 0)
    || (a.app ?? '').localeCompare(b.app ?? '')
  )
}
