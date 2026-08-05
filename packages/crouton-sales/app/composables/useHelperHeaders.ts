/**
 * The helper scoped-token as an explicit request header.
 *
 * The scoped-access-token cookie is shared with other scoped flows (e.g. an
 * httpOnly page-gate token that can't be overwritten client-side) and may carry
 * a token for a *different* resource — so POS / print calls always send the
 * helper token in the `x-scoped-token` header, which wins server-side. Shared by
 * `usePosOrder` and `usePrintWatcher` (extracted in #1566).
 */
export function useHelperHeaders() {
  const { token: helperToken } = useHelperAuth()
  const helperHeaders = (): Record<string, string> =>
    helperToken.value ? { 'x-scoped-token': helperToken.value } : {}
  return { helperToken, helperHeaders }
}
