/**
 * @crouton-package crouton-printing
 * @description ESC/POS thermal receipt formatter for POS systems
 * @opt-in Requires print module to be enabled
 *
 * Self-contained ESC/POS byte builder — no native dependencies.
 *
 * The server never talks to a printer directly; it only produces the base64
 * ESC/POS payload that the on-site spooler (e.g. the RUT956 BusyBox script)
 * streams to the printer's raw TCP port (9100). So we only need to emit the
 * byte stream, not a full driver. This replaces `node-thermal-printer`, which
 * dragged in Workers-incompatible deps (pngjs, iconv-lite, unorm) and crashed
 * the Cloudflare runtime at init.
 *
 * Text is encoded to code page 858 (CP850 + €), selected on the printer with
 * `ESC t 19`. This covers Western-European accents and the € sign.
 */

export interface ReceiptItem {
  name: string
  quantity: number
  price?: number
  notes?: string
  options?: Record<string, unknown>
}

// Only the fields the receipt format actually renders. (Earlier versions
// carried items_section_title/complete_order_header/test_* which nothing used.)
export interface ReceiptSettings {
  special_instructions_title: string
  staff_order_header: string
  footer_text: string
}

// Dutch defaults, matching the formatter's default locale — events override
// them per event via receipt-settings.
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  special_instructions_title: 'OPMERKING:',
  staff_order_header: '*** PERSONEEL ***',
  footer_text: 'Bedankt voor je bestelling!'
}

export interface ReceiptData {
  orderNumber: number | string
  orderId: string
  teamName: string
  eventName: string
  clientName?: string
  /** Name of the logged-in volunteer/helper who took the order. */
  helperName?: string
  orderNotes?: string
  items: ReceiptItem[]
  total?: number
  locationName?: string
  /** Free-text remark for this location, printed on the kitchen ticket only. Not a sales item. */
  locationNote?: string
  printMode: 'kitchen' | 'receipt'
  showPrices: boolean
  createdAt: Date | string
  isPersonnel?: boolean
  receiptSettings?: ReceiptSettings
  /**
   * IANA timezone used to render the order time on the ticket. Cloudflare
   * Workers run in UTC, so without this the printed time is off by the local
   * offset. Defaults to Europe/Brussels.
   */
  timeZone?: string
  /**
   * Currency symbol prefixed to prices on the ticket. Derived from the event's
   * currency ('EUR' → '€', 'USD' → '$'). Both glyphs are printable in CP858.
   * Defaults to '€'.
   */
  currencySymbol?: string
  /**
   * End-of-tab summary receipt: aggregates a client's whole tab (several
   * orders) into one settlement ticket. Prints the client name as the big
   * header and an order count instead of a single order number.
   */
  clientTab?: { orderCount: number }
  /** Language for the fixed ticket labels (Order/Time/Helper/…). Default nl. */
  locale?: ReceiptLocale
}

/** Default timezone for rendering receipt timestamps. */
const DEFAULT_TIME_ZONE = 'Europe/Brussels'
const TIME_LOCALE = 'nl-BE'
const DEFAULT_CURRENCY_SYMBOL = '€'

export type ReceiptLocale = 'en' | 'nl' | 'fr'

/** Fixed ticket labels per locale. Default is nl — the formatter already
 * renders times in nl-BE; pass `ReceiptData.locale` to override. */
interface ReceiptLabels {
  orders: string
  order: string
  time: string
  helper: string
  client: string
  notes: string
  total: string
  yes: string
  no: string
}

const RECEIPT_LABELS: Record<ReceiptLocale, ReceiptLabels> = {
  nl: { orders: 'Bestellingen', order: 'Bestelling', time: 'Tijd', helper: 'Helper', client: 'Klant', notes: 'NOTITIES:', total: 'TOTAAL:', yes: 'Ja', no: 'Nee' },
  en: { orders: 'Orders', order: 'Order', time: 'Time', helper: 'Helper', client: 'Client', notes: 'NOTES:', total: 'TOTAL:', yes: 'Yes', no: 'No' },
  fr: { orders: 'Commandes', order: 'Commande', time: 'Heure', helper: 'Bénévole', client: 'Client', notes: 'NOTES :', total: 'TOTAL :', yes: 'Oui', no: 'Non' }
}
const DEFAULT_RECEIPT_LOCALE: ReceiptLocale = 'nl'

