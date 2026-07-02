// spec-walklist.mjs — render a POC spec.json into an interactive, guided A1/C1 walk (self-contained HTML).
// One card at a time · prev/next + keyboard · progress · localStorage persistence · export verdicts as JSON.
import { readFileSync, writeFileSync } from 'node:fs'
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const out = process.argv[3]
const title = process.argv[4] || 'Spec walk'
const walk = spec.filter(e => e.status === 'proposed')   // the entries that need the walk
const ref = spec.filter(e => e.status !== 'proposed')    // stopgap/new — reference + read-only in export
const DATA = JSON.stringify({ title, walk, ref })

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
 :root{--bg:#0d1117;--card:#161b22;--bd:#30363d;--tx:#e6edf3;--mut:#8b949e;--ac:#388bfd;--ok:#3fb950;--bad:#d29922;--add:#a371f7}
 *{box-sizing:border-box}html,body{margin:0;height:100%}body{background:var(--bg);color:var(--tx);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
 .wrap{max-width:760px;margin:0 auto;padding:22px 18px 40px;min-height:100%;display:flex;flex-direction:column}
 h1{font-size:19px;margin:0 0 2px}.sub{color:var(--mut);font-size:13px;margin:0 0 14px}
 .bar{height:8px;background:var(--card);border:1px solid var(--bd);border-radius:20px;overflow:hidden;margin-bottom:6px}
 .bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--ac),var(--add));width:0;transition:width .25s}
 .meta{display:flex;justify-content:space-between;font-size:12px;color:var(--mut);margin-bottom:16px}
 .card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:18px 18px 16px;flex:1}
 .top{display:flex;align-items:center;gap:10px;margin-bottom:10px}
 .num{background:var(--ac);color:#fff;font-weight:700;font-size:13px;min-width:24px;height:24px;border-radius:50%;display:grid;place-items:center;padding:0 6px}
 code.id{color:var(--ac);font-size:13px}.hook{margin-left:auto;font-size:12px;color:var(--add);background:#1c1530;padding:2px 9px;border-radius:20px}
 .behaviour{font-size:16px;margin:0 0 12px}
 .we{background:#0d1117;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:14px}
 .we .lbl{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.05em}.we .arrow{color:var(--ac);margin:0 7px}
 ol{margin:0 0 14px;padding-left:22px}ol li{margin:4px 0;color:#c9d1d9}
 .cr{font-size:12px;color:var(--mut);margin:0 0 14px;display:flex;flex-direction:column;gap:2px}
 .verdict{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
 .verdict button{flex:1;min-width:150px;padding:9px;border-radius:8px;border:1px solid var(--bd);background:#0d1117;color:var(--tx);cursor:pointer;font-size:14px;transition:.12s}
 .verdict button:hover{border-color:var(--mut)}
 .verdict button.sel[data-v="confirmed"]{background:rgba(63,185,80,.18);border-color:var(--ok);color:var(--ok)}
 .verdict button.sel[data-v="contradicted"]{background:rgba(210,153,34,.18);border-color:var(--bad);color:var(--bad)}
 .verdict button.sel[data-v="undocumented"]{background:rgba(163,113,247,.18);border-color:var(--add);color:var(--add)}
 textarea.note{width:100%;background:#0d1117;border:1px solid var(--bd);border-radius:8px;color:var(--tx);padding:8px 10px;font:13px/1.4 inherit;resize:vertical;min-height:52px}
 .nav{display:flex;gap:10px;align-items:center;margin-top:16px}
 .nav button{padding:10px 18px;border-radius:8px;border:1px solid var(--bd);background:var(--card);color:var(--tx);cursor:pointer;font-size:14px}
 .nav button:disabled{opacity:.4;cursor:not-allowed}.nav .grow{flex:1}
 .nav .primary{background:var(--ac);border-color:var(--ac);color:#fff;font-weight:600}
 .kbd{font-size:11px;color:var(--mut);text-align:center;margin-top:10px}
 .kbd b{background:var(--card);border:1px solid var(--bd);border-radius:4px;padding:1px 5px;color:var(--tx)}
 /* summary */
 #summary{display:none}.done .card,.done .nav,.done .kbd{display:none}.done #summary{display:block}
 table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin:10px 0}
 td{padding:7px 11px;border-top:1px solid var(--bd);font-size:13px;vertical-align:top}td:first-child{white-space:nowrap}td code{color:var(--ac)}tr:first-child td{border-top:none}
 .pill{font-size:11px;padding:1px 8px;border-radius:20px}.pill.confirmed{background:rgba(63,185,80,.18);color:var(--ok)}.pill.contradicted{background:rgba(210,153,34,.18);color:var(--bad)}.pill.undocumented{background:rgba(163,113,247,.18);color:var(--add)}.pill.skipped{background:#21262d;color:var(--mut)}
 .exp{width:100%;min-height:180px;background:#0d1117;border:1px solid var(--bd);border-radius:8px;color:var(--tx);font:12px/1.45 ui-monospace,monospace;padding:10px;margin-top:8px}
 .row{display:flex;gap:10px;margin:12px 0}.row button{padding:9px 16px;border-radius:8px;border:1px solid var(--bd);background:var(--ac);border-color:var(--ac);color:#fff;cursor:pointer}
 .row button.ghost{background:var(--card);border-color:var(--bd);color:var(--tx)}
 h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:22px 0 8px}
</style></head><body><div class="wrap" id="app">
 <h1>${title}</h1>
 <p class="sub">Guided walk — one entry at a time, against the running POC. Progress saves in this browser.</p>
 <div class="bar"><i id="prog"></i></div>
 <div class="meta"><span id="counter"></span><span id="tally"></span></div>
 <div class="card" id="card"></div>
 <div class="nav">
  <button id="prev">← Prev</button><span class="grow"></span>
  <button id="next" class="primary">Next →</button>
 </div>
 <p class="kbd"><b>←</b>/<b>→</b> move · <b>1</b> confirm · <b>2</b> contradict · <b>3</b> undocumented</p>
 <div id="summary"></div>
</div>
<script>
const {title, walk, ref} = ${DATA};
const KEY = 'specwalk:' + title;
let state = JSON.parse(localStorage.getItem(KEY) || '{}'); // { [id]: {verdict, note} }
let i = 0;
const $ = s => document.querySelector(s);
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
function stepsOf(e){ return (e.howToTest||'').split(/\\s(?=\\d\\.\\s)/).map(s => s.replace(/^\\d\\.\\s*/,'')); }
function render(){
  const e = walk[i]; const st = state[e.id] || {};
  $('#prog').style.width = ((i)/walk.length*100)+'%';
  $('#counter').textContent = 'Entry '+(i+1)+' of '+walk.length;
  const done = walk.filter(w=>state[w.id]&&state[w.id].verdict).length;
  $('#tally').textContent = done+' / '+walk.length+' marked';
  $('#card').innerHTML =
    '<div class="top"><span class="num">'+(i+1)+'</span><code class="id">'+e.id+'</code>'+
      (e.hook?'<span class="hook">🔖 '+e.hook+'</span>':'')+'</div>'+
    '<p class="behaviour">'+e.behaviour+'</p>'+
    '<div class="we"><span class="lbl">When</span> '+e.when+' <span class="arrow">→</span> <span class="lbl">Expect</span> '+e.expect+'</div>'+
    '<ol>'+stepsOf(e).map(s=>'<li>'+s+'</li>').join('')+'</ol>'+
    (e.consideredRejected&&e.consideredRejected.length?'<div class="cr">'+e.consideredRejected.map(c=>'<span>❌ '+c+'</span>').join('')+'</div>':'')+
    '<div class="verdict">'+
      ['confirmed:✅ Confirmed','contradicted:⚠️ Contradicted','undocumented:➕ Undocumented'].map(o=>{
        const [v,l]=o.split(':'); return '<button data-v="'+v+'" class="'+(st.verdict===v?'sel':'')+'">'+l+'</button>';}).join('')+
    '</div>'+
    '<textarea class="note" placeholder="note / delta — what the POC actually does…">'+(st.note||'')+'</textarea>';
  $('#card').querySelectorAll('.verdict button').forEach(b=>b.onclick=()=>{ mark(b.dataset.v); });
  $('#card').querySelector('.note').oninput = ev => { state[e.id]=state[e.id]||{}; state[e.id].note=ev.target.value; save(); };
  $('#prev').disabled = i===0;
  $('#next').textContent = i===walk.length-1 ? 'Finish →' : 'Next →';
}
function mark(v){ const e=walk[i]; state[e.id]=state[e.id]||{}; state[e.id].verdict=v; save(); render();
  setTimeout(()=>{ if(i<walk.length-1){i++;render();} else finish(); }, 180); }
function finish(){
  const rows = walk.map((e,n)=>{ const st=state[e.id]||{}; const v=st.verdict||'skipped';
    return '<tr><td>'+(n+1)+' <code>'+e.id+'</code></td><td><span class="pill '+v+'">'+v+'</span>'+
      (st.note?' <span style="color:var(--mut)">— '+st.note.replace(/</g,'&lt;')+'</span>':'')+'</td></tr>'; }).join('');
  const exportObj = {
    spec: title, walkedAt: new Date().toISOString(),
    verdicts: walk.map(e=>({ id:e.id, status:e.status, verdict:(state[e.id]||{}).verdict||'skipped', note:(state[e.id]||{}).note||'' })),
    readonly: ref.map(e=>({ id:e.id, status:e.status }))
  };
  const done = walk.filter(w=>state[w.id]&&state[w.id].verdict).length;
  $('#summary').innerHTML =
    '<h1>Walk summary</h1><p class="sub">'+done+' of '+walk.length+' marked · '+
      ['confirmed','contradicted','undocumented','skipped'].map(v=>walk.filter(w=>((state[w.id]||{}).verdict||'skipped')===v).length+' '+v).join(' · ')+'</p>'+
    '<table>'+rows+'</table>'+
    '<h2>Export — paste this back to the agent</h2>'+
    '<textarea class="exp" readonly>'+JSON.stringify(exportObj,null,2)+'</textarea>'+
    '<div class="row"><button id="copy">Copy JSON</button><button id="dl" class="ghost">Download .json</button><button id="back" class="ghost">← Back to walk</button></div>';
  document.body.querySelector('#app').classList.add('done');
  $('#copy').onclick=()=>{ navigator.clipboard.writeText(JSON.stringify(exportObj,null,2)); $('#copy').textContent='Copied ✓'; };
  $('#dl').onclick=()=>{ const b=new Blob([JSON.stringify(exportObj,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=title.replace(/\\W+/g,'-').toLowerCase()+'-verdicts.json'; a.click(); };
  $('#back').onclick=()=>{ document.body.querySelector('#app').classList.remove('done'); i=walk.length-1; render(); };
}
$('#prev').onclick=()=>{ if(i>0){i--;render();} };
$('#next').onclick=()=>{ if(i<walk.length-1){i++;render();} else finish(); };
document.addEventListener('keydown',ev=>{
  if(document.body.querySelector('#app').classList.contains('done')) return;
  if(ev.key==='ArrowRight'){ $('#next').click(); } else if(ev.key==='ArrowLeft'){ $('#prev').click(); }
  else if(ev.key==='1'){ mark('confirmed'); } else if(ev.key==='2'){ mark('contradicted'); } else if(ev.key==='3'){ mark('undocumented'); }
});
render();
</script></body></html>`
writeFileSync(out, html)
console.log('wrote', out, '·', walk.length, 'guided steps ·', ref.length, 'reference entries')
