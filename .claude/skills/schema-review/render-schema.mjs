#!/usr/bin/env node
/**
 * schema-review renderer — turn a crouton collection schema (field-definition JSON)
 * into a human-readable artifact for sign-off BEFORE any code is generated:
 *   - an offline, self-contained HTML field table + relationships sketch
 *   - a terse Markdown table (for inline PR/issue use)
 *
 *   node render-schema.mjs <schema.json> [--collection NAME] [--out-dir DIR]
 *
 *   --collection NAME   override the collection name (else taken from the JSON)
 *   --out-dir DIR       output dir (default: writeups/schema-reviews)
 *
 * Outputs <out-dir>/<collection>.html and <out-dir>/<collection>.md, and prints the
 * Markdown to stdout. Rasterise the HTML to a PNG with the SHARED renderer from #308:
 *   node .claude/skills/ui-proposal/render.mjs <out-dir>/<collection>.html \
 *        screenshots/schema-review-<collection>.png
 *
 * Dependency-free Node (mirrors epic-digest's render.mjs).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const argv = process.argv.slice(2)
function opt(flag, def) {
  const i = argv.indexOf(flag)
  if (i === -1) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
let outDir = opt('--out-dir', 'writeups/schema-reviews')
const collectionOverride = opt('--collection', null)
const [input] = argv.filter((a) => !a.startsWith('--'))

if (!input) {
  console.error('Usage: render-schema.mjs <schema.json> [--collection NAME] [--out-dir DIR]')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(resolve(input), 'utf8'))

// ── Normalise: accept { collection, fields:{} } | { fields:{} } | flat {name:def} ──
const collection =
  collectionOverride || raw.collection || raw.name || raw.collectionName || 'collection'
const fieldsObj = raw.fields && typeof raw.fields === 'object' ? raw.fields : raw

function isFieldDef(def) {
  return def && typeof def === 'object' && (def.type || def.refTarget || def.meta || def.properties)
}

function typeLabel(def) {
  const meta = def.meta || {}
  let t = def.type || 'string'
  if (t === 'decimal' && (meta.precision || meta.scale)) {
    t += `(${meta.precision ?? '?'},${meta.scale ?? 0})`
  }
  if (meta.displayAs === 'optionsSelect') {
    if (Array.isArray(meta.options)) t = `select [${meta.options.join(', ')}]`
    else if (meta.optionsCollection) t = `select ← ${meta.optionsCollection}.${meta.optionsField ?? '?'}`
  }
  if (t === 'repeater' && Array.isArray(def.translatableProperties)) {
    t = `repeater {${Object.keys(def.properties || {}).join(', ')}}`
  }
  return t
}

const rows = []
for (const [name, def] of Object.entries(fieldsObj)) {
  if (!isFieldDef(def)) continue
  const meta = def.meta || {}
  rows.push({
    name,
    type: typeLabel(def),
    required: !!(meta.required ?? def.required),
    translatable: !!(def.translatable ?? meta.translatable ?? def.translatableProperties?.length),
    primaryKey: !!meta.primaryKey,
    unique: !!meta.unique,
    default: meta.default ?? def.default ?? '',
    refTarget: def.refTarget || '',
    refScope: def.refScope || '',
    // A field that DECLARES a relation but names no target (#1933-adjacent, the #1825 case).
    // This is the whole point of the gate: it is the one detail that makes a relation
    // buildable, and it was previously invisible here — see `unresolved` below.
    unresolvedRef: isRelationType(def) && !def.refTarget,
  })
}

/** Does this field's TYPE declare a relation, regardless of whether a target was given? */
function isRelationType(def) {
  const t = String(def.type || '').toLowerCase()
  return t === 'relation' || t === 'reference' || t === 'belongsto' || t === 'ref'
}

const relations = rows.filter((r) => r.refTarget)

// ── UNRESOLVED REFERENCES (#1825) ─────────────────────────────────────────────────
// The failure this exists to stop: `chores` was approved with `assignee (relation)` and
// `lastDoneBy (relation)` and NO target on either. Because the relationship summary was
// built as `rows.filter(r => r.refTarget)`, both dropped out and the sign-off rendered
// "_No relationships._" — so there was nothing on screen to question. Downstream each step
// made the hole more concrete without checking it: the build instruction invented the prose
// "references household members/users", the worker turned that into `refTarget: "users"`,
// and the generated import pointed at a collection nobody ever created. The build died
// minutes later with 400 lines of module paths and no mention of the cause.
//
// So an untargeted relation is reported LOUDLY and never counted as "no relationships".
// It is deliberately NOT a hard exit by default: this renderer is called by the decompose
// apply step inside a best-effort guard, so exiting non-zero would SKIP the whole artifact
// and post the sign-off questions with no schema at all — hiding the problem again, worse.
// Visibility at approval time is the fix. Use --strict for a hard gate (see below).
const unresolved = rows.filter((r) => r.unresolvedRef)
const strict = argv.includes('--strict')

