/* Reskin Studio — one tab, three connected workspaces on the same project:
   - Site:      pick a template (look) for your existing page
   - Component: save UI pieces into your account (or this browser)
   - Editor:    drag a component onto a button / heading / card / section of your page;
                Studio asks a few plain questions (new or replacing? what does it say? what happens on click?)
                and writes the code behind the scenes.
   Edits live in B.project.edits and are applied by a small runtime inside the composed page,
   so the Build tab, "Open full page" and "Download site" all include them.
   Needs engine.js, app.js, builder.js. */

const S = {
  ws: 'editor',        // (legacy) Studio is one stage now
  device: 'desktop',
  tryIt: false,        // editor preview: run click actions instead of selecting
  mode: 'edit',        // Studio stage: 'edit' (drop & click) · 'blocks' (the page as a list of parts) · 'links' (node view)
  parts: { page: [], comps: {} },   // clickable parts reported by the preview, for the node view
  wireFrom: null,      // node view: a "from" dot that was clicked, waiting for a "to" dot
  focus: null,         // "Edit in detail": { scope, label, frame? } — one section (or component) on its own
  drag: null,          // component id being dragged from the rail
  sel: null,           // { addr, info } or { editId } — what's selected in the preview
  ask: null,           // the question flow (see startAsk)
  picking: null,       // 'opener' while waiting for "click the button that opens it"
  innerPick: null,     // edit id whose component is open for "click a part of it"
  armed: null,         // component id picked by clicking (instead of dragging): the next click on the page places it
};

// bento tile sizes (columns × rows of the page's grid)
const TILE_SIZES = [['auto', 'Auto', 'Picks a size from the component’s shape'], ['s', 'Small', '1×1'], ['wide', 'Wide', '2×1'], ['tall', 'Tall', '1×2'], ['big', 'Big', '2×2'], ['band', 'Band', 'full width, 1 row'], ['full', 'Full width', 'full width, 2 rows']];
const sizeName = v => (TILE_SIZES.find(x => x[0] === v) || TILE_SIZES[0])[1];
const sizeChips = (cur, attr) => `<div class="st-sizes">${TILE_SIZES.map(([v, n, d]) => `<button type="button" ${attr}="${v}" class="${cur === v ? 'on' : ''}" title="${d}"><i class="sz-${v}"></i>${n}</button>`).join('')}</div>`;
const KIND_NAMES = { button: 'button', link: 'link', heading: 'heading', text: 'text', image: 'image', card: 'card', section: 'section', node: 'part' };
const isClicky = k => k === 'button' || k === 'link';
const quote = s => `“${String(s || '').trim().slice(0, 40)}${String(s || '').trim().length > 40 ? '…' : ''}”`;
const newEditId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function projectEdits() {
  const p = B.project; if (!p.edits) p.edits = [];
  // a section can be removed in Build: drop the changes that pointed into it
  const ok = sc => sc === 'nav' || sc === 'footer' || p.blocks.some(b => b.id === sc);
  if (p.edits.some(e => !ok(e.target.scope))) p.edits = p.edits.filter(e => ok(e.target.scope));
  return p.edits;
}
const editById = id => (B.project && B.project.edits || []).find(e => e.id === id);
const sameAddr = (a, b) => a && b && a.scope === b.scope && a.kind === b.kind && a.idx === b.idx;
function blockLabel(id) { const b = B.project.blocks.find(x => x.id === id); return b ? b.label : 'that part'; }

/* ------------------------------------------------------------------ code that runs inside the page */
// Runs inside one component's frame. The frame never sizes itself: it reports where its content is
// (box) and how far it reaches (sw/sh), and the page decides how big the frame is. That's what stops
// full-screen components (min-h-screen, 100vh) from growing forever.
function __rkElem(D) {
  var SEL = 'button,a,[role=button],input[type=submit],input[type=button]';
  function label() {
    if (!D.text) return;
    var b = document.querySelector(SEL); if (!b) return;
    if (b.tagName === 'INPUT') { b.value = D.text; return; }
    var w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), best = null, n;
    while ((n = w.nextNode())) if (n.nodeValue.trim() && (!best || n.nodeValue.trim().length > best.nodeValue.trim().length)) best = n;
    if (best) { if (best.nodeValue.trim() !== D.text) best.nodeValue = D.text; } else b.appendChild(document.createTextNode(D.text));
  }
  // where the content is, ignoring full-screen wrappers (a min-h-screen div is not "content")
  function box() {
    if (!document.body) return null;
    var vw = innerWidth, vh = innerHeight, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length && i < 3000; i++) {
      var el = all[i]; if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT|BR)$/.test(el.tagName)) continue;
      var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      if (r.width >= vw * 0.97 && r.height >= vh * 0.9) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    if (x1 <= x0) return null;
    return { x: Math.floor(x0 + scrollX), y: Math.floor(y0 + scrollY), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0), full: (x1 - x0) >= vw * 0.85 && (y1 - y0) >= vh * 0.6 };
  }
  var last = '';
  function report() {
    var b = box(), de = document.documentElement;
    var msg = { rkE: D.id, box: b, sw: de.scrollWidth, sh: de.scrollHeight, vw: innerWidth, vh: innerHeight };
    var k = JSON.stringify(msg); if (k !== last) { last = k; parent.postMessage(msg, '*'); }
  }
  // ---- parts of the component that are linked to the site (a folder, a file, a menu item…)
  // the clickable thing is the outermost element of a pointer-cursor run (cursor is inherited), or a real control
  function partOf(el) {
    var best = null;
    for (var x = el; x && x.nodeType === 1 && x !== document.body; x = x.parentElement) {
      if (x.matches('button,a,[role=button],[role=menuitem],[role=tab],input,select,textarea,summary,label')) return x;
      if (getComputedStyle(x).cursor === 'pointer') best = x; else if (best) break;
    }
    return best || el;
  }
  function labelOf(el) {
    var t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || el.innerText || el.textContent || '').trim().split('\n')[0];
    return t.replace(/\s+/g, ' ').slice(0, 40) || ({ div: 'Box', span: 'Text', a: 'Link', button: 'Button', img: 'Picture', svg: 'Icon', li: 'List item', ul: 'List', section: 'Section', article: 'Card', canvas: 'Animation', video: 'Video', input: 'Field' })[el.tagName.toLowerCase()] || 'Part';
  }
  function pathOf(el) {
    var parts = [];
    for (var x = el; x && x !== document.body && x.parentElement; x = x.parentElement) {
      var i = 1, s = x; while ((s = s.previousElementSibling)) if (s.tagName === x.tagName) i++;
      parts.unshift(x.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
    }
    return 'body>' + parts.join('>');
  }
  function resolve(l) {   // by its place in the page; if the component re-arranged itself, by its words
    var el = null; try { el = document.querySelector(l.path); } catch (e) {}
    if (el && (!l.label || labelOf(el) === l.label)) return el;
    var all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) if (labelOf(all[i]) === l.label && partOf(all[i]) === all[i]) return all[i];
    return el;
  }
  var LINKS = D.links || [], PICK = false, ph = null;
  var pst = document.createElement('style');
  pst.textContent = '[data-rk-ph]{outline:2px dashed #ff5b37!important;outline-offset:2px;cursor:crosshair!important}[data-rk-linked]{outline:2px solid #2f9e5b!important;outline-offset:2px}';
  (document.head || document.documentElement).appendChild(pst);
  function markLinked(on) {
    document.querySelectorAll('[data-rk-linked]').forEach(function (x) { x.removeAttribute('data-rk-linked'); });
    if (on) LINKS.forEach(function (l) { var el = resolve(l); if (el) el.setAttribute('data-rk-linked', ''); });
  }
  addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.rkListParts) {
      var seen = [], parts = [], all = document.body ? document.body.getElementsByTagName('*') : [];
      for (var i = 0; i < all.length && parts.length < 40; i++) {
        var el = all[i]; if (/^(SCRIPT|STYLE|SVG|PATH|svg|path)$/.test(el.tagName)) continue;
        var pt = partOf(el); if (pt !== el || seen.indexOf(el) >= 0) continue;
        var isCtl = el.matches('button,a,[role=button],[role=menuitem],[role=tab],summary,label') || getComputedStyle(el).cursor === 'pointer';
        var r = el.getBoundingClientRect(); if (!isCtl || r.width < 4 || r.height < 4) continue;
        seen.push(el); parts.push({ path: pathOf(el), label: labelOf(el) });
      }
      parent.postMessage({ rkPartsOf: { id: D.id, parts: parts } }, '*');
    }
    if ('rkPickMode' in d) { PICK = d.rkPickMode || false; if (!PICK && ph) { ph.removeAttribute('data-rk-ph'); ph = null; } markLinked(PICK === true); }
    if (d.rkPickParent) { var cur = resolve(d.rkPickParent), up = cur && cur.parentElement; if (up && up !== document.body && up !== document.documentElement) parent.postMessage({ rkInnerPick: { id: D.id, path: pathOf(up), label: labelOf(up), detail: true, cs: snap(up) } }, '*'); }
    if (d.rkInnerSet) { var it = d.rkInnerSet, at = -1; INNER.forEach(function (x, i) { if (x.path === it.path) at = i; }); if (at >= 0) INNER[at] = it; else INNER.push(it); applyInner(it); }
  });
  // "Edit in detail": any part can be chosen (not just clickable ones), and its edits are applied here
  var INNER = D.inner || [];
  function detailOf(el) { if (el.closest && el.closest('svg')) return el.closest('svg'); return el; }
  function snap(el) {
    var cs = getComputedStyle(el), own = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.nodeValue;
    var bg = cs.backgroundColor; for (var x = el; x && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent'); x = x.parentElement) bg = getComputedStyle(x).backgroundColor;
    return { color: cs.color, bg: bg, fs: parseFloat(cs.fontSize), pad: parseFloat(cs.paddingTop), mt: parseFloat(cs.marginTop), mb: parseFloat(cs.marginBottom), radius: parseFloat(cs.borderTopLeftRadius), align: cs.textAlign,
      text: own.trim() ? (el.innerText || el.textContent || '').trim().slice(0, 400) : null, tag: el.tagName.toLowerCase() };
  }
  function setTxt(el, t) {
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), best = null, n;
    while ((n = w.nextNode())) if (n.nodeValue.trim() && (!best || n.nodeValue.trim().length > best.nodeValue.trim().length)) best = n;
    if (best) { if (best.nodeValue !== t) best.nodeValue = t; } else el.textContent = t;
  }
  function applyInner(it) {
    var el = resolve(it); if (!el) return;
    if (it.text != null) setTxt(el, it.text);
    if (it.style) Object.keys(it.style).forEach(function (k) { if (it.style[k] === '' || it.style[k] == null) el.style.removeProperty(k); else el.style.setProperty(k, it.style[k], 'important'); });
    if (it.hide) el.style.setProperty('display', 'none', 'important'); else if (el.style.getPropertyPriority('display') === 'important' && el.style.display === 'none') el.style.removeProperty('display');
  }
  function applyAllInner() { INNER.forEach(applyInner); }
  document.addEventListener('mousemove', function (e) {
    if (!PICK) return; var el = e.altKey ? null : PICK === 'detail' ? detailOf(e.target) : partOf(e.target);
    if (ph && ph !== el) ph.removeAttribute('data-rk-ph'); ph = el; if (el) el.setAttribute('data-rk-ph', '');
  }, true);
  document.addEventListener('click', function (e) {
    if (PICK) {
      if (e.altKey) { setTimeout(function () { markLinked(true); }, 400); return; }   // Alt-click: use it normally (open a folder first…)
      e.preventDefault(); e.stopPropagation();
      var el = PICK === 'detail' ? detailOf(e.target) : partOf(e.target);
      parent.postMessage({ rkInnerPick: { id: D.id, path: pathOf(el), label: labelOf(el), detail: PICK === 'detail', cs: snap(el) } }, '*');
      return;
    }
    for (var i = 0; i < LINKS.length; i++) {
      var el2 = resolve(LINKS[i]);
      if (el2 && el2.contains(e.target)) {
        if (e.target.closest('a[href]')) e.preventDefault();   // the part keeps its own effect, but doesn't navigate the frame
        parent.postMessage({ rkAct: D.id, link: i }, '*'); return;
      }
    }
  }, true);

  if (D.act) document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest(SEL);
    if (!t && D.mode === 'fit') return;
    e.preventDefault(); parent.postMessage({ rkAct: D.id }, '*');
  }, true);
  addEventListener('load', function () { label(); applyAllInner(); report(); });
  addEventListener('resize', function () { setTimeout(report, 60); });
  // frameworks may re-render after load: keep re-applying the edits for a while, then on every change
  var n = 0, iv = setInterval(function () { if (n < 12) label(); applyAllInner(); report(); if (++n > 25) { clearInterval(iv); setInterval(report, 2000); } }, 350);
  if (INNER.length) try { new MutationObserver(function () { clearTimeout(iv.t); iv.t = setTimeout(applyAllInner, 60); }).observe(document.documentElement, { subtree: true, childList: true }); } catch (e) {}
}

