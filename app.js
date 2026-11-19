/* Reskin app UI: Explore, Saved, Advanced, Components. Needs engine.js. */
/* =========================================================
   6. APP
   ========================================================= */
const $ = id => document.getElementById(id);
const VIEWS = {};   // extra tabs (builder.js registers Component + Build)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const state = {
  model: null, srcKey: null, srcName: '', srcAssets: new Map(), base: '',
  tgt: null,  // { name, text, kind, assets, tokens, viewHtml, missing, error }
  styles: [], mood: 'all', view: 'all', varOf: null, saved: store.get('reskin.saved', []), current: null,
  srcTokens: null,  // measured look of the user's own site (brand colour, font) — used by animated remixes
  srcPrep: null, themeColor: null, autoBrand: null,
  palette: null,    // Advanced tab: chosen palette { name, accent, bg?, text? }
  heroType: 'auto', // Advanced tab: center | left | split | big
  assign: {},       // Advanced tab: which image goes where (logo / hero / cards / galleries)
  extraImgs: [],    // images the user added in the Advanced tab
  pickIdx: null, advStyle: null,
};

/* the content model with the Advanced-tab image choices applied */
function viewModel() {
  const m = state.model, A = state.assign;
  if (!m || !Object.keys(A).length) return m;
  const v = structuredClone(m);
  if ('logo' in A) v.logo = A.logo;
  if (A.hideName) v.hideName = true;
  if ('hero' in A) v.hero.img = A.hero;
  for (const k in A.cards || {}) { const [si, ci] = k.split(':').map(Number); if (v.sections[si] && v.sections[si].cards[ci]) v.sections[si].cards[ci].img = A.cards[k]; }
  for (const k in A.gal || {}) { const s = v.sections[k]; if (s) { s.imgs = A.gal[k]; if (s.kind === 'cta' && s.imgs.length) s.kind = 'text'; } }
  return v;
}

function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function busy(msg) {
  const b = $('gen');
  if (msg) { b.disabled = true; b.innerHTML = `<span class="spin"></span>${esc(msg)}`; }
  else { b.disabled = false; b.innerHTML = 'Generate styles <span>→</span>'; }
}
function shakeSrc() { const c = $('srcCard'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }

/* ---- source (my site) ---- */
const wrapRendered = res => `<!doctype html><html><head><title>${esc(res.title || '')}</title></head><body>${res.html}</body></html>`;
async function loadSource() {
  const text = $('src').value.trim();
  if (!text) { shakeSrc(); toast('Paste or drop your site first'); return false; }
  const key = text.length + '|' + text.slice(0, 200) + '|' + text.slice(-200) + '|' + state.srcAssets.size;
  if (state.srcKey === key && state.model) return true;
  const kind = detectKind(text, state.srcName);
  let html;
  state.srcTokens = null; state.srcPrep = null;
  if (kind === 'tsx') {
    busy('Rendering your component…');
    const res = await runSandbox(id => tsxDoc(text, id));
    html = wrapRendered(res); state.srcTokens = res.tokens;
  } else {
    const prep = await prepareHtml(text, state.srcAssets);
    html = prep.html; state.srcPrep = prep.html;
    if (prep.runScripts) { busy('Running your page…'); const res = await runSandbox(id => withProbe(prep.html, id)); html = wrapRendered(res); state.srcTokens = res.tokens; }
  }
  state.model = extract(html);
  state.srcKey = key;
  state.assign = {}; state.pickIdx = null;
  // a <meta name="theme-color"> is the clearest brand colour a plain page can give us
  const tc = /<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)/i.exec(text) || /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']theme-color/i.exec(text);
  state.themeColor = tc ? cssToRgb(tc[1]) : null;
  updateAutoBrand();
  let base = $('base').value.trim();
  if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
  state.base = base;
  const m = state.model, imgs = (m.hero.img ? 1 : 0) + m.sections.reduce((n, s) => n + s.imgs.length + s.cards.filter(c => c.img).length, 0);
  $('found').innerHTML = `Read <b>${esc(m.brand || 'your site')}</b>${kind === 'tsx' ? ' (React)' : ''} · ${m.nav.length} links · ${m.sections.length} sections · ${imgs} images`;
  return true;
}

/* ---- target (look like…) ---- */
function setTarget(t) {
  state.tgt = t;
  renderTargetCard();
}
function renderTargetCard() {
  const t = state.tgt, body = $('tgtBody');
  $('tClear').hidden = !t;
  if (!t) {
    body.innerHTML = `<div class="drop" id="tDrop"><b>Drop a design here</b><span>A saved page (.htm / .html with its _files folder) or a React component (.tsx / .jsx)</span><div class="exts"><span class="kind">htm</span><span class="kind">html</span><span class="kind">tsx</span><span class="kind">jsx</span></div></div>`;
    $('tDrop').onclick = () => $('tfile').click();
    return;
  }
  if (t.kind === 'kit') {
    body.innerHTML = `<div class="filechip"><span class="kind dark">kit</span><div class="nm"><b>${esc(t.name)}</b><span>Merged from a component collection · design sampled ✓</span></div><div class="sw">${swatches(t.tokens)}</div></div><div class="tprev" id="tPrev"></div>`;
    mountScaled($('tPrev'), t.viewHtml);
    return;
  }
  if (t.pasting) {
    body.innerHTML = `<textarea id="tSrc" spellcheck="false" placeholder="Paste the HTML or TSX of the design you want to copy">${esc(t.text)}</textarea>`;
    $('tSrc').oninput = e => { t.text = e.target.value; t.kind = detectKind(t.text); t.tokens = null; t.error = null; t.viewHtml = null; };
    return;
  }
  const status = t.error ? `<div class="warn err">${esc(t.error)}</div>` : '';
  const miss = t.missing && t.missing.length ? `<div class="warn">${missingNote(t.missing)}</div>` : '';
  const sizeKb = Math.round(t.text.length / 1024);
  const sw = t.tokens ? `<div class="sw">${swatches(t.tokens)}</div>` : '';
  body.innerHTML = `<div class="filechip"><span class="kind dark">${t.kind === 'tsx' ? 'tsx' : (t.name.split('.').pop() || 'html').slice(0, 4)}</span>
    <div class="nm"><b>${esc(t.name)}</b><span>${sizeKb} KB${t.assets.size ? ` · ${t.assets.size} linked files` : ''}${t.tokens ? ' · design sampled ✓' : ' · will be sampled when you generate'}</span></div>${sw}</div>
    ${status}${miss}<div class="tprev" id="tPrev">${t.viewHtml ? '' : '<div class="ph">Preview appears after sampling</div>'}</div>`;
  if (t.viewHtml) mountScaled($('tPrev'), t.viewHtml);
}
function swatches(T) {
  return [T.bg, T.surface, T.accent, T.text].filter(Boolean).map(c => `<i style="background:${Cx.css(c)}"></i>`).join('');
}
function mountScaled(box, html) {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('tabindex', '-1');
  f.srcdoc = html;
  box.appendChild(f);
  const fit = () => { const w = box.clientWidth; if (w) f.style.transform = `scale(${w / 1280})`; };
  fit(); new ResizeObserver(fit).observe(box);
}
/* ---- the user's brand: colour + font measured from their own page ---- */
function cssToRgb(c) {
  const cx = (cssToRgb.cx = cssToRgb.cx || Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true }));
  cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#0000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
  const d = cx.getImageData(0, 0, 1, 1).data; return d[3] ? [d[0], d[1], d[2], 1] : null;
}
const rgbToHex = c => '#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
function updateAutoBrand() {
  const ST = state.srcTokens, colorful = c => c && Cx.chroma(c) > 0.2;
  state.autoBrand = colorful(state.themeColor) ? state.themeColor
    : ST && colorful(ST.accent) ? ST.accent
    : ST && ST.btn && colorful(ST.btn.bg) ? ST.btn.bg : null;
}
async function measureSource() {
  if (state.srcTokens || !state.srcPrep) return;
  try { state.srcTokens = (await runSandbox(id => withProbe(state.srcPrep, id), 12000)).tokens; } catch { /* plain pages may have nothing to measure */ }
  updateAutoBrand();
}
const userFontUsable = () => {
  const ST = state.srcTokens; if (!ST) return false;
  return !!(ST.faces || (ST.fontLinks && ST.fontLinks.length) || !/^(times|serif|"times new roman"|times new roman)$/i.test(firstFamily(ST.bodyFont)));
};
/* animated remixes: the target page itself, keeping all of its effects */
function liveStyle(T, o) {
  const accent = o.recolor && brandColor() ? brandColor() : (T.accent || (T.btn && T.btn.bg) || T.text);
  return {
    id: newId(), arch: 'target', live: true, target: T.name, label: `Like ${T.name} · animated`, name: o.name,
    fontLabel: o.myFont ? `Your font (${firstFamily(state.srcTokens.bodyFont)})` : firstFamily(T.headFont),
    recolor: !!o.recolor, myFont: !!o.myFont,
    pal: { bg: Cx.css(T.bg), surface: Cx.css(T.surface || T.bg), accent: Cx.css(accent), text: Cx.css(T.text) },
  };
}
function liveStyles(T) {
  if (!state.tgt || !state.tgt.liveBase) return [];
  const out = [liveStyle(T, { name: 'Animated remix', recolor: true })];
  if (brandColor()) out.push(liveStyle(T, { name: 'Animated · original colours' }));
  if (userFontUsable()) out.push(liveStyle(T, { name: 'Animated · your font', recolor: true, myFont: true }));
  return out;
}

