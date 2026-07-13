/**
 * Patch public/insp360/viewer.html after importing QR-360 insp_360_viewer-v1.1.1.html:
 * - version badge (v1.1.1) top-right
 * - embed mode for Building Map Explorer gateways
 * - accept live address DB from parent via postMessage
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viewerPath = path.join(root, 'public', 'insp360', 'viewer.html')
const sourcePath =
  process.argv[2] ||
  String.raw`C:\Users\Robert\Projects\QR-360°-Inspections\QR-360°-Inspections\insp_360_viewer-v1.1.1.html`

const VERSION = 'v1.1.1'
const MARKER = '/* __BME_INSP360_INTEGRATION__ */'

if (fs.existsSync(sourcePath)) {
  fs.copyFileSync(sourcePath, viewerPath)
  console.log('Copied source →', viewerPath)
} else {
  console.warn('Source missing, patching existing viewer:', sourcePath)
}

let html = fs.readFileSync(viewerPath, 'utf8')
if (html.includes(MARKER)) {
  console.log('Already patched; rewriting from source if available.')
  if (fs.existsSync(sourcePath)) {
    html = fs.readFileSync(sourcePath, 'utf8')
  } else {
    throw new Error('Viewer already patched and source missing — aborting')
  }
}

// --- meta version ---
if (!html.includes('name="insp360-version"')) {
  html = html.replace(
    '<title>INSP 360 Viewer</title>',
    `<title>INSP 360 Viewer ${VERSION}</title>\n<meta name="insp360-version" content="${VERSION}">`,
  )
}

// --- CSS: version badge + embed ---
const cssBlock = `
  /* __BME_INSP360_INTEGRATION__ version + embed */
  #verBadge{
    position:fixed; top:10px; right:12px; z-index:60;
    font-family:var(--font); font-size:11px; letter-spacing:.4px;
    color:var(--muted); background:rgba(17,21,27,.72);
    border:1px solid var(--border); border-radius:999px;
    padding:4px 10px; pointer-events:none; backdrop-filter:blur(6px);
  }
  body.embed #verBadge{ top:10px; right:12px; }
  body.embed #empty #createProj,
  body.embed #empty #loadDbBtn,
  body.embed #empty #loadDbRing{display:none !important}
  body.embed #empty .hint{display:none !important}
  body.embed #dash{display:none !important}
  body.embed #empty.has-dash{padding-left:24px}
  body.embed #projEmpty{display:none !important}
  #openLinkedProj{display:none !important}
  body.embed #empty.show-linked #openLinkedProj{display:inline-flex !important}
`
if (!html.includes('#verBadge{')) {
  html = html.replace('</style>', `${cssBlock}\n</style>`)
}

// --- version badge element ---
if (!html.includes('id="verBadge"')) {
  html = html.replace(
    '<div id="stage"></div>',
    `<div id="stage"></div>\n<div id="verBadge" aria-label="Viewer version">${VERSION}</div>`,
  )
}

// --- open linked project button ---
if (!html.includes('id="openLinkedProj"')) {
  html = html.replace(
    `<button class="btn" id="openProject2"><svg viewBox="0 0 24 24"><path d="M21 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2z"/><path d="M3 11h18"/></svg>Open project</button>`,
    `<button class="btn" id="openLinkedProj" type="button"><svg viewBox="0 0 24 24"><path d="M21 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2z"/><path d="M3 11h18"/></svg>Open linked project</button>
    <button class="btn" id="openProject2"><svg viewBox="0 0 24 24"><path d="M21 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2z"/><path d="M3 11h18"/></svg>Open project</button>`,
  )
}

// --- remember gate handle inside openProject ---
const openProjectNeedle =
  'if(handle){ projHandleRemembered=handle; idbSet(\'projHandle\',handle); }'
const openProjectPatch =
  `if(handle){ projHandleRemembered=handle; idbSet('projHandle',handle); try{ if(window.embedGateKey) idbSet('gateProj:'+window.embedGateKey, handle); }catch(e){} }`
if (html.includes(openProjectNeedle) && !html.includes("gateProj:'+window.embedGateKey")) {
  html = html.replace(openProjectNeedle, openProjectPatch)
}

// --- skip restoring stale IDB geoIndex when parent will supply live DB in embed ---
const idbGeoNeedle = `idbGet('geoIndex').then(saved=>{
  if(saved && Array.isArray(saved.buildings) && Array.isArray(saved.polys)){
    geoIndex=saved;`
const idbGeoPatch = `idbGet('geoIndex').then(saved=>{
  try{ if(new URLSearchParams(location.search).get('embed')==='1') return; }catch(e){}
  if(saved && Array.isArray(saved.buildings) && Array.isArray(saved.polys)){
    geoIndex=saved;`
if (html.includes(idbGeoNeedle) && !html.includes("get('embed')==='1') return")) {
  html = html.replace(idbGeoNeedle, idbGeoPatch)
}

