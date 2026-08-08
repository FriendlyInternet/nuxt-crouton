import { describe, expect, it } from 'vitest'
import { buildXlsx } from '../app/utils/xlsx-writer'

// buildXlsx hand-rolls a STORE (uncompressed) zip, so each part's raw bytes
// sit verbatim after its local file header — no zlib needed to read them back.
// Walk the local file headers by their PK\x03\x04 signature and match on the
// header's own name field. (Never scan for the part name as a raw byte
// needle: "sheet1.xml" also occurs INSIDE [Content_Types].xml's data, and a
// match there decodes garbage offsets.)
function extractPart(zip: Uint8Array, name: string): string {
  const decoder = new TextDecoder()
  let offset = 0
  // Local file header: sig(4) ver(2) flags(2) method(2) time(2) date(2)
  // crc(4) compSize(4) uncompSize(4) nameLen(2) extraLen(2) name(nameLen) data
  while (offset + 30 <= zip.length) {
    const sig = zip[offset]! | (zip[offset + 1]! << 8) | (zip[offset + 2]! << 16) | ((zip[offset + 3]! << 24) >>> 0)
    if (sig !== 0x04034b50) break // central directory reached
    const compSize = zip[offset + 18]! | (zip[offset + 19]! << 8)
      | (zip[offset + 20]! << 16) | (zip[offset + 21]! << 24)
    const nameLen = zip[offset + 26]! | (zip[offset + 27]! << 8)
    const extraLen = zip[offset + 28]! | (zip[offset + 29]! << 8)
    const entryName = decoder.decode(zip.subarray(offset + 30, offset + 30 + nameLen))
    const dataStart = offset + 30 + nameLen + extraLen
    if (entryName === name || entryName.endsWith(`/${name}`)) {
      return decoder.decode(zip.subarray(dataStart, dataStart + compSize))
    }
    offset = dataStart + compSize
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
