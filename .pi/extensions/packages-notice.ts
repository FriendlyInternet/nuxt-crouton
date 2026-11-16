// Packages notice (#3701) — tell the pi worker, the FIRST time it writes under `packages/<pkg>/`,
// whether its ticket approves that package, instead of letting it find out from the red
// "Packages edit declared" check after the push.
//
// The decision is `packagesApprovalFor` in scripts/packages-guard.mjs (built on the CI check's
// own `evaluatePackagesGuard`), so this file holds no rule of its own. The message is appended to
// the write's own tool result, so the worker reads it on its next step. It warns once per package
// per run, never blocks a write, never re-drives a turn, and swallows its own errors.
//
// The ticket comes from the files the worker workflow writes before pi starts:
// `$RUNNER_TEMP/issue-body.txt` + `$RUNNER_TEMP/issue-labels.json`. No body file → no ticket →
// silent (planner, reviewer and local runs).
//
// Plain type-strippable TS only (no enums / parameter properties): the test imports it directly.
import fs from "node:fs";
import path from "node:path";
import { WRITE_TOOLS } from "../../scripts/pi-edited-files.mjs";
import { packagesApprovalFor, formatPackagesNotice } from "../../scripts/packages-guard.mjs";

export const LABELS_FILE = "issue-labels.json";
export const BODY_FILE = "issue-body.txt";

export function readTicket(): { ticketBody: string; ticketLabels: string[] } | null {
  const dir = process.env.RUNNER_TEMP;
  if (!dir) return null;
  const bodyPath = path.join(dir, BODY_FILE);
  if (!fs.existsSync(bodyPath)) return null;
  let ticketLabels: string[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, LABELS_FILE), "utf8"));
    if (Array.isArray(parsed)) ticketLabels = parsed;
  } catch { /* missing labels file → [] */ }
  return { ticketBody: fs.readFileSync(bodyPath, "utf8"), ticketLabels };
}

export default function (pi: any, deps: any = { readTicket }) {
  const warned = new Set<string>();
  pi.on("tool_result", async (event: any) => {
    try {
      if (!WRITE_TOOLS.has(event?.toolName)) return undefined;
      const raw = event?.input?.path || event?.input?.file_path;
      if (typeof raw !== "string" || !raw) return undefined;
      const rel = path.relative(process.cwd(), path.resolve(process.cwd(), raw)).split(path.sep).join("/");
      const m = /^packages\/([^/]+)\//.exec(rel);
      if (!m) return undefined;
      const pkg = m[1];
      if (warned.has(pkg)) return undefined;
      const ticket = deps.readTicket();
      if (!ticket) return undefined;
      warned.add(pkg);
      const r = packagesApprovalFor({ changedFiles: [rel], ticketBody: ticket.ticketBody, ticketLabels: ticket.ticketLabels });
      console.error(`[packages-notice] ${pkg}: ${r.status} via ${r.via} (#3701)`);
      return {
        content: [...(event.content || []), { type: "text", text: formatPackagesNotice(r, pkg) }],
        structuredContent: event.structuredContent,
      };
    } catch (e: any) {
      console.error(`[packages-notice] error ${e?.message || e} — ignored`);
      return undefined;
    }
  });
}