async function loadTarget() {
  const t = state.tgt;
  if (!t || t.tokens || !t.text.trim()) return;
  t.pasting = false; t.error = null;
  let viewHtml, liveHtml;
  if (t.kind === 'tsx') viewHtml = tsxDoc(t.text, 'view');
  else { const prep = await prepareHtml(t.text, t.assets); t.missing = prep.missing; viewHtml = prep.html; liveHtml = prep.liveHtml; }
  try {
    const res = await runSandbox(id => t.kind === 'tsx' ? tsxDoc(t.text, id) : withProbe(viewHtml, id));
    t.tokens = { ...res.tokens, name: t.name };
    t.viewHtml = viewHtml;
    t.liveBase = t.kind === 'tsx' ? tsxDoc(t.text, 'live') : liveHtml || viewHtml;   // the remix runs the design's own scripts
  } catch (e) {
    t.error = `Couldn't read this design: ${e.message}`;
  }
  renderTargetCard();
}

/* ---- generation ---- */
function batch(n, mood, fresh) {
  if (mood === 'target') {
    const T = state.tgt.tokens, out = [];
    if (fresh) out.push(...liveStyles(T), targetStyle(T, { exact: true }));
    while (out.length < n) out.push(targetStyle(T));
    return out;
  }
  const out = [], order = shuffle([...ARCH_IDS]), used = [];
  for (let i = 0; i < n; i++) {
    const arch = mood === 'all' ? order[i % order.length] : mood;
    let hue; for (let t = 0; t < 8; t++) { hue = R(0, 360); if (used.slice(-3).every(u => Math.min(Math.abs(u - hue), 360 - Math.abs(u - hue)) > 45)) break; }
    used.push(hue);
    out.push(makeStyle(arch, { hue }));
  }
  return out;
}
function variations(base) {
  if (base.arch === 'target') {
    const T = state.tgt && state.tgt.tokens;
    if (!T || T.name !== base.target) { toast('Load that design again to make variations of it'); return null; }
    if (base.live) return [...liveStyles(T).filter(s => s.name !== base.name), ...Array.from({ length: 6 }, () => targetStyle(T))];
    return Array.from({ length: 9 }, (_, i) => targetStyle(T, i < 3 ? { nav: base.nav, accent: base.accentRgb } : i < 6 ? { hero: base.hero, cards: base.cards } : {}));
  }
  const A = ARCH[base.arch];
  return Array.from({ length: 9 }, (_, i) => {
    let o;
    if (i < 3) o = { hue: base.hue, font: pick(A.fonts.filter(x => x.d !== base.font.d)) || base.font };
    else if (i < 6) o = { hue: base.hue + R(-30, 30), font: base.font };
    else o = { font: base.font, layout: { nav: base.nav, hero: base.hero, cards: base.cards } };
    return makeStyle(base.arch, o);
  });
}

async function generate() {
  if ($('gen').disabled) return;
  try {
    busy('Reading your site…');
    if (!await loadSource()) return;
    if (state.tgt && state.tgt.text.trim() && !state.tgt.tokens) {
      busy('Sampling the design…');
      await loadTarget();
      if (state.tgt.error) toast(state.tgt.error, 4000);
    }
    const hasT = !!(state.tgt && state.tgt.tokens);
    if (hasT) { busy('Reading your brand…'); await measureSource(); }
    if (hasT) state.mood = 'target'; else if (state.mood === 'target') state.mood = 'all';
    renderChips();
    state.styles = batch(12, state.mood, true);
    state.varOf = null;
    $('results').hidden = false;
    setView('studio');   // Studio is the stage: your page + a filmstrip of these styles
    
  } catch (e) {
    console.error(e);
    toast(e.message || 'Something went wrong', 4000);
  } finally { busy(null); }
}

async function setView(v) {
  state.view = v;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'components' || v === 'component') { $('results').hidden = false; renderGrid(); $('results').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (!state.model) {
    try { busy('Reading your site…'); if (!await loadSource()) return; } catch (e) { toast(e.message, 4000); return; } finally { busy(null); }
  }
  $('results').hidden = false;   // the site may have been read elsewhere (e.g. opening a project), so always show the workspace
  renderGrid();
  if (VIEWS[v]) $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });   // Studio / Build / Component live below the intro
}

function renderChips() {
  const chips = [...(state.tgt && state.tgt.tokens ? [['target', `✦ Like ${state.tgt.name}`]] : []), ['all', 'All styles'], ...ARCH_IDS.map(id => [id, ARCH[id].label])];
  $('chips').innerHTML = chips.map(([id, l]) => `<button data-mood="${id}" class="${state.mood === id ? 'on' : ''} ${id === 'target' ? 'tg' : ''}">${esc(l)}</button>`).join('');
}

const ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/></svg>';
const ICON_VAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>';
const isSaved = s => state.saved.some(x => x.id === s.id);

