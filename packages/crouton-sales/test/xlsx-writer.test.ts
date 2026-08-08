import { describe, expect, it } from 'vitest'
import { buildXlsx } from '../app/utils/xlsx-writer'

// buildXlsx hand-rolls a STORE (uncompressed) zip, so each part's raw bytes
// sit verbatim after its local file header — no zlib needed to read them back.
function extractPart(zip: Uint8Array, name: string): string {
  const decoder = new TextDecoder()
  const needle = new TextEncoder().encode(name)
  for (let i = 0; i < zip.length - needle.length; i++) {
    if (zip[i] === needle[0] && zip.subarray(i, i + needle.length).every((b, j) => b === needle[j])) {
      // Local file header: sig(4) ver(2) flags(2) method(2) time(2) date(2)
      // crc(4) compSize(4) uncompSize(4) nameLen(2) extraLen(2) name(nameLen) data
      const headerStart = i - 26
      const nameLen = zip[headerStart + 26]! | (zip[headerStart + 27]! << 8)
      const extraLen = zip[headerStart + 28]! | (zip[headerStart + 29]! << 8)
      const compSize = zip[headerStart + 18]! | (zip[headerStart + 19]! << 8)
        | (zip[headerStart + 20]! << 16) | (zip[headerStart + 21]! << 24)
      const dataStart = headerStart + 30 + nameLen + extraLen
      return decoder.decode(zip.subarray(dataStart, dataStart + compSize))
    }
  }
  throw new Error(`part not found: ${name}`)
}

describe('buildXlsx', () => {
  it('produces a valid zip with a PK local-file-header signature', () => {
    const zip = buildXlsx('Sheet1', [['Product', 'Units'], ['Bread', 3]])
    expect(zip[0]).toBe(0x50) // 'P'
    expect(zip[1]).toBe(0x4b) // 'K'
  })

  it('writes numeric cells as real <v> numbers, not inline strings', () => {
    const zip = buildXlsx('Sheet1', [['Product', 'Price', 'Total'], ['Bread', 2.5, 7.5]])
    const sheet = extractPart(zip, 'sheet1.xml')

    // Header row: text cells use inlineStr
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t>Product</t></is></c>')
    // Data row: numeric cells carry a bare <v> node (no t="inlineStr"), so
    // Excel treats them as real numbers — SUM/aggregate formulas just work.
    expect(sheet).toContain('<c r="B2"><v>2.5</v></c>')
    expect(sheet).toContain('<c r="C2"><v>7.5</v></c>')
    expect(sheet).not.toContain('<c r="B2" t="inlineStr">')
  })

  it('escapes XML-significant characters in string cells', () => {
    const zip = buildXlsx('Sheet1', [['Bread & Butter <fresh>']])
    const sheet = extractPart(zip, 'sheet1.xml')
    expect(sheet).toContain('Bread &amp; Butter &lt;fresh&gt;')
  })

  it('names columns past Z correctly (A..Z, AA, AB, ...)', () => {
    const row = Array.from({ length: 28 }, (_, i) => i)
    const zip = buildXlsx('Sheet1', [row])
    const sheet = extractPart(zip, 'sheet1.xml')
    expect(sheet).toContain('<c r="Z1">')
    expect(sheet).toContain('<c r="AA1">')
    expect(sheet).toContain('<c r="AB1">')
  })
})
