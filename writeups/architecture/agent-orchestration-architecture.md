# Agent Orchestration — Decision Brief

**Date:** 2026-06-17
**Status:** Decided (direction); levers below are open
**Context:** Evaluating where to run our agent fan-out — Claude Code + GitHub vs.
own infra (ThinkGraph/pi) — and how to keep the platform choice reversible.

## TL;DR

**Rent the orchestration, own the agents.** Run the agent fan-out on **Claude Code +
GitHub** (issues = state, Actions = runner, the `Agent` tool = fan-out, worktree
isolation + `/commit` + PR/merge = built in). Retire `retired/pocs/thinkgraph-worker` as *live
infra* — keep it as reference. Keep our value (agents, skills, prompts, MCP) in the
**portable layer** so a future move off-platform stays a weekend, not a rewrite.

## The call, and why

`retired/pocs/thinkgraph-worker` was the "everything on own infra" attempt: a pi.dev-based
agent runner (Yjs transport, dispatch server, session manager, worktree orchestration,
a multi-stage analyst→builder→reviewer→merger pipeline). It works — but ~2,000 lines of
it are **undifferentiated harness plumbing** we only had to build because we were
off-platform. GitHub + `claude-code-action` provides all of it for free. For a solo dev,
deleting that maintenance surface is the win. The GitHub-issue-driven `/task-decompose`
pipeline is the chosen path.

## Portability map (what decides "can I move later")

The lock-in question answered honestly:

| Asset | Portable? | Notes |
|---|---|---|
| **Skills** (`.claude/skills/*/SKILL.md`) | ~Fully | Markdown procedures. ThinkGraph already consumes them via `cat`; Claude via the Skill tool. Same content, different door. |
| **MCP servers** | Fully | MCP is a standard; Claude Code and pi both speak it. |
| **Agents** (`.claude/agents/*.md`) | Prompt yes, mechanism no | System-prompt body ports; spawning (Agent tool, worktree) is harness-specific. |
| **Hooks** (`settings.json`) | No — the lock-in surface | Event→command is a Claude Code feature. Re-express intent in pi's model. Few + simple. |

**Rule to stay reversible:** keep value in skills + MCP, keep hooks *thin* (enforce
policy, don't embed business logic), keep skills harness-agnostic. Do **not**
dual-implement skills/hooks in pi now — that's hedging by doubling maintenance and the
copies drift. Make portable, don't fork.

## Open levers (the two real reasons one might leave — both addressable in place)

1. **Cost** — fan-out re-pays the large `CLAUDE.md` + tool defs per spawned agent.
   Mitigate without leaving: (a) turn on **prompt caching** (biggest lever), (b) route
   the eval-type agents (orchestrator/decomposer) to a **cheaper model**.
2. **Model choice** — `claude-code-action` is Anthropic-shaped. If/when we actually want
   GLM or per-role routing, add **claude-code-router / LiteLLM** as an *optional* proxy.
   Keep it optional, not load-bearing.

Headless automation runs on the **Claude subscription** (owner decision 2026-10-29, #3121):
`claude_code_oauth_token` for `claude-code-action`, claude-bridge for pi workers. (See `.claude/skills/task-decompose` auth note.)

## ThinkGraph IP worth harvesting (then archive the infra)

- **Cloudflare-run-pi runbook** — Tunnel + `DISPATCH_SECRET` bearer ingress, systemd
  service, auth-retry-with-backoff. This is the **self-host escape-hatch playbook** if we
  ever do go off-platform. → `writeups/setup/`.
- **Gate-pipeline prompts** — analyst gate, reviewer verdicts (APPROVE/REVISE/RETHINK),
  traffic-light routing. More mature than our current LEAF-TEST-only flow; fold into
  `task-decomposer` / `task-worker`. → `.claude/agents/`.
- **Constraint** — a Raspberry Pi can host *agent sessions* but **not** builds/typecheck
  (memory); offload those to CI. Keep in the runbook.

## Known follow-ups (not done here)

- OIDC `id-token: write` job-level permission fix on the headless workflows (in progress,
  separate agent) — the headless pipeline can't run until this lands.
- `thinkgraph-worker` stale `apps/` paths (README/deploy.sh/systemd) and `--squash` merge
  (violates repo no-squash policy) — only fix if reviving the worker; otherwise archive.

## One-liner

**Own your agents, skills, and prompts — rent the orchestration.** GitHub/Claude rents
the orchestration; ThinkGraph made us own it. Keep the parts that are ours portable, and
the platform choice stays reversible.