function tile(s) {
  const el = document.createElement('article');
  el.className = 'tile';
  const p = s.pal;
  const acc = s.live && s.recolor && brandColor() ? Cx.css(brandColor()) : p.accent;
  const sw = [p.bg, p.surface, acc, p.text].map(c => `<i style="background:${c}"></i>`).join('');
  el.innerHTML = `<div class="thumb">${s.live ? '<span class="badge">✦ Animated · keeps its effects</span>' : s.exact ? '<span class="badge">Closest static match</span>' : ''}<div class="hov"><span>Preview</span></div></div>
    <div class="meta"><div class="txt"><h3>${esc(s.name)}</h3><p>${esc(s.label)} · ${esc(s.fontLabel)}</p></div>
    <div class="sw">${sw}</div>
    <button class="icon var" title="More like this">${ICON_VAR}</button>
    <button class="icon heart ${isSaved(s) ? 'on' : ''}" title="Save">${ICON_HEART}</button></div>`;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', sandboxFor(s)); f.setAttribute('tabindex', '-1'); f.title = s.name;
  f.srcdoc = renderSite(viewModel(), s, { preview: true, thumb: true, base: state.base });
  el.querySelector('.thumb').prepend(f);
  el.querySelector('.thumb').onclick = () => openModal(s);
  el.querySelector('.var').onclick = () => showVariations(s);
  el.querySelector('.heart').onclick = e => { toggleSave(s); e.currentTarget.classList.toggle('on', isSaved(s)); };
  return el;
}

function renderGrid() {
  const g = $('grid');
  g.innerHTML = '';
  document.querySelectorAll('[data-viewbox]').forEach(el => { el.hidden = el.dataset.viewbox !== state.view; });
  if (VIEWS[state.view]) {
    g.style.display = 'none'; $('adv').hidden = true; $('comps').hidden = true;
    $('chips').style.display = 'none'; $('moreWrap').style.display = 'none';
    $('banner').innerHTML = state.view === 'build'
      ? `<h2>Build your site</h2><span class="found">Move parts around, swap in components, and choose when each part shows.</span>`
      : state.view === 'studio'
      ? `<h2>Studio</h2><span class="found">Pick a template, collect components, then drop them onto your page.</span>`
      : `<h2>Component</h2><span class="found">Preview one component on its own, try variations, then add it to your site.</span>`;
    VIEWS[state.view]();
    updateSavedCount();
    return;
  }
  const adv = state.view === 'advanced', cv = state.view === 'components';
  $('adv').hidden = !adv;
  $('comps').hidden = !cv;
  g.style.display = adv || cv ? 'none' : '';
  if (cv) {
    $('chips').style.display = 'none';
    $('moreWrap').style.display = 'none';
    $('banner').innerHTML = `<h2>Components</h2><span class="found">Save UI pieces you like, group them into collections, then use one — or a whole collection — as the design for your site.</span>`;
    renderComps();
    return;
  }
  if (adv) {
    $('chips').style.display = 'none';
    $('moreWrap').style.display = 'none';
    $('banner').innerHTML = `<h2>Advanced · images</h2><span class="found">Drag images from your site into the logo, hero and feature slots. Your choices apply to every style.</span>`;
    if (!state.styles.length) state.styles = batch(12, state.mood, true);
    renderAdvanced();
    updateSavedCount();
    return;
  }
  let list;
  if (state.view === 'saved') {
    list = state.saved;
    $('banner').innerHTML = `<h2>Saved styles</h2><span class="found">Applied to the site you pasted</span>`;
    $('chips').style.display = 'none';
    $('moreWrap').style.display = 'none';
    if (!list.length) g.innerHTML = '<div class="empty">No saved styles yet — tap the ♡ on any style you like.</div>';
  } else {
    list = state.styles;
    $('chips').style.display = '';
    $('moreWrap').style.display = '';
    if (state.varOf) {
      $('banner').innerHTML = `<h2>More like “${esc(state.varOf.name)}”</h2><button class="ghost" id="backAll">← Back</button>`;
      $('backAll').onclick = () => { state.varOf = null; state.styles = batch(12, state.mood, true); renderGrid(); };
    } else if (state.mood === 'target' && state.tgt && state.tgt.tokens) {
      const T = state.tgt.tokens;
      const layout = T.side ? 'sidebar app layout' : T.topbar ? 'top-bar layout' : 'single page';
      $('banner').innerHTML = `<div class="tsum"><div class="tprev" id="bPrev"></div><div><h2>Your site, like ${esc(state.tgt.name)}</h2>
        <p>Sampled: ${esc(firstFamily(T.headFont))} headings · ${esc(firstFamily(T.bodyFont))} text · ${T.card ? Math.round(T.card.radius) + 'px corners' : 'flat'} · ${layout}${Cx.lum(T.bg) < .3 ? ' · dark' : ''}</p>
        <div class="sw">${swatches(T)}${T.palette.slice(1, 4).map(c => `<i style="background:${Cx.css(c)}"></i>`).join('')}</div></div></div>`;
      mountScaled($('bPrev'), state.tgt.viewHtml);
    } else $('banner').innerHTML = '';
  }
  list.forEach(s => g.appendChild(tile(s)));
  fitThumbs();
  updateSavedCount();
}

