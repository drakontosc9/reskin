/* Reskin site builder
   - "Component" tab: preview one component on its own, see variations, add it to your site.
   - "Build" tab: your site as a list of blocks you can move, hide, replace or add to,
     with a step-by-step "wire up your component" panel and show rules (device / scroll / time / dates).
   Needs engine.js + app.js. Saves in this browser; cloud.js syncs to Supabase when configured. */

/* ------------------------------------------------------------------ project */
const B = {
  project: null,          // { id, name, styleId, style, blocks, hideNav, hideFooter, srcText, srcName, updated }
  sel: null,              // selected block id
  device: 'desktop',
  rulesPreview: false,    // apply show rules in the builder preview?
  wizard: null,           // { step, editing, compId, place, after, replaces, fill, content, recolor, rules }
  compSel: null,          // Component tab: selected component id
  compDevice: 'desktop',
};
const DEFAULT_RULES = () => ({ device: 'all', start: 'now', scroll: 40, delay: 3, from: '', to: '' });

function siteBlocks(m) {
  return [{ id: 'b-hero', kind: 'site', ref: 'hero', label: 'Top of page (hero)', rules: DEFAULT_RULES() },
    ...m.sections.map((s, i) => ({ id: 'b-s' + i, kind: 'site', ref: 'section:' + i, label: s.title || (s.quotes[0] ? 'Quote' : (s.intro[0] || 'Section ' + (i + 1)).slice(0, 40)), rules: DEFAULT_RULES() }))];
}
function newProject() {
  return {
    id: 'p' + Date.now().toString(36), name: (state.model && state.model.brand) || 'My site',
    style: pickBaseStyle(), blocks: siteBlocks(state.model), hideNav: false, hideFooter: false,
    srcText: $('src').value, srcName: state.srcName || '', updated: Date.now(),
  };
}
function pickBaseStyle() {
  const ok = s => s && !s.live;
  return [state.current, ...state.styles, ...state.saved].find(ok) || makeStyle('minimal');
}
function saveProject() {
  if (!B.project) return;
  B.project.updated = Date.now();
  const all = store.get('reskin.projects', []).filter(p => p.id !== B.project.id);
  all.unshift(B.project);
  if (!store.set('reskin.projects', all.slice(0, 20))) toast('Browser storage is full — download your site to keep it');
  store.set('reskin.currentProject', B.project.id);
  if (window.Cloud) Cloud.saveProject(B.project);
}
// the open project must match the site that's pasted in; otherwise start one for it
function ensureProject() {
  const src = $('src').value;
  if (B.project && B.project.srcText === src) return;
  const id = store.get('reskin.currentProject', null);
  const saved = store.get('reskin.projects', []).find(p => p.id === id && p.srcText === src);
  B.project = saved || newProject();
  if (!B.project.blocks.length) B.project.blocks = siteBlocks(state.model);
  B.sel = null; B.wizard = null;
}
async function openProject(p) {
  $('src').value = p.srcText; state.srcName = p.srcName || ''; state.srcAssets = new Map(); state.srcKey = null;
  busy('Opening project…');
  try { await loadSource(); } finally { busy(null); }
  B.project = p; B.sel = null; B.wizard = null;
  store.set('reskin.currentProject', p.id);
  renderBuild();
}

/* ------------------------------------------------------------------ content for a component */
const compById = id => comps.list.find(c => c.id === id);
// the words a section (or the hero) would put into a component
function contentFromRef(ref) {
  const m = viewModel();
  if (ref === 'hero') {
    const h = m.hero;
    return { title: h.title, text: h.paras.join(' '), button: (h.buttons[0] || {}).text || '', link: (h.buttons[0] || {}).href || '#', cards: [] };
  }
  const s = m.sections[+String(ref).split(':')[1]];
  if (!s) return { title: '', text: '', button: '', link: '#', cards: [] };
  const cards = s.cards.length ? s.cards.map(c => ({ title: c.title, text: c.text.join(' '), img: c.img }))
    : s.lists.map(l => ({ title: l.title || l.text, text: l.title ? l.text : '' }));
  const quote = s.quotes[0] ? `“${s.quotes[0].text}”${s.quotes[0].cite ? ' — ' + s.quotes[0].cite : ''}` : '';
  return { title: s.title, text: [s.intro.join(' '), quote].filter(Boolean).join(' '), button: (s.buttons[0] || {}).text || '', link: (s.buttons[0] || {}).href || '#', cards };
}
// turn {title, text, button, cards} into the content model the live-remix engine understands
function miniModel(c) {
  const m = viewModel();
  return {
    title: '', brand: m.brand, logo: null, hideName: false, nav: [], navCta: null, footer: '', footerLinks: [],
    hero: { eyebrow: '', title: c.title || '', paras: c.text ? [c.text] : [], buttons: c.button ? [{ text: c.button, href: c.link || '#' }] : [], img: null },
    sections: (c.cards || []).map(k => ({ title: k.title, intro: k.text ? [k.text] : [], cards: [], lists: [], imgs: k.img ? [{ ...k.img, src: resolveSrc(k.img.src) }] : [], quotes: [], buttons: [], forms: [] })),
  };
}
const injectEnd = (html, tag) => { const i = html.toLowerCase().lastIndexOf('</body>'); return i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html + tag; };
// tells the page how tall the component's content is (not the frame: scrollHeight never drops below the frame's own height)
const heightReporter = id => `<script>(function(){var id=${jsonForScript(id)},last=0;function send(){var b=document.body;if(!b)return;var cs=getComputedStyle(b),h=Math.ceil(b.getBoundingClientRect().height+parseFloat(cs.marginTop)+parseFloat(cs.marginBottom));if(h<20)h=document.documentElement.scrollHeight;if(Math.abs(h-last)>2){last=h;parent.postMessage({rkH:h,id:id},'*');}}addEventListener('load',send);setInterval(send,700);})();<\/script>`;

