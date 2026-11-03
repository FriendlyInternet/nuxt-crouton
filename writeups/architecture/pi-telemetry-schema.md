# pi.dev Telemetry Schema Reference

> Pinned from real pi 0.80.2 output on the Mac mini runner (2026-06-30).
> For #938 (wire pi telemetry) and #944 (telemetry convergence adapter).

## Three telemetry surfaces

| Surface | What it captures | Where it writes | Extension needed |
|---------|-----------------|-----------------|-----------------|
| **Native session JSONL** | Per-message tokens, cost, model, provider, stop reason | `~/.pi/agent/sessions/<cwd-slug>/<timestamp>_<session-id>.jsonl` | None (built-in) |
| **Subagent meta JSON** | Per-worker rollup: cost, tokens, turns, duration, exit code | `~/.pi/agent/sessions/<cwd-slug>/subagent-artifacts/<runId>_<agent>_<idx>_meta.json` | None (built-in, requires pi-subagents) |
| **pi-otel** (extension) | OTel GenAI spans: interaction → turn → llm_request / tool.\<name\> | OTLP export to configured endpoint (default `localhost:4317`) | `npm:pi-otel` |
| **@jademind/pi-telemetry** (extension) | Per-process heartbeat: activity state, context pressure, model | `~/.pi/agent/telemetry/instances/<pid>.json` | `npm:@jademind/pi-telemetry` |

---

## 1. Native Session JSONL (built-in, already captured)

Each pi session writes a JSONL file. Every line is a JSON object with a `type` field.

### Line types

#### `session` (first line)
```json
{
  "type": "session",
  "version": 3,
  "id": "019f1a4d-d255-7228-a270-fd9275877950",
  "timestamp": "2026-06-30T20:52:15.573Z",
  "cwd": "/Users/maarten/nuxt-crouton"
}
```

#### `model_change`
```json
{
  "type": "model_change",
  "id": "e24ab9e1",
  "parentId": null,
  "timestamp": "2026-06-30T18:09:50.428Z",
  "provider": "anthropic",
  "modelId": "claude-haiku-4-5"
}
```

#### `thinking_level_change`
```json
{
  "type": "thinking_level_change",
  "id": "15e92fdf",
  "parentId": "e24ab9e1",
  "timestamp": "2026-06-30T18:09:50.428Z",
  "thinkingLevel": "medium"
}
```

#### `message` (assistant — the cost-bearing line)

> Captured from a REAL Haiku call on the Mac mini (2026-06-30T21:46Z). Content/thinking redacted.

```json
{
  "type": "message",
  "id": "3f10dfdb",
  "parentId": "f5095b7e",
  "timestamp": "2026-06-30T21:46:23.830Z",
  "message": {
    "role": "assistant",
    "content": ["<REDACTED — thinking + text>"],
    "api": "pi-claude-cli",
    "provider": "pi-claude-cli",
    "model": "claude-haiku-4-5-20251001",
    "usage": {
      "input": 10,
      "output": 83,
      "cacheRead": 0,
      "cacheWrite": 43751,
      "totalTokens": 43844,
      "cost": {
        "input": 0.00001,
        "output": 0.000415,
        "cacheRead": 0,
        "cacheWrite": 0.05468875,
        "total": 0.05511375
      }
    },
    "stopReason": "stop",
    "timestamp": 1782855980632
  }
}
```

**Privacy note:** `content` contains the full assistant response (including `thinking` blocks with signatures). The adapter MUST NOT forward content, only the `usage` + `model` + `provider` + `stopReason` fields.

#### `message` (user)
```json
{
  "type": "message",
  "id": "35aedb10",
  "parentId": "74fec097",
  "timestamp": "2026-06-30T18:09:50.927Z",
  "message": {
    "role": "user",
    "content": [{"type": "text", "text": "<REDACTED>"}],
    "timestamp": 1782842990906
  }
}
```

#### `custom` (extension-emitted)
```json
{
  "type": "custom",
  "customType": "plannotator",
  "data": {"phase": "idle", "lastSubmittedPath": null, "savedState": null},
  "id": "91811200",
  "parentId": "56b13782",
  "timestamp": "2026-06-30T20:52:16.790Z"
}
```

### Key types for the adapter

