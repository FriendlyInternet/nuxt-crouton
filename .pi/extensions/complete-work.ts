// Completion enforcer (#1764) — make pi FINISH its own work instead of narrating it.
//
// WHY: pi's agent loop (@earendil-works/pi-agent-core `agent-loop.js` L113-169) ends the instant
// the model returns an assistant turn with ZERO tool calls. In `--print` there is no steering
// queue to re-drive it, so when the model narrates its next action as prose — "Committing now via
// /commit", "Proceeding to open the PR", "No response requested." — and ends the turn, the whole
// run stops with the work uncommitted. Measured at ~96% of worker runs (#1764). No built-in
// setting makes pi run-to-completion, and ralph-wiggum can't help (it re-drives only when the
// model calls its own tool — the exact thing failing here).
//
// WHAT: hook `turn_end`; if a turn made no tool call and the task isn't declared complete,
// re-inject a follow-up (`deliverAs: "followUp"` — proven to re-drive the loop in `--print`)
// telling the model to PERFORM the action, not narrate it. Bounded by MAX; the model ends
// cleanly by emitting the DONE sentinel. A turn that DID call a tool resets the counter, so a
// normal multi-tool run is never touched — the hook only ever fires on a genuinely tool-less turn.
//
// LOADS ONLY WHEN THE PROJECT IS TRUSTED — the pidev workflows pass `--approve` (#1782), which is
// also what makes the lean `.pi/settings.json` CI profile apply.
const DONE = "PI_TASK_COMPLETE_NOTHING_LEFT";
const MAX = Number(process.env.PI_COMPLETE_MAX_NUDGES || 4);

export default function (pi: any) {
  let nudges = 0;
  const textOf = (m: any): string =>
    m && Array.isArray(m.content)
      ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
      : "";

  pi.on("turn_end", async (event: any) => {
    // A turn that called a tool is real progress — reset and let the loop continue naturally.
    if (event.toolResults && event.toolResults.length > 0) { nudges = 0; return; }
    const text = textOf(event.message);
    if (text.includes(DONE)) return;                       // model declared genuine completion
    if (nudges >= MAX) {
      console.error(`[complete-work] cap ${MAX} reached — letting the run end (#1764)`);
      return;                                              // hand off to the workflow's deterministic finish backstop
    }
    nudges++;
    console.error(`[complete-work] tool-less turn — re-driving (nudge ${nudges}/${MAX}, #1764)`);
    pi.sendUserMessage(
      `You ended your turn WITHOUT calling any tool, but the task is not verifiably complete. ` +
      `Do NOT describe or announce your next action — PERFORM it now by calling the appropriate tool ` +
      `(run the git commit, open the PR, etc.). If — and only if — the task is genuinely and fully ` +
      `complete with nothing left to do, reply with exactly: ${DONE}`,
      { deliverAs: "followUp" }
    );
  });
}
