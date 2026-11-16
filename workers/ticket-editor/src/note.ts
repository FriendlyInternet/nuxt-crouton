/**
 * The owner's note in a saved drawing (#3691): the text they ADDED, compared with the previous
 * version of the scene. It goes into the 📐 save comment, because that comment's body is the one
 * thing every resume path reads (the revise worker and the planner fetch it, the decomposer reads
 * the thread, the generic resume quotes it).
 *
 * Pure — no I/O — so it is testable in plain Node.
 */

interface SceneElement { type?: string; text?: string; isDeleted?: boolean }
interface Scene { elements?: SceneElement[] }

function texts(scene: Scene | null | undefined): string[] {
  const els = Array.isArray(scene?.elements) ? scene!.elements! : []
  return els
    .filter(e => e && e.type === 'text' && !e.isDeleted)
    .map(e => String(e.text ?? '').trim())
    .filter(Boolean)
}

/**
 * Text elements in `nextScene` that are not in `prevScene`. `prevScene === null` (a new file)
 * means every text element is new.
 */
export function addedSceneText(prevScene: Scene | null, nextScene: Scene | null | undefined): string[] {
  const before = new Set(prevScene === null ? [] : texts(prevScene))
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of texts(nextScene)) {
    if (before.has(t) || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** First line of every save comment — scripts/lib/owner-screens.mjs keys on the 📐 (#3691). */
export const SAVE_FIRST_LINE = '📐 Diagram saved — continuing from your edit'
const MAX_NOTE_LINE = 500
const MAX_NOTE_LINES = 20

/**
 * The save comment. Line 1 is fixed (the owner-screen marker), line 2 the hidden line
 * `parseDiagramSave` reads, then the owner's note quoted line by line — below line 1, so a note
 * that itself starts with 📐 can never become the comment's first line.
 * `note === undefined` means the previous version could not be read.
 */
export function saveCommentBody(o: {
  slug: string; branch: string; sha: string; path: string; img: string; editUrl: string; at: string; note?: string[]
}): string {
  let noteBlock: string
  if (o.note === undefined) {
    noteBlock = '_could not compare with the previous version_'
  } else {
    const lines = o.note.flatMap(t => String(t).split(/\r?\n/)).map(l => l.trim()).filter(Boolean)
    noteBlock = lines.length
      ? lines.slice(0, MAX_NOTE_LINES).map(l => '> ' + (l.length > MAX_NOTE_LINE ? l.slice(0, MAX_NOTE_LINE) + ' …' : l)).join('\n')
        + (lines.length > MAX_NOTE_LINES ? '\n> … (' + (lines.length - MAX_NOTE_LINES) + ' more lines)' : '')
      : '_no new text in the drawing_'
  }
  return [
    SAVE_FIRST_LINE,
    '<!-- owner-screen:diagram slug=' + o.slug + ' branch=' + o.branch + ' sha=' + o.sha + ' path=' + o.path + ' -->',
    '',
    '**Your note in the drawing:**',
    '',
    noteBlock,
    '',
    '✏️ **`' + o.slug + '`** edited via the [ticket-editor](' + o.editUrl + ') — committed to `' + o.branch + '` @ `' + String(o.sha).slice(0, 7) + '`.',
    '',
    '![' + o.slug + '](' + o.img + ')',
    '',
    '_' + o.at + '_',
  ].join('\n')
}
