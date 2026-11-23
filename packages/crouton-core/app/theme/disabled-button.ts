// A disabled button must not look tappable (#4329): neutral fill, muted text, grey ring.
// Scoped to Nuxt UI's six standard variants (themes' named variants own their own look)
// and loading:false (a loading button is disabled too, but keeps its colour).
const MUTED = 'disabled:text-muted aria-disabled:text-muted'

export const disabledButtonCompoundVariants: Array<{ variant: string[], loading: boolean, class: string }> = [
  { variant: ['solid', 'soft', 'subtle'], loading: false, class: `disabled:bg-elevated aria-disabled:bg-elevated ${MUTED}` },
  { variant: ['outline', 'subtle'], loading: false, class: 'disabled:ring-accented aria-disabled:ring-accented' },
  { variant: ['outline', 'ghost', 'link'], loading: false, class: MUTED }
]
