import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneDanglingCollectionRefs } from '../../../lib/utils/prune-dangling-collections.ts'

let dir: string
const read = (p: string) => readFile(join(dir, p), 'utf8')
const put = async (p: string, c: string) => {
  await mkdir(join(dir, p, '..'), { recursive: true })
  await writeFile(join(dir, p), c)
}
const mk = (p: string) => mkdir(join(dir, p), { recursive: true })

const BARREL = `export * from '@fyit/crouton-auth/server/database/schema/auth'
export { shopWidgets } from '../../layers/shop/collections/widgets/server/database/schema'
export { shopGadgets } from '../../layers/shop/collections/gadgets/server/database/schema'
export { shopGadgetsArchive } from '../../layers/shop/collections/gadgetsArchive/server/database/schema'
export * from '@fyit/crouton-i18n/server/database/schema/translations-ui'
`
const APP = `import { shopWidgetsConfig } from '../layers/shop/collections/widgets/app/composables/useShopWidgets'
import { shopGadgetsConfig } from '../layers/shop/collections/gadgets/app/composables/useShopGadgets'
import { shopGadgetsArchiveConfig } from '../layers/shop/collections/gadgetsArchive/app/composables/useShopGadgetsArchive'
import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

export default defineAppConfig({
  croutonCollections: {
    shopWidgets: shopWidgetsConfig,
    shopGadgets: shopGadgetsConfig,
    shopGadgetsArchive: shopGadgetsArchiveConfig,
    translationsUi: translationsUiConfig,
  }
})
`
const LAYER = `export default defineNuxtConfig({
  extends: ['./collections/widgets', './collections/gadgets', './collections/gadgetsArchive'],
})
`
const ROOT = `export default defineNuxtConfig({
  extends: ['@fyit/crouton-core', './layers/shop', './layers/old'],
})
`

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'crouton-prune-'))
  await put('server/db/schema.ts', BARREL)
  await put('app/app.config.ts', APP)
  await put('layers/shop/nuxt.config.ts', LAYER)
  await put('nuxt.config.ts', ROOT)
  await mk('layers/shop/collections/widgets')
  await mk('layers/shop/collections/gadgetsArchive')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('pruneDanglingCollectionRefs', () => {
  it('prunes the barrel, app.config and layer extends for a deleted collection', async () => {
    await pruneDanglingCollectionRefs({ cwd: dir })
    const barrel = await read('server/db/schema.ts')
    expect(barrel).not.toContain('shopGadgets }')
    expect(barrel).toContain('shopWidgets')
    expect(barrel).toContain('@fyit/crouton-auth/server/database/schema/auth')
    expect(barrel).toContain('translations-ui')
    const app = await read('app/app.config.ts')
    expect(app).not.toContain('shopGadgetsConfig')
    expect(app).not.toMatch(/shopGadgets:/)
    expect(app).toContain('shopWidgets')
    expect(app).toContain('translationsUi')
    const layer = await read('layers/shop/nuxt.config.ts')
    expect(layer).not.toContain("'./collections/gadgets'")
    expect(layer).toContain("'./collections/widgets'")
  })

  it('matches exactly: a longer-named neighbour survives in all three files', async () => {
    await pruneDanglingCollectionRefs({ cwd: dir })
    expect(await read('server/db/schema.ts')).toContain('shopGadgetsArchive')
    const app = await read('app/app.config.ts')
    expect(app).toContain('shopGadgetsArchiveConfig')
    expect(app).toMatch(/shopGadgetsArchive:/)
    expect(await read('layers/shop/nuxt.config.ts')).toContain("'./collections/gadgetsArchive'")
  })

  it('prunes a deleted layer from the root extends', async () => {
    await pruneDanglingCollectionRefs({ cwd: dir })
    const root = await read('nuxt.config.ts')
    expect(root).not.toContain('./layers/old')
    expect(root).toContain('@fyit/crouton-core')
    expect(root).toContain('./layers/shop')
  })

  it('is a byte-identical no-op when nothing dangles', async () => {
    await mk('layers/shop/collections/gadgets')
    await mk('layers/old')
    const before = await Promise.all(['server/db/schema.ts', 'app/app.config.ts', 'layers/shop/nuxt.config.ts', 'nuxt.config.ts'].map(read))
    const res = await pruneDanglingCollectionRefs({ cwd: dir })
    const after = await Promise.all(['server/db/schema.ts', 'app/app.config.ts', 'layers/shop/nuxt.config.ts', 'nuxt.config.ts'].map(read))
    expect(res.removed).toEqual([])
    expect(after).toEqual(before)
  })

  it('dryRun reports but writes nothing', async () => {
    const files = ['server/db/schema.ts', 'app/app.config.ts', 'layers/shop/nuxt.config.ts', 'nuxt.config.ts']
    const before = await Promise.all(files.map(read))
    const res = await pruneDanglingCollectionRefs({ cwd: dir, dryRun: true })
    expect(res.removed.length).toBeGreaterThan(0)
    expect(await Promise.all(files.map(read))).toEqual(before)
  })
})