| Field path | Type | What #883/#944 wants |
|-----------|------|---------------------|
| `message.provider` | `string` | Provider name (e.g. `"anthropic"`, `"pi-claude-cli"`) |
| `message.model` | `string` | Model ID (e.g. `"claude-haiku-4-5"`) |
| `message.usage.input` | `number` | Input tokens |
| `message.usage.output` | `number` | Output tokens |
| `message.usage.cacheRead` | `number` | Cache-read tokens |
| `message.usage.cacheWrite` | `number` | Cache-write tokens |
| `message.usage.totalTokens` | `number` | Sum of all token counts |
| `message.usage.cost.total` | `number` | Total cost in USD for this message |
| `message.usage.cost.input` | `number` | Input cost USD |
| `message.usage.cost.output` | `number` | Output cost USD |
| `message.usage.cost.cacheRead` | `number` | Cache-read cost USD |
| `message.usage.cost.cacheWrite` | `number` | Cache-write cost USD |
| `message.stopReason` | `string` | `"stop"`, `"error"`, `"tool_use"`, etc. |

---

## 2. Subagent Meta JSON (built-in, requires pi-subagents)

Written per worker/subagent run to `subagent-artifacts/`.

### Sanitized sample (from a REAL Haiku worker run)
```json
{
  "runId": "8a6fa2d3",
  "agent": "worker",
  "task": "<REDACTED — full task prompt>",
  "exitCode": 0,
  "usage": {
    "input": 459,
    "output": 9236,
    "cacheRead": 2772244,
    "cacheWrite": 77082,
    "cost": 0.4202159,
    "turns": 45
  },
  "model": "anthropic/claude-haiku-4-5-20251001:high",
  "attemptedModels": [
    "anthropic/claude-haiku-4-5-20251001"
  ],
  "modelAttempts": [
    {
      "model": "anthropic/claude-haiku-4-5-20251001",
      "success": true,
      "exitCode": 0,
      "usage": {
        "input": 459,
        "output": 9236,
        "cacheRead": 2772244,
        "cacheWrite": 77082,
        "cost": 0.4202159,
        "turns": 45
      }
    }
  ],
  "durationMs": 192340,
  "toolCount": 44,
  "timestamp": 1782380757684
}
```

### Key fields for the adapter

| Field | Type | What #883 wants |
|-------|------|----------------|
| `runId` | `string` | Unique run identifier |
| `agent` | `string` | Agent role (`"worker"`, `"planner"`, etc.) |
| `exitCode` | `number` | 0 = success |
| `usage.cost` | `number` | Total run cost USD |
| `usage.input` | `number` | Total input tokens |
| `usage.output` | `number` | Total output tokens |
| `usage.cacheRead` | `number` | Total cache-read tokens |
| `usage.cacheWrite` | `number` | Total cache-write tokens |
| `usage.turns` | `number` | Number of LLM turns |
| `model` | `string` | `"<provider>/<model>:<thinking>"` |
| `durationMs` | `number` | Wall-clock duration |
| `toolCount` | `number` | Total tool invocations |
| `timestamp` | `number` | Unix epoch ms |

---

## 3. pi-otel (extension — OTel GenAI spans)

**Extension:** `npm:pi-otel@0.1.0`
**Config:** `settings.json` → `otel.enabled`, `otel.endpoint`, `otel.protocol`
**Default endpoint:** `http://localhost:4317` (gRPC OTLP) — **local only, no egress**

### Span tree (per user prompt)

```
pi.interaction (root)
├── pi.turn (one per agent turn)
│   ├── pi.llm_request (one per provider API call)
│   └── pi.tool.<name> (one per tool invocation, parallel-safe keyed by toolCallId)
```

### OTel GenAI semantic convention attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.conversation.id` | string | Session/conversation ID |
| `gen_ai.system` | string | Always `"pi"` |
| `gen_ai.provider.name` | string | Provider (e.g. `"anthropic"`) |
| `gen_ai.request.model` | string | Requested model ID |
| `gen_ai.response.model` | string | Actual model used |
| `gen_ai.response.finish_reasons` | string[] | Stop reasons |
| `gen_ai.usage.input_tokens` | number | Input tokens |
| `gen_ai.usage.output_tokens` | number | Output tokens |
| `gen_ai.usage.cache_read_input_tokens` | number | Cache-read tokens |
| `gen_ai.usage.cache_write_input_tokens` | number | Cache-write tokens |
| `gen_ai.usage.reasoning_tokens` | number | Reasoning/thinking tokens |
| `gen_ai.tool.name` | string | Tool name |
| `gen_ai.tool.call.id` | string | Tool call ID |
| `gen_ai.operation.name` | string | Operation type |

