# Live a11y while you develop — `@nuxt/a11y` (opt-in) + Unlighthouse sweep

Two **opt-in** accessibility layers on top of the always-on ones (the warn-first
eslint-a11y rules, #727; the axe e2e gate, #728; the `/a11y` skill + CI gate, #729/#730).
Epic #726, WS5.

| Layer | When it runs | What it gives you |
|-------|--------------|-------------------|
| **`@nuxt/a11y`** | live, in `pnpm dev` | an axe-core panel in Nuxt DevTools that flags violations on the page you're looking at, as you navigate |
| **Unlighthouse** | scheduled (CI) / on demand | a route-by-route Lighthouse + axe report of a **deployed staging** site |

Both are OSS / self-hostable, no SaaS.

---

## 1. `@nuxt/a11y` — live DevTools feedback (opt-in)

[`@nuxt/a11y`](https://github.com/nuxt/a11y) is the official Nuxt accessibility module: it
runs axe-core in the browser during `nuxt dev` and surfaces violations in a **Nuxt DevTools**
tab, so you see a problem the moment you render the page — the same axe engine the e2e gate
and `/a11y --deep` use, just live.

> ⚠️ **It's `1.0.0-alpha.1`.** That's why it is **opt-in per app** and **NOT** wired into the
> crouton generator or any shared config — we don't want an alpha module in every generated
> app's lockfile yet. Add it to the one app you're actively hardening; remove it when done.
> Revisit promoting it to a generator default once it ships a **stable (non-alpha)** release
> (see §3).

### Enable it in an app (≈2 minutes)

From the app dir (`apps/<name>`, `pocs/<name>`, or a fixture — **not** `packages/`):

```bash
pnpm add -D @nuxt/a11y@^1.0.0-alpha.1
```

Then add an **env-guarded** module entry to that app's `nuxt.config.ts` so it only loads when
you ask for it (zero impact on normal `pnpm dev`, builds, and CI):

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    // …existing modules…
    // Opt-in: only load the alpha a11y module when NUXT_A11Y is set.
    ...(process.env.NUXT_A11Y ? ['@nuxt/a11y'] : [])
  ]
})
```

Run dev with the flag and open DevTools:

```bash
NUXT_A11Y=1 pnpm --filter <app> dev
# → open the app, press Shift+Option+D (Nuxt DevTools), pick the "Accessibility" tab.
# Navigate the app; axe violations for the current page list live, with the offending element.
```

The module is **dev-only** — it never ships to a production build even if the guard is on.
Leaving the `process.env.NUXT_A11Y` guard in is harmless; drop the devDependency + the module
line when you're done hardening that app.

### Fixing what it finds

The DevTools panel reports the same axe rules the rest of the stack uses, so the fixes are the
same: run **`/a11y --fix`** on the diff for the safe, mechanical ones (`alt`, `aria-label`,
label-for, `role`+`tabindex`), and hand-fix the judgement calls (heading order, contrast,
interaction model). The shared admin-shell findings are tracked in
[#735](https://github.com/FriendlyInternet/nuxt-crouton/issues/735).

---

## 2. Unlighthouse — scheduled whole-site staging sweep

[Unlighthouse](https://unlighthouse.dev) (MIT, self-hosted) crawls a **deployed** site and
produces a route-by-route report (Lighthouse accessibility — axe-based — plus perf / SEO /
best-practices). It's the "whole running app, every route" view that complements the per-PR
diff gate and the daily subagent sweep.

### Scheduled (CI)

`.github/workflows/unlighthouse.yml` runs it **weekly** (and on `workflow_dispatch`) against a
staging URL and uploads the static report as a build artifact. It's **report-only** — it never
gates a merge (that's `a11y.yml`'s job).

**To enable it:** set the repo variable `UNLIGHTHOUSE_SITE` to a staging URL — Settings →
Secrets and variables → Actions → **Variables**:

```
UNLIGHTHOUSE_SITE = https://triage.pmcp.dev
```

Staging URLs follow the two-domain topology (`<app>.pmcp.dev`). Until the var is set the job
**warns and skips** (stays green), so it lands safely before a target is chosen. To review a
run: Actions → the Unlighthouse run → **Artifacts** → download `unlighthouse-report` → open
`index.html`.

> **Auth note:** Unlighthouse crawls what's reachable without logging in, so for a crouton app
> it covers the **public** surfaces (login, marketing/home, error pages). Auditing the
> authenticated `/admin/**` routes needs cookie injection (Unlighthouse `cookies`/`extraHeaders`
> config) — a follow-up if we want the admin shell swept this way too; for now the axe e2e gate
> (#728) covers the authenticated surfaces.

### Locally

```bash
npx unlighthouse --site https://triage.pmcp.dev   # interactive UI on localhost
npx unlighthouse-ci --site https://triage.pmcp.dev --build-static   # static report → .unlighthouse/
```

---

## 3. Revisit: promote `@nuxt/a11y` to a generator default?

When `@nuxt/a11y` ships a **stable (≥ `1.0.0`, non-alpha)** release, reconsider baking the
env-guarded module entry into the crouton CLI generator (`packages/crouton-cli` app template)
so every new app gets the live DevTools panel for free. Until then it stays opt-in per the
guidance above. Track via the epic #726 close-out / a new `workflow` issue when the stable
release lands.
