// finish-check-loop.mjs — what the pi worker does with a finish-check result (#3762, epic #3700).
//
// Pure, no I/O. `.pi/extensions/finish-check.ts` runs `scripts/finish-check.mjs --json` when pi is
// about to stop, then asks `decideFinishCheck` whether to hand the findings back for another round
// (`followUp`) or let the run end (`end`). `outcome` is written to $RUNNER_TEMP and becomes the
// "finish check: …" line on the run record (scripts/run-record.mjs `finish-check-line`).
//
// Rules: only `red` hands back, at most `cap` times. Anything that is not `red`/`green` (null, a
// parse failure, a timeout, `not-run`) counts as `not-run` and never hands back.

export const DEFAULT_CAP = 2;
const MAX_LISTED = 20;
// Built from parts so this file does not itself read as adding an ignore comment.
const IGNORE_WORD = 'fallow' + '-ignore';

export function followUpMessage(result, round, cap = DEFAULT_CAP) {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const listed = findings.slice(0, MAX_LISTED).map((f) => {
    const where = f?.line != null ? `${f?.file}:${f.line}` : `${f?.file}`;
    return `- ${where} — ${f?.message ?? ''}`;
  });
  if (findings.length > MAX_LISTED) listed.push(`- …and ${findings.length - MAX_LISTED} more`);
  return [
    `FINISH CHECK — round ${round} of ${cap}: the files you changed would go red in CI.`,
    '',
    ...(listed.length ? listed : ['- (no individual findings listed)']),
    ...(result?.reason ? ['', `Reason: ${result.reason}`] : []),
    '',
    'Fix the cause in the code. Never suppress it: no ' + IGNORE_WORD + ' comments, no raised ' +
      'thresholds or edited baseline files, no skipped or .todo tests.',
    'When you are done fixing, end your reply with exactly: PI_TASK_COMPLETE_NOTHING_LEFT',
  ].join('\n');
}

export function decideFinishCheck(result, roundsSoFar, cap = DEFAULT_CAP) {
  const raw = result?.status;
  const status = raw === 'red' || raw === 'green' ? raw : 'not-run';
  if (status === 'red' && roundsSoFar < cap) {
    const rounds = roundsSoFar + 1;
    return {
      action: 'followUp',
      message: followUpMessage(result, rounds, cap),
      outcome: { ran: true, rounds, last: 'red' },
    };
  }
  return {
    action: 'end',
    outcome: { ran: status !== 'not-run' || roundsSoFar > 0, rounds: roundsSoFar, last: status },
  };
}
