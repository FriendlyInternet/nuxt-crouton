# Mac mini runner — reliability artifacts (#657)

Deployable launchd jobs that keep the self-hosted GitHub Actions runner reliable on the Mac mini.
These are the supporting scripts for `writeups/setup/self-hosted-mac-mini-runner.md` — read that
runbook first; it's the full on-box setup. **Everything here is deployed on the box by hand** (the
cloud sandbox can't touch the physical Mac mini).

| File | What it does |
|---|---|
| `runner-watchdog.sh` | Health check: if the runner process is gone *while GitHub is reachable*, restart the service and optionally alert. Covers the wedged/disconnected case launchd `KeepAlive` can't see. |
| `com.fyit.runner-watchdog.plist` | launchd job that runs the watchdog every 5 min. |
| `com.fyit.caffeinate.plist` | launchd job holding a `caffeinate` no-sleep assertion — backup to `pmset`. |

## Why these exist

`./svc.sh install` already gives the runner launchd `KeepAlive`, which relaunches a **crashed**
process. It does **not** catch a process that's alive but **disconnected from GitHub** (network blip,
wedged listener), and it won't stop the box from **sleeping**. These two jobs close those gaps.

## Deploy

Assumes the repo is checked out at `~/nuxt-crouton` and the runner at `~/actions-runner` — adjust
paths to match your box.

```bash
# 1) Make the watchdog executable
chmod +x ~/nuxt-crouton/scripts/mac-mini-runner/runner-watchdog.sh

# 2) Copy the plists into the per-user LaunchAgents dir
cp ~/nuxt-crouton/scripts/mac-mini-runner/com.fyit.runner-watchdog.plist ~/Library/LaunchAgents/
cp ~/nuxt-crouton/scripts/mac-mini-runner/com.fyit.caffeinate.plist      ~/Library/LaunchAgents/

# 3) Edit the watchdog plist: replace every /Users/CHANGEME with your real home path,
#    and (optional) set ALERT_WEBHOOK to a Slack/Discord incoming webhook URL.
#    launchd does NOT expand ~ — paths must be absolute.
vim ~/Library/LaunchAgents/com.fyit.runner-watchdog.plist

# 4) Load them (launchctl bootstrap is the modern form; `load` also works)
launchctl load ~/Library/LaunchAgents/com.fyit.runner-watchdog.plist
launchctl load ~/Library/LaunchAgents/com.fyit.caffeinate.plist

# 5) Verify
launchctl list | grep fyit          # → both labels listed
tail -f ~/Library/Logs/runner-watchdog.log
```

> ⚠️ launchd LaunchAgents run only while the user is **logged in**. For a headless always-on box,
> enable auto-login for this user (System Settings → Users & Groups → Automatically log in as…),
> or move the jobs to `/Library/LaunchDaemons` (system scope, runs without a login session).

## Test (maps to #657's acceptance)

```bash
# Watchdog catches a killed runner:
kill "$(pgrep -f Runner.Listener)"      # then within ~5 min the watchdog restarts it
tail -f ~/Library/Logs/runner-watchdog.log   # → "recovered: runner restarted, listener back"

# No-sleep is active:
pmset -g assertions | grep -i caffeinate     # → caffeinate assertion present
```

## Unload / remove

```bash
launchctl unload ~/Library/LaunchAgents/com.fyit.runner-watchdog.plist
launchctl unload ~/Library/LaunchAgents/com.fyit.caffeinate.plist
rm ~/Library/LaunchAgents/com.fyit.runner-watchdog.plist ~/Library/LaunchAgents/com.fyit.caffeinate.plist
```
