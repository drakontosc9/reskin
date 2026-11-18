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
  ws: 'site',          // site | component | editor
  device: 'desktop',
  tryIt: false,        // editor preview: run click actions instead of selecting
  links: false,        // editor: show the node view (wire parts to where they go) over the preview
  parts: { page: [], comps: {} },   // clickable parts reported by the preview, for the node view
  wireFrom: null,      // node view: a "from" dot that was clicked, waiting for a "to" dot
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
const KIND_NAMES = { button: 'button', link: 'link', heading: 'heading', text: 'text', image: 'image', card: 'card', section: 'section' };
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
    return t.replace(/\s+/g, ' ').slice(0, 40) || el.tagName.toLowerCase();
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
    if ('rkPickMode' in d) { PICK = !!d.rkPickMode; if (!PICK && ph) { ph.removeAttribute('data-rk-ph'); ph = null; } markLinked(PICK); }
  });
  document.addEventListener('mousemove', function (e) {
    if (!PICK) return; var el = e.altKey ? null : partOf(e.target);
    if (ph && ph !== el) ph.removeAttribute('data-rk-ph'); ph = el; if (el) el.setAttribute('data-rk-ph', '');
  }, true);
  document.addEventListener('click', function (e) {
    if (PICK) {
      if (e.altKey) { setTimeout(function () { markLinked(true); }, 400); return; }   // Alt-click: use it normally (open a folder first…)
      e.preventDefault(); e.stopPropagation();
      var el = partOf(e.target);
      parent.postMessage({ rkInnerPick: { id: D.id, path: pathOf(el), label: labelOf(el) } }, '*');
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
  addEventListener('load', function () { label(); report(); });
  addEventListener('resize', function () { setTimeout(report, 60); });
  var n = 0, iv = setInterval(function () { if (n < 12) label(); report(); if (++n > 25) { clearInterval(iv); setInterval(report, 2000); } }, 350);
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
  function find(t) { var r = root(t.scope); if (!r) return null; if (t.kind === 'section') return r; return r.querySelectorAll(KINDS[t.kind])[t.idx] || null; }
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
  function setPick(id) {
    if (PICK_ID && F[PICK_ID]) { F[PICK_ID].f.style.pointerEvents = 'none'; F[PICK_ID].f.contentWindow.postMessage({ rkPickMode: false }, '*'); }
    PICK_ID = id || null;
    if (PICK_ID && F[PICK_ID]) { F[PICK_ID].f.style.pointerEvents = 'auto'; F[PICK_ID].f.contentWindow.postMessage({ rkPickMode: true }, '*'); }
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
  EDITS.forEach(function (e) {
    var el = e._el; if (!el) return;
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
    if ('rkInner' in d && MODE === 'edit') setPick(d.rkInner);
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

  // ---- editor: hover, click to select, drop components
  var tag = document.createElement('div'); tag.className = 'rk-tag'; document.body.appendChild(tag);
  var hov = null, drop = null;
  function mark(attr, el, old) { if (old && old !== el) old.removeAttribute(attr); if (el) el.setAttribute(attr, ''); return el; }
  function describe(t) {
    if (t.editId) return 'Your change — click to edit';
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
  document.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    var t = targetOf(ev.target); if (!t) return;
    parent.postMessage({ rkPick: plain(t) }, '*');
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
  const html = compBlockDoc(c, { fill: 'own', recolor: !!e.recolor });
  const css = mode === 'crop'
    ? '<style>html{overflow:hidden!important}html,body{background:transparent!important}</style>'
    : '<style>html{overflow:hidden!important}</style>';
  const links = (e.links || []).map(l => ({ path: l.path, label: l.label }));
  return injectEnd(html, css + `<script>(${__rkElem})(${jsonForScript({ id: e.id, text: e.text || null, mode, act: !!act, links })});<\/script>`);
}
// called by composeDoc (builder.js); mode: edit (Studio editor) · show (Build tab) · try (previews) · live (downloaded site)
function studioScript(p, mode) {
  const edits = (p.edits || []).map(e => {
    const c = e.compId && compById(e.compId), inline = isClicky(e.target.kind);
    const pc = e.action && e.action.type === 'popup' && compById(e.action.compId);
    return {
      id: e.id, target: e.target, mode: e.mode, inline, action: e.action || null, layout: e.layout || { flow: true, size: 'auto' },
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

/* ------------------------------------------------------------------ the Studio tab */
function renderStudio() {
  const box = $('studioView');
  if (!state.model) { box.innerHTML = '<div class="bx-panel bx-empty">Paste your site at the top first.</div>'; return; }
  ensureProject(); projectEdits();
  const p = B.project, nEdits = p.edits.length + p.blocks.filter(b => b.kind === 'comp').length;
  const step = (id, n, t, sub) => `<button class="st-step ${S.ws === id ? 'on' : ''}" data-ws="${id}"><i>${n}</i><span><b>${t}</b><small>${sub}</small></span></button>`;
  box.innerHTML = `
    <div class="st-steps">
      ${step('site', 1, 'Site', `Template: ${esc(p.style.name)}`)}<span class="st-arrow">→</span>
      ${step('component', 2, 'Component', `${comps.list.length} saved`)}<span class="st-arrow">→</span>
      ${step('editor', 3, 'Editor', nEdits ? `${nEdits} change${nEdits > 1 ? 's' : ''} on your page` : 'Drop components on your page')}
    </div>
    <div id="stBody"></div>`;
  box.querySelectorAll('[data-ws]').forEach(b => b.onclick = () => { S.ws = b.dataset.ws; S.ask = null; S.picking = null; renderStudio(); });
  restoreComps();
  if (S.ws === 'site') renderSiteWs();
  else if (S.ws === 'component') renderCompWs();
  else renderEditorWs();
}
const goWs = ws => { S.ws = ws; S.ask = null; S.picking = null; renderStudio(); $('studioView').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

/* ---- 1. Site: pick a template ---- */
function renderSiteWs() {
  const p = B.project, body = $('stBody');
  if (!state.styles.length) state.styles = batch(12, state.mood, true);
  const seen = new Set([p.style.id]), list = [p.style];
  [...state.styles, ...state.saved].forEach(s => { if (s && !s.live && !seen.has(s.id)) { seen.add(s.id); list.push(s); } });
  const fromTarget = state.mood === 'target' && state.tgt && state.tgt.tokens;
  body.innerHTML = `
    <div class="st-head"><div><h2>Pick a template for your site</h2><p>Your words and pictures stay the same. Click a template to preview it, then <b>Use this</b>.${fromTarget ? ` These are based on <b>${esc(state.tgt.name)}</b>.` : ''}</p></div>
      <div class="bx-row"><button class="ghost" id="stLike">Base them on a design I like…</button><button class="ghost" id="stMore">More templates</button><button class="primary" id="stNext1">Next: components →</button></div></div>
    <div class="st-grid" id="stGrid"></div>`;
  const grid = $('stGrid');
  list.forEach(s => {
    const on = s.id === p.style.id, el = document.createElement('article');
    el.className = 'tile st-tile' + (on ? ' on' : '');
    el.innerHTML = `<div class="thumb">${on ? '<span class="badge">✓ Your template</span>' : ''}<div class="hov"><span>Preview</span></div></div>
      <div class="meta"><div class="txt"><h3>${esc(s.name)}</h3><p>${esc(s.label)} · ${esc(s.fontLabel)}</p></div>
      <button class="${on ? 'ghost' : 'primary'} st-use" ${on ? 'disabled' : ''}>${on ? 'In use' : 'Use this'}</button></div>`;
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-popups'); f.setAttribute('tabindex', '-1'); f.setAttribute('loading', 'lazy'); f.title = s.name;
    f.srcdoc = renderSite(viewModel(), s, { preview: true, thumb: true, base: state.base });
    el.querySelector('.thumb').prepend(f);
    el.querySelector('.thumb').onclick = () => openModal(s);
    el.querySelector('.st-use').onclick = () => { p.style = s; saveProject(); toast(`“${s.name}” is now your site’s template`); renderStudio(); };
    grid.appendChild(el);
  });
  const fit = () => { const t = grid.querySelector('.thumb'); if (t && t.clientWidth) grid.style.setProperty('--s', t.clientWidth / 1280); };
  fit(); new ResizeObserver(fit).observe(grid);
  $('stMore').onclick = () => { state.styles = [...state.styles, ...batch(6, state.mood, false)]; renderSiteWs(); };
  $('stLike').onclick = () => { $('tgtCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Drop or paste a design here, then come back to Studio'); };
  $('stNext1').onclick = () => goWs('component');
}

/* ---- 2. Component: your saved UI pieces (the Components library, moved in here) ---- */
function renderCompWs() {
  const body = $('stBody'), signedIn = !!document.querySelector('#acct .dot.on');
  body.innerHTML = `
    <div class="st-head"><div><h2>Your components</h2><p>Save buttons, cards, forms and banners you like. ${signedIn ? 'They’re saved to <b>your account</b>.' : document.getElementById('acctIn') ? 'They’re saved in this browser — <a href="#" id="stSignIn">sign in</a> to keep them in your account.' : 'They’re saved in this browser.'}</p></div>
      <div class="bx-row"><button class="primary" id="stNext2">Next: put them on your page →</button></div></div>
    <div id="stComps"></div>`;
  $('stComps').appendChild($('comps'));
  $('comps').hidden = false;
  renderComps();
  if ($('stSignIn')) $('stSignIn').onclick = e => { e.preventDefault(); $('acctIn').click(); };
  $('stNext2').onclick = () => goWs('editor');
}
function restoreComps() {   // put the library back where the Components tab expects it
  const c = $('comps');
  if (c && c.parentElement !== $('results')) { $('results').insertBefore(c, $('compView')); c.hidden = true; }
}
// in Studio, each saved component gets "Put on my page" and "Apply its style…"
function studioPatchComps() {
  const cnt = document.querySelector('.st-step[data-ws="component"] small'); if (cnt) cnt.textContent = `${comps.list.length} saved`;
  const shown = comps.list.filter(c => comps.filter === 'All' || c.collection === comps.filter);
  $('comps').querySelectorAll('.ctile').forEach((t, i) => {
    const c = shown[i]; if (!c) return;
    const use = t.querySelector('[data-use]');
    use.textContent = 'Apply its style…';
    use.onclick = () => applyStyleDialog(c);
    const put = document.createElement('button'); put.className = 'primary'; put.textContent = 'Put on my page';
    put.onclick = () => { S.flash = c.id; goWs('editor'); };
    use.before(put);
  });
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
        <div class="bx-h"><h3>Your page <small>· ${S.tryIt ? 'clicks work like on the real site' : 'click a part, or drop a component on it'}</small></h3>
          <div class="bx-row">
            <div class="seg" id="stMode"><button data-m="page" class="${S.links ? '' : 'on'}">Page</button><button data-m="links" class="${S.links ? 'on' : ''}">🔗 Links</button></div>
            <label class="found st-try" title="Click buttons to see what they do"><input type="checkbox" id="stTry" ${S.tryIt ? 'checked' : ''}> Try it</label>
            <div class="seg" id="stDev"><button data-d="desktop" class="${S.device === 'desktop' ? 'on' : ''}">Desktop</button><button data-d="mobile" class="${S.device === 'mobile' ? 'on' : ''}">Mobile</button></div>
            <button class="ghost" id="stOpen">Open full page</button>
            <button class="primary" id="stDl" style="height:34px;padding:0 12px;font-size:13px">Download site</button>
          </div></div>
        ${S.innerPick && editById(S.innerPick) ? `<div class="st-banner">🔗 Click the part of “${esc((compById(editById(S.innerPick).compId) || {}).name || 'it')}” to link. Alt-click uses it normally (e.g. open a folder first). <button class="ghost" id="stInnerX">Done</button></div>` : ''}
        ${S.picking ? '<div class="st-banner">👆 Click the button on your page that should open it. <button class="ghost" id="stPickX">Cancel</button></div>' : S.armed && compById(S.armed) ? `<div class="st-banner">👆 Now click where “${esc(compById(S.armed).name)}” goes on your page. <button class="ghost" id="stArmX">Cancel</button></div>` : ''}
        <div class="st-stage"><div class="bx-frame ${S.device}" id="stFrame"></div><div class="st-nodes" id="stNodes" ${S.links ? '' : 'hidden'}></div></div>
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
    el.onclick = () => { S.armed = S.armed === c.id ? null : c.id; S.ask = null; S.picking = null; renderEditorWs(); };
    rail.appendChild(el);
  });
  S.flash = null;
  if ($('stGoComp')) $('stGoComp').onclick = () => goWs('component');
  body.querySelectorAll('[data-chg]').forEach(b => b.onclick = () => {
    const id = b.dataset.chg, k = b.dataset.k;
    if (k === 'e') { S.ask = null; S.sel = { editId: id }; renderSideStudio(); stPost({ rkHi: { editId: id }, scroll: true }); }
    else if (k === 'b') { B.sel = id; setView('build'); }
    else applyStyleDialog(compById(p.btnFrom) || { name: 'component', id: null });
  });
  $('stTry').onchange = e => { S.tryIt = e.target.checked; renderEditorWs(); };
  $('stMode').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.links = b.dataset.m === 'links'; S.wireFrom = null; if (S.links) S.tryIt = false; renderEditorWs(); };
  $('stDev').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.device = b.dataset.d; $('stDev').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('stFrame').className = 'bx-frame ' + S.device; };
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
    if (S.links) { renderNodes(); setTimeout(() => stPost({ rkListParts: true }), 1500); setTimeout(() => stPost({ rkListParts: true }), 5000); }
    if (S.picking) stPost({ rkOnly: true });
    if (S.innerPick) stPost({ rkInner: S.innerPick });
    const hi = S.sel && (S.sel.editId ? { editId: S.sel.editId } : { addr: S.sel.addr });
    if (hi) stPost({ rkHi: hi });
  }, 120);
  box.replaceChildren(f);
}

// messages from the editor preview
addEventListener('message', e => {
  const d = e.data || {};
  if (state.view !== 'studio' || S.ws !== 'editor' || !$('stFrame')) return;
  const f = $('stFrame').querySelector('iframe'); if (!f || e.source !== f.contentWindow) return;
  if (d.rkDrop) {
    const compId = S.drag; S.drag = null;
    if (!compId) return;
    if (d.rkDrop.editId) { const ed = editById(d.rkDrop.editId); if (ed) { S.sel = { editId: ed.id }; startAsk({ compId, addr: ed.target, info: { kind: ed.target.kind, label: ed.targetLabel, href: ed.targetHref }, replacing: ed.id }); } return; }
    startAsk({ compId, addr: d.rkDrop.addr, info: d.rkDrop.info });
  }
  if (d.rkPartsOf) {
    if (d.rkPartsOf.page) S.parts.page = d.rkPartsOf.page;
    if (d.rkPartsOf.id) S.parts.comps[d.rkPartsOf.id] = d.rkPartsOf.parts;
    if (S.links) { clearTimeout(S._nt); S._nt = setTimeout(renderNodes, 120); }
    return;
  }
  if (d.rkInnerPick && S.innerPick) {   // a part inside a component was clicked: ask what it should do
    const ed = editById(d.rkInnerPick.id); if (!ed) return;
    const part = d.rkInnerPick; S.innerPick = null; stPost({ rkInner: null });
    if (S.backToLinks) {   // came from the node view: add the part there and let them wire it
      S.backToLinks = false; S.links = true;
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
    S.ask = null; S.sel = t;
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
  const box = $('stNodes'); if (!box || !S.links) return;
  const sources = nodeSources(), targets = nodeTargets(), rowsByKey = {};
  sources.forEach(n => n.rows.forEach(r => { rowsByKey[r.key] = r; }));
  const tByKey = {}; targets.forEach(n => n.rows.forEach(r => { tByKey[r.key] = r; }));
  const wired = sources.flatMap(n => n.rows.filter(r => r.action && tByKey[targetKey(r.action)]).map(r => ({ from: r.key, to: targetKey(r.action), r })));
  const used = new Set(wired.map(w => w.to));
  box.innerHTML = `
    <div class="nd-help"><b>Drag from a dot on the left to where it should go on the right.</b> Or click a dot, then the other. Click a line to remove it.</div>
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
  if (!box._ro) { box._ro = new ResizeObserver(() => S.links && renderNodesWires()); box._ro.observe(box); }
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
      if (!moved) { S.wireFrom = S.wireFrom === from ? null : from; box.querySelectorAll('.nd-out').forEach(d => d.classList.toggle('armed', d.dataset.from === S.wireFrom)); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  box.querySelectorAll('.nd-in').forEach(dot => dot.onclick = () => { if (S.wireFrom) connect(S.wireFrom, dot.dataset.to); else toast('Start from a dot on the left'); });
  box.querySelectorAll('[data-unwire]').forEach(el => el.onclick = () => { const row = rowsByKey[el.dataset.unwire]; if (!row) return; setSourceAction(row, null); toast('Link removed'); renderNodes(); renderStudioPreview(); });
  box.querySelectorAll('[data-pickpart]').forEach(b => b.onclick = () => { S.links = false; S.backToLinks = true; S.innerPick = b.dataset.pickpart; renderEditorWs(); });
}
function renderNodesWires() { if (S._drawWires && $('ndWires')) S._drawWires(); }

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

function renderSideStudio() {
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
function renderSelInfo() {
  const side = $('stSide'), t = S.sel;
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
        ${e.compId ? '<button class="ghost" id="selEdit">Change the rest</button>' : ''}
        ${e.compId && !isClicky(e.target.kind) && e.mode !== 'action' ? `<div class="st-lay"><b>Linked parts</b>
          ${(e.links || []).map((l, i) => `<div class="st-link"><button class="st-chg" data-lk="${i}">${esc(quote(l.label))} → ${esc(actionWords(l.action))}</button><button class="icon" data-lkx="${i}" title="Remove this link">✕</button></div>`).join('') || '<p class="st-muted">Folders, files, menu items or buttons inside it can each scroll to a section, open a page or pop something up.</p>'}
          <button class="primary" id="selLink">🔗 Link a part of it</button></div>` : ''}
        <button class="ghost" id="selDel" style="color:#b2341a">Undo this change</button></div>
      <p class="st-muted" style="margin-top:12px">Tip: drop another component on it to swap it.</p></div>`;
    stPost({ rkHi: { editId: e.id } });
    if ($('selAct')) $('selAct').onclick = () => startAsk({ editing: e.id, actionOnly: true });
    if ($('selEdit')) $('selEdit').onclick = () => startAsk({ editing: e.id });
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
        ${isClicky(k) ? '<button class="primary" id="selAct">Change what it does when clicked</button>' : ''}
        ${k === 'section' ? '<button class="ghost" id="selBuild">Move, hide or schedule it (Build)</button>' : ''}</div>
      <p class="st-muted" style="margin-top:12px">Drag a component from the left onto it to ${k === 'section' ? 'replace it or add something below' : 'replace it'}.</p></div>`;
    if ($('selAct')) $('selAct').onclick = () => startAsk({ addr: t.addr, info: t.info, actionOnly: true });
    if ($('selBuild')) $('selBuild').onclick = () => { B.sel = t.addr.scope; setView('build'); };
  }
  $('selX').onclick = () => { S.sel = null; stPost({ rkHi: null }); renderSelInfo(); };
}

/* ------------------------------------------------------------------ hook into the app */
VIEWS.studio = renderStudio;
{
  const rc = renderComps;
  renderComps = function () { rc.apply(this, arguments); if (state.view === 'studio' && S.ws === 'component') studioPatchComps(); };
  const rg = renderGrid;
  renderGrid = function () { if (state.view !== 'studio') restoreComps(); return rg.apply(this, arguments); };
}
