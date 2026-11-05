> 🗄️ **Archived 2026-11-04 (#3352) — done:** shipped as ScopedAccessGate in crouton-pages. Historical record, not current guidance.

# Scoped Gate Kassa — One PIN from Page Gate to POS

## Summary

Today a volunteer opening a code-gated kassa page logs in twice: the page's access code
(`('page', pageId)` grant) unlocks the page, then the helper PIN inside `SalesPosPanel`
(`('event', eventId)` grant) unlocks checkout. This brief collapses that into **one PIN at the
page gate**: when a scoped page embeds a kassa block, the gate redeems the **event grant**
directly and the token it mints *is* a helper token. The kassa adopts that session and skips its
own PIN form. The in-panel PIN form survives as a thin fallback (public/hidden pages, direct
embeds) rewired onto the same generic redeem path — the bespoke `helper-login` endpoint is
deleted. Net result: one credential (`salesEvents.helperPin`), one redeem endpoint, one client
session store, one transport; two doorways that never compete.

The required scope is **derived at request time via a Nitro hook, never stored** — the page's
content blocks are the source of truth, so there is no denormalized state to drift, no clearing
rule, and no migration of existing pages.

## Context

### The two-door flow

- `feat(crouton-pages): scoped page visibility` (1fe4e640) + `access-code gate` (04844ce7) gave
  pages a `scoped` visibility tier: the slug endpoint 401s with the scope a credential must be
  redeemed against, and `ScopedAccessGate.vue` renders an inline PIN form against the generic
  `/api/auth/scoped-access/redeem`. The editor manages a `('page', pageId)` grant via the
  access-code endpoint.
- The sales POS endpoints (`order-data` GET, `orders` POST, `clients` POST, reprint) all call
  `requireScopedAccessToResource(event, 'event', eventId)` — a page token gets 401/403 there. So
  the volunteer still needs the helper PIN login inside the panel, which hits the sales-owned
  `helper-login` endpoint (lazy `helperPin` → grant sync + redeem).

### The cookie collision (already bitten once)

`fix(crouton-sales): checkout sends the helper token header explicitly` (06f4abde): the
`scoped-access-token` cookie is **one global httpOnly cookie per browser, shared by every scoped
flow**. Unlocking an access-code page overwrote it with a page token; checkout presented that to
the event endpoint and got 403. The fix: the POS always sends its own client-held token via the
`x-scoped-token` header, which wins over the cookie server-side. **Design constraint that
follows: checkout must never depend on the cookie.** Any "adopt the gate session" mechanism must
hand the client a real token, not introspect the httpOnly cookie. (Corollary: JS can never clear
or overwrite the httpOnly cookie — `useScopedAccess`'s token-cookie writes are silent no-ops
against the server-set copy. No new logic may assume the client can clear it.)

### Why not teach sales to accept page tokens

The alternative — sales endpoints accepting `('page', pageId)` tokens when that page embeds the
event's block — couples sales → pages, needs a server-side page→event mapping, and breaks the
clean "domains own the binding" principle from the grants brief. Rejected.

### Why not store `requiredScope` at save time

An earlier draft had the editor write `config.requiredScope` when a scoped page contains the
kassa block. Rejected after review: it creates derived state with **multiple writers and no
clearing rule**. Visibility is edited in the page form, content in the block editor — flip an
existing page to `scoped` without re-saving content and the scope is never written; remove the
block, change the event, or delete the event and the stored scope goes stale (a deleted event
would leave the page permanently un-unlockable with no admin-visible signal). It also forces a
migration step for existing pages (blocks store `eventSlug`, tokens are id-scoped). Read-time
derivation deletes the entire drift class.

## Design

### Flow: volunteer on a scoped kassa page

```
volunteer opens page (no token)
    │
    ▼
slug endpoint (visibility 'scoped'):
    derive scope → callHook('crouton:pages:derive-scope', { blocks, teamId })
    sales plugin matches eventWorkspaceBlock, resolves eventSlug → eventId,
    answers { resourceType: 'event', resourceId, nameRequired: true }
    │
    ▼
401 { scope: { resourceType: 'event', resourceId, nameRequired: true } }
    │
    ▼
ScopedAccessGate: name (required, whitespace rejected) + PIN (= the event's helper PIN)
    │  redeem via useScopedAccess(scope.resourceType).redeem(...)
    │  → before-redeem hook syncs salesEvents.helperPin → event grant (trimmed)
    │  → token scoped to ('event', eventId), displayName = entered name
    │  → httpOnly cookie set (page SSR check) + client-held session saved
    ▼
page refetch → 200, block renders SalesPosPanel
    │
    ▼
useHelperAuth.adoptScopedSession(): copies the event session into its own
localStorage session → isHelper = true, PIN form never renders
    │
    ▼
checkout/order-data/print: explicit x-scoped-token header (unchanged)
displayName flows to order.owner and tickets (unchanged)
```

### Flow: fallback (public/hidden page, direct `SalesPosPanel` embed)

No gate ran → panel shows its own PIN form → `useScopedAccess('event').redeem(...)` (same
endpoint, same hook, same token shape) → same session handling. Team sessions keep auto-login
via `admin-helper-token` (unchanged).

### Decisions

1. **Scope is derived at read time via `crouton:pages:derive-scope` — never stored.** On a
   `scoped` page, the slug endpoint parses the content blocks (already loaded) and fires the
   hook with `{ teamId, blocks }`; domain plugins may answer with a scope. crouton-sales ships
   the handler for `eventWorkspaceBlock`, resolving `eventSlug` → event **id** with its own DB
   access — pages stays generic, no sales knowledge leaks, no `eventId` block-attr migration.
   Rules: the **first scoped block wins** (later ones fall back to the in-panel PIN form); a
   derived scope **takes precedence** over a stored `config.requiredScope` and over the
   `('page', pageId)` fallback; if no plugin answers (block removed, event deleted, slug
   unresolvable), the page falls back to its page-code gate — self-healing, never a dead end.
   Cost: one hook call + one indexed slug lookup per request, only on `scoped` pages, which are
   already `Cache-Control: no-store`. `config.requiredScope` survives as a manual override for
   pages without a scope-providing block.
2. **PIN sync moves to a before-redeem hook.** The generic redeem endpoint calls
   `nitroApp.hooks.callHook('crouton:scoped-access:before-redeem', { organizationId,
   resourceType, resourceId, credentialType })` before `verifyAndRedeemGrant`. crouton-sales
   ships a Nitro plugin that, for `resourceType === 'event'`, upserts the grant from
   `salesEvents.helperPin` — the sync block moved out of `helper-login`. The hook **must trim**
   the synced pin (`String(helperPin).trim()` — helper-login did; the generic redeem does not
   trim server-side, so an untrimmed sync would mismatch forever). The grant stays derived state
   with no backfill; auth stays domain-agnostic (it fires a hook, it doesn't know what an event
   is). **Invariant: the event grant is fully owned by the sync** — `upsertScopedGrant`
   unconditionally overwrites `role`, `maxUses`, `expiresAt`, `tokenTtl` on every login attempt,
   so the grant must never be hand-edited.
3. **The gate stores the session client-side via `useScopedAccess`.** The gate currently raw-
   `$fetch`es redeem and ignores the returned token. Switch it to
   `useScopedAccess(scope.resourceType).redeem(...)`: the composable already saves a
   client-readable session (`scoped-access-session` cookie + `useState`) and exposes
   `authHeaders`. The httpOnly `scoped-access-token` cookie keeps its one job — the page's SSR
   check. **No whoami/session endpoint; no cookie introspection** (see cookie collision above).
   Caveat: `useScopedAccess` currently has **zero live consumers** — its cookie persistence,
   expiry handling, and SSR `loadSession()` have never run in production. Phase 1 must exercise
   it, and fix one latent drift: the session cookie's `maxAge` is a fixed 8h
   (`useScopedAccess.ts:80`) independent of the token's real `expiresAt` — derive it from the
   session's `expiresAt` instead.
4. **Adoption is copy, not reference — and logout clears the source.** On mount without a
   session, `useHelperAuth` reads the `useScopedAccess('event')` session; if `resourceId`
   matches the panel's event, it **copies** it into its own localStorage session
   (`pos-helper-info`) and is logged in. Copying means the shift survives later clobbering of
   either shared cookie by other scoped flows — the worst case is re-entering the PIN after a
   page reload (SSR re-gates), never a broken checkout. **Blocking requirement:**
   `useHelperAuth.logout()` must also clear the `useScopedAccess('event')` session it adopted
   from. Without this, logout is a no-op by construction: the panel's mount order (adopt → admin
   → PIN form) immediately re-adopts the persistent source — as the same name on a handover, or
   as a revoked token after the server-side revoke, landing checkout in a 401/Retry error state
   instead of the PIN form.
