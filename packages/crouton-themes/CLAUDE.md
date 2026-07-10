# CLAUDE.md - @fyit/crouton-themes

## Package Purpose

Swappable UI themes for Nuxt applications using Nuxt UI 4. Each theme is a self-contained Nuxt layer that provides design tokens, Nuxt UI component variants, and optional custom components. Themes are tree-shakeable via subpath exports.

## Key Files

| File | Purpose |
|------|---------|
| `package.json` | Subpath exports for each theme (`./ko`, `./brutalist`, etc.) |
| `{theme}/nuxt.config.ts` | Layer entry point - imports CSS, registers components |
| `{theme}/app.config.ts` | Nuxt UI theme overrides (variants, compoundVariants) |
| `{theme}/assets/css/main.css` | Design tokens (CSS custom properties), utility classes |
| `{theme}/components/` | Optional theme-specific components |

## Architecture

```
packages/nuxt-crouton-themes/
├── package.json              # Subpath exports
├── themes/                   # Theme switching utilities
│   ├── nuxt.config.ts        # Layer config
│   ├── composables/
│   │   └── useThemeSwitcher.ts # Theme switching composable
│   └── components/
│       └── ThemeSwitcher.vue   # UI component for theme switching
├── ko/                       # KO theme (Teenage Engineering inspired)
│   ├── nuxt.config.ts        # Layer config
│   ├── app.config.ts         # Nuxt UI variants
│   ├── assets/
│   │   ├── css/main.css      # Design tokens, ko-bezel classes
│   │   └── fonts/tt34.otf    # Tech font
│   └── components/           # KoLed, KoKnob, KoPanel, etc.
├── minimal/                  # Minimal theme (black lines, white bg)
│   ├── nuxt.config.ts        # Layer config
│   ├── app.config.ts         # Nuxt UI variants
│   └── assets/css/main.css   # Design tokens, minimal classes
├── kr11/                     # KR-11 theme (Korg rhythm box inspired)
│   ├── nuxt.config.ts        # Layer config
│   ├── app.config.ts         # Nuxt UI variants
│   ├── assets/css/main.css   # Design tokens, kr classes
│   └── components/           # KrDisplay, KrPad, KrLed, etc.
└── brutalist/                # Future theme
```

## Themes Layer (`./themes`)

The theming layer provides theme switching utilities that work across all themes. Includes a composable for managing theme state and a UI component for theme selection.

### useThemeSwitcher Composable

Manages theme state with SSR support and localStorage persistence.

```ts
const {
  currentTheme,        // Readonly ref of current theme name
  currentThemeConfig,  // Current theme config object
  variant,             // Computed variant for Nuxt UI (undefined for 'default')
  themes,              // Array of available theme configs
  setTheme,            // Function to set theme by name
  cycleTheme           // Function to cycle to next theme
} = useThemeSwitcher()
```

**Theme Names:** `'default' | 'ko' | 'minimal' | 'kr11'`

**Features:**
- SSR-compatible state via `useState`
- Persists to localStorage (`nuxt-crouton-theme`)
- Adds body class (`theme-ko`, `theme-minimal`, etc.) for CSS targeting
- Returns `undefined` variant for 'default' theme (uses Nuxt UI defaults)

### ThemeSwitcher Component

UI component for theme switching with three modes.

```vue
<!-- Dropdown selector (default) -->
<ThemeSwitcher />

<!-- Inline button group -->
<ThemeSwitcher mode="inline" />

<!-- Single button that cycles through themes -->
<ThemeSwitcher mode="cycle" />
```

**Props:**
- `mode`: `'dropdown' | 'inline' | 'cycle'` (default: `'dropdown'`)
- `size`: `'xs' | 'sm' | 'md' | 'lg'` (default: `'sm'`)

### Usage

```ts
// nuxt.config.ts - extend themes layer + specific themes
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-themes/themes',
    '@fyit/crouton-themes/ko',
    '@fyit/crouton-themes/minimal',
    '@fyit/crouton-themes/kr11'
  ]
})
```

```vue
<script setup>
const { variant } = useThemeSwitcher()
</script>

<template>
  <!-- Theme switcher in header -->
  <ThemeSwitcher />

  <!-- Components use selected theme variant -->
  <UButton :variant="variant" color="primary">Themed Button</UButton>
  <UInput :variant="variant" placeholder="Themed input" />
</template>
```

---

