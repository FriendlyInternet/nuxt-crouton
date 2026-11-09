# writeups/ui-proposals

Design records only: the `.html` mockup sources and the `.md` "what changes" lists from
`ui-proposal --static`. **No PNGs live here** (#3351) — they bloated the repo (99 files, 15 MB).

Screenshots are published to a non-branch ref (`refs/review-captures/pr<N>` / `issue<N>`) by
`scripts/publish-review-captures.mjs` and embedded in a PR comment tagged
`<!-- review-capture:<key> -->` by commit-ID raw URL. That comment is the one signal the sign-off
checks look for. The 99 old PNGs belonged to merged PRs or closed issues and were deleted; the
`.html`/`.md` files are kept because other docs link them (e.g. `mockups/semantic-zoom/README.md`).

Kept files (each is linked from other docs or is the record of a shipped proposal):

- `1641-seo-tab.md`
- `1642-settings.md`
- `1643-editor.md`
- `2324-content-tab.md`
- `2325-2326-editor-split-after.md`
- `cancel-order.html`
- `delete-all-orders-danger-zone.html`
- `delete-all-orders-danger-zone.md`
- `delete-order.html`
- `delete-order.md`
- `editable-renderer-pane-handles.html`
- `editable-renderer-pane-handles.md`
- `hug-inside-a-split.html`
- `hug-inside-a-split.md`
- `maquette-breakpoint-control.html`
- `mobile-collection-viewer-single-header.html`
- `mobile-collection-viewer-single-header.md`
- `pass-model-options.html`
- `pass-screen-block.html`
- `pass-screen-block.md`
- `per-location-bump.html`
- `per-product-data-pane.html`
- `per-product-data-pane.md`
- `receipt-preview-in-settings.html`
- `receipt-preview-in-settings.md`
- `reprint-order-tabbar.html`
- `reprint-order-tabbar.md`
- `staff-order-icon.html`
- `staff-order-icon.md`
- `ws1-semantic-zoom-shell.md`
- `ws4-compose-gestures.html`
- `ws5-breakpoint-author.html`
- `ws6-collapse-styles.html`
