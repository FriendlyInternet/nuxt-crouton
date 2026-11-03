export default defineAppConfig({
  // App auto-discovery registration for crouton-calendar
  croutonApps: {
    calendar: {
      id: 'calendar',
      name: 'Calendar',
      icon: 'i-lucide-calendar-days',
      apiRoutes: [],
      adminRoutes: [],
      dashboardRoutes: [],
      settingsRoutes: []
    }
  }
})