## Available Themes

### Brutalist Theme (`./brutalist`)

Thick borders, hard shadows, zero subtlety — the anti-"tasteful SaaS" theme.

**Design Language:**
- 3px black borders, hard offset box-shadows (no blur), square corners
- Off-white paper, near-black ink, shock-yellow accent, alarm-red error
- Uppercase 800-weight labels; states snap (75ms steps) instead of gliding
- Buttons lift on hover (+shadow) and slam flat on press (shadow to 0)

**Nuxt UI Variants:**
- Named variants `brutalist` / `brutalist-{solid,outline,soft,ghost,link}` for UButton;
  `brutalist` for UInput, UCard, UBadge, USeparator
- Color mappings: primary→yellow slab, neutral→ink slab, error→red slab

**Design Tokens:** `--brutalist-{paper,ink,accent,danger,border,shadow,shadow-hover,snap}`

**Coverage note:** interaction chrome only — no custom components; data surfaces
stay calm by design (see the chrome-vs-data rule, #1333).

### Minimal Theme (`./minimal`)

Super clean, minimalist design with black lines on white background.

**Design Language:**
- Black 2px borders, no rounded corners
- Pure white background, black text
- System font stack for modern, clean typography
- No shadows, no gradients - pure geometry
- Subtle hover states with color inversion

**Nuxt UI Variants:**
- `variant="minimal"` for UButton, UInput, UCard, USeparator
- Color mappings: primary→filled black, neutral→gray outline, error→red on hover

**CSS Utilities:**
- `.minimal-border` - 1px black border
- `.minimal-border-thick` - 2px black border
- `.minimal-grid` - Subtle grid pattern background
- `.minimal-hover-lift` - Hover lift animation
- `.minimal-font` / `.minimal-font-mono` - Typography

**Design Tokens:**
- `--minimal-white` / `--minimal-black`
- `--minimal-gray-50` through `--minimal-gray-900`
- `--minimal-border-width` / `--minimal-border-width-thick`
- `--minimal-radius` (0 for sharp corners)
- `--minimal-transition` (150ms ease)

---

### KR-11 Theme (`./kr11`)

Friendly, tactile styling inspired by the Korg KR-11 Compact Rhythm Box.

**Design Language:**
- Light gray chassis with soft shadows
- Cream-colored tactile pads with subtle depth
- Red LED 7-segment display on black background
- Colorful accent buttons (coral, gold, mint)
- Horizontal speaker grill pattern
- Rounded corners (8px pads, 12px cards)

**Nuxt UI Variants:**
- `variant="kr11"` for UButton, UInput, UCard, UBadge
- Color mappings: primary→mint, neutral→cream, warning→gold, error→coral

**Custom Components:**
- `<KrDisplay>` - 7-segment LED tempo display with blink animation
- `<KrPad>` - Tactile drum pad buttons (cream, coral, gold, mint)
- `<KrLed>` - Status LED indicators (yellow, green, with blink)
- `<KrKnob>` - Rotary control with drag interaction
- `<KrSpeakerGrill>` - Horizontal slot speaker pattern

**CSS Utilities:**
- `.kr-surface` / `.kr-surface-light` / `.kr-surface-dark`
- `.kr-display` / `.kr-display-text` - LED display styling
- `.kr-grill` / `.kr-grill-slots` - Speaker grill pattern
- `.kr-led` / `.kr-led--yellow` / `.kr-led--green` - LED indicators
- `.kr-knob` - Rotary knob styling
- `.kr-text-label` - Small uppercase labels
- `.kr-seam` - Panel seam divider

**Design Tokens:**
- Chassis: `--kr-chassis`, `--kr-chassis-light`, `--kr-chassis-dark`
- Display: `--kr-display-bg`, `--kr-display-red`, `--kr-display-red-glow`
- Pads: `--kr-pad-cream`, `--kr-pad-coral`, `--kr-pad-gold`, `--kr-pad-mint`
- LEDs: `--kr-led-yellow`, `--kr-led-green`, `--kr-led-off`

**Usage:**
```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton-themes/kr11']
})
```

```vue
<template>
  <!-- Nuxt UI with KR11 variants -->
  <UButton variant="kr11" color="primary">Play</UButton>
  <UButton variant="kr11" color="warning">Fill 1</UButton>
  <UButton variant="kr11" color="error">1</UButton>

  <!-- Custom KR components (auto-imported as Kr*) -->
  <KrDisplay value="120" :blink="isPlaying" />
  <KrPad color="mint" label="▶" @click="play" />
  <KrLed state="on" color="green" />
  <KrKnob v-model="tempo" :min="40" :max="240" />
  <KrSpeakerGrill :slots="8" />
</template>
```

---

### KO Theme (`./ko`)

Hardware-inspired styling based on the Teenage Engineering KO II sampler.

**Design Language:**
- Tactile button bevels with pseudo-element dark bezels
- LCD-style inputs with orange-on-dark aesthetic
- Hardware panel cards with inset shadows
- Industrial color palette (grays, orange, pink, blue, red)

**Nuxt UI Variants:**
- `variant="ko"` for UButton, UInput, UCard
- Color mappings: primary→orange, neutral→dark, error→red, secondary→pink, info→blue

**Custom Components:**
- `<KoLed>` - LED indicators with glow animations (off, on, blink, fast, alive)
- `<KoKnob>` - Rotary controls with drag interaction
- `<KoPanel>` - Display panels with glass overlay
- `<KoDisplay>` - 7-segment style readouts
- `<KoButton>` - Full tactile buttons with LED slots
- `<KoLabel>` - Hardware-style labels
- `<KoPunchHole>` - Decorative punch holes
- `<KoSpeakerGrill>` - Speaker grill pattern

## Usage

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton-themes/ko']
})
```

```vue
<template>
  <!-- Nuxt UI with KO variants -->
  <UButton variant="ko" color="primary">Orange</UButton>
  <UInput variant="ko" placeholder="LCD INPUT" />
  <UCard variant="ko">Hardware panel</UCard>

  <!-- Custom KO components (auto-imported as Ko*) -->
  <KoLed state="blink" />
  <KoKnob v-model="value" :min="0" :max="100" />
