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
 * STATUS: test-first contract committed FAILING (#774). Implementation lands only after
 * the test cases are signed off. This stub carries the types the test compiles against
 * and throws so every test is red.
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
export function parseProductPaste(_input: string, _options?: ParseOptions): ParseResult {
  throw new Error('parseProductPaste: not implemented — test-first contract pending sign-off (#1655)')
}