function appendMore() {
  const more = state.varOf ? variations(state.varOf) : batch(12, state.mood, false);
  if (!more) return;
  state.styles.push(...more);
  more.forEach(s => $('grid').appendChild(tile(s)));
  fitThumbs();
}
function showVariations(s) {
  const v = variations(s); if (!v) return;
  state.varOf = s;
  state.styles = [s, ...v];
  setView('studio');
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function toggleSave(s) {
  if (isSaved(s)) state.saved = state.saved.filter(x => x.id !== s.id);
  else state.saved.unshift(s);
  if (!store.set('reskin.saved', state.saved)) toast('Saved for this session only (too big for browser storage)');
  else toast(isSaved(s) ? `Saved “${s.name}”` : 'Removed from saved');
  updateSavedCount();
  if (state.view === 'saved') renderGrid();
}
function updateSavedCount() { $('savedCount').textContent = state.saved.length ? `(${state.saved.length})` : ''; }
function fitThumbs() { const t = document.querySelector('.thumb'); if (t && t.clientWidth) $('grid').style.setProperty('--s', t.clientWidth / 1280); }
new ResizeObserver(fitThumbs).observe($('grid'));

/* ---- Advanced tab: drag images into logo / hero / feature slots ---- */
const cssUrl = s => String(s).replace(/['"()\\\s]/g, c => encodeURIComponent(c));
const resolveSrc = src => {
  if (/^(data:|blob:|https?:)/i.test(src)) return src;
  if (state.base) { try { return new URL(src, state.base).href; } catch {} }
  return src;
};
const pool = () => [...state.model.images, ...state.extraImgs];

function assignSlot(key, im) {
  const A = state.assign, val = im ? { src: im.src, alt: im.alt || '' } : null;
  if (key === 'logo') A.logo = val;
  else if (key === 'hero') A.hero = val;
  else if (key.startsWith('card:')) (A.cards || (A.cards = {}))[key.slice(5)] = val;
  else if (key.startsWith('gal:')) {
    const si = key.slice(4), cur = (A.gal && A.gal[si]) || viewModel().sections[si].imgs.slice();
    if (val && !cur.some(x => x.src === val.src)) cur.push(val);
    (A.gal || (A.gal = {}))[si] = cur;
  }
  state.pickIdx = null;
  renderAdvanced();
}
function removeGalleryImg(si, ii) {
  const A = state.assign, cur = ((A.gal && A.gal[si]) || viewModel().sections[si].imgs).slice();
  cur.splice(ii, 1);
  (A.gal || (A.gal = {}))[si] = cur;
  renderAdvanced();
}
async function addImageFiles(files) {
  const added = [];
  for (const f of files) {
    if (!/^image\//.test(f.type) || f.size > 8e6) continue;
    const d = await readDataUrl(f);
    if (d) { const im = { src: d, alt: f.name.replace(/\.[^.]+$/, '') }; state.extraImgs.push(im); added.push(im); }
  }
  if (!added.length) toast('Drop image files (PNG, JPG, SVG, WebP…)');
  return added;
}

function renderAdvanced() {
  const v = viewModel(), A = state.assign, imgs = pool();
  const used = new Set([v.logo && v.logo.src, v.hero.img && v.hero.img.src, ...v.sections.flatMap(s => [...s.cards.map(c => c.img && c.img.src), ...s.imgs.map(i => i.src)])].filter(Boolean));
  const th = im => im ? `style="background-image:url('${cssUrl(resolveSrc(im.src))}')"` : '';
  const slot = (key, title, sub, im) => `<div class="slot ${im ? 'filled' : ''}" data-slot="${key}"><div class="th" ${th(im)}>${im ? '' : '+'}</div><div class="lb"><b>${esc(title)}</b><span>${esc(im ? sub : 'Drop an image here')}</span></div>${im ? `<button class="x" data-clear="${key}" title="Remove">×</button>` : ''}</div>`;
  const pk = state.paletteKey || 'none';
  const palBtn = (key, label, colors) => `<button class="pal ${pk === key ? 'on' : ''}" data-pal="${key}" title="${esc(label)}"><span class="pal-sw">${colors.map(c => `<i style="background:${c}"></i>`).join('')}</span><span>${esc(label)}</span></button>`;
  const look = `<h4>Colour palette</h4><div class="pals">
      ${palBtn('none', "Each style's own", ['conic-gradient(#ff5b37,#ffc93c,#3ccf91,#3c8cff,#a45bff,#ff5b37)'])}
      ${state.autoBrand ? palBtn('auto', 'From your site', [Cx.css(state.autoBrand)]) : ''}
      ${PALETTES.map((P, i) => palBtn('p' + i, P.name, [P.bg ? Cx.css(P.bg) : '#fff', Cx.css(P.accent)])).join('')}
      <label class="pal ${pk === 'custom' ? 'on' : ''}" title="Pick any colour"><span class="pal-sw"><input type="color" id="palCustom" value="${rgbToHex(state.palette && pk === 'custom' ? state.palette.accent : brandColor() || [255, 91, 55])}"></span><span>Custom…</span></label>
    </div>
    <h4>Hero type</h4><div class="seg heroseg">${[['auto', 'Per style'], ['center', 'Centered'], ['left', 'Left'], ['split', 'Split + image'], ['big', 'Huge type']].map(([k, l]) => `<button data-hero="${k}" class="${(state.heroType || 'auto') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="note">Palette and hero apply to every generated style. Animated remixes take your palette colour but keep the original page's hero.</p>`;
  let slots = look + `<h4>Brand</h4><div class="slot-row">${slot('logo', 'Logo', 'Shown in the nav and footer', v.logo)}</div>
    <label class="chk"><input type="checkbox" id="hideName" ${A.hideName ? 'checked' : ''}> Logo only (hide the site name “${esc(v.brand)}”)</label>
    <h4>Hero</h4><div class="slot-row">${slot('hero', 'Hero image', esc(v.hero.title).slice(0, 40), v.hero.img)}</div>`;
  v.sections.forEach((s, si) => {
    const title = s.title || (s.intro[0] || '').slice(0, 40) || `Section ${si + 1}`;
    let inner = s.cards.map((c, ci) => slot(`card:${si}:${ci}`, c.title, 'Feature card image', c.img)).join('');
    if (s.kind !== 'quote') inner += `<div class="slot wide ${s.imgs.length ? 'filled' : ''}" data-slot="gal:${si}"><div class="gal">${s.imgs.length ? s.imgs.map((im, ii) => `<i data-galrm="${si}:${ii}" title="Remove" style="background-image:url('${cssUrl(resolveSrc(im.src))}')"></i>`).join('') : ''}</div><div class="lb" style="flex:none;text-align:right"><span>${s.imgs.length ? 'Drop to add more' : 'Drop images to add a gallery'}</span></div></div>`;
    slots += `<h4>${s.cards.length ? 'Features' : 'Section'} · ${esc(title)}</h4><div class="slot-row">${inner}</div>`;
  });

  const options = [];
  const seenIds = new Set();
  [state.current, ...state.styles, ...state.saved].forEach(s => { if (s && !seenIds.has(s.id)) { seenIds.add(s.id); options.push(s); } });
  if (!options.some(s => s.id === state.advStyle)) state.advStyle = options[0] && options[0].id;

  $('adv').innerHTML = `
    <div class="panel pool"><h3>Images on your site</h3>
      <p>${imgs.length ? 'Drag one onto a slot, or click it and then click a slot.' : 'No images found in your site. Add some below.'}</p>
      <div class="pool-grid">${imgs.map((im, i) => `<div class="pimg ${used.has(im.src) ? 'used' : ''} ${state.pickIdx === i ? 'sel' : ''}" draggable="true" data-i="${i}" title="${esc(im.alt || im.src.slice(0, 80))}"><img src="${esc(resolveSrc(im.src))}" alt="" onerror="this.parentNode.classList.add('broken')"></div>`).join('')}</div>
      <div class="addimg" id="addImg">+ Add your own images<br><small>drop files here or click</small></div>
      <input type="file" id="imgFile" accept="image/*" multiple hidden></div>
    <div class="panel slots ${state.pickIdx != null ? 'pickmode' : ''}" id="slots"><h3>Where images go</h3><p>${state.pickIdx != null ? 'Now click a slot to place the selected image.' : 'Your page and every style use these choices.'}</p>${slots}
      <div style="margin-top:18px"><button class="ghost" id="advReset">Reset to detected images</button></div></div>
    <div class="panel advprev"><div class="advbar">Preview <select id="advStyle">${options.map(s => `<option value="${s.id}" ${s.id === state.advStyle ? 'selected' : ''}>${esc(s.name)} — ${esc(s.label)}</option>`).join('')}</select></div><div class="advframe" id="advFrame"></div></div>`;

  // pool: drag or click-to-pick
  $('adv').querySelectorAll('.pimg').forEach(el => {
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'reskin-img:' + el.dataset.i); e.dataTransfer.effectAllowed = 'copy'; });
    el.onclick = () => { state.pickIdx = state.pickIdx === +el.dataset.i ? null : +el.dataset.i; renderAdvancedLight(); };
  });
  // slots: drop target, click target, clear buttons
  $('adv').querySelectorAll('.slot').forEach(el => {
    const key = el.dataset.slot;
    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); el.classList.remove('dragover');
      const d = e.dataTransfer.getData('text/plain');
      if (d && d.startsWith('reskin-img:')) return assignSlot(key, pool()[+d.slice(11)]);
      const added = await addImageFiles(await filesFromDrop(e.dataTransfer));
      if (!added.length) return;
      if (key.startsWith('gal:')) { added.slice(0, -1).forEach(im => assignSlotQuiet(key, im)); }
      assignSlot(key, added[added.length - 1]);
    });
    el.addEventListener('click', e => {
      if (e.target.closest('[data-clear],[data-galrm]')) return;
      if (state.pickIdx != null) assignSlot(key, pool()[state.pickIdx]);
    });
  });
  $('adv').querySelectorAll('[data-clear]').forEach(b => b.onclick = () => assignSlot(b.dataset.clear, null));
  $('adv').querySelectorAll('[data-galrm]').forEach(b => b.onclick = () => { const [si, ii] = b.dataset.galrm.split(':').map(Number); removeGalleryImg(si, ii); });
  $('hideName').onchange = e => { state.assign.hideName = e.target.checked; renderAdvanced(); };
  $('adv').querySelectorAll('[data-pal]').forEach(b => b.onclick = () => {
    const k = b.dataset.pal;
    state.paletteKey = k;
    state.palette = k === 'none' ? null : k === 'auto' ? { name: 'Your site', accent: state.autoBrand } : PALETTES[+k.slice(1)];
    renderAdvanced();
  });
  $('palCustom').onchange = e => { state.paletteKey = 'custom'; state.palette = { name: 'Custom', accent: cssToRgb(e.target.value) }; renderAdvanced(); };
  $('adv').querySelectorAll('[data-hero]').forEach(b => b.onclick = () => { state.heroType = b.dataset.hero; renderAdvanced(); });
  $('advReset').onclick = () => { state.assign = {}; state.pickIdx = null; renderAdvanced(); };
  $('advStyle').onchange = e => { state.advStyle = e.target.value; renderAdvPreview(); };
  const add = $('addImg');
  add.onclick = () => $('imgFile').click();
  $('imgFile').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if ((await addImageFiles(fs)).length) renderAdvanced(); };
  add.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); add.classList.add('dragover'); });
  add.addEventListener('dragleave', () => add.classList.remove('dragover'));
  add.addEventListener('drop', async e => { e.preventDefault(); e.stopPropagation(); add.classList.remove('dragover'); if ((await addImageFiles(await filesFromDrop(e.dataTransfer))).length) renderAdvanced(); });
  renderAdvPreview();
}
function assignSlotQuiet(key, im) { const r = renderAdvanced; renderAdvanced = () => {}; try { assignSlot(key, im); } finally { renderAdvanced = r; } }
// selection only: update classes without reloading the preview
function renderAdvancedLight() {
  $('adv').querySelectorAll('.pimg').forEach(el => el.classList.toggle('sel', +el.dataset.i === state.pickIdx));
  $('slots').classList.toggle('pickmode', state.pickIdx != null);
  $('slots').querySelector('p').textContent = state.pickIdx != null ? 'Now click a slot to place the selected image.' : 'Your page and every style use these choices.';
}
function renderAdvPreview() {
  const box = $('advFrame'); if (!box) return;
  const all = [state.current, ...state.styles, ...state.saved].filter(Boolean);
  const s = all.find(x => x.id === state.advStyle) || all[0];
  if (!s) { box.innerHTML = '<div class="empty">Generate styles first</div>'; return; }
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', sandboxFor(s)); f.setAttribute('tabindex', '-1');
  f.srcdoc = renderSite(viewModel(), s, { preview: true, base: state.base });
  box.replaceChildren(f);
  const fit = () => { if (box.clientWidth) f.style.transform = `scale(${box.clientWidth / 1280})`; };
  fit(); new ResizeObserver(fit).observe(box);
}

