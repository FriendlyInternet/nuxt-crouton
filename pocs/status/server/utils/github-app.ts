// copy of packages/crouton-feedback/src/runtime/server/utils/githubApp.ts — keep in step
// (deliberate differences: mintInstallationToken takes an injectable `fetchImpl`, so the clock tick
// unit-tests; `pkcs8 as BufferSource` for this app's stricter TS lib typings)
/**
 * GitHub App auth — mint a short-lived installation token, with WebCrypto, dependency-free.
 * Used by the status app's clock (server/utils/clock-tick.ts) to dispatch workflows as the
 * pipeline's bot.
 */

// base64url of raw bytes (JWT segments).
function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// DER length octets for a given content length.
function derLen(n: number): number[] {
  if (n < 0x80) return [n]
  const out: number[] = []
  let x = n
  while (x > 0) {
    out.unshift(x & 0xff)
    x >>= 8
  }
  return [0x80 | out.length, ...out]
}

// Wrap a PKCS#1 RSA key (GitHub's `BEGIN RSA PRIVATE KEY`) into PKCS#8, which WebCrypto requires.
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00]
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const octet = [0x04, ...derLen(pkcs1.length), ...Array.from(pkcs1)]
  const body = [...version, ...algId, ...octet]
  return new Uint8Array([0x30, ...derLen(body.length), ...body])
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Worker/CI secrets often store the PEM with escaped newlines — normalise first.
  const normalised = pem.replace(/\\n/g, '\n')
  const isPkcs1 = normalised.includes('BEGIN RSA PRIVATE KEY')
  const b64 = normalised
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  const pkcs8 = isPkcs1 ? pkcs1ToPkcs8(der) : der
  return crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

/**
 * Sign a short App JWT (RS256). `iat` is backdated 30s for clock skew; ~9 min expiry
 * (well under GitHub's 10-minute cap).
 */
export async function appJwt(appId: string, pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const data = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: now - 30, exp: now + 540, iss: appId })}`
  const key = await importPrivateKey(pem)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data))
  return `${data}.${b64url(new Uint8Array(sig))}`
}

export interface AppCredentials {
  appId: string
  privateKey: string
  installationId: string
}

/**
 * Mint a short-lived (~1h) installation token for the App. Throws on a non-2xx mint
 * response; the message is status-only and never echoes the private key or JWT.
 */
export async function mintInstallationToken(
  creds: AppCredentials,
  userAgent = 'crouton-status',
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const jwt = await appJwt(creds.appId, creds.privateKey)
  const res = await fetchImpl(
    `https://api.github.com/app/installations/${creds.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${jwt}`,
        'accept': 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': userAgent
      }
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to mint installation token (${res.status})`)
  }
  return ((await res.json()) as { token: string }).token
}
