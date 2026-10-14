import { describe, it, expect, vi } from 'vitest'
import {
  extractFileKeyFromUrl,
  extractTextFromHtml,
  extractLinksFromHtml,
  extractFigmaLink,
  normalizeText,
  fuzzyFindText,
  findCommentByText,
  determineEmailType,
  extractFigmaMetadata,
  parseEmail,
  type ParsedEmail,
} from '../emailParser'

// Mock the logger to avoid noise in test output
vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ============================================================================
// extractFileKeyFromUrl
// ============================================================================
describe('extractFileKeyFromUrl', () => {
  it('extracts key from /file/ URL', () => {
    expect(extractFileKeyFromUrl('https://www.figma.com/file/abc123def456/Design-File'))
      .toBe('abc123def456')
  })

  it('extracts key from /design/ URL', () => {
    expect(extractFileKeyFromUrl('https://www.figma.com/design/xyz789/My-Design'))
      .toBe('xyz789')
  })

  it('extracts key from /proto/ URL', () => {
    expect(extractFileKeyFromUrl('https://www.figma.com/proto/proto123/Prototype'))
      .toBe('proto123')
  })

  it('extracts key from /board/ URL (FigJam)', () => {
    expect(extractFileKeyFromUrl('https://www.figma.com/board/board456/Whiteboard'))
      .toBe('board456')
  })

  it('extracts key from CDN image URL', () => {
    expect(extractFileKeyFromUrl('https://api-cdn.figma.com/resize/images/2265042955578165560/thumb.png'))
      .toBe('2265042955578165560')
  })

  it('returns null for non-Figma URLs', () => {
    expect(extractFileKeyFromUrl('https://example.com/file/abc123')).toBeNull()
  })

  it('returns null for Figma URLs without a key pattern', () => {
    expect(extractFileKeyFromUrl('https://www.figma.com/about')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractFileKeyFromUrl('')).toBeNull()
  })
})

// ============================================================================
// extractTextFromHtml
// ============================================================================
describe('extractTextFromHtml', () => {
  it('extracts @Figbot mention with content', () => {
    const html = '<p>@Figbot please fix the button alignment</p>'
    expect(extractTextFromHtml(html)).toBe('@Figbot please fix the button alignment')
  })

  it('extracts bare @Figbot mention when no context', () => {
    const html = '<div>@Figbot</div>'
    expect(extractTextFromHtml(html)).toBe('@Figbot')
  })

  it('prefers longest @Figbot mention', () => {
    const html = '<div>@Figbot</div><p>@Figbot this is the real comment with details</p>'
    expect(extractTextFromHtml(html)).toBe('@Figbot this is the real comment with details')
  })

  it('extracts mention from table cells', () => {
    const html = '<table><tr><td>@JohnDoe please review this section</td></tr></table>'
    expect(extractTextFromHtml(html)).toBe('@JohnDoe please review this section')
  })

  it('filters out CSS @font-face rules', () => {
    const html = `
      <style>@font-face { font-family: test; }</style>
      <p>Some actual content here that is substantial enough</p>
    `
    const result = extractTextFromHtml(html)
    expect(result).not.toContain('@font-face')
  })

  it('falls back to cheerio selectors when no mentions', () => {
    const html = '<div class="comment-body">This is a comment without mentions</div>'
    expect(extractTextFromHtml(html)).toBe('This is a comment without mentions')
  })

  it('falls back to cheerio <p> selector before substantial lines', () => {
    const html = `
      <body>
        <p>http://example.com</p>
        <p>This is a substantial line of text content from the email body</p>
      </body>
    `
    const result = extractTextFromHtml(html)
    // The <p> selector (priority 4) matches before the "substantial lines" fallback,
    // returning the first <p> with text.length > 5
    expect(result).toBe('http://example.com')
  })

  it('handles empty HTML', () => {
    expect(extractTextFromHtml('')).toBe('')
  })

  it('table cell filter does not catch unsubscribe in mention context', () => {
    // The unsubscribe filter is in extractMentionWithContext (priority 3),
    // but extractTableCellMentions (priority 2) doesn't filter unsubscribe.
    // This tests the actual behavior: table cell extraction wins.
    const html = '<table><tr><td>@someone unsubscribe from notifications</td></tr></table>'
    const result = extractTextFromHtml(html)
    expect(result).toBe('@someone unsubscribe from notifications')
  })
})

