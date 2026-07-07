# pi box config as code (#1060)

The mac-mini's pi.dev setup, driven from git instead of hand-installed on the box. Changing a
pi extension becomes a **manifest edit → PR → apply**, reviewable and versioned like everything
else — not an SSH-and-`pi install`.

## The model: pinned installer (base) + our deltas

The box was bootstrapped by an **opinionated one-shot installer**, [`@robzolkos/lazypi`](https://www.npmjs.com/package/@robzolkos/lazypi),
which lays down a curated 24-package baseline. We add a few packages + settings on top. So the
manifest **pins the installer and tracks only our deltas** — it does *not* re-vendor lazypi's
curated list. A lazypi curation bump is a deliberate `base.version` change here.

| File | Role |
|---|---|
| `pi-config.manifest.json` | desired state: pinned `base` installer, our `add`/`remove` deltas (pinned), `settings` overrides |
| `apply-pi-config.mjs` | idempotent reconcile of a box to the manifest; `--dry-run` first |

## Manifest shape

```jsonc
{
  "base": { "installer": "@robzolkos/lazypi", "version": "0.6.3" }, // opinionated baseline, pinned
  "add":  [ "npm:pi-otel@0.1.0", "git:github.com/owner/repo@<sha>" ], // our deltas, version/SHA-pinned
  "remove": [],
  "settings": { "otel": {…}, "subagents": {…}, "theme": "dark" }     // our overrides
}
```

Everything is **pinned** (npm `@version`, git `@sha`) — installing an extension is code execution,
so the manifest diff is the supply-chain review; apply installs exactly what was reviewed.

## Applying

```bash
node scripts/pi-box/apply-pi-config.mjs --dry-run   # print the plan, change nothing
node scripts/pi-box/apply-pi-config.mjs             # apply
```

Order: **base → add → remove → settings** (lazypi overwrites `~/.pi/agent/settings.json` and backs
it up, so our deltas + settings are layered *after* it). The base runs only when the recorded
version (`~/.pi/agent/.pi-box-base`) differs from the manifest — so a re-run with no manifest change
is a **no-op**. Flags: `--skip-base` (reconcile deltas+settings only), `--force-base`, `--settings`
/ `--base-marker` / `--manifest` (override paths, e.g. for testing against a copy).

## Applying from GitHub (phase 2)

`.github/workflows/pi-box-apply.yml` runs this apply on the self-hosted **mac-mini** runner, so a
manifest change lands on the box with no manual step — the full "flip an extension from GitHub → box
updates" loop (#1060 "We'll know by"). Two triggers:

- **push → `main`** (path-filtered on the manifest / apply script) — a **merged** manifest change
  applies for real. A push fires only for already-reviewed, merged code, so untrusted fork code
  never reaches the box; the manifest diff **is** the supply-chain review.
- **workflow_dispatch** — a manual run, defaulting to `--dry-run` (flip `dry_run` off to apply);
  `skip_base` / `force_base` pass through to the script.

**Scoped token, not human creds (#656/#670):** applying a manifest is code execution on the box, so
the runner uses only the ephemeral, auto-expiring `GITHUB_TOKEN` scoped to `contents: read` — no
PAT, no Harness App token. The apply mutates the box locally (no GitHub writes); its result is shown
in the run's job summary. No `setup-node` — node/npm/pi resolve via the runner's launchd `.path` so
the box's **real** global `~/.pi` is reconciled, not an ephemeral CI node prefix.
