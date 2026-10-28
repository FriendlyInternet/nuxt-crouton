// Stamp hand-built test fields the way loadFields does for real ones: with the
// per-type `seed` / `testSample` from the real manifests (#2910).
import coreManifest from '../../../crouton-core/crouton.manifest.ts'
import editorManifest from '../../../crouton-editor/crouton.manifest.ts'
import { getTypeMapping } from '../../lib/utils/manifest-loader.ts'

export const typeMapping = getTypeMapping([coreManifest, editorManifest])

export function withManifest<T extends { type: string }>(fields: T[]): Array<T & { seed?: any, testSample?: string }> {
  return fields.map(f => ({
    ...f,
    seed: typeMapping[f.type]?.seed,
    testSample: typeMapping[f.type]?.testSample,
  }))
}
