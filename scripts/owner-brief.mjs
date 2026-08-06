#!/usr/bin/env node
/**
 * owner-brief.mjs — the pure decision behind the `require-owner-brief` hook (#2081).
 *
 * THE PROBLEM. The owner holds ~20 async threads on a phone. Agent comments are often deep
 * and technical, which is fine and must NOT be cut — but the depth arrives *as* the
 * notification, so every ping costs a full read.
 *
 * THE RULE. Every agent comment leads with a short TYPED BRIEF; everything else is collapsed
 * behind <details>. Depth is free — it just cannot sit in front of the point.
 *
 * WHY THE TRIGGER IS "IS THIS AN AGENT COMMENT" AND NOT "DOES IT @MENTION THE OWNER".
 * The @mention rule was the obvious design and measuring it killed it. Of the 29
 * owner-mentioning comments in the last 100, **17 contain `@pmcp` only inside the mandatory
 * provenance disclaimer** ("posted from @pmcp's account") — which is exactly the set of long
 * reports the owner was complaining about. An @mention gate would have waved through the
 * offenders and constrained only the 12 that already used a standalone address. So the
 * trigger is the 🤖 provenance header every agent comment already carries.
 *
 * THE LIMITS are read off the same corpus, not guessed. Across all 93 agent-authored
 * comments the visible part runs 0 · 114 · 330 · 591 · 25497 chars (quartiles) and
 * 0 · 1 · 3 · 6 · 217 lines: the median agent comment is already 330 chars / 3 lines, and
 * 700c/10L refuses 20 of 93 — the walls, not the norm. MAX_VISIBLE_LINES reuses the ~10
 * lines `ask-human` already specifies rather than inventing a second number.
 *
 * ON REFUSING THE WHOLE EXISTING CORPUS. Run over the 18 comments the hook would actually
 * judge, it refuses all 18 — 16 for a missing type marker. For a rule that hunts bugs that
 * would be damning (see AGENTS.md, "run the rule over the corpus"); here it is the expected
 * shape of introducing a NEW required format, and it is worth being explicit that the two
 * cases are different. The check that could have been wrong is the LENGTH one, and only
 * 2 of 18 exceed it — so the limits are permissive and the type marker is the real change.
 *
 * WHAT "VISIBLE" MEANS is the whole design. Anything inside <details>, a code fence, the
 * provenance blockquote, an HTML comment marker or the generated-by footer costs nothing.
 * Attach the wall — just put it behind the summary.
 */

/** Read off the measured corpus — see the header before changing either. */
export const MAX_VISIBLE_CHARS = 700
export const MAX_VISIBLE_LINES = 10

/**
 * The six brief types. The last three are `ask-human`'s shapes — one vocabulary, not two.
 *
 * `notifies` is the other half of the rule: an @mention is a REQUEST FOR ACTION, so a type
 * that needs nothing back must not carry one. Only ✅ is unambiguously silent — 🔴 and 💡
 * both want a call from the owner even though neither blocks.
 */
export const BRIEF_TYPES = [
  { emoji: '🔴', name: 'Issue', means: 'something is broken or wrong', notifies: true },
  { emoji: '💡', name: 'Proposal', means: 'a suggestion you can take or drop', notifies: true },
  { emoji: '✅', name: 'Done', means: 'landed and verified — no action needed', notifies: false },
  { emoji: '🔀', name: 'Choice', means: 'a real fork, needs your pick', notifies: true },
  { emoji: '🛠', name: 'Action', means: "you must do something the agent can't", notifies: true },
  { emoji: '👀', name: 'Review', means: 'approve or reject a diff/preview', notifies: true },
]

/** Emoji may carry a variation selector (️) — match with or without it. */
const TYPE_MARKER = new RegExp(`(?:${BRIEF_TYPES.map((t) => t.emoji).join('|')})️?`, 'u')

/** Which type did this comment declare? Null when none is present. */
export function briefType(body) {
  const visible = visiblePart(body)
  const m = visible.match(TYPE_MARKER)
  if (!m) return null
  const hit = m[0].replace('️', '')
  return BRIEF_TYPES.find((t) => t.emoji === hit) || null
}

/**
 * Does this body actually NOTIFY the owner?
 *
 * Deliberately a DIFFERENT strip from `visiblePart`, because the two answer different
 * questions. `visiblePart` asks "what must a human read" and so drops blockquotes and
 * <details>. Notification asks "what does GitHub linkify", and GitHub renders mentions
 * inside blockquotes and <details> perfectly well — they notify. The only places it does
 * NOT are code spans and fenced blocks.
 *
 * Conflating the two is how the mandatory provenance disclaimer became the single largest
 * source of false pings: `posted from @pmcp's account` sits in a blockquote, is invisible to
 * the reader, and notified the owner on EVERY interactive agent comment. Measured over the
 * last 100 comments, 17 of the 29 notifications were that line and nothing else — 59% of the
 * pings carried no ask at all. The fix is to write the handle as `@pmcp` in a code span,
 * which renders identically and does not notify.
 */
