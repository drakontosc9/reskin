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
  device: 'desktop',
  drag: null,          // component id being dragged from the rail
  swapFor: null,       // { editId | blockId } waiting for "pick the component to swap in"
  flash: null,         // component to highlight in the rail (e.g. from the Library)
  matched: null,       // design already applied to the page on import
  mode: 'edit',        // (kept for older code paths in builder.js / shell.js)
}
const TILE_SIZES = [['auto', 'Auto', 'Picks a size from the component’s shape'], ['s', 'Small', '1×1'], ['wide', 'Wide', '2×1'], ['tall', 'Tall', '1×2'], ['big', 'Big', '2×2'], ['band', 'Band', 'full width, 1 row'], ['full', 'Full width', 'full width, 2 rows']];
const sizeName = v => (TILE_SIZES.find(x => x[0] === v) || TILE_SIZES[0])[1];
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
    BG = opaque(document.body) || opaque(document.documentElement); var stage = [document.documentElement, document.body];
    for (var i = 0; i < all.length && i < 3000; i++) {
      var el = all[i]; if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT|BR)$/.test(el.tagName)) continue;
      var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      if (r.width >= vw * 0.97 && r.height >= vh * 0.9) { BG = opaque(el) || BG; stage.push(el); continue; }   // a full-screen wrapper: its colour is the backdrop
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    if (x1 <= x0) return null;
    // the content brings its own surface (a white card on a grey demo page): the backdrop was only staging
    if (BG) for (var j = 0; j < all.length && j < 3000; j++) {
      var q = all[j].getBoundingClientRect();
      if (Math.abs(q.left - x0) < 3 && Math.abs(q.top - y0) < 3 && Math.abs(q.right - x1) < 3 && Math.abs(q.bottom - y1) < 3) { if (opaque(all[j])) { BG = null; stage.forEach(function (x) { x.style.setProperty('background', 'transparent', 'important'); }); } break; }
    }
    return { x: Math.floor(x0 + scrollX), y: Math.floor(y0 + scrollY), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0), full: (x1 - x0) >= vw * 0.85 && (y1 - y0) >= vh * 0.6 };
  }
  // the colour the component sits on, if it brings its own (a dark card UI on a black page); null = see-through
  var BG = null;
  function opaque(el) {
    if (!el) return null; var c = getComputedStyle(el), m = /rgba?\(([^)]+)\)/.exec(c.backgroundColor);
    if (c.backgroundImage && c.backgroundImage !== 'none') return c.backgroundImage.indexOf('gradient') >= 0 ? c.backgroundImage : null;
    if (!m) return null; var a = m[1].split(','); return a.length < 4 || +a[3] > 0.5 ? c.backgroundColor : null;
  }
  var last = '';
  function report() {
    var b = box(), de = document.documentElement;
    var msg = { rkE: D.id, box: b, bg: BG, err: window.__reskinErr || null, sw: de.scrollWidth, sh: de.scrollHeight, vw: innerWidth, vh: innerHeight };
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
  function scopeOf(el) {
    var b = el.closest('.rk-block'); if (b) return b.getAttribute('data-block');
    if (el.closest('header.nav,aside.side')) return 'nav';
    if (el.closest('footer')) return 'footer';
    return null;
  }
  function info(el, kind) {
    var h = (kind === 'card' || kind === 'section') && el.querySelector('h1,h2,h3,h4,b,blockquote');
    var txt = kind === 'image' ? (el.getAttribute('alt') || 'image') : ((h || el).innerText || (h || el).textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    // previews point in-page links at "about:srcdoc#…" so they scroll the preview; keep the site's real link
    return { kind: kind, label: txt, href: (el.getAttribute && el.getAttribute('href') || '').replace(/^about:srcdoc/, '') };
  }
  function targetOf(node) {
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
    f.srcdoc = doc; return f;
  }

  // ---- frames: "crop" shows just the content (buttons), "fit" scales the content into a tile
  // scroll this page only (scrollIntoView would also scroll the editor page around the preview)
  function goTo(el, where) { var r = el.getBoundingClientRect(); scrollTo({ top: Math.max(0, r.top + scrollY - (where === 'center' ? (innerHeight - r.height) / 2 : 0)), behavior: 'smooth' }); }
  var F = window.__rkFrames = {};   // frame state (handy when debugging a layout)
  var PAD = 14, CROP_W = 900, CROP_H = 360, CROP_MAXW = 560, CROP_MAXH = 240, WAIT = 9000;
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
  // nothing showed (needs a prop, crashed, offline): say so in the editor; on the real site, step aside
  function empty(k, why) {
    if (k.seen || k.emptyShown) return; k.emptyShown = true;
    if (k.mode === 'crop') { k.wrap.style.display = 'none'; if (k.orig) k.orig.style.display = ''; if (MODE !== 'edit') return; }
    var host = k.mode === 'crop' ? k.orig : k.tile; if (!host) return;
    if (MODE !== 'edit') { k.tile.style.display = 'none'; return; }
    var n = document.createElement('div'); n.className = 'rk-empty';
    n.textContent = why ? 'This component stopped working here. It probably needs data Reskin can’t guess (a list, some settings). Set it in Library, or swap it.' : 'Nothing showed up. This component may need a picture or some text. Set it in Library, or swap it.';
    if (why) n.title = String(why).slice(0, 200);
    if (k.mode === 'crop') { n.style.cssText = 'position:absolute;z-index:5;max-width:260px'; host.parentNode.insertBefore(n, host.nextSibling); } else host.appendChild(n);
  }
  function settle(k, d) {   // the backdrop it brings, and its content centred in the tile
    k.tile.style.background = d.bg || 'transparent';
    var ox = 0, oy = 0;
    if (d.box && !d.box.full) {
      var tw = k.tile.clientWidth, th = k.tile.clientHeight, s = k.s;
      if (d.box.w * s < tw) ox = Math.round((tw - d.box.w * s) / 2 - d.box.x * s);
      if (d.box.h * s < th) oy = Math.round((th - d.box.h * s) / 2 - d.box.y * s);
    }
    k.f.style.left = ox + 'px'; k.f.style.top = oy + 'px';
  }
  function onReport(d) {
    var k = F[d.rkE]; if (!k) return;
    if (d.err && !d.box) return empty(k, d.err);
    if (d.box) { k.seen = true; var em = k.tile && k.tile.querySelector('.rk-empty'); if (em) em.remove(); }
    if (k.mode === 'crop') {
      if (!d.box) return;
      // a big component dropped on a button is shown smaller, so it can't push the page around
      var s = Math.min(1, CROP_MAXW / d.box.w, CROP_MAXH / d.box.h);
      k.wrap.style.width = Math.round(d.box.w * s + 2 * PAD) + 'px'; k.wrap.style.height = Math.round(d.box.h * s + 2 * PAD) + 'px';
      k.f.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      k.f.style.left = Math.round(PAD - d.box.x * s) + 'px'; k.f.style.top = Math.round(PAD - d.box.y * s) + 'px';
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
      k.adj++; k.s = Math.min(1, k.s * Math.min(k.vw / bw, k.vh / bh) * 0.92); fit(k); return;
    }
    settle(k, d);
  }
  function cropFrame(e, el) {
    var w = document.createElement('span');
    w.className = 'rk-e rk-crop'; w.setAttribute('data-rk-edit', e.id);
    var r = el.getBoundingClientRect();
    w.style.cssText = 'display:inline-block;position:relative;overflow:hidden;vertical-align:middle;margin:-' + PAD + 'px;visibility:hidden;width:' + Math.round(r.width + 2 * PAD) + 'px;height:' + Math.round(r.height + 2 * PAD) + 'px';
    var f = frame(e.id, e.doc, 'component'); f.style.width = CROP_W + 'px'; f.style.height = CROP_H + 'px';
    w.appendChild(f); var k = F[e.id] = { mode: 'crop', f: f, wrap: w, orig: el };
    setTimeout(function () { empty(k); }, WAIT);
    return w;
  }
  function tileFrame(id, doc, tile, auto, row) {
    var f = frame(id, doc, 'component'); tile.appendChild(f);
    var k = F[id] = { mode: 'fit', f: f, tile: tile, s: 1, adj: 0, auto: auto, stage: row ? 1 : 0 };
    setTimeout(function () { empty(k); }, WAIT);
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
        setSize(tile, L.size === 'auto' ? (L.row ? 'full' : 'big') : L.size);
        var spot = bentoSpot(el, e);
        spot.box.insertBefore(tile, spot.before && spot.before.parentNode === spot.box ? spot.before : null);
      } else {
        // keep everything where it is: take the old element's exact space (or a band below it)
        var r = el.getBoundingClientRect(), cr = SIZES[L.size] || SIZES.big;
        tile.style.cssText = 'width:100%;height:' + Math.max(e.mode === 'replace' ? Math.round(r.height) : cr[1] * 170, 120) + 'px';
        el.parentNode.insertBefore(tile, e.mode === 'replace' ? el : el.nextSibling);
      }
      if (e.mode === 'replace') el.style.display = 'none';
      tileFrame(e.id, e.doc, tile, L.flow && L.size === 'auto', L.flow && L.size === 'auto' && L.row);
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
  });

  var st = document.createElement('style');
  st.textContent =
    '.rk-bento{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;grid-auto-rows:minmax(150px,auto)!important;grid-auto-flow:row dense!important;gap:20px!important;align-items:stretch!important}' +
    '.rk-bento>*{min-width:0!important;margin:0!important;grid-column:span 1}.rk-bento-row>.rk-bento{margin:28px 0}' +
    '.rk-tile{position:relative;overflow:hidden;border-radius:var(--r,14px);min-height:150px}' +
    '.rk-empty{position:absolute;inset:10px;display:grid;place-items:center;text-align:center;padding:14px;border:2px dashed #c9c2b8;border-radius:12px;background:rgba(250,248,245,.94);color:#57524b;font:500 13px/1.45 Inter,system-ui,sans-serif}' +
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

  if (MODE !== 'edit') {
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-rk-edit]'); if (!el) return;
      var e = byId[el.getAttribute('data-rk-edit')]; if (!e || !e.action) return;
      ev.preventDefault(); ev.stopPropagation(); run(e);
    }, true);
    return;
  }

  // ---- the stage: components work as they normally do; while something is dragged, the page shows
  //      exactly where it would land (replace a button · add it here · a new section between two)
  function mk(cls) { var d = document.createElement('div'); d.className = cls; document.body.appendChild(d); return d; }
  var sst = document.createElement('style');
  sst.textContent = 'body.rk-dragging iframe{pointer-events:none!important}' +
    '.rk-ol{position:fixed;z-index:2147483002;pointer-events:none;border:3px solid #2f6bff;border-radius:12px;background:rgba(47,107,255,.08);display:none;transition:left .1s,top .1s,width .1s,height .1s}' +
    '.rk-line{position:fixed;z-index:2147483002;pointer-events:none;height:4px;margin-top:-2px;border-radius:4px;background:#2f6bff;box-shadow:0 0 0 5px rgba(47,107,255,.16);display:none;transition:top .1s}' +
    '.rk-pill{position:fixed;z-index:2147483003;pointer-events:none;font:600 12.5px/1 Inter,system-ui,sans-serif;background:#2f6bff;color:#fff;padding:7px 12px;border-radius:99px;box-shadow:0 6px 20px rgba(47,107,255,.35);white-space:nowrap;display:none;transform:translate(-50%,-50%)}' +
    '.rk-bar{position:fixed;z-index:2147483004;display:none;gap:2px;padding:4px;background:#1d1b19;border-radius:11px;box-shadow:0 10px 28px rgba(0,0,0,.32)}' +
    '.rk-bar button{border:0;background:none;color:#fff;font:600 12px/1 Inter,system-ui,sans-serif;padding:8px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}.rk-bar button:hover{background:rgba(255,255,255,.15)}' +
    '.rk-hl{outline:2px dashed rgba(47,107,255,.55)!important;outline-offset:4px}' +
    '.rk-tag{position:fixed;z-index:2147483001;pointer-events:none;font:600 11.5px/1 Inter,system-ui,sans-serif;background:#1d1b19;color:#fff;padding:5px 8px;border-radius:6px;display:none}';
  document.head.appendChild(sst);
  var ol = mk('rk-ol'), line = mk('rk-line'), pill = mk('rk-pill'), bar = mk('rk-bar'), tag = mk('rk-tag');
  function plain(t) { return t ? { addr: t.addr || null, info: t.info || null, editId: t.editId || null } : null; }
  function blocksOnPage() { return Array.prototype.filter.call(document.querySelectorAll('.rk-block'), function (b) { return b.offsetHeight > 0; }); }
  var clicky = function (k) { return k === 'button' || k === 'link'; };
  function intentAt(x, y, node) {
    var bs = blocksOnPage(), EDGE = 30;
    for (var i = 0; i < bs.length; i++) {
      var r = bs[i].getBoundingClientRect();
      if (y < r.top - 2 || y > r.bottom + 2) continue;
      if (y - r.top < EDGE && i > 0) return { kind: 'gap', scope: bs[i - 1].getAttribute('data-block'), y: r.top, x0: r.left, x1: r.right };
      if (r.bottom - y < EDGE) return { kind: 'gap', scope: bs[i].getAttribute('data-block'), y: r.bottom, x0: r.left, x1: r.right };
      break;
    }
    var t = targetOf(node); if (!t) return null;
    if (t.editId) return { kind: 'swap', editId: t.editId, el: t.el, label: 'Swap this component' };
    var k = t.addr.kind;
    if (clicky(k)) return { kind: 'replace', addr: t.addr, info: t.info, el: t.el, label: 'Replace “' + (t.info.label || 'button').slice(0, 28) + '”' };
    if (k === 'section') {
      if (t.el.querySelector('iframe.rk-comp')) return { kind: 'swapblock', scope: t.addr.scope, el: t.el, label: 'Swap this component' };
      var rr = t.el.getBoundingClientRect();
      return { kind: 'gap', scope: t.addr.scope, y: rr.bottom, x0: rr.left, x1: rr.right };
    }
    return { kind: 'here', addr: t.addr, info: t.info, el: t.el, label: 'Add it here' };
  }
  function hideDrop() { ol.style.display = line.style.display = pill.style.display = 'none'; }
  function showDrop(it) {
    hideDrop(); if (!it) return;
    if (it.kind === 'gap') {
      line.style.display = 'block'; line.style.left = (it.x0 + 12) + 'px'; line.style.width = Math.max(0, it.x1 - it.x0 - 24) + 'px'; line.style.top = it.y + 'px';
      pill.textContent = '＋ New section here'; pill.style.display = 'block'; pill.style.left = ((it.x0 + it.x1) / 2) + 'px'; pill.style.top = it.y + 'px';
      return;
    }
    var r = it.el.getBoundingClientRect();
    ol.style.display = 'block'; ol.style.left = (r.left - 6) + 'px'; ol.style.top = (r.top - 6) + 'px'; ol.style.width = (r.width + 12) + 'px'; ol.style.height = (r.height + 12) + 'px';
    pill.textContent = it.label; pill.style.display = 'block'; pill.style.left = (r.left + r.width / 2) + 'px'; pill.style.top = Math.max(16, r.top - 6) + 'px';
  }
  var dragT = null;
  function dragging(on) { document.body.classList.toggle('rk-dragging', !!on); if (!on) hideDrop(); hideBar(); }
  document.addEventListener('dragenter', function () { dragging(true); });
  document.addEventListener('dragover', function (ev) {
    ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    dragging(true); clearTimeout(dragT); dragT = setTimeout(function () { dragging(false); }, 600);
    showDrop(intentAt(ev.clientX, ev.clientY, ev.target));
  });
  document.addEventListener('dragleave', function (ev) { if (!ev.relatedTarget) { hideDrop(); } });
  document.addEventListener('drop', function (ev) {
    ev.preventDefault();
    var it = intentAt(ev.clientX, ev.clientY, ev.target); dragging(false);
    if (!it) return;
    var dt = ev.dataTransfer, files = dt && dt.files ? Array.prototype.slice.call(dt.files) : [];
    var text = dt ? (dt.getData('text/uri-list') || dt.getData('text/plain') || '') : '';
    var send = { kind: it.kind, addr: it.addr || null, info: it.info || null, editId: it.editId || null, scope: it.scope || null };
    parent.postMessage({ rkDrop: send, files: files, text: text }, '*');
  });

  // ---- a small toolbar on whatever component you point at
  var barFor = null, barT = null;
  function hideBar() { bar.style.display = 'none'; barFor = null; document.querySelectorAll('.rk-hl').forEach(function (x) { x.classList.remove('rk-hl'); }); }
  function boxOf(node) {
    if (!node || !node.closest) return null;
    var e = node.closest('[data-rk-edit]'); if (e && e.querySelector('iframe')) return { el: e, editId: e.getAttribute('data-rk-edit') };
    var b = node.closest('.rk-block'); if (b && b.querySelector('iframe.rk-comp') && (node.tagName === 'IFRAME' || node === b)) return { el: b, blockId: b.getAttribute('data-block') };
    return null;
  }
  function showBar(bx) {
    if (barFor && barFor.el === bx.el) return;
    hideBar(); barFor = bx; bx.el.classList.add('rk-hl');
    var tile = bx.editId && bx.el.classList.contains('rk-tile');
    bar.innerHTML = (tile ? '<button data-a="size" title="Change its size">⤢ Size</button>' : '') + '<button data-a="swap" title="Drag another component onto it, or pick one">⇄ Swap</button><button data-a="remove" title="Take it off the page">✕ Remove</button>';
    var r = bx.el.getBoundingClientRect();
    bar.style.display = 'flex'; bar.style.left = Math.max(6, Math.min(r.right - bar.offsetWidth - 6, innerWidth - bar.offsetWidth - 6)) + 'px'; bar.style.top = Math.max(6, r.top + 8) + 'px';
  }
  document.addEventListener('mouseover', function (ev) {
    if (document.body.classList.contains('rk-dragging')) return;
    if (bar.contains(ev.target)) { clearTimeout(barT); return; }
    var bx = boxOf(ev.target);
    if (bx) { clearTimeout(barT); showBar(bx); } else { clearTimeout(barT); barT = setTimeout(hideBar, 350); }
  });
  addEventListener('scroll', function () { if (barFor) { var r = barFor.el.getBoundingClientRect(); bar.style.top = Math.max(6, r.top + 8) + 'px'; } }, { passive: true });
  bar.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || !barFor) return;
    parent.postMessage({ rkTool: { action: b.getAttribute('data-a'), editId: barFor.editId || null, blockId: barFor.blockId || null } }, '*');
    hideBar();
  });

  // ---- words: double-click to type them; right-click for the few things you might want
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
    if (editing && editing.contains(ev.target)) return;
    if (editing) finishText(true);
    if (ev.target.closest && ev.target.closest('a[href]')) ev.preventDefault();   // your page's own links don't navigate the stage
  }, true);
  document.addEventListener('dblclick', function (ev) {
    var t = targetOf(ev.target); if (!t || !t.addr || !TEXTY[t.addr.kind]) return;
    ev.preventDefault(); startText(t.el, t.addr);
  }, true);
  document.addEventListener('mousemove', function (ev) {
    if (editing || document.body.classList.contains('rk-dragging')) { tag.style.display = 'none'; return; }
    var t = targetOf(ev.target);
    if (t && t.addr && TEXTY[t.addr.kind]) { tag.textContent = 'Double-click to edit the words'; tag.style.display = 'block'; tag.style.left = Math.min(ev.clientX + 14, innerWidth - tag.offsetWidth - 8) + 'px'; tag.style.top = Math.max(ev.clientY - 30, 6) + 'px'; }
    else tag.style.display = 'none';
  });
  document.addEventListener('mouseleave', function () { tag.style.display = 'none'; });
  document.addEventListener('contextmenu', function (ev) {
    var t = targetOf(ev.target); if (!t) return;
    ev.preventDefault(); if (editing) finishText(true);
    parent.postMessage({ rkCtx: plain(t), x: ev.clientX, y: ev.clientY, hidden: t.el.style.opacity === '0.28' }, '*');
  }, true);
  document.addEventListener('submit', function (ev) { ev.preventDefault(); }, true);
  addEventListener('message', function (ev) {
    var d = ev.data || {};
    if ('rkDragging' in d) dragging(d.rkDragging);
    if (d.rkEditText) { var te = find(d.rkEditText); if (te) startText(te, d.rkEditText); }
    if ('rkHi' in d) {
      var el = null, h = d.rkHi;
      if (h && h.editId) el = document.querySelector('[data-rk-edit="' + h.editId + '"]');
      else if (h && h.addr) el = find(h.addr);
      if (el && d.scroll) goTo(el, 'center');
      if (el && d.flash) { el.classList.add('rk-hl'); setTimeout(function () { el.classList.remove('rk-hl'); }, 1600); }
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

/* ------------------------------------------------------------------ the Studio tab: one stage */
// your page in the middle, components on the left, questions on the right, styles in a filmstrip below
function renderStudio() {
  const box = $('studioView');
  if (!state.model) { box.innerHTML = '<div class="bx-panel bx-empty">Paste your site on the Explore tab first.</div>'; return; }
  ensureProject(); projectEdits();
  $('banner').innerHTML = '';
  const T = state.tgt && state.tgt.tokens;
  if (T && state.mood === 'target' && S.matched !== T.name) {
    S.matched = T.name;
    const exact = state.styles.find(st => st.exact && !st.live);
    if (exact) { B.project.style = exact; saveProject(); toast(`Your page — and Reskin — now look like “${T.name}”. Try the others below.`, 4500); }
  }
  box.innerHTML = `<div id="stBody"></div><div class="film" id="stFilm"></div>`;
  renderEditorWs();
  renderFilm();
  if (typeof wearStyle === 'function') wearStyle(B.project.style);
}
const goWs = ws => { if (ws === 'component') return setView('library'); if (state.view !== 'studio') setView('studio'); else renderStudio(); };

// the stage's toolbar, shared by every mode
function stToolbar() {
  const hint = 'drag a component onto your page · double-click words to edit them';
  return `<div class="bx-h st-tool"><h3>${esc(B.project.name)} <small>· ${hint}</small></h3>
    <div class="bx-row">
      <div class="seg" id="stDev"><button data-d="desktop" class="${S.device === 'desktop' ? 'on' : ''}">Desktop</button><button data-d="mobile" class="${S.device === 'mobile' ? 'on' : ''}">Mobile</button></div>
      <button class="icon st-gear" id="stGear" title="Page settings: colours, hero, images">⚙</button>
      <button class="ghost" id="stOpen">Open full page</button>
      <button class="primary" id="stDl" style="height:34px;padding:0 12px;font-size:13px">Download site</button>
    </div></div>`;
}
function wireStToolbar() {
  const p = B.project;
  $('stDev').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; S.device = b.dataset.d;
    $('stDev').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    const fr = $('stFrame'); if (fr) fr.className = 'bx-frame ' + S.device;
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
      renderStudioPreview();
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
  const body = $('stBody');
  body.innerHTML = `
    <div class="st-ed st-one">
      <div class="bx-panel st-rail">
        <div class="bx-h"><h3>Components <small>· drag one onto your page</small></h3></div>
        <form class="st-add" id="stAdd">
          <input id="stAddIn" placeholder="Paste a link or code — uiverse, 21st.dev, React Bits, MUI…" autocomplete="off">
          <div class="bx-row"><button class="primary" id="stAddGo" type="submit">Add</button><button class="ghost" type="button" id="stAddFile">Upload a file</button></div>
          <p class="st-muted">Or drop a file — or drag a component’s link from another tab — straight onto your page.</p>
        </form>
        ${S.swapFor ? `<div class="st-banner st-swapbar"><span>⇄ Pick the component to swap in</span><button class="ghost" id="stSwapX" type="button">Cancel</button></div>` : ''}
        <div class="st-chips" id="stRail">${comps.list.length ? '' : '<div class="bx-empty">No components yet — paste a link above.</div>'}</div>
      </div>
      <div class="bx-panel st-prev">${stToolbar()}
        <div class="st-stage"><div class="bx-frame ${S.device}" id="stFrame"></div><div class="st-drop-hint" id="stDropHint">Drop it on your page</div></div>
      </div>
    </div>`;
  const rail = $('stRail');
  comps.list.forEach(c => {
    const el = document.createElement('div');
    el.className = 'st-chip' + (S.flash === c.id ? ' flash' : '') + (S.swapFor ? ' pickable' : ''); el.draggable = true; el.dataset.c = c.id;
    el.innerHTML = `<div class="th"></div><span>${esc(c.name)}</span><small>${esc(c.source)}</small>`;
    const th = el.querySelector('.th');
    if (c.icon) th.innerHTML = `<img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}" style="width:44px;height:44px;margin:auto;display:block;position:relative;top:50%;transform:translateY(-50%)">`;
    else { const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('tabindex', '-1'); f.setAttribute('loading', 'lazy'); f.srcdoc = compThumbDoc(c); th.appendChild(f); const fit = () => { if (th.clientWidth) f.style.transform = `scale(${th.clientWidth / 600})`; }; fit(); new ResizeObserver(fit).observe(th); }
    el.addEventListener('dragstart', e => { S.drag = c.id; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'reskin-component:' + c.id); el.classList.add('drag'); $('stFrame').classList.add('dropping'); stPost({ rkDragging: true }); });
    el.addEventListener('dragend', () => { el.classList.remove('drag'); const fr = $('stFrame'); if (fr) fr.classList.remove('dropping'); stPost({ rkDragging: false }); setTimeout(() => { S.drag = null; }, 400); });
    el.onclick = () => {
      if (S.swapFor) { const w = S.swapFor; S.swapFor = null; return placeComp(c.id, w.editId ? { kind: 'swap', editId: w.editId } : { kind: 'swapblock', scope: w.blockId }); }
      toast('Drag it onto your page');
    };
    rail.appendChild(el);
  });
  S.flash = null;
  if ($('stSwapX')) $('stSwapX').onclick = () => { S.swapFor = null; renderEditorWs(); };
  $('stAdd').onsubmit = async e => {
    e.preventDefault(); const v = $('stAddIn').value.trim(); if (!v) return;
    const id = await importDropped([], v);
    if (id) { $('stAddIn').value = ''; S.flash = id; renderEditorWs(); toast(`Added “${compById(id).name}” — drag it onto your page`, 3500); }
  };
  $('stAddFile').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.html,.htm,.tsx,.jsx,image/*'; i.onchange = async () => { const id = await importDropped([...i.files], ''); if (id) { S.flash = id; renderEditorWs(); toast('Added — drag it onto your page'); } }; i.click(); };
  wireStToolbar();
  renderStudioPreview();
}

/* ---- placing: what you drop lands where the page showed it would, with sensible defaults; Undo is one click ---- */
const snapshotPage = () => JSON.stringify({ edits: B.project.edits || [], blocks: B.project.blocks, btnCss: B.project.btnCss || '', btnFrom: B.project.btnFrom || null });
function restorePage(snap) { const o = JSON.parse(snap); Object.assign(B.project, o); saveProject(); renderEditorWs(); }
function toastUndo(msg, snap) {
  let t = $('undoToast'); if (!t) { t = document.createElement('div'); t.id = 'undoToast'; t.className = 'undo-toast'; document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(msg)}</span><button type="button">Undo</button>`;
  t.classList.add('show'); clearTimeout(toastUndo.t); toastUndo.t = setTimeout(() => t.classList.remove('show'), 6500);
  t.querySelector('button').onclick = () => { t.classList.remove('show'); restorePage(snap); toast('Undone'); };
}
function placeComp(compId, it) {
  const c = compById(compId); if (!c || !it) return;
  const snap = snapshotPage(), edits = projectEdits(), recolor = !!(brandColor() && c.tokens && (c.tokens.accent || c.tokens.btnBg));
  let msg = '';
  if (it.kind === 'swap') {
    const e = editById(it.editId); if (!e) return;
    e.compId = c.id; delete e.inner; delete e.props; delete e.links; msg = `Swapped in “${c.name}”`;
  } else if (it.kind === 'swapblock') {
    const b = blockById(it.scope); if (!b) return;
    b.compId = c.id; b.label = c.name; delete b.inner; delete b.props; msg = `Swapped in “${c.name}”`;
  } else if (it.kind === 'replace') {
    const href = it.info && it.info.href && it.info.href.replace(/^about:srcdoc/, '');
    edits.push({ id: newEditId(), target: it.addr, targetLabel: (it.info && it.info.label) || '', targetHref: href || '', mode: 'replace', compId: c.id,
      text: (it.info && it.info.label) || null, recolor, action: href && href !== '#' ? { type: 'keep', href } : null });
    msg = `“${c.name}” replaced “${((it.info && it.info.label) || 'the button').slice(0, 30)}” — same words, same link`;
  } else if (it.kind === 'here') {
    edits.push({ id: newEditId(), target: it.addr, targetLabel: (it.info && it.info.label) || '', mode: 'after', compId: c.id, recolor, layout: { flow: true, size: 'auto' } });
    msg = `Added “${c.name}”`;
  } else if (it.kind === 'gap') {
    edits.push({ id: newEditId(), target: { scope: it.scope, kind: 'section', idx: 0 }, targetLabel: blockLabel(it.scope), mode: 'after', compId: c.id, recolor, layout: { flow: true, size: 'auto' } });
    edits[edits.length - 1].layout.row = true; msg = `Added “${c.name}” as a new section`;
  } else return;
  saveProject(); renderEditorWs(); toastUndo(msg, snap);
  if (!c.tokens) ensureCompTokens(c);   // read its colours for next time (brand-colour matching)
}
// anything dropped from outside Reskin (a file, a link, some code) becomes a component first
async function importDropped(files, text) {
  try {
    const items = [];
    for (const f of files || []) {
      if (/^image\//.test(f.type)) {
        const src = await readDataUrl(f); if (!src) continue;
        items.push({ name: titleCase(f.name.replace(/\.\w+$/, '')), source: 'picture', kind: 'html', code: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{min-height:100vh;display:grid;place-items:center}img{max-width:100%;max-height:100vh;object-fit:contain;border-radius:12px}</style></head><body><img src="${src}" alt=""></body></html>` });
      } else if (/\.(html?|tsx|jsx)$/i.test(f.name)) { const code = await f.text(); items.push({ name: titleCase(f.name.replace(/\.\w+$/, '')), source: 'file', kind: detectKind(code, f.name), code }); }
    }
    text = (text || '').trim();
    if (!items.length && text && !/^reskin-component:/.test(text)) {
      const first = text.split(/\s+/)[0];
      if (/^https?:\/\//.test(first) || /^(www\.)?(uiverse\.io|21st\.dev|mui\.com|reactbits\.dev)\//.test(first)) { toast('Fetching the component…', 2500); items.push(...await importByLink(first)); }
      else if (/[<{]|^\s*(import|export|const|function)\b/.test(text)) { const kind = detectKind(text); items.push({ name: titleCase(((/(?:function|const)\s+([A-Z]\w*)/.exec(text) || [])[1] || 'Pasted component').replace(/([a-z])([A-Z])/g, '$1 $2')), source: 'pasted', kind, code: text }); }
    }
    if (!items.length) { if (text || (files && files.length)) toast('That isn’t a component Reskin can use — try a link, code, an .html/.tsx file or a picture', 4500); return null; }
    items.forEach(c => comps.list.unshift({ id: newId(), collection: 'My kit', created: Date.now(), ...c }));
    comps.save();
    return comps.list[0].id;
  } catch (e) { toast(e.message || 'Couldn’t add that', 4500); return null; }
}

