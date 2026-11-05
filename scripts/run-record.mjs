#!/usr/bin/env node
// run-record.mjs — what a red pi-worker run leaves behind for an agent reviewer (#2464).
//
// An agent session can reach neither job logs nor previews, so the run must carry its own
// diagnosis in places the check-runs API serves: annotations and an artifact.
//
//   run-record.mjs last-message <session-dir> [max]  → pi's last assistant text (≤max chars)
//   run-record.mjs annotate <log> <title>            → one ::error:: with the last 40 lines
//   run-record.mjs record <log> <issue> <step> <exit> → run-record JSON on stdout
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Annotation data must escape %, CR, LF — a raw newline would end the command.
export function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function tailLines(text, n = 40) {
  const lines = String(text ?? '').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-n);
}

// GitHub caps error annotations at 10 per step, so the tail is ONE annotation, newline-joined.
export function errorAnnotation(title, text, n = 40) {
  const tail = tailLines(text, n);
  if (!tail.length) return `::error title=${title}::(no output captured)`;
  return `::error title=${title}::${escapeData(tail.join('\n'))}`;
}

export function buildRecord({ issue, step, exit, text, n = 40 }) {
  return { issue: Number(issue), step, exit: Number(exit), tail: tailLines(text, n) };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

// Last assistant record with non-empty text in a session JSONL; '' if none. Never throws on
// a missing file or a corrupt line — it runs on the failure path.
export function lastAssistantMessage(jsonlPath, max = 500) {
  let raw;
  try { raw = fs.readFileSync(jsonlPath, 'utf8'); } catch { return ''; }
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let rec;
    try { rec = JSON.parse(lines[i]); } catch { continue; }
    const msg = rec && rec.message;
    if (!msg || msg.role !== 'assistant') continue;
    const t = textOf(msg.content).trim();
    if (t) return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
  return '';
}

export function newestSessionFile(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch { return null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  const readLog = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  if (cmd === 'last-message') {
    const f = newestSessionFile(a);
    process.stdout.write(f ? lastAssistantMessage(f, Number(b) || 500) : '');
  } else if (cmd === 'annotate') {
    console.log(errorAnnotation(b || 'failing step', readLog(a)));
  } else if (cmd === 'record') {
    console.log(JSON.stringify(buildRecord({ issue: b, step: c, exit: d, text: readLog(a) }), null, 2));
  } else {
    console.error('usage: run-record.mjs last-message <dir> [max] | annotate <log> <title> | record <log> <issue> <step> <exit>');
    process.exit(2);
  }
}
