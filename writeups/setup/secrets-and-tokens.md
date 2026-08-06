# Secrets & Tokens — what this repo needs (and how to keep it sane)

> **Single source of truth** for every credential `FriendlyInternet/nuxt-crouton` uses: what it is,
> why it exists, the *minimal* scope, where it's stored, and how to (re)create it.
> Written because the credentials were sprawling — multiple tokens for one job, and
> scope gaps discovered only by failed deploys. This doc is the antidote.

## The one idea: there are **two tiers** of credential

Almost all the confusion comes from mixing these up. They have opposite rules.

| | **Tier 1 — Build/CI infra** | **Tier 2 — Runtime (a deployed Worker acts on GitHub)** |
|---|---|---|
| Who uses it | GitHub Actions (deploy, the agent pipeline) | The *running* Cloudflare Worker, on its own, with no human present |
| How many | **Few — consolidate to a handful** | **One per feature — do NOT centralize** |
| Stored in | GitHub Actions secrets | **Cloudflare Worker secrets only** (never CI, never the repo) |
| Lifetime | Stable, managed once | **Interim / disposable** — short expiry, rotate hard |
| Durable target | Stays as-is | **One GitHub App** (see the end) |

If you remember nothing else: **Tier 1 = a small fixed set you set up once. Tier 2 = throwaway per-feature tokens that a GitHub App will eventually replace.**

---

## Tier 1 — Build / CI infra credentials

