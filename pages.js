/* Reskin — more than one page.
   A project used to be one page. Now it can have more: each new page wears the project's style (the template plus its
   colours, p.style, and "all my buttons like this", p.btnCss), starts from a few plain sections, shows up in the menu,
   and downloads together with the rest.

   How it's kept (old projects have no p.pages and are one Home page, unchanged):
     p.pages  = [{ id: 'home', name: 'Home', slug: 'index' }, { id, name, slug, inNav, model: { hero, sections }, blocks, edits }]
     p.pageId = the page you're on
   The page you're on keeps its blocks and edits where they always were (p.blocks, p.edits), so everything in Studio
   works unchanged; the other pages keep theirs in their own record. Changes to your menu bar and footer (a navbar you
   swapped in, its words) belong to every page: they stay in p.edits whichever page you're on.
   Needs builder.js, studio.js, app.js. */

const HOME = 'home';
const pagesOf = (p = B.project) => (p && p.pages && p.pages.length ? p.pages : [{ id: HOME, name: 'Home', slug: 'index' }]);
const curPageId = (p = B.project) => (p && p.pageId) || HOME;
const pageRec = (id, p = B.project) => pagesOf(p).find(x => x.id === id);
const pageFile = pg => (pg.id === HOME ? 'index' : pg.slug) + '.html';
function ensurePages(p) {
  if (!p.pages || !p.pages.length) p.pages = [{ id: HOME, name: 'Home', slug: 'index' }];
  if (!p.pageId || !p.pages.some(x => x.id === p.pageId)) p.pageId = HOME;
  return p.pages;
}
// on every page: your menu bar and footer, and anything placed beside them
function isSiteWide(e, list) {
  for (let x = e, n = 0; x && n < 20; x = x.besideOf && list.find(y => y.id === x.besideOf), n++)
    if (x.target && (x.target.scope === 'nav' || x.target.scope === 'footer')) return true;
  return false;
}
// go to another page's content (no saving, no drawing): the one place pages change hands
function loadPage(p, id) {
  ensurePages(p);
  const from = pageRec(curPageId(p), p), to = pageRec(id, p);
  if (!to || from === to) return false;
  const edits = p.edits || [], shared = edits.filter(e => isSiteWide(e, edits));
  from.blocks = p.blocks || []; from.edits = edits.filter(e => !shared.includes(e));
  p.blocks = to.blocks || []; p.edits = shared.concat(to.edits || []);
  delete to.blocks; delete to.edits;
  p.pageId = id;
  if (!p.blocks.length) p.blocks = siteBlocks(pageModel(p));
  return true;
}

