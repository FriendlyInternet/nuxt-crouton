# UI proposal — Delete a single order from the workspace (#1518)

Two-step **Delete** pill in the expanded order row of the workspace order list
(`crouton-sales` · `OrderItems.vue` / `OrdersTab.vue`). Comment inline on any line
to request a change; reply `lgtm` / `approve` to unblock the build.

## What changes

- **Delete pill placement.** A two-step `CroutonDeleteButton` in a **new right-aligned
  footer action row below the totals**, inside the expanded panel but **below** the
  Order/Printers tab bar. Deliberately clear of the Reprint action (#1517) that lives on
  the tab bar, so the two PRs touch different regions of `OrderItems.vue`.
- **Two-step confirm.** Idle = red "Delete" pill; first tap arms it ("Sure?"); second tap
  fires. Moving the pointer away disarms — the standard `CroutonDeleteButton` behaviour.
- **Hard delete (default).** Removes the order **and** its `salesOrderitems` **and** its
  `print_jobs` (`source='sales'`, `refType='order'`, `refId=orderId`). The existing
  `cancelled` status remains the *soft* alternative for real events.
- **Refresh.** On delete, `OrderItems` emits up to `OrdersTab`, which calls the endpoint
  then fires the `crouton:mutation` hook for `salesOrders` so the order list and the POS
  client picker refresh. The deleted order stops counting toward its client's tab total.
- **Auth.** The DELETE endpoint requires **team admin** — a non-admin can't delete.

## What stays the same

- The row header (order number, client name, owner), the print-status LED + popover, the
  Order/Printers tabs, the item list and the totals are untouched.

## Open decision (please confirm at sign-off)

- **Hard delete vs cancel.** Recommended: **hard delete** (owner said "delete"; apps are
  greenfield). `cancelled` already exists as the soft path. Reply if you'd rather this pill
  set `cancelled` instead of removing the rows.
