// cli-args.mjs — the tiny no-deps `--flag [value]` parser shared by the harness
// scripts (eval-ledger, pi-box). Extracted from its three clones (#1238).
//
// Semantics: `--key value` → { key: 'value' }; a bare `--key` (or one whose next
// token is another flag) → { key: true }. Non-flag tokens are skipped. Keys listed
// in `boolean` never consume the next token, even when it isn't a flag.

/** Is `tok` a value token (present and not itself a `--flag`)? */
export function isValue(tok) {
  return tok !== undefined && !tok.startsWith('--')
}

/** Parse argv (already sliced past node + script path) into a flat flags object. */
// fallow-ignore-next-line complexity — 11-line parser consolidated from three clones (#1238); CRAP inflated by 0 coverage
export function parseArgs(argv, { boolean = [] } = {}) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    if (boolean.includes(key)) { out[key] = true; continue }
    out[key] = isValue(argv[i + 1]) ? argv[++i] : true
  }
  return out
}
