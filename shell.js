/* Reskin shell — the app's frame around the engine, builder and studio:
   - three tabs: Explore (paste your site) · Studio (the stage) · Library (styles + components you keep)
   - the old Saved / Components / Component / Advanced / Build destinations live inside those three
   - ⚙ page settings (palette, hero, image slots) as a sheet over whatever is showing
   - the app wears your style: when you preview or pick a style, Reskin itself takes its colours and fonts
   - grab a part of any page (a button, a card…) and keep it as a component
   - icon packs: drop a .zip of SVGs into the Library
   Needs engine.js, app.js, builder.js, studio.js. */

/* ------------------------------------------------------------------ 1. three tabs */
const LIB = { filter: 'all', detail: null, cat: 'all' };
VIEWS.library = () => renderLibrary();
{
  const base = setView;
  setView = async function (v) {
    // old destinations → where they live now
    if (v === 'saved') { LIB.filter = 'styles'; LIB.detail = null; v = 'library'; }
    if (v === 'components') { LIB.filter = 'components'; LIB.detail = null; v = 'library'; }
    if (v === 'component') { LIB.detail = B.compSel || (comps.list[0] || {}).id || null; v = 'library'; }
    if (v === 'build') v = 'studio';
    if (v === 'advanced') { v = state.view === 'all' ? 'studio' : state.view; setTimeout(openGear, 0); }
    document.querySelector('.intro').hidden = v !== 'all';
    if (v !== 'library') restoreLibraryParts();
    await base(v);
    $('results').hidden = v === 'all' || !state.model;
    if (v === 'all') { window.scrollTo({ top: 0, behavior: 'smooth' }); wearStyle(null); }
    if (v !== 'studio' && v !== 'all') wearStyle(null);
  };
}
// Build's own re-renders (remove a block, reset, open a project) now refresh the Studio stage
{
  const rb = renderBuild;
  renderBuild = function () { if (state.view === 'studio') return renderStudio(); return rb.apply(this, arguments); };
}
// the Library tab shows how much you keep
updateSavedCount = function () { const n = state.saved.length + comps.list.length; const el = $('savedCount'); if (el) el.textContent = n ? `(${n})` : ''; };

/* ------------------------------------------------------------------ 2. Library: styles + components */
function restoreLibraryParts() {
  const r = $('results');
  if ($('comps').parentElement !== r) { r.insertBefore($('comps'), $('compView')); $('comps').hidden = true; }
  if ($('compView').parentElement !== r) { r.insertBefore($('compView'), $('buildView')); $('compView').hidden = true; }
}
function renderLibrary() {
  const box = $('libraryView');
  $('banner').innerHTML = '';
  restoreLibraryParts();
  if (LIB.detail && compById(LIB.detail)) {
    box.innerHTML = `<div class="lib-head"><button class="ghost" id="libBack">← Library</button><h2>${esc(compById(LIB.detail).name)}</h2></div><div id="libDetail"></div>`;
    $('libBack').onclick = () => { LIB.detail = null; renderLibrary(); };
    B.compSel = LIB.detail;
    const c = compById(LIB.detail), fz = frozenInfo(c);
    if (fz) {
      $('libDetail').insertAdjacentHTML('beforebegin', `<div class="frozen-help"><b>❄ This is a still snapshot.</b> ${esc(fz.why)} It looks right, but clicks, hovers and animations that need its code won’t run.
        <ol><li>Open its page${fz.from ? ` (<a href="${esc(fz.from)}" target="_blank" rel="noopener">${esc(new URL(fz.from).hostname + new URL(fz.from).pathname)}</a>)` : ''} and use its <b>Code</b> / <b>Copy</b> button to copy the component’s code (React / TSX / JSX).</li>
        <li>Paste it here — Reskin runs it, with its packages (motion, gsap, three…), and it replaces this snapshot everywhere it’s used.</li></ol>
        <div class="bx-row">${fz.from ? `<button class="ghost" id="fzOpen">Open its page ↗</button>` : ''}<button class="primary" id="fzPaste">Paste its code</button></div>
        <textarea id="fzCode" hidden spellcheck="false" placeholder="Paste the component’s code here (TSX / JSX, or HTML with its CSS)"></textarea>
        <div class="bx-row" id="fzRow" hidden><button class="primary" id="fzSave">Replace the snapshot with this code</button><span class="found" id="fzMsg"></span></div></div>`);
      if ($('fzOpen')) $('fzOpen').onclick = () => window.open(fz.from, '_blank', 'noopener');
      $('fzPaste').onclick = () => { $('fzCode').hidden = false; $('fzRow').hidden = false; $('fzCode').focus(); };
      $('fzSave').onclick = async () => {
        const code = $('fzCode').value.trim(); if (!code) return toast('Paste the code first');
        const kind = detectKind(code);
        $('fzMsg').textContent = 'Checking it runs…';
        try {
          const res = await runSandbox(id => kind === 'tsx' ? tsxDoc(code, id) : withProbe(code, id), 20000);
          if (!res || (!res.html || !res.html.replace(/<[^>]+>/g, '').trim()) && !/<(svg|canvas|img)/i.test(res.html || '')) throw new Error('It ran, but showed nothing');
        } catch (e) { $('fzMsg').textContent = `That code didn’t run here: ${e.message}. Check you copied the whole component.`; return; }
        Object.assign(c, { code, kind, tokens: null, frozen: null, frozenV: 2, catV: 0, source: c.source === 'grabbed' ? 'pasted' : c.source });
        comps.save(); toast(`“${c.name}” now runs its real code — everywhere it’s used`); renderLibrary();
      };
    }
    $('libDetail').appendChild($('compView')); $('compView').hidden = false;
    renderCompView();
    if (parseProps(c) && parseProps(c).fields.length) {
      const sec = document.createElement('div'); sec.className = 'bx-panel pp-panel';
      sec.innerHTML = `<div class="bx-h"><h3>⚙ Settings <small>· used everywhere this component appears</small></h3></div><div class="bx-pad" id="ppBox"></div>`;
      $('libDetail').prepend(sec);
      renderPropsPanel($('ppBox'), c, null, () => renderCompView());
    }
    return;
  }
  const nS = state.saved.length, nC = comps.list.length;
  box.innerHTML = `
    <div class="lib-head"><h2>Library</h2>
      <div class="chips">${[['all', 'Everything'], ['styles', `Styles <small>${nS}</small>`], ['components', `Components <small>${nC}</small>`]].map(([k, l]) => `<button data-lf="${k}" class="${LIB.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="sp"></span>
      <button class="ghost" id="libGrab" title="Open a saved page and click the part you want">✂ Grab from a page</button>
      <button class="ghost" id="libIcons" title="A .zip of SVG icons">Import icons (.zip)</button>
    </div>
    <section class="lib-sec" id="libStylesSec" ${LIB.filter === 'components' ? 'hidden' : ''}><h3>Styles you saved</h3><div class="grid lib-grid" id="libStyles"></div></section>
    <section class="lib-sec" id="libCompsSec" ${LIB.filter === 'styles' ? 'hidden' : ''}><h3>Components</h3>
      <div class="lib-split"><nav class="lib-cats" id="libCats" aria-label="Component categories"></nav><div id="libComps"></div></div></section>`;
  box.querySelectorAll('[data-lf]').forEach(b => b.onclick = () => { LIB.filter = b.dataset.lf; renderLibrary(); });
  $('libGrab').onclick = () => pickTemplateFiles();
  $('libIcons').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.zip'; i.onchange = () => i.files[0] && importIconZip(i.files[0]); i.click(); };
  // styles
  const g = $('libStyles');
  if (!nS) g.innerHTML = '<div class="empty">No saved styles yet. Tap ♡ on a style in Studio’s filmstrip.</div>';
  state.saved.forEach(s => {
    const t = tile(s);
    const use = document.createElement('button'); use.className = 'primary lib-use'; use.textContent = s.live ? 'Preview' : 'Use in Studio';
    use.onclick = () => { if (s.live) return openModal(s); ensureProject(); B.project.style = s; saveProject(); setView('studio'); toast(`“${s.name}” is now your site’s style`); };
    t.querySelector('.meta').appendChild(use);
    g.appendChild(t);
  });
  const fit = () => { const t = g.querySelector('.thumb'); if (t && t.clientWidth) g.style.setProperty('--s', t.clientWidth / 1280); };
  fit(); new ResizeObserver(fit).observe(g);
  // components: the existing library UI, moved in here
  $('libComps').appendChild($('comps')); $('comps').hidden = false;
  renderCats();
  renderComps();
}
// each component tile: open its page, put it on your page, or apply its style
function libraryPatchComps() {
  const shown = comps.list.filter(c => comps.filter === 'All' || c.collection === comps.filter);
  let visible = 0;
  $('comps').querySelectorAll('.ctile').forEach((t, i) => {
    const c = shown[i]; if (!c) return;
    const fz = frozenInfo(c);
    if (fz && !t.querySelector('.frozen-tag')) t.querySelector('.cthumb').insertAdjacentHTML('beforeend', `<span class="frozen-tag" title="${esc(fz.why)}">❄ Snapshot — doesn’t react</span>`);
    const on = LIB.cat === 'all' || compCat(c) === LIB.cat;
    t.hidden = !on; if (on) visible++;
    if (!t.querySelector('.cat-tag')) t.querySelector('.cthumb').insertAdjacentHTML('beforeend', `<span class="cat-tag">${esc(catName(compCat(c)))}</span>`);
  });
  const grid = $('comps').querySelector('.cgrid'), none = grid && grid.querySelector('.cat-none');
  if (grid && !visible && shown.length && !none) grid.insertAdjacentHTML('beforeend', `<div class="empty cat-none">No ${esc(catName(LIB.cat).toLowerCase())} in this collection yet.</div>`);
  if (grid && visible && none) none.remove();
  if ($('libCats')) renderCats();
  $('comps').querySelectorAll('.ctile').forEach((t, i) => {
    const c = shown[i]; if (!c) return;
    const th = t.querySelector('.cthumb');
    if (c.icon) { th.querySelector('iframe') && th.querySelector('iframe').remove(); th.classList.add('icon'); th.insertAdjacentHTML('beforeend', `<img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}">`); }
    th.style.cursor = 'pointer'; th.title = 'Open';
    th.onclick = () => { LIB.detail = c.id; renderLibrary(); };
    const use = t.querySelector('[data-use]');
    if (use) { use.textContent = 'Apply its style…'; use.onclick = () => applyStyleDialog(c); }
    const put = document.createElement('button'); put.className = 'primary'; put.textContent = 'Put on my page';
    put.onclick = () => { S.flash = c.id; setView('studio'); toast(`Drag “${c.name}” from the rail onto your page`, 4000); };   // it glows in the rail
    if (use) use.before(put);
  });
}
{
  const rc = renderComps;
  renderComps = function () { rc.apply(this, arguments); if (state.view === 'library') libraryPatchComps(); updateSavedCount(); };
}

