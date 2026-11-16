/** Sync-feed ids carry a `device:` prefix the grant ids may not. */
export const bareDeviceId = (id: string | null | undefined): string => (id ?? '').replace(/^device:/, '')

/** First 8 chars of a device id, for display; `—` when empty. */
export const shortDeviceId = (id: string | null | undefined): string => bareDeviceId(id).slice(0, 8) || '—'
