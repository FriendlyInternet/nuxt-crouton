# ticket-editor — secrets to provision

> **Updated for the Crouton GitHub App (#519).** This Worker no longer uses a stored GitHub PAT.
> It authenticates as the **Crouton GitHub App**, minting a short-lived (~1h) installation token
> just-in-time and committing as `nuxt-harness[bot]`. See `writeups/setup/secrets-and-tokens.md` (Tier 2
> + the GitHub App section).

This Worker (`workers/ticket-editor`) serves a mobile Excalidraw editor and, on Save, commits the
edited diagram back to `FriendlyInternet/nuxt-crouton`. It touches **two systems for two reasons**:

- **Cloudflare = deploy-time** — push the Worker's code.
- **GitHub = run-time** — the deployed Worker commits edits back on its own (no login on the
  user's phone), authenticating as the **Crouton GitHub App**.

## What to provision

| Name | System | Purpose | Minimal scope | Stored as | New? |
|---|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare | `wrangler` deploys the Worker | Account → **Workers Scripts: Edit** (no D1/KV/R2; no Zone perms for a `*.workers.dev` URL) | GitHub Actions repo secret / local env | **Existing** — the consolidated `crouton-deploy` token covers it |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | Which account to deploy into | identifier (not sensitive) | GitHub Actions repo secret / env | **Existing** |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App | Signs a JWT to mint installation tokens at runtime | the **Crouton App** private key (PEM) | **Cloudflare Worker secret** (`wrangler secret put`) | **From #519** — the App's one durable secret, shared by all Tier-2 Workers |
| `GITHUB_APP_ID` | GitHub App | Identifies the App when signing | not sensitive | Worker **var** (or secret) | from #519 |
| `OWNER_TOKEN_SECRET` | derived | HMAC key for the owner-only save token (#3261) | `sha256("$REVIEW_SEED_SECRET:ticket-editor:owner-token")` hex | Worker secret, **set by CI** (`deploy-ticket-editor.yml`); the status app derives the same key from its `reviewSeedSecret` | **Nothing to set by hand** |
| `GITHUB_APP_INSTALLATION_ID` | GitHub App | The install on `FriendlyInternet/nuxt-crouton` to scope the token to | not sensitive | Worker **var** (or secret) | from #519 |

**No PAT.** The old `GITHUB_TOKEN` (fine-grained PAT, Contents: R/W) is **retired** for this Worker —
replaced by the App. (If the App isn't registered yet, a PAT is only a legitimate *stopgap*; the
App is the chosen path.)

## How the App auth works (why there's no long-lived token to leak)

1. Sign a short JWT with the App **private key** → "I am the Crouton App".
2. Exchange it for an **installation token**, scoped to one repo, valid ~1h.
3. Commit with that token — it then expires on its own.

We do all three directly with **WebCrypto** (no dependency — keeps the worker out of the monorepo
lockfile; the RS256 + PKCS#1→PKCS#8 signing path is unit-tested in plain Node). We mint
**just-in-time** per Save, so the ~1h life is enormous headroom and nothing long-lived is stored.
The private key never hits the API — it only signs the App JWT.

## App registration (one-time, #519 WS1)

Register one **Crouton GitHub App** — permissions **Contents: write** (this Worker) **+ Pull
requests: write** (the review-bridge half) — install it on `FriendlyInternet/nuxt-crouton`, then:

```bash
cd workers/ticket-editor
npx wrangler secret put GITHUB_APP_PRIVATE_KEY    # paste the PEM
# set GITHUB_APP_ID and GITHUB_APP_INSTALLATION_ID as wrangler vars (or secrets)
```

## TL;DR for the consolidation
- **Reuse:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **From the App (#519), not a new per-feature PAT:** `GITHUB_APP_PRIVATE_KEY` (Worker secret) +
  `GITHUB_APP_ID` + `GITHUB_APP_INSTALLATION_ID` (vars). One App private key serves **all** Tier-2
  Workers (ticket-editor, review-bridge), so this isn't a per-Worker token.
