// Minimal Theme Configuration
// Super clean, black lines, white background, minimal aesthetic

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'neutral',
      neutral: 'neutral'
    },

    button: {
      // Subtractive base via the SHARED marker-gated replacer (#1304, was an
      // inline stripDecorative from #364). Same subtraction set as before
      // (rounded/shadow/ring + the minimal-flat tag), with one refinement: it
      // now fires only when a minimal-* marker is in the resolved classes
      // (i.e. the minimal variants below are in play), so in multi-theme apps
      // like the playground it no longer flattens the other themes' buttons.
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          minimal: '',
          'minimal-solid': '',
          'minimal-outline': '',
          'minimal-soft': '',
          'minimal-ghost': '',
          'minimal-link': ''
        }
      },

      compoundVariants: [
        // Minimal + Primary (black)
        { color: 'primary', variant: 'minimal', class: 'minimal-btn minimal-btn--primary' },
        { color: 'neutral', variant: 'minimal', class: 'minimal-btn minimal-btn--neutral' },
        { color: 'error', variant: 'minimal', class: 'minimal-btn minimal-btn--error' },
        { variant: 'minimal', class: 'minimal-btn' },

        // === MINIMAL-SOLID (same as base minimal) ===
        { color: 'primary', variant: 'minimal-solid', class: 'minimal-btn minimal-btn--primary' },
        { color: 'neutral', variant: 'minimal-solid', class: 'minimal-btn minimal-btn--neutral' },
        { color: 'error', variant: 'minimal-solid', class: 'minimal-btn minimal-btn--error' },
        { variant: 'minimal-solid', class: 'minimal-btn' },

        // === MINIMAL-OUTLINE ===
        { color: 'primary', variant: 'minimal-outline', class: 'minimal-outline minimal-outline--primary' },
        { color: 'neutral', variant: 'minimal-outline', class: 'minimal-outline minimal-outline--neutral' },
        { color: 'error', variant: 'minimal-outline', class: 'minimal-outline minimal-outline--error' },
        { variant: 'minimal-outline', class: 'minimal-outline' },

        // === MINIMAL-SOFT ===
        { color: 'primary', variant: 'minimal-soft', class: 'minimal-soft minimal-soft--primary' },
        { color: 'neutral', variant: 'minimal-soft', class: 'minimal-soft minimal-soft--neutral' },
        { color: 'error', variant: 'minimal-soft', class: 'minimal-soft minimal-soft--error' },
        { variant: 'minimal-soft', class: 'minimal-soft' },

        // === MINIMAL-GHOST ===
        { color: 'primary', variant: 'minimal-ghost', class: 'minimal-ghost minimal-ghost--primary' },
        { color: 'neutral', variant: 'minimal-ghost', class: 'minimal-ghost minimal-ghost--neutral' },
        { color: 'error', variant: 'minimal-ghost', class: 'minimal-ghost minimal-ghost--error' },
        { variant: 'minimal-ghost', class: 'minimal-ghost' },

        // === MINIMAL-LINK ===
        { color: 'primary', variant: 'minimal-link', class: 'minimal-link minimal-link--primary' },
        { color: 'neutral', variant: 'minimal-link', class: 'minimal-link minimal-link--neutral' },
        { color: 'error', variant: 'minimal-link', class: 'minimal-link minimal-link--error' },
        { variant: 'minimal-link', class: 'minimal-link' }
      ]
    },

    input: {
      variants: {
        variant: {
          minimal: {
            root: 'minimal-input',
            base: 'minimal-input-base'
          }
        }
      }
    },

    card: {
      variants: {
        variant: {
          minimal: {
            root: 'minimal-card',
            header: 'minimal-card-header',
            body: 'minimal-card-body',
            footer: 'minimal-card-footer'
          }
        }
      }
    },

    separator: {
      variants: {
        variant: {
          minimal: {
            root: 'minimal-separator'
          }
        }
      }
    }
  }
})
