# CLAUDE.md - @fyit/crouton-charts

## Package Purpose

Chart visualizations for Nuxt Crouton applications. Wraps `nuxt-charts` (free base module with BarChart, LineChart, AreaChart, DonutChart) and connects chart components to crouton collections via `useCollectionChart`. Provides `CroutonChartsWidget` as a zero-config collection chart with auto-detection of numeric fields.

## Key Files

| File | Purpose |
|------|---------|
| `app/composables/useCollectionChart.ts` | Fetch + transform collection data for charting (auto-detects numeric fields) |
| `app/composables/useChartPalette.ts` | **Theme-aware series colors** (#1483): resolves `--ui-primary` (an OKLCH string) at runtime and returns a reactive `colorAt(index, total)`. Client-only + reactive to dark-mode / theme swaps (MutationObserver on `<html>`); SSR falls back to the static palette. `var()` can't go in an SVG `fill`/`stop-color`, so the primary must be a resolved literal — Nuxt UI already stores it as OKLCH, which renders directly, so **no color library is needed** |
| `app/utils/chart-constants.ts` | `CHART_COLOR_PALETTE` (static fallback) + `buildThemePalette(primary, count)` / `parseOklch` / `getChartColor(i, total, primary?)`. Palette derivation: 1 series → the primary; chromatic multi → series 0 = primary, rest sweep hue evenly at the same L/C; grayscale primary (chroma < 0.03, e.g. eink theme) → a lightness ramp so series stay distinct; no primary → the static 10-hue palette |
| `app/components/Widget.vue` | `CroutonChartsWidget` - collection-driven chart component |
| `nuxt.config.ts` | Layer config (extends crouton-core, registers nuxt-charts module) |
| `crouton.manifest.ts` | Package manifest for the crouton registry |

## CroutonChartsWidget Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `collection` | `string` | **required** | Collection key (e.g. `'blogPosts'`) |
| `type` | `'bar'\|'line'\|'area'\|'donut'` | `'bar'` | Chart type |
| `xField` | `string?` | auto from `display.title` | Field used as X axis |
| `yFields` | `string?` | auto-detected numeric | Comma-separated field names for Y values |
| `title` | `string?` | — | Optional heading above chart |
| `height` | `number` | `300` | Chart height in pixels |
| `stacked` | `boolean` | `false` | Stack series (bar/area only) |
| `orientation` | `'vertical'\|'horizontal'` | `'vertical'` | Chart orientation |

## Usage

### Standalone

```vue
<!-- Auto-detects numeric fields -->
<CroutonChartsWidget collection="monthlySales" type="bar" />

<!-- Explicit fields -->
<CroutonChartsWidget
  collection="monthlySales"
  type="line"
  x-field="month"
  y-fields="revenue,expenses"
  title="Monthly P&L"
  :height="400"
/>
```

### In nuxt.config.ts

```typescript
export default defineNuxtConfig({
  extends: ['@fyit/crouton-charts']
})
```

### useCollectionChart composable

```typescript
const { chartData, categories, pending, error, refresh } = useCollectionChart(
  'monthlySales',
  { xField: 'month', yFields: ['revenue', 'expenses'], limit: 50 }
)
```

## Adding Premium Charts

The base package includes 4 chart types from `nuxt-charts`. Premium charts (e.g., CalendarChart, ScatterChart) are downloaded as Vue source files via the CLI:

```bash
# Install CLI (one-time)
pnpm add -g nuxt-charts-cli

# Authenticate with your All-Access Pass token
nuxt-charts config set-token <your-token>

# Download a premium chart into your app
nuxt-charts add calendar
# → creates CalendarChart.vue in your project's components/
```

## Architecture

```
useCollectionChart(collection, options)
  → getConfig() for apiPath + display.title
  → useTeamContext() for teamId
  → $fetch(apiPath) for data
  → auto-detect numeric fields (if yFields not provided)
  → transform rows → [{ xField: value, yField1: num, yField2: num }]
  → assign colors via useChartPalette().colorAt (theme primary-derived, #1483)
  → return { chartData, categories, pending, error, refresh }
         ↓
CroutonChartsWidget
  → parses yFields prop (comma-separated string)
  → renders BarChart | LineChart | AreaChart | DonutChart
  → shows USkeleton while pending
  → shows UAlert on error
```

## Dependencies

- **Extends**: `@fyit/crouton-core`
- **npm**: `nuxt-charts` (BarChart, LineChart, AreaChart, DonutChart)
- **Peer**: `@nuxt/ui` (for USkeleton, UAlert, UIcon)

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
pnpm test           # Run vitest unit tests
```
