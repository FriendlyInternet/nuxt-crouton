# CLAUDE.md - @fyit/crouton-calendar

## Package Purpose

Opt-in addon layer for swipeable week/month calendar views (epic #2574).

This is NOT crouton-core's `CroutonCalendar` date picker — do not touch that.

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer config; components registered with prefix `CroutonCalendar` at `priority: -1` (stubs, overridable) |
| `app/app.config.ts` | Registers `calendar` in `croutonApps` |
| `app/components/Week.vue` | `CroutonCalendarWeek` — swipeable week strip; slots `#day` (indicators) and `#day-action` (per-day hover action); emits `select` |
| `app/components/Month.vue` | `CroutonCalendarMonth` — swipeable month grid (3-panel `UCalendar` track); slot `#day` (`neighbour` flag); emits `select` |
| `app/composables/useSlideSwipe.ts` | Swipe/slide behaviour |
| `i18n/locales/*.json` | `calendar.week.*` / `calendar.month.*` keys (en/fr/nl) |

## Usage

```ts
extends: ['@fyit/crouton-core', '@fyit/crouton-calendar']
```

Detect from other packages with `useCroutonApps().hasApp('calendar')`.