export interface FormattedReceipt {
  base64: string
  rawBuffer: Buffer
}

const RECEIPT_WIDTH = 48

// ESC/POS control bytes
const ESC = 0x1B
const GS = 0x1D
const LF = 0x0A

/**
 * Code page 858 high range: byte 0x80..0xFF -> Unicode code point.
 * CP858 == CP850 with the dotless-i at 0xD5 replaced by € (U+20AC).
 */
const CP858_HIGH = [
  0x00C7, 0x00FC, 0x00E9, 0x00E2, 0x00E4, 0x00E0, 0x00E5, 0x00E7, // 80-87
  0x00EA, 0x00EB, 0x00E8, 0x00EF, 0x00EE, 0x00EC, 0x00C4, 0x00C5, // 88-8F
  0x00C9, 0x00E6, 0x00C6, 0x00F4, 0x00F6, 0x00F2, 0x00FB, 0x00F9, // 90-97
  0x00FF, 0x00D6, 0x00DC, 0x00F8, 0x00A3, 0x00D8, 0x00D7, 0x0192, // 98-9F
  0x00E1, 0x00ED, 0x00F3, 0x00FA, 0x00F1, 0x00D1, 0x00AA, 0x00BA, // A0-A7
  0x00BF, 0x00AE, 0x00AC, 0x00BD, 0x00BC, 0x00A1, 0x00AB, 0x00BB, // A8-AF
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x00C1, 0x00C2, 0x00C0, // B0-B7
  0x00A9, 0x2563, 0x2551, 0x2557, 0x255D, 0x00A2, 0x00A5, 0x2510, // B8-BF
  0x2514, 0x2534, 0x252C, 0x251C, 0x2500, 0x253C, 0x00E3, 0x00C3, // C0-C7
  0x255A, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256C, 0x00A4, // C8-CF
  0x00F0, 0x00D0, 0x00CA, 0x00CB, 0x00C8, 0x20AC, 0x00CD, 0x00CE, // D0-D7
  0x00CF, 0x2518, 0x250C, 0x2588, 0x2584, 0x00A6, 0x00CC, 0x2580, // D8-DF
  0x00D3, 0x00DF, 0x00D4, 0x00D2, 0x00F5, 0x00D5, 0x00B5, 0x00FE, // E0-E7
  0x00DE, 0x00DA, 0x00DB, 0x00D9, 0x00FD, 0x00DD, 0x00AF, 0x00B4, // E8-EF
  0x00AD, 0x00B1, 0x2017, 0x00BE, 0x00B6, 0x00A7, 0x00F7, 0x00B8, // F0-F7
  0x00B0, 0x00A8, 0x00B7, 0x00B9, 0x00B3, 0x00B2, 0x25A0, 0x00A0  // F8-FF
]

const UNICODE_TO_CP858: Map<number, number> = (() => {
  const map = new Map<number, number>()
  for (let i = 0; i < CP858_HIGH.length; i++) {
    const cp = CP858_HIGH[i]
    // First mapping wins so canonical Latin-1 chars beat box-drawing aliases
    if (cp !== undefined && !map.has(cp)) map.set(cp, 0x80 + i)
  }
  // OEM glyph for the rightwards arrow used in item notes (matches the old
  // iconv CP437/850 behaviour, which emitted 0x1A for U+2192).
  map.set(0x2192, 0x1A)
  return map
})()