/* ---- components sort themselves into categories (like 21st.dev's sidebar) ---- */
// [key, name, glyph, words in its name / link, things in its code]
const CATS = [
  ['icons', 'Icons', '◇', null, null],
  ['nav', 'Navigation Menus', '☰', /\b(nav|navbar|navigation|menu|header|dock|sidebar|breadcrumb)/, /<nav\b|role="navigation"/],
  ['footers', 'Footers', '▁', /\bfooter/, /<footer\b/],
  ['heroes', 'Heroes', '▣', /\b(hero|landing|banner|splash)/, null],
  ['pricing', 'Pricing Sections', '$', /(pric|plans?\b|billing|subscri|checkout|payment)/, /\/\s?mo\b|per month|\/month|billed (yearly|monthly)/],
  ['cta', 'Calls to Action', '➜', /\b(cta|call.to.action|get.started|sign.?up|newsletter|waitlist|join)/, null],
  ['features', 'Features', '✦', /\b(feature|benefit|bento|how.it.works)/, null],
  ['testimonials', 'Testimonials', '❝', /(testimonial|review|quote)/, /<blockquote\b/],
  ['faq', 'FAQs', '?', /\b(faq|accordion|question)/, /<details\b/],
  ['galleries', 'Galleries', '▦', /(gallery|carousel|slider|slideshow|lightbox)/, null],
  ['marquees', 'Marquees & Logos', '⇢', /(marquee|ticker|logo.?cloud|clients|logos)/, /@keyframes[^{]*(marquee|scroll|ticker)/],
  ['stats', 'Stats & KPIs', '▲', /\b(stats?|kpi|metric|counter|dashboard|chart|analytics)/, null],
  ['backgrounds', 'Backgrounds', '▒', /(background|gradient|shader|aurora|particles|noise|beams|spotlight)/, /<canvas\b/],
  ['buttons', 'Buttons', '⬭', /\b(button|btn)/, null],
  ['cards', 'Cards', '▭', /\bcards?\b/, null],
  ['forms', 'Forms & Inputs', '✎', /\b(form|input|search|login|sign.?in|contact|textarea|otp)/, /<form\b/],
  ['toggles', 'Toggles & Checkboxes', '◉', /(toggle|switch|checkbox|radio)/, /type="?(checkbox|radio)/],
  ['loaders', 'Loaders', '◌', /(loader|loading|spinner|progress|skeleton)/, null],
  ['dialogs', 'Dialogs & Popups', '◳', /(modal|dialog|popup|popover|tooltip|toast|drawer|sheet)/, /<dialog\b|role="dialog"/],
  ['tabs', 'Tabs', '⊟', /\b(tabs?|segmented)\b/, /role="tablist"/],
  ['badges', 'Badges & Tags', '●', /\b(badge|chip|tag|pill)s?\b/, null],
  ['files', 'Files & Folders', '🗀', /(folder|files?\b|upload|dropzone)/, null],
  ['text', 'Text Effects', 'Aa', /(text|typewriter|heading|letter|glitch|word)/, null],
  ['other', 'Other', '…', null, null],
];
const CAT_V = 4;   // bump when the rules change, so saved components get sorted again
const catName = k => (CATS.find(x => x[0] === k) || CATS[CATS.length - 1])[1];
function compCat(c) {
  if (c.catV === CAT_V && c.cat) return c.cat;
  c.cat = sortComp(c); c.catV = CAT_V;
  clearTimeout(compCat.t); compCat.t = setTimeout(() => comps.save(), 400);   // keep it, quietly
  return c.cat;
}
function sortComp(c) {
  if (c.icon) return 'icons';
  const named = [c.name, c.collection].join(' ').toLowerCase(), link = String(c.url || '').toLowerCase();
  for (const src of [named, link]) for (const k of CATS) if (k[3] && k[3].test(src)) return k[0];
  const code = String(c.code || '').slice(0, 60000), lower = code.toLowerCase();
  for (const k of CATS) if (k[4] && k[4].test(lower)) return k[0];
  // what does its page actually hold? the first real element tells a lot
  const body = (lower.split(/<body[^>]*>/)[1] || lower).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|\sstyle="[^"]*"/g, '');
  const first = (/<([a-z][a-z0-9-]*)/.exec(body.replace(/<(div|span|main|section)\b[^>]*>\s*/g, '')) || [])[1];
  if (first === 'button' || (first === 'a' && body.length < 1500)) return 'buttons';
  if (first === 'svg' && body.length < 4000) return 'icons';
  if (first === 'input') return /checkbox|radio/.test(body) ? 'toggles' : 'forms';
  if (/^h[1-3]$/.test(first) && body.length < 6000) return 'text';
  // otherwise: the category whose words show up most in its code (at least a few times)
  let best = 'other', top = 2;
  for (const k of CATS) { if (!k[3]) continue; const n = (body.match(new RegExp(k[3].source, 'g')) || []).length; if (n > top) { top = n; best = k[0]; } }   // in its markup, not its CSS
  return best;
}
function renderCats() {
  const nav = $('libCats'); if (!nav) return;
  const pool = comps.list.filter(c => comps.filter === 'All' || c.collection === comps.filter);
  const counts = {}; pool.forEach(c => { const k = compCat(c); counts[k] = (counts[k] || 0) + 1; });
  if (LIB.cat !== 'all' && !counts[LIB.cat]) LIB.cat = 'all';
  nav.innerHTML = `<button data-cat="all" class="${LIB.cat === 'all' ? 'on' : ''}"><i>▤</i><span>All components</span><small>${pool.length}</small></button>` +
    CATS.filter(k => counts[k[0]]).map(([k, n, g]) => `<button data-cat="${k}" class="${LIB.cat === k ? 'on' : ''}"><i>${g}</i><span>${esc(n)}</span><small>${counts[k]}</small></button>`).join('');
  nav.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { LIB.cat = b.dataset.cat; renderComps(); });
}

