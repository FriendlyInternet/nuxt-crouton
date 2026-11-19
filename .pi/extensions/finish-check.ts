// Finish check (#3762, epic #3700) — before the pi worker stops, check its own diff the way CI will.
//
// WHY: a worker used to stop the moment it felt done, and Fallow / the touched tests went red in CI
// afterwards. `agent_before_settle` fires in `pi --print` once the model has said it is done (after
// complete-work's nudges), and `continue: true` really runs another turn (proved on #3762's plan).
//
// WHAT: run `scripts/finish-check.mjs --json`; if red, hand the findings back as a follow-up turn,
// at most 2 rounds (`scripts/lib/finish-check-loop.mjs` decides). Every result writes the outcome to
// $RUNNER_TEMP/finish-check-outcome.json for the run-record line. Only when FINISH_CHECK=1 (set by
// work-issue-pidev.yml outside plan mode) and never on a revise run. Any crash → settle as before.
// Skipped when PI_DEADLINE leaves under 8 minutes (#4183) — a round that late is killed mid-way.
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { decideFinishCheck, DEFAULT_CAP, MIN_LEFT_MS } from "../../scripts/lib/finish-check-loop.mjs";

// #4183: ms left before the pi step's own time limit (PI_DEADLINE, epoch seconds); undefined when unset.
const left = (): number | undefined => {
  const d = Number(process.env.PI_DEADLINE);
  return Number.isFinite(d) && d > 0 ? d * 1000 - Date.now() : undefined;
};

function runCheck(): Promise<any> {
  return new Promise((resolve) => {
    execFile(
      "node",
      ["scripts/finish-check.mjs", "--json", "--timeout", "150000"],
      { cwd: process.cwd(), timeout: 180000, maxBuffer: 16 * 1024 * 1024 },
      (_err: any, stdout: any) => {
        // Red exits 1, so stdout is read on the error path too.
        try { resolve(JSON.parse(String(stdout || ""))); } catch { resolve(null); }
      },
    );
  });
}

export default function (pi: any) {
  let rounds = 0;
  pi.on("agent_before_settle", async (event: any) => {
    try {
      if (process.env.FINISH_CHECK !== "1" || process.env.REVISE) return;
      const before = left();
      const tooLate = before !== undefined && before < MIN_LEFT_MS;
      // Re-measure after the check: it can take up to 3 minutes.
      const d = decideFinishCheck(tooLate ? null : await runCheck(), rounds, DEFAULT_CAP, left());
      if (d.outcome.last === "skipped") console.error(`[finish-check] ${d.outcome.reason} (#4183)`);
      if (process.env.RUNNER_TEMP) {
        try { writeFileSync(join(process.env.RUNNER_TEMP, "finish-check-outcome.json"), JSON.stringify(d.outcome)); } catch {}
      }
      console.error(`[finish-check] ${d.outcome.last} — ${d.action} (round ${d.outcome.rounds}, #3762)`);
      if (d.action !== "followUp") return;
      rounds = d.outcome.rounds;
      return {
        // Keep other handlers' entries (pi-subagents delivers background-run notices here).
        entries: [...(event?.entries || []), { type: "custom_message", customType: "finish-check", content: d.message, display: false }],
        continue: true,
      };
    } catch {
      return;
    }
  });
}
