# UI proposal — Reprint on the expanded order's tab bar (#1517)

Surface: `packages/crouton-sales/app/components/EventWorkspace/OrderItems.vue` — the `UTabs`
tab row (Bestelling / Printers) inside an expanded order.

Comment inline on any line below to request a change; reply `lgtm` / `approve` to unblock the build.

## What changes

- **New Reprint action.** A right-aligned button on the `UTabs` tab row (pushed to the right of
  the Bestelling / Printers triggers). It is a **whole-order** reprint, distinct from the existing
  per-failed-job reprint that lives *inside* the Printers tab.
- **Two-step confirm.** First tap arms ("Confirm reprint?"), second tap fires — same guard as
  `CroutonDeleteButton`, because it produces physical paper and an accidental tap wastes a ticket.
- **Warning styling.** Amber/`warning` soft pill with a rotate-ccw icon, matching the per-job
  reprint control already in the Printers tab (visual consistency, not a new color).
- **Emits `reprintOrder` up.** `OrderItems.vue` stays presentational; `OrdersTab.vue` owns the
  team/event context, calls the endpoint, and refreshes the 2s queue poll so the LEDs update.

## What it does NOT change

- The per-failed-job reprint inside the Printers tab (unchanged).
- Order lines, totals, remarks, the LEDs, and the popover breakdown (unchanged).
- No new print jobs and no forced customer receipt — Reprint re-fires the order's *existing*
  tickets (resets their `print_jobs` from done/failed back to pending).

## Placement decisions (please confirm)

- **Position:** far right of the tab row, on the same baseline as the tab triggers. Alternative
  considered: a footer button under the order lines — rejected, the issue specifies the tab row.
- **Label:** text `Reprint` (not icon-only) so it reads at a glance on the register; the per-job
  control stays icon-only. OK, or prefer icon-only to save width in a narrow pane?
- **Visible when:** always on the tab row of an expanded order (even if the order currently has no
  jobs the button still offers a reprint attempt), or should it hide when the order produced no
  tickets at all? Recommend: always visible for simplicity.
