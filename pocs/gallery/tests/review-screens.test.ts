import { describe, expect, it } from 'vitest'
import { selectScreens } from '../modules/review-pieces'
import { DEMO_TEAM_SLUG } from '../demo-team'

const page = (pkg: string, path: string) => ({ path, file: `/repo/packages/${pkg}/app/pages${path}.vue` })

describe('selectScreens', () => {
  it('credits each page to its package and fills in the demo team', () => {
    const out = selectScreens([page('crouton-bookings', '/dashboard/:team/bookings')])
    expect(out).toEqual([{ pkg: 'crouton-bookings', label: 'overview', to: `/dashboard/${DEMO_TEAM_SLUG}/bookings` }])
  })

  it('drops shared email-logs / email-templates pages', () => {
    const out = selectScreens([
      page('crouton-bookings', '/dashboard/:team/email-logs'),
      page('crouton-bookings', '/dashboard/:team/email-templates'),
    ])
    expect(out).toEqual([])
  })

  it('drops routes that need an :id, and pages outside packages', () => {
    const out = selectScreens([
      page('crouton-bookings', '/dashboard/:team/bookings/:id'),
      { path: '/dashboard/:team/x', file: '/repo/pocs/gallery/app/pages/x.vue' },
      page('crouton-bookings', '/about'),
    ])
    expect(out).toEqual([])
  })

  it('labels bookings as overview / locations / settings', () => {
    const out = selectScreens([
      page('crouton-bookings', '/dashboard/:team/bookings/settings'),
      page('crouton-bookings', '/dashboard/:team/bookings/locations'),
      page('crouton-bookings', '/dashboard/:team/bookings'),
    ])
    expect(out.map(s => s.label).sort()).toEqual(['locations', 'overview', 'settings'])
  })
})