### pi-specific attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `pi.session.id` | string | Pi session UUID |
| `pi.cwd` | string | Working directory |
| `pi.turn_count` | number | Total turns so far |
| `pi.turn_index` | number | Current turn index |
| `pi.tool_count` | number | Total tool calls so far |
| `pi.cost.usd` | number | Cost in USD |
| `pi.user_prompt` | string | User prompt text (**STRIP for privacy**) |
| `pi.user_prompt_length` | number | Prompt length (safe to forward) |

### Content capture modes

| Mode | What's captured |
|------|----------------|
| `metadata_only` (default, RECOMMENDED) | Token counts, model, cost — no message content |
| `no_tool_content` | Above + user/assistant messages, but no tool I/O |
| `full` | Everything including tool arguments and results |

**Privacy rule:** Use `metadata_only` (the default). This aligns with our "names + ids + durations + cost ONLY, never tool payloads" rule.

### Config sample (for `~/.pi/agent/settings.json`)
```jsonc
{
  "otel": {
    "enabled": true,
    "endpoint": "http://localhost:4317",
    "protocol": "grpc",
    "captureContent": "metadata_only",
    "signals": { "traces": true, "metrics": false, "logs": false }
  }
}
```

---

## 4. @jademind/pi-telemetry (extension — local heartbeat)

**Extension:** `npm:@jademind/pi-telemetry@0.1.4`
**Writes to:** `~/.pi/agent/telemetry/instances/<pid>.json`
**Snapshot CLI:** `pi-telemetry-snapshot --pretty`
**Cleanup:** file removed on graceful `session_shutdown`

### Per-instance heartbeat fields

| Field | Type | Description |
|-------|------|-------------|
| `process.pid` | number | OS process ID |
| `process.uptime` | number | Uptime ms |
| `workspace.cwd` | string | Working directory |
| `workspace.gitBranch` | string | Current git branch |
| `session.id` | string | Pi session UUID |
| `model.provider` | string | Provider name |
| `model.id` | string | Model ID |
| `model.thinkingLevel` | string | Thinking level |
| `state.activity` | string | `"working"` / `"waiting_input"` / `"unknown"` |
| `context.percent` | number | Context window usage % |
| `context.pressure` | string | `"normal"` / `"approaching_limit"` / `"near_limit"` / `"at_limit"` |
| `lastEvent` | string | Most recent pi lifecycle event |

### Real heartbeat sample (captured 2026-06-30T21:46Z)

```json
{
  "schemaVersion": 2,
  "source": "pi-telemetry",
  "process": {
    "pid": 37110,
    "ppid": 36569,
    "startedAt": 1782855864074,
    "updatedAt": 1782856021314,
    "uptimeMs": 157240,
    "heartbeatSeq": 103,
    "heartbeatMs": 1500
  },
  "system": {
    "host": "Maartens-Mac-mini.local",
    "user": "maarten",
    "platform": "darwin",
    "arch": "arm64",
    "nodeVersion": "v22.23.1"
  },
  "workspace": {
    "cwd": "/Users/maarten/nuxt-crouton",
    "git": { "branch": "chore/653-mac-mini-runner-runbook", "commit": "71fe45ed" }
  },
  "session": {
    "id": "019f1a7d-8aa2-7e25-a8a7-972e876d510b",
    "file": "<REDACTED — local path>"
  },
  "model": {
    "provider": "pi-claude-cli",
    "id": "claude-3-5-haiku-20241022",
    "name": "Claude Haiku 3.5"
  },
  "state": {
    "activity": "waiting_input",
    "isIdle": true,
    "hasPendingMessages": false,
    "waitingForInput": true,
    "busy": false
  },
  "context": {
    "tokens": 0,
    "contextWindow": 200000,
    "percent": 0,
    "remainingTokens": 200000,
    "remainingPercent": 100,
    "pressure": "normal",
    "closeToLimit": false,
    "nearLimit": false
  },
  "routing": { "tty": "ttys003", "source": "none", "env": {} },
  "capabilities": { "hasUI": true },
  "lastEvent": "session_start"
}
```

### Snapshot schema (schemaVersion: 2)

```json
{
  "schemaVersion": 2,
  "aggregate": "working",
  "counts": { "total": 1, "working": 1, "waiting_input": 0 },
  "context": { "closeToLimit": 0, "nearLimit": 0, "atLimit": 0 },
  "sessions": { "<session-id>": { "...per-instance fields..." } },
  "instancesByPid": { "<pid>": { "...per-instance fields..." } },
  "instances": [ "...ordered array..." ]
}
```

