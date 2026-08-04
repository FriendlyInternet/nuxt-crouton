# Per-product view in the Data pane (#1867) — pick a reading

Mockup: `per-product-data-pane.png`. Nothing gets built until A/B/C is picked.

## What already exists (checked before proposing)

- `salesProductMatrixBlock` (`charts/product-day-matrix`) — product × day units + revenue, event-scoped, already in `DataPanel.vue`. For a single event that is **one column**, i.e. sold-total per product.
- `charts/top-products` — top 10 by quantity, already in `SalesDashboardSalesSummary`, also in the pane.

**So the "sold in total" reading is ~already shipped.** Option B is a filter + a nicer render, not new machinery.

## The three options

| | Shows | Answers "bijbestellen?" | Work |
|---|---|---|---|
| **A** Still to deliver | outstanding units per product | **No** — see below | New endpoint + block |
| **B** Sold total | units sold per product | Yes | Filter/reshape of the existing matrix |
| **C** Both | sold + still out, two columns | Yes, plus kitchen backlog | New endpoint + block |

## The catch that decides it

Since #1851, send-out is per location and a location can set `requiresHandover: false`. A bar that hands the pils straight across the counter **never appears in an outstanding view at all**. So option A structurally cannot answer the question that opened the issue ("are we running out of pils") — it only ever shows kitchen-owned products.

## Reuse (no drift)

The outstanding column in A/C must not re-derive "still waiting". Today the rule lives twice:
- `server/utils/location-handover.ts` — `isOrderDelivered` / `locationBlocksDelivery` (pure, over fetched rows)
- `.../events/[eventId]/orders.get.ts` — `countOutstanding`, the same rule **inlined as SQL**

Plan: extract that SQL predicate into `location-handover.ts` as one shared builder and have both the Bestellingen counter and the new per-product query call it. Test-first (packages/* gate).

`count(distinct order)` for orders, `sum(quantity)` for units — the item join fans out. No `inArray` over orders (D1 param cap, #1766).
