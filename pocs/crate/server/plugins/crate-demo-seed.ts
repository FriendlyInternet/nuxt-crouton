// Seed the staging demo library when a team is created (#3299). The same seed also runs lazily
// from library.get.ts, so a staging team that already exists (and is empty) fills on next open.
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('crouton:operation', async (payload: any) => {
    if (payload?.type !== 'auth:team:created' || !payload.teamId || !demoSeedEnabled()) return
    const by = payload.userId ?? 'seed'
    await seedDemoLibrary({ teamId: payload.teamId, owner: by, createdBy: by, updatedBy: by })
  })
})
