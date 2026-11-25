# CLAUDE.md - @fyit/crouton-calendar

## Package Purpose

Opt-in addon layer for swipeable week/month calendar views (epic #2574).

This is NOT crouton-core's `CroutonCalendar` date picker — do not touch that.

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer config; components registered with prefix `CroutonCalendar` at `priority: -1` (stubs, overridable) |
| `app/app.config.ts` | Registers `calendar` in `croutonApps` |
| `app/components/Week.vue` | `CroutonCalendarWeek` — swipeable week strip; slots `#day` (indicators), `#day-action` (per-day hover action) and `#header-end` (right end of the label row); emits `select` and `today` (label tapped, #4516); panels keyed by week start (#3917) |
| `app/components/Month.vue` | `CroutonCalendarMonth` — swipeable month grid (3-panel `UCalendar` track); slots `#day` (`neighbour` flag) and `#header-end` (right end of the label row); emits `select` and `today` (label tapped, #4516); panels keyed by the month they show (a step builds one new panel, #3917) |
| `app/composables/useSlideSwipe.ts` | Swipe/slide behaviour |
| `app/composables/useHoldHeight.ts` | Holds the swipe strip's height for good (min-height, measured on mount and on width change, grows with content) — stops the page jumping on a swipe (#3924, #3813) |
| `test/panels.test.ts` | Panel-identity tests (happy-dom, real Month/Week) |
| `test/hold-height.test.ts` | Height-hold tests (happy-dom, real Month/Week, stubbed layout + ResizeObserver) |
| `i18n/locales/*.json` | `calendar.week.*` / `calendar.month.*` keys (en/fr/nl) |

## Usage

```ts
extends: ['@fyit/crouton-core', '@fyit/crouton-calendar']
```

Detect from other packages with `useCroutonApps().hasApp('calendar')`.
