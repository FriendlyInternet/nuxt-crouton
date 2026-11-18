// WORKAROUND (#4153, remove via #4154): in `custom` routing mode crouton-pages
// still builds public page links as `/<locale>/<slug>` (buildPagePath drops the
// team but keeps the locale), so the editor's "open the public page" link and
// page-link blocks point at `/en/welcome`. This site's public addresses are
// plain (`/<slug>`), so `/en/<slug>` (and `/en`, `/en/`) redirect permanently to
// the plain address — for the site's one locale only; `/xx/<slug>` stays a 404.
// Remove once the package builds plain links in this mode.
export default defineEventHandler((event) => {
  const locale = String(useRuntimeConfig(event).public?.croutonPages?.defaultLocale || 'en')
  const url = getRequestURL(event)
  const match = url.pathname.match(/^\/([^/]+)(?:\/([^/]+))?\/?$/)
  if (!match || match[1] !== locale) return
  const target = match[2] ? `/${match[2]}` : '/'
  return sendRedirect(event, target + url.search, 301)
})
