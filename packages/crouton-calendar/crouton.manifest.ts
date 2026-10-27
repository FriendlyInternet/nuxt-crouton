import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-calendar',
  name: 'Calendar',
  description: 'Swipeable week/month calendar views',
  icon: 'i-lucide-calendar-days',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when app needs a week/month calendar view of dated items',
  dependencies: [],
  provides: {
    components: [
      {
        name: 'CroutonCalendarWeek',
        description: 'Swipeable week strip (prev · current · next) with a #day slot and a #day-action slot',
        props: ['modelValue', 'weekStartsOn', 'size', 'selectedDate', 'activeDate', 'isDateDisabled']
      }
    ],
  },
})
