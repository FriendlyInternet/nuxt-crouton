import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DENY } from './pi-edited-files.mjs';

// Build a throwaway repo dir + a fake pi session that "edits" a mix of real files, a new file,
// a runtime artifact, and a path outside the repo — then assert the ledger keeps only the real
// in-repo edits (Pattern B: include new needed files, exclude junk by construction). #1764/#1782.
test('includes modified AND newly-created files the agent wrote', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-led-'));
  const abs = (r) => path.join(root, r);
  const session = path.join(root, 's.jsonl');
  for (const r of ['packages/x/Existing.vue', 'packages/x/NewThing.vue']) {
    fs.mkdirSync(path.dirname(abs(r)), { recursive: true });
    fs.writeFileSync(abs(r), 'x');
  }
  fs.writeFileSync(
    session,
    [
      { message: { content: [{ type: 'toolCall', name: 'edit', arguments: { path: abs('packages/x/Existing.vue') } }] } },
      { message: { content: [{ type: 'toolCall', name: 'write', arguments: { path: abs('packages/x/NewThing.vue') } }] } },
    ].map((o) => JSON.stringify(o)).join('\n'),
  );
  const out = execFileSync('node', [path.join(import.meta.dirname, 'pi-edited-files.mjs'), session, root], { encoding: 'utf8' })
    .split('\n').filter(Boolean).sort();
  assert.deepEqual(out, ['packages/x/Existing.vue', 'packages/x/NewThing.vue']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('excludes .pi/ runtime, node_modules, and scratch artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-led-'));
  const abs = (r) => path.join(root, r);
  const session = path.join(root, 's.jsonl');
  const paths = ['packages/a/Real.ts', '.pi/npm/.gitignore', 'node_modules/x/index.js', 'pi-telemetry-out/trace.jsonl', 'decompose-pidev-exec-9.log'];
  for (const r of paths) { fs.mkdirSync(path.dirname(abs(r)), { recursive: true }); fs.writeFileSync(abs(r), 'x'); }
  fs.writeFileSync(session, paths.map((r) => JSON.stringify({ message: { content: [{ type: 'toolCall', name: 'edit', arguments: { path: abs(r) } }] } })).join('\n'));
  const out = execFileSync('node', [path.join(import.meta.dirname, 'pi-edited-files.mjs'), session, root], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(out, ['packages/a/Real.ts']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('excludes paths outside the repo root and non-existent files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-led-'));
  const abs = (r) => path.join(root, r);
  const session = path.join(root, 's.jsonl');
  fs.mkdirSync(path.dirname(abs('src/keep.ts')), { recursive: true });
  fs.writeFileSync(abs('src/keep.ts'), 'x');
  fs.writeFileSync(session, [
    { message: { content: [{ type: 'toolCall', name: 'edit', arguments: { path: abs('src/keep.ts') } }] } },
    { message: { content: [{ type: 'toolCall', name: 'edit', arguments: { path: '/etc/passwd' } }] } },              // outside repo
    { message: { content: [{ type: 'toolCall', name: 'edit', arguments: { path: abs('src/deleted.ts') } }] } },      // never created
    { message: { content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'echo hi' } }] } },               // not a write tool
  ].map((o) => JSON.stringify(o)).join('\n'));
  const out = execFileSync('node', [path.join(import.meta.dirname, 'pi-edited-files.mjs'), session, root], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(out, ['src/keep.ts']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('DENY keeps .pi/extensions source, drops .pi runtime and the settings.json trust profile (#3801)', () => {
  for (const p of ['.pi/extensions/finish-check.ts', '.pi/extensions/complete-work.ts']) {
    assert.equal(DENY.test(p), false, `${p} must be kept`);
  }
  for (const p of [
    '.pi/sessions/x.jsonl',
    '.pi/settings.json', // kept out because it is the CI trust profile (#2275), not because pi rewrites it
    '.pi/npm/x',
    'node_modules/x',
    'decompose-pidev-prompt-1.txt',
  ]) {
    assert.equal(DENY.test(p), true, `${p} must be dropped`);
  }
});

test('ledger includes an edited .pi/extensions file (#3801)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-led-'));
  const abs = (r) => path.join(root, r);
  const session = path.join(root, 's.jsonl');
  const paths = ['.pi/extensions/finish-check.ts', '.pi/sessions/x.jsonl'];
  for (const r of paths) { fs.mkdirSync(path.dirname(abs(r)), { recursive: true }); fs.writeFileSync(abs(r), 'x'); }
  fs.writeFileSync(session, paths.map((r) => JSON.stringify({ message: { content: [{ type: 'toolCall', name: 'edit', arguments: { path: abs(r) } }] } })).join('\n'));
  const out = execFileSync('node', [path.join(import.meta.dirname, 'pi-edited-files.mjs'), session, root], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(out, ['.pi/extensions/finish-check.ts']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('tool names are matched case-insensitively (Edit/Write/MultiEdit) — #2434', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-led-'));
  const session = path.join(root, 's.jsonl');
  fs.writeFileSync(path.join(root, 'a.ts'), 'x');
  fs.writeFileSync(session, JSON.stringify({ message: { content: [{ type: 'toolCall', name: 'Edit', arguments: { path: 'a.ts' } }] } }));
  const out = execFileSync('node', [path.join(import.meta.dirname, 'pi-edited-files.mjs'), session, root], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(out, ['a.ts']);
  fs.rmSync(root, { recursive: true, force: true });
});
