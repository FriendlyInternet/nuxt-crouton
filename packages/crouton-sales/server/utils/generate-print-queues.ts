/**
 * @crouton-package crouton-sales
 * Higher-level helper that generates print jobs for an order and enqueues
 * one generic `print_jobs` row per job via the crouton-printing queue
 * (epic #325, #329). Used by both the order-create endpoint and the manual
 * re-print endpoint.
 *
 * The print engine (`generatePrintJobsForOrder`, `enqueuePrintJob`,
 * `PRINT_STATUS`, `DEFAULT_RECEIPT_SETTINGS`) is provided as auto-imported
 * globals by the crouton-printing layer; only the types are pulled via
 * `import type` for the signatures below. Drizzle schema for the sales
 * collections is imported lazily from the consuming app's generated sales layer.
 *
 * The print-status cloud-sync outbox is no longer recorded here — the
 * `printing:job:created` subscriber (`server/plugins/printing-subscriber.ts`)
 * mirrors newly-created jobs to the outbox now, so creation capture rides the
 * generic queue lifecycle instead of this choke point.
 */
import { and, eq } from 'drizzle-orm'
import type {
  OrderItemForPrint,
  PrinterConfig,
  PrintJobData
} from '@fyit/crouton-printing/server/utils/print-queue-service'
import type { ReceiptSettings } from '@fyit/crouton-printing/server/utils/receipt-formatter'

interface GenerateInsertOptions {
  db: any
  orderId: string
  eventId: string
  teamId: string
  helperDisplayName: string
  helperId: string
  orderNumber: string
  clientName?: string
  orderNotes?: string
  /** Free-text remark per location, keyed by locationId. Printed on that location's kitchen ticket. */
  locationRemarks?: Record<string, string>
  teamName: string
  eventName: string
  isPersonnel?: boolean
  /** Event currency ('EUR' | 'USD', default EUR) — sets the receipt price symbol. */
  currency?: string
  /** Queue the customer receipt too — only the manual reprint endpoint sets this. */
  withReceipt?: boolean
}

