/**
 * Read a `packages/<pkg>/crouton.manifest.ts` statically via the TypeScript AST — nothing is
 * executed. Shared by scripts/gen-api-reference.mjs and scripts/component-names.mjs (#3898).
 *
 *   evalLiteral(node)  — statically evaluate a literal expression (strings, numbers, booleans,
 *                        arrays, objects); anything else is `undefined`
 *   manifestOf(file)   — the object literal passed to `defineCroutonManifest(...)` in a
 *                        ROOT-relative file, or null
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const ts = require('typescript')

const rd = p => readFileSync(join(ROOT, p), 'utf8')
const sf = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const walk = (node, fn) => { fn(node); ts.forEachChild(node, c => walk(c, fn)) }

const propKey = p => (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : null)
function evalObject(n) {
  const o = {}
  for (const p of n.properties) {
    const k = ts.isPropertyAssignment(p) ? propKey(p) : null
    if (k) o[k] = evalLiteral(p.initializer)
  }
  return o
}
const LITERAL_KEYWORDS = new Map([[ts.SyntaxKind.TrueKeyword, true], [ts.SyntaxKind.FalseKeyword, false]])

const evalScalar = (n) => {
  if (ts.isStringLiteralLike(n)) return n.text
  if (ts.isNumericLiteral(n)) return Number(n.text)
  return LITERAL_KEYWORDS.get(n.kind)
}
const isScalar = n => ts.isStringLiteralLike(n) || ts.isNumericLiteral(n) || LITERAL_KEYWORDS.has(n.kind)

/** Statically evaluate a literal expression (strings, numbers, booleans, arrays, objects). */
export function evalLiteral(n) {
  if (!n) return undefined
  if (isScalar(n)) return evalScalar(n)
  if (ts.isArrayLiteralExpression(n)) return n.elements.map(evalLiteral)
  if (ts.isObjectLiteralExpression(n)) return evalObject(n)
  return undefined
}

/** The literal passed to `defineCroutonManifest(...)` in a ROOT-relative file, or null. */
export function manifestOf(file) {
  const s = sf(file, rd(file))
  let o = null
  walk(s, (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(s) === 'defineCroutonManifest') o = evalLiteral(n.arguments[0])
  })
  return o
}