// ============================================================================
// extractLinksFromHtml
// ============================================================================
describe('extractLinksFromHtml', () => {
  it('extracts href links', () => {
    const html = '<a href="https://example.com">Link</a>'
    expect(extractLinksFromHtml(html)).toContain('https://example.com')
  })

  it('extracts Figma CDN image links', () => {
    const html = '<img src="https://api-cdn.figma.com/resize/images/123/thumb.png" />'
    expect(extractLinksFromHtml(html)).toContain('https://api-cdn.figma.com/resize/images/123/thumb.png')
  })

  it('prioritizes links with comment coordinates', () => {
    const html = `
      <img src="https://api-cdn.figma.com/resize/images/123/thumb.png" />
      <img src="https://api-cdn.figma.com/resize/images/456/comment.png?commentx=100&commenty=200" />
    `
    const links = extractLinksFromHtml(html)
    // Priority link should come first
    expect(links[0]).toContain('commentx=')
  })

  it('deduplicates links', () => {
    const html = `
      <a href="https://example.com">One</a>
      <a href="https://example.com">Two</a>
    `
    const links = extractLinksFromHtml(html)
    expect(links.filter(l => l === 'https://example.com')).toHaveLength(1)
  })

  it('ignores non-http links', () => {
    const html = '<a href="mailto:test@example.com">Email</a><a href="javascript:void(0)">JS</a>'
    expect(extractLinksFromHtml(html)).toHaveLength(0)
  })

  it('returns empty for HTML without links', () => {
    expect(extractLinksFromHtml('<p>No links here</p>')).toHaveLength(0)
  })
})

// ============================================================================
// extractFigmaLink
// ============================================================================
describe('extractFigmaLink', () => {
  it('finds universal="true" link (priority 1)', () => {
    const html = '<a universal="true" href="https://click.figma.com/abc123">View in Figma</a>'
    expect(extractFigmaLink(html)).toBe('https://click.figma.com/abc123')
  })

  it('finds "View in Figma" text link (priority 2)', () => {
    const html = '<a href="https://www.figma.com/file/abc123/Design">View in Figma</a>'
    expect(extractFigmaLink(html)).toBe('https://www.figma.com/file/abc123/Design')
  })

  it('finds "Open in Figma" text link', () => {
    const html = '<a href="https://www.figma.com/file/abc123/Design">Open in Figma</a>'
    expect(extractFigmaLink(html)).toBe('https://www.figma.com/file/abc123/Design')
  })

  it('finds click.figma.com link (priority 3)', () => {
    const html = '<a href="https://click.figma.com/tracking/abc">Click here</a>'
    expect(extractFigmaLink(html)).toBe('https://click.figma.com/tracking/abc')
  })

  it('finds direct figma.com/file/ link', () => {
    const html = '<a href="https://www.figma.com/file/abc123/Design">Link</a>'
    expect(extractFigmaLink(html)).toBe('https://www.figma.com/file/abc123/Design')
  })

  it('finds figma.com/design/ link', () => {
    const html = '<a href="https://www.figma.com/design/xyz789/Project">Link</a>'
    expect(extractFigmaLink(html)).toBe('https://www.figma.com/design/xyz789/Project')
  })

  it('returns null when no Figma link found', () => {
    const html = '<a href="https://example.com">Not Figma</a>'
    expect(extractFigmaLink(html)).toBeNull()
  })

  it('returns null for empty HTML', () => {
    expect(extractFigmaLink('')).toBeNull()
  })

  it('prefers universal="true" over other links', () => {
    const html = `
      <a href="https://www.figma.com/file/abc123/Design">View in Figma</a>
      <a universal="true" href="https://click.figma.com/priority-link">View in Figma</a>
    `
    expect(extractFigmaLink(html)).toBe('https://click.figma.com/priority-link')
  })
})