// the page runtime: applies edits (bento tiles, swapped buttons), runs click actions,
// and (in the editor) lets you pick / drop onto parts of the page
function __rkStudio(EDITS, MODE) {
  var KINDS = { button: 'a.btn,button.btn,.btns a', link: 'ul a', image: 'img', heading: 'h1,h2,h3', text: 'p,blockquote', card: 'article.card,figure.quote,.list li' };
  var ORDER = ['button', 'link', 'image', 'heading', 'text', 'card'], ONLY = null;
  var SIZES = { s: [1, 1], wide: [2, 1], tall: [1, 2], big: [2, 2], full: [4, 2], band: [4, 1] };
  function root(scope) {
    if (scope === 'nav') return document.querySelector('header.nav,aside.side');
    if (scope === 'footer') return document.querySelector('footer');
    return document.querySelector('.rk-block[data-block="' + scope + '"]');
  }
  function find(t) {
    var r = root(t.scope); if (!r) return null; if (t.kind === 'section') return r;
    if (t.kind === 'node') { try { return t.path ? r.querySelector(':scope>' + t.path) : r; } catch (e) { return null; } }
    return r.querySelectorAll(KINDS[t.kind])[t.idx] || null;
  }
  function pathFrom(r, el) {
    var parts = [];
    for (var x = el; x && x !== r; x = x.parentElement) { var i = 1, s = x; while ((s = s.previousElementSibling)) if (s.tagName === x.tagName) i++; parts.unshift(x.tagName.toLowerCase() + ':nth-of-type(' + i + ')'); }
    return parts.join('>');
  }
  function snapEl(el) {
    var cs = getComputedStyle(el), own = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.nodeValue;
    var bg = cs.backgroundColor; for (var x = el; x && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent'); x = x.parentElement) bg = getComputedStyle(x).backgroundColor;
    return { color: cs.color, bg: bg, fs: parseFloat(cs.fontSize), pad: parseFloat(cs.paddingTop), mt: parseFloat(cs.marginTop), mb: parseFloat(cs.marginBottom), radius: parseFloat(cs.borderTopLeftRadius), align: cs.textAlign,
      text: own.trim() ? (el.innerText || el.textContent || '').trim().slice(0, 400) : null, tag: el.tagName.toLowerCase() };
  }
  function scopeOf(el) {
    var b = el.closest('.rk-block'); if (b) return b.getAttribute('data-block');
    if (el.closest('header.nav,aside.side')) return 'nav';
    if (el.closest('footer')) return 'footer';
    return null;
  }
  function info(el, kind) {
    var h = (kind === 'card' || kind === 'section') && el.querySelector('h1,h2,h3,h4,b,blockquote');
    var txt = kind === 'image' ? (el.getAttribute('alt') || 'image') : ((h || el).innerText || (h || el).textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return { kind: kind, label: txt, href: el.getAttribute && el.getAttribute('href') || '' };
  }
  var TAGNAME = { div: 'Box', span: 'Text', p: 'Paragraph', h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', a: 'Link', button: 'Button', img: 'Picture', svg: 'Icon', ul: 'List', ol: 'List', li: 'List item', section: 'Section', header: 'Header', footer: 'Footer', nav: 'Menu', article: 'Card', figure: 'Figure', blockquote: 'Quote', form: 'Form', input: 'Field', video: 'Video', canvas: 'Animation' };
  function nameOf(el) {
    var t = (el.innerText || '').trim().replace(/\s+/g, ' ');
    if (t) return t.slice(0, 40);
    var tag = el.tagName.toLowerCase(), alt = el.getAttribute && (el.getAttribute('alt') || el.getAttribute('aria-label'));
    return alt ? alt.slice(0, 40) : (TAGNAME[tag] || 'Part');
  }
  var FOCUS = null;   // "Edit in detail": one section is shown, and any part of it can be chosen
  function targetOf(node) {
    if (FOCUS) {
      var fr = root(FOCUS); if (!fr || !fr.contains(node)) return null;
      var t0 = node.nodeType === 1 ? node : node.parentElement;
      var ed = t0.closest && t0.closest('[data-rk-edit]'); if (ed) return { el: ed, editId: ed.getAttribute('data-rk-edit') };
      if (t0.closest('svg')) t0 = t0.closest('svg');
      return { el: t0, addr: { scope: FOCUS, kind: 'node', path: pathFrom(fr, t0) }, info: { kind: 'node', label: nameOf(t0), href: t0.getAttribute('href') || '', cs: snapEl(t0) } };
    }
    for (var el = node; el && el.nodeType === 1 && el !== document.body; el = el.parentElement) {
      if (el.classList.contains('rk-tag')) return null;
      var eid = el.getAttribute('data-rk-edit');
      if (eid && !ONLY) return { el: el, editId: eid };
      var kinds = ONLY || ORDER;
      for (var i = 0; i < kinds.length; i++) {
        var k = kinds[i];
        if (el.matches(KINDS[k])) {
          var sc = scopeOf(el); if (!sc) continue;
          var idx = Array.prototype.indexOf.call(root(sc).querySelectorAll(KINDS[k]), el);
          if (idx >= 0) return { el: el, addr: { scope: sc, kind: k, idx: idx }, info: info(el, k) };
        }
      }
      if (eid) return { el: el, editId: eid };
      if (!ONLY && el.classList.contains('rk-block')) return { el: el, addr: { scope: el.getAttribute('data-block'), kind: 'section', idx: 0 }, info: info(el, 'section') };
    }
    return null;
  }
  function frame(id, doc, title) {
    var f = document.createElement('iframe');
    f.setAttribute('data-rke', id); f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox'); f.title = title;
    f.style.cssText = 'position:absolute;left:0;top:0;border:0;background:transparent;transform-origin:0 0;color-scheme:normal';
    if (MODE === 'edit') f.style.pointerEvents = 'none';
    f.srcdoc = doc; return f;
  }

  // ---- frames: "crop" shows just the content (buttons), "fit" scales the content into a tile
  // scroll this page only (scrollIntoView would also scroll the editor page around the preview)
  function goTo(el, where) { var r = el.getBoundingClientRect(); scrollTo({ top: Math.max(0, r.top + scrollY - (where === 'center' ? (innerHeight - r.height) / 2 : 0)), behavior: 'smooth' }); }
  var F = window.__rkFrames = {};   // frame state (handy when debugging a layout)
  var PAD = 14, CROP_W = 900, CROP_H = 360;
  function fit(k) {
    var tw = k.tile.clientWidth, th = k.tile.clientHeight; if (!tw || !th) return;
    k.vw = Math.round(tw / k.s); k.vh = Math.round(th / k.s);
    k.f.style.width = k.vw + 'px'; k.f.style.height = k.vh + 'px'; k.f.style.transform = 'scale(' + k.s + ')';
  }
  function setSize(tile, size, rows) {
    var cr = SIZES[size] || SIZES.big;
    tile.className = tile.className.replace(/\brk-[cr]\d\b/g, '').trim() + ' rk-c' + cr[0] + ' rk-r' + (rows || cr[1]);
  }
  function resize(k, size, rows) { setSize(k.tile, size, rows); k.s = 1; k.adj = 0; fit(k); }
  // Auto size: judge the content's shape at the starting 2×2 tile (and once more if it went full width), then never again
  function autoSize(k, b, d) {
    var colW = (k.tile.clientWidth - 20) / 2, ar = b.w / Math.max(b.h, 1);
    if (b.full || d.sh > d.vh * 1.3 || d.sw > d.vw * 1.1 || b.h > d.vh * 1.15 || b.w > d.vw * 1.1) return 'full';   // wants more room than a 2×2 tile
    if (ar >= 2.4) return b.w > colW * 2.2 ? 'band' : 'wide';
    if (ar <= 0.7) return 'tall';
    return b.w < colW * 1.1 && b.h < 170 ? 's' : 'big';
  }
  function onReport(d) {
    var k = F[d.rkE]; if (!k) return;
    if (k.mode === 'crop') {
      if (!d.box) return;
      k.wrap.style.width = (d.box.w + 2 * PAD) + 'px'; k.wrap.style.height = (d.box.h + 2 * PAD) + 'px';
      k.f.style.left = -(d.box.x - PAD) + 'px'; k.f.style.top = -(d.box.y - PAD) + 'px';
      k.wrap.style.visibility = 'visible'; return;
    }
    if (!k.vw || Math.abs(d.vw - k.vw) > 3 || Math.abs(d.vh - k.vh) > 3) return;   // a report from before the last resize
    // how much room the content needs: its scroll extent, or its own box (centred content can overflow upwards too)
    var needW = Math.max(d.sw, d.box ? d.box.w + 24 : 0), needH = Math.max(d.sh, d.box ? d.box.h + 24 : 0);
    if (d.box && !d.box.full) { needW = Math.max(needW, d.box.x + d.box.w + 12); needH = Math.max(needH, d.box.y + d.box.h + 12, d.box.y < 0 ? d.box.h - d.box.y + 24 : 0); }
    if (k.auto && k.stage === 0 && d.box) {
      var size = autoSize(k, d.box, d); k.stage = size === 'full' ? 1 : 2; resize(k, size);
      if (!(Math.abs(d.vw - k.vw) <= 3 && Math.abs(d.vh - k.vh) <= 3)) return;   // the tile changed size: wait for a report at the new size
    }
    if (k.auto && k.stage === 1 && k.vw) {
      // full width: enough rows to show it at ~70% of its natural size, 2–4 rows
      k.stage = 2; var rows = Math.max(2, Math.min(4, Math.round(needH * 0.7 / 170)));
      if (rows !== 2) { resize(k, 'full', rows); if (!(Math.abs(d.vw - k.vw) <= 3 && Math.abs(d.vh - k.vh) <= 3)) return; }
    }
    // too big for the tile? scale it down (a few steps at most, so nothing can oscillate)
    if (k.adj < 4 && (needW > k.vw + 2 || needH > k.vh + 2)) { k.adj++; k.s = Math.max(0.2, k.s * Math.min(k.vw / needW, k.vh / needH)); fit(k); return; }
    // scaled down but now has lots of spare room (responsive content re-flowed into a wider layout): grow back once.
    // Only early on, so the last step is always a shrink that fits.
    var bw = d.box ? d.box.w + 24 : 0, bh = d.box ? d.box.h + 24 : 0;
    // Auto tiles: once it fits, give back rows it doesn't use (same width, so the layout inside doesn't change)
    if (k.auto && k.stage === 2 && d.box && !d.box.full) {
      k.stage = 3;
      var m = /rk-r(\d)/.exec(k.tile.className), cur = m ? +m[1] : 2, need = Math.max(1, Math.ceil((bh * k.s + 20) / 170));
      if (need < cur) { k.tile.className = k.tile.className.replace(/\brk-r\d\b/, 'rk-r' + need); fit(k); return; }
    }
    if (k.adj <= 1 && k.s < 1 && d.box && !d.box.full && bw < k.vw * 0.7 && bh < k.vh * 0.7) {
      k.adj++; k.s = Math.min(1, k.s * Math.min(k.vw / bw, k.vh / bh) * 0.92); fit(k);
    }
  }
  function cropFrame(e, el) {
    var w = document.createElement('span');
    w.className = 'rk-e rk-crop'; w.setAttribute('data-rk-edit', e.id);
    var r = el.getBoundingClientRect();
    w.style.cssText = 'display:inline-block;position:relative;overflow:hidden;vertical-align:middle;margin:-' + PAD + 'px;visibility:hidden;width:' + Math.round(r.width + 2 * PAD) + 'px;height:' + Math.round(r.height + 2 * PAD) + 'px';
    var f = frame(e.id, e.doc, 'component'); f.style.width = CROP_W + 'px'; f.style.height = CROP_H + 'px';
    w.appendChild(f); F[e.id] = { mode: 'crop', f: f, wrap: w };
    return w;
  }
  // editor: let clicks through to one tile's component so you can pick a part of it
  var PICK_ID = null;
  // a component's frame: a placed tile, or a block added in Blocks
  function frameOf(id) { return F[id] ? F[id].f : document.querySelector('iframe[data-rk="' + id + '"]'); }
  var PICK_HOW = true;
  function setPick(id, how) {
    var f0 = PICK_ID && frameOf(PICK_ID); if (f0) { f0.style.pointerEvents = 'none'; f0.contentWindow.postMessage({ rkPickMode: false }, '*'); }
    PICK_ID = id || null; PICK_HOW = how || true;
    var f1 = PICK_ID && frameOf(PICK_ID); if (f1) { f1.style.pointerEvents = 'auto'; f1.contentWindow.postMessage({ rkPickMode: PICK_HOW }, '*'); }
  }
  function tileFrame(id, doc, tile, auto) {
    var f = frame(id, doc, 'component'); tile.appendChild(f);
    f.addEventListener('load', function () { if (PICK_ID === id) setTimeout(function () { setPick(id); }, 300); });
    var k = F[id] = { mode: 'fit', f: f, tile: tile, s: 1, adj: 0, auto: auto, stage: 0 };
    if (window.ResizeObserver) new ResizeObserver(function () { fit(k); }).observe(tile);
    setTimeout(function () { fit(k); }, 0);
    return k;
  }
  // Bento: the tile joins the grid it's dropped into (cards, gallery…) and the rest reflows around it;
  // anywhere else it gets a bento row of its own (shared with other tiles dropped at the same spot)
  function isGroup(p) { var d = getComputedStyle(p).display; return /grid|flex/.test(d) && p.children.length >= 2 && !p.classList.contains('btns'); }
  function bentoSpot(el, e) {
    var p = el.parentElement;
    if (e.target.kind !== 'section' && p && isGroup(p)) {
      if (!p.classList.contains('rk-bento')) { p.classList.add('rk-bento'); Array.prototype.forEach.call(p.children, function (c) { c.classList.add('rk-cell'); }); }
      return { box: p, before: e.mode === 'replace' ? el : el.nextSibling };
    }
    var next = el.nextElementSibling;
    if (next && next.classList.contains('rk-bento-row')) return { box: next.querySelector('.rk-bento'), before: null };
    var row;
    if (e.target.kind === 'section') { row = document.createElement('section'); row.className = 'sec rk-bento-row'; row.innerHTML = '<div class="wrap"><div class="rk-bento"></div></div>'; }
    else { row = document.createElement('div'); row.className = 'rk-bento-row'; row.innerHTML = '<div class="rk-bento"></div>'; }
    el.parentNode.insertBefore(row, el.nextSibling);
    return { box: row.querySelector('.rk-bento'), before: null };
  }

  // ---- apply the edits (find every target first, so replacing one doesn't shift the others)
  var byId = {};
  EDITS.forEach(function (e) { e._el = find(e.target); byId[e.id] = e; });
  function setText(el, t) {
    if (!el.children.length) { el.textContent = t; return; }
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), best = null, n;
    while ((n = w.nextNode())) if (n.nodeValue.trim() && (!best || n.nodeValue.trim().length > best.nodeValue.trim().length)) best = n;
    if (best) best.nodeValue = t; else el.appendChild(document.createTextNode(t));
  }
  EDITS.forEach(function (e) {
    var el = e._el; if (!el) return;
    if (e.mode === 'text') { setText(el, e.text || ''); return; }
    if (e.mode === 'style') { Object.keys(e.style || {}).forEach(function (k) { if (e.style[k] !== '' && e.style[k] != null) el.style.setProperty(k, e.style[k], 'important'); }); return; }
    if (e.mode === 'hide') {
      if (MODE === 'edit') { el.style.opacity = '.28'; el.style.outline = '2px dashed #9a948b'; el.title = 'Hidden on your site — right-click to show it again'; }
      else el.style.display = 'none';
      return;
    }
    if (e.doc && e.inline) {
      var w = cropFrame(e, el);
      if (e.mode === 'replace') { el.parentNode.insertBefore(w, el); el.style.display = 'none'; }
      else el.parentNode.insertBefore(w, el.nextSibling);
    } else if (e.doc) {
      var L = e.layout || { flow: true, size: 'auto' };
      var tile = document.createElement('div');
      tile.className = 'rk-e rk-tile'; tile.setAttribute('data-rk-edit', e.id);
      if (L.flow) {
        setSize(tile, L.size === 'auto' ? 'big' : L.size);
        var spot = bentoSpot(el, e);
        spot.box.insertBefore(tile, spot.before && spot.before.parentNode === spot.box ? spot.before : null);
      } else {
        // keep everything where it is: take the old element's exact space (or a band below it)
        var r = el.getBoundingClientRect(), cr = SIZES[L.size] || SIZES.big;
        tile.style.cssText = 'width:100%;height:' + Math.max(e.mode === 'replace' ? Math.round(r.height) : cr[1] * 170, 120) + 'px';
        el.parentNode.insertBefore(tile, e.mode === 'replace' ? el : el.nextSibling);
      }
      if (e.mode === 'replace') el.style.display = 'none';
      tileFrame(e.id, e.doc, tile, L.flow && L.size === 'auto');
    } else if (e.action) el.setAttribute('data-rk-edit', e.id);
  });

  // ---- actions
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function openPop(e) {
    closePop();
    var d = document.createElement('div'); d.className = 'rk-pop-bg';
    d.innerHTML = '<div class="rk-pop-box"><div class="rk-pop-in"></div><button class="rk-pop-x" aria-label="Close" type="button">×</button></div>';
    document.body.appendChild(d); pop = d;
    tileFrame('pop-' + e.id, e.popDoc, d.querySelector('.rk-pop-in'), false);
    d.addEventListener('click', function (ev) { if (ev.target === d || ev.target.classList.contains('rk-pop-x')) closePop(); });
  }
  function run(e) {
    var a = e.action; if (!a || MODE === 'edit' || MODE === 'show') return;
    if (a.type === 'keep' && a.href) {   // "goes where the old button went": scroll in the page for #links, else follow it
      if (a.href.charAt(0) === '#') { var to = a.href.length > 1 && document.getElementById(a.href.slice(1)); if (to) goTo(to); else if (a.href === '#') scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (MODE === 'try') window.open(a.href, '_blank', 'noopener'); else location.href = a.href;
    }
    if (a.type === 'link' && a.href) { if (a.newTab || MODE === 'try') window.open(a.href, '_blank', 'noopener'); else location.href = a.href; }
    if (a.type === 'section') { var t = document.querySelector('.rk-block[data-block="' + a.block + '"]'); if (t) goTo(t); }
    if (a.type === 'top') scrollTo({ top: 0, behavior: 'smooth' });
    if (a.type === 'popup' && e.popDoc) openPop(e);
  }
  addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closePop(); });
  addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (d.rkE) onReport(d);
    if (d.rkAct && byId[d.rkAct]) {
      var be = byId[d.rkAct];
      if (d.link != null) { var l = (be.links || [])[d.link]; if (l) run({ id: be.id + '-' + d.link, action: l.action, popDoc: l.popDoc }); }
      else run(be);
    }
    if (d.rkInnerPick && MODE === 'edit') parent.postMessage({ rkInnerPick: d.rkInnerPick }, '*');
    if (d.rkPartsOf && MODE === 'edit') parent.postMessage({ rkPartsOf: d.rkPartsOf }, '*');
    if (d.rkListParts && MODE === 'edit') {
      var page = [], scopes = [['nav', root('nav')]];
      Array.prototype.forEach.call(document.querySelectorAll('.rk-block'), function (b) { scopes.push([b.getAttribute('data-block'), b]); });
      scopes.forEach(function (sc) {
        if (!sc[1]) return;
        ['button', 'link'].forEach(function (k) {
          Array.prototype.forEach.call(sc[1].querySelectorAll(KINDS[k]), function (el, i) {
            if (el.closest('.rk-tile,.rk-crop')) return;
            page.push({ addr: { scope: sc[0], kind: k, idx: i }, label: info(el, k).label, href: el.getAttribute('href') || '' });
          });
        });
      });
      parent.postMessage({ rkPartsOf: { page: page } }, '*');
      Object.keys(F).forEach(function (id) { if (F[id].mode === 'fit' && F[id].f.contentWindow) F[id].f.contentWindow.postMessage({ rkListParts: true }, '*'); });
    }
    if ('rkInner' in d && MODE === 'edit') setPick(d.rkInner, d.detail ? 'detail' : true);
    if (d.rkInnerSet && MODE === 'edit') { var tf = frameOf(d.rkInnerSet.frame); if (tf) tf.contentWindow.postMessage({ rkInnerSet: d.rkInnerSet.item }, '*'); }
    if (d.rkSetStyle && MODE === 'edit') { var se = find(d.rkSetStyle.addr); if (se) Object.keys(d.rkSetStyle.style).forEach(function (k) { var v = d.rkSetStyle.style[k]; if (v === '' || v == null) se.style.removeProperty(k); else se.style.setProperty(k, v, 'important'); }); }
    if (d.rkSetText && MODE === 'edit') { var sx = find(d.rkSetText.addr); if (sx) setText(sx, d.rkSetText.text); }
    if (d.rkDetailAddr && MODE === 'edit') {
      var da = d.rkDetailAddr, de = find(da), dr = root(da.scope);
      if (de && dr) {
        document.querySelectorAll('[data-rk-on]').forEach(function (x) { x.removeAttribute('data-rk-on'); });
        de.setAttribute('data-rk-on', '');
        var node = { scope: da.scope, kind: 'node', path: de === dr ? '' : pathFrom(dr, de) };
        parent.postMessage({ rkPick: { addr: node, info: { kind: 'node', label: nameOf(de), href: de.getAttribute('href') || '', cs: snapEl(de) }, editId: null }, reveal: true }, '*');
      }
    }
    if (d.rkPickAddr && MODE === 'edit') { var pe = find(d.rkPickAddr); if (pe) { var pt = targetOf(pe); if (pt) { pe.setAttribute('data-rk-on', ''); parent.postMessage({ rkPick: { addr: pt.addr || null, info: pt.info || null, editId: pt.editId || null } }, '*'); } } }
    if (d.rkPickParent && MODE === 'edit') { var pf = frameOf(d.rkPickParent.frame); if (pf) pf.contentWindow.postMessage({ rkPickParent: d.rkPickParent.item }, '*'); }
    if ('rkFocus' in d && MODE === 'edit') {
      FOCUS = d.rkFocus || null;
      document.querySelectorAll('[data-rk-focus-on]').forEach(function (x) { x.removeAttribute('data-rk-focus-on'); });
      if (FOCUS) { var fe = root(FOCUS); if (fe) fe.setAttribute('data-rk-focus-on', ''); document.body.setAttribute('data-rk-focusing', ''); scrollTo(0, 0); }
      else document.body.removeAttribute('data-rk-focusing');
    }
  });

  var st = document.createElement('style');
  st.textContent =
    '.rk-bento{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;grid-auto-rows:minmax(150px,auto)!important;grid-auto-flow:row dense!important;gap:20px!important;align-items:stretch!important}' +
    '.rk-bento>*{min-width:0!important;margin:0!important;grid-column:span 1}.rk-bento-row>.rk-bento{margin:28px 0}' +
    '.rk-tile{position:relative;overflow:hidden;border-radius:var(--r,14px);min-height:150px}' +
    '.rk-bento>.rk-c1{grid-column:span 1}.rk-bento>.rk-c2{grid-column:span 2}.rk-bento>.rk-c4{grid-column:1/-1}' +
    '.rk-bento>.rk-r1{grid-row:span 1}.rk-bento>.rk-r2{grid-row:span 2}.rk-bento>.rk-r3{grid-row:span 3}.rk-bento>.rk-r4{grid-row:span 4}' +
    '@media (max-width:900px){.rk-bento{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
    '@media (max-width:560px){.rk-bento{grid-template-columns:1fr!important}.rk-bento>.rk-c2{grid-column:1/-1}}' +
    '.rk-pop-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(15,14,13,.55);display:grid;place-items:center;padding:16px;animation:rkFade .2s ease}' +
    '.rk-pop-box{position:relative;width:min(560px,100%);background:#fff;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden}' +
    '.rk-pop-in{position:relative;width:100%;height:min(520px,80vh);overflow:hidden}' +
    '.rk-pop-x{position:absolute;top:8px;right:8px;z-index:1;width:32px;height:32px;border-radius:50%;border:0;background:rgba(0,0,0,.08);font-size:20px;line-height:1;cursor:pointer}' +
    '@keyframes rkFade{from{opacity:0}}' +
    (MODE === 'edit' ? '[data-rk-hov]{outline:2px dashed #ff5b37!important;outline-offset:3px;cursor:pointer}[data-rk-on]{outline:3px solid #ff5b37!important;outline-offset:3px}' +
      '[data-rk-drop]{outline:3px solid #2f6bff!important;outline-offset:3px;background-color:rgba(47,107,255,.08)!important}' +
      '[data-rk-playing]{outline:3px solid #2f9e5b!important;outline-offset:3px}' +
      '.rk-bento{outline:1px dashed rgba(47,107,255,.35);outline-offset:8px}' +
      '.rk-tag{position:fixed;z-index:2147483001;pointer-events:none;font:600 11.5px/1 Inter,system-ui,sans-serif;background:#1d1b19;color:#fff;padding:5px 8px;border-radius:6px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;display:none}' : '');
  document.head.appendChild(st);

  if (MODE === 'edit') {
    // added components are frames: in the editor, clicks go to the page so they can be chosen, right-clicked, removed
    document.querySelectorAll('iframe.rk-comp').forEach(function (f) { f.style.pointerEvents = 'none'; f.addEventListener('load', function () { if (PICK_ID && frameOf(PICK_ID) === f) setTimeout(function () { setPick(PICK_ID, PICK_HOW); }, 300); }); });
    var fst = document.createElement('style');
    fst.textContent = 'body[data-rk-focusing] .rk-block:not([data-rk-focus-on]),body[data-rk-focusing] header.nav:not([data-rk-focus-on]),body[data-rk-focusing] footer:not([data-rk-focus-on]),body[data-rk-focusing] aside.side:not([data-rk-focus-on]){display:none!important}' +
      'body[data-rk-focusing]{padding:28px 0!important}body[data-rk-focusing] [data-rk-focus-on]{outline:2px dashed rgba(47,107,255,.45);outline-offset:6px}';
    document.head.appendChild(fst);
  }
  if (MODE !== 'edit') {
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-rk-edit]'); if (!el) return;
      var e = byId[el.getAttribute('data-rk-edit')]; if (!e || !e.action) return;
      ev.preventDefault(); ev.stopPropagation(); run(e);
    }, true);
    return;
  }

  // ---- editor: hover, click to select, drop components
  var tag = document.createElement('div'); tag.className = 'rk-tag'; document.body.appendChild(tag);
  var hov = null, drop = null;
  function mark(attr, el, old) { if (old && old !== el) old.removeAttribute(attr); if (el) el.setAttribute(attr, ''); return el; }
  function describe(t) {
    if (t.editId) return 'Your change — click to edit · double-click to use it';
    var n = t.info.kind === 'section' ? 'Section' : t.info.kind.charAt(0).toUpperCase() + t.info.kind.slice(1);
    return n + (t.info.label ? ' · ' + t.info.label.slice(0, 40) : '');
  }
  function showTag(t, x, y, pre) {
    if (!t) { tag.style.display = 'none'; return; }
    tag.textContent = (pre || '') + describe(t); tag.style.display = 'block';
    tag.style.left = Math.min(x + 14, innerWidth - tag.offsetWidth - 8) + 'px'; tag.style.top = Math.max(y - 30, 6) + 'px';
  }
  function plain(t) { return t ? { addr: t.addr || null, info: t.info || null, editId: t.editId || null } : null; }
  document.addEventListener('mousemove', function (ev) { var t = targetOf(ev.target); hov = mark('data-rk-hov', t && t.el, hov); if (!t && hov) { hov.removeAttribute('data-rk-hov'); hov = null; } showTag(t, ev.clientX, ev.clientY); });
  document.addEventListener('mouseleave', function () { if (hov) hov.removeAttribute('data-rk-hov'); hov = null; showTag(null); });
  var editing = null, before = '';
  var TEXTY = { heading: 1, text: 1, button: 1, link: 1, node: 1 };
  function startText(el, addr) {
    if (editing) finishText(true);
    editing = el; before = el.innerText; editing._addr = addr;
    el.contentEditable = 'true'; el.style.outline = '2px solid #2f6bff'; el.style.outlineOffset = '3px'; el.focus();
    var r = document.createRange(); r.selectNodeContents(el); var sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
  }
  function finishText(save) {
    var el = editing; if (!el) return; editing = null;
    el.contentEditable = 'false'; el.style.outline = ''; el.style.outlineOffset = '';
    var t = el.innerText.replace(/\s+/g, ' ').trim();
    if (!save || !t) { el.innerText = before; return; }
    if (t !== before.replace(/\s+/g, ' ').trim()) parent.postMessage({ rkText: { addr: el._addr, text: t, was: before.trim() } }, '*');
  }
  document.addEventListener('keydown', function (ev) {
    if (!editing) return;
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finishText(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); finishText(false); }
  }, true);
  document.addEventListener('focusout', function (ev) { if (editing && ev.target === editing) finishText(true); }, true);
  document.addEventListener('click', function (ev) {
    if (editing && editing.contains(ev.target)) return;   // placing the caret while typing
    ev.preventDefault(); ev.stopPropagation();
    if (editing) finishText(true);
    var t = targetOf(ev.target); if (!t) return;
    parent.postMessage({ rkPick: plain(t) }, '*');
  }, true);
  // double-click a component to use it (open a folder, flip a card…); click anywhere else to go back to editing
  var playing = null;
  function stopPlay() { if (!playing) return; playing.f.style.pointerEvents = 'none'; playing.box.removeAttribute('data-rk-playing'); playing = null; showTag(null); }
  function play(box) {
    var f = box.querySelector('iframe'); if (!f) return false;
    stopPlay(); playing = { f: f, box: box };
    f.style.pointerEvents = 'auto'; box.setAttribute('data-rk-playing', '');
    tag.textContent = '▶ Using it — click outside to go back to editing'; tag.style.display = 'block';
    var r = box.getBoundingClientRect(); tag.style.left = Math.max(8, r.left) + 'px'; tag.style.top = Math.max(6, r.top + 6) + 'px';
    return true;
  }
  document.addEventListener('mousedown', function (ev) { if (playing && !playing.box.contains(ev.target)) stopPlay(); }, true);
  addEventListener('keydown', function (ev) { if (ev.key === 'Escape') stopPlay(); });
  document.addEventListener('dblclick', function (ev) {
    var t = targetOf(ev.target); if (!t) return;
    if (t.editId && t.el.querySelector('iframe')) { ev.preventDefault(); play(t.el); return; }
    if (t.addr && t.addr.kind === 'section' && t.el.querySelector('iframe.rk-comp')) { ev.preventDefault(); play(t.el); return; }
    if (!t.addr || !TEXTY[t.addr.kind]) return;
    ev.preventDefault(); startText(t.el, t.addr);
  }, true);
  document.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    if (editing) finishText(true);
    var t = targetOf(ev.target); if (!t) return;
    hov = mark('data-rk-hov', t.el, hov);
    var hid = t.el.style.opacity === '0.28';
    parent.postMessage({ rkCtx: plain(t), x: ev.clientX, y: ev.clientY, hidden: hid }, '*');
  }, true);
  document.addEventListener('submit', function (ev) { ev.preventDefault(); }, true);
  document.addEventListener('dragover', function (ev) {
    ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    var t = targetOf(ev.target);
    drop = mark('data-rk-drop', t && t.el, drop); if (!t && drop) { drop.removeAttribute('data-rk-drop'); drop = null; }
    showTag(t, ev.clientX, ev.clientY, 'Drop on ');
  });
  document.addEventListener('dragleave', function (ev) { if (!ev.relatedTarget) { if (drop) drop.removeAttribute('data-rk-drop'); drop = null; showTag(null); } });
  document.addEventListener('drop', function (ev) {
    ev.preventDefault();
    var t = targetOf(ev.target);
    if (drop) drop.removeAttribute('data-rk-drop'); drop = null; showTag(null);
    if (t) parent.postMessage({ rkDrop: plain(t) }, '*');
  });
  addEventListener('message', function (ev) {
    var d = ev.data || {};
    if ('rkOnly' in d) { ONLY = d.rkOnly ? ['button', 'link'] : null; }
    if (d.rkEditText) { var te = find(d.rkEditText); if (te) startText(te, d.rkEditText); }
    if ('rkHi' in d) {
      document.querySelectorAll('[data-rk-on]').forEach(function (x) { x.removeAttribute('data-rk-on'); });
      var el = null, h = d.rkHi;
      if (h && h.editId) el = document.querySelector('[data-rk-edit="' + h.editId + '"]');
      else if (h && h.addr) el = find(h.addr);
      if (el) { el.setAttribute('data-rk-on', ''); if (d.scroll) goTo(el, 'center'); }
    }
  });
}
/* ------------------------------------------------------------------ building the edits into the page */
// mode: 'crop' (a button: shown at its real size) or 'fit' (a tile or popup: scaled to fit)
function elemDoc(c, e, mode, act) {
  const html = compBlockDoc(c, { fill: 'own', recolor: !!e.recolor, props: e.props });
  const css = mode === 'crop'
    ? '<style>html{overflow:hidden!important}html,body{background:transparent!important}</style>'
    : '<style>html{overflow:hidden!important}</style>';
  const links = (e.links || []).map(l => ({ path: l.path, label: l.label }));
  return injectEnd(html, css + `<script>(${__rkElem})(${jsonForScript({ id: e.id, text: e.text || null, mode, act: !!act, links, inner: e.inner || [] })});<\/script>`);
}
// called by composeDoc (builder.js); mode: edit (Studio editor) · show (Build tab) · try (previews) · live (downloaded site)
function studioScript(p, mode) {
  const edits = (p.edits || []).map(e => {
    const c = e.compId && compById(e.compId), inline = isClicky(e.target.kind);
    const pc = e.action && e.action.type === 'popup' && compById(e.action.compId);
    return {
      id: e.id, target: e.target, mode: e.mode, inline, action: e.action || null, layout: e.layout || { flow: true, size: 'auto' }, text: e.mode === 'text' ? e.text : undefined, style: e.mode === 'style' ? e.style : undefined,
      links: (e.links || []).map((l, i) => { const lc = l.action && l.action.type === 'popup' && compById(l.action.compId); return { action: l.action, popDoc: lc ? elemDoc(lc, { id: 'pop-' + e.id + '-' + i, recolor: e.recolor }, 'fit', false) : null }; }),
      doc: c && e.mode !== 'action' ? elemDoc(c, { ...e, text: inline ? e.text : null }, inline ? 'crop' : 'fit', !!e.action) : null,
      popDoc: pc ? elemDoc(pc, { id: 'pop-' + e.id, recolor: e.recolor }, 'fit', false) : null,
    };
  });
  if (!edits.length && mode !== 'edit') return '';
  return `<script>(${__rkStudio})(${jsonForScript(edits)}, ${JSON.stringify(mode)});<\/script>`;
}
// "make all my buttons look like this one"
function btnCssFrom(b) {
  if (!b) return '';
  const c = x => Array.isArray(x) ? Cx.css(x) : x;
  const r = b.radius >= 999 ? '999px' : (b.radius || 0) + 'px';
  return `.btn:not(.alt){background:${c(b.bg)}!important;color:${c(b.text)}!important;border-radius:${r}!important;font-weight:${b.weight}!important;text-transform:${b.transform || 'none'}!important;letter-spacing:${b.ls === 'normal' ? 'normal' : b.ls}!important;box-shadow:${b.shadow || 'none'}!important;border:${b.bw || 0}px solid ${b.bw ? c(b.border) : 'transparent'}!important}
.btn.alt{color:${c(b.bg)}!important;border:2px solid ${c(b.bg)}!important;border-radius:${r}!important;background:transparent!important}`;
}

