// Guarded fetch for the AI page builder's "reference URL" (SSRF protection, #4415).
// Host names are not resolved (no DNS lookup) — only literal addresses and reserved names are blocked.

type Hextets = [number, number, number, number, number, number, number, number]

const RESERVED_NAME = /^localhost$|\.local$|\.internal$/

// [network as a 32-bit number, prefix length]
const BLOCKED_V4: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16] // 192.168/16
]

/** Dotted IPv4 literal → 32-bit number, or null when it is not one. */
function v4ToInt(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  const octets = m ? m.slice(1).map(Number) : []
  const valid = octets.length === 4 && octets.every(n => n <= 255)
  return valid ? octets.reduce((acc, n) => acc * 256 + n, 0) : null
}

function inBlockedV4(ip: number): boolean {
  return BLOCKED_V4.some(([net, len]) => Math.floor(ip / 2 ** (32 - len)) === Math.floor(net / 2 ** (32 - len)))
}

function parseHextets(part: string): number[] | null {
  const parts = part ? part.split(':') : []
  return parts.every(h => /^[0-9a-f]{1,4}$/.test(h)) ? parts.map(h => Number.parseInt(h, 16)) : null
}

/** IPv6 literal → its 8 hextets (a dotted IPv4 tail becomes two), or null. */
function expandV6(host: string): Hextets | null {
  const addr = host.replace(/(\d+\.\d+\.\d+\.\d+)$/, (v4) => {
    const n = v4ToInt(v4)
    return n === null ? 'invalid' : `${Math.floor(n / 0x10000).toString(16)}:${(n % 0x10000).toString(16)}`
  })
  const halves = addr.split('::')
  const left = parseHextets(halves[0] ?? '')
  const right = halves.length === 2 ? parseHextets(halves[1] ?? '') : []
  if (!left || !right || halves.length > 2) return null
  const fill = halves.length === 2 ? Math.max(8 - left.length - right.length, 0) : 0
  const out = [...left, ...new Array<number>(fill).fill(0), ...right]
  return out.length === 8 ? (out as Hextets) : null
}

function inBlockedV6(h: Hextets): boolean {
  const zeroUpTo = (n: number) => h.slice(0, n).every(x => x === 0)
  // IPv4-mapped (::ffff:a.b.c.d, or the ::ffff:xxxx:xxxx form the URL parser produces)
  if (zeroUpTo(5) && h[5] === 0xffff) return inBlockedV4(h[6] * 0x10000 + h[7])
  return (zeroUpTo(7) && h[7] <= 1) // :: and ::1
    || (h[0] & 0xfe00) === 0xfc00 // fc00::/7
    || (h[0] & 0xffc0) === 0xfe80 // fe80::/10
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (RESERVED_NAME.test(host)) return true
  if (host.includes(':')) {
    const hextets = expandV6(host)
    return hextets !== null && inBlockedV6(hextets)
  }
  const ip = v4ToInt(host)
  return ip !== null && inBlockedV4(ip)
}

export interface FetchReferencePageOptions {
  maxBytes?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** The parsed URL when it is http(s) and not a blocked host; otherwise null. Throws on a malformed URL. */
function allowedUrl(url: string): URL | null {
  const parsed = new URL(url)
  const httpLike = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  return httpLike && !isBlockedHost(parsed.hostname) ? parsed : null
}

/**
 * Fetch a reference page's raw HTML: http(s) only, never a blocked host, never
 * follows redirects, and never reads more than `maxBytes`. Returns null on any failure.
 */
export async function fetchReferencePage(
  url: string,
  { maxBytes = 512_000, timeoutMs = 8000, fetchImpl = fetch }: FetchReferencePageOptions = {}
): Promise<string | null> {
  try {
    const parsed = allowedUrl(url)
    if (!parsed) return null

    const res = await fetchImpl(parsed.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CroutonBot/1.0)' }
    })
    // Covers 3xx and the opaque status 0 some runtimes give for redirect: 'manual'
    if (res.status < 200 || res.status > 299) return null
    return res.body ? new TextDecoder().decode(await readCapped(res.body, maxBytes)) : ''
  }
  catch {
    return null
  }
}

/** Read a stream up to `maxBytes`, cancelling it once the cap is hit. */
async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader()
  const joined = new Uint8Array(maxBytes)
  let total = 0
  let next = await reader.read()
  while (!next.done && total < maxBytes) {
    const chunk = next.value.subarray(0, maxBytes - total)
    joined.set(chunk, total)
    total += chunk.length
    next = total < maxBytes ? await reader.read() : next
  }
  if (!next.done) await reader.cancel()
  return joined.subarray(0, total)
}