/** Encode a JS string to CP858 bytes; unknown chars fall back to '?'. */
function encodeText(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x3F
    if (cp < 0x80) {
      out.push(cp)
    }
    else {
      out.push(UNICODE_TO_CP858.get(cp) ?? 0x3F)
    }
  }
  return out
}

/**
 * Minimal ESC/POS command builder covering the subset the receipts use.
 * Initializes the printer (ESC @) and selects CP858 (ESC t 19) up front.
 */
class EscPosBuilder {
  private bytes: number[] = []

  constructor(private readonly width = RECEIPT_WIDTH) {
    this.raw(ESC, 0x40) // ESC @  — initialize
    this.raw(ESC, 0x74, 19) // ESC t 19 — select code page 858
  }

  raw(...b: number[]): this {
    for (const x of b) this.bytes.push(x)
    return this
  }

  alignLeft(): this { return this.raw(ESC, 0x61, 0x00) }
  alignCenter(): this { return this.raw(ESC, 0x61, 0x01) }
  bold(on: boolean): this { return this.raw(ESC, 0x45, on ? 1 : 0) }
  invert(on: boolean): this { return this.raw(GS, 0x42, on ? 1 : 0) }
  /** GS ! n — double width + height when on, normal size when off. */
  doubleSize(on: boolean): this { return this.raw(GS, 0x21, on ? 0x11 : 0x00) }
  /** GS ! n — double height only: twice as tall, still 48 columns wide. */
  doubleHeight(on: boolean): this { return this.raw(GS, 0x21, on ? 0x01 : 0x00) }

  print(text: string): this {
    for (const byte of encodeText(text)) this.bytes.push(byte)
    return this
  }

  println(text = ''): this { return this.print(text).raw(LF) }

  drawLine(char = '-'): this { return this.println(char.repeat(this.width)) }

  /** Feed a few lines and perform a full cut. */
  cut(): this { return this.raw(LF, LF, LF, GS, 0x56, 0x00) }

  build(): FormattedReceipt {
    const rawBuffer = Buffer.from(this.bytes)
    return {
      base64: rawBuffer.toString('base64'),
      rawBuffer
    }
  }
}

// ── Ticket design helpers (#1427) ────────────────────────────────────────────
// The "bold hierarchy" layout: heavy ═ rules frame the call-out block, light ─
// rules separate sections, and every amount sits flush right in one column.
// Rule glyphs and × / · are CP858-safe (see the table above) but box-drawing
// output must be paper-verified on the TM-m30 before relying on a change here.

/** Heavy section rule (call-out frame + ticket end). */
const RULE_HEAVY = '═'
/** Light section rule (inner separators). */
const RULE_LIGHT = '─'
/** Left gutter applied to body lines (rules stay full width). */
const GUTTER = ' '

/** Split into words, hard-slicing any word longer than the field. */
function splitWords(text: string, width: number): string[] {
  const out: string[] = []
  for (const word of text.split(' ')) {
    let rest = word
    while (rest.length > width) {
      out.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    if (rest) out.push(rest)
  }
  return out
}

/** Greedy word wrap into lines of at most `width` chars. @internal exported for tests */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of splitWords(text, width)) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  lines.push(line)
  return lines
}

/**
 * Lay out label + right-aligned amount across the 48-col field: the label
 * wraps inside its own column (hanging indent) so a long product name never
 * displaces its price — the amount prints on the first line, flush right.
 * @internal exported for tests
 */
export function amountLines(label: string, amount: string, indent = 1): string[] {
  const labelWidth = Math.max(8, RECEIPT_WIDTH - indent - amount.length - 2)
  const pad = ' '.repeat(indent)
  return wrapText(label, labelWidth).map((line, i) => i === 0
    ? pad + line + ' '.repeat(Math.max(2, RECEIPT_WIDTH - indent - line.length - amount.length)) + amount
    : pad + line)
}

/** Wrap body text under the left gutter (plus an optional extra indent). */
function bodyLines(text: string, indent = 1): string[] {
  const pad = ' '.repeat(indent)
  return wrapText(text, RECEIPT_WIDTH - indent).map(line => pad + line)
}