/* ---- what a page says ---- */
// opts.files: links between pages as files (about.html) — for downloads; otherwise links the preview understands
function pageModel(p = B.project, opts = {}) {
  const home = viewModel(); if (!home || !p) return home;
  const id = curPageId(p), rec = pageRec(id, p), pages = pagesOf(p);
  const m = id !== HOME && rec && rec.model
    ? { ...home, title: `${rec.name}${home.brand ? ' · ' + home.brand : ''}`, hero: structuredClone(rec.model.hero), sections: structuredClone(rec.model.sections) }
    : { ...home };
  if (pages.length < 2) return m;
  const link = pg => opts.files ? pageFile(pg) : '#rk-page-' + pg.id;
  const toHome = h => (opts.files && id !== HOME && /^#./.test(h || '') ? 'index.html' + h : h);   // your home page's own sections
  const extra = pages.filter(pg => pg.id !== HOME && pg.inNav !== false).map(pg => ({ text: pg.name, href: link(pg), page: pg.id }));
  m.nav = home.nav.map(l => ({ ...l, href: toHome(l.href) })).concat(extra);
  if (home.footerLinks.length) m.footerLinks = home.footerLinks.map(l => ({ ...l, href: toHome(l.href) })).concat(extra);
  if (home.navCta) m.navCta = { ...home.navCta, href: toHome(home.navCta.href) };
  m.brandHref = id === HOME ? '#' : link(pageRec(HOME, p) || { id: HOME });
  return m;
}

/* ---- new pages start from a few plain sections (placeholder words say they're placeholders) ---- */
const sec = o => { const s = { title: '', intro: [], cards: [], lists: [], imgs: [], quotes: [], buttons: [], forms: [], ...o }; s.kind = s.cards.length ? 'cards' : s.forms.length && !s.lists.length ? 'cta' : 'text'; return s; };
const card = (title, ...text) => ({ title, text, img: null, buttons: [] });
const hero = (eyebrow, title, para, buttons) => ({ eyebrow, title, paras: para ? [para] : [], buttons: buttons || [], img: null, stats: [] });
const PRESETS = [
  ['blank', 'Blank', 'Just a heading — add components to it', '▢'],
  ['about', 'About', 'Your story, what you care about, a way to get in touch', '☺'],
  ['contact', 'Contact', 'A form and the ways to reach you', '✉'],
  ['pricing', 'Pricing', 'Three plans and common questions', '$'],
  ['faq', 'Questions', 'Questions people ask, with answers', '?'],
  ['copy', 'Copy of this page', 'Starts as the page you’re on, changes and all', '⧉'],
];
function siteContacts(m) {
  const links = [m.navCta, ...m.nav, ...m.footerLinks, ...m.hero.buttons, ...m.sections.flatMap(s => s.buttons)].filter(l => l && l.href);
  return { mail: links.find(l => /^mailto:/i.test(l.href)), tel: links.find(l => /^tel:/i.test(l.href)) };
}
function presetModel(kind, name) {
  const m = viewModel(), brand = m.brand || 'us', c = siteContacts(m), cta = m.navCta || (m.hero.buttons[0] || null);
  const reach = c.mail ? { text: 'Email us', href: c.mail.href } : cta ? { text: cta.text, href: cta.href } : { text: 'Get in touch', href: '#' };
  const ph = 'Placeholder words — double-click any of them to write your own.';
  if (kind === 'about') return { hero: hero('About', `About ${brand}`, `Who you are, what you do and who it’s for, in a sentence or two. ${ph}`), sections: [
    sec({ title: 'How it started', intro: ['When and why you started, and what has changed since.', 'Keep it short and specific: a date, a place, a first customer.'] }),
    sec({ title: 'What we care about', cards: [card('First thing', 'One line on why it matters to you.'), card('Second thing', 'One line on how it shows in your work.'), card('Third thing', 'One line your customers would recognise.')] }),
    sec({ title: 'Work with us', intro: ['Say what someone should do next.'], buttons: [reach] }),
  ] };
  if (kind === 'contact') return { hero: hero('Contact', 'Get in touch', `How quickly you reply, and the best way to reach you. ${ph}`), sections: [
    sec({ title: 'Send a message', forms: [{ fields: ['Your name', 'Email', 'Your message'], submit: 'Send' }] }),
    sec({ title: 'Other ways to reach us', cards: [card('Email', c.mail ? c.mail.href.replace(/^mailto:/i, '') : 'you@example.com'), card('Phone', c.tel ? c.tel.href.replace(/^tel:/i, '') : 'Your phone number'), card('Visit', 'Your address, and when you’re open')] }),
  ] };
  if (kind === 'pricing') return { hero: hero('Pricing', 'Plans and prices', `What every plan includes, and how to choose. ${ph}`), sections: [
    sec({ title: 'Plans', cards: ['Starter', 'Standard', 'Pro'].map((t, i) => ({ ...card(t, ['Price / month', 'Price / month', 'Price / month'][i], ['Who it’s for', 'What it adds', 'What it adds on top'][i]), buttons: [{ text: `Choose ${t}`, href: reach.href }] })) }),
    sec({ title: 'Common questions', lists: [{ title: 'Can I change plans later?', text: 'Your answer.' }, { title: 'Is there a contract?', text: 'Your answer.' }, { title: 'How do I pay?', text: 'Your answer.' }] }),
    sec({ title: 'Not sure which plan?', intro: ['Tell people how to ask.'], buttons: [reach] }),
  ] };
  if (kind === 'faq') return { hero: hero('Questions', 'Questions and answers', `The things people ask most. ${ph}`), sections: [
    sec({ title: 'Before you start', lists: [{ title: 'First question people ask', text: 'Your answer.' }, { title: 'Second question', text: 'Your answer.' }, { title: 'Third question', text: 'Your answer.' }] }),
    sec({ title: 'Still have a question?', intro: ['Say where to ask.'], buttons: [reach] }),
  ] };
  return { hero: hero('', name || 'New page', 'Drag components onto this page from the left.'), sections: [] };
}
function uniquePage(p, name) {
  const pages = pagesOf(p), names = new Set(pages.map(x => x.name.toLowerCase())), slugs = new Set(pages.map(x => x.slug));
  let n = name, i = 2; while (names.has(n.toLowerCase())) n = `${name} ${i++}`;
  let s = slug(n) || 'page'; const base = s; i = 2; while (slugs.has(s) || s === 'index') s = `${base}-${i++}`;
  return { name: n, slug: s };
}
const pagesSnap = p => JSON.stringify({ pages: ensurePages(p), pageId: curPageId(p), blocks: p.blocks, edits: p.edits || [] });
const pagesRestore = snap => { Object.assign(B.project, JSON.parse(snap)); B.sel = null; saveProject(); renderEditorWs(); };
function addPage(kind) {
  const p = B.project; if (!p) return;
  const snap = pagesSnap(p), from = pageRec(curPageId(p), p), label = (PRESETS.find(x => x[0] === kind) || PRESETS[0])[1];
  const { name, slug: sl } = uniquePage(p, kind === 'copy' ? `${from.name} copy` : kind === 'blank' ? 'New page' : label);
  const rec = { id: 'pg' + Date.now().toString(36), name, slug: sl, inNav: true };
  if (kind === 'copy') {
    const m = pageModel(p);
    rec.model = { hero: structuredClone(m.hero), sections: structuredClone(m.sections) };
    rec.blocks = structuredClone(p.blocks); rec.edits = structuredClone((p.edits || []).filter(e => !isSiteWide(e, p.edits)));
  } else rec.model = presetModel(kind, name);
  p.pages.push(rec);
  loadPage(p, rec.id); B.sel = null; S.scrollAt = 0;
  saveProject(); renderEditorWs();
  toastUndo(`Added the page “${name}” — it’s in your menu, in your site’s style`, () => pagesRestore(snap));
}
function switchPage(id) {
  const p = B.project; if (!p || curPageId(p) === id) return;
  if (!loadPage(p, id)) return;
  B.sel = null; S.scrollAt = 0; S.reveal = null;
  saveProject(); renderEditorWs();
}
function pageMenu(id, x, y) {
  const p = B.project, pg = pageRec(id, p); if (!pg) return;
  const items = [{ label: 'Rename…', icon: '✎', run: () => {
    const v = prompt('Page name', pg.name); if (!v || !v.trim() || v.trim() === pg.name) return;
    const snap = pagesSnap(p), u = uniquePage({ pages: pagesOf(p).filter(x => x !== pg) }, v.trim());
    pg.name = u.name; if (pg.id !== HOME) pg.slug = u.slug;
    saveProject(); renderEditorWs(); toastUndo(`Renamed to “${pg.name}”`, () => pagesRestore(snap));
  } }];
  if (pg.id !== HOME) {
    items.push({ label: pg.inNav === false ? 'Show it in the menu' : 'Leave it out of the menu', icon: pg.inNav === false ? '☰' : '◌', run: () => {
      const snap = pagesSnap(p); pg.inNav = pg.inNav === false; saveProject(); renderStudioPreview();
      toastUndo(pg.inNav ? `“${pg.name}” is in your menu` : `“${pg.name}” isn’t in your menu any more (it still downloads)`, () => pagesRestore(snap));
    } });
    items.push('-', { label: 'Remove this page', icon: '✕', danger: true, run: () => {
      const snap = pagesSnap(p);
      if (curPageId(p) === pg.id) loadPage(p, HOME);
      p.pages = p.pages.filter(x => x !== pg); B.sel = null;
      saveProject(); renderEditorWs(); toastUndo(`Removed the page “${pg.name}”`, () => pagesRestore(snap), null, { ms: 12000, loud: true });
    } });
  }
  openCtx(x, y, items);
}

/* ---- the page bar, under the stage's toolbar ---- */
function paintPageBar() {
  const prev = document.querySelector('#stBody .st-prev'), tool = prev && prev.querySelector('.st-tool'); if (!tool || !B.project) return;
  let bar = $('pgBar'); if (bar) bar.remove();
  const p = B.project, pages = pagesOf(p), cur = curPageId(p);
  bar = document.createElement('div'); bar.id = 'pgBar'; bar.className = 'pg-bar';
  bar.innerHTML = `<div class="pg-tabs" role="tablist" aria-label="Pages">${pages.map(pg => `<button type="button" role="tab" class="pg-tab${pg.id === cur ? ' on' : ''}${pg.inNav === false ? ' off' : ''}" data-pg="${esc(pg.id)}" aria-selected="${pg.id === cur}" title="${pg.id === cur ? 'Right-click to rename' + (pg.id === HOME ? '' : ', leave out of the menu or remove') : 'Go to ' + esc(pg.name)}">${esc(pg.name)}${pg.inNav === false ? ' <small>not in menu</small>' : ''}${pg.id === cur ? '<i class="pg-more" aria-hidden="true">⋯</i>' : ''}</button>`).join('')}</div>
    <button type="button" class="pg-add" id="pgAdd" title="Add a page in your site’s style">＋ Page</button>`;
  tool.after(bar);
  bar.querySelectorAll('[data-pg]').forEach(b => {
    b.onclick = e => { const id = b.dataset.pg; if (id === curPageId(p) && e.target.closest('.pg-more')) { const r = b.getBoundingClientRect(); return pageMenu(id, r.left, r.bottom + 4); } if (id === curPageId(p)) return; switchPage(id); };
    b.oncontextmenu = e => { e.preventDefault(); pageMenu(b.dataset.pg, e.clientX, e.clientY); };
  });
  $('pgAdd').onclick = () => {
    const r = $('pgAdd').getBoundingClientRect();
    openCtx(r.left, r.bottom + 4, PRESETS.map(([k, l, hint, icon]) => ({ label: k === 'copy' ? `Copy of “${pageRec(curPageId(p), p).name}”` : l, hint, icon, run: () => addPage(k) })));
  };
}
const _renderEditorWs = renderEditorWs;
renderEditorWs = function () { const r = _renderEditorWs.apply(this, arguments); paintPageBar(); return r; };

/* ---- links between pages in the previews: a click on one goes there ---- */
function pageLinkScript(p, preview) {
  if (!preview || pagesOf(p).length < 2) return '';
  return `<script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href*="#rk-page-"]');if(!a)return;e.preventDefault();var id=(a.getAttribute('href').split('#rk-page-')[1]||'');parent.postMessage({rkGoPage:id},'*');},true);<\/script>`;
}
addEventListener('message', e => {
  const d = e.data || {}; if (!d.rkGoPage || !B.project) return;
  const mf = !$('modal').hidden && $('mStage').querySelector('iframe'), sf = $('stFrame') && $('stFrame').querySelector('iframe');
  if (sf && e.source === sf.contentWindow) return switchPage(d.rkGoPage);
  if (mf && e.source === mf.contentWindow && state.current && state.current._built) {
    if (!loadPage(B.project, d.rkGoPage)) return;
    B.sel = null; saveProject();
    $('mName').textContent = `${B.project.name} · ${pageRec(d.rkGoPage).name}`;
    setModalDoc(composeDoc({ preview: true }), { live: true });
    if (state.view === 'studio' && $('stBody')) renderEditorWs();
  }
});

/* ---- download every page together ---- */
// every page's finished file: [{ name, file, html }]. Goes through each page and comes back to the one you're on.
function sitePages(p = B.project) {
  const back = curPageId(p), out = [];
  try { for (const pg of pagesOf(p)) { loadPage(p, pg.id); out.push({ name: pg.name, file: pageFile(pg), html: composeDoc({ preview: false }) }); } }
  finally { loadPage(p, back); }
  return out;
}
// the components used on any page (to fix their package versions before downloading)
function usedOnAllPages(p = B.project) {
  const ids = new Set();
  const take = (edits, blocks) => { (edits || []).forEach(e => { if (e.compId) ids.add(e.compId); if (e.action && e.action.compId) ids.add(e.action.compId); }); (blocks || []).forEach(b => b.kind === 'comp' && ids.add(b.compId)); };
  take(p.edits, p.blocks); pagesOf(p).forEach(pg => take(pg.edits, pg.blocks));
  return [...ids].map(compById).filter(Boolean);
}
function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
// one page: the .html file, as before; several: one .zip with index.html, about.html…
function downloadSite(p = B.project, note = '') {
  const files = sitePages(p);
  if (files.length < 2) { downloadBlob(new Blob([files[0].html], { type: 'text/html' }), `${slug(p.name || 'site')}.html`); return 'this file is your whole site'; }
  downloadBlob(zipFiles(files.map(f => [f.file, f.html])), `${slug(p.name || 'site')}.zip`);
  return `${files.length} pages in one .zip — open index.html`;
}
// a plain .zip (stored, not compressed): enough for a handful of HTML files, no library needed
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipFiles(list) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, text] of list) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(h, nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(c, nm);
    off += 30 + nm.length + data.length;
  }
  const size = central.reduce((n, x) => n + x.byteLength, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, list.length, true); e.setUint16(10, list.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}
