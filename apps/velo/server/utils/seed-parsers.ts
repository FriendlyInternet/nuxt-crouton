/**
 * Shared pure parsing helpers for the seed endpoints
 * (POST /api/seed and POST /api/seed/velosolidaire).
 */

/** Parse a CSV string, handling quoted fields that may contain commas */
export function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n')
  const headers = parseCSVLine(lines[0]!)
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] ?? '').trim()
    })
    return row
  })
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

/** Parse YAML frontmatter from markdown (simple parser, no external deps) */
export function parseFrontmatter(md: string): { data: Record<string, any>; content: string } {
  const match = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: md }
  return {
    data: parseSimpleYaml(match[1]!),
    content: match[2]!.trim()
  }
}

/** Remove one pair of matching surrounding quotes from a top-level value */
function stripMatchingQuotes(value: string): string {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1)
  }
  return value
}

/** Remove surrounding quotes from a mail field value (single quotes, then double) */
function stripFieldQuotes(value: string): string {
  let result = value
  if (result.startsWith("'") && result.endsWith("'")) {
    result = result.slice(1, -1)
  }
  if (result.startsWith('"') && result.endsWith('"')) {
    result = result.slice(1, -1)
  }
  return result
}

/** Read a folded block scalar (>-, >, >+) under a 4-space-indented mail field */
function readFoldedBlock(lines: string[], start: number): { text: string; next: number } {
  const bodyLines: string[] = []
  let i = start
  while (i < lines.length) {
    const bodyLine = lines[i]!
    // Stop at a new field at same or higher level
    if (bodyLine.match(/^\s{4}\w+:/) || bodyLine.match(/^\s{2}\w+:/) || (bodyLine.match(/^\w/) && !bodyLine.match(/^\s/))) break
    bodyLines.push(bodyLine.replace(/^\s{6}/, ''))
    i++
  }
  return { text: bodyLines.join('\n').trim(), next: i }
}

/** Read a literal block scalar (|-) under a top-level key */
function readLiteralBlock(lines: string[], start: number): { text: string; next: number } {
  const bodyLines: string[] = []
  let i = start
  while (i < lines.length) {
    const bodyLine = lines[i]!
    if (bodyLine.match(/^\w+:/) && !bodyLine.startsWith(' ')) break
    bodyLines.push(bodyLine.replace(/^\s{2}/, ''))
    i++
  }
  return { text: bodyLines.join('\n').trim(), next: i }
}

/** Parse the 4-space-indented fields of one mail entry */
function parseMailFields(lines: string[], start: number): { mail: Record<string, string>; next: number } {
  const mailObj: Record<string, string> = {}
  let i = start
  while (i < lines.length) {
    const fieldLine = lines[i]!
    if (fieldLine.match(/^\s{2}\w+:/) || (fieldLine.match(/^\w/) && !fieldLine.match(/^\s/))) break

    const fieldMatch = fieldLine.match(/^\s{4}(\w+):\s*(.*)$/)
    if (!fieldMatch) { i++; continue }

    const fKey = fieldMatch[1]!
    const fVal = fieldMatch[2]!.trim()

    // Handle multi-line values (>-, >, >+)
    if (fVal === '>-' || fVal === '>' || fVal === '>+') {
      const block = readFoldedBlock(lines, i + 1)
      mailObj[fKey] = block.text
      i = block.next
      continue
    }

    mailObj[fKey] = stripFieldQuotes(fVal)
    i++
  }
  return { mail: mailObj, next: i }
}

/** Parse the nested mails structure (2-space-indented mail types) */
function parseMailsBlock(lines: string[], start: number): { mails: Record<string, any>; next: number } {
  const mailsResult: Record<string, any> = {}
  let i = start
  while (i < lines.length) {
    const mailLine = lines[i]!
    if (mailLine.match(/^\w/) && !mailLine.match(/^\s/)) break // new top-level key

    const typeMatch = mailLine.match(/^\s{2}(\w+):/)
    if (!typeMatch) { i++; continue }

    const parsed = parseMailFields(lines, i + 1)
    mailsResult[typeMatch[1]!] = parsed.mail
    i = parsed.next
  }
  return { mails: mailsResult, next: i }
}

/** Minimal YAML parser sufficient for our frontmatter structure */
export function parseSimpleYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {}
  const lines = yaml.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    // Skip empty lines
    if (line.trim() === '') { i++; continue }

    // Top-level key detection
    const topMatch = line.match(/^(\w+):\s*(.*)$/)
    if (!topMatch) { i++; continue }

    const key = topMatch[1]!

    if (key === 'mails') {
      const parsed = parseMailsBlock(lines, i + 1)
      result[key] = parsed.mails
      i = parsed.next
      continue
    }

    const value = stripMatchingQuotes(topMatch[2]!.trim())

    // Handle multi-line values (|-)
    if (value === '|-') {
      const block = readLiteralBlock(lines, i + 1)
      result[key] = block.text
      i = block.next
      continue
    }

    result[key] = value === '""' || value === "''" ? '' : value
    i++
  }

  return result
}

/** Parse a date string like "2026/01/01" or "2026/1/1" into a Date (UTC midnight) */
export function parseDate(dateStr: string): Date {
  const parts = dateStr.trim().split('/')
  const year = parseInt(parts[0]!, 10)
  const month = parseInt(parts[1]!, 10) - 1
  const day = parseInt(parts[2]!, 10)
  return new Date(Date.UTC(year, month, day))
}

/** Parse a datetime string like "2025/12/12, 11:13" into a Date */
export function parseDateTime(dtStr: string): Date {
  const cleaned = dtStr.trim()
  const [datePart, timePart] = cleaned.split(',').map(s => s.trim())
  const dateParts = datePart!.split('/')
  const year = parseInt(dateParts[0]!, 10)
  const month = parseInt(dateParts[1]!, 10) - 1
  const day = parseInt(dateParts[2]!, 10)
  if (timePart) {
    const [hours, minutes] = timePart.split(':').map(s => parseInt(s, 10))
    return new Date(Date.UTC(year, month, day, hours!, minutes!))
  }
  return new Date(Date.UTC(year, month, day))
}

/** Convert old template vars to crouton-bookings format and wrap in HTML */
export function convertEmailBody(text: string): string {
  if (!text) return ''
  return text
    .replace(/%NAME%/g, '{{customer_name}}')
    .replace(/%BOOKING%/g, '{{booking_date}} - {{booking_slot}} @ {{location_name}}')
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p>${p.trim()}</p>`)
    .join('')
}
