# CLAUDE.md - @fyit/crouton-printing

## Package Purpose

Domain-agnostic **printing** layer for Nuxt Crouton. Provides a shared print-job
queue, the ESC/POS engine, output drivers, and the on-site transport that any
domain package (`crouton-sales`, `crouton-bookings`, …) prints through.

This package owns **how things get printed**; domain packages own **what** to
print. It deliberately knows nothing about orders or bookings — the domain is
carried by a `source` discriminator and an opaque `refType`/`refId`
back-reference, and the ticket content is an opaque `payload`.

> Extracted from `crouton-sales` (epic #325). The forcing function: a second
> consumer (`crouton-bookings`) wanted to print without depending on the whole
> POS. See the epic for the full rationale and the split boundary (cloud-sync /
> Pi-mirror stays in `crouton-sales` — it is NOT here).

## Architecture (the seam)

```
domain package (sales / bookings)         crouton-printing
  render order/booking → payload  ──────▶  enqueuePrintJob(db, …)  → print_jobs
  subscribe to job lifecycle hooks ◀─────  transport drains + delivers, emits hooks
```

- **Generic job table + opaque payload** is the core invariant. Never leak a
  domain type (order/booking) into this package.
- **Dependency direction:** `crouton-printing` depends only on `crouton-core`.
  `crouton-sales` / `crouton-bookings` depend on `crouton-printing`. Never the
  reverse — if you need to react to a job finishing, use the lifecycle hook
  (#329), don't import a domain util.

## Key Files

| File | Purpose |
|------|---------|
| `server/database/schema.ts` | Package-owned `printers` + `print_jobs` + `print_transports` tables (generic; opaque payload + `source`/`refType`/`refId`). The crouton-flow infra-table pattern — NOT `crouton config`. |
| `server/db/schema.ts` | Re-export so NuxtHub auto-discovers the tables in `db:generate`. |
| `server/utils/print-job-queue.ts` | The queue API: `enqueuePrintJob` / `enqueuePrintJobs` + `PRINT_STATUS`. Auto-imported into the merged nitro context. `db` is passed in by the caller (decoupled from any one db util). |
| `server/utils/print-transport.ts` | Per-event transport selection (#1324): `PRINT_TRANSPORT`, `transportAllows`, `getPrintTransport`/`getAllPrintTransports` (missing-table ⇒ legacy, never fail printing), `upsertPrintTransport`, heartbeat throttle. |
| `server/utils/receipt-formatter.ts` | The ticket engine: `EscPosBuilder` (CP858, ESC/POS subset) + the canonical `ReceiptData` template rendered by `formatReceipt` (thermal bytes) and `renderTicketHtml` (browser-print mirror). Bold-hierarchy layout (#1427): heavy `═` call-out block, one-line meta, right-aligned price column (`amountLines`/`wrapText`), double-height total. Rule glyphs are CP858-table-safe but changes here need a paper test on the TM-m30. Byte-stability + column tests in `test/receipt-formatter.test.ts`. |
| `app/components/TransportPicker.vue` | `<CroutonPrintingTransportPicker>` — dumb per-event flow picker + liveness readout. The embedding domain owns fetching/auth and may pass translated `items` (this package ships no i18n). Optional `setupGuides` (#1364): per-flow setup checklists behind a collapsed "Setup" toggle. |
| `app/components/TransportSetupPanel.vue` + `TransportSetupCopyChip.vue` | The setup-guide body (#1364): numbered checklist, copyable value chips (event id / app URL / env-var names), and a verify step carrying the flow's live heartbeat dot. Guide shape in `app/types/transport-setup.ts`; content comes translated from the embedder and **must mirror `print-server/README.md`** (sync note there). |
| `crouton.manifest.ts` | Registers as the `printing` croutonApp (`hasApp('printing')`). |
| `app/app.config.ts` | `croutonApps.printing` registration (headless — no admin routes of its own). |

## Status codes

`PRINT_STATUS` — text values matching the on-site spooler contract:
`'0'` PENDING · `'1'` PRINTING · `'2'` COMPLETED · `'9'` FAILED.

## Common Tasks

### Print something from a domain package
1. Render your ticket to an opaque `payload` (the engine helps — #327).
2. `await enqueuePrintJob(db, { source, printerId, driver, payload, refType, refId, eventId, teamId })`.
3. React to completion via the job-lifecycle hook (#329), not by polling a domain table.

### Choose the print flow per event (#1324)

Which transport delivers an event's `network-escpos` jobs is a **per-event row**
in `print_transports`: `'local-drainer'` (the in-process TCP drainer on a venue
Node box) | `'router-spooler'` (the RUT956 HTTP spooler polling the cloud) |
`'none'` (parked — jobs stay pending). The choice is **always exclusive**: no
row = `DEFAULT_PRINT_TRANSPORT` (`router-spooler`, the cloud/production flow),
so two transports can never serve one event — a Pi rig opts each event in with
`local-drainer`. Enforced at both drain points: `drainPendingEscposJobs` only
serves `local-drainer` events (plus event-LESS jobs, which only it can ever
deliver); the spooler's `jobs.get` returns a soft-empty `[]` for events routed
elsewhere. Each transport stamps a throttled liveness heartbeat
(`lastDrainerTickAt` / `lastSpoolerPollAt`) the picker renders. The env gates
(`CROUTON_PRINTING_DRAINER*`) still decide whether a drainer *process* runs at
all; the row decides *which events* it may serve.

This package has **no auth**, so the HTTP surface for the setting lives in the
domain package (e.g. sales: `teams/[id]/events/[eventId]/print-transport`
GET/PUT calling `getPrintTransport`/`upsertPrintTransport`), which also embeds
`<CroutonPrintingTransportPicker>` — same seam as `enqueuePrintJob`. This row is
a **config entity**: when bidirectional config sync (#802) lands, it should sync.

### Add a new printer driver
Register it in the driver registry (#327, `print-queue-service`) — `network-escpos`
and `browser-print` ship today; `serial`/`usb` are the intended future additions.
A driver that needs a Workers-incompatible native dep belongs in its own optional
add-on, not here (keep this layer Workers-safe; Node-only transport stays
env-gated).

## Roadmap (epic #325)

- #326 ✅ scaffold + generic queue (`enqueuePrintJob`)
- #327 move the engine (ESC/POS formatter + driver registry)
- #328 move the transport (spooler endpoints + drainer + RUT956 script)
- #329 lifecycle hooks + invert the sales sync coupling
- #330 migrate `crouton-sales` to consume this
- #331 data migration (`salesPrinters`/`salesPrintqueues` → generic tables)
- #332 bookings print flow (proves the second consumer)

## Testing

```bash
pnpm --filter @fyit/crouton-printing build   # unbuild the server utils
pnpm -r --filter './apps/*' typecheck        # never `npx nuxt typecheck` from root
```
