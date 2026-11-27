# @fyit/crouton-themes

Swappable UI themes for Nuxt applications using Nuxt UI 4. Each theme provides design tokens, component variants, and optional custom components as a self-contained Nuxt layer.

## Installation

```bash
pnpm add @fyit/crouton-themes
```

## Quick Start

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton-themes/ko']
})
```

That's it! Your app now has the KO theme applied.

---

## Theme Switching

Want to let users switch between themes at runtime? Use the theming layer:

```ts
// nuxt.config.ts
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
  <!-- Theme switcher dropdown -->
  <ThemeSwitcher />

  <!-- Components automatically use selected theme -->
  <UButton :variant="variant" color="primary">Themed Button</UButton>
</template>
```

### ThemeSwitcher Component

```vue
<!-- Dropdown selector (default) -->
<ThemeSwitcher />

<!-- Inline button group -->
<ThemeSwitcher mode="inline" />

<!-- Single button that cycles through themes -->
<ThemeSwitcher mode="cycle" />
```

### useThemeSwitcher Composable

```ts
const {
  currentTheme,    // Current theme name ('default' | 'ko' | 'minimal' | 'kr11')
  variant,         // Variant for Nuxt UI (undefined for default)
  themes,          // Available theme configs
  setTheme,        // Set theme by name
  cycleTheme       // Cycle to next theme
} = useThemeSwitcher()
```

---

## Available Themes

### KO Theme

Hardware-inspired styling based on the Teenage Engineering KO II sampler. Features tactile button bevels, LCD-style inputs, and an industrial color palette.

```ts
extends: ['@fyit/crouton-themes/ko']
```

#### Nuxt UI Variants

Use `variant="ko"` on supported components:

```vue
<template>
  <!-- Buttons with color variants -->
  <UButton variant="ko">Default Gray</UButton>
  <UButton variant="ko" color="primary">Orange</UButton>
  <UButton variant="ko" color="neutral">Dark</UButton>
  <UButton variant="ko" color="secondary">Pink</UButton>
  <UButton variant="ko" color="info">Blue</UButton>
  <UButton variant="ko" color="error">Red</UButton>

  <!-- LCD-style input -->
  <UInput variant="ko" placeholder="ENTER VALUE" />

  <!-- Hardware panel card -->
  <UCard variant="ko">
    <template #header>System Status</template>
    Panel content here
  </UCard>
</template>
```

#### Custom Components

The KO theme includes hardware-inspired components, auto-imported with the `Ko` prefix:

##### KoLed

LED indicator with glow animations.

```vue
<KoLed />                    <!-- Off (default) -->
<KoLed state="on" />         <!-- Solid on -->
<KoLed state="blink" />      <!-- Slow blink -->
<KoLed state="fast" />       <!-- Fast blink -->
<KoLed state="alive" />      <!-- Organic pulse -->
```

##### KoKnob

Rotary control with drag interaction.

```vue
<script setup>
const volume = ref(50)
</script>

<template>
  <KoKnob v-model="volume" :min="0" :max="100" />
</template>
```

##### KoButton

Full tactile button with optional LED slot.

```vue
<KoButton variant="orange" shape="square">
  Play
  <template #led>
    <KoLed state="on" />
  </template>
</KoButton>
```

Props:
- `variant`: `'default' | 'orange' | 'dark' | 'red' | 'pink' | 'blue'`
- `shape`: `'square' | 'rect' | 'wide'`
- `align`: `'center' | 'top' | 'left'`

##### KoPanel

Display panel with glass overlay effect.

```vue
<KoPanel>
  <KoDisplay value="120" label="BPM" />
</KoPanel>
```

##### KoDisplay

7-segment style readout.

```vue
<KoDisplay value="88" label="TEMPO" />
```

##### KoLabel

Hardware-style engraved label.

```vue
<KoLabel>VOLUME</KoLabel>
```

##### KoPunchHole / KoSpeakerGrill

Decorative elements for authentic hardware aesthetics.

```vue
<KoPunchHole />
<KoSpeakerGrill :rows="4" :cols="8" />
```

#### Design Tokens

The KO theme exposes CSS custom properties you can use in your own styles:

```css
/* Surface colors */
--ko-surface-light: #c7c3c0;    /* Main chassis gray */
--ko-surface-mid: #908E8D;      /* Mid-tone gray */
--ko-surface-dark: #545251;     /* Dark button gray */
--ko-surface-panel: #171717;    /* Black panel area */

/* Accent colors */
--ko-accent-orange: #FA5F28;    /* Primary accent */
--ko-accent-red: #F12618;       /* Record button red */
--ko-accent-pink: #E62C5E;      /* Pink accent */
--ko-accent-blue: #429CCE;      /* Blue accent */

