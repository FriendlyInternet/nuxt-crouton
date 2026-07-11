# UI proposal — Staff-order switch: text label → icon (#1508)

Surface: `packages/crouton-sales/app/components/Client/Cart.vue` — the footer controls row
(remark toggle on the left, staff-order `USwitch` on the right).

Inline-comment any line below to request a change. Reply `lgtm` / `approve` to unblock the build.

## What changes

- **Text label → icon.** The visible `{{ t('sales.cart.staffOrder') }}` text ("Personeelsbestelling" / "Staff order" / "Commande du personnel") is replaced by a person/badge glyph so the one-line controls row never overflows on narrow phone panes.
- **Suggested icon:** `i-lucide-user-cog` (person + settings cog reads as "staff/personnel"). Alternative considered: `i-lucide-hard-hat`. **Open question for the reviewer:** which glyph reads clearest for "staff order"?
- **Meaning stays reachable.** The translated string is preserved as the control's `aria-label` **and** a hover/long-press tooltip, so screen-reader users still hear "Personeelsbestelling" and sighted users can discover it.
- **Active state.** When staff order is on, the icon takes the `warning` tint (mirrors today's `text-warning font-medium` emphasis on the active text label) so the toggled state stays visible at a glance.

## What stays the same

- The switch behaviour and the `update:isPersonnel` emit are untouched.
- The remark toggle on the left and everything else in the footer are unchanged.
- The `<label>` wrapper keeps the icon + switch as one tappable target.

## Why

On a narrow (phone) pane the Dutch label "Personeelsbestelling" is long enough to run off the edge of the cart's compact controls row and clip the switch. An icon fits at any width while keeping the control usable and named.
