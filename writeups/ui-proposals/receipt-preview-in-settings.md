# UI proposal — live receipt preview in printer settings (#1504)

Net-new UI: a **Voorbeeld** button that opens a modal showing the **real** rendered ticket.
Mockup: `receipt-preview-in-settings.png` (the ticket in the modal is actual `renderTicketHtml`
output, embedded in a sandboxed iframe).

## What changes

- **Roomy actions row** — `Voorbeeld` (eye) + `Testprint` share a full-width row directly under the `Prijzen op bonnen tonen / Actief` block, each half-width with real padding — no longer squeezed beside Verwijderen/Update (owner feedback, rev 2).
- **Footer slims to two** — only `Verwijderen` + `Update printer` stay in the footer.
- **Real ticket, not a mock** — the modal renders `renderTicketHtml` (the exact browser-print engine) in a **sandboxed iframe**, so the preview can never drift from what prints.
- **Reflects this station** — the sample `ReceiptData` is built from the printer's `Prijzen tonen` + `type` and the event's receipt-settings/currency.
- **Unthemed paper** — literal white/ink regardless of app theme (#1394 chrome-vs-paper rule); the modal chrome stays Nuxt UI.
- **Replaces** the unmounted, hand-drawn `PrintPreviewModal.vue` "PRINTER TEST" card.

## Resolved
- **Placement** → roomy row under the toggles block (owner, rev 2).

## Open questions for the reviewer

1. **Sample items** — fixed representative basket (as drawn: a drink + a detailed item + two plain), or pull a few **real recent order lines** for this event so it looks like your actual menu? Drawn: fixed sample.
2. **Kitchen vs receipt** — a receipt-type printer previews the `receipt` layout (footer text, `Client:` line); a kitchen printer previews the `kitchen` call-out. Preview both modes, or just the printer's own type? Drawn: the printer's own type.
