/**
 * Pure clipboard → structured-preview parser for the product paste-import (#1652/#1655).
 *
 * No UI, no DB, no network. Clipboard text in → a labelled, structured preview out:
 * delimiter detected, columns mapped to product fields, prices + Dutch decimals read,
 * every row stamped `new` / `warn-creates-relation` / `warn-duplicate` / `error`.
 *
 * Both the import modal (#1657, client preview) and the bulk-import endpoint (#1656,
 * server re-validation) lean on this. The server NEVER trusts the client's parse — it
 * re-runs this — so this module is the single source of truth for the parse contract.
 *
 * STATUS: signed off 2026-08-03 (#1655) — implemented against the committed contract in
 * `test/parse-product-paste.test.ts`. The sign-off resolved the epic's one ambiguity in
 * favour of the How-to-test reading: a clean row that happens to introduce a new
 * category/location is `new`, and the creation surfaces once in `relationsToCreate` (one
 * banner) rather than shouting `warn-creates-relation` on all 30 rows. That status stays
 * in the union, reserved and unemitted, so the UI can switch without a type change.
 */

export type Delimiter = 'tab' | 'semicolon' | 'comma'

export type ImportableField =
  | 'title'
  | 'price'
  | 'categoryTitle'
  | 'locationTitle'
  | 'description'
  | 'isActive'
  | 'requiresRemark'
  | 'remarkPrompt'

export type RowStatus = 'new' | 'warn-creates-relation' | 'warn-duplicate' | 'error'

export interface HeaderMapping {
  /** Original header cell text from the pasted first row. */
  name: string
  /** The field this column maps to (by name/alias, trimmed + case-insensitive), or null. */
  field: ImportableField | null
}

export interface ParsedProductRow {
  /** 1-based index of the data row in the original paste (header excluded). */
  rowIndex: number
  status: RowStatus
  title?: string
  price?: number
  categoryTitle?: string
  locationTitle?: string
  description?: string
  isActive?: boolean
  requiresRemark?: boolean
  remarkPrompt?: string
  /** Reason, when `status === 'error'`. */
  error?: string
  /** Existing title this row clashes with, when `status === 'warn-duplicate'`. */
  duplicateOf?: string
  /** Per-row user toggle for duplicates — default false (skip). The UI flips this. */
  create?: boolean
}

export interface RelationToCreate {
  kind: 'category' | 'location'
  title: string
}

export interface ParseOptions {
  /** Existing product titles on this event — used to flag `warn-duplicate`. */
  existingProductTitles?: string[]
  /** Existing category titles on this event — used to flag `warn-creates-relation`. */
  existingCategoryTitles?: string[]
  /** Existing location titles on this event — used to flag `warn-creates-relation`. */
  existingLocationTitles?: string[]
}

export interface ParseResult {
  delimiter: Delimiter
  headers: HeaderMapping[]
  /** Count of trailing all-empty columns that were dropped (not offered for mapping). */
  droppedTrailingColumns: number
  rows: ParsedProductRow[]
  /** Deduped (kind + normalized title) create-list, derived from importable-by-default rows. */
  relationsToCreate: RelationToCreate[]
}

/**
 * Parse a pasted spreadsheet blob into a structured preview.
 *
 * Contract (locked by `test/parse-product-paste.test.ts`):
 *  - delimiter detection order: tab → semicolon → comma (first that splits a row >1 col)
 *  - header row required (first non-blank line); columns matched by name/alias, trimmed + case-insensitive
 *  - trailing all-empty columns dropped
 *  - price: `3`, `3.50`, `3,50`, `€ 3,50`, `€3.50` → decimal; missing/empty/unparseable → error
 *  - booleans: `ja/nee`, `yes/no`, `true/false`, `1/0`, `x`
 *  - row status: error (missing title / unreadable price) > warn-duplicate (title exists) > warn-creates-relation (unknown cat/loc) > new
 *  - relationsToCreate: deduped unknown category/location titles from importable-by-default rows (new + warn-creates-relation)
 *  - resilience: a malformed row degrades to one error row; it never aborts the batch
 */
/** Column header → field, matched trimmed + case-insensitive. EN + NL. */
const HEADER_ALIASES: Record<string, ImportableField> = {
  'name': 'title',
  'product name': 'title',
  'naam': 'title',
  'titel': 'title',
  'title': 'title',
  'price': 'price',
  'prijs': 'price',
  'category': 'categoryTitle',
  'categorie': 'categoryTitle',
  'location': 'locationTitle',
  'prep location': 'locationTitle',
  'locatie': 'locationTitle',
  'description': 'description',
  'omschrijving': 'description',
  'active': 'isActive',
  'is active': 'isActive',
  'actief': 'isActive',
  'requires remark': 'requiresRemark',
  'opmerking vereist': 'requiresRemark',
  'remark prompt': 'remarkPrompt',
  'opmerking prompt': 'remarkPrompt',
}

const TRUTHY = new Set(['ja', 'yes', 'true', '1', 'x'])
const FALSY = new Set(['nee', 'no', 'false', '0'])

/** Normalized key for trimmed, case-insensitive matching of titles and headers. */
function norm(value: string): string {
  return value.trim().toLowerCase()
}

function detectDelimiter(lines: string[]): Delimiter {
  if (lines.some(l => l.includes('\t'))) return 'tab'
  if (lines.some(l => l.includes(';'))) return 'semicolon'
  return 'comma'
}

const SPLIT_ON: Record<Delimiter, string> = { tab: '\t', semicolon: ';', comma: ',' }

/**
 * `3` · `3.50` · `3,50` · `€ 3,50` · `€3.50` → number. Anything else → null.
 * The comma is a DECIMAL separator here (nl locale), never a thousands separator —
 * this parser only ever sees single-cell prices, so there is no ambiguity to resolve.
 */
