# Crouton GitHub App — registration & wiring runbook (epic #519)

> **Naming:** the App is registered as **"Nuxt Harness"** and posts as **`nuxt-harness[bot]`**
> (App ID `4107840`, owned by the **FriendlyInternet** org). "Crouton GitHub App" is the project's
> name for this same App in epic #519.

> **Status:** already set up and verified for `FriendlyInternet/nuxt-crouton` (the ticket-editor Worker commits
> as `nuxt-harness[bot]` with no PAT). This runbook is the canonical reference — for re-provisioning,
> rotating the key, or onboarding a second tenant.

The one-time human setup (WS1) for the App: the Tier-2 / multi-tenant identity that replaces
per-feature PATs. Rationale lives in [`secrets-and-tokens.md`](./secrets-and-tokens.md); this is the
*do-it* checklist.

## Decisions (recorded)

- **Owner = a GitHub organisation, not a personal account.** An org-owned App survives any one person
  leaving, allows multiple admins, and is the correct home for a product others install. **Ownership
  IS transferable** (App settings → Advanced → Transfer ownership; user→org supported, not to a team)
  — App ID, private key, and installations all carry over. (We registered under @pmcp, then transferred
  to the **FriendlyInternet** org.)
- **Tenants do NOT need an org.** A GitHub App installs onto *any* account — personal or org. Owning
  the App in an org is purely our side (durability/branding); it imposes nothing on installers.
- **Visibility: public.** Because the org owns the App but it's installed on the personal
  `FriendlyInternet/nuxt-crouton` repo, the App must be **"Any account"** (public). *Install-scope rule:* a
  *private* App can only be installed on the account that **owns** it.

## A. The org

The product home is the **`FriendlyInternet`** org. To create one: GitHub → **+ (top-right) → New
organization** → **Free** plan. (Ownership is transferable, so you can also register under a personal
account first and transfer later.)

## B. Register the App

Navigate: `https://github.com/organizations/FriendlyInternet/settings/apps` → **New GitHub App**
(or **Settings → Developer settings → GitHub Apps** under a personal account, then transfer).

Fill the form (verbatim field labels; required marked):