// ============================================================================
// normalizeText
// ============================================================================
describe('normalizeText', () => {
  it('converts to lowercase', () => {
    expect(normalizeText('Hello World')).toBe('hello world')
  })

  it('collapses whitespace', () => {
    expect(normalizeText('hello   world')).toBe('hello world')
  })

  it('trims leading/trailing whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello')
  })

  it('handles tabs and newlines', () => {
    expect(normalizeText('hello\n\tworld')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('')
  })
})

// ============================================================================
// fuzzyFindText
// ============================================================================
describe('fuzzyFindText', () => {
  it('finds exact match', () => {
    const haystack = ['hello world', 'goodbye world']
    expect(fuzzyFindText('hello world', haystack)).toBe('hello world')
  })

  it('finds match with different casing', () => {
    const haystack = ['Hello World', 'Goodbye World']
    expect(fuzzyFindText('hello world', haystack)).toBe('Hello World')
  })

  it('finds match with extra whitespace', () => {
    const haystack = ['hello  world', 'goodbye world']
    expect(fuzzyFindText('hello world', haystack)).toBe('hello  world')
  })

  it('returns null when no match meets threshold', () => {
    const haystack = ['completely different text']
    expect(fuzzyFindText('hello world', haystack)).toBeNull()
  })

  it('returns best match when multiple candidates above threshold', () => {
    const haystack = ['hello world!', 'hello world', 'goodbye world']
    expect(fuzzyFindText('hello world', haystack)).toBe('hello world')
  })

  it('respects custom threshold', () => {
    const haystack = ['hello worl'] // missing 'd' - ~0.91 similarity
    expect(fuzzyFindText('hello world', haystack, 0.95)).toBeNull()
    expect(fuzzyFindText('hello world', haystack, 0.8)).toBe('hello worl')
  })

  it('handles empty haystack', () => {
    expect(fuzzyFindText('hello', [])).toBeNull()
  })

  it('handles empty needle', () => {
    expect(fuzzyFindText('', ['hello'])).toBeNull()
  })
})

// ============================================================================
// findCommentByText
// ============================================================================
describe('findCommentByText', () => {
  const comments = [
    { message: 'Fix the button color', id: '1' },
    { message: 'Update the header layout', id: '2' },
    { message: 'Add responsive breakpoints', id: '3' },
  ]

  it('finds exact match', () => {
    const result = findCommentByText('Fix the button color', comments)
    expect(result).toEqual(comments[0])
  })

  it('finds fuzzy match', () => {
    const result = findCommentByText('fix the button colour', comments, 0.7)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('1')
  })

  it('returns null when no match', () => {
    const result = findCommentByText('something completely unrelated', comments)
    expect(result).toBeNull()
  })

  it('handles empty comments array', () => {
    expect(findCommentByText('hello', [])).toBeNull()
  })
})

// ============================================================================
// determineEmailType
// ============================================================================
describe('determineEmailType', () => {
  it('detects comment email from subject', () => {
    expect(determineEmailType('John commented on Design File', '')).toBe('comment')
  })

  it('detects mention email', () => {
    expect(determineEmailType('Jane mentioned you in Prototype', '')).toBe('comment')
  })

  it('detects invitation email', () => {
    expect(determineEmailType('You are invited to Project', '')).toBe('invitation')
  })

  it('detects shared email', () => {
    expect(determineEmailType('John shared Design File with you', '')).toBe('invitation')
  })

  it('returns unknown for unrecognized subjects', () => {
    expect(determineEmailType('Weekly Figma digest', '')).toBe('unknown')
  })

  it('is case-insensitive', () => {
    expect(determineEmailType('JOHN COMMENTED ON DESIGN', '')).toBe('comment')
  })
})

