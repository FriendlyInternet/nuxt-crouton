# fanfare local-first venue Pi rig (#798)

Makes the **phone POS → order → in-process ESC/POS drainer → thermal printer**
loop (proven on real hardware in #63) **reproducible and reboot-survivable**. A
Pi reboot brings fanfare back up — LAN-reachable, drainer on, both printers
reachable — with **zero manual steps**.

This replaces the ephemeral bench rig (a manual `tmux` dev server + a hand-typed
`ip addr add` alias that vanished on every link-down) with:

| Piece | What it gives you |
|-------|-------------------|
| `NITRO_PRESET=node-server` build | a real production server (`.output/server/index.mjs`), not `nuxt dev` |
| `fanfare.service` (systemd) | auto-start on boot, `Restart=always`, binds `HOST=0.0.0.0 PORT=80`, `CROUTON_PRINTING_DRAINER=1` |
| `avahi-alias@kassa.local` (mDNS) | the till answers to **`http://kassa.local`** (per-interface CNAME), not `IP:3007` |
| `configure-network.sh` (NetworkManager) | a **persistent** `192.168.1.51/24` route to the printer subnet (no more `ip addr add`) |
| `fanfare-healthcheck.{service,timer}` | boot + 5-min reachability check of the RUT + both printers, logged to the journal |

## Topology (why the network bits matter)

```
 phone (venue/home wifi) ──▶ http://kassa.local  (mDNS → Pi :80)  ← the POS URL
                                  │
                                  ▼  fanfare (node-server) + ESC/POS drainer
 Pi eth0  192.168.1.51/24 ──▶ RUT956 LAN ──▶ kitchen 192.168.1.70:9100
   (static, NetworkManager)                  bar     192.168.1.72:9100
```

- The printers are **wifi clients of the RUT956** on its `192.168.1.0/24` LAN. The
  Pi reaches them **only** over the wired `eth0` (in a RUT LAN port) holding a
  static `192.168.1.51/24`. **Home wifi (wlan0) cannot reach them.**
- ⚠️ **The RUT must be powered.** If it powers down, `eth0` goes `NO-CARRIER` and
  **all** printing fails with the drainer error *"printer not responding — paper
  out, cover open"* — which looks like a printer fault but is really the network
  path being dead. The health check calls this out explicitly (`eth0 NO-CARRIER`).

## First-time setup (fresh Pi or after a code update)

```bash
ssh pmcp@192.168.0.180
cd ~/nuxt-crouton/apps/fanfare/deploy/pi
./setup.sh --build      # build node-server, then install + enable everything
```

`setup.sh` is idempotent — re-run it any time (e.g. after `git pull`); it
rebuilds (with `--build`), re-renders the unit, and restarts the service.

Then, **once**, create the venue data (persists across reboots in
`.data/db/sqlite.db`):

1. On a phone on the **same wifi as the Pi**, open **`http://kassa.local`**
   (iOS/macOS resolve it via mDNS, no setup), register an account + team.
2. Build the event in the **admin UI**: create an event (set its helper PIN),
   add locations (e.g. *Keuken*, *Bar*), products, and one `network-escpos`
   printer per location pointed at its IP (kitchen `192.168.1.70`, bar
   `192.168.1.72`). Give each product a `locationId` so tickets route per
   station — a product with **no** location prints a "default" ticket on *every*
   kitchen printer.

   > The dev-only `_seed` route (`import.meta.dev`-gated, so it does **not**
   > exist in this production build) can do the above in one shot when running
   > `pnpm dev` for a bench test. A production-safe seed runner is #797.

This DB **persists across reboots** — you only set the venue up once.

## Day-to-day ops

```bash
systemctl status fanfare                 # is it up?
journalctl -u fanfare -f                 # app + drainer logs
journalctl -u fanfare-healthcheck -e     # last reachability verdicts
./healthcheck.sh                         # run the check by hand (RUT + both printers)
sudo systemctl restart fanfare           # restart after a manual rebuild
```

**Verify reboot-survival:** `sudo reboot`, wait ~1 min, then from a phone load
`http://kassa.local` and ring up an order — kitchen + bar tickets print,
nothing touched by hand.

## The friendly URL

Staff reach the till at **`http://kassa.local`** — no IP, no `:3007`:
- The app binds **port 80** (`fanfare.service` grants the non-root process
  `CAP_NET_BIND_SERVICE`), so the URL drops the port.
- `avahi-alias@kassa.local` publishes an **mDNS CNAME** to this host, resolved
  **per-interface** — a phone on the RUT wifi gets the wired `.51`, a bench phone
  on home wifi gets `.180`, with no per-network config. `BETTER_AUTH_URL` is set
  to match so session cookies line up.
- **iOS/macOS** resolve `.local` natively. **Android/Windows don't** — for an
  all-device venue, add one line to the venue router / RUT DNS (dnsmasq):
  `address=/kassa/<the till's IP on that network>` → staff use `http://kassa`.
  (`setup.sh` prints this line for you.)
- Change the name by passing `ALIAS=till.local ./setup.sh`.

## Gotchas (learned the hard way)

- **Bind with `HOST`/`PORT` env, never `nuxt dev --host/--port`** — the CLI flags
  mangle the port (drifts to 3000/3001). The systemd unit uses env vars.
- **`drizzle-orm/libsql` trace fix** — the node-server build needs
  `nitro.externals.traceInclude: ['drizzle-orm/libsql']` (in `nuxt.config.ts`)
  or `node .output/server` dies with *"Cannot find module .../drizzle-orm/libsql"*.
  Scoped to the non-Cloudflare target.
- **`BETTER_AUTH_SECRET` must be stable** across reboots or every session is
  invalidated on restart. It lives in `/etc/fanfare/fanfare.env` (not committed).
- **Re-add nothing after a RUT power-cycle** — the static route is a real
  NetworkManager profile now, so it comes back on its own. If `eth0` ever lacks
  `192.168.1.51`, re-run `configure-network.sh`.
- **Printer IPs can drift** (`.72`→`.70` has happened). If a station goes quiet,
  sweep `192.168.1.0/24` for `:9100` and update the printer row + healthcheck IPs.

## Files

| File | Role |
|------|------|
| `setup.sh` | idempotent orchestrator (build + install + enable) |
| `fanfare.service` | systemd unit **template** (`setup.sh` renders the paths) |
| `fanfare.env.example` | secrets template → copy to `/etc/fanfare/fanfare.env` |
| `configure-network.sh` | persistent NetworkManager printer-subnet route |
| `healthcheck.sh` | RUT + printer reachability check (exit ≠ 0 when degraded) |
| `avahi-alias` | mDNS CNAME publisher — `<name>.local` → this host (per-interface) |
| `avahi-alias@.service` | systemd template running the publisher (`avahi-alias@kassa.local`) |