/* ------------------------------------------------------------------ 3. ⚙ page settings sheet */
function openGear() {
  if (!state.model) { toast('Paste your site first'); return; }
  let g = $('gearSheet');
  if (!g) {
    g = document.createElement('div'); g.id = 'gearSheet'; g.className = 'gear';
    g.innerHTML = `<div class="gear-box"><div class="gear-h"><h3>Page settings</h3><span class="found">Colours, hero and images for your page</span><button class="icon" id="gearX" title="Close (Esc)">✕</button></div><div class="gear-body" id="gearBody"></div></div>`;
    document.body.appendChild(g);
    g.addEventListener('click', e => { if (e.target === g) closeGear(); });
    $('gearX').onclick = closeGear;
  }
  g.hidden = false;
  $('gearBody').appendChild($('adv')); $('adv').hidden = false;
  if (!state.styles.length) state.styles = batch(12, state.mood, true);
  renderAdvanced();
}
function closeGear() {
  const g = $('gearSheet'); if (!g || g.hidden) return;
  g.hidden = true;
  $('results').insertBefore($('adv'), $('comps')); $('adv').hidden = true;
  if (state.view === 'studio') renderStudio();
}
{
  // while the sheet is open, the page behind it follows every change
  const ra = renderAdvanced;
  renderAdvanced = function () {
    ra.apply(this, arguments);
    if ($('gearSheet') && !$('gearSheet').hidden && state.view === 'studio') { clearTimeout(openGear.t); openGear.t = setTimeout(() => { renderStudioPreview(); if (typeof renderFilm === 'function') renderFilm(); }, 250); }
  };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeGear(); closeGrab(); closeCtx(); } });

