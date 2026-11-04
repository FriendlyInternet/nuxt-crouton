> 🗄️ **Archived 2026-11-04 (#3352) — done:** shipped as scoped-access/redeem in crouton-auth. Historical record, not current guidance.

# Scoped Access Grants — Generalizing PIN/Token Access Beyond Sales

## Summary

Promote the "present a credential, get a resource-scoped token" flow from crouton-sales into crouton-auth as a first-class **grant** system. crouton-auth already owns the token half (`scopedAccessToken`); this brief adds the missing credential half (`scopedAccessGrant`), a generic redeem endpoint, and a standard transport convention. Once in place, crouton-pages gains a `scoped` visibility tier (volunteer-visible / PIN-protected pages), and any future domain (bookings, registrations, check-in) gets accountless access for free. Sales becomes the first consumer instead of the owner.

## Context

The helpers system is currently split:

- **Generic, in crouton-auth**: `scopedAccessToken` table (`server/database/schema/auth.ts:327`) — `{ resourceType, resourceId, role, displayName, expiresAt }` — plus `createScopedToken` / `validateScopedToken` / `requireScopedAccess` server utils, `/api/auth/scoped-access/validate|refresh|logout` endpoints, and `useScopedAccess` / `useEventAccess` composables.
- **Sales-specific, but shouldn't be**: the *issuance ritual*. The PIN lives as a column on `salesEvents`; `helper-login.post.ts` knows where to find it, compares it, and calls `createScopedToken`. `admin-helper-token.post.ts` does session → token minting. Nothing about "credential + display name → scoped token" is sales-specific — only "where the PIN is stored" is.

The trigger for this brief: wanting CMS pages (crouton-pages) visible to volunteers. Pages' `visibility` enum (`public` / `members` / `admin` / `hidden`) only understands better-auth sessions + org membership — scoped-token holders have neither. Rather than teaching pages about sales, the right move is making the credential system generic.

### Why not better-auth plugins (verified against docs, June 2026)

Every better-auth plugin in this neighborhood terminates in a **real user + session**, which is exactly what scoped access avoids:

| Plugin | What it does | Why it doesn't fit |
|--------|-------------|-------------------|
| `magic-link` | Email link → user session (already enabled for members) | Requires email, creates real users |
| `anonymous` | Creates user records flagged `isAnonymous` with real sessions | No expiry/cleanup, no resource scoping, pollutes `user` table with `temp-{id}@...` ghosts |
| `one-time-token` | Single-use token for cross-domain session transfer | Requires an *existing* session |
| `api-key` | Keys with expiry, rate limiting, metadata, permissions; can be org-owned (no user) | Machine-to-machine: the key *is* the credential — no redeem step (shared PIN → per-person token), no display name, resource scoping only via metadata hacks |

The two genuinely missing pieces — the **redeem step** and **first-class resource scoping** — are net-new regardless. The `api-key` plugin's shape (per-credential expiry + rate-limit config + metadata) is a good template for the grant row; steal the pattern, not the plugin.

## Architecture

### Design principles

1. **Grants are not accounts.** If someone needs to be the same person next month, they need a user account. If they exist for the duration of a resource, they're a grant. Scoped access deliberately has no email, no identity, no lifecycle beyond expiry — resist scope creep toward user management.
2. **Auth owns credential → token → validation end to end** (grants, verification, rate limits, header convention, composables). **Domains own only the binding**: which resource gets a grant, what role the token carries, what UI hosts the login.
3. **Role vocabulary stays in the domain.** The grant/token carry a `role` string; what `'helper'` permits is the consuming package's business. No central role enum in auth.
4. **Credential types are pluggable.** What varies between PIN / magic link / invite code is only "does this presented thing match this grant?" — everything downstream (mint, validate, refresh, expire) is invariant.

### New table: `scopedAccessGrant` (crouton-auth)

```typescript
export const scopedAccessGrant = sqliteTable('scopedAccessGrant', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organizationId').notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  /** What this grant unlocks */
  resourceType: text('resourceType').notNull(),   // 'event', 'page', 'booking', ...
  resourceId: text('resourceId').notNull(),
  /** Role stamped onto tokens minted from this grant */
  role: text('role').notNull().default('guest'),
  /** How the secret is presented. 'pin' now; 'link' (magic-link/QR) later */
  credentialType: text('credentialType').notNull().default('pin'),
  /** Hashed secret (never store plaintext) */
  secretHash: text('secretHash').notNull(),
  /** Redemption limits — null = unlimited (shared event PIN) */
  maxUses: integer('maxUses'),
  usedCount: integer('usedCount').notNull().default(0),
  /** Grant lifecycle (independent of token lifecycle) */
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }),   // null = follows resource
  /** TTL for tokens minted from this grant (ms) */
  tokenTtl: integer('tokenTtl').notNull().default(8 * 60 * 60 * 1000),
  metadata: text('metadata'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date())
}, table => [
  index('scoped_grant_resource_idx').on(table.resourceType, table.resourceId),
  index('scoped_grant_org_idx').on(table.organizationId)
])
```

Notes:
- A shared event PIN = one grant, `credentialType: 'pin'`, `maxUses: null`. An invite code = `maxUses: 1`. A magic link = `credentialType: 'link'` with the secret embedded in a URL (`?grant=...`) — same row, different transport. Naming the column now avoids a migration later.
- PIN hashing: PINs are low-entropy, so the hash is **not** the security boundary — rate limiting is. A cheap salted hash is fine; don't burn CPU on scrypt for a 4-digit PIN on Workers.

### New endpoint: redeem (crouton-auth)

```
POST /api/auth/scoped-access/redeem
body: { teamId, resourceType, resourceId, secret, displayName }
→ { token, displayName, role, resourceType, resourceId, expiresAt }
```

Flow: resolve team (`resolveTeamBySlugOrId` semantics) → find active grant for `(resourceType, resourceId)` → verify secret per `credentialType` → check `maxUses`/`expiresAt` → increment `usedCount` → `createScopedToken({ ...grant fields, displayName })`.

**Rate limiting is mandatory here** — a shared 4–6 digit PIN behind an unthrottled endpoint is brute-forceable in minutes. Centralizing in auth means it's written once: per-IP + per-grant attempt throttling (KV-backed counter or `nuxthub-ratelimit` route rule on `/api/auth/scoped-access/redeem`). This is strictly better than today, where each domain endpoint would need its own.

### Session-derived minting (generalize `admin-helper-token`)

```
POST /api/auth/scoped-access/mint
body: { teamId, resourceType, resourceId, role, displayName? }
```

Requires a team-member session (`requireTeamMember`); mints a scoped token directly, no grant/secret involved. This is what sales' `admin-helper-token.post.ts` already does for `('event', eventId)` — it just becomes generic delegation.

### Standard transport convention

Declare **`x-scoped-token`** as the canonical header in crouton-auth. Today sales sends `x-helper-token` while the CLAUDE.md example uses `'pos-helper-token'` — every consumer invents its own, so no shared middleware can check uniformly. `requireScopedAccess(event)` should default to the canonical header (keep the param as override for back-compat during migration). Mirror the token into a cookie (`scoped-access-token`, path-scoped if possible) so SSR can see it — required for the pages tier below.

### Grant management API + UI

- `GET/POST/DELETE /api/auth/teams/[id]/scoped-grants` (admin-only) — list/create/revoke grants for a resource.
- Small composable `useScopedGrants(resourceType, resourceId)` for admin UIs.
- Domains typically won't call these directly from UI — e.g. sales syncs the event PIN into a grant on event create/update — but a generic "access grants" admin panel becomes possible later.

## Consumers

### crouton-sales (migration — first consumer)

1. On event create/update, upsert a grant `('event', eventId, role: 'helper', credentialType: 'pin')` from the event's PIN field. The PIN column on `salesEvents` stays as the editable source of truth; the grant is derived state.
2. `helper-login.post.ts` → thin wrapper around (or deprecated in favor of) the generic redeem endpoint.
3. `admin-helper-token.post.ts` → thin wrapper around generic mint.
4. `useHelperAuth` keeps its public API; internally targets the new endpoints and `x-scoped-token`.
5. Backfill: one-off script creating grants for existing events with PINs. Existing live tokens keep working — the token table doesn't change.

### crouton-pages — `scoped` visibility tier

Add `scoped` to the visibility enum (`schemas/pages.json` + generated collection). Enforcement in `server/api/teams/[id]/pages/[...slug].get.ts` alongside the existing `members`/`admin` branch (~line 213):

- `visibility: 'scoped'` passes if the request carries a valid scoped token for the team (session-holders also pass, so admins can preview).
- Optional precision via the existing `config` json: `{ requiredScope: { resourceType, resourceId } }` — "volunteers of *this* event only." Pages compares strings against token claims; it never learns what an 'event' is.
- **Page-owned grants**: a page can be its own resource — grant on `('page', pageId)` = "enter PIN to view this page" / QR-on-a-poster, with zero sales involvement.

Known friction to handle:
- **SSR**: the token must reach the server — hence the cookie mirror above; otherwise scoped pages render client-side only.
- **Caching**: pages routes use ISR/SWR; scoped responses must ride the same uncached path the members-only check already uses (see comment in `pages.get.ts:19-23`). Never let gated content into the shared cache.
- **Navigation**: `useNavigation` filters by visibility; `scoped` pages appear only when a token is present client-side.

### Future consumers (no extra auth work)

- Bookings: magic-link token to view/manage a booking (`credentialType: 'link'`, `maxUses` per policy).
- Registrations/check-in: PIN-gated check-in screen, wristband-style lookups via `metadata`.

## Phases

| Phase | Scope | Packages |
|-------|-------|----------|
| 1 | `scopedAccessGrant` table + migration, redeem endpoint (PIN only) with rate limiting, mint endpoint, canonical header + cookie, server utils, tests | crouton-auth |
| 2 | Sales migration: grant sync on event save, wrap/retire `helper-login` + `admin-helper-token`, backfill script, verify on fanfare dev | crouton-sales |
| 3 | Pages `scoped` visibility: enum + endpoint branch + nav filter + SSR cookie path; optional `requiredScope` in page config | crouton-pages |
| 4 (later) | `credentialType: 'link'` (signed magic links / QR), grant admin panel, page-owned-grant editor UI | crouton-auth, crouton-pages |

Each phase is independently shippable; 2 and 3 only depend on 1.

## Open Questions

1. **Cookie vs header-only for pages SSR** — cookie mirror is the pragmatic call, but confirm it doesn't collide with the localhost cookie-collision issue between crouton apps (use an app/team-distinct name).
2. **Grant ↔ resource lifecycle** — cascade-delete grants when the resource goes? Auth can't FK into domain tables, so domains must revoke on resource delete (provide `revokeGrantsForResource` util, mirroring `revokeScopedTokensForResource`).
3. **PIN rotation semantics** — when an event PIN changes, do existing tokens survive? (Suggest: yes — tokens were legitimately minted; revoking is a separate explicit action.)
4. **Rate-limit storage** — `nuxthub-ratelimit` needs KV; not every app has `hub.kv` enabled. Decide fallback (D1-backed counter vs. requiring KV for redeem).

## Affected Files (Phase 1 reference)

- `packages/crouton-auth/server/database/schema/auth.ts` — add `scopedAccessGrant`
- `packages/crouton-auth/server/utils/scoped-access.ts` — `createGrant`, `verifyAndRedeemGrant`, `revokeGrantsForResource`
- `packages/crouton-auth/server/api/auth/scoped-access/redeem.post.ts` — new
- `packages/crouton-auth/server/api/auth/scoped-access/mint.post.ts` — new
- `packages/crouton-auth/app/composables/useScopedAccess.ts` — redeem support, canonical header
- `packages/crouton-auth/CLAUDE.md` — document grants, redeem/mint, header convention

> ⚠️ All `packages/` edits go through the package-edit approval gate per CLAUDE.md.