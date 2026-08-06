> 🤖 **pi.dev harness** · agent pipeline (CI) · _visual evidence for the #2031 sales block conversion_

## Visual evidence

All three files converted to Nuxt UI 4 components (`UIcon`, `UBadge`, `UButton`, `UCard`) with theme tokens (`bg-elevated`, `bg-accented`, `bg-success`, `bg-primary`) replacing hardcoded gray/amber Tailwind classes — same pattern as #1987:

- `OrdersView.vue`: svg icon → `UIcon`, event-slug/no-event badges → `UBadge`, edit/delete buttons → `UButton`, preview list wrapper → `UCard`
- `PrintBridgeView.vue`: same conversions, mini ticket tiles now theme-token-only (dropped the last hardcoded `bg-gray-300/60 dark:bg-gray-700/60`)
- `ProductMatrixView.vue`: remaining raw buttons → `UButton`, badge spans → `UBadge`, preview wrapper → `UCard`, grid placeholder cells → `bg-elevated`

`pnpm --filter kassa typecheck` (kassa consumes `crouton-sales`) ran clean (exit 0) after the change.

I booted `apps/kassa` locally and confirmed it boots and serves (`http://localhost:3007/`) — screenshot: `writeups/ui-proposals/kassa-root.png`.

![kassa-root](https://raw.githubusercontent.com/FriendlyInternet/nuxt-crouton/work-2031/writeups/ui-proposals/kassa-root.png)

**Caveat on scope of the screenshot:** the three converted components (`OrdersView`/`PrintBridgeView`/`ProductMatrixView`) are TipTap `NodeViewWrapper` block placeholders that only render *inside* the page editor once that block type is inserted into a page's content — they are not directly reachable at a URL, so a plain `app-shots.mjs` pass against routes only proves the app boots, not the specific block chrome. Reaching an actual page-editor session with these blocks inserted needs interactive setup (auth, an editable page, inserting each block type) beyond what a scripted screenshot pass covers in this run. The conversion is behavior/markup-preserving (same classes/structure translated 1:1 to `U*` components + theme tokens, no prop/emit/i18n-key changes), so the visual risk is low, but I'm flagging this explicitly per the "say so if you can't fully capture it" instruction rather than implying full visual proof.