/* =========================================================
   7. COMPONENTS: save UI pieces from uiverse / MUI / 21st.dev (or your own),
      group them into collections, and use one — or a whole collection — as the design.
   ========================================================= */
const comps = {
  list: store.get('reskin.components', []),
  filter: 'All', pasting: false, busy: false,
  save() { if (!store.set('reskin.components', comps.list)) toast('Saved for this session only (browser storage is full)'); if (window.Cloud) Cloud.syncComponents(comps.list); },
  collections() { return [...new Set(['My kit', ...comps.list.map(c => c.collection)])]; },
};

// Link import goes through a small proxy: the Cloudflare Worker (cloudflare-proxy/), or serve.py's /proxy locally.
const DEFAULT_PROXY = 'https://reskin-proxy.eyeisivan.workers.dev';   // the Cloudflare Worker in cloudflare-proxy/
const proxyBase = () => (store.get('reskin.proxy', '') || DEFAULT_PROXY).replace(/\/+$/, '');
// Fetch text from a component site: direct if the site allows it, otherwise through the proxy
async function siteText(url) {
  const blocksDirect = /^https:\/\/(www\.)?(uiverse\.io|21st\.dev|mui\.com)\//.test(url);   // these sites refuse cross-site fetches
  if (!blocksDirect) { try { const r = await fetch(url); if (r.ok) return await r.text(); } catch {} }
  const P = proxyBase();
  if (!P && location.protocol === 'file:') throw new Error('To import by link, run “python serve.py” or set the link proxy address below');
  let r;
  try { r = await fetch((P ? P + '/?url=' : '/proxy?url=') + encodeURIComponent(url)); }
  catch { throw new Error(P ? 'Couldn’t reach the link proxy — check its address below' : 'Couldn’t reach serve.py'); }
  const t = await r.text();
  if (!r.ok) throw new Error(!P && r.status === 404 && !/answered/.test(t) ? 'Link import needs a proxy: run “python serve.py”, or set the Cloudflare proxy address below' : t);
  return t;
}
const titleCase = s => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
const uiverseDoc = (html, css) => `<!doctype html><html><head><meta charset="utf-8"><style>${css.replace(/<\/style/gi, '')}</style><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif}</style></head><body>${html}</body></html>`;

