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

### Three theming modes: additive (variants), subtractive (replacers), unstyled

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
// minimal/app.config.ts — strip rounded/shadow/ring, keep layout, no !important
const stripDecorative = (defaults: string) =>
  defaults.split(/\s+/).filter(c => !/^-?(rounded|shadow|ring)(-|$)/.test(c.split(':').pop()!))
    .concat('minimal-flat').join(' ')

export default defineAppConfig({
  ui: { button: { slots: { base: stripDecorative } } }
})
```

There is also a **third, nuclear lever**: the module-level `ui: { theme: { unstyled:
true } }` (`nuxt.config.ts`). Where a replacer subtracts *some* classes on the slots
you name, `unstyled` blanks **every** slot/variant/compoundVariant class of **every**
component, app-global, at theme-template generation time — before any
`app.config`/`:ui` override runs. Only `class=`, the `:ui` prop, and `app.config.ui`
survive (verified against `@nuxt/ui@4.9.0` dist — `module.d.mts` +
`applyUnstyled()`).

**Hard constraints (verified against `@nuxt/ui` `dist/runtime/utils/tv.ts` and
`dist/module.d.mts`):**

| | Additive (variant) | Subtractive (replacer) | Unstyled (`theme.unstyled`) |
|---|---|---|---|
| Where read | `variants` / `compoundVariants` | top-level `base`/`slots`, per-instance `:ui`, `<UTheme>` | `nuxt.config.ts` module option (app-global) |
| Scope | per **named variant** (opt-in: `variant="minimal"`) | **global** to every instance / a `<UTheme>` subtree / one component | **global** — every component, every slot, no opt-out per-component |
| Can subtract defaults | ❌ merge-only | ✅ replaces named slots | ✅ blanks everything, incl. **structural/layout** classes (overlay positioning, floating placement) |
| Runtime theme switching (`ThemeSwitcher`) | ✅ per-component `:variant` | ⚠️ a global `app.config` replacer can't be switched off per-component; use `<UTheme>` for a switchable subtree | ❌ build-time, app-global — no runtime toggle |
| Re-supply burden | none (opt-in) | low — only the slots you target | **high** — every component you use needs its base look **and** any structural CSS (positioning, z-index, centering) re-supplied by hand |

- **Replacers are NOT variant-scoped.** `extractDirectives` only reads top-level
  `base`/`slots` — a function inside `variants.variant.minimal.base` is ignored. So
  subtractive theming is a *global/subtree/per-instance* tool, orthogonal to the
  variant system; the two modes coexist (the `minimal` button uses both).
- **Keep replacers pure & deterministic** so SSR and client compute the same string
  (no hydration mismatch) — the original reason this package avoided base overrides.
- **Multi-theme caveat:** a global `app.config` base replacer applies to *all*
  buttons, so an app that `extends` several themes + flips them at runtime should
  prefer `<UTheme>` (subtree) over a global replacer. Single-theme apps are clean.

#### `unstyled: true` — measured re-supply cost (spike #1305)

Spiked in `sandboxes/unstyled-spike` (throwaway, human-eyeball — see
`sandboxes/CLAUDE.md`) against `UButton`, `UInput`, `UCard`, `USeparator`, `UModal`,
`UDropdownMenu`. Findings:

- **Decorative components** (`UButton`, `UInput`, `UCard`, `USeparator`) lose *only*
  look — padding/border/color/focus-ring. Bounded, one-time cost: write a `:ui.base`
  (or a shared CSS class) per component the theme actually uses.
- **Structural components** (`UModal`, `UDropdownMenu`) lose **layout mechanics**,
  not just look — `UModal`'s overlay loses `fixed inset-0` + centering (it won't
  even visually cover the page without both re-supplied); `UDropdownMenu`'s content
  loses `position`/`z-index`/floating placement (it renders in-flow, pushing page
  content down, instead of floating). This is a **materially higher, easy-to-miss**
  cost than the decorative case — a theme author restyling only colors/spacing will
  ship a broken modal/dropdown unless they know to check every overlay/floating
  component specifically.
- **Re-supply checklist** (what you must bring back, per component class):
  - Decorative (`Button`/`Input`/`Card`/`Separator`): base look — padding, border,
    color, hover/focus state.
  - Structural (`Modal`/`Drawer`/`Popover`/`DropdownMenu`/`Tooltip`/anything
    portal'd or floating): the above **plus** overlay positioning (`fixed inset-0` +
    backdrop), content centering/placement, and `z-index` stacking. Budget real time
    for these, not a quick pass.

**Recommendation:** `unstyled: true` is **not** a good default for a new theme. Its
re-supply burden is unbounded (every component the app touches, forever, as new
ones are used) and it silently breaks structural components in ways a
look-focused pass won't catch. Prefer the **subtractive replacer** pattern (this
section, above) for new "own the whole look" themes — it targets only the slots
a theme actually cares about and leaves structural/layout classes alone by default.
Reserve `unstyled: true` for a narrow, deliberate case: a theme that is *itself* a
full design system re-implementation (e.g. a headless-UI wrapper) with the budget
to own every structural class up front — not a routine crouton theme.

Spikes: #364 (replacer), #1305 (unstyled).

## Dependencies

- **Peer deps**: `@nuxt/ui ^4.0.0`, `nuxt ^4.0.0`
- **No runtime deps** - themes are pure CSS/config

## Testing

```bash
# Test in ko-ui app
cd apps/ko-ui
pnpm dev

# Typecheck
npx nuxt typecheck
```

## File Size Considerations

- Keep fonts optimized (subset if possible)
- Avoid importing entire icon sets
- Each theme should be < 50KB (excluding fonts)
