import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// WS4 (#1451): buildSchemaExportNames became async (it resolves the barrel via the
// async getSchemaPath). A call site that forgets `await` gets a Promise, so
// `schemaIndexPath` is undefined → `addNamedSchemaExport` throws "path must be of
// type string" — the exact regression that broke every E2E fixture regen once. The
// unit tests exercise ONE call site; this grep-invariant guards ALL of them (incl.
// the batch runBatchDatabaseSetup loop the unit tests don't reach).

describe('buildSchemaExportNames is always awaited', () => {
  it('every call site in generate-collection.ts is preceded by `await`', () => {
    const src = readFileSync(resolve(__dirname, '../../lib/generate-collection.ts'), 'utf8')
    const offenders: string[] = []
    for (const line of src.split('\n')) {
      // a CALL (has `(`), not the declaration (`function`/`export`), missing `await`
      if (/\bbuildSchemaExportNames\s*\(/.test(line)
        && !/\bfunction\b/.test(line)
        && !/\bawait\s+buildSchemaExportNames\s*\(/.test(line)) {
        offenders.push(line.trim())
      }
    }
    expect(offenders).toEqual([])
  })
})
