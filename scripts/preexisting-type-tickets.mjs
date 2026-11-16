#!/usr/bin/env node
// preexisting-type-tickets.mjs — ticket the type errors a PR did NOT cause (#3249, epic #3247).
//
// WHY. The pi finish step used to FAIL a PR on any type error anywhere in the touched app, so an
// old error in a file the PR never touched held a good PR as a draft (#3245, held on
// signin-link.post.ts). `pi-finish.mjs typecheck` now passes those, and writes them out as groups
// (one per file + TS code, each with a stable `<!-- preexisting-type-error:… -->` marker). This
// script makes sure each group is tracked exactly once: comment on an open ticket that already
// carries the marker, otherwise open a new `type:fix` ticket (at most 3 per run).
//
// The decisions (`scopeLabel`, `ticketBody`, `planTickets`) are pure and tested; the CLI below is
// a thin `gh` wrapper that ALWAYS exits 0 — it runs inside the finish step under `set -e`, after
// the PR exists, and a ticketing hiccup must never take the run down.
//
//   preexisting-type-tickets.mjs --groups <groups.json> --pr <n> --app <app-dir>
//     → prints `LINE=<run-record line>` (formatAcceptanceLine)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatAcceptanceLine } from './pi-finish.mjs';

// `apps/x` → `app:x`, `pocs/x` → `poc:x`, anything else → null (no scope label).
export function scopeLabel(appDir) {
  const m = /^(apps|pocs)\/([^/]+)\/?$/.exec(String(appDir || '').trim());
  if (!m) return null;
  return `${m[1] === 'apps' ? 'app' : 'poc'}:${m[2]}`;
}

export function ticketTitle(group) {
  return `fix: ${group.code} in ${group.file}`;
}

// A short fix ticket. The marker is the LAST line — it is what the next run matches on.
export function ticketBody({ group, prUrl, appDir } = {}) {
  const lines = (group.errors || []).slice(0, 10)
    .map((e) => `${e.file}(${e.line},${e.col}): ${e.code} ${e.text}`);
  const more = (group.errors || []).length > 10 ? `\n…and ${group.errors.length - 10} more` : '';
  return [
    '## 👤 For humans',
    '',
    `\`${group.file}\` has ${group.count} type error(s) (${group.code}) that were already there before the PR that found them. They don't block that PR; this ticket tracks fixing them${appDir ? ` in \`${appDir}\`` : ''}.`,
    '',
    '```',
    ...lines,
    '```' + more,
    '',
    `Found by: ${prUrl || '(unknown PR)'}`,
    '',
    group.marker,
  ].join('\n');
}

// → { comment: [{ issue, group }], open: [group], rest: [group] }.
// An open issue whose body has the marker gets a comment — unless it already links THIS PR (it was
// opened/commented for an earlier revision of the same PR), then the group is skipped entirely.
// Unmatched groups fill `open` up to `maxNew`; the overflow goes to `rest`.
export function planTickets({ groups = [], openIssues = [], prNumber, maxNew = 3 } = {}) {
  const comment = [];
  const open = [];
  const rest = [];
  const prLink = prNumber ? `/pull/${prNumber}` : null;
  for (const group of groups) {
    const match = openIssues.find((i) => String(i.body || '').includes(group.marker));
    if (match) {
      if (prLink && String(match.body || '').includes(prLink)) continue;
      comment.push({ issue: match.number, group });
    } else if (open.length < maxNew) {
      open.push(group);
    } else {
      rest.push(group);
    }
  }
  return { comment, open, rest };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────
function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || r.error?.message || '').trim() };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let groups = [];
  const numbers = [];
  let rest = [];
  try {
    groups = JSON.parse(fs.readFileSync(argValue(argv, '--groups'), 'utf8'));
    if (!Array.isArray(groups)) groups = [];
    const prNumber = argValue(argv, '--pr');
    const appDir = argValue(argv, '--app') || '';
    const repo = process.env.GITHUB_REPOSITORY;
    const prUrl = repo && prNumber ? `https://github.com/${repo}/pull/${prNumber}` : (prNumber ? `#${prNumber}` : '');
    // Match the marker LOCALLY: GitHub search does not reliably index HTML comments or the
    // `[]()` characters in Nuxt route paths.
    const list = gh(['issue', 'list', '--state', 'open', '--label', 'type:fix', '--limit', '300', '--json', 'number,body']);
    let openIssues = [];
    if (list.ok) {
      try { openIssues = JSON.parse(list.out || '[]'); } catch { openIssues = []; }
    } else {
      console.error(`::warning::preexisting-type-tickets: could not list open issues (${list.err}) — new tickets may duplicate`);
    }
    const plan = planTickets({ groups, openIssues, prNumber, maxNew: 3 });
    rest = plan.rest;
    const scope = scopeLabel(appDir);
    for (const group of plan.open) {
      const base = ['issue', 'create', '--title', ticketTitle(group), '--body', ticketBody({ group, prUrl, appDir }), '--label', 'type:fix'];
      let r = gh(scope ? [...base, '--label', scope] : base);
      if (!r.ok && scope) {
        console.error(`::warning::preexisting-type-tickets: create with label ${scope} failed (${r.err}) — retrying with type:fix only`);
        r = gh(base);
      }
      const n = r.ok ? (/\/issues\/(\d+)/.exec(r.out) || [])[1] : null;
      if (n) numbers.push(Number(n));
      else console.error(`::warning::preexisting-type-tickets: could not open a ticket for ${group.file}:${group.code} (${r.err})`);
    }
    for (const { issue, group } of plan.comment) {
      const r = gh(['issue', 'comment', String(issue), '--body', `Seen again in ${prUrl} (${group.count} × ${group.code} in \`${group.file}\`).`]);
      if (r.ok) numbers.push(Number(issue));
      else console.error(`::warning::preexisting-type-tickets: could not comment on #${issue} (${r.err})`);
    }
  } catch (e) {
    console.error(`::warning::preexisting-type-tickets: ${e.message}`);
  }
  const count = groups.reduce((s, g) => s + (Number(g.count) || 0), 0);
  process.stdout.write(`LINE=${formatAcceptanceLine({ count, issueNumbers: numbers, rest })}\n`);
}