function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[€$\s]/g, '').replace(',', '.')
  if (!cleaned) return null
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseBoolean(raw: string): boolean | undefined {
  const v = norm(raw)
  if (TRUTHY.has(v)) return true
  if (FALSY.has(v)) return false
  return undefined
}

/** Split into a rectangular grid, padding ragged rows so columns stay aligned. */
function buildTable(input: string): { table: string[][], delimiter: Delimiter, width: number } {
  const lines = (input ?? '').split(/\r?\n/).filter(l => l.trim() !== '')
  const delimiter = detectDelimiter(lines)
  const table = lines.map(l => l.split(SPLIT_ON[delimiter]))
  const width = Math.max(0, ...table.map(r => r.length))
  for (const row of table) while (row.length < width) row.push('')
  return { table, delimiter, width }
}

/**
 * How many trailing columns are empty in EVERY row, header included — a spreadsheet
 * habitually pastes a few. A column blank in some rows but filled in others is real
 * data and is kept.
 */
function countTrailingEmptyColumns(table: string[][], width: number): number {
  let effective = width
  while (effective > 0 && table.every(r => (r[effective - 1] ?? '').trim() === '')) effective--
  return width - effective
}

function mapHeaders(cells: string[]): HeaderMapping[] {
  return cells.map(name => ({ name: name.trim(), field: HEADER_ALIASES[norm(name)] ?? null }))
}

/**
 * Which fields are plain text vs booleans. A lookup rather than a switch: adding a
 * column becomes a one-line table entry instead of another branch in a growing
 * `switch` (`price` stays special — it is the only one that reports parse failure).
 */
const TEXT_FIELDS = new Set<ImportableField>([
  'title', 'categoryTitle', 'locationTitle', 'description', 'remarkPrompt',
])
const BOOLEAN_FIELDS = new Set<ImportableField>(['isActive', 'requiresRemark'])

/** Read one row's cells into fields. Reports whether a price column was present/parseable. */
function readRowFields(
  cells: string[],
  headers: HeaderMapping[],
  row: ParsedProductRow,
): { priceSeen: boolean, priceBad: boolean } {
  let priceSeen = false
  let priceBad = false
  headers.forEach((header, c) => {
    const field = header.field
    if (!field) return
    const raw = (cells[c] ?? '').trim()
    if (field === 'price') {
      priceSeen = true
      const n = parsePrice(raw)
      if (n === null) priceBad = true
      else row.price = n
    } else if (TEXT_FIELDS.has(field)) {
      if (raw) (row as unknown as Record<string, unknown>)[field] = raw
    } else if (BOOLEAN_FIELDS.has(field)) {
      const b = parseBoolean(raw)
      if (b !== undefined) (row as unknown as Record<string, unknown>)[field] = b
    }
  })
  return { priceSeen, priceBad }
}

/**
 * Status precedence: error > warn-duplicate > new. A bad row is RECORDED, never thrown —
 * one mangled line must not cost the other 29.
 */
function classifyRow(
  row: ParsedProductRow,
  price: { priceSeen: boolean, priceBad: boolean },
  existingProducts: Set<string>,
): void {
  if (!row.title) {
    row.status = 'error'
    row.error = 'Missing product name'
    return
  }
  if (!price.priceSeen) {
    row.status = 'error'
    row.error = 'Missing price column'
    return
  }
  if (price.priceBad || row.price === undefined) {
    row.status = 'error'
    row.error = 'Unreadable price'
    return
  }
  if (existingProducts.has(norm(row.title))) {
    row.status = 'warn-duplicate'
    row.duplicateOf = row.title
    row.create = false
    return
  }
  row.status = 'new'
  row.create = true
}

/**
 * Accumulate the category/location titles this import would have to create. Keyed
 * `kind:normalizedTitle` so `Bar` and `bar` collapse to one; the FIRST spelling wins.
 * Only rows that will actually be imported justify creating a relation.
 */
function collectRelations(
  row: ParsedProductRow,
  known: { categories: Set<string>, locations: Set<string> },
  into: Map<string, RelationToCreate>,
): void {
  if (row.status !== 'new') return
  const pairs: Array<[RelationToCreate['kind'], string | undefined, Set<string>]> = [
    ['category', row.categoryTitle, known.categories],
    ['location', row.locationTitle, known.locations],
  ]
  for (const [kind, title, existing] of pairs) {
    if (!title || existing.has(norm(title))) continue
    const key = `${kind}:${norm(title)}`
    if (!into.has(key)) into.set(key, { kind, title })
  }
}

export function parseProductPaste(input: string, options: ParseOptions = {}): ParseResult {
  const { table, delimiter, width } = buildTable(input)
  const droppedTrailingColumns = countTrailingEmptyColumns(table, width)
  const effectiveWidth = width - droppedTrailingColumns
  const headers = mapHeaders((table[0] ?? []).slice(0, effectiveWidth))

  const existingProducts = new Set((options.existingProductTitles ?? []).map(norm))
  const known = {
    categories: new Set((options.existingCategoryTitles ?? []).map(norm)),
    locations: new Set((options.existingLocationTitles ?? []).map(norm)),
  }

  const rows: ParsedProductRow[] = []
  const relations = new Map<string, RelationToCreate>()

  for (let i = 1; i < table.length; i++) {
    const row: ParsedProductRow = { rowIndex: i, status: 'new' }
    const price = readRowFields(table[i]!.slice(0, effectiveWidth), headers, row)
    classifyRow(row, price, existingProducts)
    collectRelations(row, known, relations)
    rows.push(row)
  }

  return {
    delimiter,
    headers,
    droppedTrailingColumns,
    rows,
    relationsToCreate: [...relations.values()],
  }
}
