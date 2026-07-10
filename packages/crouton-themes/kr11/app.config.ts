// KR-11 Theme Configuration
// Korg KR-11 Compact Rhythm Box inspired styling

import { subtractThemeDefaults } from '../lib/subtractive'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'stone'
    },

    button: {
      // Subtractive base via the shared marker-gated replacer (#1304): fires only
      // when a kr-* marker is in the resolved classes; strips the defaults the
      // KR-11 CSS re-supplies so it needs no !important.
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          kr11: '',
          'kr11-solid': '',
          'kr11-outline': '',
          'kr11-soft': '',
          'kr11-ghost': '',
          'kr11-link': ''
        }
      },

      compoundVariants: [
        // === BASE KR11 (pad style) ===
        { color: 'primary', variant: 'kr11', class: 'kr-pad kr-pad--mint' },
        { color: 'neutral', variant: 'kr11', class: 'kr-pad' },
        { color: 'warning', variant: 'kr11', class: 'kr-pad kr-pad--gold' },
        { color: 'error', variant: 'kr11', class: 'kr-pad kr-pad--coral' },
        { color: 'secondary', variant: 'kr11', class: 'kr-mode-btn' },
        { variant: 'kr11', class: 'kr-pad' },

        // === KR11-SOLID (same as base) ===
        { color: 'primary', variant: 'kr11-solid', class: 'kr-pad kr-pad--mint' },
        { color: 'neutral', variant: 'kr11-solid', class: 'kr-pad' },
        { color: 'warning', variant: 'kr11-solid', class: 'kr-pad kr-pad--gold' },
        { color: 'error', variant: 'kr11-solid', class: 'kr-pad kr-pad--coral' },
        { variant: 'kr11-solid', class: 'kr-pad' },

        // === KR11-OUTLINE ===
        { color: 'primary', variant: 'kr11-outline', class: 'kr-outline kr-outline--mint' },
        { color: 'neutral', variant: 'kr11-outline', class: 'kr-outline' },
        { color: 'warning', variant: 'kr11-outline', class: 'kr-outline kr-outline--gold' },
        { color: 'error', variant: 'kr11-outline', class: 'kr-outline kr-outline--coral' },
        { variant: 'kr11-outline', class: 'kr-outline' },

        // === KR11-SOFT ===
        { color: 'primary', variant: 'kr11-soft', class: 'kr-soft kr-soft--mint' },
        { color: 'neutral', variant: 'kr11-soft', class: 'kr-soft' },
        { color: 'warning', variant: 'kr11-soft', class: 'kr-soft kr-soft--gold' },
        { color: 'error', variant: 'kr11-soft', class: 'kr-soft kr-soft--coral' },
        { variant: 'kr11-soft', class: 'kr-soft' },

        // === KR11-GHOST ===
        { color: 'primary', variant: 'kr11-ghost', class: 'kr-ghost kr-ghost--mint' },
        { color: 'neutral', variant: 'kr11-ghost', class: 'kr-ghost' },
        { color: 'warning', variant: 'kr11-ghost', class: 'kr-ghost kr-ghost--gold' },
        { color: 'error', variant: 'kr11-ghost', class: 'kr-ghost kr-ghost--coral' },
        { variant: 'kr11-ghost', class: 'kr-ghost' },

        // === KR11-LINK ===
        { color: 'primary', variant: 'kr11-link', class: 'kr-link kr-link--mint' },
        { color: 'neutral', variant: 'kr11-link', class: 'kr-link' },
        { color: 'warning', variant: 'kr11-link', class: 'kr-link kr-link--gold' },
        { color: 'error', variant: 'kr11-link', class: 'kr-link kr-link--coral' },
        { variant: 'kr11-link', class: 'kr-link' }
      ]
    },

    input: {
      slots: {
        root: subtractThemeDefaults,
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          kr11: {
            root: 'kr-input',
            base: 'kr-input-base'
          }
        }
      }
    },

    card: {
      slots: {
        root: subtractThemeDefaults,
        header: subtractThemeDefaults,
        body: subtractThemeDefaults,
        footer: subtractThemeDefaults
      },
      variants: {
        variant: {
          kr11: {
            root: 'kr-card',
            header: 'kr-card-header',
            body: 'kr-card-body',
            footer: 'kr-card-footer'
          }
        }
      }
    },

    badge: {
      slots: {
        base: subtractThemeDefaults
      },
      variants: {
        variant: {
          kr11: 'kr-badge'
        }
      }
    }
  }
})
