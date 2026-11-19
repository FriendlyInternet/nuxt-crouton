/**
 * Form Collab Plugin (Client-only)
 *
 * Initializes form presence tracking only when the app is opted in (`"collab": true`
 * deploy flag → `collabWorkerUrl`); its same-host socket runs only in local dev (#3810).
 * This plugin watches for slideover/modal state changes in useCrouton and
 * establishes WebSocket presence connections for active edit forms.
 *
 * The .client.ts suffix ensures this only runs on the client side.
 */
import { useFormCollabPresence } from '../composables/useFormCollabPresence'
import { isCollabEnabled } from '../composables/useCollabConnection'

export default defineNuxtPlugin(() => {
  // Not opted into live sync → no presence tracking (#3810)
  if (!isCollabEnabled(useRuntimeConfig().public.collabWorkerUrl, import.meta.env.DEV)) return

  // Initialize form collab presence tracking
  // This watches croutonStates and manages WebSocket connections
  useFormCollabPresence()
})
