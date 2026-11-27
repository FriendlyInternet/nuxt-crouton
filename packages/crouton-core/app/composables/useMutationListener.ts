import type { CroutonMutationEvent } from '../../crouton-hooks'

/**
 * Listen to the `crouton:mutation` hook (a record was created/updated/deleted/
 * moved/reordered). Call it before any `await` in a composable (a top-level
 * `await` before it is fine in `<script setup>`) so the Nuxt context + effect
 * scope are still active; the listener is removed when that scope is disposed.
 * App-lifetime listeners in plugins keep `nuxtApp.hook` on purpose.
 */
export function useMutationListener(handler: (event: CroutonMutationEvent) => void | Promise<void>) {
  const stop = useNuxtApp().hook('crouton:mutation', handler)
  if (getCurrentScope()) onScopeDispose(stop)
  return stop
}
