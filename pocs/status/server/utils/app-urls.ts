import kassa from '../../../../apps/kassa/deploy.config.json'
import velo from '../../../../apps/velo/deploy.config.json'
import bookingDemo from '../../../booking-demo/deploy.config.json'
import crate from '../../../crate/deploy.config.json'
import croutonBuilderDemo from '../../../crouton-builder-demo/deploy.config.json'
import croutonBuilder from '../../../crouton-builder/deploy.config.json'
import pins from '../../../pins/deploy.config.json'
import status from '../../deploy.config.json'

// Staging URL per app, read from each app's deploy.config.json at build time.
// Apps without sign-in or without a stagingUrl are simply absent from the lookup.
const configs: Record<string, { stagingUrl?: string, reviewLogin?: unknown }> = {
  'kassa': kassa,
  'velo': velo,
  'booking-demo': bookingDemo,
  'crate': crate,
  'crouton-builder-demo': croutonBuilderDemo,
  'crouton-builder': croutonBuilder,
  'pins': pins,
  'status': status
}

export function stagingUrlFor(app: string): string | null {
  const cfg = Object.hasOwn(configs, app) ? configs[app] : undefined
  if (!cfg || cfg.reviewLogin === false || !cfg.stagingUrl) return null
  return cfg.stagingUrl
}