/* Text colors */
--ko-text-light: #F2F2F2;
--ko-text-dark: #403E3D;
--ko-text-label: #858384;
```

---

## Creating Your Own Theme

### Directory Structure

```
packages/nuxt-crouton-themes/
└── my-theme/
    ├── nuxt.config.ts      # Layer entry point
    ├── app.config.ts       # Nuxt UI overrides
    ├── assets/
    │   ├── css/main.css    # Design tokens & styles
    │   └── fonts/          # Optional custom fonts
    └── components/         # Optional custom components
```

### Step 1: Create nuxt.config.ts

```ts
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  $meta: {
    name: 'nuxt-crouton-themes/my-theme',
    description: 'My custom theme'
  },

  css: [join(currentDir, 'assets/css/main.css')],

  components: {
    dirs: [{
      path: join(currentDir, 'components'),
      prefix: 'MyTheme',  // Components import as MyTheme*
      global: true
    }]
  }
})
```

### Step 2: Create app.config.ts

```ts
export default defineAppConfig({
  ui: {
    // Override default colors
    colors: {
      primary: 'emerald',
      neutral: 'slate'
    },

    // Add custom button variant
    button: {
      variants: {
        variant: {
          mytheme: ''  // Register variant name
        }
      },
      compoundVariants: [
        {
          variant: 'mytheme',
          color: 'primary',
          class: 'mytheme-button mytheme-button--primary'
        },
        {
          variant: 'mytheme',
          class: 'mytheme-button'  // Default fallback
        }
      ]
    }
  }
})
```

### Step 3: Create CSS

```css
/* assets/css/main.css */
@import "tailwindcss";
@import "@nuxt/ui";

:root {
  --mytheme-bg: #1a1a2e;
  --mytheme-accent: #e94560;
}

.mytheme-button {
  font-family: 'Your Font', sans-serif;
  background: var(--mytheme-bg);
  border: 2px solid var(--mytheme-accent);
  /* ... */
}
```

### Step 4: Update package.json exports

```json
{
  "exports": {
    "./ko": "./ko/nuxt.config.ts",
    "./my-theme": "./my-theme/nuxt.config.ts"
  },
  "files": ["ko", "my-theme"]
}
```

---

## Theming Best Practices

### CSS Class Namespacing

Prefix all classes with your theme name to avoid conflicts:

```css
/* Good */
.ko-bezel { }
.brutalist-card { }

/* Bad - may conflict */
.bezel { }
.card-custom { }
```

### Design Token Naming

Use consistent, theme-prefixed custom properties:

```css
:root {
  --ko-surface-light: #c7c3c0;
  --ko-surface-dark: #545251;
  --ko-accent-primary: #FA5F28;
}
```

### Nuxt UI Integration

The key pattern for Nuxt UI 4 theming:

1. Register variant in `variants.variant` (empty string is fine)
2. Apply styles via `compoundVariants` matching variant + color
3. Use CSS classes for complex effects (pseudo-elements, animations)

```ts
button: {
  variants: {
    variant: { ko: '' }  // Step 1: Register
  },
  compoundVariants: [
    {
      variant: 'ko',
      color: 'primary',
      class: 'ko-bezel ko-bezel--orange'  // Step 2 & 3: Apply CSS
    }
  ]
}
```

---

## API Reference

### Theme Layer Exports

Each theme exports a Nuxt layer via subpath:

| Layer | Import Path | Description |
|-------|-------------|-------------|
| Themes | `@fyit/crouton-themes/themes` | Theme switching utilities |
| KO | `@fyit/crouton-themes/ko` | Teenage Engineering inspired |
| Minimal | `@fyit/crouton-themes/minimal` | Clean, Bauhaus-inspired |
| Editorial | `@fyit/crouton-themes/editorial` | Book-style serif on white, sans controls, pill buttons |
| KR-11 | `@fyit/crouton-themes/kr11` | Korg rhythm box inspired |

### KO Theme Components

| Component | Props | Description |
|-----------|-------|-------------|
| `KoLed` | `state?: 'off' \| 'on' \| 'blink' \| 'fast' \| 'alive'` | LED indicator |
| `KoKnob` | `modelValue, min?, max?` | Rotary control |
| `KoButton` | `variant?, shape?, align?, disabled?` | Tactile button |
| `KoPanel` | - | Display panel |
| `KoDisplay` | `value, label?` | 7-segment display |
| `KoLabel` | - | Hardware label |
| `KoPunchHole` | - | Decorative hole |
| `KoSpeakerGrill` | `rows?, cols?` | Speaker pattern |

---

## License

MIT