**Privacy:** This surface captures **no message content** by design — only state, model metadata, and context pressure. Safe to expose as-is.

---

## 5. @tmustier/pi-usage-extension (already installed)

**Not a telemetry emitter** — it's a **consumer** that reads the native session JSONL files and renders a `/usage` dashboard. It reads the same `message.usage` shape documented in section 1.

**What it aggregates from the JSONL:** cost, tokens (input/output/cacheRead/cacheWrite), message count, session count — grouped by provider → model, filterable by time period (today/week/all-time).

---

## 1b. Skill loads — from the session JSONL (#2403)

pi has **no skill tool**. `--skill <dir>` lists each skill in the system prompt with its file
path and tells the model to *"use the read tool to load a skill's file"*
(`core/skills.js` → `formatSkillsForPrompt`, pi-coding-agent 0.73). So a skill load is, in the
session JSONL, an assistant message with a `toolCall` named `read`:

```json
{"type":"message","timestamp":"2026-10-24T09:32:00.000Z","message":{"role":"assistant","content":[
  {"type":"toolCall","name":"read","arguments":{"path":"/w/repo/.claude/skills/commit/SKILL.md"}}]}}
```

Mapping (`.claude/skills/loop-station/lib/skill-loads.mjs`):

| session fact | trace event |
|---|---|
| `read` of `.claude/skills/<name>/SKILL.md` or `.claude/skills/<name>.md` | `{ ts, kind: 'skill', name: '<name>', parent: 'root', depth: 0 }` |
| same read with `offset > 0` (continuation) | **not** a second event |
| `read` of a sub-doc inside a skill dir | not a skill load |
| user message containing `<skill name="X"` (a `/skill:X` expansion) | `kind: 'skill', name: 'X'` |

`name` is the inventory's skill name (dir name / filename stem, `gather.mjs`), so the usage
rollup joins to `history.jsonl` by name. Emitted: name + timestamp only — never the path's
prefix, the prompt, or any tool output. `buildPiTrace(dir, { sessionDir })` merges these with
the subagent `agent` events; a single-use worker (no subagents) now yields a trace from the
skill loads alone, where before #2403 it yielded nothing.

## Recommendation for #944 adapter

**Primary feed:** Native session JSONL (section 1) + subagent meta (section 2). These are built-in, always available, and contain everything #883's run-outcome ledger needs: `{model, provider, tokens, cost, duration, exitCode, turns}`.

**Secondary (install when ready):** pi-otel (section 3) for structured OTel traces → loop-station WS2 trace reconstruction. Use `captureContent: "metadata_only"` and point at a local OTLP collector.

**Tertiary (optional):** @jademind/pi-telemetry (section 4) for live activity monitoring (context pressure, working/idle state). Not needed for the cost ledger but useful for the status dashboard.

### Adapter shape (what #944 should emit)

```typescript
interface PiRunOutcome {
  // From subagent meta
  runId: string
  agent: string            // "worker" | "planner" | "researcher" | ...
  exitCode: number
  durationMs: number
  toolCount: number
  timestamp: number        // epoch ms

  // From usage rollup (meta or JSONL sum)
  model: string            // "<provider>/<model>" or just model ID
  provider: string
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  costUsd: number          // total cost

  // Derived
  harness: "pi"            // constant — distinguishes from claude-code-action runs
  outcome: "success" | "failure" | "error"
}
```

---

## Egress verification (#938 step 5)

| Surface | Egress? | Evidence |
|---------|---------|----------|
| Native JSONL | **No** — local filesystem only | Files at `~/.pi/agent/sessions/` |
| Subagent meta | **No** — local filesystem only | Files at `~/.pi/agent/sessions/*/subagent-artifacts/` |
| pi-otel | **No by default** — endpoint defaults to `localhost:4317` | Config in settings.json; env override `OTEL_EXPORTER_OTLP_ENDPOINT` |
| @jademind/pi-telemetry | **No** — explicitly local-only design | Files at `~/.pi/agent/telemetry/instances/`; README states "No daemon required" |
| @tmustier/pi-usage-extension | **No** — reads local JSONL only | Source reads `~/.pi/agent/sessions/` |

**Conclusion:** All surfaces are local-filesystem-only. pi-otel CAN egress if you change the endpoint, but the default is `localhost:4317` and we explicitly set it so. No SaaS, no phone-home.