/* ------------------------------------------------------------------ 4. the app wears your style */
const APP_LOOK = { on: store.get('reskin.wear', true) };
function familyOf(s, which) {
  if (s.font && s.font[which]) return s.font[which];
  const parts = String(s.fontLabel || '').split(' + ');
  return which === 'd' ? parts[0] : parts[1] || parts[0];
}
// how each family of generated styles moves (imported designs bring their own, read by the probe)
const ARCH_MOTION = {
  minimal: { ease: 'cubic-bezier(.2,.7,.2,1)', dur: 180, hover: 'color' }, corporate: { ease: 'ease-out', dur: 200, hover: 'lift' },
  dark: { ease: 'cubic-bezier(.16,1,.3,1)', dur: 280, hover: 'glow' }, bold: { ease: 'cubic-bezier(.3,1.6,.6,1)', dur: 140, hover: 'grow' },
  playful: { ease: 'cubic-bezier(.34,1.56,.64,1)', dur: 320, hover: 'grow' }, elegant: { ease: 'cubic-bezier(.22,1,.36,1)', dur: 450, hover: 'color' },
  brutalist: { ease: 'steps(2)', dur: 90, hover: 'lift' }, retro: { ease: 'cubic-bezier(.3,1.4,.6,1)', dur: 220, hover: 'grow' },
  glass: { ease: 'cubic-bezier(.16,1,.3,1)', dur: 320, hover: 'glow' }, editorial: { ease: 'ease', dur: 250, hover: 'color' },
};
const designTokens = s => s && s.arch === 'target' && state.tgt && state.tgt.tokens && (!s.target || s.target === state.tgt.tokens.name || s.target === state.tgt.name) ? state.tgt.tokens : null;
let worn = null;
function wearStyle(s) {
  const r = document.documentElement.style, body = document.body;
  const keys = ['--bg', '--panel', '--ink', '--muted', '--line', '--accent', '--accent-ink', '--chip', '--accent-soft', '--font-b', '--font-d',
    '--btn-r', '--btn-shadow', '--btn-w', '--btn-tt', '--btn-ls', '--btn-bw', '--app-r', '--head-w', '--head-ls', '--head-tt', '--ease', '--dur'];
  const clear = () => { keys.forEach(k => r.removeProperty(k)); body.classList.remove('wearing', 'mo-lift', 'mo-grow', 'mo-glow', 'mo-color'); const f = $('appFaces'); if (f) f.innerHTML = ''; };
  if (!s || !APP_LOOK.on || !s.pal) { clear(); worn = null; updateLookBtn(s); return; }
  const T = designTokens(s);
  const p = (typeof withOverrides === 'function' ? withOverrides(s) : s).pal || s.pal;
  const col = x => (x && String(x).trim()) || null, css = x => Array.isArray(x) ? Cx.css(x) : col(x);
  const set = (k, v) => { if (v != null && v !== '') r.setProperty(k, String(v)); else r.removeProperty(k); };
  // colours
  const bg = col(p.bodyBg) || col(p.bg), panel = col(p.card) || col(p.surface) || bg;
  set('--bg', bg); set('--panel', panel); set('--ink', col(p.text)); set('--muted', col(p.muted) || (p.text && `color-mix(in srgb, ${p.text} 62%, ${bg})`));
  set('--line', col(p.border) || (p.text && `color-mix(in srgb, ${p.text} 14%, ${bg})`));
  set('--accent', col(p.accent)); set('--accent-ink', col(p.accentText) || (p.accent && Cx.css(Cx.on(cssToRgb(p.accent))))); set('--chip', col(p.surface));
  set('--accent-soft', `color-mix(in srgb, ${col(p.accent)} 10%, ${panel})`);
  // buttons take the input's shape
  const tb = T && T.btn;
  const radius = tb && tb.radius != null ? Math.min(tb.radius, 999) : s.btnR != null ? s.btnR : null;
  set('--btn-r', radius != null ? (radius >= 999 ? '999px' : radius + 'px') : null);
  set('--btn-shadow', tb ? (tb.shadow || 'none') : s.btnShadow || null);
  set('--btn-w', tb ? tb.weight : s.arch === 'bold' || s.arch === 'brutalist' ? 800 : null);
  set('--btn-tt', tb && tb.transform && tb.transform !== 'none' ? tb.transform : s.caps ? 'uppercase' : null);
  set('--btn-ls', tb && tb.ls && tb.ls !== 'normal' ? tb.ls : null);
  set('--btn-bw', tb && tb.bw ? tb.bw + 'px' : s.bw > 1 ? s.bw + 'px' : null);
  set('--app-r', s.r != null ? Math.min(Math.max(s.r, 2), 24) + 'px' : null);
  // fonts: generated styles from Google Fonts; imported designs bring their own files
  let faces = $('appFaces'); if (!faces) { faces = document.createElement('div'); faces.id = 'appFaces'; faces.hidden = true; document.head.appendChild(faces); }
  if (T) {
    const html = (T.fontLinks || []).map(l => `<link rel="stylesheet" href="${esc(l)}">`).join('') + (T.faces ? `<style>${T.faces}</style>` : '');
    if (faces.dataset.k !== T.name) { faces.innerHTML = html; faces.dataset.k = T.name; }
    set('--font-d', T.headFont ? `${T.headFont}, Georgia, serif` : null); set('--font-b', T.bodyFont ? `${T.bodyFont}, Inter, system-ui, sans-serif` : null);
    set('--head-w', T.headWeight || null); set('--head-ls', T.headLs ? T.headLs + 'em' : null); set('--head-tt', T.headCaps ? 'uppercase' : null);
  } else {
    faces.innerHTML = ''; faces.dataset.k = '';
    if (s.font && s.font.d) {
      let l = $('appFonts'); if (!l) { l = document.createElement('link'); l.id = 'appFonts'; l.rel = 'stylesheet'; document.head.appendChild(l); }
      const href = fontLink([s.font.d, s.font.b]); if (l.href !== href) l.href = href;
    }
    const d = familyOf(s, 'd'), b = familyOf(s, 'b');
    set('--font-b', b ? `'${b}', Inter, system-ui, sans-serif` : null); set('--font-d', d ? `'${d}', Georgia, serif` : null);
    set('--head-w', s.dw || null); set('--head-ls', s.dls && s.dls !== '0em' ? s.dls : null); set('--head-tt', s.caps ? 'uppercase' : null);
  }
  // motion: the design's own timing and hover feel, or the style family's
  const M = (T && T.motion) || ARCH_MOTION[s.arch] || {};
  set('--ease', M.ease || null); set('--dur', M.dur ? Math.max(80, Math.min(700, M.dur)) + 'ms' : null);
  body.classList.remove('mo-lift', 'mo-grow', 'mo-glow', 'mo-color'); if (M.hover) body.classList.add('mo-' + M.hover);
  body.classList.add('wearing');
  // feel the change: the app settles into the new look
  if (worn !== s.id) { worn = s.id; body.classList.remove('restyle'); void body.offsetWidth; body.classList.add('restyle'); clearTimeout(wearStyle.t); wearStyle.t = setTimeout(() => body.classList.remove('restyle'), 900); }
  updateLookBtn(s);
}
function updateLookBtn(s) {
  const b = $('lookBtn'); if (!b) return;
  b.hidden = !(B.project && (state.view === 'studio'));
  b.classList.toggle('on', APP_LOOK.on);
  b.title = APP_LOOK.on ? 'Reskin is wearing your style — click for Reskin’s own look' : 'Let Reskin wear your page’s style';
}
// previews (the full-page modal) dress the app too
{
  const om = openModal, cm = closeModal;
  openModal = function (s) { om.apply(this, arguments); wearStyle(s); };
  closeModal = function () { cm.apply(this, arguments); wearStyle(state.view === 'studio' && B.project ? B.project.style : null); };
}

/* ---- "How it moves": what the imported design animates, and how it's built ---- */
const MOTION_ICON = { 'split-letters': 'Aa', 'split-words': 'Ab', typewriter: '▍', scramble: '#', marquee: '⇢', 'fade-up': '↑', 'blur-in': '◌', wipe: '▧', spin: '↻', flow: '≈', pulse: '◉', zoom: '⤢', fade: '◐', reveal: '⇣', canvas: '▦', pointer: '⌖', hover: '☝', smooth: '〰', blink: '▮', custom: '✦' };
const REPLAY = { 'split-letters': 'Your heading is re-split letter by letter with the same timing.', 'split-words': 'Your heading is re-split word by word with the same timing.',
  typewriter: 'Your title types itself out the same way.', scramble: 'Your title scrambles and settles the same way.', hover: 'Reskin’s own buttons now react like this too.' };
