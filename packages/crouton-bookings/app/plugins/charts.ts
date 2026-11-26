/**
 * Bookings Chart Presets
 *
 * Registers pre-configured booking charts in the crouton-charts preset registry.
 * Only active when @fyit/crouton-charts is also installed (gracefully degrades).
 *
 * Each preset points to an aggregation endpoint that returns pre-grouped data,
 * ready for CroutonChartsWidget to render without any manual field configuration.
 */
export default defineNuxtPlugin(() => {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore Optional auto-import from crouton-charts: unresolved when bookings loads alone, resolved when both layers load
    const { registerChartPreset } = useCroutonChartRegistry()

    registerChartPreset({
      id: 'bookings:by-date',
      name: 'Bookings by Date',
      description: 'Monthly booking volume',
      icon: 'i-lucide-calendar',
      package: 'crouton-bookings',
      config: {
        apiPath: '/api/crouton-bookings/teams/{teamId}/charts/bookings-by-date',
        type: 'bar',
        xField: 'date',
        yFields: 'count',
        title: 'bookings.charts.byDate.title'
      }
    })

    registerChartPreset({
      id: 'bookings:by-location',
      name: 'Bookings by Location',
      description: 'Total bookings per location',
      icon: 'i-lucide-map-pin',
      package: 'crouton-bookings',
      config: {
        apiPath: '/api/crouton-bookings/teams/{teamId}/charts/bookings-by-location',
        type: 'bar',
        xField: 'location',
        yFields: 'count',
        title: 'bookings.charts.byLocation.title'
      }
    })

    registerChartPreset({
      id: 'bookings:by-status',
      name: 'Bookings by Status',
      description: 'Distribution of booking statuses',
      icon: 'i-lucide-pie-chart',
      package: 'crouton-bookings',
      config: {
        apiPath: '/api/crouton-bookings/teams/{teamId}/charts/bookings-by-status',
        type: 'donut',
        xField: 'status',
        yFields: 'count',
        title: 'bookings.charts.byStatus.title'
      }
    })

    registerChartPreset({
      id: 'bookings:by-slot',
      name: 'Bookings by Slot',
      description: 'Popular time slots',
      icon: 'i-lucide-clock',
      package: 'crouton-bookings',
      config: {
        apiPath: '/api/crouton-bookings/teams/{teamId}/charts/bookings-by-slot',
        type: 'bar',
        xField: 'slot',
        yFields: 'count',
        title: 'bookings.charts.bySlot.title'
      }
    })

    registerChartPreset({
      id: 'bookings:by-group',
      name: 'Bookings by Group',
      description: 'Breakdown by age group or category',
      icon: 'i-lucide-users',
      package: 'crouton-bookings',
      config: {
        apiPath: '/api/crouton-bookings/teams/{teamId}/charts/bookings-by-group',
        type: 'bar',
        xField: 'group',
        yFields: 'count',
        title: 'bookings.charts.byGroup.title'
      }
    })
  }
  catch {
    // crouton-charts not installed — skip preset registration
  }
})