// --- integration bootstrap before </script></body> ---
const bootstrap = `
<script>
/* __BME_INSP360_INTEGRATION__ */
(function(){
  const VERSION=${JSON.stringify(VERSION)};
  const params=new URLSearchParams(location.search);
  const isEmbed=params.get('embed')==='1';
  const gateKey=(params.get('gate')||'').trim();
  const projectUrl=(params.get('project')||'').trim();
  const photoName=(params.get('photo')||'').trim();
  const pageTitle=(params.get('title')||'').trim();
  window.embedGateKey = gateKey || null;
  window.__bmeHostGeoReady = false;

  if(isEmbed) document.body.classList.add('embed');
  if(pageTitle){ try{ document.title = pageTitle + ' · INSP 360 ' + VERSION; }catch(e){} }

  function applyHostGeo(geo){
    if(!geo || !Array.isArray(geo.buildings) || !Array.isArray(geo.polys)) return false;
    try{
      window._embeddedGeo = geo;
      geoIndex = geo;
      window.__bmeHostGeoReady = true;
      try{ mergeBuildingRtus(geoIndex); }catch(e){}
      const btn=document.getElementById('planGeo');
      if(btn){
        btn.classList.add('on');
        btn.title='Address DB from Building Map Explorer ('+geo.buildings.length+' buildings, '+geo.polys.length+' tenant polygons'+(Array.isArray(geo.rooms)?', '+geo.rooms.length+' utility rooms':'')+').';
      }
      try{ updateDbStatus(); }catch(e){}
      try{ refreshGeoReadout(); }catch(e){}
      return true;
    }catch(e){ console.warn('host geo apply failed', e); return false; }
  }

  window.addEventListener('message', function(ev){
    const data=ev && ev.data;
    if(!data || data.type!=='insp360:setGeoIndex') return;
    const wasReady=!!window.__bmeHostGeoReady;
    if(applyHostGeo(data.geoIndex) && !wasReady){
      try{ toast('Address DB loaded from Building Map Explorer.'); }catch(e){}
    }
  });

  function requestHostGeo(){
    try{ if(window.parent && window.parent!==window) window.parent.postMessage({type:'insp360:requestGeoIndex'}, '*'); }catch(e){}
  }

  function showLinkedButton(handle){
    const btn=document.getElementById('openLinkedProj');
    const empty=document.getElementById('empty');
    if(!btn||!empty||!handle) return;
    const label=(handle.name||'linked project').replace(/\\.(insp360|zip)$/i,'');
    btn.title='Reopen '+(handle.name||'linked project');
    btn.replaceChildren();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    const p1=document.createElementNS('http://www.w3.org/2000/svg','path');
    p1.setAttribute('d','M21 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2z');
    const p2=document.createElementNS('http://www.w3.org/2000/svg','path');
    p2.setAttribute('d','M3 11h18');
    svg.appendChild(p1); svg.appendChild(p2);
    btn.appendChild(svg);
    btn.appendChild(document.createTextNode('Open '+label));
    empty.classList.add('show-linked');
    btn.onclick=async function(){
      try{
        const o={mode:'readwrite'};
        if(handle.queryPermission){
          let perm=await handle.queryPermission(o);
          if(perm!=='granted' && handle.requestPermission) perm=await handle.requestPermission(o);
          if(perm!=='granted'){ toast('Could not reopen the linked project — permission was denied.', true); return; }
        }
        openProject(await handle.getFile(), handle);
      }catch(e){ toast('Could not reopen the linked project.', true); }
    };
  }

  async function tryOpenGateRemembered(){
    if(!gateKey) return;
    try{
      const h=await idbGet('gateProj:'+gateKey);
      if(h) showLinkedButton(h);
    }catch(e){}
  }

  async function tryOpenProjectUrl(){
    if(!projectUrl) return false;
    try{
      const res=await fetch(projectUrl);
      if(!res.ok) throw new Error('HTTP '+res.status);
      const blob=await res.blob();
      const name=decodeURIComponent((projectUrl.split('/').pop()||'project.insp360').split('?')[0]);
      const file=new File([blob], name, {type:'application/zip'});
      await openProject(file, null);
      if(photoName){
        const idx=items.findIndex(it=>String(it.name||'').toLowerCase()===photoName.toLowerCase());
        if(idx>=0) selectImage(idx);
      }
      return true;
    }catch(e){
      console.warn('embed project URL failed', e);
      try{ toast('Could not open the linked tour URL.', true); }catch(_){}
      return false;
    }
  }

  async function bootEmbed(){
    if(isEmbed){
      requestHostGeo();
      setTimeout(requestHostGeo, 400);
      setTimeout(requestHostGeo, 1200);
      await tryOpenGateRemembered();
      await tryOpenProjectUrl();
      // Prefer host DB over built-in JSON once it arrives
      const empty=document.getElementById('empty');
      if(empty && !projectUrl){
        const h1=empty.querySelector('h1');
        const p=empty.querySelector('p');
        if(h1) h1.textContent='Open this gate\\u2019s 360\\u00b0 project';
        if(p) p.textContent='Choose the .insp360 file for this sphere. It will reopen automatically next time you open this gate.';
      }
    } else {
      // standalone: still show version badge (already in DOM)
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(bootEmbed, 0); });
  else setTimeout(bootEmbed, 0);
})();
</script>
`
if (!html.includes(MARKER + ' */\n(function()')) {
  html = html.replace('</script>\n</body>\n</html>', `</script>\n${bootstrap}\n</body>\n</html>`)
}

fs.writeFileSync(viewerPath, html, 'utf8')
console.log('Patched', viewerPath, 'bytes=', fs.statSync(viewerPath).size)
console.log('Has verBadge', html.includes('id="verBadge"'))
console.log('Has embed CSS', html.includes('body.embed #empty #createProj'))
console.log('Has host geo listener', html.includes('insp360:setGeoIndex'))
console.log('Has gateProj', html.includes('gateProj:'))
