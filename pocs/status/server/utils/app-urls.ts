import generated from './app-urls.generated.json'

// Staging URL per app, discovered from every apps/*|pocs/* deploy.config.json by
// scripts/gen-app-urls.mjs (run before each build). Don't hand-edit the JSON.
const configs = generated as Record<string, { stagingUrl?: string, reviewLogin?: boolean }>

export interface AppTarget { stagingUrl: string | null, hasSignIn: boolean }

// null = unknown app. hasSignIn is false when the app opted out (reviewLogin: false).
export function appTargetFor(app: string): AppTarget | null {
  const cfg = Object.hasOwn(configs, app) ? configs[app] : undefined
  if (!cfg) return null
  return { stagingUrl: cfg.stagingUrl ?? null, hasSignIn: cfg.reviewLogin !== false }
}

export function stagingUrlFor(app: string): string | null {
  const t = appTargetFor(app)
  return t?.hasSignIn ? t.stagingUrl : null
}
