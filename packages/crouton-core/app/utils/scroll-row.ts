/**
 * Classes for a row that scrolls sideways only (tab bars, chip strips) (#4330, #2399).
 * overflow-x-auto alone makes overflow-y auto too (CSS rule), and Nuxt UI's link-tab
 * indicator sits 1px below the list (-bottom-px), so the row could be dragged up and down.
 * overflow-y-hidden stops that; overscroll-x-contain keeps a swipe from moving the page.
 */
export const SCROLL_ROW_X = 'overflow-x-auto overflow-y-hidden overscroll-x-contain'
