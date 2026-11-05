/**
 * Re-run `refresh` when a remote client changed `collection` (the
 * `crouton:remoteChange` hook, fired by crouton-collab). Call it before any
 * `await` so the Nuxt context + effect scope are still active; the hook is
 * removed when that scope is disposed.
 */
export function useRemoteCollectionRefresh(collection: string, refresh: () => unknown) {
  const stop = useNuxtApp().hook('crouton:remoteChange' as any, (event: { collection: string }) => {
    if (event?.collection === collection) return refresh()
  })
  if (getCurrentScope()) onScopeDispose(stop)
}
