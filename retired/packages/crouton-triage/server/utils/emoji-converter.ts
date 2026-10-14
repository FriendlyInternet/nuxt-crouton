/**
 * Emoji Converter Utility
 *
 * Converts Slack-style emoji codes to Unicode emojis and parses
 * :link: URL patterns into Notion-compatible rich text with actual links.
 */

/**
 * Map of Slack-style emoji codes to Unicode emojis
 */
const EMOJI_MAP: Record<string, string> = {
  ':white_check_mark:': '✅',
  ':link:': '🔗',
  ':eyes:': '👀',
  ':hourglass:': '⏳',
  ':robot:': '🤖',
  ':x:': '❌',
  ':arrows_counterclockwise:': '🔄',
  ':heavy_check_mark:': '✔️',
  ':warning:': '⚠️',
  ':fire:': '🔥',
  ':sparkles:': '✨',
  ':thumbsup:': '👍',
  ':thumbsdown:': '👎',
  ':rocket:': '🚀',
  ':bulb:': '💡',
  ':memo:': '📝',
  ':pencil:': '✏️',
  ':pushpin:': '📌',
  ':calendar:': '📅',
  ':clock:': '🕐',
  ':bell:': '🔔',
  ':star:': '⭐',
  ':heart:': '❤️',
  ':question:': '❓',
  ':exclamation:': '❗',
  ':point_right:': '👉',
  ':point_left:': '👈',
  ':100:': '💯',
}

/**
 * Notion rich text item structure
 */
export interface NotionRichTextItem {
  type: 'text' | 'mention'
  text?: {
    content: string
    link?: { url: string } | null
  }
  mention?: any
  annotations?: {
    bold?: boolean
    italic?: boolean
    strikethrough?: boolean
    underline?: boolean
    code?: boolean
    color?: string
  }
}

/**
 * Convert Slack-style emoji codes to Unicode emojis
 *
 * @param text - Text containing Slack-style emoji codes
 * @returns Text with emoji codes replaced by Unicode emojis
 *
 * @example
 * convertSlackEmojis(':white_check_mark: Done!')
 * // Returns: '✅ Done!'
 */
export function convertSlackEmojis(text: string): string {
  if (!text) return text

  let result = text

  for (const [code, emoji] of Object.entries(EMOJI_MAP)) {
    result = result.split(code).join(emoji)
  }

  return result
}

/**
 * Parse text content and convert :link: URL patterns to Notion rich text with actual links
 *
 * This function handles the pattern `:link: URL` and converts it to clickable links
 * in Notion's rich_text format.
 *
 * @param text - Text that may contain :link: URL patterns
 * @returns Array of Notion rich text items with proper link formatting
 *
 * @example
 * parseContentWithLinks(':white_check_mark: Task created :link: https://notion.so/page')
 * // Returns rich text array with emoji converted and URL as clickable link
 */