// one component, filled and coloured for a spot on the site
function compBlockDoc(comp, opts) {
  let html = compDoc(comp, opts.props);
  if (opts.fill !== 'own' && opts.content) {
    const from = comp.tokens && (comp.tokens.accent || comp.tokens.btnBg);
    const to = opts.recolor ? brandColor() : null;
    const data = { content: miniModel(opts.content), opts: { thumb: !!opts.thumb, recolor: from && to ? { from, to, mono: !comp.tokens.accent } : null } };
    html = injectEnd(html, `<script>(${__transplant})(${jsonForScript(data)});<\/script>`);
  } else if (opts.recolor && brandColor() && comp.tokens && (comp.tokens.accent || comp.tokens.btnBg)) {
    // keep its own words but still match the brand colours: run the remix with no content changes
    const data = { content: null, opts: { thumb: !!opts.thumb, recolor: { from: comp.tokens.accent || comp.tokens.btnBg, to: brandColor(), mono: !comp.tokens.accent } } };
    html = injectEnd(html, `<script>(${__transplant})(${jsonForScript(data)});<\/script>`);
  }
  if (opts.reportHeight) {
    // inside a page, a component should be as tall as its content (uiverse pieces are centred in a full-screen page)
    if (comp.kind === 'html') html = injectEnd(html, '<style>html,body{min-height:0!important;height:auto!important}body{padding:48px 16px!important}</style>');
    html = injectEnd(html, heightReporter(opts.reportHeight));
  }
  return html;
}
async function ensureCompTokens(c) {
  if (c.tokens && 'btn' in c.tokens) return c.tokens;   // older saves lack the full button style — read those again
  try {
    const res = await runSandbox(id => c.kind === 'tsx' ? tsxDoc(c.code, id) : withProbe(c.code, id), 20000);
    const t = res.tokens;
    c.tokens = { accent: t.accent, btnBg: t.btn && t.btn.bg, bg: t.bg, text: t.text, btn: t.btn || null };
  } catch { c.tokens = { accent: null, btnBg: null, btn: null }; }
  comps.save();
  return c.tokens;
}

/* ------------------------------------------------------------------ the composed page */
const RULE_ATTRS = r => {
  if (!r) return '';
  let a = '';
  if (r.device && r.device !== 'all') a += ` data-device="${r.device}"`;
  if (r.start === 'scroll') a += ` data-start="scroll" data-scroll="${+r.scroll || 0}"`;
  if (r.start === 'delay') a += ` data-start="delay" data-delay="${+r.delay || 0}"`;
  if (r.from) a += ` data-from="${esc(r.from)}"`;
  if (r.to) a += ` data-to="${esc(r.to)}"`;
  return a;
};
// studio: the Studio runtime's mode (studio.js) — 'edit' | 'try'; otherwise picked from edit / preview
function composeDoc({ edit = false, rules = true, preview = false, studio = null } = {}) {
  const p = B.project, m = viewModel();
  const mode = studio || (edit ? 'show' : preview ? 'try' : 'live');
  const style = p.btnCss ? { ...p.style, extraCss: (p.style.extraCss || '') + '\n' + p.btnCss } : p.style;
  const blocks = p.blocks.filter(b => !b.hidden).map(b => {
    const attrs = RULE_ATTRS(b.rules);
    if (b.kind === 'site') return { id: b.id, ref: b.ref, attrs };
    const c = compById(b.compId);
    if (!c) return { id: b.id, html: '', attrs };
    let doc = compBlockDoc(c, { fill: b.fill, content: b.content, recolor: b.recolor, reportHeight: b.id, props: b.props });
    // Studio's "Edit in detail" reaches inside added components too: pick parts, apply text / style / hide edits
    if (typeof __rkElem === 'function') doc = injectEnd(doc, `<script>(${__rkElem})(${jsonForScript({ id: b.id, mode: 'fit', act: false, links: [], inner: b.inner || [] })});<\/script>`);
    return { id: b.id, attrs, html: `<iframe class="rk-comp" data-rk="${esc(b.id)}" title="${esc(c.name)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" loading="lazy" srcdoc="${esc(doc)}" style="display:block;width:100%;height:420px;border:0;background:transparent"></iframe>` };
  });
  return renderSite(m, style, {
    preview, base: state.base, blocks, hideNav: p.hideNav, hideFooter: p.hideFooter,
    extraBody: `<script>(${__rkRuntime})(${edit}, ${rules});<\/script>` + (typeof studioScript === 'function' ? studioScript(p, mode) : ''),
  });
}
// runs inside the composed page: sizes component frames, applies show rules, lets the builder select blocks
function __rkRuntime(EDIT, RULES) {
  addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.rkH && d.id) {
      var f = document.querySelector('iframe[data-rk="' + d.id + '"]');
      // full-screen components (100vh) grow with their frame: after a few growths in a row, stop following them
      if (f) { var h = Math.min(Math.max(d.rkH, 40), 1600), cur = parseFloat(f.style.height) || 0; f._g = h > cur ? (f._g || 0) + 1 : 0; if (f._g <= 4) f.style.height = h + 'px'; }
    }
    if (EDIT && d.rkSel !== undefined) blocks.forEach(function (b) { var on = b.getAttribute('data-block') === d.rkSel; b.classList.toggle('rk-sel', on); if (on && d.scroll) (function (r) { scrollTo({ top: Math.max(0, r.top + scrollY - (innerHeight - r.height) / 2), behavior: 'smooth' }); })(b.getBoundingClientRect()); });
  });
  var t0 = Date.now(), blocks = Array.prototype.slice.call(document.querySelectorAll('.rk-block'));
  var st = document.createElement('style');
  st.textContent = '.rk-wait{display:none!important}.rk-pop{animation:rkIn .6s ease both}@keyframes rkIn{from{opacity:0;transform:translateY(18px)}}' +
    (EDIT ? '.rk-block{position:relative;cursor:pointer}.rk-block::after{content:"";position:absolute;inset:0;z-index:50;pointer-events:auto}.rk-block:hover::after{outline:2px dashed rgba(255,91,55,.7);outline-offset:-2px}.rk-block.rk-sel::after{outline:3px solid #ff5b37;outline-offset:-3px}' : '');
  document.head.appendChild(st);
  function visible(b) {
    var d = b.dataset, now = new Date();
    if (d.device === 'desktop' && innerWidth < 768) return false;
    if (d.device === 'mobile' && innerWidth >= 768) return false;
    if (d.from && now < new Date(d.from + 'T00:00:00')) return false;
    if (d.to && now > new Date(d.to + 'T23:59:59')) return false;
    if (b._seen) return true;
    if (d.start === 'delay' && (Date.now() - t0) / 1000 < +(d.delay || 0)) return false;
    if (d.start === 'scroll') { var max = document.documentElement.scrollHeight - innerHeight; if (max > 0 && scrollY / max * 100 < +(d.scroll || 0)) return false; }
    return true;
  }
  function check() {
    blocks.forEach(function (b) {
      var v = visible(b);
      if (v && !b._seen && (b.dataset.start === 'delay' || b.dataset.start === 'scroll')) { b._seen = true; b.classList.add('rk-pop'); }
      b.classList.toggle('rk-wait', !v);
    });
  }
  if (RULES) { check(); addEventListener('scroll', check, { passive: true }); addEventListener('resize', check); setInterval(check, 400); }
  if (EDIT) document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.rk-block');
    if (b) { e.preventDefault(); e.stopPropagation(); parent.postMessage({ rkSelect: b.getAttribute('data-block') }, '*'); }
  }, true);
}
addEventListener('message', e => {
  const d = e.data || {};
  const pv = $('bdFrame') && $('bdFrame').querySelector('iframe');
  if (d.rkSelect && (state.view === 'build' || (state.view === 'studio' && S.mode === 'blocks')) && pv && e.source === pv.contentWindow) { selectBlock(d.rkSelect, false); }
});

