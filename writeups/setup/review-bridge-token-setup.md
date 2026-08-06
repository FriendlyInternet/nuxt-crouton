# Review-Bridge GitHub Credential — runs on the Crouton GitHub App

> **Status: implemented (#519 workstream #2).** The review-bridge does **not** use a standalone
> PAT. Per **epic [#519](https://github.com/pmcp/nuxt-crouton/issues/519)** (Crouton GitHub
> App) the bridge mints a **short-lived installation token** from the shared App and posts as
> **`crouton[bot]`**. Credential provisioning is owned by the canonical
> **`writeups/setup/secrets-and-tokens.md`** (PR #520) — this file is only the
> review-bridge-specific slice. The earlier "provision a PAT" guidance is **rejected/interim**,
> preserved below as *Considered & rejected*.

## What the review-bridge needs (implemented)

- **Auth:** at runtime the Worker mints a ~1-hour **installation token** from the **shared App**
  (App ID + private key + installation id) — *not* a per-feature PAT — and posts as
  `crouton[bot]`. The mint (sign an App JWT → exchange for an installation token) is done with
  **WebCrypto, dependency-free**, in
  `packages/crouton-devtools/src/runtime/server/utils/githubApp.ts` — mirroring
  `workers/ticket-editor` (the sibling App consumer) so the package adds **nothing** to the
  monorepo lockfile (no `@octokit/auth-app`) and runs unchanged on Workers + Node 18+. The
  signing path is unit-tested (`test/githubApp.test.ts`). Single-tenant now: the private key may
  live in the Worker; the central mint is the teams-era step (#519).
- **App permission used:** *Pull requests: write* (PR conversation comment). The App also holds
  *Contents: write* for the ticket-editor (#503) — not used here.
- **Consumer:** `@fyit/crouton-devtools` → `POST /api/_feedback`
  (`packages/crouton-devtools/src/runtime/server/api/review.post.ts`).
- **Action:** `POST /repos/{owner}/{repo}/issues/{pr}/comments` (a `🎯 Preview feedback` comment).
- **Gate:** staging only — behind `NUXT_PUBLIC_CROUTON_REVIEW=true`; absent from production builds.

## Config — set on the staging Worker

The **App credentials** (mint the installation token). Only the private key is a secret; the two
ids are identifiers. All three live behind the `NUXT_CROUTON_REVIEW_` prefix so Nuxt maps them
onto `runtimeConfig.croutonReview`:

| Var | Secret? | Purpose |
|---|---|---|
| `NUXT_CROUTON_REVIEW_GITHUB_APP_ID` | no | the Crouton App id |
| `NUXT_CROUTON_REVIEW_GITHUB_APP_PRIVATE_KEY` | **yes** | the App PEM — the one durable secret (`wrangler secret put`) |
| `NUXT_CROUTON_REVIEW_GITHUB_APP_INSTALLATION_ID` | no | the installation to mint a token for |

Routing — not credentials — stay regardless of the auth mechanism:

| Var | Secret? | Purpose |
|---|---|---|
| `NUXT_CROUTON_REVIEW_REPOSITORY` | no | `owner/repo` to comment on |
| `NUXT_CROUTON_REVIEW_PR` | no | PR number (or per-request `body.prNumber`) |

The App private key may be the same one the ticket-editor uses (same App); see the canonical
secrets doc for central provisioning.

### CI wires this automatically (#607) — no manual `wrangler secret put`

For apps/POCs deployed through the reusable **`deploy-app.yml`**, the bridge config is set
**automatically on every staging, PR-tied deploy** — you do **not** run `wrangler secret put` by
hand. `deploy-pocs.yml` passes the triggering PR number as the `review-pr` input; `deploy-app.yml`
then resolves the Harness App installation id (`actions/create-github-app-token`) and pushes the
full `croutonReview` config to the staging Worker via `wrangler secret bulk --env staging`:

| Var | Source in CI |
|---|---|
| `NUXT_CROUTON_REVIEW_REPOSITORY` | `github.repository` |
| `NUXT_CROUTON_REVIEW_PR` | the triggering PR number (`review-pr` input) |
| `NUXT_CROUTON_REVIEW_GITHUB_APP_ID` | `secrets.HARNESS_APP_ID` |
| `NUXT_CROUTON_REVIEW_GITHUB_APP_INSTALLATION_ID` | resolved from the App + owner at deploy time |
| `NUXT_CROUTON_REVIEW_GITHUB_APP_PRIVATE_KEY` | `secrets.HARNESS_APP_PRIVATE_KEY` |

It's gated to **staging + PR-tied** deploys (a `workflow_dispatch` deploy has no PR → the bridge
stays unconfigured, which is correct). The bridge then posts as **`nuxt-harness[bot]`** (the shared
App). To wire it manually for a one-off / non-CI Worker, set the same vars yourself:

```bash
wrangler secret put NUXT_CROUTON_REVIEW_GITHUB_APP_PRIVATE_KEY --env staging
# the two ids + routing are not secrets — plain vars (or WORKER_SECRETS_JSON)
```

## Multi-tenant / teams

The App is exactly what makes this installable per team: each org **installs** the App; the App
mints **per-installation** tokens; zero shared secret. A single shared PAT would dead-end at the
first team — which is why #519 builds the App now (dogfooded on this repo as tenant #1).

## Considered & rejected — standalone PAT (`NUXT_CROUTON_REVIEW_GITHUB_TOKEN`)

The original #491 implementation used a fine-grained PAT as a Worker secret. **Rejected** in
favour of the App (#519) because it is: (a) a long-lived secret on a public-ish preview behind an
**unauthenticated** endpoint; (b) an *impersonation* of a person rather than a named bot
(`crouton[bot]`); (c) **non-scaling to teams** (can't be scoped per-tenant). App auth is now the
implemented path; the bridge still reads `NUXT_CROUTON_REVIEW_GITHUB_TOKEN` **only as a fallback
when no App credentials are set** (App creds take precedence) — a dev/throwaway stopgap, never
production. Drop it once the App env is wired everywhere.

## References

- Epic **[#519](https://github.com/pmcp/nuxt-crouton/issues/519)** — Crouton GitHub App; review-bridge = workstream #2.
- Canonical secrets doc — `writeups/setup/secrets-and-tokens.md` (PR #520).
- **[#491](https://github.com/pmcp/nuxt-crouton/issues/491)** / PR **[#499](https://github.com/pmcp/nuxt-crouton/pull/499)** — the review-bridge feature.
- **[#503](https://github.com/pmcp/nuxt-crouton/issues/503)** — ticket-editor (sibling App consumer) · **#521** — Tier-1 secrets consolidation.
