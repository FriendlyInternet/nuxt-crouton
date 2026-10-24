// Dropbox audio links (#2207). The Krater app is a PKCE public client, so a refresh needs only
// the app key + refresh token (no secret). Access tokens live 4 h, temporary links 4 h — both
// are cached in KV a little shorter so a cached value is never handed out expired.
import { kv } from 'hub:kv'

const CACHE_TTL = 3.5 * 60 * 60 // seconds

async function accessToken(): Promise<string> {
  const cached = await kv.get<string>('crate:dropbox:token')
  if (cached) return cached
  const { DROPBOX_APP_KEY: key, DROPBOX_REFRESH_TOKEN: refresh } = process.env
  if (!key || !refresh) throw createError({ status: 500, statusText: 'Dropbox is not configured' })
  const res = await $fetch<{ access_token: string }>('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: key })
  })
  await kv.set('crate:dropbox:token', res.access_token, { ttl: CACHE_TTL })
  return res.access_token
}

/** A ~4 h Dropbox download link for `path`; Dropbox serves Range requests, so Safari can seek. */
export async function dropboxTemporaryLink(path: string): Promise<string> {
  const cacheKey = `crate:dropbox:link:${path}`
  const cached = await kv.get<string>(cacheKey)
  if (cached) return cached
  const { link } = await $fetch<{ link: string }>('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}` },
    body: { path }
  })
  await kv.set(cacheKey, link, { ttl: CACHE_TTL })
  return link
}
