// Shapes returned by the /api/status/* reads, shared by the /apps page tabs.

export interface ToTestItem {
  kind: 'epic' | 'pr'
  number: number
  title: string
  url: string
  app: string | null
  what: string
  steps: string[]
  to: string
  stagingUrl: string | null
  mergedAt?: string | null
}

export interface AppRow {
  app: string
  stagingUrl: string | null
  hasSignIn: boolean
  previews: Array<{ pr: number, title: string, updatedAt: string, url: string }>
}

export interface Decision { date: string, epic: number, decision: string, why: string, rejected: string }
export interface OpenQuestion { number: number, title: string, url: string }
export interface ChangelogRow { date: string, number: number, title: string, area: string, url: string }

export const REPO_URL = 'https://github.com/FriendlyInternet/nuxt-crouton'

export const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
