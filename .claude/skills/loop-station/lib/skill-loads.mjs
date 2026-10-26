/**
 * Skill loads from a pi session log → Loop Station trace events (#2403).
 *
 * pi has no "skill" tool. It lists every skill in the system prompt with its file path and
 * tells the model to "use the read tool to load a skill's file" (pi-coding-agent
 * core/skills.js `formatSkillsForPrompt`). So in the session JSONL a skill load is a
 * `toolCall` named `read` whose `arguments.path` is a skill entry file:
 *   .claude/skills/<name>/SKILL.md   (dir form)   → name = <name>
 *   .claude/skills/<name>.md         (root file)  → name = <name>
 * The same names the inventory uses (gather.mjs), so the dead-weight join matches.
 *
 * A continuation read of the same file (`offset > 0`) is the SAME load, not a second one.
 * `/skill:<name>` command expansions land in a user message as `<skill name="…">` — counted too.
 *
 * Privacy (same rule as pi-telemetry.mjs): emit the skill NAME and a timestamp only — never
 * the prompt, the tool output or any other argument.
 */

const SKILL_PATH = /(?:^|[\\/])\.claude[\\/]skills[\\/]([^\\/]+)(?:[\\/]SKILL\.md|\.md)$/i
const SKILL_BLOCK = /<skill name="([^"]+)"/g

/** The skill name a `read` path points at, or null when it isn't a skill entry file. */
export function skillNameFromPath(p) {
  if (typeof p !== 'string') return null
  const m = p.match(SKILL_PATH)
  if (!m) return null
  // `.claude/skills/foo/SKILL.md` → "foo"; `.claude/skills/foo.md` → "foo". Sub-docs inside a
  // skill dir (`.claude/skills/foo/notes.md`) don't match: the regex needs SKILL.md after the dir.
  return m[1] === 'SKILL' ? null : m[1]
}

/**
 * Parse pi session JSONL text into `{ kind: 'skill', name, ts, parent: 'root', depth: 0 }`
 * events, one per distinct load. Tolerates blank/invalid lines.
 */
export function skillLoadsFromSession(text) {
  const out = []
  if (!text) return out
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let rec
    try { rec = JSON.parse(t) } catch { continue }
    const ts = typeof rec?.timestamp === 'string' ? rec.timestamp : null
    const content = rec?.message?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type === 'toolCall' && c.name === 'read') {
        const a = c.arguments || {}
        if (Number(a.offset) > 0) continue // continuation of a load already counted
        const name = skillNameFromPath(a.path)
        if (name) out.push({ ts, kind: 'skill', name, parent: 'root', depth: 0 })
      } else if (c?.type === 'text' && rec.message?.role === 'user' && typeof c.text === 'string') {
        for (const m of c.text.matchAll(SKILL_BLOCK)) out.push({ ts, kind: 'skill', name: m[1], parent: 'root', depth: 0 })
      }
    }
  }
  return out
}

/**
 * Tool-call stats from a pi session log (#2548) — answers "did the worker call `read` on a
 * skill, or is the telemetry miscounting?". Counts every `toolCall` by `name` EXACTLY as
 * recorded (no lowercasing: the raw name is the evidence). `claudeReads` = repo-relative
 * paths of read-like calls (name lowercases to `read`) under `.claude/`, max 10.
 * `bashSkillTouches` = bash calls whose command mentions `.claude/skills/`.
 * Names and paths only, never content (same privacy rule as above).
 */
export function toolStatsFromSession(text) {
  const calls = {}
  const claudeReads = []
  let bashSkillTouches = 0
  if (!text) return { calls, claudeReads, bashSkillTouches }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let rec
    try { rec = JSON.parse(t) } catch { continue }
    const content = rec?.message?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type !== 'toolCall' || typeof c.name !== 'string') continue
      calls[c.name] = (calls[c.name] || 0) + 1
      const a = c.arguments || {}
      const lower = c.name.toLowerCase()
      if (lower === 'read') {
        const p = a.path ?? a.file_path
        if (typeof p === 'string' && p.includes('.claude/') && claudeReads.length < 10) {
          const i = p.indexOf('.claude/')
          claudeReads.push(p.slice(i))
        }
      } else if (lower === 'bash' && typeof a.command === 'string' && a.command.includes('.claude/skills/')) {
        bashSkillTouches++
      }
    }
  }
  return { calls, claudeReads, bashSkillTouches }
}

/** One-line summary: `tools: bash×31 read×12 · .claude reads: 0 · bash touching skills: 0`. */
export function formatToolStats(s) {
  const tools = Object.entries(s.calls).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n}×${k}`).join(' ') || 'none'
  return `tools: ${tools} · .claude reads: ${s.claudeReads.length} · bash touching skills: ${s.bashSkillTouches}`
}