| Field | Value |
|---|---|
| **GitHub App name** *(req · global-unique · ≤~34 chars)* | `Nuxt Harness`. Commits/comments show as **`nuxt-harness[bot]`**. |
| **Description** | optional — e.g. "Crouton runtime GitHub identity (diagram editor, review bridge, gates)." |
| **Homepage URL** *(req)* | `https://github.com/FriendlyInternet/nuxt-crouton` |
| **Identifying & authorizing users → Callback URL** | leave blank (no user-OAuth yet) |
| **Webhook → Active** | **UNCHECK** — no endpoint yet (turn on for WS5; one webhook per App, toggleable later) |
| Webhook URL / Webhook secret | leave blank (Active is off) |
| **Repository permissions** | **Contents → Read & write**, **Pull requests → Read & write**. *(Metadata auto-forces to Read-only — expected.)* |
| *(WS5)* | **Issues → Read & write** — needed so the App can apply the `delegate` label. |
| *(futureproof, optional)* | **Checks → Read & write** — WS4 needs it; setting now saves a re-approval later. |
| **Organization permissions → Projects** *(#646)* | **Read & write** — required for the org **Projects v2** board automation (`backfill-project.yml` / `project-status.yml`). This is an **organization** permission, *not* a repository one — it's a separate section in the form, and `GITHUB_TOKEN` can never grant it. See [§F](#f-projects-v2-board-org-level). |
| **Subscribe to events** | none (Active is off) |
| **Where can this GitHub App be installed?** | **Any account** (public) — required so the org-owned App can install on the personal `FriendlyInternet/nuxt-crouton` repo. |

→ **Create GitHub App.**

> Adding permissions later (e.g. Issues for WS5, Checks for WS4) requires each installer to re-approve
> — trivial while you're the only installer. Removing is immediate.

## C. Generate the private key

On the App's settings page → **Private keys → Generate a private key** (a PEM downloads; GitHub keeps
only the public half — store it safely, a lost key can't be re-downloaded, just generate a new one).

GitHub hands you **PKCS#1** (`-----BEGIN RSA PRIVATE KEY-----`). **No conversion needed** — the Worker
imports the key with WebCrypto and converts PKCS#1→PKCS#8 *in-code* (dependency-free), so paste the PEM
GitHub gave you as-is.

Also note the **App ID** (a number on the settings page — what the Worker uses; *not* the Client ID).

## D. Install it + get the installation ID

App settings → **Install App** → install on the account that has `nuxt-crouton` (the personal `pmcp`
account) → choose **Only select repositories → `nuxt-crouton`**.

Then open the installation's **Configure** page and copy the **installation ID** from the URL:
`.../settings/installations/<INSTALLATION_ID>`.

## E. Wire the Worker, deploy, verify

The ticket-editor Worker expects these three (App ID / installation ID aren't sensitive — put them in
`wrangler.jsonc`'s `vars`, and keep only the key as a secret):

```bash
cd workers/ticket-editor
npx wrangler secret put GITHUB_APP_PRIVATE_KEY        # paste the PEM GitHub gave you (PKCS#1 is fine)
# set GITHUB_APP_ID and GITHUB_APP_INSTALLATION_ID as wrangler vars (or secrets)
npx wrangler deploy
```

**Verify (the epic's "we'll know by"):** open the editor → edit a diagram → **Save** → the commit on
the branch is authored by **`nuxt-harness[bot]`**, no PAT anywhere.

## F. Projects v2 board (org-level) — the gotcha that cost us a day (#646)

The org **"Crouton"** Projects v2 board is driven by two workflows, both authenticating as
the App (`HARNESS_APP_ID` / `HARNESS_APP_PRIVATE_KEY` → `actions/create-github-app-token`):

- **`project-status.yml`** — event-driven: adds a card + sets Status when an issue/PR changes.
- **`backfill-project.yml`** — on-demand (`workflow_dispatch`): bulk-adds every open issue/PR.
  Re-run it any time the board drifts.

### Two things must both be true

1. **The App needs `Organization → Projects: Read & write`** on the **org installation**
   (not the repo). `GITHUB_TOKEN` *cannot* write a Projects v2 board — only the App can, and
   only with this org-level grant. Adding it means **re-approving the installation**: look for
   the pending "review request" banner on the org's installed-Apps page, *or* add the App to the
   board's **Manage access** with Write.
   - **Mint the token with `owner:` and no `repositories:`** so it carries the org-level grant:
     ```yaml
     - uses: actions/create-github-app-token@v1
       id: app-token
       with:
         app-id: ${{ secrets.HARNESS_APP_ID }}
         private-key: ${{ secrets.HARNESS_APP_PRIVATE_KEY }}
         owner: FriendlyInternet      # org-scoped token; carries Projects: R/W
     ```

2. **Resolve the board at the ORG level, never via the repo link.** A **private** org board is
   **not reliably returned by `repository.projectsV2`** to an App token *even when the repo IS
   linked to the board in the UI*. This is the trap: the link looks correct, the workflow finds
   `null`, and the board silently stays empty. Query `organization(login).projectsV2` and match by
   title instead — then the repo↔project link is irrelevant:
   ```graphql
   query($org:String!,$cursor:String){
     organization(login:$org){ projectsV2(first:100, after:$cursor){
       pageInfo{ hasNextPage endCursor } nodes { id title } } }
   }
   ```

### How we diagnosed it

A temporary `core.warning` listing every project the token could see printed **0 org projects** —
proving the token, not the code, was the problem. Once `Organization → Projects: R/W` was granted,
the same backfill added 77 items on the first green run. The diagnostic has since been removed; the
not-found failure message keeps a one-line hint pointing back at this permission.

### Operate it

- **Populate / repair the board:** Actions → **Backfill project board** → *Run workflow*. Output:
  `Backfill "Crouton": added N item(s); M already present; K open issues/PRs scanned.`
- **If it fails with `Project "Crouton" not found`:** the App lost (or never had) the org Projects
  grant, *or* the board title changed. Re-check the installation permission first; set the
  `PROJECT_NAME` repo variable if the board was renamed.

## Forward-compat (so this setup carries to the product)

- **GitHub Actions reuse (WS5):** to let the App also *trigger* the agent pipeline, store the App's
  private key + id as Actions secrets (`HARNESS_APP_PRIVATE_KEY` / `HARNESS_APP_ID`) and mint an
  installation token in-workflow (`actions/create-github-app-token`); Node accepts the PKCS#1 PEM.
- **Webhooks (WS5):** one webhook per App, can't be deleted but can be toggled. When the receiver Worker
  exists, set Webhook URL + a secret (GitHub HMAC-signs deliveries as `X-Hub-Signature-256`) and
  subscribe to events. This is also #515's "appoint the App to release" signal.
- **GitHub Checks (WS4):** the gates (artifact-gate / schema-review / UI sign-off / deploy) become
  Check Runs instead of bot comments.
- **review-bridge (other half of WS2):** the `/api/_feedback` endpoint (#491, in `packages/crouton-devtools`)
  swaps its PAT for an App installation token the same way — tracked separately (package HARD GATE).
- **Provenance:** once comments post as `nuxt-harness[bot]`, the `require-comment-provenance` hook
  band-aid (#497) can be retired for App-posted comments.

## Sources

GitHub Docs: [registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) ·
[choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) ·
[managing private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps) ·
[installing your own app](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app) ·
[public vs private](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private) ·
[modifying a registration](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration).
