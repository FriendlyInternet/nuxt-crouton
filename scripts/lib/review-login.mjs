// review-login.mjs — sign in to a deployed preview and return the session cookie jar. Extracted
// from smoke-deployed.mjs / seed-review-login.mjs / capture-review-surfaces.mjs (the same sign-in
// + Set-Cookie merge). Best-effort: absent or rejected creds → { loggedIn: false }.

/** Merge a fetch Response's Set-Cookie header(s) into a name→value jar. */
export function mergeCookies(jar, res) {
  const set = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
  for (const sc of set) {
    const pair = sc.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
  return jar
}

/** Render a cookie jar as a `Cookie:` header value. */
export function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

/** Playwright-context cookies for a jar, scoped to `origin`. */
export function jarToContextCookies(jar, origin) {
  const { hostname, protocol } = new URL(origin)
  return Array.from(jar.entries()).map(([name, value]) => ({
    name, value, domain: hostname, path: '/', httpOnly: true, secure: protocol === 'https:'
  }))
}

/** POST /api/auth/sign-in/email and collect the session cookies. Never throws. */
export async function signIn(origin, email, password, log = () => {}) {
  const jar = new Map()
  if (!email || !password) {
    log('no creds — anonymous only')
    return { loggedIn: false, jar }
  }
  try {
    const res = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      redirect: 'manual',
      body: JSON.stringify({ email, password })
    })
    mergeCookies(jar, res)
    if (!res.ok) {
      log(`login: sign-in HTTP ${res.status} — anonymous`)
      return { loggedIn: false, jar }
    }
    return { loggedIn: true, jar }
  } catch (e) {
    log(`login failed (${e.message}) — anonymous`)
    return { loggedIn: false, jar }
  }
}
