// Shared harness for the product route/query tests: an in-memory SQLite with the
// `user` and `catalog_products` tables, and the Nitro globals the handlers use.
// Set up the way packages/crouton-bookings/test/booking-authz.test.ts does.
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

export function createTestDb() {
  const client = new Database(':memory:')
  client.exec(`
CREATE TABLE user (id text primary key, name text, email text, image text);
CREATE TABLE catalog_products (id text primary key, teamId text not null, owner text, "order" integer, title text not null, description text, active integer, translations text, createdAt integer, updatedAt integer, createdBy text, updatedBy text);
INSERT INTO user VALUES ('u1','Me','me@x',null);
`)
  return { client, db: drizzle(client) as any }
}

export interface RequestState {
  params: Record<string, string>
  body: any
  query: Record<string, string>
}

/** Listeners the `useNitroApp().hooks.callHook` stand-in runs, in order. Tests fill and clear it. */
export const listeners: Array<(p: any) => any> = []

export function installGlobals(db: any, req: RequestState) {
  const g = globalThis as any
  g.useNitroApp = () => ({ hooks: { callHook: async (_name: string, p: any) => { for (const fn of listeners) await fn(p) } } })
  g.useDB = () => db
  g.defineEventHandler = (fn: any) => fn
  g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
  g.getRouterParam = (_e: any, k: string) => req.params[k]
  g.getRouterParams = () => req.params
  g.getQuery = () => req.query
  g.readBody = async () => req.body
  g.readValidatedBody = async (_e: any, parse: any) => parse(req.body)
}
