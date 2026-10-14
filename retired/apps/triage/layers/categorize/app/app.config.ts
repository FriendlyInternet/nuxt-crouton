export default defineAppConfig({
  croutonApps: {
    categorize: {
      id: 'categorize',
      name: 'categorize.title',
      icon: 'i-lucide-group',
      adminRoutes: [
        {
          path: '/categorize',
          label: 'categorize.title',
          icon: 'i-lucide-group',
        },
      ],
      dashboardRoutes: [],
      settingsRoutes: [],
    },
  },
})