async function importByLink(raw) {
  let url; try { url = new URL(raw.trim().replace(/^(?!https?:)/, 'https://')); } catch { throw new Error('That doesn’t look like a link'); }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'uiverse.io') {
    const page = await siteText(url.href);
    const grab = k => { const m = new RegExp('"' + k + '":("(?:[^"\\\\]|\\\\.)*")').exec(page); return m ? JSON.parse(m[1]) : null; };
    const html = grab('html'), css = grab('css') || '';
    if (!html) throw new Error('Couldn’t find the element on that uiverse page. Open a single element (uiverse.io/<author>/<name>).');
    const parts = url.pathname.split('/').filter(Boolean);
    return [{ name: titleCase(parts[1] || 'uiverse element'), source: 'uiverse', url: url.href, kind: 'html', code: uiverseDoc(html, css) }];
  }
  if (host === 'mui.com') {
    const slug = (/\/react-([a-z0-9-]+)/.exec(url.pathname) || [])[1];
    if (!slug) throw new Error('Use a MUI component page, e.g. mui.com/material-ui/react-button/');
    const api = 'https://api.github.com/repos/mui/material-ui/contents/docs/data/material/components';
    const dirs = JSON.parse(await siteText(api + '?ref=master')).map(d => d.name);
    const want = [slug, slug + 's', slug.replace(/y$/, 'ies'), slug + 'es', slug.replace(/-/g, '')];
    const dir = want.find(w => dirs.includes(w)) || dirs.find(d => d.startsWith(slug)) || dirs.find(d => slug.startsWith(d.replace(/s$/, '')));
    if (!dir) throw new Error(`No MUI demos found for “${slug}”`);
    let demos = JSON.parse(await siteText(`${api}/${dir}/demos?ref=master`)).filter(d => d.type === 'dir').map(d => d.name);
    const hash = url.hash.replace('#', '').replace(/-?(button|buttons)$/, '');
    if (hash) demos.sort((a, b) => (b.includes(hash) ? 1 : 0) - (a.includes(hash) ? 1 : 0));
    demos = demos.filter(d => d !== 'base-demo').slice(0, 6);
    const out = [];
    for (const d of demos) {
      const files = JSON.parse(await siteText(`${api}/${dir}/demos/${d}?ref=master`));
      const f = files.find(x => /\.tsx$/.test(x.name) && !/^(index|client)\./.test(x.name)) || files.find(x => /\.(tsx|jsx|js)$/.test(x.name) && !/^(index|client)\./.test(x.name));
      if (!f) continue;
      out.push({ name: titleCase(f.name.replace(/\.\w+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')), source: 'MUI', url: `https://mui.com/material-ui/react-${slug}/#${d}`, kind: 'tsx', code: await siteText(f.download_url) });
    }
    if (!out.length) throw new Error('Found the MUI page but none of its demos could be read');
    return out;
  }
  if (host === '21st.dev') {
    const page = await siteText(url.href);
    const blocks = [...page.matchAll(/<pre class="shiki[^"]*"[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map(m => {
      return new DOMParser().parseFromString(m[1], 'text/html').body.textContent;
    });
    if (!blocks.length) throw new Error('No code found on that 21st.dev page');
    const parts = url.pathname.split('/').filter(Boolean);
    return [{ name: titleCase(parts[parts.length - 1]), source: '21st.dev', url: url.href, kind: 'tsx', code: blocks.join('\n\n'),
      note: 'Only the usage example is public. For the real component, use “Copy code” on 21st.dev and paste it here.' }];
  }
  if (host === 'raw.githubusercontent.com' || host === 'gist.githubusercontent.com') {
    const code = await siteText(url.href), name = url.pathname.split('/').pop();
    return [{ name: titleCase(name.replace(/\.\w+$/, '')), source: 'GitHub', url: url.href, kind: detectKind(code, name), code }];
  }
  throw new Error('Links from uiverse.io, mui.com, 21st.dev or raw GitHub files are supported — for anything else, paste the code');
}

function addComps(items) {
  const coll = $('cColl') ? $('cColl').value : 'My kit';
  items.forEach(c => comps.list.unshift({ id: newId(), collection: coll, created: Date.now(), ...c }));
  comps.save();
  renderComps();
  toast(items.length > 1 ? `Saved ${items.length} components to “${coll}”` : `Saved “${items[0].name}” to “${coll}”`);
}
// extra: props for this one placement (Studio), on top of the component's own settings (Library)
const compDoc = (c, extra) => c.kind === 'tsx' ? tsxDoc(c.code, 'comp', typeof mountFor === 'function' ? mountFor(c, extra) : null) : reviveSaved(c.code);
// Page-saving extensions (SavePage WE) switch every script off when they save: type="text/plain".
// Scripts that were saved *inside* the file are turned back on; ones that lived on the original site can't load
// from here (the browser blocks them), and analytics are left off.
function reviveSaved(html) {
  if (!/data-savepage-type/.test(html)) return html;
  return html.replace(/<script\b([^>]*)>/gi, (m, attrs) => {
    if (!/data-savepage-type/.test(attrs) || /data-savepage-src/.test(attrs)) return m;
    const t = (/data-savepage-type="([^"]*)"/.exec(attrs) || [])[1] || '';
    if (/json/.test(t)) return m;
    return '<script' + attrs.replace(/\s*type="text\/plain"/, '').replace(/\s*data-savepage-type="[^"]*"/, '') + (t ? ` type="${t}"` : '') + '>';
  });
}
// a saved page whose app code didn't come with it: it looks right but nothing reacts
function frozenInfo(c) {
  if (c.kind === 'tsx' || c.icon) return null;
  if (c.frozenV === 2) return c.frozen || null;
  const html = String(c.code || ''), from = (/<meta name="savepage-url" content="([^"]+)"/.exec(html) || [])[1] || (/saved from url=\(\d+\)(\S+)/.exec(html) || [])[1] || null;
  let lost = 0, kept = 0;
  html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
    if (/json|text\/plain(?![\s\S]*data-savepage-type)/.test(attrs) && !/data-savepage/.test(attrs)) return m;
    if (/data-savepage-src/.test(attrs) && /type="module"|data-savepage-type="module"/.test(attrs)) lost++;
    else if (/data-savepage-src/.test(attrs)) { if (!/gtag|analytics|insights|beacon|center-stage/.test(attrs)) lost++; }
    else if (body.trim().length > 200 || /\ssrc="(data:|blob:)/.test(attrs)) kept++;
    return m;
  });
  const appRoot = /<div[^>]+id="(root|__next|app|__nuxt)"/.test(html);
  c.frozen = lost && (!kept || appRoot) ? { from, why: 'Its app code stayed on ' + (from ? new URL(from).hostname : 'the original site') + ' when it was saved.' } : null;
  c.frozenV = 2;
  return c.frozen;
}
// thumbnails: same page, centred so small pieces (a button, a card) fill the tile
const compThumbDoc = c => {
  const center = c.kind === 'tsx' ? 'html,body{min-height:100%}body{margin:0}#root{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}' : '';
  const style = `<style>${center}${THUMB_CSS}</style>`;
  const html = compDoc(c), i = html.toLowerCase().indexOf('</head>');
  return i >= 0 ? html.slice(0, i) + style + html.slice(i) : style + html;
};

