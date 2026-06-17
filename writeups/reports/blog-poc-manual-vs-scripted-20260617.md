# Blog POC — Manual vs Scripted Ledger

**Date:** 2026-06-17 · companion to `blog-poc-retrospective-20260617.md`

Goal of this doc: list **every step**, mark whether it was repeatable/scripted or done by hand, so the manual lanes can be turned into scripts. The fewer human-decision lanes, the better.

Legend: 🟢 scripted/tooled · 🟡 semi (tool exists, I drove it / made choices) · 🔴 **manual, ad-hoc, not reusable — prime automation target**

## Direct answer: the DB seeding

**I did it myself, by hand.** It was an inline `node -e` snippet using `@libsql/client`, inserting 3 rows straight into `.data/db/sqlite.db`, with post titles and bodies I wrote on the spot. It is **not committed and not reusable**. Same for the screenshot capture (`/tmp/blog-shots.js`, written in the moment) and for locating the headless browser (manual filesystem search). Those three are exactly the throwaway-manual lanes worth scripting.

## The ledger

| Step | How it was actually done | Class | Script it? |
|---|---|---|---|
| Epic + sub-issue tree | `/task-decompose` → orchestrator/decomposer agents | 🟢 | already |
| New-app label | added `app:blog` to `labels.yml` by hand; picked issue labels manually (couldn't sync) | 🔴 | auto-create label / standard fallback |
| Scaffold the app (#258) | worker **hand-mirrored `apps/velo`** file by file | 🟡 | `crouton create-poc` generator |
| Posts collection (#259) | **crouton CLI** (schema JSON → schema + migration + CRUD + admin UI) | 🟢 | gold standard already |
| Migration generate/apply | crouton / db flow | 🟢 | already |
| Public reader pages + API (#260) | **I hand-wrote** 2 pages + 2 API routes | 🔴 | crouton "public read surface" generator |
| Team-scoped → public read design | my architecture decision | 🔴 judgement | document as a pattern; hard to fully script |
| Typecheck gate | `pnpm --filter blog typecheck` | 🟢 | already |
| Commits | `/commit` skill + some manual git in the worktree | 🟡 | mostly |
| PR open / merge | GitHub MCP calls, I chose timing | 🟡 | pipeline can auto-PR/merge on green |
| Recover orphaned #259 worker | **manual** commit/push/PR by hand | 🔴 | prevent: worker "commit before verify" |
| Close sub-issues | **manual** MCP close (auto-close didn't fire on stacked PRs) | 🔴 | close-on-epic-merge step |
| `.gitignore` noise cleanup | manual `git restore` | 🟡 | stop crouton appending per-worktree paths |
| Find headless browser | **manual** filesystem search | 🔴 | known path `/opt/pw-browsers`, bake into script |
| **Seed DB with posts** | **ad-hoc inline node + @libsql/client; content hand-written** | **🔴** | **committed idempotent `pnpm --filter <app> seed`** |
| Screenshot capture | **ad-hoc `/tmp/blog-shots.js`** Playwright script | 🔴 | committed `pnpm --filter <app> shots` / e2e visual spec |
| Boot to verify | `nohup pnpm dev` + polling | 🟡 | a `verify-app` script |

## Automation backlog (manual → scripted), priority order

1. **`seed` script per app** — idempotent fixture data (`pnpm --filter <app> seed`). *You asked for this specifically.*
2. **`shots` / visual script** — committed Playwright capture against the pre-installed `/opt/pw-browsers` chromium → `screenshots/`. Turns "show me it works" into one command.
3. **POC preview-deploy automation** — generate `wrangler.jsonc` + the deploy workflow (the "automate creating the Cloudflare file" ask).
4. **`create-poc` scaffold generator** — replace hand-mirroring `apps/velo`.
5. **public read-surface generator** — a crouton option so the reader isn't hand-written.
6. **Pipeline housekeeping** — auto-close sub-issues on epic-branch merge; worker "commit before verify"; label auto-create.

## What should stay human (the small set)

What to build, the architecture seams (e.g. team-scoped vs public), and the go/no-go on promoting a POC to production. Everything else above is mechanizable.