> 🏢 **Org-owned (#546).** The repo lives under the **FriendlyInternet** org. Store these as
> **org-level** secrets with visibility **Selected repositories → `nuxt-crouton`** (least exposure —
> don't leave them org-wide-visible). The **5 required** secrets below are the whole set the repo's
> CI actually reads; `GITHUB_TOKEN` is automatic, and `WORKER_SECRETS_JSON` is optional. The repo is
> **fully PAT-free** — `PROJECTS_TOKEN` and `DISPATCH_TOKEN` are retired (replaced by the Nuxt Harness
> App, which also writes the org board).

**Required (5):** `ANTHROPIC_API_KEY` · `CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID` · `HARNESS_APP_ID` · `HARNESS_APP_PRIVATE_KEY`.

| Secret | System | Used by (workflows) | Why | Minimal scope |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | `claude`, `decompose-on-issue`, `resume-on-comment`, `sync-changelogs` | The agent pipeline runs headless → **API-billed** (never a subscription token) | a standard Anthropic API key |
| `CLOUDFLARE_API_TOKEN` | Cloudflare | `deploy-app` (+ every `deploy-*`), `db-clone`, `db-counts` | `wrangler` deploys Workers + runs D1 ops | Account: Workers Scripts / D1 / KV / R2 **Edit** · **Zone: Workers Routes + DNS Edit** for `pmcp.dev` (+ `friendlyinter.net` for prod) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | same | which account to deploy into | an identifier — **not secret**, just stored alongside |
| `HARNESS_APP_ID` | GitHub | `comment-dispatch`, `schedule-waves`, `project-status` | App **id** for the Nuxt Harness App — used to mint installation tokens at runtime so dispatch + the board write are **App-actored, not a human PAT** | an identifier (`4107840`) — **not secret**, stored alongside the key |
| `HARNESS_APP_PRIVATE_KEY` | GitHub | `comment-dispatch`, `schedule-waves`, `project-status` | App **private key** (PEM). `actions/create-github-app-token` signs a JWT → short-lived installation token: applies the `delegate` label (passes the bot-actor guard via `allowed_bots`) and writes the **org** Projects board | the App's PEM private key · App installed on **FriendlyInternet** with Issues: write + Organization → Projects: R/W |
| `GITHUB_TOKEN` | GitHub | `comment-dispatch`, `schedule-waves`, `epic-digest`, `sync-changelogs` | The **built-in** Actions token | **automatic — you never create or store this** |
| `WORKER_SECRETS_JSON` *(optional)* | Cloudflare/app | `deploy-app` | **Optional** bundle of per-app **runtime** secrets pushed to the Worker on deploy (`wrangler secret bulk`) | a JSON object of `{ NAME: value }`; a **repo-level** secret. *(Not Environment-scoped — `deploy-app` reads it at the repo level. Only add it if an app actually needs bundled runtime secrets.)* |
| `REVIEW_SEED_SECRET` *(optional)* | own | `deploy-app` | **Optional** salt used only to derive the throwaway **review test login**'s password on staging previews (#608). Absent → a fixed fallback salt; the creds are posted publicly on the PR anyway, so this is belt-and-suspenders. | any random string; a **repo-level** secret. *(Staging-only — never used in production deploys.)* |
| ~~`THINKGRAPH_*` / `WEBHOOK_SECRET`~~ | app-specific | `thinkgraph-*` | One app's integration (team id, webhook secret, api url) | **ThinkGraph is parked/dead — do NOT re-add** these 5 (incl. `WEBHOOK_SECRET`); not core |

### Dispatch + board are App-actored now (no human PAT) — #546 / WS5
claude-code-action refuses runs triggered by **bot** actors. The pipeline is triggered by applying the `delegate` label — that label must be applied by an actor on claude-code-action's `allowed_bots` allow-list. The **Nuxt Harness App** (`nuxt-harness[bot]`) is on that list, so `comment-dispatch`, `schedule-waves`, **and** `project-status` mint an App installation token (`actions/create-github-app-token`, `owner: FriendlyInternet`) instead of using a human PAT. An App installation token also (unlike the built-in `GITHUB_TOKEN`) triggers the downstream `labeled` workflow and can write the org Projects v2 board. → **`PROJECTS_TOKEN`/`DISPATCH_TOKEN` retired; Tier 1 is PAT-free.**

### What we deliberately do NOT grant (and why that's good)
The `claude[bot]` GitHub App (used by claude-code-action) **cannot** push `.github/workflows/` files (`workflows` scope) or dispatch workflows (`actions` scope). Rather than grant those, we **designed around them**:
- POC deploys are **config-only** (`pocs/<name>/deploy.config.json`, which the bot *can* push) read by one shared `deploy-pocs.yml` — no per-POC workflow file.
- Deploys auto-fire on the **`pull_request`** event, so no `workflow_dispatch` is needed.

Less privilege, fewer secrets — keep it this way.

---

## Tier 2 — Runtime credentials (a deployed Worker acts on GitHub)

When a **deployed staging Worker** needs to talk to GitHub *by itself* (no human, no login on the user's phone), it carries its own token — stored as a **Cloudflare Worker secret**, never in CI or the repo. Each feature gets the **narrowest** token, with a short expiry, and is treated as **interim**.

> ### 🟢 Per *capability*, NOT per app — and most apps need **none**
> A Tier-2 token is only needed when a deployed Worker **calls the GitHub API itself at runtime**.
> A normal app or POC (library-catalog, a bookmarks app, velo, fanfare…) just serves itself and
> **never touches GitHub** → **0 Tier-2 tokens** (its only secret is `BETTER_AUTH_SECRET`). So:
> - The number of distinct tokens you manage = the number of **capabilities** (today **2**:
>   ticket-editor `Contents:R/W`, review-bridge `PRs:write`) — **not** the number of apps/POCs.
> - The **same** token value is reused across every Worker that runs that capability (identical
>   scope). E.g. review-bridge turned on for 5 staging apps = **one** token, `wrangler secret put`
>   into each of the 5 — *not* 5 tokens.
> - A wave of new POCs adds **nothing** to this list. The GitHub App (below) later removes even the 2.

| Feature (component) | Worker secret name | Action | Minimal scope |
|---|---|---|---|
| **ticket-editor** (`workers/ticket-editor`) — commits an edited Excalidraw diagram back | `GITHUB_TOKEN` | commit files via Contents API | fine-grained PAT, repo-only · **Contents: R/W** |
| **review-bridge** (`@fyit/crouton-devtools` → `POST /api/_feedback`) — posts a `🎯 Preview feedback` PR comment | `NUXT_CROUTON_REVIEW_GITHUB_TOKEN` | comment on a PR | fine-grained PAT, repo-only · **Pull requests: write** · **staging only** |

Rules for **every** Tier-2 token:
- **Cloudflare Worker secret only** — `wrangler secret put <NAME> --env staging`. Never bake into the bundle, never expose to the client, **never on a production Worker**.
- **Fine-grained, single-repo, least permission, short expiry (30–90 days), rotate hard.**
- Prefer a **dedicated bot/machine account** over a person's PAT (attributable; doesn't impersonate a human's full access).
- **Interim by design** — provision as disposable; do not adopt as "the credential."

> ⚠️ Security note (review-bridge): `/api/_feedback` is currently **unauthenticated** — anyone who reaches the staging URL can trigger a comment. Keep staging behind login, treat the token as low-trust, and rotate aggressively until the App/OAuth model lands.

---

## App **runtime** secrets (every crouton app)

Not GitHub/Cloudflare *platform* creds — these are what the app itself needs at runtime, pushed to the Worker via `WORKER_SECRETS_JSON` (or `wrangler secret`):

| Var | Secret? | What |
|---|---|---|
| `BETTER_AUTH_SECRET` | **yes** | signing secret for auth; per-app (or per-environment) |
| `BETTER_AUTH_URL` | no | the app's public URL — **must match the deployed URL** or auth breaks (this is why the `pmcp.dev` domain binding matters) |

## Local development

The **only** secret local dev needs is `BETTER_AUTH_SECRET`, and the session-start hook already exports a dev value. No Cloudflare creds, no tokens — `pnpm dev` runs on local SQLite (`hub: { db: 'sqlite' }`). Per-app `.env.example` files document the rest.

---

## The sprawl to clean up (why it felt heavy)

1. **Two PAT names for one job** — `DISPATCH_TOKEN` *and* `PROJECTS_TOKEN` (workflows used `DISPATCH_TOKEN || PROJECTS_TOKEN`). ✅ **Resolved (#546):** both retired — the Nuxt Harness App now mints the dispatch + board token, so the repo carries **no** label/board PAT at all.
2. **Multiple Cloudflare deploy tokens** — `workers-deploy`, `three-demo-deploy`, `fanfare-deploy`… all do the same job. Collapse to **one** `crouton-deploy` token (the scope in the Tier-1 table).
3. **Scope discovered by failure** — the CF token lacked Zone perms, so `*.pmcp.dev` silently didn't bind. Fixed by giving the one token the full least-privilege scope **up front** + a verifier (below).

---

## One-time setup checklist (~15 min)

Set all of these as **org** secrets (FriendlyInternet) with visibility **Selected → `nuxt-crouton`**.

1. **Cloudflare token** — create one `crouton-deploy` (custom token) with: Account → Workers Scripts/D1/KV/R2 **Edit**; Zone → Workers Routes + DNS **Edit** for `pmcp.dev` (+ `friendlyinter.net` for prod). Set secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. Delete the redundant per-app CF tokens.
2. **Nuxt Harness App** — set `HARNESS_APP_ID` (`4107840`) + `HARNESS_APP_PRIVATE_KEY` (the App's PEM). Install the App on the org with `nuxt-crouton` in scope, granting **Issues: write** + **Organization → Projects: Read & write**. *(No `PROJECTS_TOKEN`/`DISPATCH_TOKEN` — retired.)*
3. **Anthropic** — set `ANTHROPIC_API_KEY`.
4. **App runtime secrets (optional)** — only if an app bundles runtime secrets, set `WORKER_SECRETS_JSON` (incl. `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) as a **repo-level** secret. *(Not an Environment secret — `deploy-app` reads it at the repo level; **no environment recreation needed** for it.)*
5. **Tier-2 (only when a feature needs it)** — create a narrow fine-grained PAT, `wrangler secret put` it on the **staging** Worker. Don't add it to CI. *(The ticket-editor already runs on the App, not a PAT.)*
6. **Verify** — a deploy runs, the ticket-editor commits as `nuxt-harness[bot]`, the board moves on a `status:*` label, and `/delegate` dispatches.

---

## Durable direction: one **Crouton GitHub App** (retires Tier 2)

> 📋 **Setup runbook:** [`crouton-github-app.md`](./crouton-github-app.md) — register / key / install /
> wire (step by step). The App is live: registered as **"Nuxt Harness"** (`nuxt-harness[bot]`, App ID
> `4107840`, FriendlyInternet org), powering the ticket-editor Worker with no PAT.

A shared PAT is a dead end the moment this goes **multi-tenant** (teams reviewing their own apps): one PAT can't represent N reviewers/teams and becomes a single high-value secret spanning every tenant.

The convergent answer for **all of Tier 2** is a single **Crouton GitHub App** (permissions: Contents: write + Pull requests: write), **installed per repo/org**, minting **short-lived per-installation tokens**. One App:
- replaces *both* the ticket-editor and review-bridge PATs,
- scales to teams (one App, N installations, **zero shared secret**),
- and fixes the unauthenticated-endpoint risk (the action is tied to a real install/identity).

**How it authenticates** (why there's no long-lived token to leak):
1. Sign a short JWT with the App's **private key** → "I am the Crouton App".
2. Exchange it for an **installation token**, scoped to one repo, valid ~1 hour.
3. Use that token for the commit/comment — it then expires on its own.

The **one** durable secret is the **private key** (no expiry; it never touches the API directly — it only signs JWTs to mint tokens). `@octokit/auth-app` does all three steps and caches/refreshes for you.

> **"Is ~1 hour too short — can I prolong it?"** No need, and no: GitHub fixes installation tokens
> at ~1 hour and you **can't** extend them — but you never *store* one. You **mint a fresh token
> just-in-time** right before each action (a commit/comment takes *seconds*), so 1 hour is enormous
> headroom. The short life is the **point**: if one leaks it's one repo for under an hour, vs a PAT
> valid for months. `@octokit/auth-app` auto-refreshes, so even a long-running job never hits the wall.

**Decision: build the App now (dogfooding).** Crouton's whole direction is teams installing on their own repos — so building the App now means crouton runs on its *own* target architecture, with you as tenant #1. While **single-tenant** (one installation) the private key can live in the Worker (≈as simple as a PAT, but the *right* code path); the **central mint** (one holder of the key, handing out scoped 1-hour tokens) becomes a real task only when the *second* team installs. A raw PAT stays a legitimate **stopgap** only if a feature must ship before the App is wired.

### Why the App — beyond replacing credentials

Swapping two PATs is the least of it. The App is a GitHub-native **identity + webhook receiver + per-tenant permission grant**, which unlocks:

**Fixes things we currently do wrong**
- **Posts as `nuxt-harness[bot]`, not @pmcp** — the *real* fix for the provenance problem we band-aided with the `require-comment-provenance` hook. Bot comments become unmistakable at the source.
- **Retires the scattered per-feature PATs** and the **unauthenticated `/api/_feedback`** (actions tie to a real installation, not an open URL + shared low-trust token).
- **Exact permissions** — no more "the bot token lacks `workflows`/`actions`" walls; grant only what's chosen.

**New capabilities**
- **GitHub Checks instead of bot comments** — the artifact-gate, schema-review, UI sign-off, and deploy status become proper **Check Runs** (PR checks bar, inline annotations, re-run button) instead of comment spam. A direct DX win for the #479 "readable tickets" goal.
- **Webhook-driven automation** — the App receives events at its own endpoint, so `/delegate`, `/deploy`, preview-on-PR, resume-on-reply can be App-driven and **portable to any repo that installs it** — no committed `.github/workflows/` to copy (sidesteps the epic-branch-CI gap).
- **Multi-tenant = the product** — a team installs "Crouton" → they get previews, the diagram editor, deploys, the pipeline, with **zero per-team provisioning**. This is how crouton becomes installable software, not private plumbing; everything else is downstream of it.
- **Act-as-the-reviewer (user OAuth)**, **separate higher rate limits**, **per-repo audit + revoke**.

**Doesn't fix / costs**
- ~~The pipeline's human-actor need stays~~ → ✅ **resolved (WS5/#535):** claude-code-action's `allowed_bots` allow-list now accepts `nuxt-harness[bot]`, so the App token can trigger the pipeline — the human PAT is gone.
- Needs a small always-on **Worker endpoint** (webhooks / token mint / checks) — but that's the same Worker the Tier-2 features already run in.

**Punchline:** the App is the **productization substrate** for the teams version of crouton — which is why building it now (and dogfooding it on this repo) is the right call.

*(Update #546/WS5: the App **did** become Tier 1's dispatch identity — claude-code-action's `allowed_bots` allow-list accepts `nuxt-harness[bot]`, so the `delegate`-trigger PAT and the board PAT are both retired. Tier 1 is now PAT-free.)*

---

## Quick reference

```
Tier 1 (org secrets, FriendlyInternet, Selected → nuxt-crouton — 5 required):
  ANTHROPIC_API_KEY            agent pipeline (API-billed)
  CLOUDFLARE_API_TOKEN         1 token: Account Workers/D1/KV/R2 + Zone Routes/DNS
  CLOUDFLARE_ACCOUNT_ID        identifier (not secret)
  HARNESS_APP_ID               Nuxt Harness App id (4107840) — not secret
  HARNESS_APP_PRIVATE_KEY      App PEM → mints dispatch + org-board tokens (PAT-free)
  WORKER_SECRETS_JSON          OPTIONAL, repo-level — bundled app runtime secrets
  GITHUB_TOKEN                 built-in, automatic — do nothing
  (retired: PROJECTS_TOKEN, DISPATCH_TOKEN — replaced by the App)

Tier 2 (Cloudflare Worker secrets — per feature, disposable, → GitHub App):
  ticket-editor   GITHUB_TOKEN                       Contents: R/W
  review-bridge   NUXT_CROUTON_REVIEW_GITHUB_TOKEN   Pull requests: write (staging only)

App runtime:  BETTER_AUTH_SECRET (secret) · BETTER_AUTH_URL (= deploy URL)
Local dev:    BETTER_AUTH_SECRET only (hook exports a dev value)
```
