# Venue till installers

Two ways to get a till running. Pick by what the box is.

| | `install.sh` (#804) | `pi/setup.sh` (#798) |
|---|---|---|
| **Target** | any Linux box with systemd | the bench Pi rig |
| **Needs a repo on the box?** | no | **yes** — runs from a checkout |
| **Builds on-site?** | no — downloads a prebuilt bundle | yes (needs ~6GB heap) |
| **Binds to an org?** | yes — pairing code | no — hand-seeded |
| **Use when** | provisioning a real venue | hacking on the Pi rig itself |

`install.sh` is the one an operator runs. `pi/` stays for the developer rig and
still owns the network/mDNS/printer-route specifics (`configure-network.sh`,
`avahi-alias`) that a generic installer deliberately doesn't touch.

## Install a till

**On the target box:**

```bash
curl -fsSL https://raw.githubusercontent.com/FriendlyInternet/nuxt-crouton/main/apps/fanfare/deploy/install.sh \
  | sudo bash -s -- --release latest
```

It will prompt for a pairing code. Mint one first **in the app**, as a team member:

```
POST /api/crouton-sales/teams/<team>/devices/pairing-codes  →  { code, expiresAt }
```

The code is 8 characters (no `I` or `O`), single-use, and valid for 15 minutes.

That code is the **only** thing anyone types on the box. Everything else — which
organization, which event, the device's token and its own secret — comes back
from the claim and is written to `/etc/fanfare/device.env` (root-only, `0600`).

### Preview without touching anything

```bash
bash install.sh --dry-run --release latest --code ABCD2345 --name "Bar till 1"
```

Runs anywhere, including a laptop with no systemd. Prints every action it would
take and exits.

### Options

| Flag | Meaning |
|---|---|
| `--release <tag>` | bundle to install (default: latest `venue-*` release) |
| `--api-url <url>` | origin that accepts the claim (default: `https://kassa.friendlyinter.net`) |
| `--code <code>` | pairing code, instead of being prompted |
| `--name <name>` | device name in the org's device list (default: hostname) |
| `--reclaim` | re-pair a box that already has an identity |
| `--skip-claim` | install and wire only; pair later |
| `--dry-run` | preview; touch nothing |

Env equivalents: `FANFARE_API_URL`, `FANFARE_PAIRING_CODE`, `FANFARE_DEVICE_NAME`,
`FANFARE_INSTALL_DIR`, `FANFARE_PORT`, `FANFARE_USER`, `FANFARE_PRINTER_HOSTS`.

## After it runs

```bash
systemctl status fanfare
journalctl -u fanfare -f
```

The till listens on `:3000` and restarts on failure and on boot — surviving a
power cut is the point.

The installer ends with a reachability report: the local app, the cloud origin,
and (when `FANFARE_PRINTER_HOSTS="192.168.1.72 192.168.1.73"` is set) each
printer's `:9100`. **Those checks report, they never fail the install** — a till
with an unplugged printer should still boot so it can be fixed on site.

## Upgrading

Re-run the same command. The bundle is replaced, the device identity is left
alone (`--reclaim` to re-pair), and the previous build stays at
`/opt/fanfare/output.old` for a manual rollback.

## Publishing a bundle

The installer downloads what `.github/workflows/release-venue-bundle.yml`
publishes. Cut one from the Actions tab (**Release venue bundle** →
*Run workflow* → tag e.g. `venue-2026.08.03`), or push a `venue-*` tag.

It builds fanfare with `NITRO_PRESET=node-server` — the same build CI already
proves on every PR — then attaches `fanfare-venue.tar.gz` plus a `.sha256` the
installer verifies.

## Layout on the box

```
/opt/fanfare/output/          the Nitro server bundle
/opt/fanfare/output.old/      previous bundle (rollback)
/opt/fanfare/BUNDLE.json      tag + commit + build time
/etc/fanfare/fanfare.env      port, auth secret            (0600)
/etc/fanfare/device.env       org, event, token, secret    (0600)
/etc/systemd/system/fanfare.service
```
