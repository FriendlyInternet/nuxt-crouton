# Self-Hosted Mac mini GitHub Actions Runner — Runbook

**Status:** On-box runbook for epic #610 (always-on home runner) — WS1 #653, WS2 #654, WS5 #657.
**Purpose:** Register the Mac mini as an always-on `self-hosted` GitHub Actions runner labelled
`mac-mini`, provision its toolchain + secrets, and keep it reliable across sleep/reboot/network
blips — so agent + deploy jobs can run on our own hardware instead of metered GitHub-hosted minutes.

> This is the **on-box** companion to the repo-side artifacts in `scripts/mac-mini-runner/`
> (watchdog + no-sleep launchd jobs). The cloud sandbox can't touch the physical box, so every
> step here is a human step — work it on the Mac mini itself and tick the boxes.

> **Not the Pi dispatcher.** `self-hosted-pi-agent-cloudflare-setup.md` documents a *different*
> pattern (a pi.dev worker behind a Cloudflare Tunnel, dispatched over HTTP). This runbook is the
> standard **GitHub Actions self-hosted runner** — GitHub's own agent connects out to GitHub, polls
> for jobs, and runs them. No inbound ports, no tunnel, no custom worker.

## Key difference from the Pi: the Mac mini can build

The Pi runbook warns that a Raspberry Pi **cannot** run `pnpm typecheck` or full Nuxt builds — they
exceed its memory, so it offloads them to CI. **The Mac mini has no such limit:** it runs the full
`pnpm -r --filter './apps/*' typecheck`, Nuxt builds, and `wrangler deploy` locally. Plan it as a
real build/deploy box, not just an orchestrator.

## The shape of it

```
┌──────────────┐   outbound HTTPS (long-poll)   ┌──────────────────────┐
│   GitHub      │ ◀───────────────────────────── │ Mac mini              │
│   Actions     │      "any jobs for me?"        │  actions-runner       │
│  (dispatch /  │ ─────────────────────────────▶ │   - Runner.Listener   │
│   schedule /  │        job assignment          │     (launchd, always- │
│   push)       │                                │      on, KeepAlive)   │
└──────────────┘                                 │   - Node22/pnpm/gh/   │
                                                 │     wrangler toolchain│
       routing: runs-on: ${{ vars.AGENT_RUNNER   │   - no-sleep + watchdog│
                || 'ubuntu-latest' }}            └──────────────────────┘
```

The runner makes only **outbound** connections, so there are no open inbound ports and no tunnel.
Routing is already wired: 13 workflows use `runs-on: ${{ vars.AGENT_RUNNER || 'ubuntu-latest' }}`,
so setting the repo variable `AGENT_RUNNER=mac-mini` (once this runner is online and carries that
label) flips traffic to the box; unsetting it reverts to GitHub-hosted. One variable, reversible.

---

## 0. Prerequisites (GitHub UI — any browser)

Repo **Settings → Secrets and variables → Actions**.

