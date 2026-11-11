// Dropbox audio links (#2207). The Krater app is a PKCE public client, so a refresh needs only
// the app key + refresh token (no secret). Access tokens live 4 h, temporary links 4 h — both
// are cached in KV a little shorter so a cached value is never handed out expired.
import { kv } from 'hub:kv'

const CACHE_TTL = 3.5 * 60 * 60 // seconds

// The expiry travels with the value: local dev's fs KV driver ignores `ttl`, so without it a
// stale token got served forever and every play failed with Dropbox 401.
async function cacheGet(key: string): Promise<string | null> {
  const hit = await kv.get<{ value: string, exp: number }>(key)
  return hit && typeof hit === 'object' && hit.exp > Date.now() ? hit.value : null
}
function cacheSet(key: string, value: string) {
  return kv.set(key, { value, exp: Date.now() + CACHE_TTL * 1000 }, { ttl: CACHE_TTL })
}

async function accessToken(): Promise<string> {
  const cached = await cacheGet('crate:dropbox:token')
  if (cached) return cached
  const { DROPBOX_APP_KEY: key, DROPBOX_REFRESH_TOKEN: refresh } = process.env
  if (!key || !refresh) throw createError({ status: 500, statusText: 'Dropbox is not configured' })
  const res = await $fetch<{ access_token: string }>('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: key })
  })
  await cacheSet('crate:dropbox:token', res.access_token)
  return res.access_token
}

/** A ~4 h Dropbox download link for `path`; Dropbox serves Range requests, so Safari can seek. */
export async function dropboxTemporaryLink(path: string): Promise<string> {
  const cacheKey = `crate:dropbox:link:${path}`
  const cached = await cacheGet(cacheKey)
  if (cached) return cached
  const { link } = await $fetch<{ link: string }>('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}` },
    body: { path }
  })
  await cacheSet(cacheKey, link)
  return link
}
