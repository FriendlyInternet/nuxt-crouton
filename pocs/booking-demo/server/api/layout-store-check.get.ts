// The starting value for the /layout-store-check test store (#3650) — a real
// server fetch, so the store's keyed useFetch runs during SSR.
export default defineEventHandler(() => ({ count: 0 }))