/* ------------------------------------------------------------------ describing a change in words */
function actionWords(a, e) {
  if (!a || a.type === 'none') return 'does nothing yet';
  if (a.type === 'keep') return `goes where the old button went${a.href && a.href !== '#' ? ` (${a.href})` : ''}`;
  if (a.type === 'link') return `opens ${a.href || 'a web page'}${a.newTab ? ' in a new tab' : ''}`;
  if (a.type === 'section') return `scrolls down to “${blockLabel(a.block)}”`;
  if (a.type === 'top') return 'scrolls back to the top';
  if (a.type === 'popup') { const c = compById(a.compId); return `pops up “${c ? c.name : 'a component'}”`; }
  return '';
}
function describeEdit(e) {
  const c = e.compId && compById(e.compId), what = c ? `“${c.name}”` : 'it';
  const t = quote(e.targetLabel || KIND_NAMES[e.target.kind]);
  let s = '';
  if (e.mode === 'text') return `Your ${KIND_NAMES[e.target.kind]} ${t} now says “${e.text}”.`;
  if (e.mode === 'hide') return `Your ${KIND_NAMES[e.target.kind] || 'part'} ${t} is hidden.`;
  if (e.mode === 'style') return `${quote(e.targetLabel || 'A part')} has a new look (${Object.keys(e.style || {}).map(k => k.replace(/-/g, ' ')).join(', ')}).`;
  if (e.mode === 'replace') s = `${what} replaces your ${KIND_NAMES[e.target.kind]} ${t}`;
  else if (e.mode === 'after') s = `${what} is added ${isClicky(e.target.kind) ? 'next to' : 'below'} your ${KIND_NAMES[e.target.kind]} ${t}`;
  else s = `Your ${KIND_NAMES[e.target.kind]} ${t}`;
  if (c && e.mode !== 'action' && isClicky(e.target.kind)) s += e.text ? ` and says “${e.text}”` : ', with its own words';
  if (c && e.mode !== 'action' && !isClicky(e.target.kind)) {
    const L = e.layout || { flow: true, size: 'auto' };
    s += L.flow ? `, as a ${L.size === 'auto' ? '' : sizeName(L.size).toLowerCase() + ' '}bento tile — the page rearranges around it`
      : e.mode === 'replace' ? `, fitted into the old ${KIND_NAMES[e.target.kind]}’s space — nothing else moves` : ', as a band below it — nothing else moves';
  }
  if (e.action) s += `. When someone clicks it, it ${actionWords(e.action, e)}`;
  if (e.links && e.links.length) s += `. ${e.links.length} part${e.links.length > 1 ? 's' : ''} inside ${e.links.length > 1 ? 'are' : 'is'} linked`;
  return s + '.';
}