// ── Markdown ──
const yn = (b) => (b ? '✓' : '')
const md = [
  `### Schema review — \`${collection}\``,
  '',
  `${rows.length} field${rows.length === 1 ? '' : 's'}${relations.length ? ` · ${relations.length} relationship${relations.length === 1 ? '' : 's'}` : ''}`,
  '',
  '| Field | Type | Required | Translatable | Default | → References |',
  '|---|---|:--:|:--:|---|---|',
  ...rows.map(
    (r) =>
      `| \`${r.name}\`${r.primaryKey ? ' 🔑' : ''}${r.unique ? ' ·uniq' : ''} | ${r.type} | ${yn(r.required)} | ${yn(r.translatable)} | ${r.default === '' ? '' : `\`${r.default}\``} | ${r.refTarget ? `\`${r.refTarget}\`${r.refScope ? ` (${r.refScope})` : ''}` : r.unresolvedRef ? '⚠️ **not set**' : ''} |`,
  ),
  '',
  ...(unresolved.length
    ? [
        `> ⚠️ **${unresolved.length} relation field${unresolved.length === 1 ? '' : 's'} with no target — do not approve as-is.**`,
        '>',
        ...unresolved.map(
          (r) => `> - \`${collection}.${r.name}\` says it points at another collection, but doesn't say which.`,
        ),
        '>',
        '> Whatever fills this blank later is a **guess**. Name the collection each one points at,',
        '> and make sure that collection is actually being built — a target that does not exist',
        '> generates an import to a missing file and fails the build, long after this decision.',
        '> If people are meant to be the target, say so explicitly: they come from the auth/team',
        '> side here, not from a generated collection, so this may need a different field type.',
        '',
      ]
    : []),
  relations.length
    ? `**Relationships:** ${relations.map((r) => `\`${collection}.${r.name}\` → \`${r.refTarget}\``).join(' · ')}`
    : unresolved.length
      ? `_No **resolved** relationships — ${unresolved.length} unresolved above._`
      : '_No relationships._',
  '',
].join('\n')

// ── HTML (offline, self-contained — same dark palette as ui-proposal) ──
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const chip = (on, label) =>
  on ? `<span class="chip on">${label}</span>` : `<span class="chip">·</span>`

const rowHtml = rows
  .map(
    (r) => `      <tr>
        <td class="fname">${esc(r.name)}${r.primaryKey ? '<span class="pk" title="primary key">🔑</span>' : ''}${r.unique ? '<span class="u" title="unique">uniq</span>' : ''}</td>
        <td><code>${esc(r.type)}</code></td>
        <td class="c">${chip(r.required, 'req')}</td>
        <td class="c">${chip(r.translatable, 'i18n')}</td>
        <td>${r.default === '' ? '<span class="muted">—</span>' : `<code>${esc(r.default)}</code>`}</td>
        <td>${r.refTarget ? `<span class="ref">→ ${esc(r.refTarget)}</span>${r.refScope ? ` <span class="muted">(${esc(r.refScope)})</span>` : ''}` : r.unresolvedRef ? '<span class="warn">⚠ not set</span>' : '<span class="muted">—</span>'}</td>
      </tr>`,
  )
  .join('\n')

const relHtml = relations.length
  ? relations
      .map(
        (r) =>
          `<li><code>${esc(collection)}.${esc(r.name)}</code> <span class="arrow">→</span> <code>${esc(r.refTarget)}</code>${r.refScope ? ` <span class="muted">(${esc(r.refScope)})</span>` : ''}</li>`,
      )
      .join('\n')
  : unresolved.length
    ? `<li class="warn">⚠ ${unresolved.length} relation field${unresolved.length === 1 ? '' : 's'} with NO target — ${unresolved.map((r) => `<code>${esc(r.name)}</code>`).join(', ')}. Name what each points at before approving; whatever fills the blank later is a guess.</li>`
    : '<li class="muted">No relationships — this collection stands alone.</li>'

const html = `<!DOCTYPE html>
<!-- schema-review — generated by .claude/skills/schema-review/render-schema.mjs. No JS/CDN. -->
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Schema review — ${esc(collection)}</title>
<style>
  :root{--page:#0a0e17;--ink:#e8edf6;--muted:#8b97ad;--card:#151b27;--card-2:#11161f;
    --line:#222b3a;--green:#34d399;--green-d:#0e3a2a;}
  *{box-sizing:border-box;}
  body{margin:0;background:radial-gradient(1100px 500px at 75% -10%,#16213c 0%,var(--page) 55%);
    color:var(--ink);line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:900px;margin:0 auto;padding:36px 22px 60px;}
  .eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:12px;color:var(--green);font-weight:700;}
  h1{font-size:30px;margin:6px 0 2px;}
  h1 code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.8em;background:rgba(52,211,153,.12);color:#a9f0d2;padding:2px 10px;border-radius:8px;}
  .lede{color:var(--muted);font-size:14px;margin:0 0 24px;}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);font-size:13.5px;vertical-align:top;}
  th{background:var(--card-2);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-size:11px;}
  td.c{text-align:center;} tr:last-child td{border-bottom:none;}
  .fname{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:600;color:#fff;}
  .pk{margin-left:6px;} .u{margin-left:6px;font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:0 4px;font-family:inherit;}
  code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;color:#cdd6e6;}
  .chip{display:inline-block;min-width:34px;font-size:11px;color:var(--muted);}
  .chip.on{color:#04231a;background:var(--green);font-weight:700;border-radius:999px;padding:1px 8px;}
  .warn{color:#fbbf24;font-weight:600}
    .ref{color:var(--green);} .arrow{color:var(--muted);} .muted{color:var(--muted);}
  h3{margin:28px 0 10px;font-size:15px;}
  .rel{background:#101725;border:1px solid var(--line);border-radius:14px;padding:14px 18px;}
  .rel ul{margin:0;padding:0;list-style:none;display:grid;gap:8px;font-size:13.5px;}
  footer{margin-top:26px;color:var(--muted);font-size:12px;text-align:center;}
</style></head>
<body><div class="wrap">
  <span class="eyebrow">nuxt-crouton · schema review</span>
  <h1>Collection <code>${esc(collection)}</code></h1>
  <p class="lede">${rows.length} field${rows.length === 1 ? '' : 's'}${relations.length ? ` · ${relations.length} relationship${relations.length === 1 ? '' : 's'}` : ''} — review the data model before generating Form / List / API / migration.</p>
  <table>
    <thead><tr><th>Field</th><th>Type</th><th>Req</th><th>i18n</th><th>Default</th><th>References</th></tr></thead>
    <tbody>
${rowHtml}
    </tbody>
  </table>
  <h3>Relationships</h3>
  <div class="rel"><ul>
${relHtml}
  </ul></div>
  <footer>Schema review · generated offline · approve the fields, then generate the collection.</footer>
</div></body></html>
`

mkdirSync(resolve(outDir), { recursive: true })
const htmlPath = join(outDir, `${collection}.html`)
const mdPath = join(outDir, `${collection}.md`)
writeFileSync(resolve(htmlPath), html)
writeFileSync(resolve(mdPath), md)

console.log(md)
console.log(`\n✓ HTML → ${htmlPath}`)
console.log(`✓ MD   → ${mdPath}`)
console.log(
  `→ PNG:  node .claude/skills/ui-proposal/render.mjs ${htmlPath} screenshots/schema-review-${collection}.png`,
)

// --strict (#1825): exit non-zero when a relation names no target, for callers that want a
// HARD gate (a pre-generate check, CI). Off by default on purpose — the decompose apply step
// calls this inside a best-effort guard, where a non-zero exit would drop the whole schema
// artifact from the sign-off comment and hide the very problem this reports.
if (strict && unresolved.length) {
  console.error(
    `\n✖ ${unresolved.length} relation field${unresolved.length === 1 ? '' : 's'} with no target: ` +
      `${unresolved.map((r) => `${collection}.${r.name}`).join(', ')}\n` +
      `  Name the collection each points at, and make sure that collection is actually built — ` +
      `an unresolved target generates an import to a missing file and fails the build later.`,
  )
  process.exit(1)
}
