#!/usr/bin/env node
/**
 * Generate writeups/architecture/skills-and-triggers.html from .claude/skills/.
 *
 *   node scripts/gen-skills-doc.mjs            # write the html
 *   node scripts/gen-skills-doc.mjs --check    # exit 1 if the html is stale (CI)
 *
 * Source of truth: each skill's SKILL.md (or top-level *.md) frontmatter — name +
 * description. Grouping + trigger-type come from the small META map below (frontmatter
 * doesn't carry those). A skill missing from META lands in "⚠️ Uncategorised" so new
 * skills are never silently dropped. Run it whenever .claude/skills/ changes
 * (sync-docs does this before /commit; CI enforces it).
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, '.claude/skills')
const OUT = join(ROOT, 'writeups/architecture/skills-and-triggers.html')

// group + trigger-type per skill (name → meta). Triggers: auto | ask | flow.
// Exported as the single source of truth — the skills-digest (.claude/skills/skills-digest)
// imports META/GROUPS/TRIG/discover() from here so the two can never drift (#841).
export const META = {
  crouton: { group: 'build', triggers: ['ask'] },
  'ui-proposal': { group: 'build', triggers: ['flow', 'ask'] },
  'schema-review': { group: 'build', triggers: ['flow', 'ask'] },
  'test-review': { group: 'build', triggers: ['flow', 'ask'] },
  'task-decompose': { group: 'build', triggers: ['ask', 'flow'] },
  'provider-swap': { group: 'build', triggers: ['ask'] },
  'block-authoring': { group: 'build', triggers: ['ask', 'flow'] },
  'github-tasks': { group: 'plan', triggers: ['ask', 'flow'] },
  'epic-digest': { group: 'plan', triggers: ['ask'] },
  housekeeping: { group: 'plan', triggers: ['ask'] },
  'skills-digest': { group: 'plan', triggers: ['ask'] },
  'ticket-diagram': { group: 'plan', triggers: ['flow', 'ask'] },
  'ecosystem-check': { group: 'plan', triggers: ['ask'] },
  'sync-docs': { group: 'commit', triggers: ['auto'] },
  'i18n-check': { group: 'commit', triggers: ['auto'] },
  commit: { group: 'commit', triggers: ['ask'] },
  review: { group: 'review', triggers: ['ask'] },
  audit: { group: 'review', triggers: ['ask'] },
  'i18n-audit': { group: 'review', triggers: ['ask'] },
  postmortem: { group: 'review', triggers: ['flow', 'ask'] },
  'bug-archaeology': { group: 'review', triggers: ['flow', 'ask'] },
  'red-team': { group: 'review', triggers: ['ask', 'auto'] },
  a11y: { group: 'review', triggers: ['ask'] },
  'frontend-review': { group: 'review', triggers: ['ask', 'auto'] },
  deploy: { group: 'deploy', triggers: ['ask'] },
  'deploy-production': { group: 'deploy', triggers: ['ask'] },
  'poc-deploy': { group: 'deploy', triggers: ['ask'] },
  'remove-app': { group: 'deploy', triggers: ['ask'] },
  'e2e-smoke': { group: 'verify', triggers: ['ask'] },
  'dependency-sweep': { group: 'verify', triggers: ['ask', 'auto'] },
  'db-migrations': { group: 'verify', triggers: ['ask'] },
  'db-clone': { group: 'verify', triggers: ['ask'] },
  'think-aloud': { group: 'meta', triggers: ['ask'] }
}

export const GROUPS = [
  { id: 'build', title: 'Build & generate', sub: 'Turn intent into code (or into issues that become code).' },
  { id: 'plan', title: 'Plan & track', sub: 'Before code exists — issue tracking and prior-art checks.' },
  { id: 'commit', title: 'Commit gates', sub: 'Run automatically as part of landing a change — you rarely call them by hand.' },
  { id: 'review', title: 'Review & audit', sub: 'Quality checks on demand.' },
  { id: 'deploy', title: 'Deploy', sub: 'Code → a live Cloudflare Workers URL. Staging by default; production is a separate skill.' },
  { id: 'verify', title: 'Verify & maintain', sub: 'Prove nothing broke; keep the repo current.' },
  { id: 'meta', title: 'Meta', sub: 'Thinking & workflow aids.' },
  { id: 'uncategorised', title: '⚠️ Uncategorised', sub: 'New skills not yet placed in the generator META map — add them.' }
]

export const TRIG = {
  auto: { cls: 'auto', label: 'auto' },
  ask: { cls: 'ask', label: 'on ask' },
  flow: { cls: 'flow', label: 'in flow' },
  cron: { cls: 'cron', label: 'on a schedule' }
}

// Trigger → skill flow (#843). The skill cards above answer "HOW does each skill fire"
// (auto/ask/flow); this answers "WHEN — what event triggers which skills, in what order."
// Declarative + exported so both the doc page (renderFlowLanes below) and the monthly
// skills-digest email (render.mjs) draw the SAME lanes from one source — and main() asserts
// every referenced skill still exists, so a lane can never point at a deleted skill.
// A skill in a lane may be a bare name or { name, at } (at = a cadence/condition annotation).
export const FLOWS = [
  {
    id: 'plan', icon: '📋', kind: 'ask',
    trigger: 'You start an initiative',
    when: 'Issue-first — open the epic + sub-issues before any code.',
    skills: ['github-tasks', 'task-decompose', 'ecosystem-check']
  },
  {
    id: 'build', icon: '🔨', kind: 'flow',
    trigger: 'You build a feature',
    when: 'The sign-off gates fire first (agree the model / look / test), then you generate.',
    skills: ['schema-review', 'ui-proposal', 'test-review', 'crouton', 'block-authoring']
  },
  {
    id: 'commit', icon: '💾', kind: 'auto',
    trigger: 'You commit',
    when: 'Pre-commit gates run automatically, then the conventional commit lands.',
    skills: ['sync-docs', 'i18n-check', 'commit']
  },
  {
    id: 'ci', icon: '🤖', kind: 'flow',
    trigger: 'A robot opens a PR → CI runs',
    when: 'Quality gates run on the change before it can merge.',
    skills: ['review', 'a11y', 'e2e-smoke', 'red-team']
  },
  {
    id: 'deploy', icon: '🚀', kind: 'ask',
    trigger: 'You ship it',
    when: 'Staging by default; production is a separate, deliberate skill.',
    skills: ['deploy', 'poc-deploy', 'deploy-production']
  },
  {
    id: 'bug', icon: '🐛', kind: 'flow',
    trigger: 'A bug is reported',
    when: 'Archaeology first — find when it broke before fixing.',
    skills: ['bug-archaeology']
  },
  {
    id: 'close', icon: '🏁', kind: 'flow',
    trigger: 'An epic closes',
    when: 'A retro mines improvements into new workflow issues.',
    skills: ['postmortem']
  },
  {
    id: 'scheduled', icon: '⏰', kind: 'cron',
    trigger: 'On a schedule — no human',
    when: 'Deterministic digests + the daily security sweep run themselves.',
    skills: [
      { name: 'epic-digest', at: 'daily' },
      { name: 'housekeeping', at: 'weekly' },
      { name: 'skills-digest', at: 'monthly' },
      { name: 'red-team', at: 'daily deep' }
    ]
  },
  {
    id: 'maintain', icon: '🧰', kind: 'ask',
    trigger: 'On demand, as needed',
    when: 'Keep the repo current and healthy.',
    skills: ['dependency-sweep', 'db-migrations', 'db-clone', 'provider-swap', 'remove-app', 'audit', 'i18n-audit']
  }
]
export const flowSkillName = (s) => (typeof s === 'string' ? s : s.name)

// Static appendix: plain-language "what happens to a robot's PR" flow. Lives here (not a
// hand-edited html) so the combined page stays in sync with CI's --check. Edit the copy
// below and re-run the generator.
const CI_FLOW = `  <section class="cif-wrap">
    <h2><span class="num">★</span> When a robot opens a PR — how it reaches merge</h2>
    <p class="grp-sub">The agent pipeline can finish a task on its own. This is the safety net around it, in plain terms — so a change never ships unseen, and a problem never disappears quietly.</p>

    <div class="cif-promises">
      <span class="cif-promise">👀 You always see a status — never silence</span>
      <span class="cif-promise">🤖 A robot only steps in when something breaks</span>
      <span class="cif-promise">🙋 You're pinged only when a human is truly needed</span>
    </div>

    <div class="cif-flow">
      <div class="cif-step">
        <span class="ico">🧩</span>
        <div class="body">
          <p class="h">1 · A robot finishes a task</p>
          <p class="p">It opens a pull request — a proposed change, ready for testing.</p>
          <span class="tech">task-worker → opens PR (Closes #NN)</span>
        </div>
      </div>

      <div class="cif-step">
        <span class="ico">⚙️</span>
        <div class="body">
          <p class="h">2 · Tests run — and you always get a status note</p>
          <p class="p">One short note is posted and kept updated, so you can glance and see how it's going. No digging, and no flood of comments.</p>
          <span class="tech">one sticky comment on the PR + a roll-up line on the epic</span>
        </div>
      </div>

      <div class="cif-step cif-good">
        <span class="ico">✅</span>
        <div class="body">
          <p class="h">3a · Everything passes → it merges itself</p>
          <p class="p">The change lands and the task is marked done. The happy path needs no robot at all.</p>
          <span class="tech">auto-merge · the task issue auto-closes</span>
        </div>
      </div>

      <div class="cif-step cif-bad">
        <span class="ico">🤖</span>
        <div class="body">
          <p class="h">3b · Something fails → a fix-bot tries to fix it</p>
          <p class="p">It reads the error, makes a fix, and lets the tests run again — for a few attempts.</p>
          <span class="tech">wakes only on failure · capped at ~3 tries</span>
        </div>
      </div>

      <div class="cif-step cif-human">
        <span class="ico">🙋</span>
        <div class="body">
          <p class="h">… still stuck? → it tags you and waits</p>
          <p class="p">It never guesses past a real problem. You reply whenever you're ready, and that simply restarts it — no special command.</p>
          <span class="tech">@you + marks it “blocked” · your reply resumes it</span>
        </div>
      </div>

      <div class="cif-step cif-danger">
        <span class="ico">🚨</span>
        <div class="body">
          <p class="h">4 · Breaks after merging? → it opens a new ticket</p>
          <p class="p">If the live site breaks once the change is already in, a fresh ticket is created so the problem is never lost.</p>
          <span class="tech">the only honest record once the PR is closed</span>
        </div>
      </div>
    </div>
  </section>`

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  const fm = {}
  if (m) for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (mm) fm[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim()
  }
  return fm
}

function firstParagraph(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---/, '')
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#') && !t.startsWith('>')) return t.replace(/[*_`]/g, '')
  }
  return ''
}

export function discover() {
  const out = []
  for (const entry of readdirSync(SKILLS_DIR)) {
    const p = join(SKILLS_DIR, entry)
    if (statSync(p).isDirectory()) {
      const f = join(p, 'SKILL.md')
      if (!existsSync(f)) continue
      const fm = parseFrontmatter(readFileSync(f, 'utf8'))
      out.push({ name: fm.name || entry, desc: fm.description || '' })
    } else if (entry.endsWith('.md')) {
      const txt = readFileSync(p, 'utf8')
      const fm = parseFrontmatter(txt)
      out.push({ name: fm.name || entry.replace(/\.md$/, ''), desc: fm.description || firstParagraph(txt) })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function card(s) {
  const meta = META[s.name] || { triggers: [] }
  const badges = (meta.triggers.length ? meta.triggers : ['ask'])
    .map(t => `<span class="b ${TRIG[t].cls}">${TRIG[t].label}</span>`).join('')
  return `      <div class="skill">
        <div class="skill-head"><span class="name">/${esc(s.name)}</span><span class="badges">${badges}</span></div>
        <p class="what">${esc(s.desc)}</p>
      </div>`
}

function renderFlowLanes() {
  const lanes = FLOWS.map((lane) => {
    const chips = lane.skills
      .map((s) => {
        const name = flowSkillName(s)
        const cad = typeof s === 'object' && s.at ? `<span class="fl-cad">${esc(s.at)}</span>` : ''
        return `<span class="fl-chip">/${esc(name)}${cad}</span>`
      })
      .join('<span class="fl-arrow">→</span>')
    const t = TRIG[lane.kind] || TRIG.ask
    return `      <div class="fl-lane">
        <div class="fl-head">
          <span class="fl-ico">${lane.icon}</span>
          <div>
            <div class="fl-trig">${esc(lane.trigger)} <span class="b ${t.cls}">${t.label}</span></div>
            <div class="fl-when">${esc(lane.when)}</div>
          </div>
        </div>
        <div class="fl-skills">${chips}</div>
      </div>`
  }).join('\n')
  return `  <section class="flow-wrap">
    <h2><span class="num">★</span> When each skill fires — the flow</h2>
    <p class="grp-sub">The cards above say <em>how</em> a skill triggers; this says <em>when</em> — which event sets off which skills, in order. Read each lane left-to-right.</p>
    <div class="flow-lanes">
${lanes}
    </div>
  </section>`
}

function render(skills) {
  const byGroup = id => skills.filter(s => (META[s.name]?.group || 'uncategorised') === id)
  const sections = GROUPS.map((g, i) => {
    const items = byGroup(g.id)
    if (!items.length) return ''
    return `  <section>
    <h2><span class="num">${i + 1}</span> ${g.title}</h2>
    <p class="grp-sub">${g.sub}</p>
    <div class="grid">
${items.map(card).join('\n')}
    </div>
  </section>`
  }).filter(Boolean).join('\n\n')

  return `<!DOCTYPE html>
<!-- GENERATED by scripts/gen-skills-doc.mjs from .claude/skills/ — do not edit by hand. -->
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Crouton Skills — what fires when</title>
<style>
  :root{ --page:#0a0e17; --ink:#e8edf6; --muted:#8b97ad; --panel:#121a2e; --panel-2:#0f1626; --line:#243049; --auto:#34d399; --ask:#60a5fa; --flow:#a78bfa; --radius:14px; --shadow:0 10px 30px rgba(0,0,0,.35); }
  *{box-sizing:border-box;}
  body{margin:0; background:radial-gradient(1200px 600px at 75% -10%, #16213c 0%, var(--page) 55%); color:var(--ink); line-height:1.55; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif; -webkit-font-smoothing:antialiased;}
  .wrap{max-width:1080px; margin:0 auto; padding:44px 22px 90px;}
  .eyebrow{text-transform:uppercase; letter-spacing:.18em; font-size:12px; color:var(--auto); font-weight:700;}
  h1{font-size:clamp(27px,4vw,40px); margin:6px 0 8px; line-height:1.1;}
  .lede{color:var(--muted); font-size:16px; max-width:70ch; margin:0 0 22px;}
  .legend{display:flex; flex-wrap:wrap; gap:10px; margin-bottom:8px;}
  .chip{display:inline-flex; align-items:center; gap:8px; background:var(--panel); border:1px solid var(--line); padding:6px 12px; border-radius:999px; font-size:13px; color:var(--muted);}
  .dot{width:10px;height:10px;border-radius:50%;}
  .dot.auto{background:var(--auto);} .dot.ask{background:var(--ask);} .dot.flow{background:var(--flow);}
  .strip{margin:26px 0 8px; background:linear-gradient(180deg,var(--panel),var(--panel-2)); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); padding:14px; overflow-x:auto;}
  .strip svg{width:100%; height:auto; min-width:760px; display:block;}
  .strip text{fill:var(--ink); font-family:inherit;}
  .s-t{font-size:13px; font-weight:700;} .s-s{font-size:10.5px; fill:var(--muted);}
  .edge{stroke:#52628a; stroke-width:1.7; fill:none;}
  h2{font-size:18px; margin:34px 0 4px; display:flex; align-items:center; gap:10px;}
  h2 .num{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:8px;background:#1e2a47;border:1px solid var(--line);font-size:13px;color:var(--muted);}
  .grp-sub{color:var(--muted); font-size:13px; margin:0 0 14px;}
  .grid{display:grid; grid-template-columns:1fr; gap:12px;}
  @media(min-width:720px){.grid{grid-template-columns:1fr 1fr;}}
  .skill{background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:15px 16px;}
  .skill-head{display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:7px;}
  .name{font-family:ui-monospace,Menlo,Consolas,monospace; font-size:14px; font-weight:700; color:#cfe3ff;}
  .badges{display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end;}
  .b{font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:999px; white-space:nowrap;}
  .b.auto{background:rgba(52,211,153,.14); color:var(--auto); border:1px solid #1f5e47;}
  .b.ask{background:rgba(96,165,250,.14); color:var(--ask); border:1px solid #29456f;}
  .b.flow{background:rgba(167,139,250,.14); color:var(--flow); border:1px solid #443a6b;}
  .b.cron{background:rgba(244,162,59,.14); color:#f0a23b; border:1px solid #6b4f23;}
  .what{font-size:12.5px; color:var(--muted); margin:0;}
  .flow-wrap{margin-top:26px;}
  .flow-lanes{display:flex; flex-direction:column; gap:10px;}
  .fl-lane{background:linear-gradient(180deg,var(--panel),var(--panel-2)); border:1px solid var(--line); border-radius:var(--radius); padding:13px 15px;}
  .fl-head{display:flex; gap:11px; align-items:flex-start; margin-bottom:9px;}
  .fl-ico{font-size:19px; line-height:1.2;}
  .fl-trig{font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
  .fl-when{font-size:12px; color:var(--muted); margin-top:2px;}
  .fl-skills{display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding-left:30px;}
  .fl-chip{font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; font-weight:700; color:#cfe3ff; background:#0e1626; border:1px solid var(--line); border-radius:7px; padding:3px 9px; display:inline-flex; align-items:center; gap:6px;}
  .fl-cad{font-family:-apple-system,Segoe UI,Roboto,sans-serif; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#f0a23b; background:rgba(244,162,59,.13); border:1px solid #6b4f23; border-radius:999px; padding:1px 6px;}
  .fl-arrow{color:#52628a; font-size:13px; font-weight:700;}
  .cif-wrap{margin-top:42px;}
  .cif-promises{display:flex; flex-wrap:wrap; gap:10px; margin:2px 0 18px;}
  .cif-promise{display:inline-flex; align-items:center; gap:8px; background:var(--panel); border:1px solid var(--line); padding:8px 14px; border-radius:999px; font-size:13px; color:var(--ink);}
  .cif-flow{display:flex; flex-direction:column; gap:10px;}
  .cif-step{display:flex; gap:14px; align-items:flex-start; background:var(--panel); border:1px solid var(--line); border-left:4px solid #5566aa; border-radius:var(--radius); padding:14px 16px;}
  .cif-step .ico{font-size:22px; line-height:1.2;}
  .cif-step .body{flex:1; min-width:0;}
  .cif-step .h{font-size:15px; font-weight:700; margin:0 0 3px;}
  .cif-step .p{font-size:13px; color:var(--muted); margin:0;}
  .cif-step .tech{display:inline-block; margin-top:8px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; color:#8493b4; background:#0e1626; border:1px solid var(--line); border-radius:6px; padding:2px 8px;}
  .cif-good{border-left-color:var(--auto);}
  .cif-bad{border-left-color:#f0a23b;}
  .cif-human{border-left-color:var(--ask); margin-left:26px;}
  .cif-danger{border-left-color:#ef5a6f;}
  footer{margin-top:46px; padding-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:12.5px;}
</style>
</head>
<body>
<div class="wrap">

  <span class="eyebrow">nuxt-crouton · agent flow</span>
  <h1>Skills — what fires when</h1>
  <p class="lede">Every skill in <code>.claude/skills/</code>, grouped by job, with how it <strong>triggers</strong>. Auto-generated from each skill's <code>SKILL.md</code> — three kinds of trigger:</p>
  <div class="legend">
    <span class="chip"><span class="dot auto"></span> <b style="color:var(--auto)">Automatic</b> — a hook / pre-commit step runs it</span>
    <span class="chip"><span class="dot ask"></span> <b style="color:var(--ask)">On ask</b> — you invoke it (/name) or request the work</span>
    <span class="chip"><span class="dot flow"></span> <b style="color:var(--flow)">In flow</b> — fires inside the agent task pipeline</span>
  </div>

  <div class="strip">
    <svg viewBox="0 0 880 130" role="img" aria-label="Where skills fire across a task lifecycle">
      <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#52628a"/></marker></defs>
      <line class="edge" x1="118" y1="58" x2="158" y2="58" marker-end="url(#a)"/>
      <line class="edge" x1="276" y1="58" x2="316" y2="58" marker-end="url(#a)"/>
      <line class="edge" x1="434" y1="58" x2="474" y2="58" marker-end="url(#a)"/>
      <line class="edge" x1="592" y1="58" x2="632" y2="58" marker-end="url(#a)"/>
      <line class="edge" x1="750" y1="58" x2="790" y2="58" marker-end="url(#a)"/>
      <g><rect x="20" y="34" width="98" height="48" rx="9" fill="#13213c" stroke="#2f4068"/><text class="s-t" x="69" y="55" text-anchor="middle">Plan</text><text class="s-s" x="69" y="71" text-anchor="middle">github-tasks</text></g>
      <g><rect x="158" y="34" width="118" height="48" rx="9" fill="#13213c" stroke="#2f4068"/><text class="s-t" x="217" y="55" text-anchor="middle">Build</text><text class="s-s" x="217" y="71" text-anchor="middle">crouton · ui-proposal</text></g>
      <g><rect x="316" y="34" width="118" height="48" rx="9" fill="#102a22" stroke="#1f5e47"/><text class="s-t" x="375" y="55" text-anchor="middle">Pre-commit</text><text class="s-s" x="375" y="71" text-anchor="middle">sync-docs · i18n-check</text></g>
      <g><rect x="474" y="34" width="118" height="48" rx="9" fill="#102a22" stroke="#1f5e47"/><text class="s-t" x="533" y="55" text-anchor="middle">Commit</text><text class="s-s" x="533" y="71" text-anchor="middle">/commit</text></g>
      <g><rect x="632" y="34" width="118" height="48" rx="9" fill="#13213c" stroke="#2f4068"/><text class="s-t" x="691" y="55" text-anchor="middle">Review</text><text class="s-s" x="691" y="71" text-anchor="middle">review · audit</text></g>
      <g><rect x="790" y="34" width="90" height="48" rx="9" fill="#13213c" stroke="#2f4068"/><text class="s-t" x="835" y="55" text-anchor="middle">Ship</text><text class="s-s" x="835" y="71" text-anchor="middle">deploy · e2e</text></g>
      <text class="s-s" x="375" y="104" text-anchor="middle">green stages run automatically before the commit lands</text>
    </svg>
  </div>

${renderFlowLanes()}

${sections}

${CI_FLOW}

  <footer>
    Generated by <code>scripts/gen-skills-doc.mjs</code> from <code>.claude/skills/</code> — re-run when skills change (sync-docs does this before /commit; CI enforces it). Inline SVG · no JS · renders offline.
  </footer>

</div>
</body>
</html>
`
}

// --- main --- (only when run directly, not when imported for META/discover reuse)
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (runDirectly) {
  const skills = discover()
  const uncategorised = skills.filter(s => !META[s.name])
  if (uncategorised.length) {
    console.warn(`⚠️  ${uncategorised.length} skill(s) not in META (shown under "Uncategorised"): ${uncategorised.map(s => s.name).join(', ')}`)
  }
  // The flow lanes (#843) must only reference skills that still exist — fail loudly otherwise,
  // so the diagram can't silently point at a deleted skill (CI runs this via --check).
  const known = new Set(skills.map(s => s.name))
  const danglingFlow = FLOWS.flatMap(l => l.skills.map(flowSkillName)).filter(n => !known.has(n))
  if (danglingFlow.length) {
    console.error(`✗ FLOWS references unknown skill(s): ${[...new Set(danglingFlow)].join(', ')}. Fix the FLOWS map in scripts/gen-skills-doc.mjs.`)
    process.exit(1)
  }
  const html = render(skills)

  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (current !== html) {
      console.error('✗ skills-and-triggers.html is stale. Run: node scripts/gen-skills-doc.mjs')
      process.exit(1)
    }
    console.log('✓ skills-and-triggers.html is up to date')
  } else {
    writeFileSync(OUT, html)
    console.log(`✓ Wrote ${OUT} (${skills.length} skills)`)
  }
}
