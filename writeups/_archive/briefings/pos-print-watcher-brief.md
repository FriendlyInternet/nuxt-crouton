> 🗄️ **Archived 2026-11-04 (#3352) — done:** print-status endpoint and Bestel loading button shipped in crouton-sales. Historical record, not current guidance.

# POS Print Watcher — the order button confirms the print

## Summary

A volunteer's feedback today ends at the "Bestelling aangemaakt" toast — it fires the moment the
order POST returns and says nothing about whether the kitchen tickets actually printed. The real
confirmation (the spooler's DLE EOT pre-flight + drain check → `/complete` / `/fail` callbacks)
lands in `salesPrintqueues` a few seconds later, but only admins can see it (the OrdersTab LED
dots, polling the team-member-authed `printqueues/status` endpoint every 2s).

Plan: give helpers a **per-order print-status endpoint** (scoped-token auth) and make the
**checkout button itself the status surface** — it spins while the tickets print, turns into a
green confirmation when every ticket is done, and warns (with the printer's error message) when
something fails. The button label also changes **"Betalen" → "Bestel"**: it creates an order; no
payment happens at that moment.

## Context

### Where feedback lives today

- `Client/Cart.vue:123-129` — the checkout `UButton`, label `t('sales.cart.pay')` ("Betalen"),
  disabled on empty cart / missing client. No loading state of its own.
- `Client/OrderInterface.vue` `handleCheckout` (~line 443) — `await checkout()` then
  `notify.success('orderCreated')`. The toast is instant and unconditional.
- `usePosOrder().checkout` — POSTs the order (the order endpoint generates the kitchen-ticket
  print jobs synchronously, so the jobs exist before the response returns), exposes
  `isCheckingOut` during the POST.

### The print pipeline's timing

The on-site spooler polls the server every **2 seconds** when idle, runs the printer pre-flight,
sends the ticket, then calls `/complete` or `/fail`. A healthy print confirms within ~3–6s of
checkout. Statuses on `salesPrintqueues.status`: `0` pending, `1` printing, `2` completed,
`9` failed. A 1s client poll buys nothing over the spooler's own 2s cadence — **poll at 2s**,
same as the admin LEDs.

### Why a new endpoint

The existing slim `teams/[id]/events/[eventId]/printqueues/status` GET requires team membership
(`resolveTeamAndCheckMembership`) and returns every job for the event. A helper token can't call
it, and a volunteer only needs their own order's jobs.

## Design

### 1. Helper-authed per-order status endpoint

`server/api/crouton-sales/events/[eventId]/orders/[orderId]/print-status.get.ts`

- Auth: `requireScopedAccessToResource(event, 'event', eventId)` — identical to the order POST,
  so any token that could create the order can watch it.
- Verify the order belongs to the event (`salesOrders.eventId === eventId`) before returning jobs.
- Returns only that order's jobs, slim + printer name joined server-side (the volunteer UI has no
  printers query to enrich from):
  `{ id, status, errorMessage, retryCount, printMode, printerTitle, completedAt }`.
- An empty array is a real answer: the order generated no tickets (no active printers / printing
  disabled) — the client treats it as "nothing to watch", not an error.

### 2. Button state machine (Cart.vue + OrderInterface.vue)

A small `usePrintWatcher` composable in the package owns the polling; `OrderInterface` feeds the
derived state into `Cart` as a prop. States:

| State | Button | Trigger |
|-------|--------|---------|
| `idle` | "Bestel" (primary) | default |
| `submitting` | spinner, disabled | existing `isCheckingOut` during the order POST |
| `printing` | spinner + "Wordt geprint…" | jobs exist, any at status 0/1 |
| `confirmed` | green ✓ "Geprint" | **all** jobs at 2 — auto-reverts to `idle` after ~4s |
| `warning` | warning color, "Print mislukt" + error text below | any job at 9 (worst-status wins, same semantics as the admin `orderLed`) — persists |

Rules:

- **A new order always wins.** The cart clears on checkout, so the button sits disabled-empty
  while watching; the moment the volunteer adds an item for the next order, the label yields back
  to "Bestel" and the watcher continues in the background. A failure arriving mid-next-order
  surfaces as a warning line above the button (reusing the existing client-warning row styling)
  instead of hijacking the button. A busy event must never be blocked by the previous order's
  printer.
- **Terminal conditions stop the poll**: all jobs at 2 or 9, an empty first response (no
  tickets), a 401 (token expired — stop silently), or a **~60s timeout** → warning
  "Nog niet geprint — printer offline?" (covers spooler down / printer unreachable, where jobs
  sit at 0 forever).
- **The success toast goes away** — the button is the feedback now. The error toast for a failed
  order POST stays (that's an order problem, not a print problem).
- **Mobile drawer**: the drawer auto-closes after checkout, so the collapsed cart bar must mirror
  the button state (spinner / ✓ / warning) or the volunteer never sees it.
- Multiple tickets (several kitchen locations): confirm only when **all** are done; the warning
  text names the failing printer(s): "Bar: Paper out".

### 3. Label + i18n

- New key `sales.cart.submitOrder` — nl **"Bestel"**, en "Order", fr "Commander" — replaces
  `sales.cart.pay` on the button (the `pay` key can be deleted if nothing else uses it).
- New keys under `sales.cart.print*`: `printing` ("Wordt geprint…"), `printed` ("Geprint"),
  `printFailed` ("Print mislukt"), `printTimeout` ("Nog niet geprint — printer offline?").
- All three locales at parity (en/nl/fr).

### Files touched (all in `packages/crouton-sales` — hard gate, needs unlock)

| File | Change |
|------|--------|
| `server/api/crouton-sales/events/[eventId]/orders/[orderId]/print-status.get.ts` | new endpoint |
| `app/composables/usePrintWatcher.ts` | new — 2s poll, terminal/timeout logic, derived state |
| `app/components/Client/OrderInterface.vue` | start watcher after checkout, drop success toast, pass state to Cart |
| `app/components/Client/Cart.vue` | button states, warning row, label key |
| `i18n/locales/{en,nl,fr}.json` | new keys |
| `CLAUDE.md` | document endpoint + watcher |

### Out of scope

- **Volunteer retry.** The helper-reachable reprint endpoint (`orders/[orderId]/print`) also
  prints the customer receipt (`withReceipt: true`), which is deliberately on-demand only —
  wiring it to a volunteer retry would ghost-print receipts. Retry stays admin-side (per-job
  re-print button in the workspace).
- **Push (SSE/websocket).** Polling matches the admin LEDs and the spooler's own cadence; not
  worth new infrastructure for a ≤60s watch window.
- Durable status across refresh — the watcher is in-memory; the admin LEDs remain the durable
  record.

## Open questions

1. `confirmed` auto-revert (~4s) vs staying green until the next interaction — auto-revert
   recommended so the button reads "ready for the next order".
2. Should the timeout warning also stop further polling, or keep polling another 60s in case the
   spooler comes back? Recommended: stop, with the warning dismissible — the admin view is the
   place to chase stuck jobs.