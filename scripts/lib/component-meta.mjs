/**
 * Shared component reader + Markdown escaping for the generated docs
 * (scripts/gen-api-reference.mjs, scripts/gen-package-docs.mjs). One reader, one set of rules.
 *
 * Needs `vue-component-meta`, so do not import this from a bare-Node `*.test.mjs`.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createCheckerByJson } = require('vue-component-meta')

/** Collapse runs of whitespace to one space and trim. */
export const squash = s => s.replace(/\s+/g, ' ').trim()
/** One table-cell-safe line: whitespace collapsed, pipes escaped. */
export const oneLine = s => squash(s).replace(/\|/g, '\\|')
/** Inline code span, safe inside a table cell. */
export const code = s => '`' + String(s).replace(/`/g, "'").replace(/\\?\|/g, '\\|') + '`'

/** Compiler options the reader uses for every package. */
export const READER_OPTIONS = { strict: true, skipLibCheck: true, module: 'esnext', moduleResolution: 'bundler', target: 'esnext' }

/** A vue-component-meta checker rooted at `dir`, reading the `include` globs. */
export const createReader = (dir, include) => createCheckerByJson(dir, { include, compilerOptions: READER_OPTIONS }, {})

/** Non-global props of the component in `file`: `{ name, type, required, doc, default }`. */
export function componentProps(reader, file) {
  return reader.getComponentMeta(file).props
    .filter(p => !p.global)
    .map(p => ({
      name: p.name,
      type: p.required ? p.type : p.type.replace(/ \| undefined$/, ''),
      required: p.required,
      doc: p.description ?? '',
      default: p.default
    }))
}
