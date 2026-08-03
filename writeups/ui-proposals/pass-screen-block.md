# UI proposal — Pass screen (`passScreenBlock`)

WS3 of epic #1755 · issue #1762 · **static mockup** (the block does not exist yet, so there is nothing deployable to preview).

An iPad at the pass, showing only orders every station has finished. One tap says it went to the customer.

Net-new surface, so there is no "before": today the loop stops at the station bump, and nothing records that the order actually reached the client.

---

## What changes

Comment inline on any line below to request a change.

1. **One tile per order, not per station.** Unlike the kitchen display, items are *not* split by location — the runner carries the whole order, so every line is on one tile.

2. **An order only appears once every station has pressed READY.** Nothing reaches this board half-made.

3. **One full-width button per tile.** Sized for a thumb on a busy pass — no menus, nothing to learn, no confirm step.

4. **Order age is prominent, oldest first.** At the pass, the oldest complete order is the one someone has been waiting on longest.

5. **An incomplete order is flagged, not hidden** (tile `#44`). An item whose product has no prep location can never be bumped, so counting it would stall the order forever. It is offered with an amber warning and a *"Toch afgegeven"* button, so the runner decides knowingly rather than the order silently vanishing.

6. **Staff orders keep the same amber marker** as the kitchen display, so the two screens read the same way.

7. **A tile leaves the board the moment it is tapped** (optimistic hide), and the next poll confirms it — same pattern as the KDS bump.

8. **Delivery is a page-editor block** (`passScreenBlock`), no new route — per your earlier call.

## What does NOT change

9. **The kitchen display and its bump are untouched.** This is a second stage on top, not a redefinition — a bump still means "my station is done", not "the customer has it".

10. **`salesOrders.status` is not written.** `completed` there already means "every print job succeeded"; delivery is tracked separately in `sales_handovers`.

## Implementation notes (not design decisions)

11. Mirrors `KitchenDisplayRender.vue`'s structure: slug→id resolution, 2s poll paused on `visibilitychange`, optimistic-hide `Set`, ticking `ago()` label, `TransitionGroup` enter/leave, and the `boardHealth` staleness indicator from #1766.

12. Nuxt UI 4 semantic tokens only (`bg-muted`, `text-highlighted`, `ring-default`, `UCard`/`UButton`/`UBadge`/`UIcon`) — no hardcoded colours, no raw-HTML re-implementations. The mockup approximates these in plain CSS because it must render offline.

13. Labels shown in Dutch because kassa is nl-only; the block ships `en`/`nl`/`fr` like every other sales block.

---

Reply `lgtm` / `approve` to unblock the build, or comment on any numbered line above.