export function parseContentWithLinks(text: string): NotionRichTextItem[] {
  if (!text) return []

  // First convert all emojis
  const withEmojis = convertSlackEmojis(text)

  // Pattern to match :link: followed by URL (with 🔗 since we already converted)
  // Also handle the original :link: in case conversion order varies
  const linkPattern = /(?:🔗|:link:)\s*(https?:\/\/[^\s]+)/g

  const items: NotionRichTextItem[] = []
  let lastIndex = 0
  let match

  while ((match = linkPattern.exec(withEmojis)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      const beforeText = withEmojis.substring(lastIndex, match.index)
      if (beforeText) {
        items.push({
          type: 'text',
          text: { content: beforeText },
        })
      }
    }

    // Add the link with 🔗 emoji
    const url = match[1]
    if (url) {
      items.push({
        type: 'text',
        text: {
          content: '🔗 ',
        },
      })
      items.push({
        type: 'text',
        text: {
          content: url,
          link: { url },
        },
        annotations: {
          color: 'blue',
        },
      })
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text after last link
  if (lastIndex < withEmojis.length) {
    items.push({
      type: 'text',
      text: { content: withEmojis.substring(lastIndex) },
    })
  }

  // If no links were found, return simple text with emojis
  if (items.length === 0) {
    items.push({
      type: 'text',
      text: { content: withEmojis },
    })
  }

  return items
}

/**
 * Simple text conversion - just converts emojis, returns plain string
 * Use this when you don't need link parsing (e.g., for metadata fields)
 */
export function formatTextForNotion(text: string): string {
  return convertSlackEmojis(text)
}

/**
 * Parse text content with @mentions linked to the source message URL
 *
 * Enhances parseContentWithLinks by also finding @Name patterns and
 * linking them to the source platform message URL.
 *
 * @param text - Text that may contain :link: URL patterns and @mentions
 * @param messageUrl - URL to link @mentions to (the source message)
 * @returns Array of Notion rich text items with links and mentions
 *
 * @example
 * parseContentWithMentionsAndLinks(
 *   '@Maarten needs to review this',
 *   'https://figma.com/file/abc#comment-123'
 * )
 * // Returns rich text array with @Maarten linked to the Figma comment
 */
export function parseContentWithMentionsAndLinks(
  text: string,
  messageUrl?: string,
): NotionRichTextItem[] {
  if (!text) return []

  // First convert all emojis
  const withEmojis = convertSlackEmojis(text)

  // Pattern to match @Name where Name is one or more capitalized words
  // Matches: @Maarten, @Maarten Lauwaert, @John Doe Smith
  const mentionRegex = /@([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/g

  // Pattern to match :link: followed by URL (with 🔗 since we already converted)
  const linkPattern = /(?:🔗|:link:)\s*(https?:\/\/[^\s]+)/g

  const items: NotionRichTextItem[] = []
  let lastIndex = 0

  // Create a merged list of all matches (mentions and links) sorted by position
  const allMatches: Array<{
    type: 'mention' | 'link'
    index: number
    length: number
    content: string
    url?: string
  }> = []

  // Find all mentions
  let match
  while ((match = mentionRegex.exec(withEmojis)) !== null) {
    allMatches.push({
      type: 'mention',
      index: match.index,
      length: match[0].length,
      content: match[0], // Full @Name
      url: messageUrl,
    })
  }

  // Find all links
  while ((match = linkPattern.exec(withEmojis)) !== null) {
    allMatches.push({
      type: 'link',
      index: match.index,
      length: match[0].length,
      content: match[1] || '', // The URL
      url: match[1],
    })
  }

  // Sort by position
  allMatches.sort((a, b) => a.index - b.index)

  // Process matches in order
  for (const matchItem of allMatches) {
    // Skip if this match overlaps with previously processed content
    if (matchItem.index < lastIndex) continue

    // Add text before the match
    if (matchItem.index > lastIndex) {
      const beforeText = withEmojis.substring(lastIndex, matchItem.index)
      if (beforeText) {
        items.push({
          type: 'text',
          text: { content: beforeText },
        })
      }
    }

    if (matchItem.type === 'mention' && matchItem.url) {
      // Add linked @mention
      items.push({
        type: 'text',
        text: {
          content: matchItem.content,
          link: { url: matchItem.url },
        },
        annotations: {
          color: 'blue',
        },
      })
    } else if (matchItem.type === 'mention') {
      // Add plain @mention (no URL available)
      items.push({
        type: 'text',
        text: { content: matchItem.content },
      })
    } else if (matchItem.type === 'link' && matchItem.url) {
      // Add the link with 🔗 emoji
      items.push({
        type: 'text',
        text: { content: '🔗 ' },
      })
      items.push({
        type: 'text',
        text: {
          content: matchItem.url,
          link: { url: matchItem.url },
        },
        annotations: {
          color: 'blue',
        },
      })
    }

    lastIndex = matchItem.index + matchItem.length
  }

  // Add remaining text after last match
  if (lastIndex < withEmojis.length) {
    items.push({
      type: 'text',
      text: { content: withEmojis.substring(lastIndex) },
    })
  }

  // If no matches were found, return simple text with emojis
  if (items.length === 0) {
    items.push({
      type: 'text',
      text: { content: withEmojis },
    })
  }

  return items
}
