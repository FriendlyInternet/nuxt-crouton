// gh-paginate.mjs — follow GitHub's Link rel="next" across pages (plain fetch, no Octokit).
// `fetchPage(url)` resolves `{ data, link }`. Pure: no I/O here.

/** @param {string|null|undefined} linkHeader @returns {string|null} */
export function nextLink(linkHeader) {
  if (!linkHeader) return null
  for (const part of String(linkHeader).split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

/**
 * @param {(url: string) => Promise<{data: any[], link?: string|null}>} fetchPage
 * @param {string} firstUrl
 * @param {{ maxPages?: number }} [opts]
 * @returns {Promise<{ items: any[], truncated: boolean }>} truncated: stopped at the cap with pages left
 */
export async function fetchAllPages(fetchPage, firstUrl, { maxPages = 20 } = {}) {
  const items = []
  let url = firstUrl
  let pages = 0
  while (url) {
    if (pages >= maxPages) return { items, truncated: true }
    const { data, link } = await fetchPage(url)
    pages++
    if (Array.isArray(data)) items.push(...data)
    url = nextLink(link)
  }
  return { items, truncated: false }
}
