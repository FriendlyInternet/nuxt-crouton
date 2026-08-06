# #2031 — sales block views: visual evidence

The three converted views (`OrdersView`, `PrintBridgeView`, `ProductMatrixView`) are
TipTap `NodeViewWrapper` placeholders. They are **not reachable at a URL** — they only
render inside the page editor once their block is in the document. The original run said
exactly this and committed a capture of `/` instead; that image (`kassa-root.png`) was
blank and is removed.

| | |
|---|---|
| Before (`main` @ `00d4b3683`) | `2031-sales-blocks-before.png` |
| After (`work-2031`) | `2031-sales-blocks-after.png` |

## What the shots show

The conversion is visible in the chrome:

- the `vlaamsekermis` **event pill** gains a border — a raw `<span>` with background
  classes became a `UBadge`
- the block containers gain a border and padding — `UCard` instead of a `div` with
  hardcoded gray/amber Tailwind classes
- the print-bridge tiles become bordered cards rather than flat fills

The blocks are **108px taller** as a result (1672×1284 → 1672×1392). That height change is
why a pixel diff is not meaningful here and the two images have to be read side by side —
unlike #1641/#1642, this PR is *supposed* to change how things look.

## What is NOT covered

The **ProductMatrix** block renders as empty space in **both** shots — it needs matching
product data this seed does not provide. So its conversion is unverified visually; the
before/after shows it unchanged (empty either way), not that its chrome is correct. Its
diff is the same 1:1 class→component translation as the other two, and `pnpm --filter
kassa typecheck` is clean, but that is an argument, not a picture.

## How they were captured

`pnpm preview kassa` (real session, seeded `test1` + the `vlaamsekermis` event), then a
page carrying all three blocks inserted into the local sqlite, opened in the page editor's
**Inhoud** tab. Captured as an **element** screenshot of `.ProseMirror`, at 1440×1400 @2x.

Three traps this run hit, each of which produces a plausible-looking but worthless image:

1. **The tab label is Dutch.** A selector matching only `Content` silently left the capture
   on the Settings tab.
2. **The editor reads `translations.<locale>.content`** and the app edits in NL. Writing
   only `en` gave an empty editor that still screenshotted fine.
3. **The editor has its own scroll**, so a page-level capture cropped the third block.

The script now asserts all three block types are mounted in `.ProseMirror` before it
captures, and refuses on an error page (#2045).
