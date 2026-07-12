# CLAUDE.md - @fyit/crouton-sales

## Package Purpose

Event-based Point of Sale (POS) system for Nuxt Crouton. Provides products, categories, orders, and optional thermal receipt printing. Designed for pop-up events, markets, and temporary retail situations with team-based multi-tenancy.

## Key Files

| File | Purpose |
|------|---------|
| `app/composables/usePosOrder.ts` | Cart management, checkout, price calculations |
| `app/composables/usePrintWatcher.ts` | Post-checkout print feedback — polls per-order print-status, derives the order button's state |
| `server/utils/generate-print-queues.ts` | Builds order print jobs via `generatePrintJobsForOrder` (crouton-printing global) and `enqueuePrintJob` onto the generic `print_jobs` queue (`source: 'sales'`, `refType: 'order'`) |
| `server/utils/printing-reactions.ts` | **Pure** sales reactions to the crouton-printing lifecycle (#329): `onJobCreated`/`onJobCompleted`/`onJobFailed` (deps injected, unit-tested). Order auto-complete + cloud-sync outbox — replaced the deleted `print-job-complete.ts` |
| `server/plugins/printing-subscriber.ts` | Nitro plugin wiring the reactions to `printing:job:{created,completed,failed}` hooks (filtered to `source === 'sales'`, best-effort log+swallow) |
| `app/composables/useHelperAuth.ts` | Helper authentication (wraps nuxt-crouton-auth; PIN login via generic redeem, gate-session adoption) |
| `app/utils/voice-order.ts` | Talk-to-order pure logic (#1429): `parseVoiceOrder` maps a spoken nl utterance ("twee pils en een koffie") onto the event's products as `{ lines, unmatched }` draft cart lines (Dutch number words 1–20 + tens, plural/diminutive stemming, 1-edit STT fuzz; below-confidence segments → `unmatched`, never guessed). Also `classifyVoiceError(event)` → `{ code, message, report }` — decides which `SpeechRecognitionErrorEvent` codes are real failures vs benign pauses (`no-speech`/`aborted`/`no-match` → `report:false`). Behaviour contract: `test/voice-order.test.ts` |
| `app/utils/printer-led.ts` | Printer online-LED attribution pure logic (#1507): `attributePrinterStates(printers, jobs)` → per-printer `LedState` (`online`/`offline`/`printing`/`unknown`). Matches a job to a printer row by `printerId` first, else by an **unambiguous** `printerTitle` (drift-proof so a re-created printer's failures still show red, not a false grey); latest job wins by `completedAt ?? createdAt`. Behaviour contract: `test/printer-led.test.ts` |
| `app/composables/useVoiceOrder.ts` | Talk-to-order speech capture (#1429) — wraps VueUse `useSpeechRecognition` (on-device Web Speech API, `nl-BE`, one utterance per press) and feeds each final utterance through `parseVoiceOrder`. The ONLY module touching the STT engine — swap point for a server transcriber later. Errors route through `classifyVoiceError`: the raw code is always `console.warn`'d for diagnosis, and real failures reach `onError(code)` so the caller shows a reason-specific message (permission/mic/network/language) instead of a blanket "failed"; benign pauses are swallowed. Exposes `errorCode` (raw, for diagnostics) |
| `server/plugins/scoped-access.ts` | Nitro hook handlers: before-redeem helperPin→grant sync + pages derive-scope (one PIN from page gate to POS) |
| `app/plugins/viewport-meta.ts` | Replaces the default viewport meta via useHead: `viewport-fit=cover` (safe-area env() for the phone kassa) + `maximum-scale=1` (kills iOS input-focus auto-zoom; pinch still works) |
| `app/components/Client/` | Customer-facing order interface (8 components) |
| `app/components/Admin/` | Admin sidebar navigation |
| `app/components/Pos/` | Order management (OrdersList) |
| `app/components/Settings/` | Print settings modals (opt-in) |
| `server/utils/team-event.ts` | `requireTeamEvent(event)` — shared guard for `teams/[id]/events/[eventId]/*` endpoints: membership + event-ownership in one call (400/404). Extracted in #1324 to kill the per-endpoint copies; new event-scoped endpoints start here |
| `server/utils/require-scoped-event.ts` | `requireScopedEvent(event)` — the **helper-token** analog of `requireTeamEvent`: validates `:eventId`, requires a scoped-access token for that event, returns `{ eventId, access, db }`. Used by the helper-authed `events/[eventId]/*` endpoints (`order-data`, `orders` POST, `my-orders`); extracted to kill the same preamble clone group the fallow audit flags |
| `server/utils/my-orders-shape.ts` | Pure assembly for the `my-orders` endpoint — `shapeMyOrders(orders, items, jobs)` groups items per order, resolves option ids → labels (`resolveOptionLabels`), sums the order total, and buckets the combined print status (`bucketFromStatuses`: failed > busy > done, display jobs excluded). No DB/Nitro deps → unit-tested (`test/my-orders-shape.test.ts`) |
| `server/utils/sync-outbox.ts` | Pi-side capture for the D1 live mirror (#176) — `recordOutboxEvents()` + `isCloudSyncEnabled()`; gated by `CROUTON_SALES_CLOUD_SYNC` |
| `server/utils/sync-ingest.ts` | Cloud-side apply (#178) — `applyOutboxEvents()` idempotent upsert by nanoid |
| `server/utils/cloud-sync-auth.ts` | Fail-closed `x-sync-key` auth for the ingest (#178) |
| `server/utils/cloud-sync-pusher.ts` | Pi-side push loop (#177) — `pushPendingOutbox()` drains outbox → ingest; `pingHeartbeat()` idle empty-batch ping (#179) |
| `server/plugins/cloud-sync-pusher.ts` | Nitro plugin running the push loop (gated, backoff) + idle heartbeat ping (#179) |
| `server/utils/sync-status.ts` | Cloud-side freshness heartbeat (#179) — `recordSyncHeartbeat()` (best-effort upsert on every ingest) + `readSyncStatus()` |
| `server/api/crouton-sales/sync/ingest.post.ts` | Cloud D1 ingest endpoint (#178); also stamps the freshness heartbeat (#179) |
| `server/api/crouton-sales/teams/[id]/sync-status.get.ts` | Live-dashboard freshness read (#179) — `{ lastContactAt, lastEventAt, lastBatchApplied, serverNow }` |
| `app/components/Sync/Status.vue` | `SalesSyncStatus` — mirror freshness banner (#179): "synced Xs ago" / stale, polls sync-status |
| `app/components/Dashboard/SalesSummary.vue` | `SalesDashboardSalesSummary` — live revenue/orders/avg + top products (#179), built on the chart endpoints |
| `server/database/schema.ts` | Package-owned Drizzle schema: `salesSyncOutbox` (`sales_sync_outbox`) + `salesSyncStatus` (`sales_sync_status`, #179 heartbeat) |
| `server/db/schema.ts` | Re-export NuxtHub scans so consuming apps auto-pick-up `sales_sync_outbox` + `sales_sync_status` in `db:generate` |
| `server/database/migrations/0001_sales_sync_outbox.sql` | Package migration creating `sales_sync_outbox` |
| `server/database/migrations/0002_sales_sync_status.sql` | Package migration creating `sales_sync_status` (#179 heartbeat) |
| `schemas/` | JSON schema files for crouton generate |
| `seed/index.ts` | Seed provider (`@fyit/crouton-sales/seed`) — event `vlaamsekermis` (PIN `1234`) + categories/products + a scoped kassa demo page |

**Note:** Collection composables like `useSalesProducts()`, `useSalesCategories()`, etc. are auto-generated by crouton in the user's `./layers/sales/` layer, not provided by this package.

## Architecture

> **⚠️ Printing now goes through `@fyit/crouton-printing` (epic #325/#329).** This
> package no longer ships the print engine, transport, or queue table. The layer
> **extends `@fyit/crouton-printing`** (see `nuxt.config.ts`), which provides:
> the generic **`print_jobs`** queue table + `enqueuePrintJob(db, …)` /
> `enqueuePrintJobs`, the lifecycle helpers `completePrintJob`/`failPrintJob` +
> `PRINT_STATUS`, the ESC/POS engine (`generatePrintJobsForOrder`,
> `encodeTicket`, `formatReceipt`, `renderTicketHtml`, `receiptCurrencySymbol`,
> `DEFAULT_RECEIPT_SETTINGS` + the `Receipt*`/`Printer*` types), the on-site
> transport (in-process ESC/POS drainer + HTTP `/api/print-server/*` spooler
> endpoints), and the **browser-print** drainer endpoints at
> **`/api/crouton-printing/events/[eventId]/browser-print-jobs/*`**.
>
> **Sales' side of the contract** is now just three pieces:
> - **Enqueue** — `generate-print-queues.ts` builds the jobs via
>   `generatePrintJobsForOrder` and `enqueuePrintJob(db, { source: 'sales',
>   refType: 'order', refId: orderId, … })` (kitchen + receipt). `end-receipt`
>   enqueues a tab receipt with `refType: 'tab', refId: clientId` and
>   `encodeTicket(receiptData, driver)`.
> - **React** — `server/plugins/printing-subscriber.ts` subscribes to
>   `printing:job:{created,completed,failed}` (filtered to `source === 'sales'`)
>   and runs the pure handlers in `server/utils/printing-reactions.ts`:
>   *created* → cloud-sync outbox mirror; *completed* → auto-complete the order
>   when no `print_jobs` remain non-completed (refType='order'); *failed* → flag
>   the order `print_failed`. (This replaced the deleted `print-job-complete.ts`
>   and the inline thermal spooler callbacks.)
> - **Read** — the status endpoints (`printqueues/status`,
>   `orders/[orderId]/print-status`, `printqueues/retry-failed`) now query the
>   generic `print_jobs` table filtered to `source='sales'`, mapping
>   `orderId ← refId`; `printerTitle` is read off the denormalized job column (no
>   printers join).
>
> **DELETED from this package** (now in crouton-printing): `server/utils/{receipt-formatter,print-queue-service,print-job-complete,escpos-drainer,print-server-auth}.ts`,
> `server/plugins/escpos-drainer.ts`, `server/api/print-server/`,
> `server/api/crouton-sales/events/[eventId]/browser-print-jobs/`, and the
> RUT956 `print-server/` scripts. **KEPT:** `salesPrinters` (printer config in
> the generated layer), `sync-outbox.ts` (cloud sync), and the cloud-mirror
> `salesPrintqueues` table the D1 ingest writes into. Sections below that
> reference the deleted sales files describe the behaviour that now lives in
> crouton-printing.

### Order Flow

```
Event -> Products/Categories -> Customer selects -> Cart -> Order -> Print (opt-in)
```

1. Admin creates Event with Products organized by Categories
2. Customer (or Helper) opens order interface for event
3. Products displayed by category, options available
4. Items added to cart with quantities and remarks
5. Checkout creates Order with OrderItems
6. If printing enabled: Print jobs queued for locations

**Printer types** (`salesPrinters.type`, nullable — NULL ⇒ kitchen): `kitchen` printers get one
ticket per location (matched on `locationId`); a `receipt` printer gets one combined customer
receipt for the whole order (`printMode: 'receipt'` — the only mode that prints the
receipt-settings `footer_text`). **Customer receipts are on-demand only**: checkout queues kitchen
tickets but never a receipt (`generatePrintJobsForOrder` gates it on `options.withReceipt`) — the
receipt printer only fires via the manual reprint endpoint (`orders/[orderId]/print`, which sets
`withReceipt: true`) or the end-of-tab `end-receipt`. Selected in `PrinterForm.vue` (package component); the generated
printers collection needs the `type` column + zod field (fanfare has it, migration
`0008_windy_dragon_man`). **`locationId` is kitchen-only**: receipt printers store NULL (routing
never reads it) — the form shows type above location, hides the location field for receipt and
nulls it on save; the kitchen-side "required" lives in PrinterForm's `superRefine`
(`sales.form.locationRequired`), so the generated schema/endpoints keep `locationId` nullish and
the DB column nullable (fanfare migration `0011_rainy_zemo`). Only the FIRST receipt printer of an
event receives jobs. Event duplication copies location-less printers as-is.

**Output driver** (`salesPrinters.driver`, nullable — NULL ⇒ `network-escpos`): how a station is
fulfilled (see `docs/architecture/venue-local-first-architecture.md` → "Output drivers"). Routing
(items → location → station, kitchen vs receipt) is **driver-agnostic**; only the **encoding**
differs, via `encodeTicket(receiptData, driver)` in `print-queue-service.ts`:

- **`network-escpos`** (default, set by NULL too) — base64 ESC/POS bytes for the thermal TCP path
  (`formatReceipt`). Unchanged; drained by **either** the on-site RUT956 HTTP spooler (cloud profile)
  **or** the in-process Node drainer (`escpos-drainer.ts`, venue/self-host profile — see
  "Print-Server Polling Endpoints"). One or the other per printer set, never both.
- **`browser-print`** (#127, AirPrint) — the canonical `ReceiptData` stored as **JSON**. The drainer
  is a browser screen, the **`printBridgeBlock`**: it polls `browser-print-jobs` (jobs server-rendered
  to HTML by `renderTicketHtml`), prints each through the OS / AirPrint dialog (`window.print()` in a
  hidden iframe) and POSTs `done`/`fail`. Same `salesPrintqueues` lifecycle + order LEDs as thermal
  (shared transitions in `print-job-complete.ts`). Works in any profile incl. cloud — no LAN socket,
  no printer IP (PrinterForm hides the IP field and stores a `'browser-print'` sentinel to satisfy
  the NOT-NULL column). The **thermal spooler GET excludes non-`network-escpos` jobs** so a
  browser-print job is never streamed to a printer IP.

`generatePrintJobsForOrder` produces jobs for `network-escpos` + `browser-print` stations; any other
driver value yields no jobs (forward-compatible). **The `display` driver was removed** when the KDS
was decoupled (#61/#117): the KDS is not a printer and does **not** ride `salesPrintqueues` — the
`kitchenDisplayBlock` reads orders directly per location and bumps via `salesKdsbumps` (`display-jobs`
/ `kds-bump`). No `printMode: 'display'` job, `DisplayPayload`, or `toDisplayPayload` remains.

### Database Tables (Convention)

Package expects tables with `sales` prefix:
- `salesEvents`, `salesProducts`, `salesCategories`
- `salesOrders`, `salesOrderitems`
- `salesLocations`, `salesClients`, `salesEventsettings`
- `salesPrinters`, `salesPrintqueues` (if print enabled)

User MUST use `sales` as layer name in crouton.config.js.

**No `salesHelpers` table.** Helper sessions live in `scopedAccessToken` (owned by `@fyit/crouton-auth`). See "Helper Authentication" below.

**Client tabs**: `salesClients.isActive` (default true) marks an open tab. The end-receipt endpoint
clears it; inactive clients are excluded from `order-data`'s client list (POS picker) and the
clients panel. `salesPrintqueues.orderId` is **nullable** — end-of-tab receipts belong to the whole
tab, not one order (the complete/fail callbacks skip order auto-complete when null).

**Ticket layout** (bold hierarchy, #1427; refined #1503): kitchen tickets open with a heavy-ruled
**call-out block** — the `#order-number` first at normal size, the client name below at double-size
(a loose order promotes its `#N` to the big slot) — then one compact `HH:MM · helper` meta line.
The location name is deliberately NOT printed (each kitchen printer sits at its location). **Items
pack tight**: a blank separator line prints only around an item that carries options/notes, so runs
of plain items sit together (#1503). A **`TOTAL` prints on any ticket that shows prices** (incl. a
priced `*** PERSONEEL ***` staff ticket), not just customer receipts. Customer receipts keep the
small `Client:` line, print amounts in one **right-aligned price column** (long names wrap within
their column) and a double-height `TOTAL`; end-of-tab receipts (`ReceiptData.clientTab`) reuse the
call-out block with `Orders: N` instead of `Order #x`. Layout lives in crouton-printing's
`receipt-formatter.ts` (`formatReceipt` ESC/POS + `renderTicketHtml` mirror).

### Admin Pages (shipped by this package)

```
app/pages/admin/[team]/sales.vue                 # parent layout with 9-tab navbar
app/pages/admin/[team]/sales/
  index.vue                                      # overview (orders list)
  events.vue → events/index.vue                  # events list (<SalesEventsList/>)
  events/[slug]/index.vue                        # thin wrapper → <SalesEventWorkspaceShell> (tab-param="tab")
  products.vue / categories.vue / orders.vue
  locations.vue / printers.vue / clients.vue
  helpers.vue                                    # ACTIVE helpers (scoped tokens)
```

Event workspace tabs are extracted into reusable components under `app/components/EventWorkspace/`:
`OrdersTab.vue`, `SettingsTab.vue` (+ `SettingsListCard.vue`), auto-imported as
`SalesEventWorkspaceOrdersTab`, etc. `ProductsTab.vue` and `PrintersTab.vue` still exist but are
**no longer mounted anywhere** — products are managed inside the editable POS, printers inside
SettingsTab.

The workspace **shell** itself is `EventWorkspace/Shell.vue` (auto-import `SalesEventWorkspaceShell`):
resolves the event from a `:event-slug` prop via `useCollectionQuery('salesEvents')`, then renders
**kassa-first — no header row**: `<SalesPosPanel>` is the main, chrome-less surface; everything else
is a **pane** (Bestellingen / Klanten / Data / Instellingen) toggled from vertical tabs in the right
gutter, whose top also hosts a compact icon-only **event switcher** (create-event in its
`#content-top`, same pattern as `CroutonFormReferenceSelect`). **Instellingen** (admin only) is the
tabbed `SettingsTab`, opened as a splitter pane on desktop and a `USlideover` on narrow; its
panel-wide **Opslaan** is Shell-hosted in a **fixed footer below the scroll area**, driven by the
`{ save, dirty, saving }` API SettingsTab hands up via a `register` emit (a template ref can't carry
it — the ref binds before an async-setup component's exposed object attaches, #1321). Duplicate/Delete
are explained rows in the Event Details card; the full event form (incl. slug) isn't reachable here.
Beside the POS, up to three **side panes** open via vertical tabs stacked in a reserved gutter at
the kassa's right edge (Shell-owned, no prop plumbing). Any combination can be open at once, each
resizable via Reka UI's Splitter (`SplitterGroup`/`Panel`/`ResizeHandle`; panels carry explicit
`id`/`order` because the set is dynamic; ratios persist via `autoSaveId`). Pane visibility
persists too: `useLocalStorage('sales-workspace-{orders,clients,data}-open')` with `initOnMounted`
(SSR renders closed, restores after hydration); the keys are global across events, so the
clients flag is gated per event by `requiresClient` (`clientsPaneOpen`) and the data flag per
session by `useAuth().loggedIn` (`dataPaneOpen`). **Narrow screens
(`useMediaQuery('(max-width: 1023px)')`) drop the splitter entirely** — side-by-side panes would
squeeze the kassa to nothing — and render the same pane headers + bodies as full-height
`USlideover`s instead, toggled from a **segmented tab strip** above the kassa (no gutter/vertical
tabs in narrow mode). **The right-gutter tabs are desktop-only** — on narrow a **segmented tab
strip** above the kassa replaces them: a compact **icon-only event switcher** (same items +
create-event `#content-top`), the **Instellingen gear** and the
**kassa edit-mode pencil** — lifted out of the kassa's category-tabs row via
the `editMode` defineModel that OrderInterface and PosPanel expose (`hide-edit-toggle` hides the
inline pencil so there's never two). **Settings follow suit on narrow**: Instellingen
opens a `USlideover` instead of the desktop splitter pane (Opslaan in the same fixed footer, driven
by the same registered save API) — only one `SettingsTab` instance ever mounts
(`settingsPaneOpen && !isNarrow` vs `isNarrow`). In
the slideover SettingsTab gets its `tabbed` prop: the three cards (Eventgegevens / Printers /
Actieve helpers) render behind a segmented section strip, one at a time via `v-show` (all stay
mounted so the panel-wide dirty/save covers fields on every tab). The slideover open state is ephemeral (`ref`s, not the
persisted localStorage flags): an overlay auto-opening on page load would trap a phone user. An
open pane's tab hides — the pane header (icon + title, mirroring the tab) carries the close ✕:
- **"Bestellingen"** opens `OrdersTab`; its pane header also carries the orders filter toggle
  (chip = active-filter count; state lifted into Shell, selects live in OrdersTab). The POS
  itself is `@container`-responsive: squeezed below `@2xl` it flips to mobile mode (cart drawer
  at the bottom) regardless of viewport. The drawer is non-portaled (`:portal="false"`) and the
  POS root carries `[contain:layout]`, making it the containing block for the fixed drawer +
  overlay — the cart slides out of the POS module instead of covering the whole page
  (`container-type` alone does NOT contain fixed descendants)
- **"Klanten"** (recurring-clients mode only, `event.requiresClient`) opens
  `EventWorkspace/ClientsPanel.vue` (auto-import `SalesEventWorkspaceClientsPanel`) — the pane
  body only, Shell owns the pane header. **No longer a slideover, and there is no header Clients
  button anymore.** It lists active clients with an open tab (searchable; data from
  `clients/summary`), each with a two-step **Print receipt** button that POSTs `end-receipt`
  (prints the aggregated tab, deactivates the client, removes the row). Rows **expand on click**
  (same sliding-chevron affordance as the orders rows) to preview the aggregated receipt lines —
  fetched lazily on first expand from the `tab` GET, which shares its aggregation with
  `end-receipt`, so the preview matches the print exactly. Not async — it refreshes in
  `onMounted`, remounting fresh on every open (`v-if`), **and live on `crouton:mutation` for
  `salesOrders`** (checkout in `usePosOrder` emits it — the kassa sits right beside the pane;
  expanded rows refetch their preview). After a successful `end-receipt` the panel emits a
  `salesClients` mutation hook so the POS client picker drops the settled client.
- **"Data"** (admin-only: `useAuth().loggedIn` — PIN helpers hold a scoped token, not a session,
  so they never see the tab, #1329) opens `EventWorkspace/DataPanel.vue` (auto-import
  `SalesEventWorkspaceDataPanel`) — the pane body only, Shell owns the pane header. The event's
  key sales numbers beside the kassa, deliberately a **composition** of the existing "data"
  surfaces scoped to the workspace's event: `SalesDashboardSalesSummary` (revenue/orders/avg +
  top products, polling), the revenue-by-day `CroutonChartsWidget` (via `SALES_CHART_KINDS`,
  silently dropped when `@fyit/crouton-charts` isn't installed — `hasApp('charts')`), and
  `SalesBlocksProductMatrixRender` (product × day pivot, reused as-is via `attrs.eventScope`).
  The chart/matrix endpoints are team-members-only, matching the gate.
Per-order print status lives on the order rows as LED dots. Event dates are deliberately not shown
anywhere in the workspace (irrelevant to the POS flow; columns remain in the DB). Deleting the
current event navigates back to the events list via a `crouton:mutation` hook (matched on
`itemIds`). OrdersTab and SettingsTab are async-setup, so each toggle target gets its own
`<Suspense>`.
Props: `eventSlug` (required), `teamParam` (defaults to `route.params.team`, present in both admin
and public CMS routes), `tabParam` (**legacy, ignored** — kept for consumer compatibility),
`showSwitcher` / `showHeaderActions` / `showHeader` (default `true`), and `fill` (default `false`) —
set by the fullscreen-modal host (`EventWorkspaceRender`, narrow member) so the kassa runs
**edge-to-edge**: the shell root flexes to the modal's height (`h-full`) and the kassa drops its
`border rounded-xl` frame + the measured `100dvh` budget (the modal IS the budget). Without `fill`
(admin page + wide inline shell) the kassa keeps the framed, viewport-measured card. The block's
member modal also drops its `p-4` inset when passing `fill`, so nothing boxes the kassa inside the
fullscreen modal.
The `eventWorkspaceBlock` renderer mounts the shell **only for signed-in team members** and passes
`:show-switcher="false"` (event fixed by the editor) — the header stays visible so the
settings/orders toggles are reachable. Anonymous visitors (volunteers) get `<SalesPosPanel>`
from the block instead, never this shell.
The shell uses top-level `await`, so any non-page consumer must give it a `<Suspense>` boundary.

`ProductsTab.vue` renders products as a **drag-reorderable list** (not a table): a bespoke `<ul>`
with `useSortable` (`@vueuse/integrations`, via crouton-core) and a `.drag-handle` grip. Drop
persists the new visual index through the generated `/reorder` endpoint via
`useTreeMutation('salesProducts').reorderSiblings` (`order = index`). The sortable position column
is **`order`** (`integer`, null⇒0) — the one the `sortable: true` generator produces (default
`orderField: 'order'`) and that the whole reorder chain is keyed on: the DB column, the `/reorder`
query, `order-data`, and `useTreeMutation`'s hardwired `order` payload key. The list is sorted by
`order` then title, and reordering operates on the currently **visible** set (whole list, or within
the selected category tab). ⚠️ There is **no `sortOrder` column** — an earlier revision of the POS
components read `sortOrder`, which never existed in any consumer's schema, so reorders silently
reverted to alphabetical (#1524). Each row also surfaces routing/flags: the
product's **location** name (📍) and the active **printer(s)** at that location (🖨️, joined —
derived by matching `salesPrinters.locationId` to the product's `locationId`), plus **options**
and **remark** badges (`hasOptions` / `requiresRemark`). The tab therefore also queries
`salesLocations` + `salesPrinters` scoped to the event.

`OrdersTab.vue` renders orders as a **plain expandable list** (not a table, not sortable) styled to
match `ProductsTab`: a `<ul>` of rows showing the order number (mono, muted), client name, the
helper who created it (`order.owner` — the helper displayName set by the order POST) — no status
badge: the printer LED conveys state. Staff orders (`isPersonnel`) carry a **warning edge bar**
on the row (`border-s-2 border-s-warning`) instead of a badge. **Clicking a row toggles expand**
(accordion-ish via an `expandedIds` Set; the chevron rotates). There is **no edit pencil** —
orders are not editable from the workspace. Filters hide behind a **Filters toggle**
(`UCollapsible`; a `UChip` with the active count marks a collapsed-but-filtered list). The panel
is a `bg-elevated/60` card with a reset button (visible only while filters are active). The toggle
is **header-controllable**: pass `v-model:filters-open` (+ listen to `@update:active-filter-count`
for the chip) and OrdersTab hides its own button — Shell does this to host the toggle in the
orders-pane header next to ✕; standalone usage without the prop keeps the internal button.
Filters: helper,
client (only when the event has `requiresClient` — loose orders carry no `clientId`), printer,
and print status (busy / done / failed; printer + status selects only
render when the event has active printers), stacked **one filter per row**
(single column) so each reads on its own line. No order count, no manual refresh button: the 2s poll is the only refresh. All filters
apply **server-side** (the list is paginated): the component sends `?owner=`, `?clientId=`,
`?printerId=`, `?printStatus=` and the app's generated `sales-orders` GET must honor them —
`getAllSalesOrders` matches printer filters via an EXISTS subquery on `salesPrintqueues`
(`busy` = status 0/1, `done` = 2, `failed` = 9). Filter changes reset to page 1. It does **not**
use `CroutonCollection`.
Each row shows **one combined printer LED** (`orderLed`): worst status across every job of the
order — red (any failed, 9) > pulsing orange (any pending/printing, 0/1) > green (all done, 2);
grey = no jobs at all. A hover `UPopover` on the dot breaks it down **per printer**, listing
**only printers with a job for this order** (derived from the jobs, so inactive printers with old
jobs still appear; an LED dot left of the printer name, latest 24h job time, failure reasons). A
printer without a ticket is irrelevant noise and is omitted; only when the order generated no
tickets at all does the popover show the single `noTicketForPrinter` explanation. Jobs come from the slim `printqueues/status` endpoint — it must include `locationId` +
`printMode` so OrderItems can list what each ticket printed. OrdersTab also queries
`salesLocations` (names the per-location remarks) and passes `:locations`,
`:location-remarks="order.locationRemarks"` and `:has-printers` to the expand panel.

`OrderItems.vue` (auto-import `SalesEventWorkspaceOrderItems`) is the **lazy** expand panel: it
mounts only when a row is expanded (`v-if`), so its `useCollectionQuery('salesOrderitems', { query:
{ orderId } })` fetch fires on first expand, not with the orders list. Content is split into
**two `UTabs` tabs — "Bestelling" | "Printers"** (`sales.orders.tabOrder`/`tabPrinters`;
`default-value="order"` is required because the items carry explicit `value`s; the tab list hides
when the event has no printers and no jobs). The **order tab** renders the order's
`overallRemarks` (`:remarks`) and the **per-location remarks** (`:location-remarks` +
`:locations` for the names, warning-styled "Location: text" lines), then each line: qty ×
product title from the joined `productIdData`, **selected option labels resolved from
`productIdData.options` and stacked one per line** (the stored values are option ids — never
render them raw), per-item remarks, line total, order total. Requires the app's
`sales-orderitems` GET to honor `?orderId=` and the **orders table to have the `locationRemarks`
json column** (package `schemas/orders.json` has it; fanfare migration `0009_spotty_aqueduct`) —
without it the order POST silently drops location remarks and reprints lose them. The **printers
tab** lists jobs via `<SalesPrintqueuesCard>` (each followed by **what that ticket printed**,
stacked one item per line, mirroring the server's `generatePrintJobsForOrder` grouping: kitchen
jobs with a `locationId` = items whose `productIdData.locationId` matches it; kitchen jobs
WITHOUT a location = the synthetic "default" ticket, i.e. only items that themselves have no
location — sent to every kitchen printer; receipt-mode jobs = the whole order). OrdersTab
enriches each slim status row with `printerIdData: { title }` from its printers query so the
card shows the real printer name instead of the generic fallback. The tab shows the
`noTicketForPrinter` explanation when the order generated no tickets (`:has-printers` keeps the
tab visible). Failed lines carry an **icon-only re-print button** in the card's `#actions` slot
(left of the LED, so the dot stays rightmost) — emits `retryJob` to OrdersTab, which POSTs
`printqueues/retry-failed` with `{ jobId }` and refreshes the queue poll. The panel has extra
bottom padding (`pb-6`) to separate an expanded ticket from the next row. The tab row also carries
a **right-aligned whole-order Reprint button** (`UTabs` `#list-trailing` slot, `ms-auto`, #1517):
two-step confirm (arm → fire, since it spits physical paper), emits `reprintOrder` to OrdersTab,
which POSTs `printqueues/retry-failed` with `{ orderId }`. That resets the order's *existing* jobs
from a terminal status (`2` done / `9` failed) back to `0` pending — no new jobs, no forced
receipt — so the transport re-drains and reprints exactly what the order first produced. The
button only shows while the Printers tab does (i.e. the event has printers).

`SettingsTab.vue` edits the event's **core fields inline** (title, currency, client switch,
helper PIN) **plus the receipt text settings** behind **one panel-wide Save button** (disabled
until dirty, with an "unsaved changes" hint). When a host mounts it with `hide-save-bar` the host
renders the Save in a **fixed footer below the scroll area** (`flex-none` bar under the
`flex-1 overflow-y-auto` content), driven by the `{ save, dirty, saving }` API SettingsTab hands
up via its `register` emit — the fields scroll cleanly above it, unlike a sticky-in-scroll bar
which floats over content mid-scroll. Standalone (no `hide-save-bar`) it's SettingsTab's own
top-right row. There are no per-card
save buttons and the client switch no longer auto-saves on toggle — everything commits together:
one `useCollectionMutation('salesEvents').update` for the dirty event fields and one PUT to
`receipt-settings` when the receipt text changed (parallel; `helperPin` is a `salesEvents`
column, so it rides the same update). Duplicate/Delete sit at the Event Details card's bottom as
explained label + description rows. **Slug is intentionally
excluded** (it's the route param; editing it inline breaks the current URL). Layout: **one
3-column row** (`lg:grid-cols-3`). Block 1: the Event Details card — name + currency fields with
the **"Require client" switch** below a separator (persisting `salesEvents.requiresClient` — the
field the POS gates `<SalesClientSelector>` on; clients are **always the reusable kind**, the old
free-text mode and its `use_reusable_clients` eventsetting were removed — existing rows are
simply ignored). Block 2: the **Printers card** (`SettingsListCard.vue`, auto-import
`SalesEventWorkspaceSettingsListCard`), whose **footer hosts the receipt-text fields inline**
(special-instructions title / staff-order header / footer text, loaded from the
`receipt-settings` GET — `SalesSettingsReceiptSettingsModal` is no longer mounted here; the file
remains for the unmounted `PrintersTab`). Block 3: the **Helpers card**, which hosts the shared
Helper-PIN input above the active-helpers list (scoped tokens). **Rotating the PIN locks out old
helpers**: when `helperPin` changed, `saveSettings` POSTs `revoke-helpers` (deactivates the
event's active scoped tokens) — old-PIN sessions die and can't redeem the old PIN (the
before-redeem hook re-syncs the new one into the grant); a manual **"Log out all helpers"** button
(disabled when none active) does the same without changing the PIN. The printers card header carries
the requeue-failed-jobs button (`printqueues/retry-failed`), which also refreshes the LEDs.
Printer rows keep the POS slide-out hover affordances (pencil right; drag grip left when
`orderField` is set). The Categories and Locations cards were **removed** — categories are
edited inline in the kassa (create/rename/reorder; delete via the team-level categories page),
locations via their team-level admin page; SettingsTab still queries `salesLocations` only for
the printer subtitles. Each printer row carries an **online LED** derived from its **most recent
print job** (slim `printqueues/status` endpoint, latest by `completedAt ?? createdAt`): green =
last job completed (the spooler's DLE EOT pre-flight confirmed the printer online), red = last
job failed, pulsing orange = job in flight, grey = never printed. There is no separate ping —
"online" means online as of the last print attempt. Attribution is the pure
`app/utils/printer-led.ts` (`attributePrinterStates`): a job is matched to a printer row by
`printerId` **first, else by an unambiguous `printerTitle`** (the denormalized label every enqueue
site writes) — so a printer whose id drifted from its jobs (deleted+recreated / regenerated
collection) still lights red instead of a false grey (#1507); a title shared by two current rows
is ambiguous and stays grey rather than guess. The `status` endpoint therefore also returns
`printerTitle`. `SettingsListCard` props: `title`, `collection`, `rows`
(`{ id, title, subtitle?, led? }` — `led: { class, label? }` renders a status dot with tooltip
before the title), `pending?`, `emptyLabel?`, `createData?`, `orderField?`; slots
`header-actions` and `footer` (UCard footer passthrough — the printers card uses it for the
receipt-text fields).

### Per-event currency (`useSalesCurrency`)

Each event has a `currency` field (`'EUR' | 'USD'`, default `'EUR'`; nullable column,
null ⇒ EUR). Prices are stored as plain numbers — currency is **display only**. The
`useSalesCurrency()` composable (auto-imported) centralises the symbol + `Intl.NumberFormat`
(`EUR` → `€`/`nl-BE`, `USD` → `$`/`en-US`):
- A container that owns the event calls `provideSalesCurrency(() => event.currency)`; descendants
  call `useSalesCurrency()` (no arg) and inherit it via inject. Used by the POS `OrderInterface`
  (cart, line items, option modifiers) and the workspace `OrdersTab` → `OrderItems`.
- A component that both knows the currency and renders prices passes it directly:
  `useSalesCurrency(() => event.currency)` (e.g. `ProductsTab` product rows). Inject can't see a
  component's own provided value, so pass the override there.
- The customer POS receives the currency through the `order-data` / `by-slug` endpoints → page
  → `<SalesClientOrderInterface :currency>`.
- **Receipts**: `formatReceipt`/`ReceiptData` take a `currencySymbol` (default `€`); the order POST
  and reprint endpoints thread `salesEvent.currency` → `generateAndInsertPrintQueues` →
  `print-queue-service` (`receiptCurrencySymbol()`). Both `€` and `$` are printable in CP858.
- **Known gap**: the `ProductForm` price *input* (`UInputNumber` format-options) stays EUR — the
  form is opened in the crouton overlay (no inject, and `FormDynamicLoader` has no `<Suspense>`, so
  it can't async-look-up the currency). Entry only; the stored price is currency-agnostic.

### Customer POS interface (CMS block)

The standalone `/order/[team]/[event]/{login,index}` pages were removed, and the
separate `orderInterfaceBlock` was later folded into the `eventWorkspaceBlock`:
the customer-facing POS is now that block's **anonymous face** — the renderer
mounts `<SalesPosPanel>` (inline helper PIN login + `<SalesClientOrderInterface>`)
for visitors without a team session. The underlying public endpoints
(`events/[eventId]/by-slug/[slug]`, `events/[eventId]/order-data`,
`events/[eventId]/orders`) are unchanged and consumed via that panel.

### Package-shipped Server Endpoints

All package endpoints live under `/api/crouton-sales/` with an explicit split:

| Path | Auth | Purpose |
|------|------|---------|
| `teams/[id]/events/[eventId]/duplicate` POST | team admin | Clone an event + its categories/locations/products/printers |
| `teams/[id]/events/[eventId]/orders` DELETE | team admin | **Delete all orders** (#1519): bulk-wipe one event's orders, cascading `salesOrders` → `salesOrderitems` → this event's sales-domain `print_jobs` (`source: 'sales'`), scoped strictly to `eventId` — never team-wide. Leaves `salesClients` intact (reusable; open-tab totals reset naturally). Returns `{ deleted: { orders, items, jobs } }`. Cascade sequencing is the pure `deleteAllEventOrders` (`server/utils/delete-event-orders.ts`, unit-tested); backs the typed-confirm danger-zone action in SettingsTab (admin-only, type the event name to enable) |
| `teams/[id]/events/[eventId]/admin-helper-token` POST | team member | Issue a helper scoped-access token without PIN (displayName = user name) — lets logged-in admins open the POS directly |
| `teams/[id]/events/[eventId]/active-helpers` GET | team admin | List currently-logged-in helpers for one event |
| `teams/[id]/active-helpers` GET | team admin | List active helpers across all team events |
| `sync/ingest` POST | `x-sync-key` secret (fail-closed) | Cloud D1 ingest (#178): idempotent upsert of batched outbox events from the Pi pusher. See "Cloud ingest" above. Also stamps the freshness heartbeat (#179) on every call (real batch or idle ping) |
| `teams/[id]/sync-status` GET | team member | Mirror freshness for the live dashboard (#179): `{ lastContactAt, lastEventAt, lastBatchApplied, serverNow }` (epoch ms; `serverNow` lets the client compute age skew-free). Single global heartbeat row; backs `SalesSyncStatus` |
| `teams/[id]/events/[eventId]/print-transport` GET/PUT | team member | Per-event **print flow** (#1324): which transport delivers this event's `network-escpos` jobs — `local-drainer` \| `router-spooler` \| `none` (no row resolves to the `router-spooler` default — always exclusive). Thin authed surface over crouton-printing's `getPrintTransport`/`upsertPrintTransport` (`print_transports` table; printing has no auth, so the domain owns the route — same seam as `enqueuePrintJob`). GET also returns the `lastSpoolerPollAt`/`lastDrainerTickAt` liveness heartbeats. Backs the **Print flow** picker (`<CroutonPrintingTransportPicker>`) in SettingsTab's printers-card footer — instant-apply, deliberately not part of the panel Save. SettingsTab also feeds the picker's per-flow **setup guides** (#1364): translated nl/en/fr checklists (keys `sales.printFlow.setup.*`) with the app-known values pre-filled — this event's id for the router's `EVENT_ID`, the app origin for `API_URL`, the `NUXT_CROUTON_SALES_PRINT_API_KEY` env-var *name* (never the secret). Content mirrors crouton-printing's `print-server/README.md` (sync note there) |
| `teams/[id]/events/[eventId]/receipt-settings` GET/PUT | team admin | Per-event receipt text customization. Reachability: `staff_order_header` prints only on `isPersonnel` orders (Cart's Staff order switch); `special_instructions_title` heads the remark blocks on kitchen tickets — the per-location remarks from the POS and legacy whole-order notes; `footer_text` only on `type: 'receipt'` printer jobs |
| `teams/[id]/events/[eventId]/printers/[printerId]/test-print` POST | team member | **Testprint** (#1391): enqueue a tiny test ticket for one printer through the REAL flow (`refType:'test'`, skipped by order auto-complete) — proves routing + transport + paper in one tap. 409 when the event's Print flow is `none`. Backs the Testprint button in `PrinterForm.vue` (update mode) |
| `teams/[id]/events/[eventId]/printers/[printerId]/preview` GET | team member | **Receipt preview** (#1504): render — never queue — a representative ticket for one printer and return `{ html, printer }`. `html` is `renderTicketHtml` output (the browser-print encoder) for the modal's sandboxed iframe. Resolves receipt-text settings the SAME way real printing does (formatter defaults ⊕ saved `receipt_settings` row — NOT the settings-form GET default), so the preview shows what actually prints. Sample built by `buildPreviewReceipt` (pure, `server/utils/preview-receipt.ts`; personnel order + a note + one detailed item, so all three receipt-text settings and the #1503 spacing show). Backs the Voorbeeld button. |
| `teams/[id]/events/[eventId]/printqueues/retry-failed` POST | team admin | Requeue missed print jobs (status 9, plus jobs stuck at status 1 "printing" for >2 min — fetched by the spooler but never confirmed) back to 0; optional body `{ printerId }` and/or `{ jobId }` (single-line retry). Backs the "Resend failed jobs" button in SettingsTab's printers card and the per-job re-print button in the expanded order |
| `teams/[id]/events/[eventId]/revoke-helpers` POST | team member (`requireTeamEvent`) | Lock out every helper logged in to this event — `revokeScopedTokensForResource('event', eventId)` deactivates the event's active scoped tokens; returns `{ revoked }`. Called by SettingsTab's `saveSettings` when the helper PIN changed, and by the Helpers-card "Log out all helpers" button. The new PIN isn't checked here (the before-redeem hook re-syncs it into the grant on next login) |
| `events/[eventId]/order-data` GET | helper token | All data needed by POS UI (categories are event-scoped — team-wide fetching showed duplicate tabs after event duplication) |
| `events/[eventId]/my-orders` GET | helper token | **The active user's own orders** for this event — the volunteer/admin-facing counterpart of the team-authed workspace "Bestellingen" pane (`OrdersTab`), which a helper token can't reach. Keyed on `salesOrders.owner` (the helper displayName, stable across logins — `createdBy` is the scoped-token id and rotates every login). Returns newest-first orders (cap 100), each with its line items (product title + options joined) and a combined `printStatus` bucket (`none`/`busy`/`done`/`failed`, display/KDS jobs excluded). No filters, no reprint (volunteer reprint is deliberately out). Backs `SalesClientOrderHistory` (the POS order-history slideover) |
| `events/[eventId]/by-slug/[slug]` GET | public | Resolve event by slug (first segment accepts the team's UUID or slug). The param is named `[eventId]` — not `[teamId]` — so it shares one name with its `events/[eventId]/…` siblings: h3 v1/radix3 keeps a single param node per position, and mixing names silently broke the deeper `orders/[orderId]/…` routes (#116) |
| `events/[eventId]/orders` POST | helper token | Create order + generate print queues (kitchen tickets only — no customer receipt) |
| `events/[eventId]/orders/[orderId]/print` POST | helper token | Re-queue prints for an existing order, **including the customer receipt** (`withReceipt: true` — the only per-order receipt path) |
| `events/[eventId]/orders/[orderId]/print-status` GET | helper token | Slim per-order print job status for the POS order button's print watcher (`{ id, status, errorMessage, retryCount, printMode, printerTitle, completedAt }` — printer name joined server-side; order must belong to the event). **Excludes `display` jobs** (they're bumped on a screen, not printed — a display job stays "shown" until the kitchen acts and would hang the checkout button). Empty array = the order generated no tickets, a real answer not an error |
| `teams/[id]/events/[eventId]/orders/[orderId]` DELETE | team **admin** | **Hard-delete** one order (#1518) — verifies the order belongs to this team + event, then cascades via `deleteOrderCascade` (`server/utils/delete-order.ts`): `sales_orderitems` → `print_jobs` (scoped `source='sales'`/`refType='order'`/`refId=orderId`, never a bare `orderId` — the queue is cross-domain) → the order row. The `cancelled` status stays the soft alternative. Backs the two-step `CroutonDeleteButton` in the expanded order row (`OrderItems.vue` → `deleteOrder` emit → `OrdersTab.vue`, which fires the `salesOrders` `crouton:mutation` so the list + POS client picker refresh) |
| `events/[eventId]/display-jobs` GET | none (LAN) | KDS read model for the `display` driver: pending/shown `display` jobs off `salesPrintqueues` for the event, payload parsed (`{ id, orderId, stationId, orderNumber, clientName, isPersonnel, createdAt, items }`). **Flips pending → shown on read** (records the job reached a screen). Backs `kitchenDisplayBlock`. Unauthed — an unattended venue-LAN screen (tightening to a helper token is a follow-up) |
| `events/[eventId]/display-jobs/[jobId]/bump` POST | none (LAN) | Mark a `display` job done (shown → bumped). Bumped maps onto the shared COMPLETED status (`'2'`), so admin order LEDs treat it like a printed ticket; **auto-completes the order** once no job remains open (mirrors the thermal `complete` callback — a display-only "no printer" order completes when bumped). Scoped to the event + `printMode: 'display'` so it can only ever close a display job |
| `events/[eventId]/browser-print-jobs` GET | none (LAN) | Drainer read model for the `browser-print` (AirPrint) driver: pending (status 0) queue rows whose station is a `browser-print` printer, each **server-rendered to HTML** via `renderTicketHtml` (`{ id, orderId, stationId, stationTitle, printMode, locationId, orderNumber, html }`). `?stationId=` narrows to one station. Backs `printBridgeBlock`. Unauthed venue-LAN screen (mirrors `display-jobs`; helper-token tightening is a follow-up). An unparseable payload returns `html: null` so the bridge can fail it instead of crashing the poll |
| `events/[eventId]/browser-print-jobs/[jobId]/done` POST | none (LAN) | Mark a browser-print job completed + auto-complete the order (shared `completePrintJob` in `print-job-complete.ts`). Scoped to the event + a `browser-print` station |
| `events/[eventId]/browser-print-jobs/[jobId]/fail` POST | none (LAN) | Mark a browser-print job failed + flag the order `print_failed` (shared `failPrintJob`). Body `{ errorMessage? }`. Scoped to the event + a `browser-print` station |
| `teams/[id]/events/[eventId]/clients/summary` GET | team member | Active clients with an open tab at this event (`{ id, title, orderCount, total }`, non-cancelled orders only). Backs the workspace clients panel |
| `teams/[id]/events/[eventId]/clients/[clientId]/tab` GET | team member | Read-only preview of a client's open tab: the aggregated receipt lines `end-receipt` would print (`{ lines: [{ name, quantity, price, optionLabels, total }], orderCount, total }`). Backs the expandable rows in the clients panel |
| `teams/[id]/events/[eventId]/clients/[clientId]/end-receipt` POST | team member | Settle a client's tab: aggregates every non-cancelled order (identical product+price+options lines merged — shared `aggregateClientTab` in `server/utils/client-tab.ts`, also used by the `tab` GET), queues ONE end-of-tab receipt (receipt printer, fallback first printer; `orderId: null`, `clientTab` header format) and sets the client `isActive = false` |

### Analytics / Chart Endpoints

Team-scoped aggregation endpoints under `teams/[id]/charts/*` (auth: `resolveTeamAndCheckMembership`).
Each accepts an optional `?eventId=` to scope to one event; omitted ⇒ team-wide. All return
`{ items: [...] }` shaped for `CroutonChartsWidget` (via `@fyit/crouton-charts`). Consumed by the
`salesChartBlock` and catalogued in `app/utils/chart-blocks.ts` (`SALES_CHART_KINDS`).

| Path (GET) | Group by | Returns |
|------------|----------|---------|
| `teams/[id]/charts/revenue-by-day` | day of `orders.createdAt` (`date(...,'unixepoch')`) | `{ date, revenue }` |
| `teams/[id]/charts/revenue-by-product` | product title | `{ product, revenue }` |
| `teams/[id]/charts/revenue-by-category` | category title (null ⇒ Uncategorized) | `{ category, revenue }` |
| `teams/[id]/charts/top-products` | product title, top 10 by qty | `{ product, quantity }` |
| `teams/[id]/charts/units-per-product-day` | day × product, pivoted (one column per product, zero-filled) | `{ date, <product>: units, ... }` — line chart, yFields auto-detected |
| `teams/[id]/charts/product-day-matrix` | product × day, both measures + totals | `{ days, products:[{product,units,revenue,totalUnits,totalRevenue}], dayTotals, grandTotal }` — feeds the `salesProductMatrixBlock` table |
| `teams/[id]/charts/orders-by-status` | order status | `{ status, count }` |
| `teams/[id]/charts/sales-by-location` | product location (null ⇒ No location) | `{ location, revenue }` |

Note: `orderItems.quantity` is TEXT (`cast(... as real)` before summing); `unitPrice`/`totalPrice`
are `real` (no cast).

### Print-Server Polling Endpoints

Separate route prefix: `/api/print-server/*`. Designed for a local LAN spooler that polls our server for jobs, sends ESC/POS bytes to thermal printers, then calls back with status. **Recovery-ready spooler + boot service + setup guide live in this package at `print-server/`** (`teltonika-simple-spooler-fast.sh`, `print_server.init`, `README.md`) — validated on a RUT956 over 5G with the printer on the router LAN. Key field notes: minimal BusyBox has no `base64` applet (spooler uses a pure-awk decoder) and only `nc IP PORT`; RutOS `curl` has working TLS; the spooler's `EVENT_ID` is per-event. The `/jobs` GET **excludes non-`network-escpos` jobs** (driver-filtered) so the spooler never receives a browser-print job.

**In-process drainer (Node target, no external spooler)** — when the app runs on a Node box ON the venue LAN (a Pi/mini-PC), it can open TCP `:9100` to the printers itself instead of running the RUT spooler. `server/utils/escpos-drainer.ts` is a faithful port of the spooler (DLE-EOT pre-flight on its own connection → send ESC/POS + confirmation pass → `classifyStatus` → `completePrintJob`/`failPrintJob`, the **same** queue lifecycle/LEDs — no HTTP callback, it has direct DB access). The `server/plugins/escpos-drainer.ts` Nitro plugin runs it on a poll loop **automatically on a raw-socket-capable runtime** (a Node/venue box; `std-env` `isNode && !isWorkerd` via `crouton-printing/server/utils/drainer-gate.ts`, #1471) — never on Cloudflare Workers, so cloud deploys are unchanged; `CROUTON_PRINTING_DRAINER=1`/`0` is now an override, not a required flag. `node:net` is imported **lazily** (inside `exchange`), keeping the module import-safe on Workers. Claims jobs pending → printing (recoverable by retry-failed on crash) and prints sequentially (one `:9100` connection per Epson TM). **Run EITHER the spooler OR the in-process drainer for a printer set, never both** — since #1324 this is enforced per event by the `print_transports` row (event settings → Print flow): the drainer only serves events explicitly set to `local-drainer` (unset defaults to `router-spooler`), and the spooler's `/jobs` GET returns `[]` for events set to `local-drainer`/`none`.

**Print confirmation (feedback loop)**: the spooler runs a **pre-flight status check on its own connection** (ESC/POS `DLE EOT 1`+`2`+`4`) before sending each ticket — an error-state printer stops draining its receive buffer, so queries appended after a payload would jam behind it and never answer (this is why pre-flight must be a separate connection). Pre-flight failures (`Cover open`, `Paper out`, `Printer error`, `Printer offline`, `Printer not responding - paper out, cover open, or offline?`) fail the job **without sending the ticket**, preventing ghost prints when paper is reloaded. On a healthy pre-flight it sends the payload with the same queries appended as a confirmation pass (socket held open `DRAIN_SECS`, default 2s, which also fixes the silent-loss mode where `nc` closed before the printer drained its buffer); no reply there ⇒ `Printer stopped responding while printing (paper ran out mid-ticket?)`. `/complete` is called only when the printer confirms "online, paper present" — so the UI's **Done** badge means the printer confirmed it could print, not merely "bytes sent over TCP" (old behavior restorable with `STATUS_CHECK=0` for printers that don't answer DLE EOT). The failed job's `errorMessage` is rendered inside `PrintqueuesCard.vue`'s **LED hover popover** (printer name header, status badge, 24h time, error text — same styling as the order-row LED popover); the row itself stays one calm line (printer name, location · retry count meta, time, LED rightmost, with an `#actions` slot before the LED for row buttons).

**Volunteer-facing print feedback (the order button)**: the POS checkout button is the print
status surface — no success toast. `usePosOrder().checkout` returns the order POST's
`printQueueIds`; `OrderInterface` feeds them to `usePrintWatcher()`, which polls the helper-authed
`orders/[orderId]/print-status` GET every 2s (the spooler's own cadence; always sends
`x-scoped-token` explicitly — the shared cookie may carry a different resource's token) and
derives the button state: spinner "Wordt geprint…" (any job 0/1) → green ✓ "Geprint" (all jobs 2,
auto-reverts after ~4s) → warning "Print mislukt" (any job 9, worst-status wins). **A new order
always wins**: items in the cart yield the button back to "Bestel"; failures of previous orders
persist as dismissible warning rows above the button, named by order number + failing printer(s).
Terminal conditions stop a poll: all jobs 2/9, empty `printQueueIds` (no watcher at all), a 401
(stop silently), or a ~60s timeout → "Nog niet geprint — printer offline?" (jobs stuck at 0 —
spooler down). The narrow-pane collapsed cart bar mirrors the state (the drawer auto-closes on
checkout). Watcher is in-memory only — the admin LEDs remain the durable record; volunteer retry
is deliberately out (the reprint endpoint would ghost-print customer receipts).

**Spooler job-loop invariants** (learned from stuck-at-"printing" bugs): jobs are processed **sequentially** (Epson TM printers accept one connection on 9100 — parallel jobs to the same printer starve each other) and there is **no local processed-ids dedup** (the server's `mark_as_printing` flip is the dedup; a requeued job must print again even if this spooler printed it before). The poll uses `-m 30` (a bulk requeue returns every ticket's base64 — `-m 5` truncated over 5G, leaving flipped-but-unparsed jobs stranded), unparseable job ids are failed via callback instead of skipped, and `/complete`/`/fail` callbacks retry 3× with `-f -m 10` (a lost callback strands the job at status=printing).

Auth: shared `x-api-key` header validated against `runtimeConfig.croutonSales.printApiKey` (default `'1234'`; override with env `NUXT_CROUTON_SALES_PRINT_API_KEY`).

| Path | Method | Purpose |
|------|--------|---------|
| `print-server/jobs?mark_as_printing=true` | GET | **Device-scoped poll (#1366)** — the zero-SSH successor of the per-event endpoint. Auth: `x-device-id` + `x-device-code` (the router's self-generated identity; verified against its scoped-access grant via the `crouton:printing:device-auth` hook the sales scoped-access plugin answers). 200 = the same bare jobs array (all pending `network-escpos` jobs of the claimed team's `router-spooler` events, #1324-gated); 428 = `{ status: 'unclaimed', ticket }` with a server-rendered base64 pairing ticket; 401/429 = wrong code / lockout. Claim/revoke UI: `teams/[id]/print-devices` below. |
| `print-server/events/[eventId]/jobs?mark_as_printing=true` | GET | **Legacy** (pre-#1366 script): list pending jobs for ONE event, `x-api-key` authed. Kept during migration — retire once the fleet runs the self-pairing script. |
| `teams/[id]/print-devices` GET/POST + `[deviceId]` DELETE | team member | Router pairing (#1366): list the team's claimed devices; POST `{ deviceId, code }` claims one (creates the scoped-access grant — 409 when another team holds it); DELETE revokes (device drops to unclaimed and re-prints its pairing ticket). Backs `SalesEventWorkspaceRouterPairing` in the Print flow picker's Setup panel (`setup-extra` slot). |
| `print-server/jobs/[jobId]/complete` | POST | Mark status=completed, set completedAt. **Also auto-completes the order**: when no remaining job for that `orderId` is in a non-completed state, sets `salesOrders.status='completed'`. A failed ticket keeps the order out of `completed` until reprinted. |
| `print-server/jobs/[jobId]/fail` | POST | Body `{ errorMessage? }`. Set status=failed, increment retryCount. **Also flags the order** `status='print_failed'` (unless completed/cancelled) so the orders list surfaces the printer problem; once every job later completes, the complete callback flips it to `completed`. `OrderStatus` includes `print_failed`; the OrdersList reprint button shows for it. |

`printData` returned by `/jobs` is already base64-encoded ESC/POS bytes (built by `formatReceipt` in `server/utils/receipt-formatter.ts`). Spooler decodes and writes raw bytes to printer's TCP port 9100.

The spooler script's expected job-row shape: `{ id, printData, printerIp, printerPort, printMode, locationId, retryCount }`.

## Cloud Sync — Pi-side outbox (D1 live mirror)

Part of epic #175 (keep a live online copy of the venue's data). The venue till
runs on a Pi as the authoritative writer; when the 5G uplink is up it pushes its
changes to a Cloudflare D1 **mirror** so an online dashboard (#179) can show
live orders/sales. #176 is the **capture** layer (this package); the push loop
(#177) and cloud ingest (#178) build on the rows it records.

- **Table `sales_sync_outbox`** (`server/database/schema.ts`, package-owned like
  crouton-flow's `flow_configs`). One row **per entity change**, keyed by the
  entity's existing **nanoid** (`entityId`) so the downstream D1 upsert is
  idempotent (re-sending after an uncertain push is safe). `seq` is the monotonic
  cursor the pusher drains oldest-first; `syncedAt` stays NULL until the cloud
  acks. NuxtHub auto-discovers the table via `server/db/schema.ts` — consuming
  apps just run `db:generate` + migrate (or apply `0001_sales_sync_outbox.sql`).
- **Capture** (`recordOutboxEvents()` in `server/utils/sync-outbox.ts`) is wired
  into the existing mutation paths:
  - order create + each order-item → `orders/index.post.ts`
  - print-job create (status `0`) → `generate-print-queues.ts` (the single choke
    point for order/reprint/end-receipt) — the bulky base64 `printData` is
    **omitted** from the mirrored payload (the cloud shows status, never prints)
  - print-status transitions (done `2` / failed `9`) + the order's status flip →
    `print-job-complete.ts` (the path the in-process ESC/POS drainer and the
    browser-print drainer both call)
- **Gated by `CROUTON_SALES_CLOUD_SYNC`** (`'1'`/`'true'`) — OFF by default and
  on every Cloudflare deploy (the cloud *is* the mirror there; only the venue Pi
  captures), mirroring the escpos-drainer env-gate. Capture is **best-effort**:
  failures are logged and swallowed so they can never block the till.
- **Not captured** (deliberate, for #177+ to revisit): the thermal RUT spooler
  callbacks (`print-server/jobs/[jobId]/{complete,fail}` — the cloud-authoritative
  profile, no Pi outbox) and `printqueues/retry-failed` (admin edge, 9→0).

### Cloud ingest (#178)

The cloud side that **receives** the Pi's changes and writes them into D1.

- **Endpoint `POST /api/crouton-sales/sync/ingest`** (`server/api/crouton-sales/sync/ingest.post.ts`).
  Body `{ events: IngestEvent[] }` (the outbox rows); reply
  `{ received, appliedCount, applied: string[], skipped: [{id, reason, permanent}] }`.
  The pusher (#177) advances its cursor past `applied`, retries non-permanent
  skips, drops permanent ones.
- **Auth — fail-closed shared secret** (`server/utils/cloud-sync-auth.ts`,
  `requireCloudSyncKey`): header `x-sync-key` vs `runtimeConfig.croutonSales.cloudSyncSecret`
  (env `NUXT_CROUTON_SALES_CLOUD_SYNC_SECRET`). Unlike the print key there is **no
  default** — unset secret ⇒ 503, wrong key ⇒ 401 (this is the only writer of
  mirrored data, so it must never default to open).
- **Apply** (`server/utils/sync-ingest.ts`, `applyOutboxEvents`): per event,
  **idempotent upsert keyed by the nanoid** into `salesOrders` / `salesOrderitems`
  / `salesPrintqueues` — UPDATE-by-id, INSERT only when absent (replays converge,
  no dup rows). A partial *transition* payload updates only its fields; a *create*
  payload inserts. JSON timestamps are revived to `Date` for timestamp columns
  (`getTableColumns` dataType check), unknown keys dropped. Per-event try/catch:
  malformed ⇒ permanent skip; a transition before its create (INSERT NOT-NULL
  fail) ⇒ non-permanent skip so the pusher retries after the create lands. The
  batch is **not** atomic — partial application is allowed and acked precisely.
  No order-number assignment here (Pi-local).

### Push loop — Pi side (#177)

The Pi-side background loop that actually sends the outbox up to the cloud.

- **Nitro plugin `server/plugins/cloud-sync-pusher.ts`** — mirrors the
  escpos-drainer plugin: starts only when `CROUTON_SALES_CLOUD_SYNC` is set AND
  `CROUTON_SALES_CLOUD_SYNC_URL` is configured (else idle); OFF by default and on
  Cloudflare. Self-chained `setTimeout` (never overlaps): a full batch reschedules
  in 50ms so bursts drain in seconds; on push failure it **backs off
  exponentially** (capped 60s) and resumes on reconnect. Tunables:
  `CROUTON_SALES_CLOUD_SYNC_POLL_MS` (3000), `CROUTON_SALES_CLOUD_SYNC_BATCH` (100).
- **`server/utils/cloud-sync-pusher.ts` `pushPendingOutbox()`** — selects pending
  rows (`syncedAt IS NULL`, `ORDER BY seq`, limited), POSTs `{ events }` to the
  ingest with `x-sync-key` (secret from `NUXT_CROUTON_SALES_CLOUD_SYNC_SECRET`),
  then sets `syncedAt` on the cloud's `applied` ids **and** on permanent skips
  (drop a poison row so it can't wedge the loop); non-permanent skips stay pending
  for the next tick. Transport errors throw → the plugin backs off. Idempotent by
  nanoid downstream, so a push that's uncertain (network dropped after apply) is
  re-sent harmlessly and converges. `fetcher` option is injectable for tests.

### Online dashboard + freshness heartbeat (#179)

The cloud-side read view that closes epic #175: **"see the venue's live data
online."** A mirror row reveals nothing about *when* it arrived, so the
dashboard's defining feature is a **freshness signal** — is the Pi connected and
syncing now, or is this a stale snapshot?

- **Heartbeat table `sales_sync_status`** (`server/database/schema.ts`,
  package-owned, migration `0002`). A **single global row** (`id = 'live'`): one
  venue Pi → one cloud deploy, so a per-team key would only complicate the idle
  ping (which carries no team). Multi-tenant keying is a noted follow-up.
- **`recordSyncHeartbeat()`** (`server/utils/sync-status.ts`) — the ingest
  endpoint stamps it on **every** call: `lastContactAt` always advances (data
  batch OR idle ping → liveness clock), `lastEventAt` + `lastBatchApplied` only
  when real data landed. **Best-effort** (swallows its own errors): a heartbeat
  write can never fail an otherwise-successful ingest.
- **Idle ping** — `pingHeartbeat()` POSTs an empty `{ events: [] }`; the pusher
  plugin fires it only when nothing is pending **and** `CROUTON_SALES_CLOUD_SYNC_HEARTBEAT_MS`
  (default 30000) has elapsed since the last contact. Without it, an online-but-
  quiet till (no orders to push) would look offline. A real push already
  refreshes the same clock, so the ping is purely a no-traffic keepalive.
- **Read** — `GET teams/[id]/sync-status` (team member) returns the heartbeat as
  epoch-ms plus `serverNow` so the client computes age **against the server
  clock** (skew-proof). Backs `SalesSyncStatus`.
- **UI** — `salesLiveDashboardBlock` composes `SalesSyncStatus` (green "Live ·
  synced Xs ago" → amber "Stale · last synced … — the till may be offline" once
  age ≥ 90s ≈ 3 missed pings), `SalesDashboardSalesSummary` (revenue/orders/avg +
  top products off the chart endpoints), and the workspace `OrdersTab` live list.
  All read the same mirrored tables the ingest writes; the orders list's existing
  2s poll already reflects a successful sync within seconds.

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton',
    '@fyit/crouton-auth',  // Required for helper auth
    '@fyit/crouton-sales',
    './layers/sales'  // Generated layer
  ],
  croutonSales: {
    print: { enabled: true }  // Opt-in printing
  }
})
```

## Usage Workflow

1. `pnpm add @fyit/crouton-sales`
2. Copy schemas from package to local `./schemas/`
3. Configure crouton.config.js with `sales` layer
4. Run `crouton config`
5. Add package to nuxt.config extends
6. POS system ready

## Components

Components are auto-imported with `Sales` prefix (e.g., `SalesClientCart`, `SalesAdminPosSidebar`).

### Customer-Facing (`Client/`)
| Component | Auto-import Name | Purpose |
|-----------|------------------|---------|
| `Cart.vue` | `SalesClientCart` | Shopping cart display with quantity controls. Line items (`OrderLineItem.vue`) put the product name, price and qty controls/actions on **one `items-center` row** and stack **option labels and the per-item remark** (warning-colored) underneath, each with a small bullet, no indentation; products are separated by a subtle `divide-y divide-default/60` divider (same as the workspace's expanded order). Footer is **one compact controls row** — remark toggle left (ghost button with count, plus/minus trailing icon; hidden when no cart item has a location), **Staff order** `USwitch` right — with the remarks **`UAccordion` (`type="multiple"`, one item per location that has items in the cart)** sliding open underneath via a trigger-less controlled `UCollapsible` — **but when only ONE location has cart items, its note textarea renders directly, no accordion** (a single collapsible row is pointless chrome); each accordion body is that location's textarea (→ `locationRemarks`, printed as `REMARK:` on that location's ticket only), and a filled textarea shows a primary dot next to its label. **There is no Totaal row** — the total rides the order button (`Bestel · € 20,00`, via `useSalesCurrency`), so the phone drawer spends its pixels on line items. The cart card trims UCard padding to `px-3`/`py-3`. **There is no whole-order remark UI anymore** — `usePosOrder().overallRemarks` still exists and checkout still sends it (always `null` from the POS), and OrdersTab still displays historical `overallRemarks`. Remarks + staff flag bind to `usePosOrder()` refs via props + emits in OrderInterface. Cart items snapshot the product at add-time; OrderInterface watches its products source and calls `usePosOrder().syncCartProducts(fresh)` so admin edits (location/price/title) reach items already in the cart. **Talk-to-order (#1429)**: a mic button sits beside the Bestel button (NOT in the items-gated controls row — a spoken order must be able to start an empty cart; hidden when the browser lacks speech support), pulsing red while listening with a live transcript line above; segments the parser couldn't match render as a dismissible `Niet begrepen` UAlert above the button. Voice state arrives via props (`voiceSupported/voiceListening/voiceTranscript/voiceUnmatched`) + `toggleVoice`/`dismissVoiceUnmatched` emits — OrderInterface hosts `useVoiceOrder()` and pipes parsed lines through `addToCart` (quantity × repeat, merges like taps); nothing ever auto-submits. On narrow panes a second mic button sits beside the collapsed cart bar (outside the drawer trigger) so speaking never requires opening the drawer |
| `ProductList.vue` | `SalesClientProductList` | Product grid with inline option selection |
| `CategoryTabs.vue` | `SalesClientCategoryTabs` | Category navigation tabs. Both modes (UTabs + the sortable admin row) use `flex-1 min-w-fit` tabs in an `overflow-x-auto` list: tabs stretch when they fit and the row scrolls horizontally when they don't — labels never shrink to single letters on narrow screens |
| `ProductOptionsSelect.vue` | `SalesClientProductOptionsSelect` | Product variant/option selection |
| `CartTotal.vue` | `SalesClientCartTotal` | Order total display with item count |
| `OrderInterface.vue` | `SalesClientOrderInterface` | Main order page combining all components. `editable` prop (admin sessions only) grants catalog editing, but the affordances stay **hidden behind an edit-mode toggle** — a pencil button at the tabs row's right (solid + check icon while armed; leaving edit mode also resets the show-inactive filter). All editing surfaces below only render while edit mode is on; CategoryTabs/ProductList are remounted via `:key` on the flip because their `useSortable` init is one-time, gated on `editable` at setup. Catalog editing: "+" buttons open the crouton create forms (category with eventId preset; product with eventId + active categoryId preset), and the active category tab shows a pencil (CategoryTabs `editable`) that **renames inline** — the tab label swaps for an input, enter/blur/click-outside commits (`@rename` → PATCH title), esc cancels — click-outside (VueUse `onClickOutside`) is required because the autofocus `focus()` is ignored on touch devices, so a never-focused input would otherwise never blur (same for the "+" draft tab); the full category form incl. delete stays in the settings panel's list. The category **tabs drag-reorder via a grip handle** on each tab's left (hover-revealed, always visible on touch; CategoryTabs `@reorder` + `reorder-pending` prop — dragging is disabled and the grip shows `cursor-wait` while the previous reorder's PATCHes persist, since a mid-save drag would be dropped and snap back; `useSortable` on the tablist — persists `displayOrder`, which the POS sorts tabs by). Product cards get reorder (drag grip, hover-left) and, **in edit mode, the trailing action is a
pencil (not the "+"/chevron) and tapping any product row opens its edit form — adding to cart is
disabled while editing** (`ProductList` `editable`; the old right-edge slide-out hover pencil was
dropped in favour of the persistent trailing pencil; reorder persists via
`useTreeMutation('salesProducts').reorderSiblings`); the list sorts by `order` then title. An admin toolbar row pinned above the product list carries "add product" and a labeled show-inactive switch — inactive products render dimmed + badged. The Category/Location/Product/Printer update forms put a `CroutonDeleteButton` (shared two-step pill: click arms "sure?", click again deletes; from crouton-core) left of the save button in one `flex items-stretch` footer row — no nested delete overlay. SettingsTab's "Evenement verwijderen" row uses the same pill (deletes directly; Shell's mutation hook navigates away). Single-select options with a required remark render as a `URadioGroup` (a solid selected button read too heavy); multi-select stays checkboxes. PrinterForm's footer lists the actual validation messages (schema fields without a rendered input — e.g. nullable DB columns failing `.optional()` — would otherwise surface as an opaque count) |
| `Selector.vue` | `SalesClientSelector` | Client selector with create-on-type: `USelectMenu create-item` — typing an unknown name surfaces an "\"<naam>\" toevoegen" row, Enter/click creates + selects it inline (`@create` → helper-scoped POST; exact-match guard falls back to selecting the existing client). This is the **only** create path — the old `#content-top` "create new" button + modal were dropped once type-to-create landed. **A client indication is always mandatory** at checkout: `requiresClient` events show this selector, all other events show a plain `UInput` (`sales.cart.namePlaceholder` — "Naam of tafelnummer…") bound to `selectedClientName`; OrderInterface's `hasClient` gates Betalen on id-or-name either way, and the Cart warning text comes from the `clientWarning` prop (`selectClient` vs `enterName`). Clients created inline live in a local `createdClients` bridge until the next order-data refetch confirms them (create emits the `salesClients` `crouton:mutation` hook itself; a `props.clients` watch prunes confirmed copies) — so a tab settled elsewhere drops the client from the list live, and a vanished selection auto-clears |
| `OfflineBanner.vue` | `SalesClientOfflineBanner` | Offline mode indicator |
| `OrderHistory.vue` | `SalesClientOrderHistory` | **Order-history slideover** — the active user's own orders for the event, read from the helper-authed `events/[eventId]/my-orders` endpoint. Same expandable-rows-with-items shape as the workspace `OrdersTab`/`OrderItems` (mono `#number`, client name + time, per-order print-status LED, expand → line items with resolved option labels), but no filters and **no reprint controls** (it's already scoped to one person; volunteer reprint would ghost-print receipts). Mounted only while open (light 4s poll, paused on hidden tab). Opened from a **history-icon button in `OrderInterface`'s narrow-pane cart bar** (`@2xl:hidden`), left of the order button — the "sum-up pane closed" surface on phones. Props: `eventId` (required), `currency?` |

### Orders (`Pos/`)
| Component | Auto-import Name | Purpose |
|-----------|------------------|---------|
| `OrdersList.vue` | `SalesPosOrdersList` | Orders table with status filtering and auto-refresh |
| `Panel.vue` | `SalesPosPanel` | Self-contained POS: resolves the event by slug, then without a matching helper session tries in order: adopt the page gate's event session (`adoptScopedSession` — scoped kassa pages, no second PIN), auto-issue an admin helper token for team sessions (no PIN form), fall back to inline PIN login (generic redeem). Renders `SalesClientOrderInterface` (`editable` when team session), and re-fetches order-data on `crouton:mutation` for `salesProducts`/`salesCategories`/`salesLocations`/`salesEvents`/`salesClients` (salesEvents so flag flips like "Require client" reach the kassa live; salesClients so a settled tab drops out of the client picker). `usePosOrder().checkout` emits the hook itself for `salesOrders` (the order POST bypasses `useCollectionMutation`). Props: `eventSlug` (required), `teamParam?`, `editable?` (default true), `showHeader?`. The header is one slim line — event title `· helper name`, icon-only logout at the right (PIN sessions only — admin sessions would just re-mint a token), no store icon. All loading is client-side (helper sessions live in localStorage). Used by the workspace kassa aside, the `eventWorkspaceBlock`'s anonymous (volunteer) face, and the fanfare admin order page |

### Admin (`Admin/`)
| Component | Auto-import Name | Purpose |
|-----------|------------------|---------|
| `PosSidebar.vue` | `SalesAdminPosSidebar` | Admin navigation sidebar |

### Print Settings (`Settings/`) - Opt-in
| Component | Auto-import Name | Purpose |
|-----------|------------------|---------|
| `ReceiptSettingsModal.vue` | `SalesSettingsReceiptSettingsModal` | Receipt text customization |
| `PrintPreviewModal.vue` | `SalesSettingsPrintPreviewModal` | **Live receipt preview (#1504)** — fetches the `printers/[printerId]/preview` endpoint and drops the server-rendered `renderTicketHtml` output into a **sandboxed iframe** (unthemed paper, #1394), so the preview is byte-faithful to what prints and reflects the printer's `showPrices`/`type` + the event's saved receipt-settings/currency. `v-model:open` + `printer-id`/`event-id`/`team-param` props. Opened by the **Voorbeeld** button in `PrinterForm.vue` (roomy actions row beside Testprint, under the toggles block; saved printers only). Replaced the old hand-drawn "PRINTER TEST" mock. |

### CMS Page Blocks (`Blocks/`) — for `@fyit/crouton-pages`

Registered in `app/app.config.ts` under `croutonBlocks`. Appear in the page
editor's insert menu whenever an app extends both `@fyit/crouton-sales` and
`@fyit/crouton-pages`. The workspace block uses the shared `EventSlugPicker` as
the event field's `propertyComponents` editor.

| Block type | Editor view | Renderer | Purpose |
|------------|-------------|----------|---------|
| `eventWorkspaceBlock` | `SalesBlocksEventWorkspaceView` | `SalesBlocksEventWorkspaceRender` | **The single sales surface for CMS pages — one block, two faces by session.** Anonymous visitors (volunteers) get the kassa only: `<SalesPosPanel>` with inline helper PIN login (this absorbed the removed `orderInterfaceBlock`, incl. its `height` attr — compact/tall/fill, fill grows to the viewport bottom; the height applies to the volunteer kassa only, and **phones (`max-width: 639px`) ignore the attr: the kassa becomes a fixed inset-0 full-screen takeover** with `env(safe-area-inset-top/bottom)` paddings — header under the status bar, cart bar above iOS Safari's floating bottom bar. The layer's `app/plugins/viewport-meta.ts` sets `viewport-fit=cover` (env() insets) + `maximum-scale=1` (suppresses iOS input-focus auto-zoom; pinch still works) via `useHead` — a layer nuxt.config's `app.head` cannot override Nuxt's default viewport meta). Signed-in team members get the full workspace shell (`<SalesEventWorkspaceShell>` — kassa + settings/orders/clients panes; `useAuth().loggedIn` is the discriminator), switcher hidden (event fixed by the editor), header shown for the toggles — **inline only on a wide screen**. On phones/tablets (`max-width: 1023px`, matching Shell's own breakpoint) the inline shell is cramped in the scrolling CMS page, so members instead get the same "Open kassa" launcher → fullscreen modal as volunteers, but the modal hosts the **workspace shell**, not the POS panel (`showInlineShell = loggedIn && !isNarrow`). The member launcher is a **navigation hub**: under the full-width "Open kassa" button, `EventWorkspaceLauncherCards` renders one explained card per surface (Bestellingen / Klanten / Data / Instellingen) with a live headline number (orders total via `?pageSize=1` total, active clients, revenue sum, printer count — best-effort `$fetch`es, '—' on failure). A card opens **only that pane** in its own fullscreen modal via `EventWorkspace/PaneHost.vue` (pane + h-14 header incl. orders filter chip / settings Opslaan) — the kassa is never mounted behind it. "Open kassa" hosts the shell with `show-strip=false`: the kassa runs full-bleed, the edit pencil returns to the category-tabs row and the exit ✕ sits beside it (Shell `closable` → PosPanel → OrderInterface `closable` + `@close` chain — no header/strip rows at all). The shell uses top-level `await`, so the renderer wraps it in its own `<Suspense>` (inline and in the modal). Carries `providesScope: true`: on a `scoped` page the derive-scope hook gates the page behind the event's helper PIN (one login, adopted by the panel) and the page editor hides the access-code field; `EventSlugPicker` warns inline when the picked event has no `helperPin`. category `kassa`. |
| `salesOrdersBlock` | `SalesBlocksOrdersView` | `SalesBlocksOrdersRender` | **Standalone Orders list** — one event's live orders (the same view as the workspace's "Bestellingen" pane: filters + per-order printer LEDs) on its own CMS page, so an admin can build a dedicated orders / kitchen-status screen without the rest of the register. **Team-members-only**: the renderer gates on `useAuth().loggedIn` (orders come from team-scoped admin endpoints) — non-members get a hint, not an error. The event is resolved member-side via the shared `SalesBlocksEventResolver` (a slot component that `await`s `useCollectionQuery('salesEvents')` and hands the full `SalesEvent` to its slot), which the renderer wraps in `<Suspense>` along with the async-setup `SalesEventWorkspaceOrdersTab`. Editor fixes the event by slug (`EventSlugPicker`). `clientOnly`; category `kassa`. |
| `salesClientsBlock` | `SalesBlocksClientsView` | `SalesBlocksClientsRender` | **Standalone Clients list** — one event's open client tabs (the same view as the workspace's "Klanten" pane: active clients with the two-step settle / print-receipt action) on its own CMS page. **Team-members-only** (renderer gates on `useAuth().loggedIn`) and only meaningful for **recurring-client events** — a member on a non-`requiresClient` event gets an explanatory note. Resolves the event member-side via the shared `SalesBlocksEventResolver` inside `<Suspense>`, then renders `SalesEventWorkspaceClientsPanel`. Editor fixes the event by slug (`EventSlugPicker`). `clientOnly`; category `kassa`. |
| `salesLiveDashboardBlock` | `SalesBlocksLiveDashboardView` | `SalesBlocksLiveDashboardRender` | **Live Dashboard (#179, epic #175 — D1 live mirror)** — "see the venue's live data online": one event's mirror-fresh orders + sales on a CMS page, read from the Cloudflare D1 mirror. Deliberately a **composition** of existing pieces: a `SalesSyncStatus` freshness banner (the only new-to-#179 part — "synced Xs ago" / goes stale when the Pi is offline), a `SalesDashboardSalesSummary` (revenue/orders/avg + top products, on the chart endpoints), and the workspace `SalesEventWorkspaceOrdersTab` live orders list. **Team-members-only** (renderer gates on `useAuth().loggedIn` — mirror data is team-scoped); event resolved member-side via `SalesBlocksEventResolver` inside `<Suspense>`. Editor fixes event by slug + optional `title`. `clientOnly`; category `data`. |
| `salesChartBlock` | `SalesBlocksChartBlockView` | `SalesBlocksChartBlockRender` | Sales analytics chart. Editor picks a chart kind + event scope (one event or All events). Renders via `CroutonChartsWidget` **only when `@fyit/crouton-charts` is installed** (`hasApp('charts')` guard); otherwise shows a "Charts package required" notice. In the admin editor the renderer shows a static placeholder (vue-chrts can't survive the property-panel live preview); the real chart renders on the public page — deferred until scrolled into view (`useElementVisibility` latch + `LazyCroutonChartsWidget` + skeleton), so a below-the-fold chart loads vue-chrts only when visible. |
| `salesProductMatrixBlock` | `SalesBlocksProductMatrixView` | `SalesBlocksProductMatrixRender` | Pivot **table** (Nuxt UI `UTable`): rows = products, columns = days, last column = Total, with an interactive Units/Revenue toggle. No charts dependency. Data from `product-day-matrix`. |
| `kitchenDisplayBlock` | `SalesBlocksKitchenDisplayView` | `SalesBlocksKitchenDisplayRender` | **Kitchen Display (KDS)** — a drop-on-a-page screen (typically an iPad), **decoupled from printers** (#61/#117). The editor fixes the event by slug (`EventSlugPicker`) and optionally which locations to show (`LocationsPicker`); the renderer resolves the slug to an id via the public `by-slug` endpoint (same as `SalesPosPanel`), then **reads orders directly** off the `display-jobs` GET — one ticket per `(order × location)`, polled every 2s, NOT off `salesPrintqueues`. "Bump" POSTs `kds-bump` (per-`(order, location)` row in `salesKdsbumps`; optimistic local hide). `clientOnly`; category `kassa`. Not a separate `/kds` app route — the block is the only surface. |
| `printBridgeBlock` | `SalesBlocksPrintBridgeView` | `SalesBlocksPrintBridgeRender` | **Print Bridge** — the browser-side drainer for the `browser-print` (AirPrint) output driver (#127). A drop-on-a-page screen kept open near the printer: resolves the event by slug, polls `browser-print-jobs` (server-rendered ticket HTML), and prints each through the OS / AirPrint dialog (`window.print()` in a hidden iframe), POSTing `done`/`fail`. Same queue + order LEDs as thermal; works in any profile (no LAN socket). Editor fixes the event by slug (`EventSlugPicker`). `clientOnly`; category `kassa`. |
| `SalesBlocksEventResolver` | — | — | Slot helper for the standalone blocks: `await`s `useCollectionQuery('salesEvents')`, resolves an event by slug and exposes the full `SalesEvent` via its default scoped slot (`v-slot="{ event }"`); shows a `notFoundLabel` fallback otherwise. **Team-scoped** — only mount it for `loggedIn` members, inside `<Suspense>`. Shared by `salesOrdersBlock` + `salesClientsBlock`. |
| `SalesBlocksPropertiesEventSlugPicker` | — | — | Searchable event dropdown (uses `useCollectionQuery('salesEvents')`); reused via `propertyComponents.eventSlug` (shared by `eventWorkspaceBlock`, `salesOrdersBlock`, `salesClientsBlock` + `kitchenDisplayBlock`) |
| `SalesBlocksPropertiesEventScopePicker` | — | — | Event scope dropdown for `salesChartBlock` — emits event **id** with an "All events" ('') option; wired via `propertyComponents['sales-event-scope']` |
| `SalesBlocksPropertiesLocationsPicker` | — | — | Multi-select for `kitchenDisplayBlock`'s `locations` attr. **Scoped to the block's event** (#119): reads the sibling `eventSlug` via the `croutonBlockAttrs` inject (provided by crouton-pages' `BlockPropertyPanel`), resolves it to an id and offers **only that event's** `salesLocations` (empty until an event is picked). Wired via `propertyComponents.locations`. |

`croutonApps.sales.pageTypes` is currently empty (the `eventStorefront` page
type and its `eventStorefrontBlock` were removed — the customer POS is the
`eventWorkspaceBlock`'s anonymous face on a normal CMS page).

All renderers are `clientOnly: true` — helper sessions live in localStorage
and the public `events/[eventId]/by-slug/[slug]` endpoint is called at mount.

**All block definitions in `app/app.config.ts` use i18n keys** for `name`,
`description`, and every schema field `label`/`description` and select-option
label — under the `sales.blocks.<block>.…` namespace in
`i18n/locales/{en,nl,fr}.json` (chart-kind dropdown options resolve
`sales.blocks.salesChart.chartKinds.<id>`; the public chart renderer still uses
the English `SALES_CHART_KINDS` labels). The crouton-pages block editor/panel
translate these via `useBlockI18n()`. When adding a block field or option, add
the matching key to all three locale files (keep en/nl/fr at parity).

## Common Tasks

### Add a new product field
1. Update `schemas/products-schema.json`
2. Run `crouton config` to regenerate
3. Run migrations

### Enable printing
1. Set `croutonSales.print.enabled: true` in nuxt.config
2. Add printer/printQueue schemas to crouton.config
3. Regenerate collections

### Customize receipt format
The receipt formatter now lives in `@fyit/crouton-printing`
(`server/utils/receipt-formatter.ts`). Customize it there, or render your own
`ReceiptData` and pass it through `encodeTicket(data, driver)` before
`enqueuePrintJob`. (Sales no longer ships its own copy.)

## Helper Authentication

Helpers (volunteers, staff) authenticate with an event's shared PIN. Every session is a `scopedAccessToken` row in `@fyit/crouton-auth`. There is no separate `salesHelpers` table. "Active Helpers" UI is a query over `scopedAccessToken` filtered by `resourceType='event'` + `organizationId=teamId` (see `active-helpers.get.ts` endpoints).

The PIN check itself lives in crouton-auth. There is **no sales login endpoint anymore** (the bespoke `helper-login` was deleted): `useHelperAuth().login()` redeems against the generic `/api/auth/scoped-access/redeem` (trimming the pin client-side — the generic endpoint doesn't), and a Nitro plugin (`server/plugins/scoped-access.ts`) handles the `crouton:scoped-access:before-redeem` hook to lazily sync `salesEvents.helperPin` into the event's `scopedAccessGrant` (`resourceType 'event'`, role `helper`; trimmed; `skipWhenLocked` so a locked-out attacker can't drive writes). Per-grant lockout (5 fails → exponential lock, surfaced as 429) is crouton-auth's. `salesEvents.helperPin` stays the editable source of truth; the grant is derived state, created on first login (no backfill) and **fully owned by the sync** — never hand-edit it. One accepted regression vs the old endpoint: "no PIN configured" and "event not found" now surface as the generic 401 (no-leak posture on a public endpoint); the admin-visible signal is the `EventSlugPicker`'s missing-PIN warning in the page editor. Helper requests authenticate via the canonical `scoped-access-token` cookie or the `x-scoped-token` header — which also makes helper sessions visible to crouton-pages' `scoped` page visibility during SSR. The legacy `pos-helper-token` cookie and `x-helper-token` header are gone.

### One PIN from page gate to POS (scoped pages)

The same Nitro plugin also answers crouton-pages' `crouton:pages:derive-scope` hook: when a `scoped` page's content contains an `eventWorkspaceBlock`, it resolves the block's `eventSlug` → event **id** and answers `{ resourceType: 'event', resourceId, nameRequired: true }`. The page gate then redeems the **event grant** directly (name mandatory — it prints on tickets and lands on `order.owner`), and the token it mints *is* a helper token. `SalesPosPanel` adopts that session on mount via `useHelperAuth().adoptScopedSession()` (a **copy** into its own localStorage session, so the shift survives cookie clobbering by other scoped flows) — the volunteer logs in once at the gate and never sees the panel's PIN form. The block definition carries `providesScope: true` so the page editor hides the page access-code field behind a hint. When the event can't be resolved (block removed, event deleted, stale slug) the hook answers nothing and the page falls back to its page-code gate. `useHelperAuth().logout()` also clears the adopted-from `useScopedAccess('event')` session — otherwise the panel's mount order (adopt → admin → PIN form) would immediately re-adopt it. It **awaits** the server logout (`/api/auth/scoped-access/logout`) before clearing local state, so the token is revoked and the httpOnly `scoped-access-token` cookie is cleared server-side; without that the scoped CMS page's SSR check would keep serving gated content to a "logged-out" volunteer (the nav fires this right before `reloadNuxtApp`).

### Client-side Usage

```typescript
const { isHelper, helperName, eventId, teamId, login, adoptScopedSession, logout } = useHelperAuth()

// Login with PIN — every login creates a new scoped-access token (via the
// generic /api/auth/scoped-access/redeem; pin trimmed client-side).
// Team members can skip the PIN: loginAsAdmin({ teamId, eventId }) hits the
// admin-helper-token endpoint (session-authed) and stores the same session.
await login({
  teamId: 'team-123',
  eventId: 'event-456',
  pin: '1234',
  helperName: 'John'
})

// Or adopt the page gate's event session (scoped kassa pages):
adoptScopedSession({ teamId: 'team-123', eventId: 'event-456' })

if (isHelper.value) {
  console.log(`Welcome, ${helperName.value}!`)
}

await logout()
```

### Server-side Validation

```typescript
// In API handlers
import { requireScopedAccess } from '@fyit/crouton-auth/server'

export default defineEventHandler(async (event) => {
  const access = await requireScopedAccess(event)

  // access.displayName - Helper's name
  // access.resourceId - Event ID
  // access.organizationId - Team ID
  // access.role - 'helper'
})
```

### Event PIN Setup

Events must have a `helperPin` field configured:

```json
// schemas/events.json
{
  "helperPin": {
    "type": "string",
    "meta": { "label": "Helper PIN", "maxLength": 6 }
  }
}
```

## Demo Seeding (`@fyit/crouton-sales/seed`)

Part of the composable seeding system (epic #82, contract in
`@fyit/crouton-core/shared/seed`). Provider id `sales`, `dependsOn: ['auth']`:

- **Domain seed:** event `vlaamsekermis` (`helperPin: '1234'`, `requiresClient: false`,
  `status: 'active'`), two categories (Dranken/Eten) and five products. No grant
  seeding — the `crouton:scoped-access:before-redeem` hook lazily syncs `helperPin`
  into the event grant on the first PIN login.
- **Block demo (only when crouton-pages is present):** via `ctx.createPageWithBlocks`,
  a `scoped` page (slug `vlaamsekermis`, locale `nl`) embedding an
  `eventWorkspaceBlock` with `eventSlug: 'vlaamsekermis'`. The block stores the
  **slug** (not the id), so the page's scope is derived at read time — no seed-time
  ordering dependency on the event row. Opening `/test1/nl/vlaamsekermis` gates on
  the event's helper PIN.

Idempotent (stable ids). Run via an app's `crouton-seed` / `db:seed:*` scripts.

## Dependencies

- **Extends**: `@fyit/crouton` (required)
- **Peer deps**: `@fyit/crouton-auth`, `@nuxtjs/i18n ^9.0.0`, `zod ^3.0.0`
- **Receipt printing**: zero runtime deps. `receipt-formatter.ts` is a self-contained
  ESC/POS byte builder (CP858 encoding via `ESC t 19`). It does **not** use
  `node-thermal-printer` — that lib pulls in `pngjs`/`iconv-lite`/`unorm`, which
  crash the Cloudflare Workers runtime at init. The server only emits the base64
  ESC/POS payload; the on-site spooler streams it to the printer's TCP port 9100.
  The ticket time is rendered with an explicit IANA timezone (`ReceiptData.timeZone`,
  default `Europe/Brussels`) because CF Workers run in UTC — otherwise the printed
  time is off by the local offset. Fixed ticket labels (Order/Time/Helper/Client/
  NOTES/TOTAL/Yes-No) come from a per-locale map (`ReceiptData.locale`: en/nl/fr,
  **default nl** — matching the nl-BE time rendering); the free-text headers stay
  per-event `receipt-settings`. `ReceiptData` is the **canonical** ticket model with
  two sibling encoders: `formatReceipt` (ESC/POS bytes, thermal) and `renderTicketHtml`
  (a self-contained print-styled HTML document, for the `browser-print`/AirPrint driver
  — same layout, HTML-escaped, 80mm `@page`). `encodeTicket(data, driver)` in
  `print-queue-service.ts` picks the encoder per station.

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
pnpm build          # Build with unbuild
```