/** HH:MM in the ticket's timezone — the kitchen only ever needs the clock. */
function timeHM(d: Date, timeZone: string): string {
  return d.toLocaleTimeString(TIME_LOCALE, { timeZone, hour: '2-digit', minute: '2-digit' })
}

/**
 * Generate ESC/POS formatted receipt data for thermal printers
 * Returns both Base64 encoded string and raw buffer
 */
export function formatReceipt(data: ReceiptData): FormattedReceipt {
  const printer = new EscPosBuilder()
  const currencySymbol = data.currencySymbol || DEFAULT_CURRENCY_SYMBOL
  const L = RECEIPT_LABELS[data.locale || DEFAULT_RECEIPT_LOCALE]
  const settings = data.receiptSettings || DEFAULT_RECEIPT_SETTINGS
  const isKitchen = data.printMode === 'kitchen'
  const money = (n: number): string => `${currencySymbol}${n.toFixed(2)}`

  try {
    const orderDate = typeof data.createdAt === 'string'
      ? new Date(data.createdAt)
      : data.createdAt
    const timeZone = data.timeZone || DEFAULT_TIME_ZONE

    // ── Header ──
    // Kitchen: one quiet line — the ticket's stars are below. Receipt: the
    // team is the "brand" line, so it keeps its bold two-line header.
    printer.alignCenter()
    if (isKitchen) {
      printer.println(`${data.teamName} · ${data.eventName}`)
    }
    else {
      printer.bold(true)
      printer.println(data.teamName)
      printer.bold(false)
      printer.println(data.eventName)
    }
    printer.drawLine(RULE_HEAVY)

    // ── Call-out block — the runner's glance target, framed by heavy rules ──
    // Kitchen + end-of-tab: client name double-size with the order number (or
    // tab order count) double-height under it. A loose kitchen order (no
    // client) promotes its order number to the double-size slot instead. The
    // location name is deliberately not printed: each kitchen printer sits at
    // its location, so naming it on the ticket is noise.
    if (isKitchen || data.clientTab) {
      printer.alignLeft()
      printer.println('')
      printer.bold(true)
      printer.doubleSize(true)
      printer.println(GUTTER + (data.clientName ? data.clientName.toUpperCase() : `#${data.orderNumber}`))
      printer.doubleSize(false)
      if (data.clientName) {
        printer.doubleHeight(true)
        printer.println(GUTTER.repeat(2) + (data.clientTab ? `${L.orders}: ${data.clientTab.orderCount}` : `#${data.orderNumber}`))
        printer.doubleHeight(false)
      }
      printer.bold(false)
      printer.println('')
      printer.drawLine(RULE_HEAVY)
    }

    // Staff order banner — full-width inverted bar, right under the call-out.
    if (data.isPersonnel) {
      const label = settings.staff_order_header.slice(0, RECEIPT_WIDTH)
      const pad = RECEIPT_WIDTH - label.length
      const left = Math.floor(pad / 2)
      printer.bold(true)
      printer.invert(true)
      printer.println(' '.repeat(left) + label + ' '.repeat(pad - left))
      printer.invert(false)
      printer.bold(false)
    }

    // ── Meta — one compact line instead of a label per line ──
    printer.alignLeft()
    if (isKitchen) {
      printer.println(GUTTER + [timeHM(orderDate, timeZone), data.helperName].filter(Boolean).join(' · '))
    }
    else {
      if (!data.clientTab) {
        printer.bold(true)
        printer.println(`${GUTTER}${L.order} #${data.orderNumber}`)
        printer.bold(false)
      }
      const date = orderDate.toLocaleDateString(TIME_LOCALE, { timeZone })
      printer.println(GUTTER + [date, timeHM(orderDate, timeZone), data.helperName].filter(Boolean).join(' · '))
      if (data.clientName && !data.clientTab) {
        printer.println(`${GUTTER}${L.client}: ${data.clientName}`)
      }
    }

    // Special instructions / per-location remark — kitchen, above the items.
    // Headed by the customizable special-instructions title; since the POS
    // dropped the whole-order remark, the location note is where that setting
    // actually reaches paper.
    for (const note of [data.orderNotes, data.locationNote]) {
      if (note && isKitchen) {
        printer.drawLine(RULE_LIGHT)
        printer.bold(true)
        printer.println(GUTTER + settings.special_instructions_title)
        printer.bold(false)
        for (const line of bodyLines(note)) printer.println(line)
      }
    }

    printer.drawLine(RULE_LIGHT)

    // ── Items — amounts flush right in one column, names wrap within theirs ──
    for (const [index, item] of (data.items || []).entries()) {
      if (index > 0) printer.println('')

      const qtyName = `${item.quantity}× ${item.name}`
      printer.bold(true)
      if (data.showPrices && item.price !== undefined) {
        for (const line of amountLines(qtyName, money(item.price * item.quantity))) printer.println(line)
      }
      else {
        for (const line of bodyLines(qtyName)) printer.println(line)
      }
      printer.bold(false)

      // Selected options — priced modifiers right-align to the same column.
      for (const [optionName, optionValue] of Object.entries(item.options || {})) {
        if (!optionValue) continue
        let displayValue = ''
        let optionPrice: number | undefined
        if (typeof optionValue === 'object' && optionValue !== null && 'label' in optionValue) {
          const optionObj = optionValue as { label: string, price?: number }
          displayValue = optionObj.label
          if (optionObj.price) optionPrice = Number(optionObj.price)
        }
        else if (typeof optionValue === 'boolean') {
          displayValue = optionValue ? L.yes : L.no
        }
        else {
          displayValue = String(optionValue)
        }
        const label = `· ${optionName === displayValue ? displayValue : `${optionName}: ${displayValue}`}`
        if (data.showPrices && optionPrice) {
          for (const line of amountLines(label, `+${money(optionPrice)}`, 4)) printer.println(line)
        }
        else {
          const suffix = optionPrice ? ` (+${money(optionPrice)})` : ''
          for (const line of bodyLines(label + suffix, 4)) printer.println(line)
        }
      }

      // Item notes/modifications
      if (item.notes) {
        for (const line of bodyLines(`→ ${item.notes}`, 4)) printer.println(line)
      }
    }

    // Order notes at the bottom for receipts
    if (data.orderNotes && !isKitchen) {
      printer.drawLine(RULE_LIGHT)
      printer.bold(true)
      printer.println(GUTTER + L.notes)
      printer.bold(false)
      for (const line of bodyLines(data.orderNotes)) printer.println(line)
    }

    // ── Total — double height, same right-aligned amount column ──
    if (!isKitchen && data.showPrices && data.total !== undefined) {
      printer.drawLine(RULE_LIGHT)
      printer.bold(true)
      printer.doubleHeight(true)
      for (const line of amountLines(L.total, money(data.total))) printer.println(line)
      printer.doubleHeight(false)
      printer.bold(false)
    }

    // ── Footer ──
    printer.drawLine(RULE_HEAVY)
    if (!isKitchen) {
      printer.alignCenter()
      printer.println(settings.footer_text)
    }

    printer.println('')
    printer.cut()

    return printer.build()
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error formatting receipt:', error)
    throw new Error(`Failed to format receipt: ${message}`)
  }
}

