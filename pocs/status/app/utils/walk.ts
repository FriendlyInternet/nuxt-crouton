// Encode a card's "How to check" steps as the `walk` link param (base64url JSON) that
// crouton-feedback's Spec walk opens. Keeps it under ~2 KB by dropping trailing steps.
export function walkParam(item: { app?: string | null, number: number, title: string, steps: string[] }): string {
  const enc = (steps: string[]) => {
    const json = JSON.stringify({
      title: item.title.slice(0, 80),
      app: item.app ?? '',
      ref: `#${item.number}`,
      steps: steps.map(text => ({ text: text.slice(0, 300) }))
    })
    const bin = String.fromCharCode(...new TextEncoder().encode(json))
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  let steps = item.steps.slice(0, 30)
  let out = enc(steps)
  while (out.length > 2048 && steps.length > 1) out = enc(steps = steps.slice(0, -1))
  return out.length > 2048 ? '' : out
}

export function loginHref(item: { app?: string | null, number: number, title: string, steps?: string[] | null, to?: string | null }): string {
  const steps = item.steps ?? []
  const q = new URLSearchParams()
  if (item.to) q.set('to', item.to)
  const w = steps.length ? walkParam({ ...item, steps }) : ''
  if (w) q.set('walk', w)
  const qs = q.toString()
  return `/api/status/login/${item.app}${qs ? `?${qs}` : ''}`
}
