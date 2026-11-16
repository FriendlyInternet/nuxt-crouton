import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-admin',
  name: 'Admin Dashboard',
  description: 'Admin dashboard components for user/team management and impersonation',
  icon: 'i-lucide-settings',
  version: '1.0.0',
  category: 'core',
  bundled: true,
  dependencies: ['@fyit/crouton-auth'],
  provides: {
    composables: ['useAdminUsers', 'useAdminTeams', 'useAdminStats', 'useImpersonation'],
    components: [
      { name: 'Dashboard', description: 'Super admin dashboard' },
      { name: 'ImpersonationBanner', description: 'Fixed top banner shown while an admin is impersonating a user' },
    ],
  },
})
