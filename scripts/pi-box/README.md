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

## What's not here yet (phase 2)

A `workflow_dispatch` job on the mac-mini runner that runs this apply from a manifest PR — the full
"flip an extension from GitHub → box updates" loop (#1060 "We'll know by"). Needs a scoped token
(not human creds — the #656/#670 lesson). Until then, apply is run on the box by hand from a merged
manifest change.