// ============================================================================
// extractFigmaMetadata
// ============================================================================
describe('extractFigmaMetadata', () => {
  it('extracts metadata from parsed email with file URL', () => {
    const parsed: ParsedEmail = {
      text: 'comment',
      links: ['https://www.figma.com/file/abc123/Design', 'https://example.com'],
      subject: 'John commented on Design',
    }
    const metadata = extractFigmaMetadata(parsed)
    expect(metadata.fileUrl).toBe('https://www.figma.com/file/abc123/Design')
    expect(metadata.emailType).toBe('comment')
  })

  it('uses fileKey from parsed email when no file URL in links', () => {
    const parsed: ParsedEmail = {
      text: 'comment',
      links: ['https://example.com'],
      fileKey: 'fallbackKey123',
    }
    const metadata = extractFigmaMetadata(parsed)
    expect(metadata.fileKey).toBe('fallbackKey123')
  })

  it('extracts file key from design URL in links', () => {
    const parsed: ParsedEmail = {
      text: 'comment',
      links: ['https://www.figma.com/design/myKey999/Project'],
      subject: 'commented on something',
    }
    const metadata = extractFigmaMetadata(parsed)
    expect(metadata.fileKey).toBe('myKey999')
  })

  it('returns unknown email type when no subject', () => {
    const parsed: ParsedEmail = {
      text: 'comment',
      links: [],
    }
    const metadata = extractFigmaMetadata(parsed)
    expect(metadata.emailType).toBe('unknown')
  })
})

// ============================================================================
// parseEmail (synchronous)
// ============================================================================
describe('parseEmail', () => {
  it('uses stripped-text when available', () => {
    const result = parseEmail({
      'stripped-text': 'Plain text comment',
      'body-html': '<p>HTML comment</p>',
    })
    expect(result.text).toBe('Plain text comment')
  })

  it('falls back to body-plain', () => {
    const result = parseEmail({
      'body-plain': 'Plain body text',
      'body-html': '<p>HTML comment</p>',
    })
    expect(result.text).toBe('Plain body text')
  })

  it('extracts text from HTML when no plain text', () => {
    const result = parseEmail({
      'body-html': '<div class="comment-body">HTML only comment</div>',
    })
    expect(result.text).toBe('HTML only comment')
  })

  it('extracts file key from sender email (priority 1)', () => {
    const result = parseEmail({
      from: 'comments-abc123XYZ@email.figma.com',
      'body-html': '<p>Comment</p>',
      'stripped-text': 'Comment',
    })
    expect(result.fileKey).toBe('abc123XYZ')
  })

  it('extracts file key from click.figma.com redirect URL (priority 2)', () => {
    const result = parseEmail({
      'body-html': '<a href="https://click.figma.com/redirect?url=https%3A%2F%2Fwww.figma.com%2Ffile%2FmyFileKey%2FDesign">View</a>',
      'stripped-text': 'text',
    })
    expect(result.fileKey).toBe('myFileKey')
  })

  it('extracts file key from direct link (priority 3)', () => {
    const result = parseEmail({
      'body-html': '<a href="https://www.figma.com/file/directKey123/Design">View</a>',
      'stripped-text': 'text',
    })
    expect(result.fileKey).toBe('directKey123')
  })

  it('extracts links from HTML', () => {
    const result = parseEmail({
      'body-html': '<a href="https://example.com">Link</a><a href="https://figma.com/file/abc/D">Figma</a>',
      'stripped-text': 'text',
    })
    expect(result.links).toHaveLength(2)
  })

  it('parses timestamp from seconds', () => {
    const result = parseEmail({
      timestamp: 1700000000,
      'stripped-text': 'text',
    })
    expect(result.timestamp).toBeInstanceOf(Date)
    expect(result.timestamp!.getTime()).toBe(1700000000 * 1000)
  })

  it('sets author from "from" field', () => {
    const result = parseEmail({
      from: 'user@example.com',
      'stripped-text': 'text',
    })
    expect(result.author).toBe('user@example.com')
  })

  it('sets subject', () => {
    const result = parseEmail({
      subject: 'John commented on Design',
      'stripped-text': 'text',
    })
    expect(result.subject).toBe('John commented on Design')
  })

  it('handles completely empty email data', () => {
    const result = parseEmail({})
    expect(result.text).toBe('')
    expect(result.links).toHaveLength(0)
    expect(result.fileKey).toBeUndefined()
  })

  it('extracts figmaLink from HTML', () => {
    const result = parseEmail({
      'body-html': '<a universal="true" href="https://click.figma.com/view-link">View in Figma</a>',
      'stripped-text': 'text',
    })
    expect(result.figmaLink).toBe('https://click.figma.com/view-link')
  })
})