/* ------------------------------------------------------------------ the Studio tab: one stage */
// your page in the middle, components on the left, questions on the right, styles in a filmstrip below
function renderStudio() {
  const box = $('studioView');
  if (!state.model) { box.innerHTML = '<div class="bx-panel bx-empty">Paste your site on the Explore tab first.</div>'; return; }
  ensureProject(); projectEdits();
  $('banner').innerHTML = '';
  if (B.pendingWizard) S.mode = 'blocks';
  const T = state.tgt && state.tgt.tokens;
  if (T && state.mood === 'target' && S.matched !== T.name) {
    S.matched = T.name;
    const exact = state.styles.find(st => st.exact && !st.live);
    if (exact) { B.project.style = exact; saveProject(); toast(`Your page — and Reskin — now look like “${T.name}”. Try the others below.`, 4500); }
  }
  box.innerHTML = `<div id="stBody"></div><div class="film" id="stFilm"></div>`;
  if (S.mode === 'blocks') renderBlocksWs(); else renderEditorWs();
  renderFilm();
  if (typeof wearStyle === 'function') wearStyle(B.project.style);
  if (B.pendingWizard) { const pw = B.pendingWizard; B.pendingWizard = null; startWizard(pw); }
}
const goWs = ws => { if (ws === 'component') return setView('library'); S.ask = null; S.picking = null; if (state.view !== 'studio') setView('studio'); else renderStudio(); };

// the stage's toolbar, shared by every mode
function stToolbar() {
  const hint = S.mode === 'blocks' ? 'drag parts to reorder, click one to change it' : S.mode === 'links' ? 'wire what’s clicked to where it goes' : S.tryIt ? 'clicks work like on the real site' : 'click, right-click or drop a component on any part';
  return `<div class="bx-h st-tool"><h3>${esc(B.project.name)} <small>· ${hint}</small></h3>
    <div class="bx-row">
      <div class="seg" id="stMode">${[['edit', 'Edit'], ['blocks', 'Blocks'], ['links', '🔗 Links']].map(([k, l]) => `<button data-m="${k}" class="${S.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${S.mode === 'edit' ? `<label class="found st-try" title="Click buttons to see what they do"><input type="checkbox" id="stTry" ${S.tryIt ? 'checked' : ''}> Try it</label>` : ''}
      <div class="seg" id="stDev"><button data-d="desktop" class="${S.device === 'desktop' ? 'on' : ''}">Desktop</button><button data-d="mobile" class="${S.device === 'mobile' ? 'on' : ''}">Mobile</button></div>
      <button class="icon st-gear" id="stGear" title="Page settings: colours, hero, images">⚙</button>
      <button class="ghost" id="stOpen">Open full page</button>
      <button class="primary" id="stDl" style="height:34px;padding:0 12px;font-size:13px">Download site</button>
    </div></div>`;
}
function wireStToolbar() {
  const p = B.project;
  $('stMode').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.mode = b.dataset.m; S.wireFrom = null; S.ask = null; S.picking = null; if (S.mode !== 'edit') S.tryIt = false; renderStudio(); };
  if ($('stTry')) $('stTry').onchange = e => { S.tryIt = e.target.checked; renderEditorWs(); };
  $('stDev').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; S.device = B.device = b.dataset.d;
    $('stDev').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    const fr = $('stFrame') || $('bdFrame'); if (fr) fr.className = 'bx-frame ' + S.device;
  };
  $('stGear').onclick = () => openGear();
  $('stOpen').onclick = () => {
    state.current = { ...p.style, name: p.name, label: 'Your built page', id: 'built-' + p.id, _built: true };
    $('mName').textContent = p.name; $('mInfo').textContent = 'Your page · buttons work like on the real site';
    $('modal').hidden = false; document.body.style.overflow = 'hidden';
    setModalDoc(composeDoc({ preview: true }), { live: true });
  };
  $('stDl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([composeDoc({ preview: false })], { type: 'text/html' }));
    a.download = `${slug(p.name || 'site')}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Downloaded — this file is your whole site, with your changes');
  };
}

// Blocks: the page as a stack of parts (what the Build tab was) — same project, same stage
function renderBlocksWs() {
  const p = B.project, body = $('stBody');
  B.device = S.device;
  body.innerHTML = `
    <div class="st-ed">
      <div class="bx-panel st-rail bd-blocks">
        <div class="bx-h"><h3>Your page <small>· drag to reorder</small></h3></div>
        <div class="bd-fixed"><label><input type="checkbox" id="bdNav" ${p.hideNav ? '' : 'checked'}> Menu bar</label><span>always on top</span></div>
        <div id="bdList"></div>
        <div class="bd-fixed"><label><input type="checkbox" id="bdFoot" ${p.hideFooter ? '' : 'checked'}> Footer</label><span>always at the bottom</span></div>
        <button class="bd-add" id="bdAdd">＋ Add a component</button>
        <label class="found" style="display:flex;gap:6px;align-items:center;margin:0 12px 8px" title="Apply 'when it shows' rules in this preview"><input type="checkbox" id="bdRules" ${B.rulesPreview ? 'checked' : ''}> Try show rules</label>
        <button class="ghost" id="bdReset" style="margin:0 12px 12px">Reset page</button>
      </div>
      <div class="bx-panel st-prev">${stToolbar()}<div class="st-stage"><div class="bx-frame ${S.device}" id="bdFrame"></div></div></div>
      <div class="bx-panel st-side bd-side" id="bdSide"></div>
    </div>`;
  wireStToolbar();
  renderBlockList(); renderSide(); renderBuildPreview();
  $('bdNav').onchange = e => { p.hideNav = !e.target.checked; saveProject(); renderBuildPreview(); };
  $('bdFoot').onchange = e => { p.hideFooter = !e.target.checked; saveProject(); renderBuildPreview(); };
  $('bdRules').onchange = e => { B.rulesPreview = e.target.checked; renderBuildPreview(); };
  $('bdAdd').onclick = () => startWizard({ after: B.sel });
  $('bdReset').onclick = () => { if (confirm('Put the page back to just your site’s own sections? Added components and changes are removed.')) { p.blocks = siteBlocks(state.model); p.edits = []; p.btnCss = ''; p.btnFrom = null; B.sel = null; B.wizard = null; saveProject(); renderStudio(); } };
}

