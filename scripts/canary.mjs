#!/usr/bin/env node
// canary.mjs — assert a worker-pipeline canary run produced what it was supposed to (#1878).
//
// WHY. The pi worker pipeline could only ever be tested by labelling a REAL ticket and watching
// (#1876 found three defects that way, in production, after weeks of green CI). A canary is a
// fixed, re-runnable issue whose correct outcome is known in advance, so "does the pipeline still
// work?" becomes a command instead of an afternoon.
//
// Assertions are MECHANICAL — no LLM judgement anywhere. Each one compares an observed shape
// (fetched by the workflow via `gh`) against a spec. That constraint is the point: a canary whose
// verdict needs interpretation is just another thing to argue with.
//
// Two failure CLASSES, and the rig must cover both (the #1876/#1885 lesson):
//   • HARNESS failure  — the pipeline breaks (no PR, dropped file, crashed step)
//   • WORKER-OUTPUT failure — the pipeline runs perfectly and still ships something incomplete
//     (#1885: pi shipped #1875's code with none of its five agreed tests, all checks green)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The observed shape of one canary run, as the workflow can cheaply gather it:
 *   { pr: { number, draft, changedFiles: string[], body } | null,
 *     runRecord: string,        // the worker's run-record comment, '' if none
 *     issueComments: string[] } // comments added during the run
 */

// Every supported assertion. Keeping them in one table (rather than scattered ifs) means the spec
// file can only ask for something implemented — an unknown key is a loud error, not a silent pass,
// which is how a "green" canary suite quietly stops checking anything.
export const ASSERTIONS = {
  // A PR exists at all. The #1876 headline: work committed and pushed, no PR opened.
  prOpened: (obs, want) => ({
    ok: Boolean(obs.pr) === want,
    detail: obs.pr ? `PR #${obs.pr.number}` : 'no PR'
  }),

  // Draft state. Used both ways: a red/testless canary MUST be draft, a healthy one must NOT.
  draft: (obs, want) => ({
    ok: Boolean(obs.pr?.draft) === want,
    detail: obs.pr ? `draft=${Boolean(obs.pr.draft)}` : 'no PR'
  }),

  // Exact file count. The #1876 dropped-file bug reported 3 and committed 2 — a count is the
  // cheapest assertion that catches it.
  changedFileCount: (obs, want) => ({
    ok: (obs.pr?.changedFiles?.length ?? -1) === want,
    detail: `${obs.pr?.changedFiles?.length ?? 0} file(s)`
  }),

  // Named files present. Stronger than a count where a specific file is the whole point
  // (#1874's nl.json was the only file that mattered and the only one dropped).
  filesInclude: (obs, want) => {
    const have = obs.pr?.changedFiles || [];
    const missing = want.filter((w) => !have.some((h) => h === w || h.endsWith(`/${w}`)));
    return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'all present' };
  },

  // At least one committed file matches — for "a test file exists" without naming it.
  filesMatch: (obs, want) => {
    const re = new RegExp(want);
    const hit = (obs.pr?.changedFiles || []).filter((f) => re.test(f));
    return { ok: hit.length > 0, detail: hit.length ? `matched: ${hit.join(', ')}` : `no file matches /${want}/` };
  },

  // A substring the run record must carry — e.g. 'tests: MISSING' (#1885), or the acceptance verdict.
  runRecordIncludes: (obs, want) => ({
    ok: (obs.runRecord || '').includes(want),
    detail: (obs.runRecord || '').includes(want) ? `found "${want}"` : `run record lacks "${want}"`
  }),

  // A substring that must NOT appear anywhere the owner reads. The #1876 misdiagnosis
  // ("the issue is likely underspecified") is the canonical one — a canary that passes while
  // the pipeline lies about WHY is not passing.
  commentsExclude: (obs, want) => {
    const all = [obs.runRecord || '', ...(obs.issueComments || [])].join('\n');
    return { ok: !all.includes(want), detail: all.includes(want) ? `found forbidden "${want}"` : `absent` };
  }
};

/** Run one canary's assertions against its observation. Pure. */
export function checkCanary(spec, observed) {
  const results = [];
  for (const [key, want] of Object.entries(spec.expect || {})) {
    const fn = ASSERTIONS[key];
    if (!fn) {
      results.push({ key, ok: false, detail: `unknown assertion "${key}" — spec asks for something unimplemented` });
      continue;
    }
    const { ok, detail } = fn(observed, want);
    results.push({ key, ok, detail });
  }
  return { id: spec.id, issue: spec.issue, ok: results.every((r) => r.ok), results };
}

/** Roll several canaries up. `ok` is all-or-nothing — a rig that "mostly passes" tells you nothing. */
export function checkAll(specs, observations) {
  const rows = specs.map((s) => checkCanary(s, observations[s.id] || {}));
  return { ok: rows.every((r) => r.ok), rows };
}

/** Render the table a human actually reads. */
export function renderReport({ ok, rows }) {
  const lines = [`### ${ok ? '✅' : '🔴'} Canary rig — ${rows.filter((r) => r.ok).length}/${rows.length} passed`, ''];
  for (const r of rows) {
    lines.push(`${r.ok ? '✅' : '🔴'} **${r.id}** (#${r.issue})`);
    for (const a of r.results) lines.push(`  - ${a.ok ? '·' : '✗'} \`${a.key}\` — ${a.detail}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specPath, obsPath] = process.argv.slice(2);
  if (!specPath || !obsPath) {
    console.error('usage: canary.mjs <canaries.json> <observations.json>');
    process.exit(2);
  }
  const specs = JSON.parse(fs.readFileSync(specPath, 'utf8')).canaries || [];
  const observations = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
  const report = checkAll(specs, observations);
  console.log(renderReport(report));
  // Non-zero on failure — this one SHOULD fail loudly; it is the check, not a probe inside a
  // step that must survive (the opposite of pi-finish.mjs's contract).
  process.exit(report.ok ? 0 : 1);
}