function renderComps() {
  const box = $('comps');
  const colls = comps.collections();
  const shown = comps.list.filter(c => comps.filter === 'All' || c.collection === comps.filter);
  box.innerHTML = `
    <div class="cadd" id="cAdd">
      <input id="cLink" placeholder="Paste a link — uiverse.io/…, mui.com/material-ui/react-…, 21st.dev/…">
      <select id="cColl" title="Save into collection">${colls.map(n => `<option ${n === (comps.filter !== 'All' ? comps.filter : 'My kit') ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__new">+ New collection…</option></select>
      <button class="primary" id="cAddLink">${comps.busy ? '<span class="spin"></span>Fetching…' : 'Add'}</button>
      <button class="ghost" id="cPasteBtn">Paste code</button>
      <button class="ghost" id="cFileBtn">Upload</button>
      ${comps.pasting ? `<div class="cpaste"><textarea id="cCode" spellcheck="false" placeholder="Paste HTML (+ <style>) or a React component (TSX/JSX) — e.g. from 21st.dev's Copy code button"></textarea>
        <div class="row"><input id="cName" placeholder="Name (optional)"><button class="primary" id="cSavePaste">Save component</button></div></div>` : ''}
    </div>
    <div class="csrc">Browse: <a href="https://uiverse.io" target="_blank" rel="noopener">uiverse.io</a> · <a href="https://mui.com/material-ui/all-components/" target="_blank" rel="noopener">MUI</a> · <a href="https://21st.dev/community/components" target="_blank" rel="noopener">21st.dev</a> — open a component there, copy its address, paste it above. You can also drop .html / .tsx files here.
      <span style="margin-left:auto">Link proxy <input id="cProxy" value="${esc(store.get('reskin.proxy', '') || DEFAULT_PROXY)}" placeholder="${location.protocol === 'file:' ? 'https://reskin-proxy….workers.dev' : 'serve.py (built in)'}" style="font:inherit;font-size:12px;border:1px solid var(--line);border-radius:7px;padding:3px 8px;width:260px"></span></div>
    <div class="ctools"><div class="chips" id="cChips">${['All', ...colls].map(n => `<button data-coll="${esc(n)}" class="${comps.filter === n ? 'on' : ''}">${esc(n)} <small>${n === 'All' ? comps.list.length : comps.list.filter(c => c.collection === n).length}</small></button>`).join('')}</div>
      ${comps.filter !== 'All' && shown.length ? `<button class="primary" id="cUseKit">Use “${esc(comps.filter)}” as the design →</button>` : ''}</div>
    <div class="cgrid">${shown.length ? '' : '<div class="empty">No components yet. Paste a link from uiverse, MUI or 21st.dev above.</div>'}</div>`;
  const grid = box.querySelector('.cgrid');
  shown.forEach(c => {
    const t = document.createElement('div'); t.className = 'ctile';
    t.innerHTML = `<div class="cthumb"><span class="src">${esc(c.source)}</span></div>
      <div class="cmeta"><b title="${esc(c.name)}">${esc(c.name)}</b>${c.note ? `<span class="note">${esc(c.note)}</span>` : ''}
        <div class="row"><select data-move>${colls.map(n => `<option ${n === c.collection ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__new">+ New…</option></select>
        <button class="ghost" data-use>Use as design</button><button class="icon" data-del title="Remove from Library" aria-label="Remove ${esc(c.name)} from Library">✕</button></div></div>`;
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('tabindex', '-1'); f.setAttribute('loading', 'lazy');
    f.srcdoc = compThumbDoc(c);
    const th = t.querySelector('.cthumb'); th.appendChild(f);
    const fit = () => { if (th.clientWidth) f.style.transform = `scale(${th.clientWidth / 600})`; };
    fit(); new ResizeObserver(fit).observe(th);
    t.querySelector('[data-use]').onclick = () => useCompAsDesign(c);
    t.querySelector('[data-del]').onclick = () => removeComp(c.id);
    t.querySelector('[data-move]').onchange = e => { let v = e.target.value; if (v === '__new') v = prompt('New collection name')?.trim(); if (v) { c.collection = v; comps.save(); } renderComps(); };
    grid.appendChild(t);
  });

  $('cColl').onchange = e => { if (e.target.value === '__new') { const n = prompt('New collection name')?.trim(); if (n) { comps.filter = n; comps.newColl = n; } renderComps(); if (n) { const o = document.createElement('option'); o.textContent = n; o.selected = true; $('cColl').prepend(o); } } };
  $('cAddLink').onclick = async () => {
    const v = $('cLink').value.trim(); if (!v || comps.busy) return;
    comps.busy = true; const coll = $('cColl').value; renderComps(); $('cColl').value = coll;
    try { const items = await importByLink(v); comps.busy = false; renderComps(); $('cColl').value = coll; addComps(items); }
    catch (e) { comps.busy = false; renderComps(); $('cLink').value = v; toast(e.message, 5000); }
  };
  $('cLink').onkeydown = e => { if (e.key === 'Enter') $('cAddLink').click(); };
  $('cProxy').onchange = e => { const v = e.target.value.trim(); store.set('reskin.proxy', v === DEFAULT_PROXY ? '' : v); toast(v ? 'Link proxy saved' : 'Using the built-in proxy'); };
  $('cPasteBtn').onclick = () => { comps.pasting = !comps.pasting; renderComps(); if (comps.pasting) $('cCode').focus(); };
  if (comps.pasting) $('cSavePaste').onclick = () => {
    const code = $('cCode').value.trim(); if (!code) return;
    const kind = detectKind(code), name = $('cName').value.trim() || (/(?:function|const)\s+([A-Z]\w*)/.exec(code) || [])[1] || 'Pasted component';
    comps.pasting = false;
    addComps([{ name: titleCase(name.replace(/([a-z])([A-Z])/g, '$1 $2')), source: 'pasted', kind, code: kind === 'html' && !/<html|<body/i.test(code) ? uiverseDoc(code.replace(/<style[\s\S]*?<\/style>/gi, ''), [...code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n')) : code }]);
  };
  $('cFileBtn').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.html,.htm,.tsx,.jsx'; i.onchange = () => addCompFiles([...i.files]); i.click(); };
  box.querySelectorAll('[data-coll]').forEach(b => b.onclick = () => { comps.filter = b.dataset.coll; renderComps(); });
  if ($('cUseKit')) $('cUseKit').onclick = () => useKitAsDesign(comps.filter);
  const add = $('cAdd');
  add.ondragover = e => { e.preventDefault(); add.classList.add('dragover'); };
  add.ondragleave = () => add.classList.remove('dragover');
  add.ondrop = async e => { e.preventDefault(); e.stopPropagation(); add.classList.remove('dragover'); const fs = await filesFromDrop(e.dataTransfer); if (fs.length) addCompFiles(fs); else { const t = e.dataTransfer.getData('text'); if (t) { $('cLink').value = t; $('cAddLink').click(); } } };
}
async function addCompFiles(files) {
  const items = [];
  for (const f of files.filter(f => /\.(html?|tsx|jsx)$/i.test(f.name))) { const code = await f.text(); items.push({ name: titleCase(f.name.replace(/\.\w+$/, '')), source: 'file', kind: detectKind(code, f.name), code }); }
  if (items.length) addComps(items); else toast('Drop .html, .htm, .tsx or .jsx files');
}

// One component -> the target design (animated remix + matched styles)
async function useCompAsDesign(c) {
  setTarget({ name: c.name, text: c.code, kind: c.kind, assets: new Map(), tokens: null });
  await switchToTarget();
}
// A whole collection -> sample each component, merge into one design (button from one, card from another…)
async function useKitAsDesign(coll) {
  const items = comps.list.filter(c => c.collection === coll);
  busy(`Sampling ${items.length} components…`);
  toast(`Sampling ${items.length} components from “${coll}”…`, 4000);
  const toks = [];
  for (const c of items) {
    try { const res = await runSandbox(id => c.kind === 'tsx' ? tsxDoc(c.code, id) : withProbe(c.code, id), 20000); toks.push(res.tokens); } catch {}
  }
  busy(null);
  if (!toks.length) { toast('None of the components in this collection could be read', 4000); return; }
  const T = { ...toks[0], palette: [] };
  toks.forEach(t => {
    if (!T.btn && t.btn) T.btn = t.btn;
    if (t.btn && t.btn.bg && Cx.chroma(t.btn.bg) > Cx.chroma((T.btn && T.btn.bg) || [0, 0, 0])) T.btn = t.btn;
    if (!T.card && t.card) T.card = t.card;
    if (!T.accent && t.accent) T.accent = t.accent;
    if ((t.headSize || 0) > (T.headSize || 0)) Object.assign(T, { headFont: t.headFont, headWeight: t.headWeight, headSize: t.headSize, headLs: t.headLs, headCaps: t.headCaps });
    if (!T.side && t.side) T.side = t.side;
    (t.palette || []).forEach(c => { if (T.palette.length < 6 && T.palette.every(p => Cx.dist(p, c) > 60)) T.palette.push(c); });
    if (t.faces && !T.faces.includes(t.faces.slice(0, 60))) T.faces = (T.faces + '\n' + t.faces).slice(0, 1.5e6);
    T.fontLinks = [...new Set([...(T.fontLinks || []), ...(t.fontLinks || [])])];
  });
  T.name = `kit “${coll}”`;
  state.tgt = { name: T.name, text: '', kind: 'kit', assets: new Map(), tokens: T, viewHtml: compDoc(items[0]), liveBase: null };
  renderTargetCard();
  await switchToTarget();
}
async function switchToTarget() {
  try {
    busy('Reading your site…');
    if (!await loadSource()) { setView('all'); return; }
    if (!state.tgt.tokens) { busy('Sampling the design…'); await loadTarget(); }
    if (!state.tgt.tokens) { toast(state.tgt.error || 'Couldn’t read that design', 5000); return; }
    busy('Reading your brand…'); await measureSource();
    state.mood = 'target'; renderChips();
    state.styles = batch(12, 'target', true); state.varOf = null;
    $('results').hidden = false;
    setView('studio');
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast(e.message, 5000); } finally { busy(null); }
}

/* ---- modal ---- */
// static styles never need scripts; animated remixes run the target's own scripts (still isolated from this app)
const sandboxFor = s => (s.live ? 'allow-scripts ' : '') + 'allow-popups allow-popups-to-escape-sandbox';
// phones overlay their scrollbars: at phone width, don't let a classic scrollbar eat the 390px frame (preview only, not downloads)
const PREVIEW_CSS = '<style>@media (max-width:480px){html{scrollbar-width:none}html::-webkit-scrollbar{display:none}}</style>';
const injectPreviewCss = html => { const i = html.toLowerCase().indexOf('</head>'); return i >= 0 ? html.slice(0, i) + PREVIEW_CSS + html.slice(i) : PREVIEW_CSS + html; };
function setModalDoc(html, s) {
  const built = !!(state.current && state.current._built);
  $('mSave').hidden = built; $('mVar').hidden = built;
  // a fresh iframe each time — reusing one and swapping srcdoc could leave it blank
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', sandboxFor(s)); f.title = 'Full preview';
  $('mStage').replaceChildren(f);
  f.srcdoc = injectPreviewCss(html);
}
function openModal(s) {
  state.current = s;
  $('mName').textContent = s.name;
  $('mInfo').textContent = `${s.label} · ${s.fontLabel}`;
  $('mSave').textContent = isSaved(s) ? 'Saved ♥' : 'Save ♡';
  $('modal').hidden = false;
  document.body.style.overflow = 'hidden';
  setModalDoc(renderSite(viewModel(), s, { preview: true, base: state.base }), s);
}
function closeModal() { $('modal').hidden = true; document.body.style.overflow = ''; $('mStage').replaceChildren(); }
const fullHtml = () => state.current && state.current._built ? composeDoc({}) : renderSite(viewModel(), state.current, { base: state.base });
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function renderHearts() {
  const list = state.view === 'saved' ? state.saved : state.styles;
  [...document.querySelectorAll('.tile')].forEach((t, i) => list[i] && t.querySelector('.heart').classList.toggle('on', isSaved(list[i])));
}
$('mClose').onclick = closeModal;
$('modal').onclick = e => { if (e.target === $('modal')) closeModal(); };
$('mVar').onclick = () => { const s = state.current; closeModal(); showVariations(s); };
$('mSave').onclick = () => { toggleSave(state.current); $('mSave').textContent = isSaved(state.current) ? 'Saved ♥' : 'Save ♡'; renderHearts(); };
$('mCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(fullHtml()); toast('HTML copied to clipboard'); }
  catch { const ta = document.createElement('textarea'); ta.value = fullHtml(); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('HTML copied'); }
};
$('mDl').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([fullHtml()], { type: 'text/html' }));
  a.download = `${slug(state.model.brand || 'site')}-${slug(state.current.name)}.html`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Downloaded');
};
$('device').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#device button').forEach(x => x.classList.toggle('on', x === b));
  $('mStage').classList.toggle('mobile', b.dataset.d === 'mobile');
};

/* ---- inputs: upload, paste, drag & drop ---- */
async function useSourceFiles(files) {
  const { main, assets } = splitFiles(files);
  if (!main) { toast('Drop an .html, .htm, .tsx or .jsx file'); return; }
  $('src').value = await main.text();
  state.srcName = main.name; state.srcAssets = assets; state.srcKey = null;
  const info = $('srcInfo');
  info.hidden = false;
  info.innerHTML = `Loaded <b>${esc(main.name)}</b>${assets.size ? ` with ${assets.size} linked files` : ''}.`;
  info.className = 'warn';
  info.style.cssText = 'color:var(--ink);background:#f3f7ee;border-color:#d6e6c6';
}
async function useTargetFiles(files) {
  const { main, assets } = splitFiles(files);
  if (!main) { toast('Drop an .html, .htm, .tsx or .jsx file'); return; }
  const text = await main.text();
  setTarget({ name: main.name, text, kind: detectKind(text, main.name), assets, tokens: null });
  if (state.model) { // already generated once: sample right away and switch to it
    busy('Sampling the design…');
    try { await loadTarget(); await measureSource(); if (state.tgt.tokens) { state.mood = 'target'; renderChips(); state.styles = batch(12, 'target', true); state.varOf = null; setView('studio'); } else toast(state.tgt.error, 4000); }
    finally { busy(null); }
  }
}
function dropZone(el, handler) {
  let depth = 0;
  el.addEventListener('dragenter', e => { e.preventDefault(); depth++; el.classList.add('dragover'); });
  el.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.classList.remove('dragover'); } });
  el.addEventListener('dragover', e => e.preventDefault());
  el.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation(); depth = 0; el.classList.remove('dragover');
    const files = await filesFromDrop(e.dataTransfer);
    if (files.length) handler(files);
    else { const t = e.dataTransfer.getData('text'); if (t) handler([new File([t], 'dropped.html')]); }
  });
}
dropZone($('srcCard'), useSourceFiles);
dropZone($('tgtCard'), useTargetFiles);
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());