- [ ] **Add secret `PI_PROVIDER_KEY`** (for the #869 reports-only pi.dev flow) — an Anthropic API
      key for a cheap Claude model, or a local-model endpoint key. This is the only thing blocking
      that first pi.dev eval run.
- [ ] **Confirm these secrets exist** (jobs routed to the box need them — GitHub delivers repo
      secrets to self-hosted runners identically, no per-box copying):
      `ANTHROPIC_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
      `HARNESS_APP_ID`, `HARNESS_APP_PRIVATE_KEY`, `PROJECTS_TOKEN`.
- [ ] **Leave `AGENT_RUNNER` unset** until the verify step — set it to `mac-mini` only when you want
      to route traffic over.

> ⚠️ **Security note:** a self-hosted runner executes whatever a workflow tells it to, with the
> box's full filesystem + network. Keep this runner **repo-scoped to a private repo** (never attach
> a self-hosted runner to a public repo — forked-PR workflows could run untrusted code on your
> hardware). Org-scoping is a deliberate later choice (open question in #610), not a default.

---

## 1. Register the runner (#653)

GitHub generates the download URL + a registration token for you: **Settings → Actions → Runners →
New self-hosted runner → macOS**. Use the values it shows (the token is short-lived):

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# URL + token come from the "New self-hosted runner" page:
curl -o actions-runner-osx-arm64.tar.gz -L <DOWNLOAD_URL_FROM_GITHUB>
tar xzf actions-runner-osx-arm64.tar.gz

# Non-interactive config — label it `mac-mini` (the routing toggle targets exactly this label):
./config.sh --url https://github.com/FriendlyInternet/nuxt-crouton \
            --token <REGISTRATION_TOKEN_FROM_GITHUB> \
            --name mac-mini \
            --labels mac-mini \
            --unattended --replace
```

`self-hosted`, `macOS`, and the arch (`ARM64`) labels are added implicitly; `mac-mini` is the one
custom label workflows target.

- [ ] `./config.sh` completes and prints "Runner successfully added".

### Install as a launchd service (always-on)

`svc.sh` wraps the runner in a launchd service with `KeepAlive` — it starts at login/boot and is
relaunched if it dies. **Do not** run the runner via `tmux`/`./run.sh` in a login shell — that
doesn't survive logout/reboot (considered & rejected in #653).

```bash
./svc.sh install      # writes the launchd plist (KeepAlive=true)
./svc.sh start
./svc.sh status       # → "started" with a PID
```

- [ ] **Settings → Actions → Runners** shows **`mac-mini` · Idle**.

> The plist lands at `~/Library/LaunchAgents/actions.runner.FriendlyInternet-nuxt-crouton.mac-mini.plist`.
> A LaunchAgent runs only while the user is logged in — for a true headless box, either enable
> auto-login for this user, or move to a LaunchDaemon. Auto-login is simplest for a home Mac mini.

---

## 2. Provision the toolchain (#654)

The runner captures `PATH` at the time `svc.sh install` runs, so **install the toolchain first**, or
re-install the service after (or add a `PATH` line to the runner's `.env`). `actions/setup-node`
also self-installs Node per-job, which covers most workflows — but a healthy base toolchain avoids
surprises.

```bash
# Node 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# reload shell, then:
nvm install 22 && nvm alias default 22

# pnpm via corepack
corepack enable && corepack prepare pnpm@latest --activate

# GitHub CLI — the #869 posting step and several workflows shell out to `gh`
brew install gh

# wrangler is pulled per-project by pnpm; no global install needed
```

- [ ] `node -v` → v22.x, `pnpm -v` prints, `gh --version` prints.
- [ ] If the runner was installed before the toolchain: `cd ~/actions-runner && ./svc.sh uninstall && ./svc.sh install && ./svc.sh start` (re-captures PATH), **or** add `PATH=...` to `~/actions-runner/.env`.

---

## 3. Reliability — never sleep, auto-recover (#657)

### Don't sleep

A box that sleeps can't pick up a 3am job. Disable sleep (run on the box, needs sudo):

```bash
sudo pmset -a sleep 0 disksleep 0 powernap 0
sudo pmset -a womp 1        # wake-on-LAN, harmless to leave on
pmset -g                    # verify: sleep 0, disksleep 0
```

As an alternative/belt-and-suspenders, the repo ships a launchd job that holds a `caffeinate`
assertion — see `scripts/mac-mini-runner/com.fyit.caffeinate.plist`.

### Watchdog (optional but recommended)

launchd `KeepAlive` already relaunches a *crashed* runner process. The watchdog covers the cases
KeepAlive can't see: the process is alive but **disconnected from GitHub**, or wedged. The repo
ships `scripts/mac-mini-runner/runner-watchdog.sh` + a launchd plist that runs it every few minutes;
it restarts the service and optionally alerts (Slack/email webhook) on failure. Deploy per
`scripts/mac-mini-runner/README.md`.

- [ ] Sleep disabled (`pmset -g` shows `sleep 0`).
- [ ] *(optional)* watchdog plist loaded (`launchctl list | grep fyit`).

---

## 4. Verify (the #653 / #654 / #657 acceptance tests)

1. [ ] **Runner online** — Settings → Actions → Runners shows `mac-mini · Idle`.
2. [ ] **Routing works** — set repo var `AGENT_RUNNER=mac-mini`, then **Actions → "A11y — daily
   accessibility sweep" → Run**. Open the run and confirm the job's runner name is `mac-mini`
   (not a GitHub-hosted runner).
3. [ ] **Secrets + toolchain end-to-end** — that same routed run completes with no
   missing-secret/toolchain error.
4. [ ] **Deploy from macOS** — dispatch a `cf:staging` deploy to the runner; it provisions/deploys
   and the `<app>.pmcp.dev` preview URL responds (proves `wrangler` + CF creds work from the box).
5. [ ] **Survives reboot** — `sudo reboot`; the runner returns to **Idle** within ~2 min unattended.
6. [ ] **Survives network drop** — pull the network briefly; the runner auto-reconnects when it's back.
7. [ ] **Survives process kill** — `kill <Runner.Listener PID>`; launchd KeepAlive (or the watchdog)
   restarts it within ~1 min.

When all pass: leave `AGENT_RUNNER=mac-mini` set to keep routing to the box, or unset it to revert
to GitHub-hosted at any time.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Runner shows **Offline** after reboot | LaunchAgent needs the user logged in — enable auto-login, or move to a LaunchDaemon. |
| Job fails: `pnpm: command not found` | Toolchain installed after the service captured PATH. Re-install the service (§2) or add `PATH` to `~/actions-runner/.env`. |
| Job fails: `gh: command not found` | `brew install gh`, then re-install the service to pick up PATH. |
| Runner **Idle** but jobs still land on `ubuntu-latest` | `AGENT_RUNNER` var not set to `mac-mini` (or set as a *secret* instead of a *variable*). |
| Box sleeps overnight, misses jobs | `sudo pmset -a sleep 0 disksleep 0`; verify with `pmset -g`. Load the caffeinate plist as backup. |
| Runner process alive but Settings shows Offline | Network/connection wedged — the watchdog restarts it; manually `cd ~/actions-runner && ./svc.sh stop && ./svc.sh start`. |

## See also

- Epic #610 (always-on home runner); WS1 #653, WS2 #654, WS5 #657.
- `scripts/mac-mini-runner/` — the watchdog + no-sleep launchd artifacts referenced above.
- `writeups/setup/self-hosted-pi-agent-cloudflare-setup.md` — the *other* (Pi dispatcher) pattern.
- `.github/workflows/a11y-daily-pidev.yml` (#869) — the first job designed to run cheaply here.
