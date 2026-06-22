# Self-Hosted Mac mini Runner + Cutting the Claude Bill — Runbook

**Date:** 2026-06-22
**Status:** Setup runbook for epic [#610](https://github.com/FriendlyInternet/nuxt-crouton/issues/610) (part of initiative #609)
**Purpose:** Stand up the Mac mini at home as (a) the place we do **interactive** Claude
Code work under a flat-fee **subscription** — the real lever on the Claude bill — and (b) an
always-on **self-hosted GitHub Actions runner** so the agent loop runs on our own hardware
instead of metered GitHub-hosted minutes.

> Generalises the Raspberry-Pi escape-hatch playbook
> (`writeups/setup/self-hosted-pi-agent-cloudflare-setup.md`). That doc dispatches to a
> bespoke pi.dev worker over a Cloudflare Tunnel; here we use GitHub's **native** self-hosted
> runner, which is simpler and needs no inbound ingress (the runner dials out to GitHub).

---

## 0. Two different costs — don't conflate them (read first)

The phrase "the Mac mini will make it cheaper" hides **two separate cost levers** that need
**two separate setups**:

| Cost | What cuts it | What does NOT cut it |
|------|--------------|----------------------|
| **Claude API token spend** (the expensive one) | Doing the **interactive** dev/agent work on the Mac mini under a **Max/Pro subscription** (flat fee). See §1, issue #652. | A self-hosted CI runner — the CI agent jobs keep calling the **metered `ANTHROPIC_API_KEY`** wherever they run. |
| **GitHub-hosted Actions minutes** | A **self-hosted runner** on the Mac mini (the agent loop runs on our box). See §2–§7. | A subscription — that's about model billing, not CI minutes. |

⚠️ **Hard rule (do not violate):** a Claude **subscription OAuth** token is licensed for
**interactive use only** — it must **never** back an unattended CI workflow (Anthropic Legal &
Compliance terms). So the CI agent workflows stay on the **API key**; only the human-in-the-loop
work on the Mac mini uses the subscription. The note is already in
`.github/workflows/decompose-on-issue.yml`. **This is why the cheap path (§1) and the
self-hosted-runner path (§2+) are deliberately kept apart.**

---

## 1. Cut the Claude bill: interactive Claude Code under a subscription (issue #652)

This is the **direct** answer to "the API is getting expensive."

1. On the Mac mini, install Claude Code and sign in **with the subscription**, not an API key:
   ```bash
   # Install Claude Code (see https://docs.claude.com/claude-code)
   claude login        # choose the Max/Pro account — NOT `claude login --api-key`
   ```
   Confirm `claude` reports the **subscription** account. Make sure **no** `ANTHROPIC_API_KEY`
   is exported in that shell/profile, or the CLI may prefer the metered key.
2. Do the day-to-day "build X / fix Y" work **interactively on the Mac mini** through that
   session. It draws on the flat-fee subscription quota instead of per-token API billing.
3. **Verify it's actually saving money:** after a session of real work, check the Anthropic
   **API** usage dashboard for that window — there should be **no API spend** attributable to
   the interactive work (it came out of the subscription).

> The always-on Mac mini is the natural home for this because you can SSH/Screen-Share in from
> anywhere and pick up a long-running session. This is independent of the runner below — you can
> do §1 today without registering a runner at all.

---

## 2. Register the Mac mini as a self-hosted runner (issue #653 — WS1)

GitHub → **Settings → Actions → Runners → New self-hosted runner → macOS**. Follow the shown
commands (download + `./config.sh` with the one-time token), with these choices:

- **Scope:** **repo-scoped** for now (org-scoped is a later option if other repos want it —
  open question on #610).
- **Label:** add the custom label **`mac-mini`**. The routing toggle (§4) targets that single
  label. (The runner also gets implicit `self-hosted`, `macOS`, arch labels.)

Install it as an always-on **launchd** service so it survives logout/reboot:

```bash
cd ~/actions-runner
./svc.sh install        # registers a launchd service for the current user
./svc.sh start
./svc.sh status
```

**Verify:** Settings → Actions → Runners shows the runner as **Idle** with label `mac-mini`.

---

## 3. Secrets + toolchain on the runner (issue #654 — WS2)

GitHub **repo secrets/vars are delivered to self-hosted runners** exactly as to hosted ones, so
secrets need no change. What the box needs locally:

- **Toolchain:** Node 22 (`nvm` or rely on `actions/setup-node` per-job), `corepack enable` +
  pnpm, and `wrangler` (for deploys). Verify `actions/setup-node`'s cache path works on macOS.
- **Confirm the Node actions run on macOS self-hosted:** `actions/create-github-app-token@v1`
  and `anthropics/claude-code-action@<pinned sha>` (both are Node actions → expected fine).
- **Confirm a Cloudflare `wrangler deploy` works from macOS** (deploy jobs run `ubuntu-latest`
  today — see the macOS-portability open question on #610).

Secrets the jobs expect to resolve: `ANTHROPIC_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `HARNESS_APP_ID`, `HARNESS_APP_PRIVATE_KEY`, `PROJECTS_TOKEN`.

---

## 4. The routing toggle — one variable to move the agent loop (issue #655 — WS3) ✅ implemented

The nine Claude-consuming workflows read their runner from a single repo variable:

```yaml
runs-on: ${{ vars.AGENT_RUNNER || 'ubuntu-latest' }}
```

| Repo variable `AGENT_RUNNER` | Where the agent loop runs |
|------------------------------|---------------------------|
| **unset** (default) | GitHub-hosted `ubuntu-latest` (unchanged behaviour) |
| `mac-mini` | the self-hosted Mac mini runner |

Flip it in **Settings → Secrets and variables → Actions → Variables**. Unsetting it is an
instant **kill-switch** back to GitHub-hosted if the Mac mini is down.

**Toggled workflows:** `claude`, `decompose-on-issue`, `resume-on-comment`, `schedule-waves`,
`fix-ci-on-failure`, `comment-dispatch`, `red-team`, `red-team-daily`, `sync-changelogs`.

**Deliberately NOT toggled** (stay on GitHub-hosted): `ci.yml`, `e2e.yml`, and the deploy
workflows. Fork-exposed CI must not run untrusted code on our box (§5); deploy opt-in is a
separate follow-up.

---

## 5. Security policy for a self-hosted runner on a public repo (issue #656 — WS4)

`nuxt-crouton` is **public**. A self-hosted runner that executes **untrusted fork-PR code** on
your own box (holding repo-write creds + running LLM-driven `bash`) is the classic footgun.
Policy:

- **Require approval before fork-PR workflows run.** Settings → Actions → General → *Fork pull
  request workflows from outside collaborators* → **"Require approval for all external
  collaborators"** (or all fork PRs). This gates the one fork-PR-triggered Claude workflow
  (`red-team.yml`) so it can't auto-run on the Mac mini. **This is a HARD prerequisite before
  `AGENT_RUNNER` is ever set to `mac-mini`.**
- **Keep fork-exposed CI on GitHub-hosted** — `ci.yml` / `e2e.yml` are never toggled.
- **Least privilege on the box:** run the runner as a **dedicated, low-privilege macOS user**
  with no standing prod credentials beyond the scoped repo secrets.
- Reference: GitHub's [self-hosted runner security](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#self-hosted-runner-security).

> **Considered & rejected:** allow fork PRs on the Mac mini behind a label gate → ❌ one mislabel
> = arbitrary code on our hardware; not worth it.

---

## 6. Keep it always-on (issue #657 — WS5)

The point of "always-on at home" is that it's there at 3am.

- **Don't sleep:** disable system/disk sleep for the runner context
  (`sudo pmset -a sleep 0 disksleep 0`, or run the runner under `caffeinate`).
- **Auto-restart:** the launchd service (`./svc.sh install`) restarts the runner on crash/boot.
- **Watchdog (optional):** a launchd-scheduled health check that confirms the runner process is
  alive and connected to GitHub; restart + alert (Slack/email) on failure. Mirror the pi
  runbook's auth-retry-with-backoff idea.
- **Network blips:** the GitHub runner auto-reconnects when the network returns — verify.

**Verify:** force-reboot → runner returns to **Idle** within a couple minutes with no manual
step; pull the network briefly → it reconnects; `kill` the runner process → launchd restarts it.

---

## 7. Proof run (issue #658 — WS6, the epic's acceptance demo)

With §2–§6 done and `AGENT_RUNNER=mac-mini` set:

1. Drop a small `delegate` issue (e.g. "build a tiny POC").
2. Watch `decompose-on-issue` → worker → `deploy-pocs` execute — confirm each run's **runner
   name is the Mac mini**.
3. The posted `*.pmcp.dev` preview loads and the seeded login works — result matches a
   GitHub-hosted run. Capture the run links + preview URL on #658; fold any macOS gotchas back
   into this runbook.

---

## See also

- Pi escape-hatch (Cloudflare Tunnel + bespoke worker variant):
  `writeups/setup/self-hosted-pi-agent-cloudflare-setup.md`
- Agent-compute decision context: `writeups/strategy/new-workflow-handoff.md`,
  `writeups/architecture/agent-orchestration-architecture.md`
- Epic + sub-issues: #610 → #652 (subscription), #653 (runner), #654 (secrets/toolchain),
  #655 (toggle), #656 (security), #657 (always-on), #658 (proof run)
