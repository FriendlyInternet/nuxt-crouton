/**
 * Upload route tests (#3132): type allow-list, ownership prefix, delete
 * authorization, serve headers. Handlers are imported with Nitro auto-imports
 * stubbed as globals; ensureBlob mirrors NuxtHub's (empty `types` skips the check).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  session: { user: { id: 'u1' }, session: { activeOrganizationId: 'A' as string | null } },
  role: 'member' as string | null,
  allowedTypes: undefined as string[] | undefined,
  file: new File(['x'], 'a.png', { type: 'image/png' }),
  headResult: { contentType: 'image/png' } as any,
  headError: null as any
}

const blob = {
  put: vi.fn(async (name: string, _f: unknown, opts: any) => ({ pathname: `${opts.prefix}/${name}` })),
  delete: vi.fn(async () => {}),
  head: vi.fn(async () => { if (state.headError) throw state.headError; return state.headResult }),
  serve: vi.fn(async () => 'served')
}

vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook: () => Promise.resolve() } }) }))
vi.mock('@fyit/crouton-auth/server/utils/useServerAuth', () => ({ requireServerSession: async () => state.session }))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => {
    if (!state.role) throw Object.assign(new Error('Not a team member'), { status: 403 })
    return { team: { id: state.session.session.activeOrganizationId }, membership: { role: state.role } }
  },
  requireTeamAdmin: async () => {
    if (state.role !== 'admin' && state.role !== 'owner') throw Object.assign(new Error('Requires admin'), { status: 403 })
  }
}))

const headers: Record<string, string> = {}
let body: any = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(headers)) delete headers[k]
  state.session = { user: { id: 'u1' }, session: { activeOrganizationId: 'A' } }
  state.role = 'member'
  state.allowedTypes = undefined
  state.headResult = { contentType: 'image/png' }
  state.headError = null
  vi.stubGlobal('defineEventHandler', (h: any) => h)
  vi.stubGlobal('eventHandler', (h: any) => h)
  vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText || o.message), o))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { croutonUpload: { maxSize: '10MB', allowedTypes: state.allowedTypes } } }))
  vi.stubGlobal('readFormData', async () => ({ get: (k: string) => (k === 'file' ? state.file : null) }))
  vi.stubGlobal('readBody', async () => body)
  vi.stubGlobal('blob', blob)
  vi.stubGlobal('ensureBlob', (file: Blob, o: { types?: string[] }) => {
    if (o.types?.length && !o.types.includes(file.type)) {
      throw new Error(`File type is invalid, must be: ${o.types.join(', ')}`)
    }
  })
  vi.stubGlobal('setResponseHeaders', (_e: unknown, h: Record<string, string>) => Object.assign(headers, h))
  vi.stubGlobal('setResponseHeader', (_e: unknown, k: string, v: string) => { headers[k] = v })
})

const upload = async (type: string, name = 'f.bin') => {
  state.file = new File(['x'], name, { type })
  const mod = await import('../../server/api/upload-image.post')
  return (mod.default as any)({})
}
const reject = async (p: Promise<unknown>, status: number) => {
  await expect(p).rejects.toMatchObject({ status })
}

describe('POST upload-image', () => {
  it.each(['text/html', 'video/mp4'])('rejects %s with 400', async (type) => {
    await reject(upload(type), 400)
    expect(blob.put).not.toHaveBeenCalled()
  })

  it('accepts svg', async () => {
    await upload('image/svg+xml', 'logo.svg')
    expect(blob.put).toHaveBeenCalled()
  })

  it('accepts png under the team prefix', async () => {
    await upload('image/png', 'a.png')
    expect(blob.put.mock.calls[0]![2]).toMatchObject({ prefix: 'teams/A', addRandomSuffix: true })
  })

  it('accepts pdf and docx', async () => {
    await upload('application/pdf', 'a.pdf')
    await upload('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')
    expect(blob.put).toHaveBeenCalledTimes(2)
  })

  it('treats allowedTypes: [] as the defaults (the bug)', async () => {
    state.allowedTypes = []
    await reject(upload('text/html'), 400)
  })

  it('uses users/<id> prefix without an active team', async () => {
    state.session.session.activeOrganizationId = null
    await upload('image/png', 'a.png')
    expect(blob.put.mock.calls[0]![2]).toMatchObject({ prefix: 'users/u1' })
  })

  it('403 for a non-member of the active team', async () => {
    state.role = null
    await reject(upload('image/png'), 403)
    expect(blob.put).not.toHaveBeenCalled()
  })
})

describe('DELETE upload-image', () => {
  const del = async (pathname: string) => {
    body = { pathname }
    const mod = await import('../../server/api/upload-image.delete')
    return (mod.default as any)({})
  }

  it('403 for another team path', async () => {
    await reject(del('teams/other/x.png'), 403)
    expect(blob.delete).not.toHaveBeenCalled()
  })
  it('403 for plain member on own team, ok for admin', async () => {
    await reject(del('teams/A/x.png'), 403)
    state.role = 'admin'
    await del('teams/A/x.png')
    expect(blob.delete).toHaveBeenCalledWith('teams/A/x.png')
  })
  it('own user path ok, other user 403', async () => {
    await del('users/u1/x.png')
    await reject(del('users/u2/x.png'), 403)
    expect(blob.delete).toHaveBeenCalledTimes(1)
  })
  it('403 on traversal', async () => {
    state.role = 'admin'
    await reject(del('teams/A/../B/x'), 403)
    await reject(del('teams/A/%2e%2e/B/x'), 403)
    expect(blob.delete).not.toHaveBeenCalled()
  })
})

describe('GET images/[...pathname]', () => {
  const get = async () => {
    const mod = await import('../../server/routes/images/[...pathname].get')
    return (mod.default as any)({ context: { params: { pathname: 'teams/A/x' } } })
  }
  it('nosniff, no attachment for png', async () => {
    await get()
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Content-Disposition']).toBeUndefined()
  })
  it.each(['application/pdf'])('attachment for %s', async (contentType) => {
    state.headResult = { contentType }
    await get()
    expect(headers['Content-Disposition']).toBe('attachment')
  })
  it('svg with script/onload is served sandboxed, nosniff, attachment', async () => {
    state.headResult = { contentType: 'image/svg+xml' }
    await get()
    expect(headers['Content-Security-Policy']).toBe("sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Content-Disposition']).toBe('attachment')
  })
  it('svg logo still renders in an <img> (served as an image type, not blocked)', async () => {
    state.headResult = { contentType: 'image/svg+xml; charset=utf-8' }
    await get()
    expect(headers['Content-Security-Policy']).toContain('sandbox')
    expect(blob.serve).toHaveBeenCalled()
  })
  it('missing file is 404', async () => {
    state.headError = { statusCode: 404 }
    await reject(get(), 404)
  })
})