function stPost(msg) { const f = $('stFrame') && $('stFrame').querySelector('iframe'); if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*'); }
function renderStudioPreview() {
  const box = $('stFrame'); if (!box) return;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox'); f.title = 'Your page';
  f.srcdoc = injectPreviewCss(composeDoc({ preview: true, rules: false, studio: 'edit' }));
  box.replaceChildren(f);
}

// messages from the editor preview
addEventListener('message', e => {
  const d = e.data || {};
  if (state.view !== 'studio' || !$('stFrame')) return;
  const f = $('stFrame').querySelector('iframe'); if (!f || e.source !== f.contentWindow) return;
  if (d.rkDrop) {
    const it = d.rkDrop; let compId = S.drag; S.drag = null;
    (async () => { if (!compId) compId = await importDropped(d.files, d.text); if (compId) placeComp(compId, it); })();
    return;
  }
  if (d.rkTool) {
    const t = d.rkTool, snap = snapshotPage();
    if (t.action === 'remove') {
      if (t.editId) { const e = editById(t.editId); B.project.edits = projectEdits().filter(x => x.id !== t.editId); saveProject(); renderEditorWs(); toastUndo(`Removed “${(compById(e && e.compId) || {}).name || 'it'}”`, snap); }
      else if (t.blockId) { removeBlock(t.blockId); toastUndo('Removed it', snap); }
    }
    if (t.action === 'swap') { S.swapFor = { editId: t.editId, blockId: t.blockId }; renderEditorWs(); toast('Pick the component to swap in — or drag one onto it'); }
    if (t.action === 'size' && t.editId) {
      const e = editById(t.editId), order = ['auto', 's', 'wide', 'big', 'band', 'full'];
      const L = e.layout || (e.layout = { flow: true, size: 'auto' }), next = order[(order.indexOf(L.size) + 1) % order.length];
      L.size = next; L.flow = true; saveProject(); renderStudioPreview(); toast('Size: ' + sizeName(next));
    }
    return;
  }
  if (d.rkText) { saveTextEdit(d.rkText.addr, d.rkText.text, d.rkText.was); return; }
  if (d.rkCtx) {
    const fr = $('stFrame').querySelector('iframe').getBoundingClientRect();
    const items = ctxItems(d.rkCtx); if (items.length) openCtx(fr.left + d.x, fr.top + d.y, items);
    return;
  }
});

/* ---- the node view: wire parts (left) to where they go (right) ---- */

/* ---- "Edit in detail": one section or component on its own, every part editable ---- */
const blockById = id => B.project.blocks.find(b => b.id === id);
function removeBlock(id) {
  const arr = B.project.blocks, b = blockById(id); if (!b) return;
  const i = arr.indexOf(b);
  if (b.replaces) arr.splice(i, 1, ...siteBlocks(state.model).filter(x => x.ref === b.replaces)); else arr.splice(i, 1);
  B.project.edits = projectEdits().filter(e => e.target.scope !== id);
  saveProject(); toast(`Removed “${b.label}”${b.replaces ? ' — your own section is back' : ''}`); renderStudio();
}
const toHex = c => { try { return rgbToHex(cssToRgb(c)); } catch { return '#000000'; } };

/* ---- right-click menu ---- */
function saveTextEdit(addr, text, was) {
  const edits = projectEdits(), ex = edits.find(e => e.mode === 'text' && sameAddr(e.target, addr));
  if (ex) ex.text = text; else edits.push({ id: newEditId(), target: addr, targetLabel: was || '', mode: 'text', text });
  saveProject(); toast(`Text changed to “${text.slice(0, 40)}”`);
}
function ctxItems(t) {
  const edits = projectEdits(), items = [];
  if (t.editId) {
    const e = editById(t.editId), c = e && compById(e.compId), snap = snapshotPage();
    if (c && isClicky(e.target.kind)) items.push({ label: 'Change its words', icon: '✎', run: () => { const v = prompt('What should it say?', e.text || e.targetLabel || ''); if (v != null && v.trim()) { e.text = v.trim(); saveProject(); renderStudioPreview(); } } });
    if (c) items.push({ label: 'Swap for another component', icon: '⇄', run: () => { S.swapFor = { editId: e.id }; renderEditorWs(); } });
    items.push({ label: 'Remove', icon: '✕', danger: true, run: () => { B.project.edits = edits.filter(x => x.id !== t.editId); saveProject(); renderEditorWs(); toastUndo('Removed', snap); } });
    return items;
  }
  const a = t.addr, snap = snapshotPage();
  if (a.kind === 'section') {
    const b = blockById(a.scope);
    if (b && b.kind === 'comp') return [{ label: 'Swap for another component', icon: '⇄', run: () => { S.swapFor = { blockId: b.id }; renderEditorWs(); } }, { label: 'Remove', icon: '✕', danger: true, run: () => { removeBlock(b.id); toastUndo('Removed', snap); } }];
    if (b) return [{ label: b.hidden ? 'Show this section' : 'Hide this section', icon: b.hidden ? '◉' : '◌', run: () => { b.hidden = !b.hidden; saveProject(); renderEditorWs(); toastUndo(b.hidden ? 'Section hidden' : 'Section shown', snap); } }];
    return [];
  }
  if ({ heading: 1, text: 1, button: 1, link: 1 }[a.kind]) items.push({ label: 'Edit the words', icon: '✎', hint: 'or double-click', run: () => stPost({ rkEditText: a }) });
  const hid = edits.find(e => e.mode === 'hide' && sameAddr(e.target, a));
  items.push(hid ? { label: 'Show it again', icon: '◉', run: () => { B.project.edits = edits.filter(x => x !== hid); saveProject(); renderStudioPreview(); } }
    : { label: 'Hide it', icon: '◌', run: () => { edits.push({ id: newEditId(), target: a, targetLabel: t.info && t.info.label || '', mode: 'hide' }); saveProject(); renderStudioPreview(); toastUndo('Hidden', snap); } });
  const mine = edits.filter(e => sameAddr(e.target, a) && (e.mode === 'text' || e.mode === 'hide'));
  if (mine.length) items.push({ label: 'Back to how it was', icon: '↺', run: () => { B.project.edits = edits.filter(x => !mine.includes(x)); saveProject(); renderStudioPreview(); } });
  return items;
}

/* ---- the questions ---- */


/* ------------------------------------------------------------------ hook into the app */
VIEWS.studio = renderStudio;
