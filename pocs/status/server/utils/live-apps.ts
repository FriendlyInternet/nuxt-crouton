// Live app list + open-PR previews, read from GitHub (cached ~5 min by ghFetch). No build-time list.
import type { H3Event } from 'h3'
import { ghFetch } from './github'
import { decidePrLogin, loadLiveApps, loadPreviews, type GhGet } from './live-apps-core'

const getter = (event: H3Event): GhGet => (path, opts) => ghFetch(event, path, opts)

export const listLiveApps = (event: H3Event) => loadLiveApps(getter(event))

/** One entry per open PR × app that has a deploy-staging comment. The open-PR list is always read live, so merged PRs never show. */
export const listPreviews = (event: H3Event) => loadPreviews(getter(event))

/** A `pr<N>` login: that PR's own state + comments, so a busy repo can't hide its deploy comment. */
export const resolvePrLogin = (event: H3Event, app: string, key: string) => decidePrLogin(getter(event), app, key)
