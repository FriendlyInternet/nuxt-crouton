# UI proposal — Delete all orders (Settings danger zone) · #1519

Surface: `packages/crouton-sales/app/components/EventWorkspace/SettingsTab.vue`
(the **Event details** card danger zone).

Inline-comment any line below to request a change. Reply `lgtm` / `approve` to unblock the build.

## What changes

- **New danger-zone row.** A **Delete all orders** row is added to the Event details card,
  directly under the existing **Delete event** row. Rendered for **team admins only**
  (non-admins don't see it).
- **Typed-confirm modal, not a one-tap pill.** Clicking **Delete orders…** opens a Nuxt UI 4
  `UModal` (`#content` slot, no `UCard` inside). The destructive button stays **disabled**
  until the admin types the **event name exactly** — a stronger guard than the Delete-event
  pill, because this is bulk-destructive.
- **Scope is spelled out in the modal.** Copy states it wipes only **this event's** orders +
  items + print jobs, that **other events are untouched**, that **client tabs stay but reset
  to empty**, and that it **can't be undone**.
- **Empties the list on success.** After the delete lands, the event's order list refreshes to
  empty and a success toast fires.
- **Nothing else moves.** Duplicate, Delete event, and every other Settings card are unchanged.

## Open questions for the reviewer

- **Confirmation token:** type the **event name** (shown here) vs. the literal word **DELETE**?
  Recommend the event name — it's harder to muscle-memory past and names the exact target.
- **Show the order count** in the button (“Delete 128 orders”) — helpful, or noise? Recommend
  keeping it; it makes the blast radius concrete.

Mockup is pure HTML/CSS/SVG (no JS); the order count (128) is illustrative.
