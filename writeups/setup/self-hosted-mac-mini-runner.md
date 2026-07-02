# Self-Hosted Mac mini GitHub Actions Runner — Runbook

**Date:** 2026-06-25
**Status:** Active setup runbook (epic #610 / #669 — WS1/WS2/WS4/WS5)
**Purpose:** Stand up the Mac mini at home as an **always-on GitHub Actions self-hosted
runner**, so the agent + deploy workflows run on our own hardware (no metered
GitHub-hosted minutes, full control) and survive reboots, sleep, and network blips.

> This is a different pattern from the Pi runbook
> (`writeups/setup/self-hosted-pi-agent-cloudflare-setup.md`). That one runs a **custom
> pi.dev HTTP worker** behind a Cloudflare Tunnel and dispatches to it directly. This one
> is a **stock GitHub Actions runner**: GitHub stays the orchestrator (issues = state,
> Actions = the runner host), and our existing workflows just `runs-on:` the Mac mini.
> No tunnel, no custom dispatcher, no open inbound ports — the runner makes an **outbound**
> long-poll to GitHub and pulls jobs.

## The shape of it

```
┌──────────────────┐   issue / comment / cron     ┌───────────────────────┐
│  GitHub          │  fires a workflow            │  GitHub Actions queue │
│  (issues =       │ ───────────────────────────▶ │  job tagged           │
│   state,         │                              │  runs-on: mac-mini    │
│   Actions =      │                              └──────────┬────────────┘
│   orchestrator)  │                                         │ outbound long-poll
└──────────────────┘                                         ▼  (no inbound ports)
                                              ┌───────────────────────────────┐
                                              │ Mac mini (at home)            │
                                              │  actions-runner/  (launchd)   │
                                              │   - label: mac-mini           │
                                              │   - Node 22 / pnpm / gh /     │
                                              │     wrangler toolchain        │
                                              │   - pnpm typecheck + full     │
                                              │     Nuxt builds  ✅           │
                                              │   no-sleep (pmset) + watchdog │
                                              └───────────────────────────────┘
```

## What the Mac mini can and cannot do (read first)

- **Can:** everything a GitHub-hosted `macos-latest` runner can, on our own always-on box —
  run agent jobs (`claude-code-action` / pi.dev), `gh` + `git`, `wrangler deploy`, **and
  crucially `pnpm typecheck` and full Nuxt builds.** Unlike the **Pi** (which *cannot* build
  — it's memory-constrained and offloads typecheck/build to CI; see the Pi runbook's "can/
  cannot" box), the Mac mini has the RAM to be the build box itself. This is the key
  difference: on the Pi you plan around no-builds; on the mini you don't.
- **Cannot / shouldn't:** safely run **untrusted fork PR code**. A self-hosted runner on a
  public repo executes whatever a `pull_request` from a fork contains, on *your* hardware,
  with your local creds in reach. Keep fork CI on GitHub-hosted; route only trusted
  (non-fork / known-actor) jobs to the mini. This is epic #610 WS4 — decide and document
  the policy; the workflows that target `mac-mini` should guard on actor/fork.

---

## Conventions — WHERE each step runs (read this first)

This is where mistakes happen. Every step below is tagged with **where** it runs, and
every terminal block starts by telling you the **folder** to be in. The tags:

| Tag | Means | How you do it |
|---|---|---|
| 🖥️ **MINI (terminal)** | A shell **on the Mac mini** | You're SSH'd into the mini from your own Mac (`ssh you@mac-mini.local`). Run it there. |
| 🌐 **GITHUB (browser)** | The **GitHub web UI** | In a browser on whatever machine — it's a website, not a terminal. |
| ⚙️ **GITHUB (repo settings)** | **Repo** settings page, not org/account | `github.com/FriendlyInternet/nuxt-crouton/settings/...` — needs admin on the repo. |

**Two separate folders on the mini — do not confuse them:**

- **`~/actions-runner`** — the GitHub runner install (the tarball you unpack in §1). This
  is NOT the repo. It has no app code; it's just the runner agent.
- **`~/nuxt-crouton`** — a clone of this repo (only needed in §4 for the watchdog scripts).

Each terminal block opens with a `cd` so you're never guessing the working directory. If a
block has no `cd`, the folder doesn't matter for that command (e.g. `brew install`).

---

## 0. Prerequisites

🖥️ **MINI (terminal)** — SSH in from your own Mac first, then run everything in this section
there:

```bash
# From YOUR Mac, open a shell on the mini (adjust host/user to your box):
ssh you@mac-mini.local
```

Then, on the mini:

```bash
# folder: anywhere (this just creates + enters the runner dir)
# A working dir for the runner — NOT inside the repo, keep them separate:
mkdir -p ~/actions-runner && cd ~/actions-runner

# Confirm macOS arch (Apple Silicon = arm64; you'll pick the matching runner tarball):
uname -m            # arm64 (M-series) or x86_64 (Intel)
```

---

## 1. Register the runner + launchd service (#653)

### 1a. Get the registration token + download

⚙️ **GITHUB (repo settings)** — in a browser, go to the **repo** (not your account, not the
org): `github.com/FriendlyInternet/nuxt-crouton` → **Settings** tab → left sidebar
**Actions → Runners** → **New self-hosted runner** → **macOS**. Direct link:
`https://github.com/FriendlyInternet/nuxt-crouton/settings/actions/runners`.

That page shows the exact download URL + a **short-lived registration token** — copy both
(the token expires in ~1h). The commands below mirror what that page generates.

🖥️ **MINI (terminal).** Paste these **without** the `# …` notes if your zsh has interactive
comments off (you'll see `command not found: #` otherwise — or run `setopt
interactive_comments` once). Note the `-o actions-runner.tar.gz` downloads to a **fixed
local name** regardless of which version URL you paste, so the `tar` line always matches:

```bash
cd ~/actions-runner
# Use the download URL GitHub's runners page shows you; the -o name stays fixed:
curl -L -o actions-runner.tar.gz \
  https://github.com/actions/runner/releases/download/v2.XXX.X/actions-runner-osx-arm64-2.XXX.X.tar.gz
tar xzf actions-runner.tar.gz
ls   # you should now see config.sh, svc.sh, run.sh
```

### 1b. Configure with the `mac-mini` label

This is the load-bearing step: the routing toggle (#610 WS3, var `AGENT_RUNNER`) and the
reports-only pi.dev workflow (`a11y-daily-pidev.yml`) both target the **single custom
label `mac-mini`**. Label it exactly that.

🖥️ **MINI (terminal)** — folder: `~/actions-runner` (where you just unpacked the tarball):

```bash
cd ~/actions-runner
./config.sh \
  --url https://github.com/FriendlyInternet/nuxt-crouton \
  --token <REGISTRATION_TOKEN_FROM_THE_UI> \
  --name mac-mini \
  --labels mac-mini \
  --work _work \
  --unattended \
  --replace
```

- `--labels mac-mini` — adds our custom label (GitHub auto-adds `self-hosted`, `macOS`,
  and the arch label `ARM64` on top; you don't list those).
- `--name mac-mini` — the runner's display name in the Runners list.
- `--replace` — if a stale `mac-mini` runner already exists, replace it cleanly.
- **Repo-scoped** here (simplest). Org-scoped is an open question in #610 (org lets other
  repos reuse the box later) — if you go org-scoped, register at the org's runner settings
  instead; nothing else in this runbook changes.

✅ **Checkpoint:** Settings → Actions → Runners shows a runner **`mac-mini`**, labels
`self-hosted, macOS, ARM64, mac-mini`, status **Idle**. *(This is #653 acceptance test 1.)*

### 1c. Install the launchd service (always-on across reboots)

Don't run `./run.sh` in a terminal — that dies on logout/reboot (explicitly the
**considered-and-rejected** `tmux`/login-shell path in #653). Use the runner's own launchd
installer:

🖥️ **MINI (terminal)** — folder: `~/actions-runner`:

```bash
cd ~/actions-runner
./svc.sh install      # registers a GUI-domain launchd agent: actions.runner.<owner>-<repo>.mac-mini
./svc.sh start
./svc.sh status       # → "started" with a live PID
```

✅ **Checkpoint:** `./svc.sh status` shows the service started; the UI runner is **Idle**.

> The `./svc.sh install` agent already has launchd restart-on-crash behavior. The extra
> **KeepAlive + watchdog** in §4 covers the failures launchd can't see (wedged listener,
> lost GitHub connection).

---

## 2. Toolchain + secrets (#654)

### 2a. Toolchain on the box

GitHub-hosted runners ship a toolchain; a self-hosted one starts bare. The Mac mini needs
the full build toolchain (it *is* the build box now). Install once.

🖥️ **MINI (terminal)** — folder: anywhere (these are global installs; cwd doesn't matter):

```bash
# Node 22 via nvm (matches the workflows' setup-node node-version: 22)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22 && nvm alias default 22

# pnpm via corepack (the repo's package manager)
corepack enable && corepack prepare pnpm@latest --activate

# GitHub CLI (agent jobs use `gh`)
brew install gh

# Wrangler (deploy jobs) — the repo pins it; a global is fine for ad-hoc use, but the
# deploy jobs run it via `pnpm`/`npx` from the repo, so this is mostly for manual checks.
brew install cloudflare-wrangler2 || npm i -g wrangler

# Sanity:
node -v   # v22.x
pnpm -v
gh --version
wrangler --version
```

> **`actions/setup-node` on self-hosted macOS:** the workflows use
> `actions/setup-node@v4` with `cache: pnpm`, which self-installs the requested Node
> per-job and manages its own cache under `_work/`. That works on self-hosted macOS —
> the nvm install above is for *interactive* shells and as a fallback; the per-job
> `setup-node` is what the jobs actually rely on. (#654 asks to confirm the macOS cache
> path works — it caches under the runner's `_work/_tool`, no extra config.)

> ⚠️ **GOTCHA — the runner's PATH is NOT your shell's PATH.** The runner runs under
> **launchd**, which does **not** source `~/.zshrc` and starts with a minimal PATH
> (`/usr/bin:/bin:/usr/sbin:/sbin`). So Homebrew (`/opt/homebrew/bin` → `gh`, `wrangler`)
> and the nvm node dir are **invisible to jobs**, even though your interactive shell finds
> them — any step that calls `gh`/`wrangler` directly fails with "command not found". Fix:
> the runner reads a **`.path`** file in its own dir and uses it as the job PATH. Capture
> your interactive PATH into it and restart the service:
> ```bash
> cd ~/actions-runner
> echo "$PATH" > .path          # bakes /opt/homebrew/bin + nvm node into the runner PATH
> ./svc.sh stop && ./svc.sh start && ./svc.sh status
> ```
> Node/pnpm are *also* covered per-job by `setup-node`/`pnpm/action-setup`; `.path` is what
> rescues the direct `gh`/`wrangler` calls. (Re-run the `echo "$PATH" > .path` if you later
> change the nvm default node version, since that dir is version-stamped.)

> ⚠️ **GOTCHA — a hard-killed `claude-code-action` job can poison that runner's action
> cache.** Found during the #658 proof run: after a `claude-code-action` session was killed
> by `timeout-minutes` mid-work, every subsequent claude-code-action job **on that same
> runner** crashed in ~30 s during action startup with bun's
> `Internal error: directory mismatch for directory ".../claude-code-action/.../tsconfig.json"`
> — before the agent even started (the loop-station trace shows `0 events`). Re-runs don't
> help (the scheduler keeps handing the job to the same idle runner). Fix is on-box: clear
> that runner's cached copy of the action and kick the service —
> ```bash
> # 🖥️ MINI — <N> is the affected runner's dir (plain ~/actions-runner for the first)
> rm -rf ~/actions-runner/_work/_actions/anthropics
> cd ~/actions-runner && ./svc.sh stop && ./svc.sh start
> ```
> The action re-downloads clean on the next job. (Hosted runners never hit this — they're
> ephemeral; a persistent self-hosted `_work` is what lets the corruption stick.)

### 2b. Secrets

⚙️ **GITHUB (repo settings)** — nothing to run on the mini here. **GitHub repo secrets are
delivered to self-hosted runners exactly like hosted ones** — injected into the job env at
runtime; nothing is stored on the box. So the secrets the agent/deploy jobs need require
**no on-box action** beyond confirming they exist at
`github.com/FriendlyInternet/nuxt-crouton/settings/secrets/actions`. The list (from #654):

| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | the in-job agent (`claude-code-action`) |
| `PI_PROVIDER_KEY` | the pi.dev variant (`a11y-daily-pidev.yml`) — model-provider key |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler deploy` (Workers/D1/KV provisioning) |
| `CLOUDFLARE_API_TOKEN` | `wrangler deploy` (account Workers/D1/KV/R2 + zone routes/DNS) |
| `HARNESS_APP_ID` / `HARNESS_APP_PRIVATE_KEY` | `actions/create-github-app-token` — the App-token push path so pushes re-trigger CI, **and** project-board / cross-repo automation (mints a short-lived installation token at runtime) |

> **Not `PROJECTS_TOKEN`.** #654's body listed it, but it's **retired** — the HARNESS App
> above replaced that human PAT (see the comments in `project-status.yml` /
> `comment-dispatch.yml`). No workflow reads `secrets.PROJECTS_TOKEN` anymore; don't
> re-add it.

The **only** on-box secret in this whole runbook is the watchdog's optional `GH_TOKEN` /
`ALERT_WEBHOOK` (§4) — and those live in a gitignored `~/.runner-watchdog.env`, never in a
committed file.

> **macOS portability (#654 / #610 WS4 audit):** `actions/create-github-app-token` and
> `anthropics/claude-code-action@<pinned sha>` are Node actions → run fine on macOS
> self-hosted. `wrangler deploy` is cross-platform Node and was **verified from macOS by
> the #654 proof run**, after which the reusable `deploy-app.yml` was flipped to the
> fork-guarded `AGENT_RUNNER` toggle — deploys now route to the mini too. One macOS gap
> surfaced: hosted runners ship `jq`, a bare mac doesn't — `deploy-app.yml` self-heals
> with an `Ensure jq` step (`brew install jq` when missing).

✅ **Checkpoint (#654 acceptance):**
1. Route a cheap agent workflow to the runner (set repo var `AGENT_RUNNER=mac-mini`, run
   it) → it completes with **no missing-secret / missing-toolchain error**.
2. A `cf:staging` deploy dispatched to the runner provisions/deploys and the **preview URL
   responds**.

---

## 3. Route jobs to the runner (#610 WS3 — context)

⚙️ **GITHUB (repo settings)** — nothing to run on the mini. The workflows that opt in
already read a toggle: `runs-on: ${{ vars.AGENT_RUNNER || 'ubuntu-latest' }}`. Add the
**repo variable** `AGENT_RUNNER` = `mac-mini` at
`github.com/FriendlyInternet/nuxt-crouton/settings/variables/actions` (**Variables** tab,
*not* Secrets) to send those jobs to the mini; delete the variable to fall back to
GitHub-hosted. One variable, reversible — no workflow edits needed.

> Wiring *more* workflows to the toggle must respect the security policy in **§5** —
> don't broaden `runs-on` to untrusted-triggered workflows without reading it first.

---

## 4. Keep it always-on: no-sleep + KeepAlive + watchdog (#657)

Three layers, set all three.

### 4a. No-sleep (`pmset`)

Full detail + the optional `caffeinate` launchd agent are in
[`scripts/mac-mini-runner/no-sleep.md`](../../scripts/mac-mini-runner/no-sleep.md). The
essentials:

🖥️ **MINI (terminal)** — folder: anywhere (needs `sudo`):

```bash
sudo pmset -c sleep 0 disksleep 0 powernap 0 autorestart 1
pmset -g custom        # confirm: sleep 0 / disksleep 0 / autorestart 1 on AC
```

### 4b. launchd KeepAlive (process-level restart)

`./svc.sh install` already installs a launchd agent that restarts the runner if its
**process** dies. Confirm it's `KeepAlive`-d.

🖥️ **MINI (terminal)** — folder: anywhere:

```bash
launchctl list | grep actions.runner          # shows the runner agent + its PID
```

If you want belt-and-suspenders, the runner's generated plist lives at
`~/Library/LaunchAgents/actions.runner.*.plist` — it ships with `KeepAlive` already; no
edit needed in the normal case.

### 4c. Watchdog (catches what KeepAlive can't)

KeepAlive restarts a *crashed* process. It does **not** catch a **wedged-but-alive
listener** or a **lost GitHub connection**. The watchdog does — it's the macOS twin of the
Pi runbook's "auth-retry-with-backoff self-heal" idea.

Two committed files do this:

- [`scripts/mac-mini-runner/runner-healthcheck.sh`](../../scripts/mac-mini-runner/runner-healthcheck.sh)
  — **fleet-aware** (#1045): for **every** installed runner service (one
  `actions.runner.*.plist` per runner) it checks (1) the service is loaded with a live
  PID, (2) that runner's own `Runner.Listener` process exists, (3) the box can reach
  `api.github.com`, (4) — if a `GH_TOKEN` is present — the repo's API reports **all
  expected** runners online (default expected = installed count; override with
  `EXPECTED_RUNNERS`). On failure it restarts only the failed runner(s) via `launchctl
  kickstart` (falling back to that runner's `svc.sh`), alerts via an optional
  `ALERT_WEBHOOK`, and exits non-zero.
- [`scripts/mac-mini-runner/com.nuxtcrouton.runner-watchdog.plist`](../../scripts/mac-mini-runner/com.nuxtcrouton.runner-watchdog.plist)
  — a launchd agent that runs the health-check every **5 minutes**.

The watchdog files live in **this repo**, so the mini needs a clone of it (separate from
`~/actions-runner`). 🖥️ **MINI (terminal)** — clone once, then `cd` into it:

```bash
# folder: anywhere — clones the repo to ~/nuxt-crouton (skip if already cloned)
git clone https://github.com/FriendlyInternet/nuxt-crouton.git ~/nuxt-crouton
cd ~/nuxt-crouton
git checkout chore/653-mac-mini-runner-runbook    # or `main` once PR #882 is merged
```

🖥️ **MINI (terminal)** — folder: `~/nuxt-crouton` (the repo clone — the `scripts/...` paths
below are relative to it):

```bash
cd ~/nuxt-crouton

# Optional: secrets for the API probe + alerts, in a gitignored env file the script sources.
# (Lives in your HOME, ~/.runner-watchdog.env — NOT in the repo.)
cat > ~/.runner-watchdog.env <<'EOF'
GH_TOKEN=ghp_xxx          # a PAT with repo scope (only for the API liveness probe)
ALERT_WEBHOOK=https://hooks.slack.com/services/...   # optional Slack/Discord webhook
EOF
chmod 600 ~/.runner-watchdog.env

# Copy the launchd plist into your LaunchAgents folder:
cp scripts/mac-mini-runner/com.nuxtcrouton.runner-watchdog.plist \
   ~/Library/LaunchAgents/com.nuxtcrouton.runner-watchdog.plist
```

🖥️ **MINI (editor)** — open `~/Library/LaunchAgents/com.nuxtcrouton.runner-watchdog.plist`
and replace every `YOURNAME` with your macOS short username (run `whoami` to get it) so the
paths are absolute and real. There are paths in `ProgramArguments`, `EnvironmentVariables`,
`WorkingDirectory`, and the two `Standard*Path` entries.

🖥️ **MINI (terminal)** — folder: anywhere — load + run it:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nuxtcrouton.runner-watchdog.plist
launchctl kickstart  gui/$(id -u)/com.nuxtcrouton.runner-watchdog     # run it once now
tail -f ~/Library/Logs/runner-watchdog.log                            # watch it work
```

✅ **Checkpoint (#657 acceptance):**
1. **Force-reboot** the mini → runner returns to **Idle** within a couple minutes, no
   manual step (launchd brings the service back; pmset kept it from sleeping).
2. **Pull the network** briefly → the runner reconnects automatically when it's back
   (GitHub's runner has built-in reconnect; the watchdog's step 3 also catches a wedge).
3. **`kill` the runner process** → KeepAlive (or, within 5 min, the watchdog) restarts it.
   `kill $(pgrep -f Runner.Listener)` then watch `./svc.sh status` / the watchdog log.

---

## 5. Security — a self-hosted runner on a PUBLIC repo (#656 — WS4)

`nuxt-crouton` is public. A self-hosted runner that executes **untrusted fork-PR code** is
the classic GitHub Actions footgun: the job runs arbitrary code from the PR head on *our*
hardware, on a box that holds repo-write-capable creds and an LLM agent with `bash`.
Reference: GitHub's [self-hosted runner hardening](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#self-hosted-runner-security).

### The policy

1. **Fork / untrusted PR CI stays on GitHub-hosted, always.** `ci.yml` and `e2e.yml` are
   hardcoded `ubuntu-latest` and do **not** read the `AGENT_RUNNER` toggle — keep it that way.
2. **Only trusted-event jobs may route to `mac-mini`.** A workflow may carry the
   `AGENT_RUNNER` toggle only if every path to it is one of:
   - a **maintainer-initiated** event (`workflow_dispatch`, `schedule`, `workflow_run` of
     trunk workflows), or
   - an **actor/label-gated** event (`issue_comment` / `issues` guarded on
     `author_association` or a collaborators-only label), or
   - a `pull_request` event whose `runs-on` expression **routes fork heads back to
     `ubuntu-latest`** (see below).
3. **Fork PRs never execute on the box — structurally, not by convention.** The
   `pull_request`-triggered toggled workflows use the fork-guarded expression, so even
   with `AGENT_RUNNER=mac-mini` set a fork PR runs GitHub-hosted:
   ```yaml
   runs-on: ${{ github.event.pull_request.head.repo.fork && 'ubuntu-latest' || vars.AGENT_RUNNER || 'ubuntu-latest' }}
   ```
   (For non-PR events `github.event.pull_request` is empty → falls through to the normal
   toggle. Same shape as #347's "a push event can never set environment=production".)
4. **Never use `pull_request_target` on a workflow that can reach `mac-mini`.** It hands
   fork PRs a secrets-bearing context; combined with a self-hosted runner it's the worst
   case. No workflow in the repo uses it today — keep it that way.
5. **Comment bodies are untrusted input** even on actor-gated workflows: handle them in
   `actions/github-script` (JS values), never interpolate `${{ github.event.comment.body }}`
   into a `run:` shell line.
6. **Considered & rejected:** allowing fork PRs on the mini behind a label gate →
   ❌ one mislabel = arbitrary code on our box; not worth it (#656).

### Audit of the toggled workflows (2026-07-02)

Every workflow carrying `vars.AGENT_RUNNER`, its trigger, and why it's safe to route:

| Workflow | Trigger | Trust gate |
|---|---|---|
| `a11y.yml`, `frontend-review.yml`, `red-team.yml` | `pull_request` (checks out + agents over PR code) | **fork-guarded `runs-on`** (policy §3) |
| `schedule-waves.yml` | `issues`/`pull_request` closed | runs repo code only; fork-guarded `runs-on` as belt-and-braces |
| `claude.yml` | `@claude` mention in issues/comments | `claude-code-action` validates the actor has **write** access before acting |
| `comment-dispatch.yml` | `issue_comment` | `author_association` OWNER/MEMBER/COLLABORATOR |
| `close-epic-on-comment.yml` | `issue_comment` | label-gated (`epic` + `status:ready-to-close` — labels need triage perms) + non-bot |
| `resume-on-comment.yml` | `issue_comment` | label-gated (`status:blocked`); executes repo code only — a drive-by `lgtm` can resume a pipeline (accepted risk, same as GitHub-hosted; comment bodies handled via github-script) |
| `decompose-on-issue.yml` / `-pidev.yml` | `issues` labeled `delegate`(-`pi`) / dispatch | applying labels needs triage perms |
| `deploy-app.yml` (reusable — the deploy job all `deploy-*` callers share) | `workflow_call` from push-to-main / `workflow_dispatch` callers, plus `deploy-pocs.yml` on `pull_request` of `pocs/**` | **fork-guarded `runs-on`** (policy §3) — the only fork-reachable path (a fork PR touching `pocs/**`) routes back to `ubuntu-latest`; fork PRs also receive no secrets |
| `fix-ci-on-failure.yml` | `workflow_run` of CI/E2E | head-branch allowlist (`claude/issue-*`) + `workflow_run` executes trunk code |
| `a11y-daily(-pidev).yml`, `red-team-daily.yml`, `gate-smoke.yml`, `eval-scoreboard.yml`, `loop-station-advisor.yml`, `sync-changelogs.yml`, `unlighthouse.yml` | `schedule` / `workflow_dispatch` | maintainer-initiated only |
| `mac-mini-smoke.yml` | `workflow_dispatch` | maintainer-initiated (hardcoded to the box by design) |

**When adding the toggle to a new workflow**, re-run this reasoning: which events can reach
the job, who can fire them, and does the job ever check out non-trunk code? If any path is
fork/drive-by reachable, add the fork guard or an actor gate first.

### Repo settings + box hardening (⚙️ GITHUB / 🖥️ MINI — human steps)

- [ ] ⚙️ **GITHUB (repo settings)** → Settings → Actions → General → *Fork pull request
  workflows*: set **"Require approval for all outside collaborators"** (or stricter,
  "Require approval for all external contributors"). This is defense-in-depth on top of the
  structural guard — a fork PR then needs a human click before *any* workflow runs.
- [ ] 🖥️ **MINI** — run the runner as a **dedicated, low-privilege macOS user** (not your
  admin account): no sudo, no keychain full of personal creds, no SSH keys beyond what the
  runner needs. The only standing secrets on the box are the watchdog's optional
  `~/.runner-watchdog.env` (§4c); job secrets are injected by GitHub at runtime (§2b).
- Network note: the runner only makes **outbound** connections (long-poll to GitHub) — no
  inbound ports to firewall. Egress is unrestricted by default; if you later want to cap
  what agent jobs can reach, that's an outbound-proxy/PF exercise, tracked separately.

---

## 6. Scaling to N runners — concurrent jobs on the one box (#1045)

**A GitHub runner executes exactly one job at a time.** There is no "jobs per runner"
setting — one registered runner = one launchd service = one slot. So when a long job
(an E2E smoke, a decompose pipeline, an in-job agent session) holds the slot, every other
`mac-mini` job queues behind it. The fix is boringly standard: **register more runners on
the same box.** Each gets a unique `--name` (`mac-mini-2`, `mac-mini-3`, …) but the **same
`--labels mac-mini`**, so GitHub fans `runs-on`-matched jobs across whichever slots are
idle — no workflow changes at all.

**Resource sizing:** each slot can be a full Nuxt build / Playwright run / in-job Claude
agent at once. **Default fleet = 3** on the mini; don't over-provision or the box thrashes
(drop to 2 if RAM says so — watch it under load).

### Adding a runner

⚙️ **GITHUB (repo settings)** — mint a **fresh registration token** per runner (they
expire in ~1h and are single-use): Settings → Actions → Runners → **New self-hosted
runner** — you only need the token from that page; the download is reused from the first
install.

🖥️ **MINI (terminal)** — folder: the repo clone (the script lives in it):

```bash
cd ~/nuxt-crouton
RUNNER_TOKEN=<token from the UI> ./scripts/mac-mini-runner/add-runner.sh 2   # then 3, …
```

[`add-runner.sh`](../../scripts/mac-mini-runner/add-runner.sh) automates the whole §1–§2
dance for runner N: unpacks the existing tarball into `~/actions-runner-<N>`, registers
as `mac-mini-<N>` with the `mac-mini` label (`--replace`-safe to re-run), copies the
first runner's **`.path`** file (the launchd-minimal-PATH gotcha, §2a), and installs +
starts its own launchd service (`actions.runner.<owner>-<repo>.mac-mini-<N>`).

The watchdog (§4c) needs **no reconfiguration** — it discovers every installed
`actions.runner.*.plist` on each run and requires the whole fleet online.

✅ **Checkpoint (#1045 acceptance):**
1. Repo Settings → Actions → Runners shows all fleet members **Idle**, each labelled
   `self-hosted, macOS, ARM64, mac-mini`.
2. Dispatch 3 `mac-mini` jobs at once (e.g. re-run three PR agent-gates) → **all 3 go
   `in_progress`**, none `queued`.
3. `kill` one runner's `Runner.Listener` → the watchdog flags that runner (not "≥1 online
   so fine") and restarts just it.
4. Regression: a single dispatched job still routes to the mini as before.

---

## Three acceptance tests, in one place

Pulled from #653 / #654 / #657 so you can run them top-to-bottom once the box is set up.
The reboot/kill steps are 🖥️ **MINI (terminal)**; "a job lands on it" / "routed workflow"
are observed in 🌐 **GITHUB (browser)** on the Actions tab.

1. **#653 — registered + always-on:** Runner shows **Idle** with label `mac-mini`; a
   trivial test job lands on it; after a **reboot** it returns to Idle automatically.
2. **#654 — secrets + toolchain:** A routed agent workflow completes with no
   missing-secret/toolchain error; a `cf:staging` deploy from the mini produces a
   responding preview URL.
3. **#657 — reliability:** Survives a force-reboot, a network drop, and a `kill` of the
   runner process — each time the loop recovers with no human nudge.

---

## See also

- The Pi pattern (custom worker + Cloudflare Tunnel, *cannot* build):
  `writeups/setup/self-hosted-pi-agent-cloudflare-setup.md`
- The reports-only pi.dev workflow that targets this runner: `.github/workflows/a11y-daily-pidev.yml`
- No-sleep detail + caffeinate agent: `scripts/mac-mini-runner/no-sleep.md`
- Epics: #610 (run the whole flow on the mini), #669 (pi.dev as the in-job agent)