/**
 * HTML encoder for the `browser-print` output driver — the sibling of
 * `formatReceipt` (ESC/POS) that targets the OS / AirPrint print dialog
 * (`window.print()`) instead of a thermal printer's TCP port. Takes the SAME
 * canonical `ReceiptData`, so routing + content stay driver-agnostic; only the
 * encoding differs (HTML vs ESC/POS bytes).
 *
 * Returns a self-contained HTML document (own print CSS), sized for an 80mm
 * roll, so a bridge screen can drop it into an iframe and print it as-is. All
 * order-derived text is HTML-escaped.
 */
export function renderTicketHtml(data: ReceiptData): string {
  const currencySymbol = data.currencySymbol || DEFAULT_CURRENCY_SYMBOL
  const L = RECEIPT_LABELS[data.locale || DEFAULT_RECEIPT_LOCALE]
  const settings = data.receiptSettings || DEFAULT_RECEIPT_SETTINGS
  const isKitchen = data.printMode === 'kitchen'

  const esc = (v: unknown): string =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  const money = (n: number): string => `${currencySymbol}${n.toFixed(2)}`

  const orderDate = typeof data.createdAt === 'string' ? new Date(data.createdAt) : data.createdAt
  const ticketTimeZone = data.timeZone || DEFAULT_TIME_ZONE
  const timeStr = `${orderDate.toLocaleDateString(TIME_LOCALE, { timeZone: ticketTimeZone })} · ${timeHM(orderDate, ticketTimeZone)}`

  const rows: string[] = []

  // Header — kitchen gets one quiet line, receipts keep the bold brand line
  // (mirrors formatReceipt's bold-hierarchy layout, #1427).
  rows.push(isKitchen
    ? `<header class="c">${esc(data.teamName)} &middot; ${esc(data.eventName)}</header>`
    : `<header class="c"><strong class="team">${esc(data.teamName)}</strong><div>${esc(data.eventName)}</div></header>`)
  rows.push('<div class="hrx"></div>')

  // Call-out block — client double-size with the order number under it; a
  // loose kitchen order promotes its number to the big slot.
  if (isKitchen || data.clientTab) {
    rows.push(`<div class="client">${esc((data.clientName || `#${data.orderNumber}`).toUpperCase())}</div>`)
    if (data.clientName) {
      rows.push(`<div class="ordernum">${data.clientTab ? `${esc(L.orders)}: ${esc(data.clientTab.orderCount)}` : `#${esc(data.orderNumber)}`}</div>`)
    }
    rows.push('<div class="hrx"></div>')
  }

  if (data.isPersonnel) rows.push(`<div class="staff">${esc(settings.staff_order_header)}</div>`)

  // Meta — one compact line.
  if (isKitchen) {
    rows.push(`<div>${[timeHM(orderDate, ticketTimeZone), data.helperName].filter(Boolean).map(esc).join(' &middot; ')}</div>`)
  }
  else {
    if (!data.clientTab) rows.push(`<div><strong>${esc(L.order)} #${esc(data.orderNumber)}</strong></div>`)
    rows.push(`<div>${esc(timeStr)}${data.helperName ? ` &middot; ${esc(data.helperName)}` : ''}</div>`)
    if (data.clientName && !data.clientTab) rows.push(`<div>${esc(L.client)}: ${esc(data.clientName)}</div>`)
  }

  // Special instructions / per-location remark — kitchen, above the items.
  if (data.orderNotes && isKitchen) {
    rows.push(`<div class="hr"></div><div><strong>${esc(settings.special_instructions_title)}</strong></div><div>${esc(data.orderNotes)}</div>`)
  }
  if (data.locationNote && isKitchen) {
    rows.push(`<div class="hr"></div><div><strong>${esc(settings.special_instructions_title)}</strong></div><div>${esc(data.locationNote)}</div>`)
  }

  rows.push('<div class="hr"></div><ul class="items">')
  for (const item of data.items || []) {
    const showPrice = data.showPrices && item.price !== undefined
    // The name and amount must be DIRECT children of the flex row — wrapped in
    // one <strong> they collapse into a single flex item and the price jams
    // against the name (the pre-#1427 misalignment).
    const line = showPrice
      ? `<span>${esc(item.quantity)}&times; ${esc(item.name)}</span><span class="amt">${esc(money(item.price! * item.quantity))}</span>`
      : `<span>${esc(item.quantity)}&times; ${esc(item.name)}</span>`
    rows.push(`<li><div class="line item">${line}</div>`)
    if (item.options) {
      for (const [optionName, optionValue] of Object.entries(item.options)) {
        if (!optionValue) continue
        let display = ''
        let optionPrice: number | undefined
        if (typeof optionValue === 'object' && optionValue !== null && 'label' in optionValue) {
          const o = optionValue as { label: string, price?: number }
          display = o.label
          if (o.price) optionPrice = Number(o.price)
        }
        else if (typeof optionValue === 'boolean') display = optionValue ? L.yes : L.no
        else display = String(optionValue)
        const label = optionName === display ? esc(display) : `${esc(optionName)}: ${esc(display)}`
        // Priced modifiers share the right-aligned amount column.
        rows.push(data.showPrices && optionPrice
          ? `<div class="line opt"><span>&middot; ${label}</span><span class="amt">+${esc(money(optionPrice))}</span></div>`
          : `<div class="opt">&middot; ${label}${optionPrice ? ` (+${esc(money(optionPrice))})` : ''}</div>`)
      }
    }
    if (item.notes) rows.push(`<div class="opt">&rarr; ${esc(item.notes)}</div>`)
    rows.push('</li>')
  }
  rows.push('</ul>')

  if (data.orderNotes && data.printMode === 'receipt') {
    rows.push(`<div class="hr"></div><div><strong>${esc(L.notes)}</strong></div><div>${esc(data.orderNotes)}</div>`)
  }
  if (data.printMode === 'receipt' && data.showPrices && data.total !== undefined) {
    rows.push(`<div class="hr"></div><div class="line total"><span>${esc(L.total)}</span><span class="amt">${esc(money(data.total))}</span></div>`)
  }
  rows.push('<div class="hrx"></div>')
  if (data.printMode === 'receipt') {
    rows.push(`<div class="c">${esc(settings.footer_text)}</div>`)
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(L.order)} #${esc(data.orderNumber)}</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { width: 80mm; margin: 0 auto; padding: 4mm; font: 13px/1.35 'Menlo','Consolas',monospace; color: #000; }
.c { text-align: center; }
.team { font-size: 15px; }
.client { font-weight: 700; font-size: 24px; text-transform: uppercase; margin: 4px 0 0; }
.ordernum { font-weight: 700; font-size: 17px; margin: 0 0 4px; }
.staff { text-align: center; font-weight: 700; margin: 4px 0; padding: 2px 0; background: #000; color: #fff; }
.hr { border-top: 1px solid #000; margin: 6px 0; }
.hrx { border-top: 3px double #000; margin: 6px 0; }
.items { list-style: none; margin: 0; padding: 0; }
.items li { margin-bottom: 6px; }
.line { display: flex; justify-content: space-between; gap: 8px; }
.line .amt { white-space: nowrap; }
.item { font-weight: 700; }
.total { font-weight: 700; font-size: 17px; }
.opt { padding-left: 12px; }
@media print { body { padding: 0; } }
</style></head><body>${rows.join('')}</body></html>`
}

/**
 * Generate a test receipt for printer testing
 */
export function formatTestReceipt(
  printerName: string,
  ipAddress: string,
  timeZone: string = DEFAULT_TIME_ZONE
): FormattedReceipt {
  const printer = new EscPosBuilder()

  printer.alignCenter()
  printer.bold(true)
  printer.println('PRINTER TEST')
  printer.bold(false)
  printer.drawLine(RULE_HEAVY)

  printer.alignLeft()
  printer.println(`Printer: ${printerName}`)
  printer.println(`IP: ${ipAddress}`)
  printer.println(`Time: ${new Date().toLocaleString(TIME_LOCALE, { timeZone })}`)
  printer.drawLine(RULE_LIGHT)

  printer.alignCenter()
  printer.println('Test completed successfully!')
  printer.println('ESC/POS formatting active')
  printer.println('')
  printer.cut()

  return printer.build()
}
