/**
 * ticket-editor — a tiny Excalidraw editor that commits edits straight back to the repo.
 *
 *   GET  /?slug=<slug>&branch=<branch>   → the editor page (loads <slug>.excalidraw from the repo)
 *   POST /api/save  { slug, branch, scene, png }   → commits <slug>.excalidraw (+ <slug>.png) to the branch
 *
 * Mobile round-trip with ZERO third-party login: the phone never authorizes anything. On Save,
 * Excalidraw exports the PNG in-browser (exportToBlob, scene embedded) — so the committed image
 * is exactly what you edited (WYSIWYG).
 *
 * Auth = the **Crouton GitHub App** (#519): we mint a short-lived (~1h) installation token
 * just-in-time and commit with it — no stored PAT, and commits post as `nuxt-harness[bot]`. The one
 * durable secret is the App private key. The mint (sign an App JWT → exchange for an installation
 * token) is done directly with WebCrypto — dependency-free, so the worker adds nothing to the
 * monorepo lockfile (and the signing path is unit-testable in plain Node).
 *
 * Setup (Worker secrets / vars):
 *   wrangler secret put GITHUB_APP_PRIVATE_KEY   (the App's PEM private key — the only secret)
 *   GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID    (not sensitive — set as vars or secrets)
 */
import { branchAllowed, issueAllowed, verifyOwnerToken } from './guard.ts'

interface Env {
  OWNER_TOKEN_SECRET: string // derived in CI from REVIEW_SEED_SECRET; empty → every save is refused
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string // PEM; the one durable secret
  GITHUB_APP_INSTALLATION_ID: string
  REPO: string // "FriendlyInternet/nuxt-crouton"
  DIAGRAMS_DIR: string // "writeups/diagrams"
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/api/save') return save(req, env)
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/edit')) {
      return new Response(PAGE.replace(/__REPO__/g, env.REPO), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    return new Response('Not found', { status: 404 })
  },
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}

// UTF-8 safe base64 for text content.
function toB64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

