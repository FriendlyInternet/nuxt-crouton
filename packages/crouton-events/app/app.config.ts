export default defineAppConfig({
  // Actions this package guards (#4104) — see crouton-auth CLAUDE.md "Permissions (actions)".
  croutonActions: {
    'activity:view': { label: 'permissions.activityView' }
  },

  // App auto-discovery registration for crouton-events
  croutonApps: {
    events: {
      id: 'events',
      name: 'events.title',
      icon: 'i-lucide-activity',
      adminRoutes: [
        {
          path: '/activity',
          label: 'events.admin.activity',
          icon: 'i-lucide-activity'
        }
      ],
      dashboardRoutes: [],
      settingsRoutes: []
    }
  }
})