// the filmstrip: every generated style, live on your page; click one to put it on
function renderFilm() {
  const box = $('stFilm'); if (!box || !B.project) return;
  const p = B.project;
  if (!state.styles.length) state.styles = batch(12, state.mood, true);
  const list = [], seen = new Set();
  [p.style, ...state.styles].forEach(st => { if (st && !seen.has(st.id)) { seen.add(st.id); list.push(st); } });
  const moods = [['all', 'All'], ...(state.tgt && state.tgt.tokens ? [['target', '✦ Like ' + state.tgt.name]] : []), ...ARCH_IDS.map(id => [id, ARCH[id].label])];
  box.innerHTML = `<div class="film-h"><b>Styles</b>
      <div class="chips film-moods">${moods.map(([k, l]) => `<button data-mood="${k}" class="${state.mood === k && !state.varOf ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      <span class="sp"></span>
      ${state.tgt && state.tgt.tokens ? `<button class="ghost" id="filmMotion" title="What the design animates, and how it's built">✦ How it moves</button>` : ''}
      <button class="ghost" id="filmLike" title="Variations of the style on your page">More like this</button>
      <button class="ghost" id="filmShuffle" title="A fresh batch">⟳ Shuffle</button>
      <button class="ghost" id="filmSave">${isSaved(p.style) ? '♥ Saved' : '♡ Save this style'}</button></div>
    ${state.varOf ? `<p class="found" style="margin:0 0 8px">More like “${esc(state.varOf.name)}”</p>` : ''}
    <div class="film-strip" id="filmStrip"></div>`;
  const strip = $('filmStrip');
  list.forEach(st => {
    const el = document.createElement('div');
    el.className = 'film-item' + (st.id === p.style.id ? ' on' : '') + (st.live ? ' live' : ''); el.dataset.id = st.id; el.tabIndex = 0;
    el.innerHTML = `<div class="film-th"><button class="film-zoom" title="Full preview">⤢</button></div><b>${esc(st.name)}</b><small>${st.live ? '✦ animated · preview only' : esc(st.label)}</small>`;
    const f = document.createElement('iframe'); f.setAttribute('sandbox', sandboxFor(st)); f.setAttribute('tabindex', '-1'); f.setAttribute('loading', 'lazy'); f.title = st.name;
    f.srcdoc = renderSite(viewModel(), st, { preview: true, thumb: true, base: state.base });
    el.querySelector('.film-th').prepend(f);
    const use = () => {
      if (st.live) { openModal(st); return; }
      p.style = st; saveProject();
      strip.querySelectorAll('.film-item').forEach(x => x.classList.toggle('on', x.dataset.id === st.id));
      $('filmSave').textContent = isSaved(st) ? '♥ Saved' : '♡ Save this style';
      if (typeof wearStyle === 'function') wearStyle(st);
      if (S.mode === 'blocks') renderBuildPreview(); else renderStudioPreview();
      const t = document.querySelector('.st-tool h3'); if (t) t.firstChild.textContent = p.name + ' ';
    };
    el.onclick = e => { if (e.target.closest('.film-zoom')) { openModal(st); return; } use(); };
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); use(); } };
    strip.appendChild(el);
  });
  box.querySelectorAll('[data-mood]').forEach(b => b.onclick = () => { state.mood = b.dataset.mood; state.varOf = null; state.styles = batch(12, state.mood, true); renderFilm(); });
  $('filmLike').onclick = () => showVariations(p.style);
  if ($('filmMotion')) $('filmMotion').onclick = () => showMotion();
  $('filmShuffle').onclick = () => { state.varOf = null; state.styles = batch(12, state.mood, true); renderFilm(); };
  $('filmSave').onclick = () => { toggleSave(p.style); $('filmSave').textContent = isSaved(p.style) ? '♥ Saved' : '♡ Save this style'; };
}

function applyStyleDialog(c) {
  const d = document.createElement('div'); d.className = 'st-dlg';
  d.innerHTML = `<div class="st-dlg-box"><h3>Apply “${esc(c.name)}”’s style to…</h3>
    ${c.id && compById(c.id) ? `<button class="st-opt" data-a="btns"><b>Just my buttons</b><span>Every button on your site gets this component’s colour, shape and lettering.</span></button>
    <button class="st-opt" data-a="site"><b>My whole site</b><span>New templates built from this component’s colours, fonts and effects. You pick one in Site.</span></button>` : '<p class="st-muted">That component has been deleted.</p>'}
    ${B.project.btnCss ? '<button class="st-opt" data-a="undo"><b>Put my buttons back</b><span>Remove the button style you applied earlier.</span></button>' : ''}
    <div class="bx-row" style="justify-content:flex-end;margin-top:6px"><button class="ghost" data-a="x">Cancel</button></div></div>`;
  document.body.appendChild(d);
  d.onclick = async e => {
    const a = (e.target.closest('[data-a]') || {}).dataset?.a;
    if (e.target === d || a === 'x') return d.remove();
    if (!a) return;
    d.remove();
    if (a === 'undo') { B.project.btnCss = ''; B.project.btnFrom = null; saveProject(); toast('Your buttons are back to the template’s style'); return renderStudio(); }
    if (a === 'btns') {
      toast('Reading the component…');
      const tk = await ensureCompTokens(c);
      if (!tk.btn) { toast('Couldn’t find a button in that component to copy', 4000); return; }
      B.project.btnCss = btnCssFrom(tk.btn); B.project.btnFrom = c.id; saveProject();
      toast(`All your buttons now look like “${c.name}”`);
      return goWs('editor');
    }
    if (a === 'site') {
      setTarget({ name: c.name, text: c.code, kind: c.kind, assets: new Map(), tokens: null });
      try {
        busy('Sampling the design…'); await loadTarget();
        if (!state.tgt.tokens) { toast(state.tgt.error || 'Couldn’t read that component', 5000); return; }
        busy('Reading your brand…'); await measureSource();
        state.mood = 'target'; renderChips(); state.styles = batch(12, 'target', true); state.varOf = null;
      } finally { busy(null); }
      toast(`New templates in the style of “${c.name}”`);
      goWs('site');
    }
  };
}

/* ---- 3. Editor ---- */
function renderEditorWs() {
  const p = B.project, body = $('stBody');
  const changes = [
    ...p.edits.map(e => ({ id: e.id, t: describeEdit(e), edit: true })),
    ...p.blocks.filter(b => b.kind === 'comp').map(b => ({ id: b.id, t: `“${b.label}” ${b.replaces ? 'replaces the section “' + labelOfRef(b.replaces) + '”' : 'is added as a new section'}.`, block: true })),
    ...(p.btnCss ? [{ id: '__btn', t: `All buttons are styled like “${(compById(p.btnFrom) || {}).name || 'a component'}”.`, btn: true }] : []),
  ];
  body.innerHTML = `
    <div class="st-ed">
      <div class="bx-panel st-rail">
        <div class="bx-h"><h3>Components <small>· drag onto your page, or click one then click the page</small></h3></div>
        <div class="st-chips" id="stRail">${comps.list.length ? '' : '<div class="bx-empty">No components yet.<br><br><button class="primary" id="stGoComp">Save some first</button></div>'}</div>
        <div class="bx-h" style="border-top:1px solid var(--line)"><h3>Changes <small>· ${changes.length}</small></h3></div>
        <div class="st-changes">${changes.length ? changes.map(c => `<button class="st-chg" data-chg="${c.id}" data-k="${c.edit ? 'e' : c.block ? 'b' : 'btn'}">${esc(c.t)}</button>`).join('') : '<p class="st-muted">Nothing yet. Drag a component onto your page.</p>'}</div>
      </div>
      <div class="bx-panel st-prev">
        ${stToolbar()}
        ${S.innerPick && editById(S.innerPick) ? `<div class="st-banner">🔗 Click the part of “${esc((compById(editById(S.innerPick).compId) || {}).name || 'it')}” to link. Alt-click uses it normally (e.g. open a folder first). <button class="ghost" id="stInnerX">Done</button></div>` : ''}
        ${S.focus ? `<div class="st-banner st-focusbar"><span>✎ Editing <b>${esc(S.focus.label)}</b> in detail — click any part of it${S.focus.frame ? ' (Alt-click uses it normally)' : ', double-click text to type'}.</span> <button class="primary" id="stFocusX" style="height:30px;padding:0 12px;font-size:12.5px">← Back to the page</button></div>` : ''}
        ${S.picking ? '<div class="st-banner">👆 Click the button on your page that should open it. <button class="ghost" id="stPickX">Cancel</button></div>' : S.armed && compById(S.armed) ? `<div class="st-banner">👆 Now click where “${esc(compById(S.armed).name)}” goes on your page. <button class="ghost" id="stArmX">Cancel</button></div>` : ''}
        <div class="st-stage"><div class="bx-frame ${S.device}" id="stFrame"></div><div class="st-nodes" id="stNodes" ${(S.mode === 'links') ? '' : 'hidden'}></div></div>
      </div>
      <div class="bx-panel st-side" id="stSide"></div>
    </div>`;
  // component rail
  const rail = $('stRail');
  comps.list.forEach(c => {
    const el = document.createElement('div');
    el.className = 'st-chip' + (S.flash === c.id ? ' flash' : ''); el.draggable = true; el.dataset.c = c.id;
    el.innerHTML = `<div class="th"></div><span>${esc(c.name)}</span><small>${esc(c.source)}</small>`;
    const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('tabindex', '-1'); f.setAttribute('loading', 'lazy');
    f.srcdoc = compThumbDoc(c); const th = el.querySelector('.th'); th.appendChild(f);
    const fit = () => { if (th.clientWidth) f.style.transform = `scale(${th.clientWidth / 600})`; }; fit(); new ResizeObserver(fit).observe(th);
    el.addEventListener('dragstart', e => { S.drag = c.id; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'reskin-component:' + c.id); el.classList.add('drag'); $('stFrame').classList.add('dropping'); });
    el.addEventListener('dragend', () => { el.classList.remove('drag'); const fr = $('stFrame'); if (fr) fr.classList.remove('dropping'); setTimeout(() => { S.drag = null; }, 400); });
    if (S.armed === c.id) el.classList.add('armed');
    el.onclick = () => {
      if (S.replaceAt) { const r = S.replaceAt; S.replaceAt = null; return r.editId ? startAsk({ compId: c.id, addr: editById(r.editId).target, info: { kind: editById(r.editId).target.kind, label: editById(r.editId).targetLabel, href: editById(r.editId).targetHref }, replacing: r.editId }) : startAsk({ compId: c.id, addr: r.addr, info: r.info }); }
      S.armed = S.armed === c.id ? null : c.id; S.ask = null; S.picking = null; renderEditorWs();
    };
    rail.appendChild(el);
  });
  S.flash = null;
  if ($('stGoComp')) $('stGoComp').onclick = () => goWs('component');
  body.querySelectorAll('[data-chg]').forEach(b => b.onclick = () => {
    const id = b.dataset.chg, k = b.dataset.k;
    if (k === 'e') { S.ask = null; S.sel = { editId: id }; renderSideStudio(); stPost({ rkHi: { editId: id }, scroll: true }); }
    else if (k === 'b') { B.sel = id; S.mode = 'blocks'; renderStudio(); }
    else applyStyleDialog(compById(p.btnFrom) || { name: 'component', id: null });
  });
  wireStToolbar();
  if ($('stFocusX')) $('stFocusX').onclick = leaveFocus;
  if ($('stInnerX')) $('stInnerX').onclick = () => { S.innerPick = null; stPost({ rkInner: null }); renderEditorWs(); };
  if ($('stArmX')) $('stArmX').onclick = () => { S.armed = null; renderEditorWs(); };
  if ($('stPickX')) $('stPickX').onclick = () => { S.picking = null; if (S.ask) S.ask.step = 'place'; renderEditorWs(); };
  renderStudioPreview();
  renderSideStudio();
}
function stPost(msg) { const f = $('stFrame') && $('stFrame').querySelector('iframe'); if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*'); }
function renderStudioPreview() {
  const box = $('stFrame'); if (!box) return;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox'); f.title = 'Your page';
  f.srcdoc = injectPreviewCss(composeDoc({ preview: true, rules: false, studio: S.tryIt ? 'try' : 'edit' }));
  f.onload = () => setTimeout(() => {
    if ((S.mode === 'links')) { renderNodes(); setTimeout(() => stPost({ rkListParts: true }), 1500); setTimeout(() => stPost({ rkListParts: true }), 5000); }
    if (S.picking) stPost({ rkOnly: true });
    if (S.innerPick) stPost({ rkInner: S.innerPick });
    if (S.focus) { stPost({ rkFocus: S.focus.scope }); if (S.focus.frame) setTimeout(() => stPost({ rkInner: S.focus.frame, detail: true }), 400); }
    const hi = S.sel && (S.sel.editId ? { editId: S.sel.editId } : { addr: S.sel.addr });
    if (hi) stPost({ rkHi: hi });
  }, 120);
  box.replaceChildren(f);
}

// messages from the editor preview
addEventListener('message', e => {
  const d = e.data || {};
  if (state.view !== 'studio' || S.mode === 'blocks' || !$('stFrame')) return;
  const f = $('stFrame').querySelector('iframe'); if (!f || e.source !== f.contentWindow) return;
  if (d.rkDrop) {
    const compId = S.drag; S.drag = null;
    if (!compId) return;
    if (d.rkDrop.editId) { const ed = editById(d.rkDrop.editId); if (ed) { S.sel = { editId: ed.id }; startAsk({ compId, addr: ed.target, info: { kind: ed.target.kind, label: ed.targetLabel, href: ed.targetHref }, replacing: ed.id }); } return; }
    startAsk({ compId, addr: d.rkDrop.addr, info: d.rkDrop.info });
  }
  if (d.rkText) { saveTextEdit(d.rkText.addr, d.rkText.text, d.rkText.was); return; }
  if (d.rkCtx) {
    const fr = $('stFrame').querySelector('iframe').getBoundingClientRect();
    openCtx(fr.left + d.x, fr.top + d.y, ctxItems(d.rkCtx, d.hidden));
    return;
  }
  if (d.rkPartsOf) {
    if (d.rkPartsOf.page) S.parts.page = d.rkPartsOf.page;
    if (d.rkPartsOf.id) S.parts.comps[d.rkPartsOf.id] = d.rkPartsOf.parts;
    if ((S.mode === 'links')) { clearTimeout(S._nt); S._nt = setTimeout(renderNodes, 120); }
    return;
  }
  if (d.rkInnerPick && d.rkInnerPick.detail && S.focus) {
    const ip = d.rkInnerPick; S.ask = null; S.sel = { inner: { frame: ip.id, path: ip.path, label: ip.label, cs: ip.cs } };
    renderSideStudio(); return;
  }
  if (d.rkInnerPick && S.innerPick) {   // a part inside a component was clicked: ask what it should do
    const ed = editById(d.rkInnerPick.id); if (!ed) return;
    const part = d.rkInnerPick; S.innerPick = null; stPost({ rkInner: null });
    if (S.backToLinks) {   // came from the node view: add the part there and let them wire it
      S.backToLinks = false; S.mode = 'links';
      const list = S.parts.comps[ed.id] || (S.parts.comps[ed.id] = []);
      if (!list.some(x => x.path === part.path)) list.push({ path: part.path, label: part.label });
      S.wireFrom = 'e:' + ed.id + '|' + part.path;
      renderEditorWs(); toast(`Now click where ${quote(part.label)} should go`); return;
    }
    const old = (ed.links || []).find(l => l.path === part.path);
    S.sel = { editId: ed.id };
    S.ask = { inner: { editId: ed.id, path: part.path, label: part.label }, compId: null, addr: ed.target, info: { kind: 'button', label: part.label, href: '' },
      place: 'action', step: 'click', recolor: !!ed.recolor, layout: { flow: true, size: 'auto' },
      action: old ? structuredClone(old.action) : { type: 'section', href: '', newTab: false, block: (B.project.blocks.find(b => !b.hidden) || {}).id || '', compId: '' } };
    renderEditorWs(); return;
  }
  if (d.rkPick) {
    const t = d.rkPick;
    if (S.picking === 'opener') {
      const ed = t.editId && editById(t.editId);
      if (ed && isClicky(ed.target.kind)) S.ask.opener = { editId: ed.id, addr: ed.target, info: { kind: ed.target.kind, label: ed.text || ed.targetLabel, href: ed.targetHref } };
      else if (t.addr && isClicky(t.addr.kind)) S.ask.opener = { addr: t.addr, info: t.info };
      else { toast('Click a button or a link'); return; }
      S.picking = null; S.ask.step = 'confirm';
      renderEditorWs(); return;
    }
    if (S.armed) {   // click-to-place: same questions as a drop
      const compId = S.armed; S.armed = null;
      $('stFrame').parentElement.querySelectorAll('.st-banner').forEach(b => b.remove());
      document.querySelectorAll('.st-chip.armed').forEach(c => c.classList.remove('armed'));
      if (t.editId) { const ed = editById(t.editId); if (ed) startAsk({ compId, addr: ed.target, info: { kind: ed.target.kind, label: ed.targetLabel, href: ed.targetHref }, replacing: ed.id }); }
      else startAsk({ compId, addr: t.addr, info: t.info });
      return;
    }
    S.ask = null; S.sel = t; S.propsFor = null; if (d.reveal) S.reveal = true;
    stPost({ rkHi: t.editId ? { editId: t.editId } : { addr: t.addr } });
    renderSideStudio();
  }
});

/* ---- the node view: wire parts (left) to where they go (right) ---- */
const addrKey = a => a.scope + '|' + a.kind + '|' + a.idx;
const tileEdits = () => projectEdits().filter(e => e.compId && e.mode !== 'action' && !isClicky(e.target.kind));
function nodeTargets() {
  const p = B.project, hrefs = new Set();
  const acts = [...projectEdits().map(e => e.action), ...projectEdits().flatMap(e => (e.links || []).map(l => l.action))];
  acts.forEach(a => { if (a && a.type === 'link' && a.href) hrefs.add(a.href); });
  return [
    { title: 'Sections of this page', icon: '↓', rows: p.blocks.filter(b => !b.hidden).map(b => ({ key: 's:' + b.id, label: b.label, action: { type: 'section', block: b.id } })) },
    { title: 'Back to top', icon: '↑', rows: [{ key: 'top', label: 'Top of the page', action: { type: 'top' } }] },
    { title: 'Pop up', icon: '◳', rows: comps.list.map(c => ({ key: 'p:' + c.id, label: c.name, action: { type: 'popup', compId: c.id } })) },
    { title: 'A web page', icon: '↗', rows: [...[...hrefs].map(h => ({ key: 'w:' + h, label: h, action: { type: 'link', href: h, newTab: true } })), { key: 'w:new', label: '＋ New address…', action: null }] },
  ];
}
const targetKey = a => !a ? null : a.type === 'section' ? 's:' + a.block : a.type === 'top' ? 'top' : a.type === 'popup' ? 'p:' + a.compId : a.type === 'link' ? 'w:' + a.href : null;
function nodeSources() {
  const edits = projectEdits(), out = [];
  const pageRows = S.parts.page.map(pp => {
    const ed = edits.find(e => sameAddr(e.target, pp.addr) && e.mode !== 'after');
    const label = ed && ed.text ? ed.text : pp.label;
    const act = ed ? ed.action : null;
    return { key: 'b:' + addrKey(pp.addr), label, sub: pp.addr.kind === 'link' ? 'menu link' : 'button', action: act, pp };
  });
  out.push({ title: 'Buttons on your page', rows: pageRows, empty: 'Reading your page…' });
  tileEdits().forEach(e => {
    const c = compById(e.compId); if (!c) return;
    const listed = S.parts.comps[e.id] || [], rows = [];
    [...listed, ...(e.links || []).filter(l => !listed.some(x => x.path === l.path))].forEach(pt => {
      const l = (e.links || []).find(x => x.path === pt.path);
      rows.push({ key: 'e:' + e.id + '|' + pt.path, label: pt.label, action: l ? l.action : null, editId: e.id, part: pt });
    });
    out.push({ title: c.name, editId: e.id, rows, empty: 'Reading its parts…' });
  });
  return out;
}
function setSourceAction(row, action) {
  const edits = projectEdits();
  if (row.editId) {
    const e = editById(row.editId), links = e.links || (e.links = []), i = links.findIndex(l => l.path === row.part.path);
    if (!action) { if (i >= 0) links.splice(i, 1); }
    else { const l = { path: row.part.path, label: row.part.label, action }; if (i >= 0) links.splice(i, 1, l); else links.push(l); }
  } else {
    const pp = row.pp, ed = edits.find(e => sameAddr(e.target, pp.addr) && e.mode !== 'after');
    if (ed) { ed.action = action; if (!action && ed.mode === 'action') edits.splice(edits.indexOf(ed), 1); }
    else if (action) edits.push({ id: newEditId(), target: pp.addr, targetLabel: pp.label, targetHref: pp.href, mode: 'action', compId: null, text: null, recolor: false, action });
  }
  saveProject();
}
function renderNodes() {
  const box = $('stNodes'); if (!box || !(S.mode === 'links')) return;
  const sources = nodeSources(), targets = nodeTargets(), rowsByKey = {};
  sources.forEach(n => n.rows.forEach(r => { rowsByKey[r.key] = r; }));
  const tByKey = {}; targets.forEach(n => n.rows.forEach(r => { tByKey[r.key] = r; }));
  const wired = sources.flatMap(n => n.rows.filter(r => r.action && tByKey[targetKey(r.action)]).map(r => ({ from: r.key, to: targetKey(r.action), r })));
  const used = new Set(wired.map(w => w.to));
  box.innerHTML = `
    ${S.wireFrom && rowsByKey[S.wireFrom] ? `<div class="nd-armed">👉 Now click where <b>${esc(quote(rowsByKey[S.wireFrom].label))}</b> should go, on the right. <button class="ghost" id="ndCancel">Cancel</button></div>`
      : '<div class="nd-help"><b>Drag from a dot on the left to where it should go on the right.</b> Or click a dot, then the other. Click a line to remove it.</div>'}
    <div class="nd-cols">
      <div class="nd-col"><div class="nd-colh">When someone clicks…</div>${sources.map(n => `
        <div class="nd-node"><div class="nd-title">${esc(n.title)}</div>
          ${n.rows.length ? n.rows.map(r => `<div class="nd-row"><span class="nd-lbl" title="${esc(r.label)}">${esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><button class="nd-dot nd-out ${S.wireFrom === r.key ? 'armed' : ''} ${r.action ? 'on' : ''}" data-from="${esc(r.key)}" title="Drag to where it should go"></button></div>`).join('') : `<p class="nd-empty">${n.empty}</p>`}
          ${n.editId ? `<button class="nd-add" data-pickpart="${n.editId}">＋ Pick a part in the preview</button>` : ''}
        </div>`).join('')}</div>
      <div class="nd-gap"></div>
      <div class="nd-col"><div class="nd-colh">…it goes to</div>${targets.map(n => `
        <div class="nd-node nd-to"><div class="nd-title"><i>${n.icon}</i>${esc(n.title)}</div>
          ${n.rows.length ? n.rows.map(r => `<div class="nd-row"><button class="nd-dot nd-in ${used.has(r.key) ? 'on' : ''}" data-to="${esc(r.key)}" title="Drop here"></button><span class="nd-lbl" title="${esc(r.label)}">${esc(r.label)}</span></div>`).join('') : '<p class="nd-empty">Save a component first.</p>'}
        </div>`).join('')}</div>
      <svg class="nd-wires" id="ndWires"></svg>
    </div>
    <div class="nd-list"><b>Your links</b>${wired.length ? wired.map(w => `<div class="st-link"><span class="st-chg">${esc(quote(w.r.label))} → ${esc(actionWords(w.r.action))}</span><button class="icon" data-unwire="${esc(w.from)}" title="Remove">✕</button></div>`).join('') : '<p class="st-muted">No links yet.</p>'}</div>`;

  const svg = $('ndWires'), cols = box.querySelector('.nd-cols');
  const ctr = el => { const r = el.getBoundingClientRect(), c = cols.getBoundingClientRect(); return [r.left + r.width / 2 - c.left, r.top + r.height / 2 - c.top]; };
  const curve = (a, b) => { const dx = Math.max(60, (b[0] - a[0]) / 2); return `M${a[0]},${a[1]} C${a[0] + dx},${a[1]} ${b[0] - dx},${b[1]} ${b[0]},${b[1]}`; };
  const dotOf = (attr, key) => box.querySelector(`[${attr}="${CSS.escape(key)}"]`);
  function drawWires(temp) {
    svg.setAttribute('width', cols.scrollWidth); svg.setAttribute('height', cols.scrollHeight);
    svg.innerHTML = wired.map(w => { const a = dotOf('data-from', w.from), b = dotOf('data-to', w.to); return a && b ? `<path class="nd-wire" data-unwire="${esc(w.from)}" d="${curve(ctr(a), ctr(b))}"><title>${esc(w.r.label)} → ${esc(actionWords(w.r.action))} (click to remove)</title></path>` : ''; }).join('')
      + (temp ? `<path class="nd-wire temp" d="${curve(temp[0], temp[1])}"/>` : '');
  }
  drawWires();
  if ($('ndCancel')) $('ndCancel').onclick = () => { S.wireFrom = null; renderNodes(); };
  // bring the picked button into view inside the node panel (not the whole page)
  const armed = S.wireFrom && box.querySelector('.nd-out.armed');
  if (armed && !box._shown) { box._shown = S.wireFrom; const r = armed.getBoundingClientRect(), b = box.getBoundingClientRect(); box.scrollTop += r.top - b.top - 90; armed.closest('.nd-row').classList.add('nd-flash'); }
  if (!S.wireFrom) box._shown = null;
  if (!box._ro) { box._ro = new ResizeObserver(() => (S.mode === 'links') && renderNodesWires()); box._ro.observe(box); }
  S._drawWires = drawWires;

  function connect(fromKey, toKey) {
    const row = rowsByKey[fromKey]; if (!row) return;
    let t = tByKey[toKey]; if (!t) return;
    let action = t.action;
    if (toKey === 'w:new') {
      const h = (prompt('Web address it should open (https://…)') || '').trim(); if (!h) return;
      action = { type: 'link', href: /^(https?:|mailto:|tel:|#)/i.test(h) ? h : 'https://' + h, newTab: true };
    }
    setSourceAction(row, action); S.wireFrom = null;
    toast(`${quote(row.label)} → ${actionWords(action)}`);
    renderNodes(); renderStudioPreview(); renderSideStudio();
  }
  // drag a wire, or click one dot then the other
  box.querySelectorAll('.nd-out').forEach(dot => dot.onpointerdown = ev => {
    ev.preventDefault(); const from = dot.dataset.from, start = ctr(dot), x0 = ev.clientX, y0 = ev.clientY; let moved = false;
    const move = e => { if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 6) moved = true; const c = cols.getBoundingClientRect(); drawWires([start, [e.clientX - c.left, e.clientY - c.top]]); };
    const up = e => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      const over = document.elementFromPoint(e.clientX, e.clientY), to = over && over.closest('.nd-in');
      if (to) return connect(from, to.dataset.to);
      drawWires();
      if (!moved) { S.wireFrom = S.wireFrom === from ? null : from; box._shown = S.wireFrom; renderNodes(); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  box.querySelectorAll('.nd-in').forEach(dot => dot.onclick = () => { if (S.wireFrom) connect(S.wireFrom, dot.dataset.to); else toast('Start from a dot on the left'); });
  box.querySelectorAll('[data-unwire]').forEach(el => el.onclick = () => { const row = rowsByKey[el.dataset.unwire]; if (!row) return; setSourceAction(row, null); toast('Link removed'); renderNodes(); renderStudioPreview(); });
  box.querySelectorAll('[data-pickpart]').forEach(b => b.onclick = () => { S.mode = 'edit'; S.backToLinks = true; S.innerPick = b.dataset.pickpart; renderEditorWs(); });
}
// "Change what it does when clicked": straight to the node view with this button's dot already picked
function openLinksFor(addr, label) {
  S.mode = 'links'; S.ask = null; S.picking = null; S.tryIt = false;
  S.wireFrom = 'b:' + addrKey(addr); S.wireLabel = label || 'it';
  renderStudio();
}
function renderNodesWires() { if (S._drawWires && $('ndWires')) S._drawWires(); }

/* ---- "Edit in detail": one section or component on its own, every part editable ---- */
const blockById = id => B.project.blocks.find(b => b.id === id);
function focusOn(t) {
  let scope, label, frame = null;
  if (t.editId) { const e = editById(t.editId); if (!e) return; scope = e.target.scope; frame = e.compId && !isClicky(e.target.kind) ? e.id : null; label = (compById(e.compId) || {}).name || 'this part'; }
  else { scope = t.addr.scope; const b = blockById(scope); frame = b && b.kind === 'comp' ? b.id : null; label = b ? b.label : scope === 'nav' ? 'Menu bar' : scope === 'footer' ? 'Footer' : 'this section'; }
  if (scope === 'nav' || scope === 'footer') { toast('The menu bar and footer can be edited part by part right on the page'); return; }
  S.mode = 'edit'; S.tryIt = false; S.ask = null; S.sel = null; S.focus = { scope, label, frame };
  renderEditorWs();
  toast(frame ? `Click any part of “${label}” to change it` : `Click any part of “${label}” to change it — or double-click text to type`, 3500);
}
function leaveFocus() { S.focus = null; S.sel = null; stPost({ rkFocus: null }); stPost({ rkInner: null }); renderEditorWs(); }
function removeBlock(id) {
  const arr = B.project.blocks, b = blockById(id); if (!b) return;
  const i = arr.indexOf(b);
  if (b.replaces) arr.splice(i, 1, ...siteBlocks(state.model).filter(x => x.ref === b.replaces)); else arr.splice(i, 1);
  B.project.edits = projectEdits().filter(e => e.target.scope !== id);
  if (S.focus && S.focus.scope === id) S.focus = null;
  S.sel = null; saveProject(); toast(`Removed “${b.label}”${b.replaces ? ' — your own section is back' : ''}`); renderStudio();
}
// what's already been changed on this part
function detailState(t) {
  if (t.inner) {
    const owner = editById(t.inner.frame) || blockById(t.inner.frame), it = owner && (owner.inner || []).find(x => x.path === t.inner.path);
    return { owner, text: it && it.text, style: (it && it.style) || {}, hide: !!(it && it.hide) };
  }
  const edits = projectEdits(), a = t.addr;
  const st = edits.find(e => e.mode === 'style' && sameAddr(e.target, a)), tx = edits.find(e => e.mode === 'text' && sameAddr(e.target, a)), hd = edits.find(e => e.mode === 'hide' && sameAddr(e.target, a));
  return { text: tx && tx.text, style: (st && st.style) || {}, hide: !!hd };
}
const toHex = c => { try { return rgbToHex(cssToRgb(c)); } catch { return '#000000'; } };
function renderDetail(t) {
  const side = $('stSide'), inner = t.inner, cs = (inner ? inner.cs : t.info && t.info.cs) || {}, label = inner ? inner.label : (t.info && t.info.label) || 'this part';
  const cur = detailState(t), st = { ...cur.style }, px = (k, d) => st[k] != null && st[k] !== '' ? parseFloat(st[k]) : d;
  const text = cur.text != null ? cur.text : cs.text;
  const row = (id, name, min, max, val, unit = 'px') => `<label class="dt-row"><span>${name}</span><input type="range" id="${id}" min="${min}" max="${max}" value="${Math.round(val || 0)}"><output id="${id}V">${Math.round(val || 0)}${unit}</output></label>`;
  side.innerHTML = `<div class="bx-h"><h3>✎ ${esc(quote(label))} <small>${esc(cs.tag || '')}</small></h3><button class="icon" id="dtX" title="Close">✕</button></div>
    <div class="bx-pad dt">
      ${text && String(text).trim() ? `<label class="field"><span>Text</span><textarea id="dtText" rows="${Math.min(6, Math.ceil(text.length / 34) + 1)}">${esc(text)}</textarea></label>` : ''}
      <div class="dt-cols">
        <label class="dt-col"><span>Text colour</span><input type="color" id="dtColor" value="${toHex(st.color || cs.color)}"></label>
        <label class="dt-col"><span>Background</span><input type="color" id="dtBg" value="${toHex(st['background-color'] || cs.bg)}"></label>
      </div>
      ${row('dtFs', 'Text size', 8, 140, px('font-size', cs.fs))}
      ${row('dtPad', 'Padding', 0, 120, px('padding', cs.pad))}
      ${row('dtMt', 'Space above', 0, 160, px('margin-top', cs.mt))}
      ${row('dtMb', 'Space below', 0, 160, px('margin-bottom', cs.mb))}
      ${row('dtR', 'Corners', 0, 80, Math.min(80, px('border-radius', cs.radius)))}
      <div class="dt-row"><span>Align</span><div class="seg" id="dtAlign">${['left', 'center', 'right'].map(a => `<button data-a="${a}" class="${(st['text-align'] || cs.align) === a || (a === 'left' && /start/.test(st['text-align'] || cs.align)) ? 'on' : ''}">${a === 'left' ? '⟸' : a === 'center' ? '⟺' : '⟹'}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="dtHide" ${cur.hide ? 'checked' : ''}> Hide this part</label>
      <div class="dt-acts">
        <button class="ghost" id="dtUp" title="Choose the part this sits in">⬆ The part around it</button>
        ${!inner && t.addr && (/^(a|button)$/.test(cs.tag) || t.info.href) ? '<button class="ghost" id="dtLink">🔗 When clicked…</button>' : ''}
        <button class="ghost" id="dtReset" style="color:#b2341a">↺ Reset this part</button>
      </div>
      <p class="st-muted">Changes show as you make them and are saved with your page.</p>
    </div>`;
  const touched = new Set(Object.keys(st));
  const read = () => {
    const out = {};
    const take = (k, v) => { if (touched.has(k)) out[k] = v; };
    take('color', $('dtColor').value); take('background-color', $('dtBg').value);
    take('font-size', $('dtFs').value + 'px'); take('padding', $('dtPad').value + 'px');
    take('margin-top', $('dtMt').value + 'px'); take('margin-bottom', $('dtMb').value + 'px'); take('border-radius', $('dtR').value + 'px');
    if (touched.has('text-align')) out['text-align'] = st['text-align'];
    return out;
  };
  const live = () => {
    const style = read(), hide = $('dtHide').checked, txt = $('dtText') ? $('dtText').value : null;
    if (inner) stPost({ rkInnerSet: { frame: inner.frame, item: { path: inner.path, label: inner.label, text: txt != null && txt !== cs.text ? txt : cur.text, style, hide } } });
    else { stPost({ rkSetStyle: { addr: t.addr, style: { ...style, display: hide ? 'none' : '' } } }); if (txt != null && txt !== text) stPost({ rkSetText: { addr: t.addr, text: txt } }); }
  };
  const save = () => {
    const style = read(), hide = $('dtHide').checked, txt = $('dtText') ? $('dtText').value.trim() : null;
    if (inner) {
      const owner = cur.owner; if (!owner) return;
      const list = owner.inner || (owner.inner = []), i = list.findIndex(x => x.path === inner.path);
      const item = { path: inner.path, label: inner.label, style, hide, text: txt != null && txt !== (cs.text || '').trim() ? txt : (cur.text || null) };
      if (i >= 0) list.splice(i, 1, item); else list.push(item);
    } else {
      const edits = projectEdits(), a = t.addr, has = m => edits.find(e => e.mode === m && sameAddr(e.target, a));
      const se = has('style');
      if (Object.keys(style).length) { if (se) se.style = style; else edits.push({ id: newEditId(), target: a, targetLabel: label, mode: 'style', style }); } else if (se) edits.splice(edits.indexOf(se), 1);
      const he = has('hide'); if (hide && !he) edits.push({ id: newEditId(), target: a, targetLabel: label, mode: 'hide' }); if (!hide && he) edits.splice(edits.indexOf(he), 1);
      if (txt != null && txt && txt !== (text || '').trim()) { const te = has('text'); if (te) te.text = txt; else edits.push({ id: newEditId(), target: a, targetLabel: label, mode: 'text', text: txt }); }
    }
    saveProject();
  };
  const bind = (id, k) => { const el = $(id); el.oninput = () => { touched.add(k); if ($(id + 'V')) $(id + 'V').textContent = el.value + 'px'; live(); }; el.onchange = save; };
  bind('dtColor', 'color'); bind('dtBg', 'background-color'); bind('dtFs', 'font-size'); bind('dtPad', 'padding'); bind('dtMt', 'margin-top'); bind('dtMb', 'margin-bottom'); bind('dtR', 'border-radius');
  if ($('dtText')) { $('dtText').oninput = live; $('dtText').onchange = save; }
  $('dtHide').onchange = () => { live(); save(); };
  $('dtAlign').onclick = e => { const b = e.target.closest('button'); if (!b) return; st['text-align'] = b.dataset.a; touched.add('text-align'); $('dtAlign').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); live(); save(); };
  $('dtX').onclick = () => { S.sel = null; renderSideStudio(); };
  $('dtUp').onclick = () => {
    if (inner) stPost({ rkPickParent: { frame: inner.frame, item: { path: inner.path, label: inner.label } } });
    else { const p = t.addr.path.split('>'); p.pop(); stPost({ rkPickAddr: { scope: t.addr.scope, kind: 'node', path: p.join('>') } }); }
  };
  if ($('dtLink')) $('dtLink').onclick = () => toast('Leave detail mode, then right-click this button → When clicked…');
  $('dtReset').onclick = () => {
    if (inner) { const owner = cur.owner; if (owner && owner.inner) owner.inner = owner.inner.filter(x => x.path !== inner.path); }
    else B.project.edits = projectEdits().filter(e => !(['style', 'text', 'hide'].includes(e.mode) && sameAddr(e.target, t.addr)));
    saveProject(); S.sel = null; toast('This part is back to how it was'); renderEditorWs();
  };
}

/* ---- right-click menu ---- */
function saveTextEdit(addr, text, was) {
  const edits = projectEdits(), ex = edits.find(e => e.mode === 'text' && sameAddr(e.target, addr));
  if (ex) ex.text = text; else edits.push({ id: newEditId(), target: addr, targetLabel: was || '', mode: 'text', text });
  saveProject(); toast(`Text changed to “${text.slice(0, 40)}”`);
  S.sel = { addr, info: { kind: addr.kind, label: text } };
  renderEditorWs();
}
function ctxItems(t, hidden) {
  const items = [], edits = projectEdits();
  if (t.addr && t.addr.kind === 'node') return [{ label: 'Edit this part…', icon: '✎', run: () => { S.sel = t; renderSideStudio(); } }, { label: 'Edit text', icon: '✎', hint: 'or double-click', run: () => stPost({ rkEditText: t.addr }) }, '-', { label: 'Back to the page', icon: '←', run: leaveFocus }];
  const configure = () => {
    S.ask = null; S.reveal = true;
    if (t.editId) {
      const e = editById(t.editId);
      S.sel = { editId: t.editId }; S.propsFor = e && hasProps(compById(e.compId)) ? { editId: e.id } : null;
      renderSideStudio(); stPost({ rkHi: { editId: t.editId } });
      return;
    }
    const b = t.addr.kind === 'section' && blockById(t.addr.scope);
    if (b && b.kind === 'comp' && hasProps(compById(b.compId))) { S.sel = t; S.propsFor = { blockId: b.id }; renderSideStudio(); stPost({ rkHi: { addr: t.addr } }); return; }
    S.propsFor = null;
    stPost({ rkDetailAddr: t.addr });   // the page answers with the part and its current look → the detail editor
  };
  if (t.editId) {
    const e = editById(t.editId); if (!e) return [{ label: 'Configure…', icon: '⚙', run: configure }];
    const c = e.compId && compById(e.compId);
    items.push({ label: 'Configure…', icon: '⚙', hint: 'size, words, clicks', run: configure });
    if (c && isClicky(e.target.kind)) items.push({ label: 'Edit text', icon: '✎', run: () => { const v = prompt('What should it say?', e.text || e.targetLabel || ''); if (v != null && v.trim()) { e.text = v.trim(); saveProject(); renderEditorWs(); } } });
    if (isClicky(e.target.kind) || e.mode === 'action') items.push({ label: 'When clicked…', icon: '👆', hint: 'node view', run: () => openLinksFor(e.target, e.text || e.targetLabel) });
    if (c && !isClicky(e.target.kind)) {
      items.push({ label: 'Link a part of it…', icon: '🔗', run: () => { S.mode = 'links'; renderStudio(); } });
      items.push({ label: 'Pick a part to link…', icon: '✛', run: () => { S.innerPick = e.id; renderEditorWs(); } });
    }
    if (c && !isClicky(e.target.kind)) items.unshift({ label: 'Edit in detail…', icon: '✎', hint: 'every part', run: () => focusOn({ editId: e.id }) });
    if (hasProps(c)) items.unshift({ label: 'Settings…', icon: '⚙', hint: 'picture, colours…', run: () => { S.ask = null; S.propsFor = { editId: e.id }; renderSideStudio(); } });
    if (c) items.push({ label: 'Swap for another component…', icon: '⇄', run: () => { S.replaceAt = { editId: e.id }; toast('Now click a component on the left'); } });
    items.push('-', { label: 'Undo this change', icon: '↺', danger: true, run: () => { B.project.edits = edits.filter(x => x.id !== e.id); S.sel = null; saveProject(); toast('Change undone'); renderStudio(); } });
    return items;
  }
  const a = t.addr, k = a.kind, here = edits.filter(e => sameAddr(e.target, a) && (e.mode === 'text' || e.mode === 'hide' || e.mode === 'action'));
  if (k === 'section') {
    const b = B.project.blocks.find(x => x.id === a.scope);
    if (b && hasProps(compById(b.compId))) items.push({ label: 'Settings…', icon: '⚙', hint: 'picture, colours…', run: () => { S.ask = null; S.propsFor = { blockId: b.id }; renderSideStudio(); } });
    if (a.scope !== 'nav' && a.scope !== 'footer') items.push({ label: 'Edit in detail…', icon: '✎', hint: 'every part', run: () => focusOn(t) });
    items.push({ label: 'Configure…', icon: '⚙', run: configure });
    items.push({ label: 'Replace with a component…', icon: '⇄', run: () => { S.replaceAt = { addr: a, info: t.info }; toast('Now click a component on the left'); } });
    items.push({ label: 'Move or schedule it…', icon: '↕', hint: 'Blocks', run: () => { B.sel = a.scope; S.mode = 'blocks'; renderStudio(); } });
    if (b) items.push('-', { label: b.hidden ? 'Show this section' : 'Hide this section', icon: b.hidden ? '◉' : '◌', run: () => { b.hidden = !b.hidden; saveProject(); renderStudio(); } });
    if (b && b.kind === 'comp') items.push({ label: 'Remove this component', icon: '✕', danger: true, run: () => removeBlock(b.id) });
    return items;
  }
  if ({ heading: 1, text: 1, button: 1, link: 1 }[k]) items.push({ label: 'Edit text', icon: '✎', hint: 'or double-click', run: () => stPost({ rkEditText: a }) });
  items.push({ label: 'Configure…', icon: '⚙', run: configure });
  if (isClicky(k)) {
    items.push({ label: 'When clicked…', icon: '👆', hint: 'node view', run: () => openLinksFor(a, t.info && t.info.label) });
  }
  items.push({ label: 'Replace with a component…', icon: '⇄', run: () => { S.replaceAt = { addr: a, info: t.info }; toast('Now click a component on the left'); } });
  items.push('-');
  const hid = edits.find(e => e.mode === 'hide' && sameAddr(e.target, a));
  items.push(hid ? { label: 'Show it again', icon: '◉', run: () => { B.project.edits = edits.filter(x => x !== hid); saveProject(); renderEditorWs(); } }
    : { label: 'Hide', icon: '◌', run: () => { edits.push({ id: newEditId(), target: a, targetLabel: t.info && t.info.label || '', mode: 'hide' }); saveProject(); toast('Hidden — right-click it to show it again'); renderEditorWs(); } });
  if (here.length) items.push({ label: 'Undo my changes here', icon: '↺', danger: true, run: () => { B.project.edits = edits.filter(x => !here.includes(x)); saveProject(); toast('Undone'); renderStudio(); } });
  return items;
}

/* ---- the questions ---- */
async function startAsk({ compId, addr, info, replacing, actionOnly, editing }) {
  const c = compId && compById(compId);
  if (addr && (addr.scope === 'nav' || addr.scope === 'footer') && addr.kind === 'section') { toast('Drop it on a button or link in the menu, or on a part of the page below it'); return; }
  if (c) { toast('Reading the component…', 1200); await ensureCompTokens(c); }
  const old = editing ? editById(editing) : null;
  S.sel = replacing ? { editId: replacing } : old ? { editId: old.id } : { addr, info };
  S.ask = old ? {
    editing: old.id, compId: old.compId, addr: old.target, info: { kind: old.target.kind, label: old.targetLabel, href: old.targetHref },
    place: old.mode, words: old.text ? (old.text === old.targetLabel ? 'old' : 'new') : 'own', text: old.text || '', recolor: !!old.recolor, layout: { flow: true, size: 'auto', ...(old.layout || {}) },
    action: structuredClone(old.action || { type: 'none' }), step: actionOnly ? 'click' : old.mode === 'action' ? 'click' : 'place', allBtns: false,
  } : {
    compId, addr, info, replacing, place: actionOnly ? 'action' : 'replace', words: 'old', text: '', layout: { flow: true, size: 'auto' }, recolor: !!brandColor() && !!(c && c.tokens && (c.tokens.accent || c.tokens.btnBg)),
    action: { type: info && info.href && info.href !== '#' ? 'keep' : 'none', href: '', newTab: false, block: '', compId: '' },
    step: actionOnly ? 'click' : 'place', allBtns: false,
  };
  if (S.ask.action.type === 'keep') S.ask.action.href = S.ask.info.href;
  renderSideStudio();
  stPost({ rkHi: S.sel.editId ? { editId: S.sel.editId } : { addr } });
  $('stSide').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function askSteps(a) {
  if (a.place === 'action') return ['click', 'confirm'];
  if (isClicky(a.addr.kind)) return ['place', 'words', 'click', 'confirm'];
  return a.place === 'popup' ? ['place', 'opener', 'confirm'] : ['place', 'layout', 'confirm'];
}
const opt = (name, val, cur, title, sub, extra = '') => `<label class="opt ${cur === val ? 'on' : ''}"><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}><div><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${extra}</div></label>`;

function revealSide() {
  const s = $('stSide'); if (!s) return;
  const r = s.getBoundingClientRect();
  if (r.top > innerHeight - 80 || r.bottom < 80) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
  s.classList.remove('st-flash'); void s.offsetWidth; s.classList.add('st-flash');
}
function renderSideStudio() {
  if (S.reveal) { S.reveal = false; setTimeout(revealSide, 30); }
  const side = $('stSide'); if (!side) return;
  const a = S.ask;
  if (!a) return renderSelInfo();
  const c = a.compId && compById(a.compId), k = a.addr.kind, kn = KIND_NAMES[k], lbl = quote(a.info && a.info.label || kn);
  const steps = askSteps(a), i = steps.indexOf(a.step);
  let q = '', body = '';
  if (a.step === 'place') {
    if (isClicky(k)) {
      q = `Is “${esc(c.name)}” a new ${kn}, or is it replacing ${esc(lbl)}?`;
      body = opt('pl', 'replace', a.place, `Replace ${esc(lbl)}`, `The old ${kn} goes away; this one takes its place.`) +
        opt('pl', 'after', a.place, `It’s a new ${kn}`, `Keep ${esc(lbl)} and put this one next to it.`);
    } else if (k === 'section') {
      q = `What should “${esc(c.name)}” do with this section?`;
      body = opt('pl', 'replace', a.place, 'Replace this section', `“${esc(blockLabel(a.addr.scope))}” goes away; the component takes its place.`) +
        opt('pl', 'after', a.place, 'Add it below this section', 'As a new part of the page.') +
        opt('pl', 'popup', a.place, 'Pop it up when a button is clicked', 'It’s not on the page — it opens on top when someone clicks a button you choose.');
    } else {
      q = `Should “${esc(c.name)}” replace this ${kn}, or go below it?`;
      body = opt('pl', 'replace', a.place, `Replace the ${kn}`, esc(lbl)) +
        opt('pl', 'after', a.place, `Add it below the ${kn}`, 'Everything else stays.') +
        opt('pl', 'popup', a.place, 'Pop it up when a button is clicked', 'It opens on top of the page when someone clicks a button you choose.');
    }
  } else if (a.step === 'words') {
    {
      q = `What should the ${kn} say?`;
      body = (a.info.label ? opt('wd', 'old', a.words, `Keep ${esc(lbl)}`, a.place === 'replace' ? 'Same words, new look.' : 'The same words as the one next to it.') : '') +
        opt('wd', 'new', a.words, 'Something else', '', `<input class="st-in" id="askText" value="${esc(a.text)}" placeholder="e.g. Book a table">`) +
        opt('wd', 'own', a.words, 'Keep the component’s own words', '');
    }
    body += `<label class="check" style="margin-top:10px"><input type="checkbox" id="askRc" ${a.recolor ? 'checked' : ''} ${brandColor() ? '' : 'disabled'}> Match my brand colour</label>`;
  } else if (a.step === 'layout') {
    q = 'How should it sit on your page?';
    const L = a.layout;
    body = opt('lf', 'flow', L.flow ? 'flow' : 'keep', 'Let the page rearrange around it', 'Bento layout: it becomes a tile, and the parts around it move to fill the space.',
        L.flow ? `<div style="margin-top:8px">${sizeChips(L.size, 'data-sz')}</div>` : '') +
      opt('lf', 'keep', L.flow ? 'flow' : 'keep', 'Keep everything where it is',
        a.place === 'replace' ? `It fits into the old ${kn}’s space. Nothing else moves.` : 'It goes in as a band below. Nothing else moves.');
    body += `<label class="check" style="margin-top:10px"><input type="checkbox" id="askRc" ${a.recolor ? 'checked' : ''} ${brandColor() ? '' : 'disabled'}> Match my brand colour</label>`;
  } else if (a.step === 'click') {
    const name = a.place === 'action' ? lbl : a.words === 'new' && a.text ? quote(a.text) : a.words === 'old' ? lbl : 'it';
    q = `When someone clicks ${esc(name)}, it…`;
    const secs = B.project.blocks.filter(b => !b.hidden);
    body =
      (a.info.href && a.info.href !== '#' ? opt('ac', 'keep', a.action.type, `Goes where ${esc(lbl)} went`, esc(a.info.href)) : '') +
      opt('ac', 'section', a.action.type, 'Scrolls to a part of this page', '', `<select class="st-in" id="askSec">${secs.map(b => `<option value="${b.id}" ${a.action.block === b.id ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select>`) +
      opt('ac', 'link', a.action.type, 'Opens a web page', '', `<input class="st-in" id="askHref" value="${esc(a.action.type === 'link' ? a.action.href : '')}" placeholder="https://… or mailto:…"><label class="check" style="margin:6px 0 0"><input type="checkbox" id="askNew" ${a.action.newTab ? 'checked' : ''}> In a new tab</label>`) +
      opt('ac', 'popup', a.action.type, 'Opens a popup (new UI)', 'Click the component it should open:',
        comps.list.length ? `<div class="st-pick">${comps.list.map(x => `<button type="button" data-pop="${x.id}" class="${a.action.compId === x.id ? 'on' : ''}"><div class="th" data-th="${x.id}"></div><span>${esc(x.name)}</span></button>`).join('')}</div>` : '<span>(save a component first)</span>') +
      opt('ac', 'top', a.action.type, 'Scrolls back to the top', '') +
      opt('ac', 'none', a.action.type, 'Nothing yet', 'Decide later.');
  } else if (a.step === 'opener') {
    q = 'Which button opens it?';
    body = `<p class="help">Click the button on your page that should open “${esc(c.name)}”.</p>${a.opener ? `<p class="st-muted">Chosen: ${esc(quote(a.opener.info.label))}</p>` : ''}
      <button class="primary" id="askPickBtn" style="width:100%">👆 Click it on the page</button>`;
  } else {
    q = 'Is that right?';
    const e = askToEdit(a);
    body = `<div class="st-sum">${esc(e.summary)}</div>
      ${c && isClicky(k) && a.place !== 'popup' ? `<label class="check"><input type="checkbox" id="askAll" ${a.allBtns ? 'checked' : ''}> Also make all my other buttons look like this one</label>` : ''}`;
  }
  const last = a.step === 'confirm';
  side.innerHTML = `<div class="bx-h"><h3>${a.inner ? `Linking ${esc(quote(a.inner.label))}` : a.editing ? 'Change it' : c ? `Adding “${esc(c.name)}”` : `Your ${kn}`}</h3><button class="icon" id="askX" title="Cancel">✕</button></div>
    <div class="wz-steps">${steps.map((s, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="bx-pad wz st-ask"><h4>${q}</h4>${body}</div>
    <div class="wz-foot">${i > 0 ? '<button class="ghost" id="askBack">← Change</button>' : '<span></span>'}
      <button class="primary" id="askNext" ${a.step === 'opener' && !a.opener ? 'disabled' : ''}>${last ? 'Yes, do it' : 'Next →'}</button></div>`;

  $('askX').onclick = () => { S.ask = null; S.picking = null; renderEditorWs(); };
  if ($('askBack')) $('askBack').onclick = () => { readAsk(); a.step = steps[Math.max(0, i - 1)]; if (S.picking) { S.picking = null; renderEditorWs(); } else renderSideStudio(); };
  $('askNext').onclick = () => {
    readAsk();
    if (a.step === 'click' && a.action.type === 'popup' && !a.action.compId) { toast('Click the component it should open'); return; }
    if (a.step === 'click' && a.action.type === 'link' && !a.action.href) { toast('Type the web address'); return; }
    if (a.step === 'words' && a.words === 'new' && !a.text.trim()) { toast('Type what it should say'); return; }
    if (last) return finishAsk();
    const ns = askSteps(a); a.step = ns[ns.indexOf(a.step) + 1] || 'confirm';
    if (a.step === 'opener' && !a.opener) { S.picking = 'opener'; renderEditorWs(); return; }
    renderSideStudio();
  };
  if ($('askPickBtn')) $('askPickBtn').onclick = () => { S.picking = 'opener'; renderEditorWs(); };
  side.querySelectorAll('.opt input[type=radio]').forEach(r => r.onchange = () => { readAsk(); renderSideStudio(); });
  side.querySelectorAll('[data-sz]').forEach(b => b.onclick = e => { e.preventDefault(); a.layout.size = b.dataset.sz; renderSideStudio(); });
  side.querySelectorAll('[data-pop]').forEach(b => b.onclick = e => { e.preventDefault(); a.action.type = 'popup'; a.action.compId = b.dataset.pop; renderSideStudio(); });
  side.querySelectorAll('[data-th]').forEach(th => { const x = compById(th.dataset.th); const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('loading', 'lazy'); f.srcdoc = compThumbDoc(x); th.appendChild(f); const fit = () => { if (th.clientWidth) f.style.transform = `scale(${th.clientWidth / 600})`; }; fit(); new ResizeObserver(fit).observe(th); });
  ['askHref', 'askText'].forEach(id => { const el = $(id); if (el) el.onfocus = () => { const r = el.closest('.opt').querySelector('input[type=radio]'); if (!r.checked) { r.checked = true; readAsk(); } }; });
  if ($('askSec')) $('askSec').onchange = () => { const r = $('askSec').closest('.opt').querySelector('input[type=radio]'); r.checked = true; readAsk(); };
}
function readAsk() {
  const a = S.ask, val = n => { const r = document.querySelector(`#stSide input[name=${n}]:checked`); return r && r.value; };
  if (a.step === 'place') a.place = val('pl') || a.place;
  if (a.step === 'layout') { const f = val('lf'); if (f) a.layout.flow = f === 'flow'; if ($('askRc')) a.recolor = $('askRc').checked; }
  if (a.step === 'words') { a.words = val('wd') || a.words; if ($('askText')) a.text = $('askText').value; if ($('askRc')) a.recolor = $('askRc').checked; }
  if (a.step === 'click') {
    a.action.type = val('ac') || a.action.type;
    if ($('askSec')) a.action.block = $('askSec').value;
    if ($('askHref')) { if (a.action.type === 'link') a.action.href = $('askHref').value.trim(); a.action.newTab = $('askNew').checked; }
    if (a.action.type === 'keep') a.action.href = a.info.href;
  }
  if (a.step === 'confirm' && $('askAll')) a.allBtns = $('askAll').checked;
}
// the answers → one change to the page (or a section block)
function askToEdit(a) {
  const c = a.compId && compById(a.compId), k = a.addr.kind;
  if (a.inner) {
    const host = compById((editById(a.inner.editId) || {}).compId) || { name: 'the component' };
    return { inner: true, summary: `When someone clicks ${quote(a.inner.label)} in “${host.name}”, it ${actionWords(a.action.type === 'none' ? null : a.action)}. Its own effect still happens too.` };
  }
  if (a.place === 'popup') {
    const o = a.opener;
    return { popup: true, summary: o ? `When someone clicks ${quote(o.info.label)}, “${c.name}” pops up on top of the page.` : `“${c.name}” pops up when a button is clicked.` };
  }
  // words only go into a component that takes a button's / link's place
  const text = !c || a.place === 'action' || !isClicky(k) ? null : a.words === 'old' ? (a.info.label || null) : a.words === 'new' ? a.text.trim() : null;
  const action = isClicky(k) || a.place === 'action' ? (a.action.type === 'none' ? null : { ...a.action }) : null;
  const e = { id: a.editing || newEditId(), target: a.addr, targetLabel: a.info.label || '', targetHref: a.info.href || '', mode: a.place, compId: c ? c.id : null, text, recolor: a.recolor, action,
    layout: c && !isClicky(k) && a.place !== 'action' ? { ...a.layout } : undefined };
  if (k === 'section') e.targetLabel = blockLabel(a.addr.scope);
  return { edit: e, summary: describeEdit(e) };
}
function finishAsk() {
  const a = S.ask, p = B.project, edits = projectEdits(), r = askToEdit(a), c = a.compId && compById(a.compId);
  if (r.inner) {
    const ed = editById(a.inner.editId), links = ed.links || (ed.links = []), i = links.findIndex(l => l.path === a.inner.path);
    const link = { path: a.inner.path, label: a.inner.label, action: { ...a.action } };
    if (a.action.type === 'none') { if (i >= 0) links.splice(i, 1); } else if (i >= 0) links.splice(i, 1, link); else links.push(link);
    S.sel = { editId: ed.id };
    toast(a.action.type === 'none' ? 'Link removed' : 'Done — ' + r.summary.split('. Its own')[0], 4000);
  } else if (r.popup) {
    const o = a.opener, ex = o.editId ? editById(o.editId) : edits.find(e => sameAddr(e.target, o.addr) && e.mode !== 'after');
    const action = { type: 'popup', compId: c.id };
    if (ex) ex.action = action;
    else edits.push({ id: newEditId(), target: o.addr, targetLabel: o.info.label, targetHref: o.info.href, mode: 'action', compId: null, text: null, recolor: a.recolor, action });
    toast(`Done — ${quote(o.info.label)} now opens “${c.name}”`);
  } else {
    const e = r.edit;
    const prev = a.editing && editById(a.editing); if (prev && prev.links) e.links = prev.links;
    if (a.replacing) { const i = edits.findIndex(x => x.id === a.replacing); if (i >= 0) edits.splice(i, 1); }
    const i = edits.findIndex(x => x.id === e.id || (e.mode !== 'after' && sameAddr(x.target, e.target) && x.mode !== 'after'));
    if (i >= 0) edits.splice(i, 1, e); else edits.push(e);
    if (a.allBtns && c && c.tokens && c.tokens.btn) { p.btnCss = btnCssFrom(c.tokens.btn); p.btnFrom = c.id; }
    S.sel = { editId: e.id };
    toast('Done — ' + r.summary.replace(/\.$/, ''), 4000);
  }
  S.ask = null; S.picking = null;
  saveProject();
  renderStudio();
}

// side panel when nothing is being asked: what you clicked on, and what you can do with it
// a placed component's own settings (its props), just for this placement
function renderPropsSide() {
  const side = $('stSide'), f = S.propsFor, owner = f.editId ? editById(f.editId) : blockById(f.blockId), c = owner && compById(owner.compId);
  if (!owner || !c) { S.propsFor = null; return renderSelInfo(); }
  side.innerHTML = `<div class="bx-h"><h3>⚙ ${esc(c.name)} <small>· just here</small></h3><button class="icon" id="ppX" title="Close">✕</button></div>
    <div class="bx-pad"><div id="ppSide"></div><p class="st-muted" style="margin-top:10px">To change it everywhere it’s used, open it in the Library.</p></div>`;
  $('ppX').onclick = () => { S.propsFor = null; renderSideStudio(); };
  renderPropsPanel($('ppSide'), c, owner, () => { if (S.mode === 'blocks') renderBuildPreview(); else renderStudioPreview(); });
}
const hasProps = c => !!(c && typeof parseProps === 'function' && parseProps(c) && parseProps(c).fields.length);
function renderSelInfo() {
  const side = $('stSide'), t = S.sel;
  if (S.propsFor) return renderPropsSide();
  if (t && (t.inner || (t.addr && t.addr.kind === 'node'))) return renderDetail(t);
  if (!t) {
    side.innerHTML = `<div class="bx-h"><h3>How it works</h3></div><div class="bx-pad st-how">
      <ol><li><b>Drag</b> a component from the left onto a button, heading, picture, card or section of your page.</li>
      <li>Answer a couple of questions — is it new or replacing something? what happens when it’s clicked?</li>
      <li>Check the sentence, then <b>Yes, do it</b>. Studio writes the code.</li></ol>
      <p class="st-muted">Or click any button on your page to change what it does.</p></div>`;
    return;
  }
  if (t.editId) {
    const e = editById(t.editId); if (!e) { S.sel = null; return renderSelInfo(); }
    side.innerHTML = `<div class="bx-h"><h3>Your change</h3><button class="icon" id="selX">✕</button></div><div class="bx-pad">
      <div class="st-sum">${esc(describeEdit(e))}</div>
      <div style="display:grid;gap:8px">
        ${isClicky(e.target.kind) || e.mode === 'action' ? '<button class="primary" id="selAct">Change what it does when clicked</button>' : ''}
        ${e.compId && !isClicky(e.target.kind) ? `<div class="st-lay"><b>Tile size</b>${sizeChips((e.layout || {}).size || 'auto', 'data-tsz')}
          <label class="check"><input type="checkbox" id="selFlow" ${(e.layout || { flow: true }).flow ? 'checked' : ''}> Rearrange the page around it</label></div>` : ''}
        ${hasProps(compById(e.compId)) ? '<button class="primary" id="selProps">⚙ Component settings</button>' : ''}
        ${e.compId && !isClicky(e.target.kind) ? '<button class="primary" id="selDetail">✎ Edit it in detail</button>' : ''}
        ${e.compId ? '<button class="ghost" id="selEdit">Change the rest</button>' : ''}
        ${e.compId && !isClicky(e.target.kind) && e.mode !== 'action' ? `<div class="st-lay"><b>Linked parts</b>
          ${(e.links || []).map((l, i) => `<div class="st-link"><button class="st-chg" data-lk="${i}">${esc(quote(l.label))} → ${esc(actionWords(l.action))}</button><button class="icon" data-lkx="${i}" title="Remove this link">✕</button></div>`).join('') || '<p class="st-muted">Folders, files, menu items or buttons inside it can each scroll to a section, open a page or pop something up.</p>'}
          <button class="primary" id="selLink">🔗 Link a part of it</button></div>` : ''}
        <button class="ghost" id="selDel" style="color:#b2341a">Undo this change</button></div>
      <p class="st-muted" style="margin-top:12px">Tip: drop another component on it to swap it.</p></div>`;
    stPost({ rkHi: { editId: e.id } });
    if ($('selAct')) $('selAct').onclick = () => openLinksFor(e.target, e.text || e.targetLabel);
    if ($('selEdit')) $('selEdit').onclick = () => startAsk({ editing: e.id });
    if ($('selDetail')) $('selDetail').onclick = () => focusOn({ editId: e.id });
    if ($('selProps')) $('selProps').onclick = () => { S.propsFor = { editId: e.id }; renderSideStudio(); };
    const relayout = ch => { e.layout = { flow: true, size: 'auto', ...(e.layout || {}), ...ch }; saveProject(); renderSelInfo(); renderStudioPreview(); };
    side.querySelectorAll('[data-tsz]').forEach(b => b.onclick = () => relayout({ size: b.dataset.tsz, flow: true }));
    if ($('selFlow')) $('selFlow').onchange = ev => relayout({ flow: ev.target.checked });
    if ($('selLink')) $('selLink').onclick = () => { S.innerPick = e.id; S.tryIt = false; renderEditorWs(); };
    side.querySelectorAll('[data-lk]').forEach(b => b.onclick = () => {
      const l = e.links[+b.dataset.lk];
      S.ask = { inner: { editId: e.id, path: l.path, label: l.label }, compId: null, addr: e.target, info: { kind: 'button', label: l.label, href: '' },
        place: 'action', step: 'click', recolor: !!e.recolor, layout: { flow: true, size: 'auto' }, action: structuredClone(l.action) };
      renderSideStudio();
    });
    side.querySelectorAll('[data-lkx]').forEach(b => b.onclick = () => { e.links.splice(+b.dataset.lkx, 1); saveProject(); renderSelInfo(); renderStudioPreview(); toast('Link removed'); });
    $('selDel').onclick = () => { B.project.edits = B.project.edits.filter(x => x.id !== e.id); S.sel = null; saveProject(); toast('Change undone'); renderStudio(); };
  } else {
    const k = t.addr.kind, kn = KIND_NAMES[k], lbl = t.info && t.info.label;
    side.innerHTML = `<div class="bx-h"><h3>${k === 'section' ? esc(blockLabel(t.addr.scope)) : `Your ${kn}`}</h3><button class="icon" id="selX">✕</button></div><div class="bx-pad">
      ${lbl && k !== 'section' ? `<p class="st-sum">${esc(quote(lbl))}${isClicky(k) && t.info.href ? ` — goes to ${esc(t.info.href)}` : ''}</p>` : ''}
      <div style="display:grid;gap:8px">
        ${t.addr.scope !== 'nav' && t.addr.scope !== 'footer' ? '<button class="primary" id="selDetail">✎ Edit this section in detail</button>' : ''}
        ${k === 'section' && hasProps(compById((blockById(t.addr.scope) || {}).compId)) ? '<button class="primary" id="selProps">⚙ Component settings</button>' : ''}
        ${k === 'section' && (blockById(t.addr.scope) || {}).kind === 'comp' ? '<button class="ghost" id="selRemove" style="color:#b2341a">Remove this component</button>' : ''}
        ${isClicky(k) ? '<button class="primary" id="selAct">Change what it does when clicked</button>' : ''}
        ${k === 'section' ? '<button class="ghost" id="selBuild">Move, hide or schedule it (Blocks)</button>' : ''}</div>
      <p class="st-muted" style="margin-top:12px">Drag a component from the left onto it to ${k === 'section' ? 'replace it or add something below' : 'replace it'}.</p></div>`;
    if ($('selAct')) $('selAct').onclick = () => openLinksFor(t.addr, t.info && t.info.label);
    if ($('selBuild')) $('selBuild').onclick = () => { B.sel = t.addr.scope; S.mode = 'blocks'; renderStudio(); };
    if ($('selDetail')) $('selDetail').onclick = () => focusOn(t);
    if ($('selRemove')) $('selRemove').onclick = () => removeBlock(t.addr.scope);
    if ($('selProps')) $('selProps').onclick = () => { S.propsFor = { blockId: t.addr.scope }; renderSideStudio(); };
  }
  $('selX').onclick = () => { S.sel = null; stPost({ rkHi: null }); renderSelInfo(); };
}

/* ------------------------------------------------------------------ hook into the app */
VIEWS.studio = renderStudio;