</template>
```

## Common Tasks

### Add a new theme

1. Create theme directory:
   ```bash
   mkdir -p packages/nuxt-crouton-themes/brutalist/{assets/css,components}
   ```

2. Create `nuxt.config.ts`:
   ```ts
   import { fileURLToPath } from 'node:url'
   import { join } from 'node:path'

   const currentDir = fileURLToPath(new URL('.', import.meta.url))

   export default defineNuxtConfig({
     $meta: {
       name: 'nuxt-crouton-themes/brutalist',
       description: 'Brutalist theme for Nuxt UI'
     },
     css: [join(currentDir, 'assets/css/main.css')],
     components: {
       dirs: [{
         path: join(currentDir, 'components'),
         prefix: 'Brutalist',
         global: true
       }]
     }
   })
   ```

3. Create `app.config.ts` with Nuxt UI overrides:
   ```ts
   export default defineAppConfig({
     ui: {
       colors: { primary: 'zinc', neutral: 'stone' },
       button: {
         variants: { variant: { brutalist: '' } },
         compoundVariants: [
           { variant: 'brutalist', class: 'brutalist-button' }
         ]
       }
     }
   })
   ```

4. Create `assets/css/main.css` with design tokens

5. Update package.json exports:
   ```json
   "exports": {
     "./ko": "./ko/nuxt.config.ts",
     "./brutalist": "./brutalist/nuxt.config.ts"
   }
   ```

### Add a component variant to existing theme

1. Edit `{theme}/app.config.ts`
2. Add to `variants.variant` object to register the variant name
3. Add `compoundVariants` entries for color combinations
4. Create corresponding CSS classes in `assets/css/main.css`

### Add design tokens

1. Edit `{theme}/assets/css/main.css`
2. Add CSS custom properties in `:root` block
3. Use in component styles: `var(--theme-token-name)`

### Add a custom component

1. Create `{theme}/components/ComponentName.vue`
2. Use `<script setup lang="ts">` with Composition API
3. Component auto-imports as `{Prefix}ComponentName` (e.g., `KoLed`)

## CSS Class Naming

Each theme should namespace its classes:

| Theme | Prefix | Example |
|-------|--------|---------|
| KO | `ko-` | `ko-bezel`, `ko-tactile`, `ko-input` |
| Minimal | `minimal-` | `minimal-btn`, `minimal-card`, `minimal-border` |
| KR-11 | `kr-` | `kr-pad`, `kr-display`, `kr-led` |
| Brutalist | `brutalist-` | `brutalist-button`, `brutalist-card` |

## Design Token Naming

Use theme-prefixed CSS custom properties:

```css
:root {
  /* KO theme */
  --ko-surface-light: #c7c3c0;
  --ko-accent-orange: #FA5F28;

  /* Minimal theme */
  --minimal-white: #ffffff;
  --minimal-black: #000000;

  /* KR-11 theme */
  --kr-chassis: #e5e2dd;
  --kr-pad-mint: #7ee8c7;

  /* Brutalist theme */
  --brutalist-bg: #000;
  --brutalist-border: 4px solid #fff;
}
```

## Nuxt UI Theming Pattern

The key insight for Nuxt UI 4 theming:

1. **Register variant** in `variants.variant` object (can be empty string)
2. **Apply styles** via `compoundVariants` array matching variant + color
3. **Use CSS classes** rather than inline Tailwind for complex effects

```ts
// app.config.ts
export default defineAppConfig({
  ui: {
    button: {
      variants: {
        variant: {
          ko: ''  // Register 'ko' as valid variant
        }
      },
      compoundVariants: [
        {
          color: 'primary',
          variant: 'ko',
          class: 'ko-bezel ko-bezel--orange'  // Apply CSS classes
        }
      ]
    }
  }
})
```

### Two theming modes: additive (variants) vs subtractive (replacers)

The pattern above is **additive** — a named `variant` + `compoundVariants` *add*
CSS classes on top of Nuxt UI's defaults, which still get merged in via
`tailwind-merge`. You can override conflicting utilities, but you **cannot remove**
a default (rounded/shadow/ring), which is why the older theme CSS leans on
`!important` to win the specificity war.

**Nuxt UI ≥ 4.9 ([PR #6562](https://github.com/nuxt/ui/pull/6562)) adds the missing
"subtract" lever:** a slot value can be a `(defaults) => classes` **function** that
**replaces** the slot's resolved defaults instead of merging onto them (a string
still merges). It works in `app.config.ui`, the per-instance `:ui` prop, and
`<UTheme>`. Because the function receives the *fully resolved* default string, you
can transform rather than blank it (keep layout, drop only decorative utilities):

```ts
// any theme's app.config.ts — the SHARED marker-gated replacer (#1304)
import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: { button: { slots: { base: subtractThemeDefaults } } }
})
```

**All four themes use one shared replacer: `lib/subtractive.ts` (#1304).** It is
**marker-gated**: the resolved string it receives contains the theme's own marker
classes (`ko-bezel`, `kr-pad`, `bw-solid`, `minimal-btn`, …) injected by that
theme's variants, so one function detects *which* theme is in play and applies
that theme's subtraction set — and passes unmarked (default-theme) renders
through untouched. This is what makes a global replacer safe in a MULTI-theme
app (the playground): each theme only subtracts under its own markers. Per-theme
sets: `minimal` drops decorative only (rounded/shadow/ring, the #364 behaviour);
`ko`/`kr11` also own color, motion and typography; `bw` keeps Nuxt UI's rounding
and text sizes. **`focus-visible:` classes are never stripped** (no theme ships
its own button focus styles — a11y guard; minimal predates the guard).
Result: the theme CSS needs **no `!important`** (three deliberate `padding`
exceptions remain — spacing utilities are never stripped — each commented).

**Hard constraints (verified against `@nuxt/ui` `dist/runtime/utils/tv.ts`):**

| | Additive (variant) | Subtractive (replacer) |
|---|---|---|
| Where read | `variants` / `compoundVariants` | top-level `base`/`slots`, per-instance `:ui`, `<UTheme>` |
| Scope | per **named variant** (opt-in: `variant="minimal"`) | **global** to every instance / a `<UTheme>` subtree / one component |
| Can subtract defaults | ❌ merge-only | ✅ replaces |
| Runtime theme switching (`ThemeSwitcher`) | ✅ per-component `:variant` | ⚠️ a global `app.config` replacer can't be switched off per-component; use `<UTheme>` for a switchable subtree |

- **Replacers are NOT variant-scoped.** `extractDirectives` only reads top-level
  `base`/`slots` — a function inside `variants.variant.minimal.base` is ignored. So
  subtractive theming is a *global/subtree/per-instance* tool, orthogonal to the
  variant system; the two modes coexist (every theme's button uses both).
- **Keep replacers pure & deterministic** so SSR and client compute the same string
  (no hydration mismatch) — the original reason this package avoided base overrides.
- **The defu double-role gotcha (#1304):** Nuxt merges layered app.configs with
  defu's *fn* variant, which treats a FUNCTION value as a merger and CALLS it with
  the lower layer's value. Several layers assign the shared replacer to the same
  slot key, so `subtractThemeDefaults` guards: called with a non-string (merge
  time) it returns itself, so the merged value stays the replacer. Any new
  replacer-style function in an app.config needs the same guard.
- **Multi-theme apps are safe** with the shared replacer because of marker gating
  (above). A *custom, un-gated* replacer is still global — gate it on a marker
  class or scope it with `<UTheme>`.

Spike: #364; rollout to all themes: #1304.

### Runtime switching swaps SCALARS only (deepAssign hazard) — #1304

`updateAppConfig()` merges with Nuxt's `deepAssign`, which merges **arrays by
index** — a runtime write to `compoundVariants` overwrites whatever entries sit
at those indices in the built config (this silently broke the named variants on
every switch). Hence the split:

- **Layer app.config (build-time, merge-safe):** ALL classes — named variants
  (`ko`, `kr11`, `minimal*`, `bw-*`) + their `compoundVariants` + replacers.
- **`themes/configs/themeConfigs.ts` (runtime):** scalar leaves only —
  `colors.*` and `<component>.defaultVariants.variant`, pointing plain
  variant-less usage at the theme's named variant. Every config sets EVERY key
  the swap owns, so switching A → B never leaves A's value behind.

Consequences: a plain `<UButton>` follows the active theme; an **explicit**
`variant="outline"` is the author's literal choice and stays default-styled —
use `useThemeSwitcher().getVariant('outline')` to follow the theme (`ko-outline`,
`bw-outline`, …). `blackandwhite` registers **named `bw-*` variants** (it no
longer overrides the standard variant slots, which used to bleed into every
other theme in a multi-theme app) and sets its own layer
`defaultVariants.variant: 'bw-solid'` so single-theme bw apps still need no
runtime. The theme restore from localStorage runs **onMounted** (never during
setup — the server can't know localStorage, so a setup-time restore is a
guaranteed hydration mismatch). And in `ThemeSwitcher.vue`, per-item slot names
are prefixed `theme-<name>` — a slot literally named `default` overrides the
dropdown's trigger slot (the chip froze on "Default" forever).

## Dev workflow — the playground (#1306)

`packages/crouton-themes/playground/` is a **private, in-package** Nuxt app (never
published — the package's `files` whitelist in `package.json` never lists it) that
doubles as:

- **The daily dev surface.** It `extends` every theme layer via **relative paths**
  (`../themes`, `../ko`, `../minimal`, `../kr11`, `../blackandwhite`) instead of the
  package's own subpath `exports`, so editing any theme's `main.css` / `app.config.ts`
  hot-reloads instantly — no build step, no reinstall.
- **The theme gallery** used as the shared sign-off surface (ui-proposal, #307) for
  every theme this epic (#1303) touches — one preview URL, every theme side-by-side,
  instead of one sandbox per theme.

```bash
pnpm --filter crouton-themes-playground dev   # http://localhost:3031
```

The showcase page renders one set of themed components (buttons, inputs, card,
separator, badge, switch, dropdown, modal) plus `<ThemeSwitcher>`; flipping the
switcher restyles the whole page live via `useThemeSwitcher()`'s `updateAppConfig()`
swap — nothing is re-implemented per theme.

It **supersedes** the old `sandboxes/minimal-theme-demo` (single-theme, #368/#380),
retired in the same change that added the playground.

**Workspace glob:** `packages/*` in `pnpm-workspace.yaml` is one level only — the
playground is registered via an extra `packages/*/playground` entry, or `pnpm install`
won't pick it up.

## Dependencies

- **Peer deps**: `@nuxt/ui ^4.0.0`, `nuxt ^4.0.0`
- **No runtime deps** - themes are pure CSS/config

## Testing

```bash
# Test in the playground (all themes, one page)
pnpm --filter crouton-themes-playground dev

# Or in ko-ui app
cd apps/ko-ui
pnpm dev

# Typecheck
pnpm --filter crouton-themes-playground typecheck
```

## File Size Considerations

- Keep fonts optimized (subset if possible)
- Avoid importing entire icon sets
- Each theme should be < 50KB (excluding fonts)
