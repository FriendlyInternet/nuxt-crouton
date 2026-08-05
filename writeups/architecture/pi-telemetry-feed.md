# pi.dev telemetry feed — the local `{model, tokens, cost, outcome}` contract (#938)

**What this is:** the data contract for pi.dev's *native, local, no-egress* telemetry on the
`mac-mini` runner — the feed the #883 run-outcome ledger and loop-station WS2 (#926) **consume**
rather than rebuild. The headline finding of #938: **there is nothing to build.** pi already
writes per-run `{model, tokens, cost}` and per-run `{outcome, duration}` to local files. This doc
pins the exact file locations + field paths so a consumer can read them.

> Scope note: this is the **file-based** feed (the #938 decision). OTel traces (`pi-otel`,
> `localhost:4317`, `metadata_only`) stay *configured* for a future WS2 trace overlap but are
> **de-scoped here** — nothing listens on :4317 and no consumer depends on it.

## The three files

All paths are under `~/.pi/agent/` on the box, local-only and gitignored — **no egress**.

### 1. Session jsonl — per-turn tokens + cost  ← the `{model, tokens, cost}` slice

```
~/.pi/agent/sessions/<cwd-slug>/<ISO-ts>_<sessionId>.jsonl
```
- **`<cwd-slug>`** = the run's working directory with `/`→`-`, wrapped in `--`. So an interactive
  run in `/Users/maarten/nuxt-crouton` → `--Users-maarten-nuxt-crouton--`; a **CI runner** job in
  `/Users/maarten/actions-runner/_work/nuxt-crouton/nuxt-crouton` →
  `--Users-maarten-actions-runner-_work-nuxt-crouton-nuxt-crouton--`.
- One JSONL line per event; the **assistant** messages carry usage/cost:

```jsonc
{ "type": "message",
  "message": {
    "role": "assistant",
    "provider": "anthropic",              // ← see the provider caveat below
    "model": "claude-sonnet-5",
    "usage": {
      "input": 2, "output": 115,
      "cacheRead": 0, "cacheWrite": 40595,
      "totalTokens": 40712,
      "reasoning": 16,
      "cost": {                            // USD
        "input": 4e-06, "output": 0.00115,
        "cacheRead": 0, "cacheWrite": 0.1014875,
        "total": 0.1026415
      }
    },
    "stopReason": "toolUse",
    "timestamp": 1783442486246
  } }
```

**Per-run rollup** = sum `message.usage.totalTokens` and `message.usage.cost.total` across the
assistant messages in the file; `model` = the model(s) seen (a run may mix tiers). The session
`id`/file name is the run key.

### 2. `run-history.jsonl` — per-run outcome + latency

```
~/.pi/agent/run-history.jsonl        // one line per run
{ "agent": "worker", "task": "You are a delegated subagent…", "ts": 1782858164,
  "status": "ok", "duration": 32437 }   // status: ok|error…; duration ms
```
Gives the `{outcome, duration}` half the session jsonl doesn't. Join to a session by time/agent.

### 3. Heartbeat (optional, liveness only — **no cost**)

```
~/.pi/agent/telemetry/instances/<pid>.json   // @jademind/pi-telemetry, schemaVersion 2
```
Process / session / context-window / activity state, one JSON snapshot per live pid. Useful for
"is a run in flight + how full is its context", **not** for cost/tokens.

## Provider caveat (this is why funding the key mattered, #938 / #652)

| provider | when | usage/cost numbers |
|---|---|---|
| `anthropic` | CI / headless (`ANTHROPIC_API_KEY`; `.pi/settings.json` → `defaultProvider: anthropic`) | **real** — pi reads usage off the API response |
| `pi-claude-cli` | local interactive (subscription via the `claude` CLI) | **unreliable** — often all-zero; the CLI doesn't consistently return usage |

So the **dependable, cost-accurate feed is the `anthropic` path** — which is also exactly the
CI/headless flow #883 targets. Proven: 20+ existing `provider:anthropic` sessions carry real
`totalTokens` (Haiku 4.5 / Sonnet 5 / Opus 4.8, 27k–105k each). A consumer should **filter to
`provider == "anthropic"`** (or treat all-zero usage as "unmetered", not "free").

## The slice #883 reads

```
{ runKey:   <session file name / session id>,
  model:    message.model,                        // session jsonl
  tokens:   Σ message.usage.totalTokens,          // session jsonl (assistant turns)
  cost:     Σ message.usage.cost.total,           // session jsonl (USD)
  outcome:  run-history.status,                   // run-history.jsonl
  duration: run-history.duration }                // run-history.jsonl (ms)
```

## Minimal extraction recipe

```bash
# per-run totals from one session file
python3 - "<session.jsonl>" <<'PY'
import json,sys
tok=cost=0.0; model=set()
for l in open(sys.argv[1]):
    m=json.loads(l).get("message",{})
    if m.get("role")=="assistant" and m.get("provider")=="anthropic":
        u=m.get("usage",{}); tok+=u.get("totalTokens",0)
        cost+=u.get("cost",{}).get("total",0); model.add(m.get("model"))
print({"model":sorted(model),"tokens":tok,"cost_usd":round(cost,4)})
PY
```

## Stability

The schema is **pi-native** (session jsonl + run-history), not a bolted-on capture, so it
**survives the claude-code-action → pi.dev swap** and works unchanged across models and both
providers — the #938 "survives a model/agent change without a capture rewrite" requirement.

## See also
- #938 (this feed) · #883 (run-outcome ledger that consumes it) · #926 / loop-station WS2 (trace reconstruction)
- The runbook the mac-mini feed is produced on: `writeups/setup/self-hosted-mac-mini-runner.md`
- CI pi profile that selects the `anthropic` provider + telemetry extensions: `.pi/settings.json`
