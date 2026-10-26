# CLAUDE.md - @fyit/crouton-calendar

## Package Purpose

Opt-in addon layer for a swipeable week/month calendar (epic #2574). Currently a scaffold: registers itself in `croutonApps` and provides a placeholder `CroutonCalendarWeek`.

Do not confuse with crouton-core's `CroutonCalendar` (a date-picker, `app/components/Calendar.vue`) — this package's components use the `CroutonCalendar` prefix with a suffix (e.g. `CroutonCalendarWeek`).

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer config (extends crouton-core, component prefix `CroutonCalendar`) |
| `app/app.config.ts` | Registers `calendar` in `croutonApps` |
| `app/components/Week.vue` | `CroutonCalendarWeek` placeholder; overrides the core stub |
| `crouton.manifest.ts` | Package manifest |

## Detection

Core ships a priority `-1` stub (`packages/crouton-core/app/components/stubs/CroutonCalendarWeek.vue`) so consumers never hit an unresolved component. Gate UI with `useCroutonApps().hasApp('calendar')`.

## Usage

```ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton-core', '@fyit/crouton-calendar']
})
```