export async function generateAndInsertPrintQueues(opts: GenerateInsertOptions): Promise<string[]> {
  const { db, orderId, eventId, teamId, helperDisplayName, helperId } = opts

  // Print flow 'none' = no physical printing (#1324): don't enqueue at all.
  // A parked job would never be delivered, so the kassa's print watcher would
  // spin 60s and warn "printer offline?" on every order — an empty id list
  // instead makes checkout behave like an event with zero printers (no
  // watcher, no warning). Flipping to a real flow later only prints NEW
  // orders; older ones stay reachable via the per-order manual reprint.
  // getPrintTransport/PRINT_TRANSPORT are crouton-printing nitro globals,
  // same as enqueuePrintJob below.
  const transportRow = await getPrintTransport(db, eventId)
  if (transportRow?.transport === PRINT_TRANSPORT.NONE) return []

  const { salesOrderitems } = await import('~~/layers/sales/collections/orderitems/server/database/schema')
  const { salesProducts } = await import('~~/layers/sales/collections/products/server/database/schema')
  const { salesLocations } = await import('~~/layers/sales/collections/locations/server/database/schema')
  const { salesPrinters } = await import('~~/layers/sales/collections/printers/server/database/schema')
  const { salesEventsettings } = await import('~~/layers/sales/collections/eventsettings/server/database/schema')

  const printers = await db.select().from(salesPrinters).where(eq(salesPrinters.eventId, eventId))
  if (printers.length === 0) return []

  // Load per-event receipt text customization (settingKey 'receipt_settings').
  // Falls back to defaults when unset or unparseable.
  let receiptSettings: ReceiptSettings = DEFAULT_RECEIPT_SETTINGS
  const [settingsRow] = await db
    .select()
    .from(salesEventsettings)
    .where(and(
      eq(salesEventsettings.eventId, eventId),
      eq(salesEventsettings.settingKey, 'receipt_settings')
    ))
  if (settingsRow?.settingValue) {
    try {
      receiptSettings = { ...DEFAULT_RECEIPT_SETTINGS, ...JSON.parse(settingsRow.settingValue) }
    } catch {
      receiptSettings = DEFAULT_RECEIPT_SETTINGS
    }
  }

  const items = await db.select().from(salesOrderitems).where(eq(salesOrderitems.orderId, orderId))
  if (items.length === 0) return []

  const products = await db.select().from(salesProducts).where(eq(salesProducts.eventId, eventId))
  const productById = new Map(products.map((p: any) => [p.id, p]))

  const locations = await db.select().from(salesLocations).where(eq(salesLocations.eventId, eventId))
  const locationTitleById = new Map(locations.map((l: any) => [l.id, l.title]))

  const printItems: OrderItemForPrint[] = items.map((it: any) => {
    const product: any = productById.get(it.productId)

    // Resolve selected option IDs to readable labels
    let resolvedOptions: Record<string, string> | undefined
    const rawOptions = it.selectedOptions
    if (rawOptions && product?.options && Array.isArray(product.options) && product.options.length > 0) {
      const optionIds = Array.isArray(rawOptions)
        ? rawOptions
        : typeof rawOptions === 'string'
          ? [rawOptions]
          : []
      const labels = optionIds
        .map((id: string) => product.options.find((o: any) => o.id === id)?.label)
        .filter((label: string | undefined): label is string => Boolean(label))
      if (labels.length > 0) {
        resolvedOptions = Object.fromEntries(labels.map((label: string) => [label, label]))
      }
    }

    return {
      productId: it.productId,
      productTitle: product?.title || 'Item',
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      remarks: it.remarks ?? undefined,
      locationId: product?.locationId ?? undefined,
      locationTitle: product?.locationId ? locationTitleById.get(product.locationId) : undefined,
      selectedOptions: resolvedOptions
    }
  })

  const printerConfigs: PrinterConfig[] = printers.map((p: any) => ({
    id: p.id,
    eventId: p.eventId,
    title: p.title,
    ipAddress: p.ipAddress,
    port: p.port ?? undefined,
    locationId: p.locationId ?? undefined,
    showPrices: p.showPrices ?? true,
    type: p.type ?? 'kitchen',
    // Drive the per-station output choice. Null/undefined ⇒ 'network-escpos'
    // (the thermal path) inside generatePrintJobsForOrder, so existing rows are
    // unchanged. Carried through for the browser-print/AirPrint driver; the
    // KDS is decoupled and no longer rides this queue.
    driver: p.driver ?? undefined
  }))

  const jobs: PrintJobData[] = generatePrintJobsForOrder(
    {
      orderId,
      eventId,
      teamId,
      orderNumber: opts.orderNumber,
      clientName: opts.clientName,
      helperName: opts.helperDisplayName,
      orderNotes: opts.orderNotes,
      teamName: opts.teamName,
      eventName: opts.eventName,
      isPersonnel: opts.isPersonnel || false,
      currency: opts.currency,
      createdBy: helperId,
      withReceipt: opts.withReceipt || false
    },
    printItems,
    printerConfigs,
    receiptSettings,
    opts.locationRemarks
  )

  // Enqueue each job into the generic print_jobs queue (crouton-printing). The
  // printer transport details (ip/port/title/driver) are denormalized onto the
  // job at enqueue time so the transport stays self-contained — look them up
  // from the salesPrinter that produced the job. `printing:job:created` fires
  // per insert, which the sales subscriber mirrors to the cloud-sync outbox.
  const printerById = new Map(printers.map((p: any) => [p.id, p]))
  const queueIds: string[] = []
  for (const job of jobs) {
    const printer: any = printerById.get(job.printerId)
    const id = await enqueuePrintJob(db, {
      source: 'sales',
      printerId: job.printerId,
      printerIp: printer?.ipAddress ?? null,
      // salesPrinters.port is text-typed in the generated schema; coerce to a number.
      printerPort: printer?.port != null ? Number(printer.port) : null,
      printerTitle: printer?.title ?? null,
      driver: printer?.driver ?? 'network-escpos',
      payload: job.printData,
      printMode: job.printMode,
      locationId: job.locationId ?? null,
      refType: 'order',
      refId: orderId,
      eventId,
      teamId
    })
    queueIds.push(id)
  }

  return queueIds
}
