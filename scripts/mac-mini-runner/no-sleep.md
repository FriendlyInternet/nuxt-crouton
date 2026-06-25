# Keep the Mac mini awake (no-sleep) — `pmset` + `caffeinate`

Epic #610 / issue #657 (WS5). A self-hosted runner that goes to sleep can't pick up a
3am dispatched job. There are two complementary levers on macOS — set **both**.

## 1. `pmset` — the persistent system policy (set once, survives reboot)

`pmset` writes the power-management policy to NVRAM, so it sticks across reboots. Run on
the mini (over SSH is fine). These need `sudo`.

```bash
# Never sleep the SYSTEM while on AC power (0 = never). The Mac mini is always on AC.
sudo pmset -c sleep 0

# Never sleep the DISK, and keep the system fully awake even with the display off.
sudo pmset -c disksleep 0
sudo pmset -c displaysleep 0     # optional; a headless mini has no display anyway

# Belt-and-suspenders: disable "power nap" and auto-restart quirks, keep awake on AC.
sudo pmset -c powernap 0
sudo pmset -c womp 1             # wake-on-network (so a Wake-on-LAN can rouse it)

# Auto-restart after a power failure — so a blackout doesn't leave the runner offline.
sudo pmset -c autorestart 1

# Verify the resulting policy:
pmset -g custom
```

Key line to confirm in `pmset -g custom` output (the AC / `-c` block):
`sleep 0`, `disksleep 0`, `powernap 0`, `autorestart 1`.

> Why `-c` (AC power) and not `-b` (battery): a Mac mini has no battery, so the AC
> profile is the only one that applies. If you ever run this on a laptop runner, decide
> the battery policy separately.

## 2. `caffeinate` — a belt over the policy (optional, runtime assertion)

`pmset` is usually enough. If you want an explicit, observable "do not sleep" assertion
tied to the runner's lifetime (useful if some other process keeps re-enabling sleep), run
`caffeinate` under launchd so it's always asserting.

- `caffeinate -s` asserts "system must not sleep" **only while on AC power**.
- `caffeinate -i` prevents idle sleep.
- `caffeinate -d` prevents display sleep.

A always-on assertion as a launchd agent (`~/Library/LaunchAgents/com.nuxtcrouton.caffeinate.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nuxtcrouton.caffeinate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>   <!-- system sleep prevented while on AC -->
    <string>-i</string>   <!-- idle sleep prevented -->
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>   <!-- if caffeinate ever exits, relaunch it -->
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nuxtcrouton.caffeinate.plist
# verify the assertion is active:
pmset -g assertions | grep -i 'PreventUserIdleSystemSleep'
```

## Acceptance check (ties to #657 test 1)

After setting both: `pmset -g assertions` shows a `PreventUserIdleSystemSleep` assertion,
and `pmset -g custom` shows `sleep 0` on AC. Then force a reboot — the runner returns to
**Idle** on its own (launchd) and the box does not drift back to sleep.
