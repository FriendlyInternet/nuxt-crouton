# CLAUDE.md — @fyit/crouton-feedback

> Folder-specific notes only. For workflow / commit / issue conventions, defer to
> the root `CLAUDE.md` (#507) — don't restate them here.

## Package Purpose

A **drop-in in-page feedback toolkit for any Nuxt + Nuxt UI 4 app** — no
crouton-core dependency. One neutral **glasses** launcher (bottom-right) opens a
dropdown of toggleable tools:

- **Console** — [eruda](https://github.com/liriliri/eruda), a mobile in-page
  devtools console, lazy-loaded on first toggle.
- **Annotate** — pin a comment on any page element; on send it builds a
  structured annotation and POSTs it to a **pluggable feedback sink** (webhook /
  Slack / Discord / GitHub), chosen by config.
- **Changelog** — a `vNN`-badged row that opens a version timeline (#1048).
  JSON-first: entries come from a committed `changelog.json`; an optional
  build-time git stamp fills the current deployed commit. Hides itself when the
  app ships no entries, so it costs nothing until an app provides one.
- **Plan** — a phase-badged row that opens a **plan** in an overlay (#1155).
  DATA-first (like Changelog): a committed plan JSON (phases/increments) is
  joined at build with the spec ledger it points at, and the overlay renders it
  **natively with Nuxt UI** (UModal · UBadge · UCard · UAlert · UCollapsible) —
  no iframe. The row badge is the active phase (e.g. `B2`). Hides itself when no
  plan is configured. Lets a build/graduation plan track *in the running
  preview*, next to Changelog, instead of in a separate file.
- **Spec walk** — the "does it still work?" facet (#1038 WS1). A `marked/total`-
  badged row that opens a **non-blocking bottom sheet** (no backdrop — the app
  stays interactive so you perform each step) and walks the app's LIVE
  behaviours one at a time: how-to-test steps, a `data-handoff` outline that
  tracks the current behaviour's element through pan/zoom, ✅ works / ⚠️ issue
  per entry, and an Export that emits the `lgtm <id>` C1 sign-off. **No build
  data of its own** — it reuses the same composed plan the Plan tool ships
  (`runtimeConfig.public.croutonPlan`), pulling the behaviours under `done`/
  `active` phases + increments. Hides itself when no plan is configured, so it
  costs nothing until an app sets `croutonFeedback.plan`. Body-mounted from its
  plugin (NOT page/app.vue — the #1039 lesson).

This package was extracted from `@fyit/crouton-devtools` (epic
[#960](https://github.com/FriendlyInternet/nuxt-crouton/issues/960)) so the
toolkit is usable outside crouton; `@fyit/crouton-devtools` now consumes it and
adds its crouton-specific tabs on top.

## Status

✅ **Epic #960 complete (all 7 workstreams).** Both tools work; a sent annotation
is dispatched to the configured sink, selectable via module option or env. The
webhook + slack paths were verified end-to-end against a real URL; discord/github
are unit-proven (payload shaping, auth, error paths). `@fyit/crouton-devtools`
consumes this module via `installModule`, and docs + the e2e smoke landed.

| Issue | Brings in | State |
|-------|-----------|-------|
| [#962](https://github.com/FriendlyInternet/nuxt-crouton/issues/962) | Launcher + tool registry + mount + Console (eruda) | ✅ |
| [#963](https://github.com/FriendlyInternet/nuxt-crouton/issues/963) | `FeedbackSink` dispatcher + Annotate + source-stamp transform (webhook sink) | ✅ |
| [#964](https://github.com/FriendlyInternet/nuxt-crouton/issues/964) | The slack / discord / github sinks — test-first (#774) | ✅ |
| [#965](https://github.com/FriendlyInternet/nuxt-crouton/issues/965) | Module-option + env config surface for sink selection | ✅ |
| [#966](https://github.com/FriendlyInternet/nuxt-crouton/issues/966) | Refactor `@fyit/crouton-devtools` to consume this module | ✅ |
| [#967](https://github.com/FriendlyInternet/nuxt-crouton/issues/967) | Docs site + e2e fixture smoke + cross-app typecheck | ✅ |

**Gating:** the launcher + tools register only in local dev or when a build sets
`NUXT_PUBLIC_CROUTON_FEEDBACK=true` (→ `runtimeConfig.public.croutonFeedback`);
the client plugins re-check at runtime, so production ships nothing. The
source-stamp transform + `/api/_feedback` handler register under the same gate.

## Feedback flow (Annotate → sink)

```
Annotate tool → click element → useAnnotate.buildAnnotation()  (capture.ts, pure)
  → POST /api/_feedback         (server/api/feedback.post.ts — the dispatcher)
    → formatAnnotationMarkdown() + resolveSink(config.sink)
      → one of: webhook | slack | discord | github   (server/sinks/*)
```

A click resolves to its source file via the nearest `data-feedback-src` ancestor,
stamped at build time by the compiler transform (`transform/sourceStamp.ts`). The
sink is chosen by `croutonFeedback.sink` (env `NUXT_CROUTON_FEEDBACK_SINK`):

| Sink | Destination | Env |
|------|-------------|-----|
| `webhook` | generic JSON `POST {annotation, markdown}` | `NUXT_CROUTON_FEEDBACK_WEBHOOK_URL` |
| `slack` | Slack incoming webhook (Block Kit) | `NUXT_CROUTON_FEEDBACK_SLACK_URL` |
| `discord` | Discord webhook (embed) | `NUXT_CROUTON_FEEDBACK_DISCORD_URL` |
| `github` | issue/PR comment (App token, PAT fallback) | `NUXT_CROUTON_FEEDBACK_GITHUB_*` |

Credentials/URLs stay in **server** `runtimeConfig.croutonFeedback`, never the
client bundle. Configure via the `croutonFeedback.feedback` module option or env:

```ts
// nuxt.config.ts
croutonFeedback: {
  feedback: {
    sink: 'slack',
    slackUrl: '…',                 // or webhookUrl / discordUrl
    github: { appId, privateKey, installationId, repository, pr } // or { token }
  }
}
```

Every field is overridable at runtime by its `NUXT_CROUTON_FEEDBACK_*` env var
(the empty-string defaults in `module.ts` are what make env mapping work). Prefer
env for secrets (`…_GITHUB_APP_PRIVATE_KEY`, `…_GITHUB_TOKEN`).

## Changelog tool config (#1048)

JSON-first data source. Point the module at a committed changelog file (array of
`{ v, note, commit? }`, newest first) and, optionally, a commit-link template:

```ts
// nuxt.config.ts
croutonFeedback: {
  changelog: {
    path: 'app/changelog.json',                                   // or inline `entries: [...]`
    commitUrlTemplate: 'https://github.com/OWNER/REPO/commit/{commit}',
    stampGitCommit: true                                          // default; false to skip the git stamp
  }
}
```

When `path` is omitted the module auto-detects `<srcDir>/changelog.json`,
`app/changelog.json`, then `changelog.json`. At build it reads + normalizes the
file and (unless `stampGitCommit: false`) runs `git rev-parse --short HEAD`,
injecting `{ entries, commitUrlTemplate, buildCommit }` into
`runtimeConfig.public.croutonChangelog`. The build SHA fills the current entry's
commit until it's backfilled on the next push; when git is absent (some CI
builds) the stamp is simply empty. No entries ⇒ the tool hides itself.

## Plan tool config (#1155)

DATA-first data source (like the Changelog tool). Point the module at a plan
overlay JSON; its `specSource` (or an explicit `specPath`) locates the spec
ledger the module joins in:

```ts
// nuxt.config.ts
croutonFeedback: {
  plan: {
    dataPath: 'graduation-plan.json',   // the plan overlay (phases/increments)
    specPath: 'spec.json',              // optional — else the plan's own `specSource`
    title: 'Graduation Plan'            // optional override (else the JSON's title)
  }
}
```

At build the module reads the plan JSON + the spec ledger and calls
`composePlan(planRaw, specRaw)` (pure, unit-tested): each phase/increment's
`specs` (a list of ids) is resolved to full ledger entries tagged with their
**bucket** (`settled`→Preserve · `stopgap`→Replace · `new`→Add), and the
**badge** is the id of the deepest `status: "active"` phase/increment (e.g.
`B2`). The composed `ComposedPlan` is injected into
`runtimeConfig.public.croutonPlan`; the overlay maps over it with plain Nuxt UI
(UModal's `#body` owns the scroll — no custom height; status/bucket colours are
Nuxt UI `color` props). No phases ⇒ the tool hides itself.

**Gotcha — no arbitrary Tailwind in package components.** A package SFC's
arbitrary classes (`h-[78dvh]`, `bg-primary/5`) aren't in the consuming app's
Tailwind content scan, so they emit no CSS. Stick to standard utilities +
Nuxt UI components (UAlert for callouts, `color` props for tint) — verified by
the earlier iframe-height regression.

The plan overlay JSON for the crouton-builder graduation is
`pocs/crouton-builder/graduation-plan.json`; a standalone HTML render (for
sharing offline) is produced by `node scripts/graduation-plan.mjs
crouton-builder` → `graduation-plan.html` (same data, separate artifact — not
consumed by the tool).

## Spec walk tool (#1038 WS1)

**No config of its own — it piggybacks on the Plan tool's data.** Set
`croutonFeedback.plan` (above) and the Spec walk row appears automatically,
badged `marked/total`. It reads the SAME composed plan
(`runtimeConfig.public.croutonPlan`) and flattens the behaviour entries under
`done`/`active` phases + increments into an ordered walk (an id listed under
both a phase and its increment appears once, first wins). No plan ⇒ no walk ⇒
the row hides itself.

The walk is the C1 sign-off gate made in-app: each behaviour shows its
`howToTest` steps and, via its `hook`, outlines the live element it targets
(rAF-tracked so it survives the app's own pan/zoom). Mark ✅ works / ⚠️ issue per
entry (persisted to `localStorage`, keyed `specwalk:<plan-title-slug>` so two
apps don't collide); **Sign off** exports `lgtm <id>` lines for the ✅s (plus the
⚠️ issues + notes) to paste back to the agent — that recorded `lgtm` is what the
done-rule derives from (never a green build). The panel is a **non-blocking**
bottom sheet (no backdrop) so you can actually perform each gesture while it's
open, and it body-mounts from the plugin (NOT page/app.vue — the #1039 lesson).

## Key Files

| File | Purpose |
|------|---------|
| `src/module.ts` | Nuxt module entry — `configKey: croutonFeedback`; registers the launcher + Console plugins under the gate. |
| `src/runtime/composables/useFeedbackTools.ts` | Tool **registry** — `registerTool()` + reactive `tools`/`toggle` the launcher reads. Unit-tested. |
| `src/runtime/components/FeedbackLauncher.vue` | The glasses launcher — Nuxt UI `UPopover` of toggleable tool rows. |
| `src/runtime/overlay/mount.ts` | `mountOverlayInBody()` — appContext-mount helper (launcher + future overlays). |
| `src/runtime/tools/console.ts` | **Console** tool factory — eruda, lazy-loaded on toggle; injectable loader (unit-tested). Injects a floating **Close console ✕** on activate (top-left, clear of the bottom-right launcher) wired to the registry's `deactivate` via the `onRequestClose` callback — eruda hides its own entry button, so this is the panel's only reachable close (#1174). |
| `src/runtime/tools/annotate.ts` | **Annotate** tool factory — maps activate/deactivate → select-mode start/stop. |
| `src/runtime/tools/changelog.ts` | **Changelog** tool factory — `vNN` badge + open/close the timeline (unit-tested). |
| `src/runtime/tools/changelog-data.ts` | Pure changelog helpers (`normalizeChangelog` / `latestVersion` / `buildCommitUrl`) — shared by the module (build) + composable (runtime). Unit-tested, no Vue. |
| `src/runtime/composables/useChangelog.ts` | Reads `runtimeConfig.public.croutonChangelog` (entries + commit template + build SHA); shared open flag for the overlay. |
| `src/runtime/components/ChangelogOverlay.vue` | The version-timeline modal (newest first, current entry accented, configurable commit links). |
| `src/runtime/plugins/tools/changelog.client.ts` | Registers the Changelog tool + mounts its overlay. |
| `src/runtime/tools/plan.ts` | **Plan** tool factory — phase badge + open/close the plan overlay (unit-tested). |
| `src/runtime/tools/plan-data.ts` | Pure plan helpers (`composePlan` = join plan JSON + spec ledger → render-ready `ComposedPlan` · `planBadge` = deepest active phase id · `planTitle`) — shared by the module (build) + composable (runtime). Unit-tested, no Vue. |
| `src/runtime/composables/usePlan.ts` | Reads `runtimeConfig.public.croutonPlan` (the composed plan + badge); shared open flag for the overlay. |
| `src/runtime/components/PlanOverlay.vue` | The plan modal — renders the composed plan natively with Nuxt UI (UModal `#body` · UCollapsible · UAlert · UBadge). No iframe, no custom height. **Collapsible + fused with the Spec walk (#1180):** phases + increments are `UCollapsible`s, default-open only the ACTIVE one (a scannable outline on mobile, not a wall); a top "Check & sign off — marked/total" bar + each behaviour's **Walk & sign off** action call `useSpecWalk().jumpTo(id)` (closing the plan so the non-blocking walk lets you perform the gesture); each behaviour row reflects its live walk verdict (✅/⚠️/✓). |
| `src/runtime/components/PlanSpecRow.vue` | One spec-ledger entry as a `UCollapsible` (bucket + behaviour → expect/hook/how-to-test). Shows the live walk **verdict** (✅ works / ⚠️ issue / ✓ signed) and, for a walkable behaviour, a **Walk & sign off** button that `emit`s `walk` (the overlay opens the Spec walk on it). |
| `src/runtime/plugins/tools/plan.client.ts` | Registers the Plan tool + mounts its overlay. |
| `src/runtime/tools/specwalk.ts` | **Spec walk** tool factory — `marked/total` badge + open/close the walk panel (unit-tested). |
| `src/runtime/tools/specwalk-data.ts` | Pure spec-walk helpers (`walkEntries` = flatten a `ComposedPlan`'s LIVE behaviours · `stepsOf` · `selectorFor` · `exportText` = the `lgtm <id>` sign-off) — no Vue, unit-tested. |
| `src/runtime/composables/useSpecWalk.ts` | Reads `runtimeConfig.public.croutonPlan`, holds the walk + per-behaviour verdicts (localStorage, per-app scoped); shared open flag for the panel. |
| `src/runtime/components/SpecWalkOverlay.vue` | The non-blocking bottom-sheet walk panel — steps, `data-handoff` outline tracker (rAF), verdicts, `lgtm <id>` Export. Standard-utility styling (no arbitrary Tailwind — see the gotcha above). |
| `src/runtime/plugins/tools/specwalk.client.ts` | Registers the Spec-walk tool + body-mounts its panel (`mountOverlayInBody`, the #1039 lesson). |
| `src/runtime/composables/useAnnotate.ts` | Annotate state + DOM select/highlight + POST to `/api/_feedback`. |
| `src/runtime/components/AnnotateOverlay.vue` | Annotate overlay — highlight + Nuxt UI comment panel. |
| `src/runtime/overlay/capture.ts` | Pure capture helpers + `formatAnnotationMarkdown` (selector / source-file / Markdown). Unit-tested. |
| `src/runtime/transform/sourceStamp.ts` | Build-time `data-feedback-src` stamper (compiler transform). Unit-tested. |
| `src/runtime/server/api/feedback.post.ts` | `POST /api/_feedback` → validates + dispatches to the configured sink. |
| `src/runtime/server/sinks/` | `types.ts` (`FeedbackSink`), `webhook.ts` · `slack.ts` · `discord.ts` · `github.ts` (the four sinks), `index.ts` (`resolveSink`). |
| `src/runtime/server/utils/githubApp.ts` | Dependency-free WebCrypto App-token mint used by the `github` sink. Unit-tested. |
| `src/runtime/plugins/feedback.client.ts` | Mounts the launcher into the host app's `<body>` context. |
| `src/runtime/plugins/tools/console.client.ts` · `annotate.client.ts` | Register the two tools (Annotate also mounts its overlay). |
| `module.mjs` | Build-less dev entry (re-exports `src/module.ts`). |
| `build.config.ts` | unbuild config — module entry + per-dir mkdist runtime entries. |
| `playground/` | Plain Nuxt UI app (no crouton-core) that installs the module + wires Nuxt UI CSS. |

## Boundaries (what stays OUT of this package)

- **No `@fyit/crouton-core` dependency.** Peer deps are only `nuxt` + `@nuxt/ui`.
- **No DevTools-tab / collections / operations / events code** — that is
  crouton-specific and stays in `@fyit/crouton-devtools`.
- Identifiers are neutral (no `Crouton*` prefixes in moved code) so the module
  reads as a standalone library.

## Development

```bash
pnpm --filter @fyit/crouton-feedback build      # unbuild → dist/
cd packages/crouton-feedback/playground && pnpm dev   # boot the demo app
```