function showMotion() {
  const T = state.tgt && state.tgt.tokens, M = T && T.motion;
  let g = $('motionSheet');
  if (!g) { g = document.createElement('div'); g.id = 'motionSheet'; g.className = 'gear'; document.body.appendChild(g); g.addEventListener('click', e => { if (e.target === g || e.target.closest('[data-x]')) g.hidden = true; }); }
  g.hidden = false;
  const items = (M && M.items) || [];
  g.innerHTML = `<div class="gear-box"><div class="gear-h"><h3>How “${esc(T ? T.name : 'this design')}” moves</h3><button class="icon" data-x title="Close">✕</button></div>
    <div class="gear-body mo-body">
      ${items.length ? `<p class="found">Reskin watched the design while it loaded and read its stylesheets and scripts. Here’s what moves, and how it’s made:</p>
      ${items.map(it => `<div class="mo-item"><i>${MOTION_ICON[it.kind] || '✦'}</i><div><b>${esc(it.title)}</b><span>${esc(it.how)}</span>${REPLAY[it.kind] ? `<em>✓ ${esc(REPLAY[it.kind])}</em>` : ''}</div><small class="mo-tech ${it.tech}">${it.tech === 'js' ? 'JavaScript' : 'CSS'}</small></div>`).join('')}`
      : `<p class="found">${M ? 'Nothing moves on its own in this design: it’s a still page.' : 'Load the design again to read its motion (designs sampled before this update don’t have it).'}</p>`}
      ${M && (M.libs || []).length ? `<h4>Built with</h4><div class="mo-libs">${M.libs.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}
      ${M && (M.ease || M.dur) ? `<h4>Its timing</h4><p class="found">${M.dur ? `Buttons and links change in about <b>${M.dur} ms</b>` : ''}${M.ease ? ` with <code>${esc(M.ease)}</code> easing` : ''}. Reskin’s own buttons, hovers and transitions now use the same rhythm.</p>` : ''}
    </div></div>`;
}
// Explore's design card gets the button too, once the design has been read
{
  const rt = renderTargetCard;
  renderTargetCard = function () {
    rt.apply(this, arguments);
    const T = state.tgt && state.tgt.tokens; if (!T || !T.motion) return;
    const body = $('tgtBody'); if (!body || body.querySelector('.mo-open')) return;
    const n = (T.motion.items || []).length, b = document.createElement('button');
    b.className = 'ghost mo-open'; b.textContent = n ? `✦ How it moves (${n})` : '✦ How it moves'; b.onclick = showMotion;
    body.appendChild(b);
  };
}

/* ---- component settings: read a React component's props from its code, and let people set them ---- */
const SKIP_PROPS = /^(className|style|children|ref|key|as|asChild|on[A-Z]\w*)$/;
const IMAGE_PROP = /(image|img|src|photo|picture|avatar|logo|cover|poster|thumbnail|background(image)?|bg(image)?)$/i;
function matchBrace(code, i) {   // index of the brace that closes the one at i (skips strings)
  let d = 0, q = null;
  for (let k = i; k < code.length; k++) {
    const ch = code[k];
    if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') q = ch;
    else if (ch === '{' || ch === '(' || ch === '[') d++;
    else if (ch === '}' || ch === ')' || ch === ']') { d--; if (!d) return k; }
  }
  return -1;
}
function splitTop(str) {   // split on commas that aren't inside brackets or strings
  const out = []; let d = 0, q = null, cur = '';
  for (let k = 0; k < str.length; k++) {
    const ch = str[k];
    if (q) { cur += ch; if (ch === '\\') { cur += str[++k] || ''; } else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') q = ch;
    if ('{([' .includes(ch)) d++; if ('})]'.includes(ch)) d--;
    if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
function literal(v) {
  v = v.trim();
  if (/^(['"`])[\s\S]*\1$/.test(v) && !/\$\{/.test(v)) return { t: 'string', v: v.slice(1, -1) };
  if (/^-?\d*\.?\d+(e-?\d+)?$/i.test(v)) return { t: 'number', v: +v };
  if (v === 'true' || v === 'false') return { t: 'boolean', v: v === 'true' };
  return null;
}
function parseProps(c) {
  if (c.kind !== 'tsx') return null;
  if (c._pp && c._pp.code === c.code) return c._pp.res;
  const code = splitBundle(c.code).js;
  // every component that takes destructured props; the one with the most props is "the" component
  const found = [];
  const re = /(?:export\s+(?:default\s+)?)?(?:function\s+([A-Z]\w*)\s*\(|const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:React\.)?(?:forwardRef\s*\(\s*)?(?:memo\s*\(\s*)?\(?)\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    const name = m[1] || m[2], open = re.lastIndex - 1, close = matchBrace(code, open);
    if (close < 0) continue;
    const props = [];
    splitTop(code.slice(open + 1, close)).forEach(part => {
      if (part.startsWith('...')) return;
      const mm = /^([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z_$][\w$]*)?\s*(?:=\s*([\s\S]+))?$/.exec(part);
      if (!mm || SKIP_PROPS.test(mm[1])) return;
      props.push({ name: mm[1], def: mm[2] != null ? literal(mm[2]) : null, raw: mm[2] });
    });
    if (props.length) found.push({ name, props });
  }
  if (!found.length) { c._pp = { code: c.code, res: null }; return null; }
  const main = found.sort((a, b) => b.props.length - a.props.length)[0];
  // what the component itself tells us about each prop
  const arrays = [...code.matchAll(/const\s+\w+\s*=\s*\[([^\]]*)\]/g)].map(x => [...x[1].matchAll(/['"]([^'"]+)['"]/g)].map(y => y[1])).filter(x => x.length > 1);
  const seed = {};
  const use = new RegExp('<' + main.name + '\\b([^>]*)>', 'g'); let u;
  while ((u = use.exec(code))) for (const a of u[1].matchAll(/(\w+)=(?:"([^"]*)"|'([^']*)'|\{(-?[\d.]+|true|false|"[^"]*"|'[^']*')\})/g)) {
    const val = a[2] ?? a[3] ?? a[4]; if (val == null) continue;
    seed[a[1]] = a[4] != null ? (literal(a[4]) || { v: val }).v : val;
  }
  const fields = main.props.map(pr => {
    const n = pr.name, d = pr.def, f = { name: n, label: n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, x => x.toUpperCase()), def: d ? d.v : undefined };
    const union = new RegExp('\\b' + n + '\\??\\s*:\\s*((?:[\'"][^\'"]+[\'"]\\s*\\|\\s*)+[\'"][^\'"]+[\'"])').exec(code);
    const cl = new RegExp('clamp\\(\\s*' + n + '\\s*,\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)').exec(code);
    if (union) { f.type = 'select'; f.options = [...union[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]); }
    else if (d && d.t === 'string' && arrays.some(a => a.includes(d.v))) { f.type = 'select'; f.options = arrays.find(a => a.includes(d.v)); }
    else if (d && d.t === 'boolean') f.type = 'toggle';
    else if (d && d.t === 'number') {
      f.type = 'range';
      if (cl) { f.min = +cl[1]; f.max = +cl[2]; }
      else if (d.v >= 0 && d.v <= 1 && !Number.isInteger(d.v)) { f.min = 0; f.max = 1; }
      else { f.min = 0; f.max = Math.max(10, Math.ceil(Math.abs(d.v) * 3)); }
      f.step = f.max - f.min <= 2 ? 0.01 : f.max - f.min <= 20 && !Number.isInteger(d.v) ? 0.1 : 1;
    }
    else if (IMAGE_PROP.test(n)) f.type = 'image';
    else if (/colou?r$/i.test(n) || (d && d.t === 'string' && /^(#[0-9a-f]{3,8}|rgb|hsl)/i.test(d.v))) f.type = 'color';
    else if (!d || d.t === 'string') f.type = 'text';
    else return null;
    return f;
  }).filter(Boolean);
  const res = { main: main.name, fields, seed };
  c._pp = { code: c.code, res };
  return res;
}
// the props a component shows with: what its own code passes in its demo, then its Library settings, then this placement's
function mountFor(c, extra) {
  const P = parseProps(c); if (!P || !P.fields.length) return null;
  const props = { ...P.seed, ...(c.props || {}), ...(extra || {}) };
  return Object.keys(props).length ? { name: P.main, props } : null;
}
// owner: null → the component's own settings (Library); otherwise a placement (a tile edit or an added block)
function renderPropsPanel(box, c, owner, onChange) {
  const P = parseProps(c);
  if (!P || !P.fields.length) { box.innerHTML = '<p class="st-muted">This component has no settings Reskin can read.</p>'; return; }
  const base = { ...P.seed, ...(owner ? c.props || {} : {}) }, mine = owner ? (owner.props || (owner.props = {})) : (c.props || (c.props = {}));
  const val = f => f.name in mine ? mine[f.name] : f.name in base ? base[f.name] : f.def;
  const pool = state.model ? [...state.model.images, ...state.extraImgs].slice(0, 12) : [];
  box.innerHTML = `<div class="pp">${P.fields.map(f => {
    const v = val(f), id = 'pp_' + f.name, changed = f.name in mine;
    let ctl = '';
    if (f.type === 'select') ctl = `<select id="${id}">${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'toggle') ctl = `<label class="pp-tog"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}><span></span></label>`;
    else if (f.type === 'range') ctl = `<input type="range" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v ?? f.min}"><output>${v ?? ''}</output>`;
    else if (f.type === 'color') ctl = `<input type="color" id="${id}" value="${toHex(v || '#000000')}"><code>${esc(v || '')}</code>`;
    else if (f.type === 'image') ctl = `<div class="pp-img">${v ? `<img src="${esc(v)}" alt="">` : '<i>No picture</i>'}
        <div class="pp-img-acts"><button class="ghost" data-up="${f.name}">Upload…</button><button class="ghost" data-url="${f.name}">Link…</button>${v ? `<button class="ghost" data-clr="${f.name}">✕</button>` : ''}</div>
        ${pool.length ? `<div class="pp-pool">${pool.map((im, i) => `<button title="${esc(im.alt || 'From your site')}" data-pool="${f.name}" data-i="${i}" style="background-image:url('${cssUrl(resolveSrc(im.src))}')"></button>`).join('')}</div>` : ''}</div>`;
    else ctl = `<input type="text" id="${id}" value="${esc(v ?? '')}">`;
    return `<div class="pp-row ${f.type}"><span class="pp-name">${esc(f.label)}${changed ? ' <em title="Changed here">•</em>' : ''}</span><div class="pp-ctl">${ctl}</div></div>`;
  }).join('')}
    <button class="ghost pp-reset" id="ppReset">Reset to the component’s own settings</button></div>`;
  let t = null;
  const commit = (name, value, now) => {
    mine[name] = value;
    clearTimeout(t); t = setTimeout(() => { saveIt(); onChange(); }, now ? 0 : 350);
  };
  const saveIt = () => { if (owner) saveProject(); else comps.save(); };
  P.fields.forEach(f => {
    const el = $('pp_' + f.name); if (!el) return;
    if (f.type === 'range') el.oninput = () => { el.nextElementSibling.textContent = el.value; commit(f.name, +el.value); };
    else if (f.type === 'toggle') el.onchange = () => commit(f.name, el.checked, true);
    else if (f.type === 'color') el.oninput = () => { el.nextElementSibling.textContent = el.value; commit(f.name, el.value); };
    else el.onchange = () => commit(f.name, el.value, true);
  });
  const redraw = () => renderPropsPanel(box, c, owner, onChange);
  box.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async () => { const f = i.files[0]; if (!f) return; if (f.size > 4e6) return toast('Pick a picture under 4 MB'); mine[b.dataset.up] = await readDataUrl(f); saveIt(); onChange(); redraw(); };
    i.click();
  });
  box.querySelectorAll('[data-url]').forEach(b => b.onclick = () => { const u = prompt('Picture address (https://…)'); if (u && /^https?:\/\//.test(u.trim())) { mine[b.dataset.url] = u.trim(); saveIt(); onChange(); redraw(); } });
  box.querySelectorAll('[data-clr]').forEach(b => b.onclick = () => { mine[b.dataset.clr] = ''; saveIt(); onChange(); redraw(); });
  box.querySelectorAll('[data-pool]').forEach(b => b.onclick = () => { mine[b.dataset.pool] = resolveSrc(pool[+b.dataset.i].src); saveIt(); onChange(); redraw(); });
  $('ppReset').onclick = () => { Object.keys(mine).forEach(k => delete mine[k]); saveIt(); onChange(); redraw(); };
}

/* ------------------------------------------------------------------ 5. grab a part of a page as a component */
// runs inside the page you opened: hover to see parts, click to choose, then it can copy that part with its look
function __rkGrab() {
  var sel = null, hov = null;
  var st = document.createElement('style');
  st.textContent = '[data-rkg-hov]{outline:2px dashed #ff5b37!important;outline-offset:2px;cursor:crosshair!important}[data-rkg-sel]{outline:3px solid #ff5b37!important;outline-offset:2px}';
  document.head.appendChild(st);
  function label(el) { var t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('alt') || '').trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 40); return t || el.tagName.toLowerCase(); }
  function info() { var r = sel.getBoundingClientRect(); parent.postMessage({ rkGrabSel: { label: label(sel), tag: sel.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), kids: sel.children.length } }, '*'); }
  function choose(el) { if (sel) sel.removeAttribute('data-rkg-sel'); sel = el; if (sel) { sel.setAttribute('data-rkg-sel', ''); info(); } }
  document.addEventListener('mouseover', function (e) { if (hov) hov.removeAttribute('data-rkg-hov'); hov = e.target; if (hov !== document.body && hov !== document.documentElement) hov.setAttribute('data-rkg-hov', ''); }, true);
  document.addEventListener('click', function (e) { if (e.altKey) return; e.preventDefault(); e.stopPropagation(); var t = e.target; var c = t.closest('button,a,[role=button]'); choose(c && c.contains(t) && c.getBoundingClientRect().width < innerWidth * 0.6 ? c : t); }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  // copy the chosen part: its HTML with every element's computed look written onto it,
  // plus the fonts, keyframes and ::before/::after it needs, so it looks the same anywhere
  var PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'outline', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration', 'text-shadow', 'white-space', 'word-spacing',
    'box-shadow', 'opacity', 'transform', 'transform-origin', 'transition', 'animation', 'filter', 'backdrop-filter', 'mix-blend-mode', 'overflow', 'cursor', 'object-fit', 'object-position', 'aspect-ratio', 'vertical-align',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'align-content', 'gap', 'row-gap', 'column-gap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow', 'fill', 'stroke', 'stroke-width', 'list-style', 'clip-path', 'mask-image', '-webkit-mask-image', 'content'];
  var SIZED = /^(IMG|SVG|VIDEO|CANVAS|PICTURE|IFRAME|INPUT|svg)$/;
  var defs = {};
  function defaults(tag) {
    if (defs[tag]) return defs[tag];
    var box = document.createElement('div'); box.style.cssText = 'all:initial;position:absolute;left:-9999px;top:0';
    var el = document.createElement(tag); box.appendChild(el); document.body.appendChild(box);
    var cs = getComputedStyle(el), d = {}; PROPS.forEach(function (p) { d[p] = cs.getPropertyValue(p); });
    box.remove(); return (defs[tag] = d);
  }
  function styleText(el, isRoot) {
    var cs = getComputedStyle(el), d = defaults(el.tagName.toLowerCase()), out = [];
    PROPS.forEach(function (p) {
      if (p === 'content') return;
      var v = cs.getPropertyValue(p); if (!v || v === d[p]) return;
      if (isRoot && /^(margin|top|right|bottom|left|position|z-index|grid-|order|align-self|flex-grow|flex-shrink|flex-basis)/.test(p)) return;
      if ((p === 'width' || p === 'height' || /^(min|max)-/.test(p)) && !SIZED.test(el.tagName) && !(isRoot && el.children.length === 0)) {
        if (!(p === 'width' && isRoot && /inline|flex|grid/.test(cs.display) === false)) return;
      }
      out.push(p + ':' + v);
    });
    return out.join(';');
  }
  var pseudo = [], n = 0, fams = {}, anims = {};
  function walk(src, dst, isRoot) {
    var cs = getComputedStyle(src);
    fams[cs.fontFamily] = 1; if (cs.animationName && cs.animationName !== 'none') cs.animationName.split(',').forEach(function (a) { anims[a.trim()] = 1; });
    if (dst.nodeType === 1) {
      dst.removeAttribute('data-rkg-sel'); dst.removeAttribute('data-rkg-hov');
      dst.setAttribute('style', styleText(src, isRoot));
      ['::before', '::after'].forEach(function (ps) {
        var p = getComputedStyle(src, ps); if (!p.content || p.content === 'none' || p.content === 'normal') return;
        var cls = 'rkg' + (++n); dst.classList.add(cls);
        var rules = []; PROPS.forEach(function (k) { var v = p.getPropertyValue(k); if (v && v !== 'auto' && v !== 'none' && v !== 'normal' && v !== '0px') rules.push(k + ':' + v); });
        rules.push('content:' + p.content); pseudo.push('.' + cls + ps + '{' + rules.join(';') + '}');
      });
    }
    for (var i = 0, a = src.children, b = dst.children; i < a.length; i++) if (b[i]) walk(a[i], b[i], false);
  }
  function sheetsText(test) {
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rs; try { rs = document.styleSheets[i].cssRules; } catch (e) { continue; }
      for (var j = 0; j < (rs ? rs.length : 0); j++) if (test(rs[j])) out.push(rs[j].cssText);
    }
    return out.join('\n');
  }
  function bgBehind(el) { for (var x = el; x; x = x.parentElement) { var c = getComputedStyle(x).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return '#fff'; }
  function take() {
    if (!sel) return;
    if (hov) hov.removeAttribute('data-rkg-hov');
    sel.removeAttribute('data-rkg-sel');   // our highlight must not be copied as part of its look
    var clone = sel.cloneNode(true); pseudo = []; fams = {}; anims = {};
    walk(sel, clone, true);
    sel.setAttribute('data-rkg-sel', '');
    clone.querySelectorAll('script').forEach(function (s) { s.remove(); });
    var faces = sheetsText(function (r) { return r.type === 5; });                                     // @font-face
    var keys = sheetsText(function (r) { return r.type === 7 && anims[r.name]; });                       // @keyframes it uses
    var links = Array.prototype.map.call(document.querySelectorAll('link[rel=stylesheet][href*="fonts.googleapis"]'), function (l) { return l.outerHTML; }).join('');
    var html = '<!doctype html><html><head><meta charset="utf-8">' + links + '<style>' + faces + '\n' + keys + '\n' + pseudo.join('\n') +
      '\nhtml,body{margin:0}body{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:' + bgBehind(sel.parentElement) + '}</style></head><body>' + clone.outerHTML + '</body></html>';
    parent.postMessage({ rkGrabbed: { html: html, label: label(sel) } }, '*');
  }
  addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.rkGrabCmd === 'up' && sel && sel.parentElement && sel.parentElement !== document.body) choose(sel.parentElement);
    if (d.rkGrabCmd === 'down' && sel && sel.firstElementChild) choose(sel.firstElementChild);
    if (d.rkGrabCmd === 'take') take();
  });
}
const GRAB = { name: '', sel: null };
function pickTemplateFiles() {
  const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.html,.htm,.css,.js,image/*,font/*,.woff,.woff2,.ttf,.otf,.svg,.avif,.webp';
  i.onchange = () => i.files.length && openGrab([...i.files]);
  i.click();
  toast('Pick the saved page — and its _files folder contents too, so images load', 4000);
}
async function openGrab(files) {
  const { main, assets } = splitFiles(files);
  if (!main || !/\.html?$/i.test(main.name)) { toast('Choose a saved page (.htm / .html)'); return; }
  busy('Opening the page…');
  let html;
  try { const prep = await prepareHtml(await main.text(), assets); html = prep.html; if (prep.missing && prep.missing.length) toast(`${prep.missing.length} file(s) from its _files folder weren’t included — some images may be missing`, 4500); }
  finally { busy(null); }
  GRAB.name = main.name.replace(/\.[^.]+$/, ''); GRAB.sel = null;
  let g = $('grabSheet');
  if (!g) { g = document.createElement('div'); g.id = 'grabSheet'; g.className = 'grab'; document.body.appendChild(g); }
  g.hidden = false;
  g.innerHTML = `<div class="grab-bar">
      <div><b>Grab from “${esc(GRAB.name)}”</b><span class="found" id="grabInfo">Click the part you want — a button, a card, a menu… (Alt-click uses the page normally)</span></div>
      <div class="bx-row"><button class="ghost" id="grabUp" disabled title="Choose the part around it">⬆ Bigger</button><button class="ghost" id="grabDown" disabled title="Choose the part inside it">⬇ Smaller</button>
        <input id="grabName" placeholder="Name" style="font:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:6px 9px;width:170px;background:var(--panel);color:var(--ink)">
        <button class="primary" id="grabTake" disabled style="height:36px;padding:0 14px;font-size:13.5px">Save as component</button>
        <button class="icon" id="grabX" title="Close (Esc)">✕</button></div></div>
    <div class="grab-stage"><iframe id="grabFrame" sandbox="allow-scripts" title="Page to grab from"></iframe></div>`;
  $('grabFrame').srcdoc = injectEnd(html, `<script>(${__rkGrab})();<\/script>`);
  $('grabX').onclick = closeGrab;
  $('grabUp').onclick = () => $('grabFrame').contentWindow.postMessage({ rkGrabCmd: 'up' }, '*');
  $('grabDown').onclick = () => $('grabFrame').contentWindow.postMessage({ rkGrabCmd: 'down' }, '*');
  $('grabTake').onclick = () => { $('grabTake').disabled = true; $('grabTake').innerHTML = '<span class="spin"></span>Copying…'; $('grabFrame').contentWindow.postMessage({ rkGrabCmd: 'take' }, '*'); };
}
function closeGrab() { const g = $('grabSheet'); if (g && !g.hidden) { g.hidden = true; g.innerHTML = ''; } }
addEventListener('message', e => {
  const d = e.data || {}, f = $('grabFrame');
  if (!f || e.source !== f.contentWindow) return;
  if (d.rkGrabSel) {
    const s = GRAB.sel = d.rkGrabSel;
    $('grabInfo').textContent = `Chosen: ${s.label} — a ${s.tag}, ${s.w}×${s.h}px. Bigger / Smaller to adjust.`;
    ['grabUp', 'grabDown', 'grabTake'].forEach(id => { $(id).disabled = false; });
    if (!$('grabName').value || $('grabName').dataset.auto) { $('grabName').value = titleCase(s.label).slice(0, 40); $('grabName').dataset.auto = '1'; }
  }
  if (d.rkGrabbed) {
    const name = ($('grabName').value || d.rkGrabbed.label || 'Grabbed part').trim();
    comps.list.unshift({ id: newId(), collection: `From ${GRAB.name}`.slice(0, 40), created: Date.now(), name, source: 'grabbed', kind: 'html', code: d.rkGrabbed.html });
    comps.save();
    closeGrab();
    toast(`Saved “${name}” to your Library`);
    LIB.filter = 'components'; comps.filter = 'All';
    if (state.view === 'library') renderLibrary(); else setView('library');
  }
});

/* ------------------------------------------------------------------ 6. icon packs: a .zip of SVGs */
async function unzipText(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer), out = [];
  let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('That isn’t a zip file');
  let p = dv.getUint32(e + 16, true); const count = dv.getUint16(e + 10, true);
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!/\.svg$/i.test(name)) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = buf.subarray(start, start + csize);
    let data = raw;
    if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else if (method !== 0) continue;
    out.push({ name: name.split('/').pop(), text: new TextDecoder().decode(data) });
  }
  return out;
}
async function importIconZip(file) {
  try {
    busy('Reading icons…');
    const files = await unzipText(file);
    if (!files.length) { toast('No SVG files in that zip'); return; }
    const coll = 'Icons · ' + file.name.replace(/\.zip$/i, '').slice(0, 30), seen = new Set(comps.list.filter(c => c.icon).map(c => c.svg));
    let n = 0;
    files.forEach(f => {
      const svg = f.text.replace(/<\?xml[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/gi, '').trim();
      if (!/^<svg/i.test(svg) || seen.has(svg)) return; seen.add(svg);
      const label = (/aria-label="([^"]+)"/.exec(svg) || [])[1] || f.name.replace(/\.svg$/i, '');
      comps.list.push({ id: newId(), collection: coll, created: Date.now(), name: titleCase(label), source: 'icon', kind: 'html', icon: true, svg,
        code: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{min-height:100vh;display:grid;place-items:center;color:#151413}svg{width:64px;height:auto;max-height:64px}</style></head><body>${svg}</body></html>` });
      n++;
    });
    comps.save();
    LIB.filter = 'components'; comps.filter = coll;
    toast(`Added ${n} icons to “${coll}”`);
    renderLibrary();
  } catch (e) { toast(e.message || 'Couldn’t read that zip', 4000); }
  finally { busy(null); }
}

