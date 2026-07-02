# Progress Tracker

> ⚠️ **Superseded (kept for history).** Everything below tracks the ThinkGraph MCP
> initiative — the `thinkgraph` app has since been **retired**, so this is not a live
> tracker. Work is tracked as **GitHub issues/epics** (root `CLAUDE.md` → GitHub Issue
> Tracking); this file is only an *optional* phase-level rollup when one is kept current.

## Current Initiative: ThinkGraph MCP Integration (Phase 1)

**Goal:** Complete the MCP read-write loop so external AI agents can fully interact with ThinkGraph.
**Decision log:** `.claude/memory/project_thinkgraph_mcp_plan.md`
**Friction log:** `apps/thinkgraph/docs/friction-log.md`

### Phase 1 Tasks

#### [x] ✅ 1. Add `store-artifact` MCP tool
**What:** MCP tool that attaches artifacts (images, code, diagrams, URLs) to existing nodes via the artifacts JSON field.
**Where:**
- New file: `apps/thinkgraph/server/mcp/tools/store-artifact.ts`
- Reference: existing artifact type in `apps/thinkgraph/layers/thinkgraph/collections/decisions/types.ts`
- Reference: how dispatch services store artifacts in `apps/thinkgraph/server/utils/dispatch-services/` (any service)
- Update query if needed: `apps/thinkgraph/layers/thinkgraph/collections/decisions/server/database/queries.ts`
**Done when:** Can attach an artifact to an existing node via MCP tool call. Artifact appears in node's artifacts array. Verified with a test call.

#### [x] ✅ 2. Add `update-node` MCP tool
**What:** MCP tool to update node properties: content, nodeType, starred, pathType, branchName.
**Where:**
- New file: `apps/thinkgraph/server/mcp/tools/update-node.ts`
- Reference: existing PATCH endpoint `apps/thinkgraph/layers/thinkgraph/collections/decisions/server/api/teams/[id]/thinkgraph-decisions/[decisionId].patch.ts`
- Reference: existing `create-node.ts` for tool structure
**Done when:** Can update a node's content, type, and starred status via MCP. Changes persist and are visible in get-thinking-path.

#### [ ] 3. Two-week friction log
**What:** Use ThinkGraph via MCP (Claude Code + Claude Desktop) for real thinking work. Log friction points.
**Where:** `apps/thinkgraph/docs/friction-log.md`
**Done when:** At least 10 friction log entries over 2 weeks. Review entries and decide Phase 2 priorities.
