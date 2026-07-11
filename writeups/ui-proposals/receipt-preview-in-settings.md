# UI proposal — live receipt preview in printer settings (#1504)

Net-new UI: a **Voorbeeld** button in the printer edit form that opens a modal showing the
**real** rendered ticket. Mockup: `receipt-preview-in-settings.png` (the ticket in the modal is
actual `renderTicketHtml` output, embedded in a sandboxed iframe).

## What changes

- **One new button** — `Voorbeeld` (eye icon) sits left of `Testprint` in the printer form footer (`PrinterForm.vue`); saved printers only, same gate as Testprint.
- **Real ticket, not a mock** — the modal renders `renderTicketHtml` (the exact browser-print engine) in a **sandboxed iframe**, so the preview can never drift from what prints and needs no themed re-implementation.
- **Reflects this station** — the sample `ReceiptData` is built from the printer's `Toon prijzen` + `type` and the event's receipt-settings/currency; the `Toon prijzen` toggle flips prices (and the total) live.
- **Unthemed paper** — literal white paper / black ink regardless of app theme (#1394 chrome-vs-paper rule); the modal chrome stays Nuxt UI.
- **Replaces** the unmounted, hand-drawn `PrintPreviewModal.vue` "PRINTER TEST" card.

## Open questions for the reviewer

1. **Placement** — button in the form footer (as drawn), or on each printer **row** in the printers list (hover action) so you can preview without opening the form? Drawn: footer.
2. **Sample items** — fixed representative basket (as drawn: a drink + a detailed item + two plain), or pull a few **real recent order lines** for this event so it looks like your actual menu? Drawn: fixed sample.
3. **Kitchen vs receipt** — a receipt-type printer previews the `receipt` layout (footer text, `Client:` line); a kitchen printer previews the `kitchen` call-out. Preview both modes, or just the printer's own type? Drawn: the printer's own type.
