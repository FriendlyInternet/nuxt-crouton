import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-auth',
  name: 'Authentication',
  description: 'Authentication with Better Auth - teams, billing, passkeys, 2FA',
  icon: 'i-lucide-shield',
  version: '1.0.0',
  category: 'core',
  bundled: true,
  dependencies: [],
  collections: [
    { name: 'user', tableName: 'user', description: 'User accounts' },
    { name: 'session', tableName: 'session', description: 'Active sessions' },
    { name: 'account', tableName: 'account', description: 'OAuth accounts' },
    { name: 'verification', tableName: 'verification', description: 'Email verification tokens' },
    { name: 'organization', tableName: 'organization', description: 'Teams/organizations' },
    { name: 'member', tableName: 'member', description: 'Team members' },
    { name: 'invitation', tableName: 'invitation', description: 'Team invitations' },
    { name: 'passkey', tableName: 'passkey', description: 'WebAuthn passkeys' },
    { name: 'twoFactor', tableName: 'twoFactor', description: 'Two-factor auth config' },
    { name: 'subscription', tableName: 'subscription', description: 'Stripe subscriptions' },
    { name: 'domain', tableName: 'domain', description: 'Custom domains' },
    { name: 'scopedAccessToken', tableName: 'scopedAccessToken', description: 'Scoped API tokens' },
    { name: 'teamSettings', tableName: 'teamSettings', description: 'Per-team settings' },
  ],
  provides: {
    composables: ['useAuth', 'useTeamContext'],
    components: [],
  },
})