/* ------------------------------------------------------------------ Build tab */
function badgesFor(b) {
  const r = b.rules || {}, out = [];
  if (b.kind === 'comp') out.push(`<span class="bx-badge acc">Component</span>`);
  if (b.replaces) out.push(`<span class="bx-badge">replaces “${esc(labelOfRef(b.replaces))}”</span>`);
  if (r.device === 'mobile') out.push('<span class="bx-badge blue">📱 Mobile only</span>');
  if (r.device === 'desktop') out.push('<span class="bx-badge blue">🖥 Desktop only</span>');
  if (r.start === 'scroll') out.push(`<span class="bx-badge blue">after ${r.scroll}% scroll</span>`);
  if (r.start === 'delay') out.push(`<span class="bx-badge blue">after ${r.delay}s</span>`);
  if (r.from || r.to) out.push(`<span class="bx-badge blue">📅 ${esc(r.from || '…')} → ${esc(r.to || '…')}</span>`);
  if (b.hidden) out.push('<span class="bx-badge">hidden</span>');
  return out.join('');
}
function labelOfRef(ref) { const b = siteBlocks(state.model).find(x => x.ref === ref); return b ? b.label : ref; }

function renderBuild() {
  const box = $('buildView');
  if (!state.model) { box.innerHTML = '<div class="bx-empty">Paste your site at the top first.</div>'; return; }
  ensureProject();
  const p = B.project;
  const styleOpts = [];
  const seen = new Set();
  [p.style, state.current, ...state.styles, ...state.saved].forEach(s => { if (s && !s.live && !seen.has(s.id)) { seen.add(s.id); styleOpts.push(s); } });
  const projects = store.get('reskin.projects', []);
  box.innerHTML = `
    <div class="bd-top">
      <input class="name" id="bdName" value="${esc(p.name)}" title="Project name">
      <label class="found">Look <select id="bdStyle">${styleOpts.map(s => `<option value="${s.id}" ${s.id === p.style.id ? 'selected' : ''}>${esc(s.name)} — ${esc(s.label)}</option>`).join('')}</select></label>
      ${projects.length > 1 ? `<label class="found">Project <select id="bdProj">${projects.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <span class="sp"></span>
      <div class="seg" id="bdDev"><button data-d="desktop" class="${B.device === 'desktop' ? 'on' : ''}">Desktop</button><button data-d="mobile" class="${B.device === 'mobile' ? 'on' : ''}">Mobile</button></div>
      <label class="found" title="Apply 'when it shows' rules in this preview"><input type="checkbox" id="bdRules" ${B.rulesPreview ? 'checked' : ''}> Try show rules</label>
      <button class="ghost" id="bdOpen">Open full page</button>
      <button class="primary" id="bdDl" style="height:36px;padding:0 14px;font-size:13.5px">Download site</button>
    </div>
    <div class="bd">
      <div class="bx-panel bd-blocks">
        <div class="bx-h"><h3>Your page <small>· drag to reorder</small></h3></div>
        <div class="bd-fixed"><label><input type="checkbox" id="bdNav" ${p.hideNav ? '' : 'checked'}> Menu bar</label><span>always on top</span></div>
        <div id="bdList"></div>
        <div class="bd-fixed"><label><input type="checkbox" id="bdFoot" ${p.hideFooter ? '' : 'checked'}> Footer</label><span>always at the bottom</span></div>
        <button class="bd-add" id="bdAdd">＋ Add a component</button>
      </div>
      <div class="bx-panel bd-preview"><div class="bx-h"><h3>Preview <small>· click a part of the page to edit it</small></h3><button class="ghost" id="bdReset" title="Start this page again from your site">Reset page</button></div><div class="bx-frame ${B.device}" id="bdFrame"></div></div>
      <div class="bx-panel bd-side" id="bdSide"></div>
    </div>`;
  renderBlockList();
  renderSide();
  renderBuildPreview();

  $('bdName').onchange = e => { p.name = e.target.value.trim() || 'My site'; saveProject(); };
  $('bdStyle').onchange = e => { p.style = styleOpts.find(s => s.id === e.target.value) || p.style; saveProject(); renderBuildPreview(); };
  if ($('bdProj')) $('bdProj').onchange = e => { const x = projects.find(q => q.id === e.target.value); if (x) openProject(x); };
  $('bdDev').onclick = e => { const b = e.target.closest('button'); if (!b) return; B.device = b.dataset.d; $('bdDev').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('bdFrame').className = 'bx-frame ' + B.device; };
  $('bdRules').onchange = e => { B.rulesPreview = e.target.checked; renderBuildPreview(); };
  $('bdNav').onchange = e => { p.hideNav = !e.target.checked; saveProject(); renderBuildPreview(); };
  $('bdFoot').onchange = e => { p.hideFooter = !e.target.checked; saveProject(); renderBuildPreview(); };
  $('bdAdd').onclick = () => startWizard({ after: B.sel });
  $('bdReset').onclick = () => { if (confirm('Put the page back to just your site’s own sections? Added components are removed.')) { p.blocks = siteBlocks(state.model); p.edits = []; p.btnCss = ''; p.btnFrom = null; B.sel = null; B.wizard = null; saveProject(); renderBuild(); } };
  $('bdDl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([composeDoc({ preview: false })], { type: 'text/html' }));
    a.download = `${slug(p.name || 'site')}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Downloaded — this file is your whole site');
  };
  $('bdOpen').onclick = () => {
    state.current = { ...p.style, name: p.name, label: 'Your built page', id: 'built-' + p.id, _built: true };
    $('mName').textContent = p.name; $('mInfo').textContent = 'Your built page · show rules are live here';
    $('modal').hidden = false; document.body.style.overflow = 'hidden';
    setModalDoc(composeDoc({ preview: true }), { live: true });
  };
}
function renderBlockList() {
  const list = $('bdList'), p = B.project;
  list.innerHTML = p.blocks.map((b, i) => `
    <div class="blk ${B.sel === b.id ? 'on' : ''} ${b.hidden ? 'off' : ''}" draggable="true" data-id="${b.id}">
      <span class="grip" title="Drag to move">⋮⋮</span>
      <div class="bl"><span class="kind">${b.kind === 'comp' ? esc((compById(b.compId) || {}).source || 'component') : b.ref === 'hero' ? 'your hero' : 'your section'}</span><b>${esc(b.label)}</b><div class="bx-row">${badgesFor(b)}</div></div>
      <div class="acts"><button data-up title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button data-down title="Move down" ${i === p.blocks.length - 1 ? 'disabled' : ''}>▼</button>${b.kind === 'comp' ? '<button data-del title="Remove this component" class="del">✕</button>' : ''}</div>
    </div>`).join('');
  let dragId = null;
  list.querySelectorAll('.blk').forEach(el => {
    const id = el.dataset.id;
    el.onclick = e => { if (e.target.closest('[data-up],[data-down],[data-del]')) return; selectBlock(id, true); };
    const del = el.querySelector('[data-del]');
    if (del) del.onclick = e => { e.stopPropagation(); if (typeof removeBlock === 'function') removeBlock(id); };
    el.querySelector('[data-up]').onclick = () => moveBlock(id, -1);
    el.querySelector('[data-down]').onclick = () => moveBlock(id, 1);
    el.addEventListener('dragstart', e => { dragId = id; el.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'blk:' + id); });
    el.addEventListener('dragend', () => { el.classList.remove('drag'); list.querySelectorAll('.blk').forEach(x => x.classList.remove('over-top', 'over-bot')); });
    el.addEventListener('dragover', e => { if (!dragId || dragId === id) return; e.preventDefault(); const r = el.getBoundingClientRect(), top = e.clientY < r.top + r.height / 2; el.classList.toggle('over-top', top); el.classList.toggle('over-bot', !top); });
    el.addEventListener('dragleave', () => el.classList.remove('over-top', 'over-bot'));
    el.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      if (!dragId || dragId === id) return;
      const r = el.getBoundingClientRect(), top = e.clientY < r.top + r.height / 2;
      const arr = B.project.blocks, from = arr.findIndex(x => x.id === dragId), [it] = arr.splice(from, 1);
      let to = arr.findIndex(x => x.id === id); if (!top) to++;
      arr.splice(to, 0, it); dragId = null;
      saveProject(); renderBlockList(); renderBuildPreview();
    });
  });
}
function moveBlock(id, d) {
  const arr = B.project.blocks, i = arr.findIndex(x => x.id === id), j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  saveProject(); renderBlockList(); renderBuildPreview();
}
function selectBlock(id, scroll) {
  B.sel = id; B.wizard = null;
  renderBlockList(); renderSide();
  postToPreview({ rkSel: id, scroll });
}
function postToPreview(msg) { const f = $('bdFrame') && $('bdFrame').querySelector('iframe'); if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*'); }
function renderBuildPreview() {
  const box = $('bdFrame'); if (!box) return;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
  f.title = 'Your page';
  f.srcdoc = composeDoc({ edit: true, rules: B.rulesPreview, preview: true });
  f.onload = () => { if (B.sel) setTimeout(() => postToPreview({ rkSel: B.sel, scroll: false }), 150); };
  box.replaceChildren(f);
}

/* side panel: block details, or the wire-up wizard */
function renderSide() {
  const side = $('bdSide'); if (!side) return;
  if (B.wizard) return renderWizard();
  const b = B.project.blocks.find(x => x.id === B.sel);
  if (!b) {
    side.innerHTML = `<div class="bx-h"><h3>Build your page</h3></div><div class="bx-pad">
      <p class="help" style="color:var(--muted);font-size:13.5px;margin-top:0">Your page is a stack of parts. Click one in the list or the preview to change it, drag to move it, or add a component from your library.</p>
      <ol style="font-size:13.5px;line-height:1.7;padding-left:18px;margin:0 0 14px">
        <li>Save components you like in the <b>Components</b> tab.</li>
        <li>Click <b>＋ Add a component</b>.</li>
        <li>Say what it replaces, what it says, and when it shows.</li>
        <li><b>Download site</b> when you're happy.</li></ol>
      <button class="primary" id="sdAdd" style="width:100%">＋ Add a component</button></div>`;
    $('sdAdd').onclick = () => startWizard({});
    return;
  }
  const isComp = b.kind === 'comp', c = isComp && compById(b.compId);
  side.innerHTML = `<div class="bx-h"><h3>${esc(b.label)}</h3><button class="icon" id="sdClose" title="Close">✕</button></div>
    <div class="bx-pad">
      <div class="bx-row" style="margin-bottom:12px">${badgesFor(b) || '<span class="bx-badge">Always shown</span>'}</div>
      ${isComp ? `<p style="font-size:13px;color:var(--muted);margin:0 0 12px">${esc(c ? c.name : 'Missing component')} · ${b.fill === 'own' ? 'its own sample words' : b.replaces ? 'your words from “' + esc(labelOfRef(b.replaces)) + '”' : 'your words'}${b.recolor ? ' · your colours' : ''}</p>` : ''}
      <div style="display:grid;gap:8px">
        ${isComp ? '<button class="primary" id="sdEdit">Edit this component</button>' : '<button class="primary" id="sdSwap">Replace with a component</button>'}
        <button class="ghost" id="sdRules">When does it show?</button>
        <button class="ghost" id="sdAfter">＋ Add a component below this</button>
        <button class="ghost" id="sdHide">${b.hidden ? 'Show it again' : 'Hide from the page'}</button>
        ${isComp ? `<button class="ghost" id="sdDel" style="color:#b2341a">Remove${b.replaces ? ' (bring back “' + esc(labelOfRef(b.replaces)) + '”)' : ''}</button>` : ''}
      </div></div>`;
  $('sdClose').onclick = () => { B.sel = null; renderBlockList(); renderSide(); postToPreview({ rkSel: '' }); };
  if (isComp) $('sdEdit').onclick = () => startWizard({ editing: b.id });
  else $('sdSwap').onclick = () => startWizard({ replaces: b.ref });
  $('sdRules').onclick = () => startWizard(isComp ? { editing: b.id, step: 4 } : { rulesFor: b.id });
  $('sdAfter').onclick = () => startWizard({ after: b.id });
  $('sdHide').onclick = () => { b.hidden = !b.hidden; saveProject(); renderBlockList(); renderSide(); renderBuildPreview(); };
  if (isComp) $('sdDel').onclick = () => {
    const arr = B.project.blocks, i = arr.indexOf(b);
    if (b.replaces) arr.splice(i, 1, ...siteBlocks(state.model).filter(x => x.ref === b.replaces)); else arr.splice(i, 1);
    B.sel = null; saveProject(); renderBuild();
  };
}

/* ------------------------------------------------------------------ wire-up wizard */
// steps: 1 pick component · 2 what's it replacing? · 3 what should it say? · 4 when does it show?
function startWizard(o) {
  const p = B.project;
  if (o.rulesFor) {   // show rules for one of your own sections
    const b = p.blocks.find(x => x.id === o.rulesFor);
    B.wizard = { step: 4, rulesOnly: b.id, rules: { ...DEFAULT_RULES(), ...b.rules } };
    return renderSide();
  }
  if (o.editing) {
    const b = p.blocks.find(x => x.id === o.editing);
    B.wizard = { step: o.step || 1, editing: b.id, compId: b.compId, place: b.replaces ? 'replace' : 'new', replaces: b.replaces || (siteBlocks(state.model)[0] || {}).ref,
      after: null, fill: b.fill, content: structuredClone(b.content || contentFromRef(b.replaces || 'hero')), recolor: b.recolor, rules: { ...DEFAULT_RULES(), ...b.rules }, variant: null };
    return renderSide();
  }
  const firstSite = p.blocks.find(x => x.kind === 'site');
  B.wizard = {
    step: o.compId ? 2 : 1, compId: o.compId || null,
    place: o.replaces ? 'replace' : 'new', replaces: o.replaces || (firstSite ? firstSite.ref : 'hero'),
    after: o.after || (p.blocks[0] && p.blocks[0].id), fill: o.fill || (o.replaces ? 'replace' : 'custom'),
    content: o.replaces ? contentFromRef(o.replaces) : { title: 'Your heading here', text: 'A sentence or two about this part of your site.', button: '', link: '#', cards: [] },
    recolor: o.recolor != null ? o.recolor : !!brandColor(), rules: DEFAULT_RULES(),
  };
  if (!(state.view === 'studio' && S.mode === 'blocks')) { S.mode = 'blocks'; setView('studio'); return; }   // the block editor lives in Studio now
  renderSide();
  $('bdSide').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderWizard() {
  const w = B.wizard, side = $('bdSide'), p = B.project;
  const steps = w.rulesOnly ? [4] : [1, 2, 3, 4];
  const titles = { 1: 'Pick a component', 2: 'What’s it replacing?', 3: 'What should it say?', 4: 'When does it show?' };
  let body = '';
  if (w.step === 1) {
    body = comps.list.length ? `<p class="help">Choose from your saved components. Save more in the <b>Library</b>.</p>
      <div class="pick">${comps.list.map(c => `<button data-pick="${c.id}" class="${w.compId === c.id ? 'on' : ''}"><div class="th" data-th="${c.id}"></div><span class="nm">${esc(c.name)}</span></button>`).join('')}</div>`
      : `<div class="bx-empty">You haven't saved any components yet.<br><br><button class="primary" id="wzGoComps">Find components</button></div>`;
  } else if (w.step === 2) {
    const sites = siteBlocks(state.model);
    body = `<p class="help">Is this new, or should it take the place of something on your page?</p>
      <label class="opt ${w.place === 'replace' ? 'on' : ''}"><input type="radio" name="pl" value="replace" ${w.place === 'replace' ? 'checked' : ''}><div><b>Replace part of my page</b><span>The component takes that part's place and uses its words.</span><br>
        <select id="wzRep">${sites.map(s => `<option value="${s.ref}" ${s.ref === w.replaces ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div></label>
      <label class="opt ${w.place === 'new' ? 'on' : ''}"><input type="radio" name="pl" value="new" ${w.place === 'new' ? 'checked' : ''}><div><b>Add it as something new</b><span>Put it below:</span><br>
        <select id="wzAfter"><option value="__top" ${w.after === '__top' ? 'selected' : ''}>(the very top)</option>${p.blocks.filter(b => b.id !== w.editing).map(b => `<option value="${b.id}" ${b.id === w.after ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></div></label>`;
  } else if (w.step === 3) {
    const c = w.content || (w.content = { title: '', text: '', button: '', link: '#', cards: [] });
    body = `<p class="help">The component keeps its look; these are the words it shows.</p>
      ${w.place === 'replace' ? `<label class="opt ${w.fill === 'replace' ? 'on' : ''}"><input type="radio" name="fl" value="replace" ${w.fill === 'replace' ? 'checked' : ''}><div><b>Use the words from “${esc(labelOfRef(w.replaces))}”</b><span>Same text as before, new look.</span></div></label>` : ''}
      <label class="opt ${w.fill === 'custom' ? 'on' : ''}"><input type="radio" name="fl" value="custom" ${w.fill === 'custom' ? 'checked' : ''}><div><b>Write my own</b><span>Edit the words below.</span></div></label>
      <label class="opt ${w.fill === 'own' ? 'on' : ''}"><input type="radio" name="fl" value="own" ${w.fill === 'own' ? 'checked' : ''}><div><b>Keep the component's own text</b><span>Useful for decorative pieces, or to edit later.</span></div></label>
      ${w.fill !== 'own' ? `<div style="margin-top:12px">
        <label class="field">Heading<input id="wzT" value="${esc(c.title)}"></label>
        <label class="field">Text<textarea id="wzX">${esc(c.text)}</textarea></label>
        <div class="bx-row"><label class="field" style="flex:1">Button text<input id="wzB" value="${esc(c.button)}" placeholder="(no button)"></label><label class="field" style="flex:1">Button link<input id="wzL" value="${esc(c.link)}" placeholder="#contact or https://…"></label></div>
        ${c.cards.length ? `<p class="help" style="margin:4px 0 6px">Items (${c.cards.length}) — each fills one card in the component:</p>${c.cards.map((k, i) => `<div class="bx-row"><label class="field" style="flex:1">Item ${i + 1}<input data-ct="${i}" value="${esc(k.title)}"></label><label class="field" style="flex:2">Text<input data-cx="${i}" value="${esc(k.text)}"></label></div>`).join('')}` : ''}
      </div>` : ''}
      <label class="check"><input type="checkbox" id="wzRc" ${w.recolor ? 'checked' : ''} ${brandColor() ? '' : 'disabled'}> Match my brand colour ${brandColor() ? `<i style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${Cx.css(brandColor())}"></i>` : '<span style="color:var(--muted);font-size:12px">(pick one in Advanced → Colour palette)</span>'}</label>`;
  } else {
    const r = w.rules;
    body = `<p class="help">Most things just show all the time. Use these for banners, popups or seasonal offers.</p>
      <h4 style="font-size:13px;margin:6px 0">On which screens?</h4>
      ${[['all', 'Everywhere', 'Phones, tablets and computers'], ['desktop', 'Computers only', 'Hidden on phones'], ['mobile', 'Phones only', 'Hidden on bigger screens']].map(([v, t, s]) => `<label class="opt ${r.device === v ? 'on' : ''}"><input type="radio" name="dv" value="${v}" ${r.device === v ? 'checked' : ''}><div><b>${t}</b><span>${s}</span></div></label>`).join('')}
      <h4 style="font-size:13px;margin:14px 0 6px">When does it appear?</h4>
      <label class="opt ${r.start === 'now' ? 'on' : ''}"><input type="radio" name="st" value="now" ${r.start === 'now' ? 'checked' : ''}><div><b>Right away</b><span>Part of the page from the start</span></div></label>
      <label class="opt ${r.start === 'scroll' ? 'on' : ''}"><input type="radio" name="st" value="scroll" ${r.start === 'scroll' ? 'checked' : ''}><div><b>After scrolling down</b><span>Slides in once visitors have read <input type="number" id="wzSc" min="0" max="100" value="${r.scroll}">% of the page</span></div></label>
      <label class="opt ${r.start === 'delay' ? 'on' : ''}"><input type="radio" name="st" value="delay" ${r.start === 'delay' ? 'checked' : ''}><div><b>After a few seconds</b><span>Appears after <input type="number" id="wzDl" min="0" max="120" value="${r.delay}"> seconds</span></div></label>
      <h4 style="font-size:13px;margin:14px 0 6px">Only between certain dates? <span style="font-weight:400;color:var(--muted)">(optional)</span></h4>
      <div class="opt" style="cursor:default"><div style="display:grid;grid-template-columns:auto 1fr;gap:6px 8px;align-items:center;font-size:12.5px;color:var(--muted)">From <input type="date" id="wzFrom" value="${esc(r.from)}">Until <input type="date" id="wzTo" value="${esc(r.to)}"></div></div>`;
  }
  const isLast = w.step === 4, isFirst = w.step === steps[0];
  side.innerHTML = `<div class="bx-h"><h3>${w.rulesOnly ? 'When does it show?' : w.editing ? 'Edit component' : 'Wire up your component'}</h3><button class="icon" id="wzX0" title="Cancel">✕</button></div>
    ${steps.length > 1 ? `<div class="wz-steps">${steps.map(s => `<i class="${s <= w.step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    <div class="bx-pad wz"><h4>${steps.length > 1 ? `Step ${w.step} of 4 · ` : ''}${titles[w.step]}</h4>${body}</div>
    <div class="wz-foot"><button class="ghost" id="wzBack" ${isFirst ? 'style="visibility:hidden"' : ''}>← Back</button>
      <button class="primary" id="wzNext" ${w.step === 1 && !w.compId ? 'disabled' : ''}>${isLast ? (w.rulesOnly || w.editing ? 'Save' : 'Add to my page') : 'Next →'}</button></div>`;

  $('wzX0').onclick = () => { B.wizard = null; renderSide(); };
  $('wzBack').onclick = () => { readWizard(); w.step--; renderSide(); };
  $('wzNext').onclick = async () => {
    readWizard();
    if (w.step === 1 && w.compId) { const c = compById(w.compId); $('wzNext').innerHTML = '<span class="spin"></span>Reading the component…'; $('wzNext').disabled = true; await ensureCompTokens(c); }
    if (w.step === 2 && w.place === 'replace' && !w.editing) { w.content = contentFromRef(w.replaces); if (w.fill === 'custom') w.fill = 'replace'; }
    if (w.step === 2 && w.place === 'new' && w.fill === 'replace') w.fill = 'custom';
    if (isLast) return finishWizard();
    w.step++; renderSide();
  };
  if (w.step === 1) {
    side.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { w.compId = b.dataset.pick; side.querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('on', x === b)); $('wzNext').disabled = false; });
    side.querySelectorAll('[data-th]').forEach(th => { const c = compById(th.dataset.th); const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('loading', 'lazy'); f.srcdoc = compThumbDoc(c); th.appendChild(f); const fit = () => { if (th.clientWidth) f.style.transform = `scale(${th.clientWidth / 600})`; }; fit(); new ResizeObserver(fit).observe(th); });
    if ($('wzGoComps')) $('wzGoComps').onclick = () => { B.wizard = null; setView('components'); };
  }
  side.querySelectorAll('.opt input[type=radio]').forEach(r => r.onchange = () => { readWizard(); renderSide(); });
}
function readWizard() {
  const w = B.wizard, q = s => document.querySelector(s), val = n => { const r = document.querySelector(`input[name=${n}]:checked`); return r && r.value; };
  if (w.step === 2) { w.place = val('pl') || w.place; if (q('#wzRep')) w.replaces = q('#wzRep').value; if (q('#wzAfter')) w.after = q('#wzAfter').value; }
  if (w.step === 3) {
    w.fill = val('fl') || w.fill;
    if (q('#wzT')) { w.content.title = q('#wzT').value; w.content.text = q('#wzX').value; w.content.button = q('#wzB').value; w.content.link = q('#wzL').value || '#'; }
    document.querySelectorAll('[data-ct]').forEach(i => { w.content.cards[+i.dataset.ct].title = i.value; });
    document.querySelectorAll('[data-cx]').forEach(i => { w.content.cards[+i.dataset.cx].text = i.value; });
    if (q('#wzRc')) w.recolor = q('#wzRc').checked;
  }
  if (w.step === 4) {
    const r = w.rules; r.device = val('dv') || r.device; r.start = val('st') || r.start;
    if (q('#wzSc')) r.scroll = Math.max(0, Math.min(100, +q('#wzSc').value || 0));
    if (q('#wzDl')) r.delay = Math.max(0, +q('#wzDl').value || 0);
    if (q('#wzFrom')) { r.from = q('#wzFrom').value; r.to = q('#wzTo').value; }
  }
}
function finishWizard() {
  const w = B.wizard, p = B.project;
  if (w.rulesOnly) {
    p.blocks.find(x => x.id === w.rulesOnly).rules = w.rules;
    B.sel = w.rulesOnly;
  } else {
    const c = compById(w.compId);
    const content = w.fill === 'replace' ? contentFromRef(w.replaces) : w.content;
    const block = { id: w.editing || 'b-c' + Date.now().toString(36), kind: 'comp', compId: w.compId, label: c.name,
      fill: w.fill, content, recolor: w.recolor, rules: w.rules, replaces: w.place === 'replace' ? w.replaces : null };
    let arr = p.blocks;
    if (w.editing) {
      const old = arr.find(x => x.id === w.editing);
      if (old.replaces && old.replaces !== block.replaces) { const i = arr.indexOf(old); arr.splice(i, 0, ...siteBlocks(state.model).filter(x => x.ref === old.replaces)); }
      arr = p.blocks = arr.filter(x => x.id !== w.editing);
    }
    if (block.replaces) {
      const i = arr.findIndex(x => x.kind === 'site' && x.ref === block.replaces);
      if (i >= 0) arr.splice(i, 1, block);
      else { const j = w.editing ? arr.length : arr.length; arr.splice(j, 0, block); }
    } else {
      const i = w.after === '__top' ? 0 : arr.findIndex(x => x.id === w.after) + 1;
      arr.splice(i > 0 || w.after === '__top' ? i : arr.length, 0, block);
    }
    B.sel = block.id;
    toast(w.editing ? 'Updated' : `Added “${c.name}” to your page`);
  }
  B.wizard = null;
  saveProject();
  renderBlockList(); renderSide(); renderBuildPreview();
}

/* ------------------------------------------------------------------ Component tab */
function renderCompView() {
  const box = $('compView');
  if (!comps.list.length) { box.innerHTML = `<div class="bx-panel bx-empty">No components yet — save some in the <b>Library</b> first.<br><br><button class="primary" id="cvGo">Find components</button></div>`; $('cvGo').onclick = () => setView('components'); return; }
  if (!compById(B.compSel)) B.compSel = comps.list[0].id;
  const c = compById(B.compSel);
  box.innerHTML = `<div class="cv">
    <div class="bx-panel cv-list"><div class="bx-h"><h3>Your components</h3></div>${comps.list.map(x => `<button class="cv-item ${x.id === c.id ? 'on' : ''}" data-c="${x.id}"><span>${esc(x.name)}</span><small>${esc(x.source)}</small></button>`).join('')}</div>
    <div class="cv-main">
      <div class="bx-panel"><div class="bx-h"><h3>${esc(c.name)} <small>· ${esc(c.source)}${c.collection ? ' · ' + esc(c.collection) : ''}</small></h3>
        <div class="bx-row"><div class="seg" id="cvDev"><button data-d="desktop" class="${B.compDevice === 'desktop' ? 'on' : ''}">Desktop</button><button data-d="mobile" class="${B.compDevice === 'mobile' ? 'on' : ''}">Mobile</button></div>
        <button class="primary" id="cvAdd" style="height:34px;padding:0 14px;font-size:13px">Add to my site →</button></div></div>
        <div class="bx-frame ${B.compDevice}" id="cvFrame"></div></div>
      <h3 style="margin:22px 0 4px;font-family:'Instrument Serif',serif;font-weight:400;font-size:26px">Variations</h3>
      <p class="found" style="margin:0">Click one to preview it above, or add it to your site straight away.</p>
      <div class="cv-vars" id="cvVars"><div class="bx-empty"><span class="spin" style="border-color:#ddd;border-top-color:var(--accent)"></span></div></div>
    </div></div>`;
  box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { B.compSel = b.dataset.c; B.compVar = null; renderCompView(); });
  $('cvDev').onclick = e => { const b = e.target.closest('button'); if (!b) return; B.compDevice = b.dataset.d; $('cvDev').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('cvFrame').className = 'bx-frame ' + B.compDevice; };
  const showMain = v => { const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox'); f.srcdoc = v ? compBlockDoc(c, v.opts) : compDoc(c); $('cvFrame').replaceChildren(f); };
  showMain(B.compVar);
  $('cvAdd').onclick = () => addVariantToSite(c, B.compVar);
  ensureCompTokens(c).then(() => {
    if (B.compSel !== c.id || !$('cvVars')) return;
    const words = state.model ? contentFromRef('hero') : null;
    const hasBrand = !!brandColor() && !!(c.tokens.accent || c.tokens.btnBg);
    const vars = [
      { key: 'orig', name: 'Original', opts: { fill: 'own' } },
      hasBrand && { key: 'brand', name: 'In your brand colour', opts: { fill: 'own', recolor: true } },
      words && { key: 'words', name: 'With your words', opts: { fill: 'custom', content: words } },
      words && hasBrand && { key: 'both', name: 'Your words + colour', opts: { fill: 'custom', content: words, recolor: true } },
    ].filter(Boolean);
    $('cvVars').innerHTML = '';
    vars.forEach(v => {
      const el = document.createElement('div'); el.className = 'cv-var' + ((B.compVar ? B.compVar.key : 'orig') === v.key ? ' on' : '');
      el.innerHTML = `<div class="th"></div><div class="mt"><b>${esc(v.name)}</b><button class="ghost" style="padding:5px 10px;font-size:12.5px">Add to site</button></div>`;
      const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('loading', 'lazy');
      f.srcdoc = injectEnd(compBlockDoc(c, { ...v.opts, thumb: true }), '<style>#root{min-height:100vh;display:grid;place-items:center}</style>');
      const th = el.querySelector('.th'); th.appendChild(f);
      const fit = () => { if (th.clientWidth) f.style.transform = `scale(${th.clientWidth / 900})`; }; fit(); new ResizeObserver(fit).observe(th);
      th.onclick = () => { B.compVar = v; $('cvVars').querySelectorAll('.cv-var').forEach(x => x.classList.toggle('on', x === el)); showMain(v); };
      el.querySelector('button').onclick = () => addVariantToSite(c, v);
      $('cvVars').appendChild(el);
    });
  });
}
async function addVariantToSite(c, v) {
  if (!state.model) { toast('Paste your site at the top first'); return; }
  await ensureCompTokens(c);
  // one stage: open Studio with it glowing in the rail — drag it where you want it
  S.flash = c.id; setView('studio'); toast(`Drag “${c.name}” from the rail onto your page`, 4000);
}

/* ------------------------------------------------------------------ hook into the app's tabs */
VIEWS.build = () => {
  renderBuild();
  if (B.pendingWizard) { const pw = B.pendingWizard; B.pendingWizard = null; startWizard(pw); }
};
VIEWS.component = renderCompView;