/* ------------------------------------------------------------------ 7. right-click menu (Studio canvas) */
function closeCtx() { const m = $('ctxMenu'); if (m) m.remove(); }
function openCtx(x, y, items) {
  closeCtx();
  const m = document.createElement('div'); m.id = 'ctxMenu'; m.className = 'ctx';
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" ${it.danger ? 'class="danger"' : ''}><i>${it.icon || ''}</i>${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { closeCtx(); items[+b.dataset.i].run(); });
  setTimeout(() => addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { closeCtx(); removeEventListener('mousedown', off); } }), 0);
}

/* ------------------------------------------------------------------ 8. Reskin's own colour picker */
// Every <input type="color"> in the app opens this instead of the operating system's dialog. It sets the input's
// value and fires the usual input / change events, so the panels that use colour inputs don't need to know.
const CP = { el: null, input: null, start: null };
const hexOf = rgb => '#' + rgb.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
function hsvToRgb(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5) * 255, f(3) * 255, f(1) * 255]; }
function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
function pageSwatches() {
  const out = [], add = c => { try { const h = hexOf(Array.isArray(c) ? c : cssToRgb(c)); if (!out.includes(h)) out.push(h); } catch {} };
  const st = B.project && B.project.style;
  if (st && st.pal) { const p = (typeof withOverrides === 'function' ? withOverrides(st) : st).pal; ['accent', 'text', 'bg', 'surface', 'card', 'muted', 'border', 'accentText'].forEach(k => p[k] && !/gradient/.test(p[k]) && add(p[k])); }
  const T = state.tgt && state.tgt.tokens;
  if (T) { [T.accent, T.text, T.bg, T.surface, ...(T.palette || [])].filter(Boolean).forEach(add); }
  if (brandColor()) add(brandColor());
  return out.slice(0, 16);
}
function closeColorPop(commit = true) {
  if (!CP.el) return;
  const input = CP.input, changed = input && input.value !== CP.start;
  CP.el.remove(); CP.el = null; CP.input = null;
  if (commit && changed) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const r = store.get('reskin.recentColors', []).filter(c => c !== input.value); r.unshift(input.value); store.set('reskin.recentColors', r.slice(0, 8));
  }
}
function openColorPop(input) {
  closeColorPop();
  CP.input = input; CP.start = input.value;
  let [h, sa, v] = rgbToHsv(cssToRgb(input.value || '#000000'));
  const pop = CP.el = document.createElement('div'); pop.className = 'cpop';
  const sw = (list, title) => list.length ? `<div class="cp-sec"><b>${title}</b><div class="cp-sw">${list.map(c => `<button type="button" data-c="${c}" title="${c}" style="--c:${c}"></button>`).join('')}</div></div>` : '';
  pop.innerHTML = `${sw(pageSwatches(), 'On your page')}${sw(store.get('reskin.recentColors', []), 'Recent')}
    <div class="cp-sv"><i class="cp-knob"></i></div>
    <input class="cp-hue" type="range" min="0" max="360" step="1" aria-label="Hue">
    <div class="cp-row"><span class="cp-now"></span><input class="cp-hex" spellcheck="false" maxlength="7" aria-label="Hex colour">
      ${window.EyeDropper ? '<button type="button" class="ghost cp-drop" title="Pick a colour from the screen">⌖</button>' : ''}
      <button type="button" class="primary cp-ok">Done</button></div>`;
  document.body.appendChild(pop);
  const q = sel => pop.querySelector(sel), sv = q('.cp-sv'), knob = q('.cp-knob'), hue = q('.cp-hue'), hex = q('.cp-hex'), now = q('.cp-now');
  const paint = (fire = true) => {
    const c = hexOf(hsvToRgb(h, sa, v));
    sv.style.setProperty('--hue', `hsl(${h} 100% 50%)`); knob.style.left = sa * 100 + '%'; knob.style.top = (1 - v) * 100 + '%';
    hue.value = h; now.style.background = c; if (document.activeElement !== hex) hex.value = c;
    if (fire && input.value !== c) { input.value = c; input.dispatchEvent(new Event('input', { bubbles: true })); }
  };
  const setHex = c => { try { [h, sa, v] = rgbToHsv(cssToRgb(c)); paint(); } catch {} };
  sv.addEventListener('pointerdown', e => {
    sv.setPointerCapture(e.pointerId);
    const move = ev => { const r = sv.getBoundingClientRect(); sa = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); v = 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)); paint(); };
    move(e); sv.onpointermove = move; sv.onpointerup = () => { sv.onpointermove = null; };
  });
  hue.oninput = () => { h = +hue.value; paint(); };
  hex.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(hex.value.trim())) setHex(hex.value.trim()); };
  hex.onkeydown = e => { if (e.key === 'Enter') closeColorPop(); };
  pop.querySelectorAll('[data-c]').forEach(b => b.onclick = () => setHex(b.dataset.c));
  if (q('.cp-drop')) q('.cp-drop').onclick = async () => { try { const r = await new EyeDropper().open(); setHex(r.sRGBHex); } catch {} };
  q('.cp-ok').onclick = () => closeColorPop();
  paint(false);
  // place it by the colour box, inside the window
  const r = input.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  let left = Math.min(r.left, innerWidth - pr.width - 10), top = r.bottom + 8;
  if (top + pr.height > innerHeight - 10) top = Math.max(10, r.top - pr.height - 8);
  pop.style.left = Math.max(10, left) + 'px'; pop.style.top = top + 'px';
  setTimeout(() => addEventListener('pointerdown', function off(e) { if (!CP.el) return removeEventListener('pointerdown', off, true); if (!CP.el.contains(e.target) && e.target !== input) { removeEventListener('pointerdown', off, true); closeColorPop(); } }, true), 0);
}
document.addEventListener('click', e => { const i = e.target.closest && e.target.closest('input[type=color]'); if (!i) return; e.preventDefault(); if (CP.input === i) closeColorPop(); else openColorPop(i); }, true);
document.addEventListener('keydown', e => {
  const i = e.target.closest && e.target.closest('input[type=color]');
  if (i && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openColorPop(i); }
  if (e.key === 'Escape' && CP.el) { const inp = CP.input, start = CP.start; closeColorPop(false); if (inp && inp.value !== start) { inp.value = start; inp.dispatchEvent(new Event('input', { bubbles: true })); } }
}, true);

/* ------------------------------------------------------------------ start */
(function boot() {
  document.querySelector('.intro').hidden = false;
  $('results').hidden = true;
  updateSavedCount();
  const lb = $('lookBtn');
  if (lb) lb.onclick = () => { APP_LOOK.on = !APP_LOOK.on; store.set('reskin.wear', APP_LOOK.on); wearStyle(B.project && state.view === 'studio' ? B.project.style : null); };
  // a project already exists: Studio is home
  const id = store.get('reskin.currentProject', null), p = store.get('reskin.projects', []).find(x => x.id === id);
  if (p && p.srcText) {
    $('src').value = p.srcText; state.srcName = p.srcName || ''; state.srcKey = null;
    setView('studio');
  }
})();
