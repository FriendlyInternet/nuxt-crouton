# CLAUDE.md - @fyit/crouton-calendar

## Package Purpose

Opt-in addon layer for swipeable week/month calendar views (epic #2574). Currently a scaffold: the package and a stub component only; implementations are moved in by later steps.

This is NOT crouton-core's `CroutonCalendar` date picker — do not touch that.

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer config; components registered with prefix `CroutonCalendar` at `priority: -1` (stubs, overridable) |
| `app/app.config.ts` | Registers `calendar` in `croutonApps` |
| `app/components/WeekView.vue` | Stub `CroutonCalendarWeekView` |

## Usage

```ts
extends: ['@fyit/crouton-core', '@fyit/crouton-calendar']
```

Detect from other packages with `useCroutonApps().hasApp('calendar')`.
