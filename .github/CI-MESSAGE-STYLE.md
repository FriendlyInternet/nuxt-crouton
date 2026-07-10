# CI message style — readable on the go

The contract for **every human-facing comment a workflow posts** (issue/PR comments, standing
alerts). The reader is the owner glancing at a GitHub notification **on their phone** — they must
know *what happened* and *what to do* from the **first line**, without opening the run. Epic #1336.
Sibling of #479 (same philosophy for ticket/epic bodies).

## The five rules

1. **First line = a status emoji + the problem/outcome in plain words.** No leading gate name, no
   leading `(#NN)`, no internal mechanism. The reader learns *what happened* immediately.
   - 🔴 broke / needs you · 🟢 done · ⏳ waiting / queued · ✅ ready / passed · 🚫 blocked
2. **Second line = the ONE action**, imperative and concrete: `**Fix:** top up + re-dispatch`.
   If there's nothing to do, say so (`No action needed`).
3. **Mechanism goes in a footer**, small (`<sub>…</sub>`): which gate, the issue/PR #, the run link,
   and the `🤖` provenance header (CLAUDE.md still requires it — the footer is where it lives now).
4. **Short.** Depth — log tails, probe JSON, file lists, matrices — goes in `<details><summary>…`.
   The visible message is a few lines.
5. **Plain nouns, not system names.** "your Anthropic key is out of credit", not
   "the provider call returned invalid_request_error". Name things by what the reader recognizes.

## Template

```
🔴 **@owner — <the problem, in plain words>.**

**Fix:** <the one concrete action>.

<details><summary>details</summary>

… log tail / JSON / file list …
</details>

<sub>🤖 <source> · <gate/mechanism + #NN> · <a href="…run">run log</a></sub>
```

## Before / after (the artifact-gate message that prompted this)

**Before** — leads with the mechanism, buries the cause:
> ⚠️ **Artifact-gate failed (#461).** @pmcp — this pi.dev run produced no deliverable: the pi
> provider call failed — **the Anthropic account behind `PI_PROVIDER_KEY` is out of credit**.
> **What to do:** Top up that account (Console → Billing; enable auto-reload), then re-dispatch.

**After** — leads with the problem + fix; mechanism demoted:
> 🔴 **@pmcp — this run produced nothing: the Anthropic key (`PI_PROVIDER_KEY`) is out of credit.**
>
> **Fix:** top up the account + re-dispatch.
>
> <sub>🤖 pi.dev harness (CI · mac-mini) · artifact-gate #461 fails a no-op run so it isn't
> mistaken for done · [run log](…)</sub>

## Don'ts

- ❌ Don't lead with `Artifact-gate failed` / `Deploy job` / any step or gate name.
- ❌ Don't lead with `(#NN)` — the issue/PR number is footer context, not the headline.
- ❌ Don't suggest actions that contradict a standing decision (e.g. "enable auto-reload" — the
  owner declined it, #1327; point at the key canary instead).
- ❌ Don't paste a wall of log — collapse it in `<details>`.