export function notifiesOwner(body, handle = '@pmcp') {
  const withoutCode = String(body || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
  const esc = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Trailing `(?![\w-])` matters: GitHub usernames may contain hyphens, so `@pmcp-bot` is a
  // DIFFERENT account. `\b` alone treats the hyphen as a boundary and would count it as a
  // mention of @pmcp. Leading `[^\w`/]` keeps `mail@pmcp.dev` and a code-span handle out.
  return new RegExp(`(^|[^\\w\`/])${esc}(?![\\w-])`).test(withoutCode)
}

/**
 * Strip everything the reader does NOT have to read before acting. Order matters: details
 * blocks go before fences, so a fence inside a details block isn't counted twice.
 */
export function visiblePart(body) {
  return String(body || '')
    .replace(/<details[\s\S]*?<\/details>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*>.*$/gm, '')                      // provenance blockquote
    .replace(/<!--[\s\S]*?-->/g, '')                // sticky-comment markers
    .replace(/\n---\s*\n_Generated by[\s\S]*$/, '') // attribution footer
    .trim()
}

/** Agent comments all carry the 🤖 provenance header (its own hook enforces that). */
export function isAgentComment(body) {
  return /🤖/u.test(String(body || ''))
}

/**
 * @param {string} body
 * @returns {{ ok: boolean, reason?: string, chars: number, lines: number }}
 */
export function checkOwnerBrief(body, { handle = '@pmcp' } = {}) {
  const visible = visiblePart(body)
  const lines = visible.split('\n').filter((l) => l.trim()).length
  const chars = visible.length

  // Not an agent comment → not ours to shape.
  if (!isAgentComment(body)) return { ok: true, chars, lines }

  if (!TYPE_MARKER.test(visible)) return { ok: false, reason: 'no-type', chars, lines }
  if (chars > MAX_VISIBLE_CHARS) return { ok: false, reason: 'too-long', chars, lines }
  if (lines > MAX_VISIBLE_LINES) return { ok: false, reason: 'too-many-lines', chars, lines }

  // The inverse rule. A brief with a type that needs nothing back must not ping — otherwise
  // the mention stops meaning "act" and the owner learns to ignore it, which costs far more
  // than the individual notification.
  const type = briefType(body)
  if (type && !type.notifies && notifiesOwner(body, handle)) {
    return { ok: false, reason: 'ping-without-ask', chars, lines, type: type.emoji }
  }
  return { ok: true, chars, lines, type: type?.emoji }
}

/** Name the fix, not just the violation — a gate that only says "no" costs a round-trip. */
export function explain(verdict, { handle = '@pmcp' } = {}) {
  const vocab = BRIEF_TYPES.map(
    (t) => `  ${t.emoji}  ${t.name.padEnd(9)} ${t.means}${t.notifies ? '' : '  [must NOT mention]'}`,
  ).join('\n')

  if (verdict.reason === 'ping-without-ask') {
    return `Blocked: this is a ${verdict.type} brief — it needs nothing back — but it MENTIONS
${handle}, which notifies them (#2081). A mention is a request for action; spending one on an
FYI teaches the owner to ignore mentions, which costs more than the notification.

Either drop the mention, or pick the type that matches what you actually need:

${vocab}

Note GitHub notifies for a mention inside a blockquote or <details> too — the only places it
does NOT are code spans and fenced blocks. To NAME the handle without pinging, backtick it:
\`${handle}\`.`
  }

  const why = {
    'no-type': 'It carries no brief type on its visible first lines.',
    'too-long': `Its visible part is ${verdict.chars} chars (max ${MAX_VISIBLE_CHARS}).`,
    'too-many-lines': `Its visible part is ${verdict.lines} lines (max ${MAX_VISIBLE_LINES}).`,
  }[verdict.reason] || 'It is not a valid owner brief.'

  return `Blocked: an agent comment is a NOTIFICATION, so it must lead with a short typed brief
and link to the depth (#2081). ${why}

Lead with one of these:

${vocab}

Shape — visible part <=${MAX_VISIBLE_CHARS} chars and <=${MAX_VISIBLE_LINES} lines:

  🔴 **<one line: what happened>**
  > 🤖 <provenance>

  **You:** <the single next action — or "nothing, FYI">
  **Depth:** <link to the full comment / PR / run>

KEEP THE DEPTH. It costs nothing inside <details>, a code fence, the provenance blockquote,
or the generated-by footer. Collapse it, don't cut it:

  <details><summary>Findings / patch / evidence</summary>
  …everything you were about to write…
  </details>

See .claude/skills/owner-brief/SKILL.md.`
}
