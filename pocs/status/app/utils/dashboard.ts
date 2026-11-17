// Shared types + small helpers for the /apps dashboard and its tab components.

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
export type AppCardRow = AppRow & { toTest: ToTestItem[] }
export interface ToTestGroup { app: string, list: ToTestItem[], stagingUrl: string | null }
export interface Decision { date: string, epic: number, decision: string, why: string, rejected: string }
export interface OpenQuestion { number: number, title: string, url: string }
export interface ChangelogRow { date: string, number: number, title: string, area: string, url: string }

export const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