$('upload').onclick = () => $('file').click();
$('file').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) useSourceFiles(fs); };
$('tPick').onclick = () => $('tfile').click();
$('tfile').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) useTargetFiles(fs); };
$('tPaste').onclick = () => { setTarget({ name: 'pasted design', text: '', kind: 'html', assets: new Map(), tokens: null, pasting: true }); $('tSrc').focus(); };
$('tClear').onclick = () => { setTarget(null); if (state.mood === 'target') { state.mood = 'all'; renderChips(); } };
$('sample').onclick = () => { $('src').value = SAMPLE; state.srcName = ''; state.srcAssets = new Map(); state.srcKey = null; $('srcInfo').hidden = true; };
$('clear').onclick = () => { $('src').value = ''; state.srcName = ''; state.srcAssets = new Map(); state.srcKey = null; $('srcInfo').hidden = true; $('src').focus(); };
$('src').addEventListener('input', () => { state.srcKey = null; });
$('gen').onclick = generate;
$('more').onclick = appendMore;
$('chips').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.mood = b.dataset.mood; state.varOf = null; renderChips();
  state.styles = batch(12, state.mood, true); renderGrid();
};
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('modal').hidden) closeModal();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (!VIEWS[state.view] || e.target.closest && e.target.closest('.intro'))) generate();
});

$('src').value = SAMPLE;
renderTargetCard();
renderChips();
updateSavedCount();
