// github-rest.mjs — a minimal GitHub REST caller (plain fetch, no Octokit).
// githubRest(token, userAgent) → gh(path, init) resolving the parsed JSON (null on 204);
// a non-2xx response throws with the status, path and body.

export function githubRest(token, userAgent) {
  return async function gh(path, init) {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': userAgent,
    }
    if (init?.body) headers['Content-Type'] = 'application/json'
    const res = await fetch('https://api.github.com' + path, { ...init, headers })
    if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
    return res.status === 204 ? null : res.json()
  }
}
