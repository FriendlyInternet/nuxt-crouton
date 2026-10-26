import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-calendar',
  name: 'Calendar',
  description: 'Swipeable week/month calendar view for collections',
  icon: 'i-lucide-calendar-days',
  version: '0.1.0',
  category: 'addon',
  aiHint: 'use when app needs a week or month calendar view of dated items',
  dependencies: [],
  provides: {
    components: [
      {
        name: 'CroutonCalendarWeek',
        description: 'Week view (placeholder, implementation pending)',
        props: ['modelValue']
      },
    ],
  },
})
