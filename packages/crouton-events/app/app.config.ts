export default defineAppConfig({
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
