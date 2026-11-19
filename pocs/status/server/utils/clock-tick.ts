// One clock tick (#4133): start each due workflow with `workflow_dispatch`, as the Harness App.
// Called by server/plugins/clock.ts on the Worker's `scheduled()` event. Never throws.
import { dueJobs } from './clock-jobs'
import { mintInstallationToken } from './github-app'
import { ghPost } from './github-core'

const REPO = 'FriendlyInternet/nuxt-crouton'

export interface TickResult {
  workflow: string
  status: number | null
}

export async function onTick(
  scheduledTime: number,
  env: Record<string, unknown>,
  fetchFn: typeof fetch = fetch
): Promise<TickResult[]> {
  const results: TickResult[] = []
  try {
    if (env?.CLOCK_ENABLED !== '1') return results
    const due = dueJobs(new Date(scheduledTime))
    if (!due.length) return results
    let token: string
    try {
      token = await mintInstallationToken({
        appId: String(env.HARNESS_APP_ID ?? ''),
        privateKey: String(env.HARNESS_APP_PRIVATE_KEY ?? ''),
        installationId: String(env.HARNESS_APP_INSTALLATION_ID ?? '')
      }, 'crouton-status', fetchFn)
    } catch (e) {
      console.log(`clock: token → ${e instanceof Error ? e.message : String(e)}`)
      return results
    }
    for (const job of due) {
      const r = await ghPost(`/repos/${REPO}/actions/workflows/${job.workflow}/dispatches`, token, { ref: 'main', inputs: { clock: 'true' } }, fetchFn)
      console.log(`clock: ${job.workflow} → ${r.status ?? r.error}`)
      results.push({ workflow: job.workflow, status: r.status })
    }
  } catch (e) {
    console.log(`clock: tick failed → ${e instanceof Error ? e.message : String(e)}`)
  }
  return results
}