5. **Name required at the gate for kassa scopes.** The gate's name field is optional (defaults
   to "Guest") — wrong for a register where the name prints on tickets and lands on
   `order.owner`. The `nameRequired` flag in the announced scope (set by the derive-scope
   answer, decision 1) makes the gate require it — and the gate must reject whitespace-only
   input rather than fall into the "Guest" default. Be explicit about what this is: a **UX
   nudge, not a guarantee** — the redeem endpoint accepts any non-empty `displayName`, so
   whoever holds the PIN can curl a token as "x". Acceptable threat model (the PIN holder is
   trusted). Content pages gated by a page code keep the optional name.
6. **Keep both doorways, delete the bespoke path.** The in-panel PIN form stays as fallback but
   calls the generic redeem (mapping `resourceId` → `eventId` in the session shape, and
   trimming the presented PIN — the generic endpoint doesn't). Deleted: the `helper-login`
   endpoint and `useHelperAuth.login()`'s custom-endpoint logic. PIN verification + brute-force
   lockout were already delegated to `verifyAndRedeemGrant`; nothing of value remains in the
   endpoint once the sync moves to the hook (decision 2). **Accepted regression:** helper-login's
   explicit 400 "Helper PIN not configured" and 404 "Event not found" collapse into the generic
   401 — deliberate no-leak posture on a public endpoint, but operationally a volunteer at the
   door can't tell "wrong PIN" from "admin never set one". Mitigation lives in the editor, not
   the endpoint (see Editor UX below).

### Editor UX

- The access-code field hides (replaced by a "gated by the event's helper PIN" hint) when the
  page is `scoped` and its content contains a scope-providing block. Detection is client-side
  via a flag on the block definition (e.g. `providesScope: true` on `eventWorkspaceBlock` in
  `croutonBlocks`) — the editor never re-implements the server's derivation, it only mirrors it
  for the hint. Note the policy change this implies: a kassa-embedding page can no longer carry
  its own access code distinct from the helper PIN — one trust level per page.
- **Warning when the bound event has no `helperPin`**: the editor has the full event row in the
  `EventSlugPicker`, so surface "this page is gated by the event's helper PIN, but none is set"
  inline. This is the admin-visible counterpart to the generic 401 (decision 6).
- A pre-existing `('page', pageId)` grant on a page that gains a kassa block is not revoked —
  under read-time derivation that's coherent, not a bug: while the block is present the derived
  event scope wins and the page code is inert; remove the block and the page-code gate resumes.
  Document it, don't clean it up.

## Changes by package

### crouton-auth

| Change | Where |
|--------|-------|
| Fire `crouton:scoped-access:before-redeem` hook before `verifyAndRedeemGrant` (failures in the hook must not leak credential info; log and continue to normal 401) | `server/api/auth/scoped-access/redeem.post.ts` |
| `upsertScopedGrant`: add `skipWhenLocked` option — skip the UPDATE when `lockedUntil` is in the future (the existing-grant SELECT already happens). The before-redeem hook passes it, so a locked-out attacker can't drive a DB write per attempt on a public endpoint | `server/utils/scoped-access.ts` |
| Unify `useScopedAccess` storage keys: derive from resourceType (`scoped-access-session-${resourceType}`) so the gate (generic) and `useEventAccess` (currently hardcodes `event-access-session`) land on the same session | `app/composables/useScopedAccess.ts` |
| Derive the session cookie's `maxAge` from the session's `expiresAt` instead of the fixed 8h | `app/composables/useScopedAccess.ts` |
| Docs: add `/api/auth/scoped-access/*` to the recommended strict rate-limit list | `CLAUDE.md` rate-limiting table |

### crouton-pages

| Change | Where |
|--------|-------|
| On `scoped` visibility: parse content blocks, fire `crouton:pages:derive-scope`, use the answered scope (precedence: derived > `config.requiredScope` > `('page', pageId)`); echo it — including `nameRequired` — in the 401 `data.scope` payload (the payload already echoes the scope verbatim, so this is near-zero lines) | `server/api/teams/[id]/pages/[...slug].get.ts` |
| Gate: redeem via `useScopedAccess(scope.resourceType)`; require non-whitespace name when `scope.nameRequired` | `app/components/ScopedAccessGate.vue` |
| Editor: hide the access-code field + show the "gated by helper PIN" hint when the page is scoped and content has a `providesScope` block | `app/components/Editor/Toolbar.vue`, `Workspace/Editor.vue` |
| Type: extend the block-definition type with the optional `providesScope` flag (editor hint only — derivation is server-side) | `app/utils/block-registry.ts` types |

### crouton-sales

| Change | Where |
|--------|-------|
| Nitro plugin: on `before-redeem` for `resourceType 'event'`, lazy-sync `salesEvents.helperPin` → grant (move the sync block out of `helper-login`; **trim the pin**; pass `skipWhenLocked`) | new `server/plugins/` file |
| Nitro plugin (can share the file): on `derive-scope`, match `eventWorkspaceBlock` in the blocks, resolve `eventSlug` → event id, answer `{ resourceType: 'event', resourceId, nameRequired: true }`; answer nothing when the event can't be resolved | same `server/plugins/` file |
| `eventWorkspaceBlock`: add `providesScope: true` to the definition (editor hint); `EventSlugPicker` surfaces the missing-helperPin warning | `app/app.config.ts`, picker component |
| `useHelperAuth`: add `adoptScopedSession()` (copy from `useScopedAccess('event')` when resourceId matches); **`logout()` additionally clears the `useScopedAccess('event')` session**; rewire `login()` to the generic redeem (trim pin, map `resourceId`→`eventId`); keep `loginAsAdmin`, session shape | `app/composables/useHelperAuth.ts` |
| Panel: try adopt → admin auto-login → PIN form (fallback), in that order | `app/components/Pos/Panel.vue` |
| Delete `helper-login` endpoint | `server/api/crouton-sales/teams/[id]/events/[eventId]/helper-login.post.ts` |

## What stays unchanged

- **Sales POS endpoints** — zero changes; they keep demanding `('event', eventId)` tokens.
- **Block attrs** — `eventWorkspaceBlock` keeps storing `eventSlug` only; the derive-scope hook
  resolves it server-side, so existing pages (fanfare) need no re-save or event re-pick.
- **`salesEvents.helperPin` + the Helpers card** in SettingsTab — still the single credential's
  source of truth and the active-helpers view. Gate-logged volunteers now *appear* in
  active-helpers (they're event tokens). No dedup of the list (explicit decision).
- **`admin-helper-token` / `loginAsAdmin`** — team sessions never touch PINs.
- **Transport** — explicit `x-scoped-token` header on POS calls (06f4abde stays load-bearing).
- **Receipt/order plumbing** — `displayName` → `order.owner` → tickets, untouched.
- **`config.requiredScope`** — still honored as a manual override (and the `('page', pageId)`
  self-service gate is untouched); derived scope merely outranks it.

## Edge cases & risks

- **Cookie clobbering** (another scoped redeem on the same device): checkout unaffected
  (client-held token + header). Page reload re-gates; volunteer re-enters PIN. Accepted.
- **Logout / shift handover**: logout revokes the token server-side, clears the local session
  *and* the adopted-from gate session (decision 4) → the panel falls through to the PIN form;
  the next volunteer enters their own name. The httpOnly cookie still holds the revoked token
  until the next redeem overwrites it — harmless: SSR validation fails, the page re-gates.
- **PIN change mid-shift**: existing tokens stay valid until expiry (tokens are not revoked on
  grant change — same as today). New logins use the new PIN immediately via the lazy sync.
- **Event deleted / block removed / slug stale**: the derive-scope hook answers nothing → the
  page falls back to its page-code gate. No stored state to go stale, no permanent lockout.
- **Multiple scoped blocks on one page**: first wins; later blocks rely on the in-panel PIN
  fallback. Written down so nobody re-litigates it at implementation time.
- **Hook failure mode (before-redeem)**: if the sales plugin can't read `salesEvents`
  (misconfigured app), the redeem proceeds and fails as `not_found`/`invalid_secret` —
  indistinguishable to clients, no info leak. First-ever login for an event needs the sync to
  create the grant, so a broken hook means no volunteer logins; surfaced in server logs. The
  admin-facing signal for "no PIN configured" is the editor warning, not the endpoint.
- **Pre-auth writes on a public endpoint**: the before-redeem hook costs a `salesEvents` select
  + grant upsert per attempt for attacker-chosen (team, event) pairs — same shape as today's
  helper-login, but the generic endpoint is more discoverable. Mitigated by `skipWhenLocked`
  (no write while locked out) and the strict rate-limit recommendation on
  `/api/auth/scoped-access/*`.
- **Public-page kassa**: keeps working via the panel's fallback form — no migration deadline.
  Flipping fanfare's volunteer page to `scoped` is still the goal, but it's opt-in, not a
  breaking deploy.
- **Stale localStorage vs fresh gate session**: adoption only runs when there's no valid local
  session; an expired local session is cleared first (existing behavior), then adoption kicks in.

## Open implementation details

1. **Derive-scope hook contract.** Hook handlers receive `{ teamId, blocks }` and the first
   non-null answer wins. Decide the exact mechanism (Nitro hooks are fire-and-forget by default
   — likely a mutable `result` field on the payload, same pattern other crouton hooks use).
2. **TTL parity (corrected).** `helper-login` never set `tokenTtl` — the 8h comes from
   `upsertScopedGrant`'s default (`scoped-access.ts:523`), so there is nothing to carry over.
   But note the coupling: if a grant ever sets a different `tokenTtl`, the `useScopedAccess`
   session-cookie `maxAge` fix (crouton-auth table) is what keeps the client session honest.
3. **Derive-scope lookup cost.** One slug→id select per scoped-page request. If it ever matters,
   the picker writing `eventId` into block attrs (it has the full event row) lets the hook skip
   the lookup — an optimization, not a prerequisite.

## Phases

1. **crouton-auth**: before-redeem hook + `skipWhenLocked` + storage-key unification + cookie
   `maxAge` from `expiresAt`. Exercise `useScopedAccess` (currently zero live consumers) —
   extend its unit tests over save/load/expiry before anything depends on it.
2. **crouton-sales server**: sync plugin (trimmed, lock-aware) + derive-scope plugin; verify
   volunteer PIN login still works through `helper-login` (not yet deleted) *and* through
   generic redeem.
3. **crouton-pages**: slug endpoint derive-scope call + precedence, gate via composable,
   `nameRequired` (whitespace rejected), editor hint + access-code hiding, missing-PIN warning.
   End-to-end testable immediately against fanfare's existing block — derivation needs no new
   stored state (this was the phase-ordering gap in the save-time design).
4. **crouton-sales client**: `providesScope` flag, adoption + logout-clears-source in
   `useHelperAuth`/Panel, rewire fallback form (trim + field mapping), delete `helper-login`.
5. **Fanfare verification**: flip the volunteer kassa page to `scoped` (no event re-pick
   needed), walk the full flow on dev: gate login → order → ticket shows name → active-helpers
   shows volunteer → **logout → PIN form returns (not an error state) → second volunteer logs
   in under their own name** → cookie clobber test: redeem a second scoped page in another tab,
   checkout still succeeds → remove the block from a test page and confirm the page-code gate
   resumes.

## Out of scope

- Deduplicating the active-helpers list (explicitly declined).
- Revoking live tokens on PIN change.
- Multi-event sessions on one device (one event session at a time per browser, as today).
- Server-side `displayName` quality enforcement (`nameRequired` is a gate-UI nudge; the endpoint
  keeps accepting any non-empty name).