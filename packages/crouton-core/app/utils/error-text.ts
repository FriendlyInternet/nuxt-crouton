/**
 * Turn a thrown fetch/H3 error into a sentence for a toast.
 * Nitro v3 carries the reason in `statusText`; legacy errors in `message`.
 * Never returns an object (#2762: toast showed "[object Object]").
 */
export function errorText(error: any, fallback: string): string {
  const candidates = [
    error?.data?.message,
    error?.data?.statusText,
    typeof error?.data === 'string' ? error.data : undefined,
    error?.statusText,
    error?.message,
    typeof error === 'string' ? error : undefined
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return fallback
}