// ── GitHub App auth (WebCrypto, dependency-free) ─────────────────────────────
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
  const isPkcs1 = pem.includes('BEGIN RSA PRIVATE KEY')
  const b64 = pem.replace(/-----BEGIN [A-Z ]+-----/, '').replace(/-----END [A-Z ]+-----/, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  const pkcs8 = isPkcs1 ? pkcs1ToPkcs8(der) : der
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

// Sign a short App JWT (RS256) — iat backdated 30s for clock skew, ~9min expiry.
async function appJwt(appId: string, pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const data = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: now - 30, exp: now + 540, iss: appId })}`
  const key = await importPrivateKey(pem)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data))
  return `${data}.${b64url(new Uint8Array(sig))}`
}

// Mint a short-lived (~1h) installation token for the Crouton App — minted just-in-time, no PAT.
async function installationToken(env: Env): Promise<string> {
  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY)
  const res = await fetch(
    'https://api.github.com/app/installations/' + env.GITHUB_APP_INSTALLATION_ID + '/access_tokens',
    { method: 'POST', headers: { authorization: 'Bearer ' + jwt, accept: 'application/vnd.github+json', 'user-agent': 'ticket-editor' } },
  )
  if (!res.ok) throw new Error('mint installation token → ' + res.status + ' ' + (await res.text()))
  return ((await res.json()) as { token: string }).token
}

// Returns the created commit's sha + its parent's sha, so callers can build immutable
// raw URLs (`raw.githubusercontent.com/<repo>/<sha>/<path>`) that never drift — the basis
// for a stable before/after comparison.
async function putFile(token: string, env: Env, branch: string, path: string, contentB64: string, message: string): Promise<{ commitSha: string; parentSha?: string }> {
  const api = 'https://api.github.com/repos/' + env.REPO + '/contents/' + path
  const headers = {
    authorization: 'Bearer ' + token,
    accept: 'application/vnd.github+json',
    'user-agent': 'ticket-editor',
    'content-type': 'application/json',
  }
  let sha: string | undefined
  const getRes = await fetch(api + '?ref=' + encodeURIComponent(branch), { headers })
  if (getRes.ok) sha = ((await getRes.json()) as { sha?: string }).sha
  const putRes = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message, content: contentB64, branch, sha }),
  })
  if (!putRes.ok) throw new Error('PUT ' + path + ' → ' + putRes.status + ' ' + (await putRes.text()))
  const data = (await putRes.json()) as { commit?: { sha?: string; parents?: Array<{ sha?: string }> } }
  return { commitSha: data.commit?.sha || '', parentSha: data.commit?.parents?.[0]?.sha }
}

// Post a NEW comment on the linked issue for each Save, with the diagram pinned to the commit it
// was saved at — `raw.githubusercontent.com/<repo>/<sha>/<path>` is immutable, so every comment
// keeps its own version forever. The result is a timeline of frozen diagrams (the original/proposal
// comment stays the original; each edit is its own comment). (#583)
async function postSaveComment(token: string, env: Env, issue: number, slug: string, branch: string, origin: string, commitSha?: string): Promise<void> {
  const headers = {
    authorization: 'Bearer ' + token,
    accept: 'application/vnd.github+json',
    'user-agent': 'ticket-editor',
    'content-type': 'application/json',
  }
  const dir = env.DIAGRAMS_DIR || 'writeups/diagrams'
  const path = dir + '/' + slug + '.png'
  const img = commitSha
    ? 'https://raw.githubusercontent.com/' + env.REPO + '/' + commitSha + '/' + path // immutable
    : 'https://raw.githubusercontent.com/' + env.REPO + '/' + branch + '/' + path + '?v=' + Date.now()
  const editUrl = origin + '/?slug=' + encodeURIComponent(slug) + '&branch=' + encodeURIComponent(branch) + '&issue=' + issue
  const body =
    '✏️ **`' + slug + '`** edited via the [ticket-editor](' + editUrl + ') — committed to `' + branch + '`.\n\n' +
    '![' + slug + '](' + img + ')\n\n' +
    'Reply **`approve`** / **`lgtm`** to sign off — nothing continues automatically.\n\n' +
    '_' + new Date().toISOString() + '_'
  const post = await fetch('https://api.github.com/repos/' + env.REPO + '/issues/' + issue + '/comments', {
    method: 'POST', headers, body: JSON.stringify({ body }),
  })
  if (!post.ok) throw new Error('POST comment → ' + post.status + ' ' + (await post.text()))
}

// Branch + issue guards (#3261): returns the 403 to send, or null when the target is allowed.
async function refuseTarget(token: string, repo: string, branch: string, issue: number | string | undefined): Promise<Response | null> {
  if (!(await branchAllowed(fetch, token, repo, branch))) {
    return json({ error: 'branch refused: the default and protected branches cannot be saved to' }, 403)
  }
  if (issue != null && issue !== '') {
    const n = /^[0-9]+$/.test(String(issue)) ? Number(issue) : NaN
    if (!(await issueAllowed(fetch, token, repo, n))) return json({ error: 'issue refused: not an issue in this repo' }, 403)
  }
  return null
}

async function maybeComment(token: string, env: Env, issue: number | string | undefined, slug: string, branch: string, origin: string, commitSha?: string): Promise<string | undefined> {
  const issueNum = issue != null && /^[0-9]+$/.test(String(issue)) ? Number(issue) : undefined
  if (!issueNum) return undefined
  try {
    await postSaveComment(token, env, issueNum, slug, branch, origin, commitSha)
    return 'commented on #' + issueNum
  } catch (e) {
    return 'comment failed: ' + String((e as Error)?.message || e)
  }
}

async function save(req: Request, env: Env): Promise<Response> {
  try {
    // Owner only (#3261): no valid token → 401 before any GitHub call is made.
    const auth = req.headers.get('authorization') || ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!(await verifyOwnerToken(bearer, env.OWNER_TOKEN_SECRET || '', Date.now()))) {
      return json({ error: 'owner sign-in required' }, 401)
    }
    const { slug, branch, scene, png, issue } = (await req.json()) as {
      slug?: string
      branch?: string
      scene?: unknown
      png?: string
      issue?: number | string
    }
    if (!slug || !branch || !scene) return json({ error: 'slug, branch and scene are required' }, 400)
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return json({ error: 'bad slug' }, 400)
    const dir = env.DIAGRAMS_DIR || 'writeups/diagrams'
    const msg = 'chore(diagrams): edit ' + slug + ' via ticket-editor'
    const token = await installationToken(env) // one fresh ~1h token for the commits + comment
    const refused = await refuseTarget(token, env.REPO, branch, issue)
    if (refused) return refused
    await putFile(token, env, branch, dir + '/' + slug + '.excalidraw', toB64(JSON.stringify(scene, null, 2) + '\n'), msg)
    let pngCommit: { commitSha: string; parentSha?: string } | undefined
    if (png) {
      const b64 = png.includes(',') ? png.split(',')[1] : png
      pngCommit = await putFile(token, env, branch, dir + '/' + slug + '.png', b64, msg + ' (png)')
    }
    // Optional handoff comment: the commit is the source of truth, so a comment failure is non-fatal.
    // Each save posts its OWN comment, with the diagram pinned to this commit (immutable → frozen).
    const comment = await maybeComment(token, env, issue, slug, branch, new URL(req.url).origin, pngCommit?.commitSha)
    return json({ ok: true, comment })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
}

// ── Editor page (no build step; React/ReactDOM/Excalidraw as UMD CDN scripts — Excalidraw's
// official no-build recipe). Client JS uses string concatenation (no template literals) so it
// survives this server-side template literal unescaped. ──
const PAGE = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Ticket diagram editor</title>
<style>
  html,body,#root{margin:0;height:100%;width:100%;}
  #bar{position:fixed;z-index:10;top:0;left:0;right:0;height:48px;display:flex;align-items:center;gap:10px;
    padding:0 12px;background:#0a0e17;color:#e8edf6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}
  #bar b{font-size:14px;} #bar .sp{flex:1;}
  #save{background:#34d399;color:#04231a;border:0;border-radius:8px;padding:8px 16px;font-weight:700;font-size:14px;}
  #save:disabled{opacity:.5;}
  #status{font-size:12px;color:#8b97ad;}
  #stage{position:absolute;top:48px;bottom:0;left:0;right:0;}
  #hint{display:none;position:absolute;inset:0;align-items:center;justify-content:center;padding:20px;
    background:#0a0e17;color:#e8edf6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}
  #hint .card{max-width:520px;background:#121826;border:1px solid #1f2a3d;border-radius:14px;padding:24px 26px;}
  #hint h2{margin:0 0 10px;font-size:20px;} #hint p{margin:8px 0;line-height:1.5;color:#c2ccdd;}
  #hint code{background:#0a0e17;border:1px solid #1f2a3d;border-radius:6px;padding:2px 7px;font-size:13px;color:#7ee0c0;}
  #hint .muted{color:#8b97ad;font-size:13px;}
  #boot{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;gap:12px;align-items:center;
    justify-content:center;padding:24px;text-align:center;background:#0a0e17;color:#e8edf6;
    font-family:-apple-system,Segoe UI,Roboto,sans-serif;}
  #boot .big{font-size:20px;font-weight:700;}
  #boot.err .big{color:#fca5a5;}
  #boot pre{max-width:90vw;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;
    font-size:12px;color:#8b97ad;background:#121826;border:1px solid #1f2a3d;border-radius:10px;padding:12px 14px;}
</style>
</head><body>
<div id="bar"><b>✏️ Diagram editor</b><span id="status">loading…</span><span class="sp"></span>
  <button id="save" disabled>Save</button></div>
<div id="stage"><div id="root"></div></div>
<div id="hint"><div class="card">
  <h2>✏️ Ticket diagram editor</h2>
  <p>Edit an epic's Excalidraw status diagram on any device and commit it straight back to the repo — no login.</p>
  <p>Open it with a diagram <b>slug</b> and a <b>branch</b>:</p>
  <p><code>/?slug=&lt;diagram&gt;&amp;branch=&lt;branch&gt;</code></p>
  <p class="muted">e.g. <code>/?slug=make-tickets-human-readable&amp;branch=main</code> — usually you reach this from a diagram's ✏️ Edit link, not by hand.</p>
</div></div>
<div id="boot"><div class="big">Loading editor…</div></div>
<!-- Turn any uncaught error/rejection into a readable on-screen message instead of a silent white
     canvas. Also a 12s safety-net below if Excalidraw never reports a mount. -->
<script>
  window.__umdFail = [];
  function hideBoot(){ var b = document.getElementById('boot'); if (b) b.style.display = 'none'; }
  function showBootError(title, detail){
    var b = document.getElementById('boot'); if (!b) return;
    b.className = 'err'; b.style.display = 'flex'; b.innerHTML = '';
    var h = document.createElement('div'); h.className = 'big'; h.textContent = title; b.appendChild(h);
    if (detail){ var p = document.createElement('pre'); p.textContent = detail; b.appendChild(p); }
  }
  window.addEventListener('error', function(e){
    // Resource (<script>/<link>) load failures are handled by their inline onerror — ignore here.
    if (e && e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) return;
    var m = (e && e.message) || (e && e.error && e.error.stack) || String(e && e.error || e);
    if (e && e.filename) m += '\\n@ ' + e.filename + ':' + e.lineno + ':' + e.colno;
    showBootError('JavaScript error', m);
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason; showBootError('Unhandled promise rejection', (r && (r.stack || r.message)) || String(r));
  });
  // Safety net: if the editor never reports a successful mount, replace "Loading…" with a hint
  // (plus which scripts, if any, failed to load) rather than spinning forever.
  setTimeout(function(){
    if (window.__api) return; // mounted fine
    var failed = (window.__umdFail || []).length ? ' (failed: ' + window.__umdFail.join(', ') + ')' : '';
    showBootError('Editor did not load', 'Check your connection and reload.' + failed);
  }, 12000);
</script>
<!-- Excalidraw's official no-build recipe: React, ReactDOM and Excalidraw as UMD globals
     (window.React / window.ReactDOM / window.ExcalidrawLib). This replaces the esm.sh ESM +
     ?external import-map path, whose dynamic import('react-dom/client') failed to fetch on both
     desktop and mobile (#563). Plain (non-module) scripts execute in order, so the globals exist
     by the time the init script below runs — no import map, no dynamic import.
     Pinned to React 18.2.0 — the versions in Excalidraw's own no-build docs (React 19 dropped UMD
     builds). Each <script onerror> records its failure by name so the status bar can say exactly
     what didn't load instead of a generic "failed to load editor". -->
<!-- Excalidraw's browser build reads process.env.NODE_ENV; without this shim it throws during
     render (caught by Excalidraw's internal error boundary → silent blank canvas). Must be set
     BEFORE the UMD scripts run. -->
<script>window.process = { env: { NODE_ENV: 'production' } };</script>
<script>window.EXCALIDRAW_ASSET_PATH = 'https://unpkg.com/@excalidraw/excalidraw@0.17.6/dist/';</script>
<script src="https://unpkg.com/react@18.2.0/umd/react.production.min.js" onerror="window.__umdFail.push('react')"></script>
<script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js" onerror="window.__umdFail.push('react-dom')"></script>
<script src="https://unpkg.com/@excalidraw/excalidraw@0.17.6/dist/excalidraw.production.min.js" onerror="window.__umdFail.push('@excalidraw/excalidraw')"></script>
<script>
  window.__inited = true;
  var params = new URLSearchParams(location.search);
  var slug = params.get('slug') || '';
  var branch = params.get('branch') || 'main';
  var issue = params.get('issue') || '';
  // Owner token arrives in the URL fragment after the status sign-in round trip (#3261).
  var fragTok = (location.hash.match(/owner=([A-Za-z0-9_.-]+)/) || [])[1];
  if (fragTok) {
    try { sessionStorage.setItem('ownerToken', fragTok); } catch (e) {}
    history.replaceState(null, '', location.pathname + location.search);
  }
  function ownerToken(){ try { return sessionStorage.getItem('ownerToken') || ''; } catch (e) { return ''; } }
  function goSignIn(){
    location.href = 'https://status.pmcp.dev/api/editor/token?return=' + encodeURIComponent(location.origin + location.pathname + location.search);
  }
  var RAW = 'https://raw.githubusercontent.com/__REPO__/' + branch + '/writeups/diagrams/' + slug + '.excalidraw';
  var statusEl = document.getElementById('status');
  var saveEl = document.getElementById('save');
  var hintEl = document.getElementById('hint');
  function setStatus(t){ statusEl.textContent = t; }

  var React = window.React, ReactDOM = window.ReactDOM, Exc = window.ExcalidrawLib;
  var missing = (window.__umdFail || []).slice();
  if (!React && missing.indexOf('react') < 0) missing.push('react');
  if ((!ReactDOM || !ReactDOM.createRoot) && missing.indexOf('react-dom') < 0) missing.push('react-dom');
  if ((!Exc || !Exc.Excalidraw) && missing.indexOf('@excalidraw/excalidraw') < 0) missing.push('@excalidraw/excalidraw');

  if (missing.length) {
    setStatus('editor failed to load');
    showBootError('Editor failed to load (CDN)', 'These scripts did not load:\\n  ' + missing.join('\\n  '));
  } else if (!slug) {
    // Bare "/" — nothing to edit. Explain the tool instead of a confusing blank canvas.
    setStatus('no diagram selected');
    hideBoot();
    hintEl.style.display = 'flex';
  } else {
    var createRoot = ReactDOM.createRoot;
    var api = null;

    var loadScene = function(){
      return fetch(RAW).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
    };

    loadScene().then(function(scene){
      var initialData = scene ? { elements: scene.elements || [], appState: { viewBackgroundColor: '#ffffff' }, files: scene.files || {} } : null;
      function App(){
        // Excalidraw fills its parent — give it a concretely-sized box (a common blank-canvas cause).
        return React.createElement('div', { style: { position: 'absolute', inset: 0 } },
          React.createElement(Exc.Excalidraw, {
            initialData: initialData,
            // Fires only on a successful mount — our signal that the editor is truly live.
            excalidrawAPI: function(a){
              api = a;
              window.__api = a;
              hideBoot();
              setStatus(scene ? 'editing ' + slug : slug + ' (new)');
              saveEl.disabled = false;
            }
          })
        );
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
      setStatus('rendering ' + slug + '…');

      saveEl.onclick = function(){
        if (!api) return;
        saveEl.disabled = true; setStatus('saving…');
        var elements = api.getSceneElements();
        var appState = api.getAppState();
        var files = api.getFiles();
        Exc.exportToBlob({ elements: elements, appState: appState, files: files, mimeType: 'image/png', exportEmbedScene: true, exportPadding: 16 })
          .then(function(blob){ return blob.arrayBuffer(); })
          .then(function(buf){
            var bytes = new Uint8Array(buf); var bin = '';
            for (var i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
            var pngB64 = btoa(bin);
            var scene = { type:'excalidraw', version:2, source:location.origin, elements: elements, appState:{ viewBackgroundColor:'#ffffff' }, files: files };
            return fetch('/api/save', { method:'POST', headers:{'content-type':'application/json','authorization':'Bearer ' + ownerToken()}, body: JSON.stringify({ slug: slug, branch: branch, scene: scene, png: pngB64, issue: issue }) });
          })
          .then(function(r){
            if (r.status === 401) {
              try { sessionStorage.removeItem('ownerToken'); } catch (e) {}
              setStatus('owner sign-in required — redirecting…');
              goSignIn();
              return { error: 'owner sign-in required' };
            }
            return r.json();
          })
          .then(function(res){ setStatus(res.ok ? ('saved ✓ committed to ' + branch + (res.comment ? ' · ' + res.comment : '')) : 'error: ' + (res.error||'?')); saveEl.disabled = false; })
          .catch(function(e){ setStatus('error: ' + e); saveEl.disabled = false; });
      };
    });
  }
</script>
</body></html>`
