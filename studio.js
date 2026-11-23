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
      // a full-screen wrapper: its colour is the backdrop — but a full-screen canvas, video or picture IS the
      // component (a WebGL lens, a shader), not staging
      if (r.width >= vw * 0.97 && r.height >= vh * 0.9 && !/^(CANVAS|VIDEO|IMG|SVG|IFRAME|PICTURE)$/i.test(el.tagName)) { BG = opaque(el) || BG; stage.push(el); continue; }
      if (r.width >= vw * 0.97 && bare(el)) continue;   // a full-width layout wrapper (React's #root, a flex row) isn't content either
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
  // nothing of its own to see: no colour, border, shadow, words or media — only holds other things
  function bare(el) {
    if (/^(IMG|SVG|CANVAS|VIDEO|INPUT|BUTTON|TEXTAREA|SELECT|IFRAME|HR)$/i.test(el.tagName) || opaque(el)) return false;
    var c = getComputedStyle(el);
    if (parseFloat(c.borderTopWidth) || parseFloat(c.borderBottomWidth) || (c.boxShadow && c.boxShadow !== 'none')) return false;
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return false;
    return true;
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
        e.stopImmediatePropagation(); parent.postMessage({ rkAct: D.id, link: i }, '*'); return;   // only this link, not the whole component's action too
      }
    }
  }, true);

  if (D.act) document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest(SEL);
    if (!t && D.mode === 'fit') return;
    e.preventDefault(); parent.postMessage({ rkAct: D.id }, '*');
  }, true);
  function controlAt(t) {   // the button or link under the pointer, if any
    var el = partOf(t); if (!el || el === document.body) return null;
    var ctl = el.matches('button,a,[role=button],[role=menuitem],[role=tab],summary,input[type=submit],input[type=button]') || getComputedStyle(el).cursor === 'pointer';
    return ctl ? { path: pathOf(el), label: labelOf(el) } : null;
  }
  document.addEventListener('contextmenu', function (e) { if (WORDS) return; e.preventDefault(); parent.postMessage({ rkElCtx: D.id, x: e.clientX, y: e.clientY, part: controlAt(e.target) }, '*'); }, true);
  // the component's own links: "#" goes nowhere; a real address opens on the page, not inside this little frame
  document.addEventListener('click', function (e) {
    if (PICK || WORDS || e.defaultPrevented) return;
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var h = a.getAttribute('href') || ''; e.preventDefault();
    // a site link carried in ("/pricing", "#about") is relative to the site, not to this frame
    if (h && h !== '#' && !/^javascript:/i.test(h)) parent.postMessage({ rkGo: /^[a-z][\w+.-]*:/i.test(h) ? a.href : h, newTab: a.target === '_blank' }, '*');
  });
  // ---- a navigation bar standing in for the site's own: its menu gets the site's links, brand and call to action.
  // The menu is the biggest group of same-shaped clickable items with words (icons stay); found once, re-found only
  // if the component re-renders them away.
  var NAV = D.nav || null;
  function words(el) { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function shown(el) { var r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; }
  function navFill() {
    if (!NAV || !document.body) return;
    var marked = document.querySelectorAll('[data-rk-nav]');
    if (marked.length && Array.prototype.every.call(marked, function (x) { return x.isConnected; })) return;
    document.querySelectorAll('[data-rk-navclone]').forEach(function (x) { x.remove(); });
    document.querySelectorAll('[data-rk-navhid]').forEach(function (x) { x.style.removeProperty('display'); x.removeAttribute('data-rk-navhid'); });
    var CL = 'a,button,[role=menuitem],[role=tab],[role=link]';
    var cand = Array.prototype.filter.call(document.body.querySelectorAll(CL), function (a) {
      var t = words(a); return t && t.length <= 30 && shown(a) && !(a.parentElement && a.parentElement.closest(CL));
    });
    var look = function (a) { var s = getComputedStyle(a); return [a.tagName, s.display, s.fontSize, s.fontWeight, s.textTransform, s.paddingTop, s.paddingLeft].join('|'); }, groups = {};
    cand.forEach(function (a) { (groups[look(a)] = groups[look(a)] || []).push(a); });
    var menu = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (x, y) { return y.length - x.length; })[0] || [];
    if (menu.length < 2) return;
    var first = menu[0], last = menu[menu.length - 1];
    var before = function (a, b) { return !!(a.compareDocumentPosition(b) & 4); };
    // where each item sits: the ancestor that is a child of the menu's common parent (an <li>, a wrapper)
    var common = first.parentElement; while (common && !common.contains(menu[1])) common = common.parentElement;
    var slot = function (a) { var x = a; while (x.parentElement && x.parentElement !== common) x = x.parentElement; return x; };
    var links = NAV.links || [];
    if (links.length) {
      menu.forEach(function (a, i) {
        a.setAttribute('data-rk-nav', i);
        if (i < links.length) { setTxt(a, links[i].text); if (a.tagName === 'A') a.setAttribute('href', links[i].href || '#'); }
        else { var s = slot(a); s.style.setProperty('display', 'none', 'important'); s.setAttribute('data-rk-navhid', ''); }
      });
      var src = slot(last);
      for (var k = menu.length; k < links.length; k++) {
        var cl = src.cloneNode(true); cl.setAttribute('data-rk-navclone', ''); cl.removeAttribute('data-rk-nav');
        cl.querySelectorAll('[data-rk-nav]').forEach(function (x) { x.removeAttribute('data-rk-nav'); });
        src.parentNode.insertBefore(cl, src.nextSibling); src = cl;
        var ca = cl.matches(CL) ? cl : cl.querySelector(CL) || cl;
        setTxt(ca, links[k].text); if (ca.tagName === 'A') ca.setAttribute('href', links[k].href || '#');
      }
    } else first.setAttribute('data-rk-nav', 0);
    // the call to action: a clickable that isn't part of the menu, after it
    if (NAV.cta) {
      var cta = cand.filter(function (a) { return menu.indexOf(a) < 0 && before(last, a); }).pop();
      if (cta) { setTxt(cta, NAV.cta.text); if (cta.tagName === 'A') cta.setAttribute('href', NAV.cta.href || '#'); }
    }
    // the brand: a logo-ish element, else the first short words before the menu
    if (NAV.brand) {
      var b = document.querySelector('[class*="logo" i],[class*="brand" i]');
      if (b && (menu.some(function (a) { return b.contains(a) || a.contains(b); }) || !words(b))) b = null;
      if (!b) {
        var all = document.body.getElementsByTagName('*');
        for (var j = 0; j < all.length && all[j] !== first; j++) { var el = all[j]; if (/^(SCRIPT|STYLE)$/.test(el.tagName) || !ownText(el) || !shown(el)) continue; if (words(el).length <= 40 && !el.contains(first)) { b = el; break; } }
      }
      if (b && before(b, first)) setTxt(b, NAV.brand);
    }
  }
  var WORDS = false, wEl = null, wWas = '';
  var wst = document.createElement('style');
  wst.textContent = '[data-rk-w]{outline:2px dashed #2f6bff!important;outline-offset:2px;cursor:text!important}[contenteditable=true][data-rk-wed]{outline:2px solid #2f6bff!important;outline-offset:2px}';
  (document.head || document.documentElement).appendChild(wst);
  function ownText(el) { for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return true; return false; }
  function wordsAt(t) { for (var x = t; x && x.nodeType === 1 && x !== document.body; x = x.parentElement) if (ownText(x)) return x; return null; }
  function wordsDone(save) {
    var el = wEl; if (!el) return; wEl = null; el.contentEditable = 'false'; el.removeAttribute('data-rk-wed');
    var t = el.innerText.replace(/\s+/g, ' ').trim();
    if (!save || !t) { el.innerText = wWas; return; }
    if (t !== wWas.replace(/\s+/g, ' ').trim()) {
      var it = { path: pathOf(el), label: wWas.trim().slice(0, 40), text: t, was: wWas.replace(/\s+/g, ' ').trim() }, at = -1;
      INNER.forEach(function (x, i) { if (x.path === it.path) at = i; }); if (at >= 0) INNER[at].text = t; else INNER.push(it);
      parent.postMessage({ rkElWords: D.id, item: it }, '*');
    }
  }
  function wordsMode(on) {
    WORDS = on; if (!on) { wordsDone(true); document.querySelectorAll('[data-rk-w]').forEach(function (x) { x.removeAttribute('data-rk-w'); }); }
  }
  document.addEventListener('mouseover', function (e) {
    if (!WORDS) return; document.querySelectorAll('[data-rk-w]').forEach(function (x) { x.removeAttribute('data-rk-w'); });
    var el = wordsAt(e.target); if (el && el !== wEl) el.setAttribute('data-rk-w', '');
  }, true);
  function wordsStart(el) {
    wordsDone(true); wEl = el; wWas = el.innerText; el.removeAttribute('data-rk-w'); el.setAttribute('data-rk-wed', '');
    el.contentEditable = 'true'; el.focus();
    var r = document.createRange(); r.selectNodeContents(el); var sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
  }
  document.addEventListener('click', function (e) {
    if (!WORDS && !(wEl && wEl.contains(e.target))) return;
    e.preventDefault(); e.stopPropagation(); if (!WORDS) return;   // clicking inside the words you're typing only moves the caret
    var el = wordsAt(e.target); if (!el || el === wEl) return;
    wordsStart(el);
  }, true);
  // in the editor, double-click any words in the component to type over them, just like the page's own words
  var tipEl = null;
  if (D.edit) {
    document.addEventListener('dblclick', function (e) {
      if (PICK || WORDS) return; var el = wordsAt(e.target); if (!el || el === wEl) return;
      e.preventDefault(); e.stopPropagation(); wordsStart(el);
      if (tipEl) { tipEl = null; parent.postMessage({ rkElTip: D.id, on: false }, '*'); }
    }, true);
    document.addEventListener('focusout', function (e) { if (wEl && e.target === wEl && !WORDS) wordsDone(true); }, true);
    document.addEventListener('mousemove', function (e) {
      var w = PICK || WORDS || wEl ? null : wordsAt(e.target);
      if (w || tipEl) parent.postMessage({ rkElTip: D.id, on: !!w, x: e.clientX, y: e.clientY }, '*');
      tipEl = w;
    }, true);
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget && tipEl) { tipEl = null; parent.postMessage({ rkElTip: D.id, on: false }, '*'); } });
  }
  document.addEventListener('keydown', function (e) {
    if (!WORDS && !wEl) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); wordsDone(true); }
    if (e.key === 'Escape') { e.preventDefault(); if (wEl) wordsDone(false); else { wordsMode(false); parent.postMessage({ rkElWordsEnd: D.id }, '*'); } }
  }, true);
  addEventListener('message', function (e) { var d = e.data || {}; if ('rkWords' in d) wordsMode(!!d.rkWords); });
  addEventListener('load', function () { label(); navFill(); applyAllInner(); report(); });
  addEventListener('resize', function () { setTimeout(report, 60); });
  // frameworks may re-render after load: keep re-applying the edits for a while, then on every change
  var n = 0, iv = setInterval(function () { if (n < 12) label(); navFill(); applyAllInner(); report(); if (++n > 25) { clearInterval(iv); setInterval(report, 2000); } }, 350);
  if (INNER.length || NAV) try { new MutationObserver(function () { clearTimeout(iv.t); iv.t = setTimeout(function () { navFill(); applyAllInner(); }, 60); }).observe(document.documentElement, { subtree: true, childList: true }); } catch (e) {}
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
  var BAR_H = 600;   // a navigation bar's frame: tall enough to measure it; the tile shows just the bar
  function fit(k) {
    if (k.bar) { var bw = k.tile.clientWidth; if (!bw) return; k.vw = Math.round(bw / k.s); k.vh = BAR_H; k.f.style.width = k.vw + 'px'; k.f.style.height = BAR_H + 'px'; k.f.style.transform = 'scale(' + k.s + ')'; return; }
    var tw = k.tile.clientWidth, th = k.tile.clientHeight; if (!tw || !th) return;
    k.vw = Math.round(tw / k.s); k.vh = Math.round(th / k.s);
    k.f.style.width = k.vw + 'px'; k.f.style.height = k.vh + 'px'; k.f.style.transform = 'scale(' + k.s + ')';
  }
  function setSize(tile, size, rows) {
    var cr = SIZES[size] || SIZES.big;
    tile.className = tile.className.replace(/\brk-[cr]\d\b/g, '').trim() + ' rk-c' + cr[0] + ' rk-r' + (rows || cr[1]);
    tile.style.setProperty('--rkc', cr[0]);   // its width in columns, for a centred tile that spans the row
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
    if (k.bar) {   // in the navigation's place: as tall as the bar, centred, smaller only if it's wider than the page
      if (!d.box) return;
      var bw = k.tile.clientWidth;
      if (k.adj < 3 && d.box.w * k.s > bw + 2) { k.adj++; k.s = Math.max(0.3, k.s * bw / (d.box.w * k.s)); fit(k); return; }
      var wide = d.box.w * k.s >= bw * 0.9, pad = wide ? 0 : 14;   // room for its shadow
      k.tile.style.height = Math.round(d.box.h * k.s + 2 * pad) + 'px';
      k.f.style.left = (wide ? Math.round(-d.box.x * k.s) : Math.round((bw - d.box.w * k.s) / 2 - d.box.x * k.s)) + 'px';
      k.f.style.top = Math.round(pad - d.box.y * k.s) + 'px';
      k.tile.style.background = wide && d.bg ? d.bg : 'transparent';
      return;
    }
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
  // ---- beside another component (a search bar next to your navbar): the two share one row. The row takes the
  //      first one's place, height and stickiness; each new one sits on the side it was dropped.
  function besideTile(e) {
    var anchor = document.querySelector('[data-rk-edit="' + e.besideOf + '"]');
    if (!anchor || !e.doc) return;
    var pair = anchor.parentElement && anchor.parentElement.classList.contains('rk-pair') ? anchor.parentElement : null;
    if (!pair) {
      pair = document.createElement('div'); pair.className = 'rk-pair' + (anchor.classList.contains('rk-navbar') ? ' rk-pair-bar' : '');
      anchor.parentNode.insertBefore(pair, anchor); pair.appendChild(anchor);
      if (anchor.style.position === 'sticky') { pair.style.position = 'sticky'; pair.style.top = '0'; anchor.style.position = ''; }
    }
    var h = Math.round(anchor.getBoundingClientRect().height) || parseInt(anchor.style.height, 10) || 64;
    var tile = document.createElement('div');
    tile.className = 'rk-e rk-tile rk-beside' + (anchor.classList.contains('rk-navbar') ? ' rk-navbar' : ''); tile.setAttribute('data-rk-edit', e.id);
    tile.style.cssText = 'height:' + Math.max(48, h) + 'px;flex:0 1 ' + (e.width || 340) + 'px;min-width:160px';
    pair.insertBefore(tile, e.side === 'left' ? anchor : anchor.nextSibling);
    tileFrame(e.id, e.doc, tile, false).bar = true;
  }
  EDITS.forEach(function (e) {
    if (e.mode === 'beside') { besideTile(e); return; }
    var el = e._el; if (!el) return;
    if (e.mode === 'text') { setText(el, e.text || ''); return; }
    if (e.mode === 'style') { Object.keys(e.style || {}).forEach(function (k) { if (e.style[k] !== '' && e.style[k] != null) el.style.setProperty(k, e.style[k], 'important'); }); return; }
    if (e.mode === 'hide') {
      if (MODE === 'edit') { el.style.opacity = '.28'; el.style.outline = '2px dashed #9a948b'; el.title = 'Hidden on your site — right-click to show it again'; }
      else el.style.display = 'none';
      return;
    }
    if (e.doc && e.inline) {
      var w = cropFrame(e, el), row = el.parentNode;
      // a tall component in a row of buttons shouldn't stretch its neighbours
      if (row && row.nodeType === 1 && /flex|grid/.test(getComputedStyle(row).display)) row.style.alignItems = 'center';
      if (e.mode === 'replace') { el.parentNode.insertBefore(w, el); el.style.display = 'none'; }
      else el.parentNode.insertBefore(w, el.nextSibling);
    } else if (e.doc) {
      var L = e.layout || { flow: true, size: 'auto' };
      var tile = document.createElement('div');
      tile.className = 'rk-e rk-tile' + (L.center ? ' rk-center' : '') + (L.bar ? ' rk-navbar' : ''); tile.setAttribute('data-rk-edit', e.id);
      if (L.bar) {
        // the site's navigation, replaced: the bar takes its place (and stays at the top if the old one did)
        var nr = el.getBoundingClientRect(), pos = getComputedStyle(el).position;
        var side = el.matches('aside.side') && el.parentElement.classList.contains('shell');   // a sidebar layout: the bar goes on top
        tile.style.cssText = 'width:100%;height:' + Math.max(48, Math.round(side ? 64 : nr.height)) + 'px' + (side || pos === 'sticky' || pos === 'fixed' ? ';position:sticky;top:0' : '');
        if (side) { el.parentElement.style.gridTemplateColumns = 'minmax(0,1fr)'; el.parentElement.parentNode.insertBefore(tile, el.parentElement); }
        else el.parentNode.insertBefore(tile, el);
        el.style.display = 'none';
        tileFrame(e.id, e.doc, tile, false).bar = true;
        return;
      }
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
    if (d.rkGo && MODE !== 'edit' && MODE !== 'show') {
      if (d.rkGo.charAt(0) === '#') { var to = d.rkGo.length > 1 && document.getElementById(d.rkGo.slice(1)); if (to) goTo(to); }
      else if (d.newTab || MODE === 'try') window.open(d.rkGo, '_blank', 'noopener'); else location.href = d.rkGo;
    }
    if (d.rkElTip && MODE === 'edit' && F[d.rkElTip]) {   // words inside a component: the same hint as the page's own words
      var tt = document.querySelector('.rk-tag'); if (!tt) return;
      if (!d.on) { tt.style.display = 'none'; return; }
      var fr = F[d.rkElTip].f.getBoundingClientRect(), fs = fr.width / (F[d.rkElTip].f.offsetWidth || fr.width), tx = fr.left + d.x * fs, ty = fr.top + d.y * fs;
      tt.textContent = 'Double-click to edit the words'; tt.style.display = 'block';
      tt.style.left = Math.min(tx + 14, innerWidth - tt.offsetWidth - 8) + 'px'; tt.style.top = Math.max(ty - 30, 6) + 'px';
    }
    if (d.rkElCtx || d.rkElWords || d.rkElWordsEnd) {
      var id = d.rkElCtx || d.rkElWords || d.rkElWordsEnd, k = F[id]; if (!k) return;
      if (d.rkElWords) return parent.postMessage({ rkInnerWords: { editId: id, item: d.item } }, '*');
      if (d.rkElWordsEnd) { (k.tile || k.wrap).classList.remove('rk-wording'); return; }
      var r = k.f.getBoundingClientRect(), sc = r.width / (k.f.offsetWidth || r.width);
      parent.postMessage({ rkCtx: { addr: null, info: null, editId: id, part: d.part || null }, x: r.left + d.x * sc, y: r.top + d.y * sc }, '*');
    }
    if (d.rkWordsIn) {   // "Change its words": that component's words become clickable; everything else stays put
      Object.keys(F).forEach(function (id) { var k = F[id], on = id === d.rkWordsIn; if (k.f.contentWindow) k.f.contentWindow.postMessage({ rkWords: on }, '*'); (k.tile || k.wrap).classList.toggle('rk-wording', on); });
      var w = document.querySelector('[data-rk-edit="' + d.rkWordsIn + '"]'); if (w) goTo(w, 'center');
    }
    if (d.rkWordsOff) Object.keys(F).forEach(function (id) { var k = F[id]; if (k.f.contentWindow) k.f.contentWindow.postMessage({ rkWords: false }, '*'); (k.tile || k.wrap).classList.remove('rk-wording'); });
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
    '.rk-wording{outline:3px solid #2f6bff!important;outline-offset:4px}' +
    '.rk-tile.rk-navbar{min-height:0;border-radius:0;z-index:40}' +
    '.rk-pair{display:flex;align-items:stretch;gap:12px;width:100%;position:relative}.rk-pair-bar{z-index:40;gap:0}' +
    '.rk-pair>.rk-e:not(.rk-beside){flex:1 1 auto;width:auto!important;min-width:0}.rk-pair>.rk-beside{min-height:0}' +
    '@media (max-width:700px){.rk-pair{flex-wrap:wrap}.rk-pair>.rk-e{flex:1 1 100%!important}}' +
    '.rk-empty{position:absolute;inset:10px;display:grid;place-items:center;text-align:center;padding:14px;border:2px dashed #c9c2b8;border-radius:12px;background:rgba(250,248,245,.94);color:#57524b;font:500 13px/1.45 Inter,system-ui,sans-serif}' +
    '.rk-bento>.rk-c1{grid-column:span 1}.rk-bento>.rk-c2{grid-column:span 2}.rk-bento>.rk-c4{grid-column:1/-1}' +
    '.rk-bento>.rk-tile.rk-center{grid-column:1/-1;justify-self:center;width:calc(var(--rkc,2) * (100% - 60px) / 4 + (var(--rkc,2) - 1) * 20px)}' +
    '.rk-bento>.rk-r1{grid-row:span 1}.rk-bento>.rk-r2{grid-row:span 2}.rk-bento>.rk-r3{grid-row:span 3}.rk-bento>.rk-r4{grid-row:span 4}' +
    '@media (max-width:900px){.rk-bento{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
    '@media (max-width:900px){.rk-bento>.rk-tile.rk-center{width:calc(min(var(--rkc,2),2) * (100% - 20px) / 2 + (min(var(--rkc,2),2) - 1) * 20px)}}' +
    '@media (max-width:560px){.rk-bento{grid-template-columns:1fr!important}.rk-bento>.rk-c2{grid-column:1/-1}.rk-bento>.rk-tile.rk-center{width:100%}}' +
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
  setTimeout(function () { parent.postMessage({ rkReady: true }, '*'); }, 0);
  function plain(t) { return t ? { addr: t.addr || null, info: t.info || null, editId: t.editId || null } : null; }
  function blocksOnPage() { return Array.prototype.filter.call(document.querySelectorAll('.rk-block'), function (b) { return b.offsetHeight > 0; }); }
  var clicky = function (k) { return k === 'button' || k === 'link'; };
  var NAVISH = false;   // the app says whether what's being carried is a navigation bar
  function intentAt(x, y, node) {
    var bs = blocksOnPage(), EDGE = 30;
    for (var i = 0; i < bs.length; i++) {
      var r = bs[i].getBoundingClientRect();
      if (y < r.top - 2 || y > r.bottom + 2) continue;
      if (y - r.top < EDGE && i > 0) return { kind: 'gap', scope: bs[i - 1].getAttribute('data-block'), y: r.top, x0: r.left, x1: r.right };
      if (r.bottom - y < EDGE) return { kind: 'gap', scope: bs[i].getAttribute('data-block'), y: r.bottom, x0: r.left, x1: r.right };
      break;
    }
    var t = targetOf(node);
    if (t && t.editId) {
      // a component already on your page: its left or right edge puts the new one beside it, the middle swaps it
      var er = t.el.getBoundingClientRect(), zone = Math.min(180, er.width * 0.28);
      if (er.width >= 120 && x < er.left + zone) return { kind: 'beside', side: 'left', editId: t.editId, el: t.el, label: '⇤ Beside it, on the left' };
      if (er.width >= 120 && x > er.right - zone) return { kind: 'beside', side: 'right', editId: t.editId, el: t.el, label: 'Beside it, on the right ⇥' };
      return { kind: 'swap', editId: t.editId, el: t.el, label: 'Swap this component' };
    }
    // the site's navigation: a navigation component takes its place (with the site's links); anything else dropped on
    // one of its links replaces just that link, and on the bar itself replaces the bar
    var nav = node && node.closest && node.closest('header.nav,aside.side');
    if (nav && (NAVISH || !t || !clicky(t.addr.kind))) return { kind: 'nav', el: nav, label: 'Replace your navigation — keeps your links' };
    if (!t) return null;
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
    if (it.kind === 'beside') {   // a bar on the edge where it'll go
      var bx = it.side === 'left' ? r.left - 4 : r.right - 4;
      ol.style.display = 'block'; ol.style.left = bx + 'px'; ol.style.top = (r.top + 2) + 'px'; ol.style.width = '8px'; ol.style.height = Math.max(24, r.height - 4) + 'px';
      pill.textContent = it.label; pill.style.display = 'block'; pill.style.left = Math.max(90, Math.min(innerWidth - 90, bx + (it.side === 'left' ? 90 : -90))) + 'px'; pill.style.top = Math.min(innerHeight - 20, r.bottom + 18) + 'px';
      return;
    }
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
    var send = { kind: it.kind, addr: it.addr || null, info: it.info || null, editId: it.editId || null, scope: it.scope || null, side: it.side || null };
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
    var tile = bx.editId && bx.el.classList.contains('rk-tile') && !bx.el.classList.contains('rk-navbar');
    bar.innerHTML = (tile ? '<button data-a="size" title="Change its size">⤢ Size</button>' : '') + (bx.editId && !bx.el.classList.contains('rk-navbar') ? '<button data-a="place" title="Centre it, or make it its own section">⊞ Place</button>' : '') + '<button data-a="swap" title="Drag another component onto it, or pick one">⇄ Swap</button><button data-a="remove" title="Take it off the page">✕ Remove</button>';
    var r = bx.el.getBoundingClientRect();
    bar.style.display = 'flex'; bar.style.left = Math.max(6, Math.min(r.right - bar.offsetWidth - 6, innerWidth - bar.offsetWidth - 6)) + 'px'; bar.style.top = Math.max(6, r.top + 8) + 'px';
  }
  document.addEventListener('mouseover', function (ev) {
    if (document.body.classList.contains('rk-dragging') || document.querySelector('.rk-wording')) return;
    if (bar.contains(ev.target)) { clearTimeout(barT); return; }
    var bx = boxOf(ev.target);
    if (bx) { clearTimeout(barT); showBar(bx); } else { clearTimeout(barT); barT = setTimeout(hideBar, 350); }
  });
  addEventListener('scroll', function () { if (barFor) { var r = barFor.el.getBoundingClientRect(); bar.style.top = Math.max(6, r.top + 8) + 'px'; } }, { passive: true });
  bar.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || !barFor) return;
    var br = b.getBoundingClientRect();
    parent.postMessage({ rkTool: { action: b.getAttribute('data-a'), editId: barFor.editId || null, blockId: barFor.blockId || null, x: br.left, y: br.bottom + 4 } }, '*');
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
    if ('rkNavish' in d) NAVISH = !!d.rkNavish;
    // carried in from the Library: the app sends where the pointer is; show where it would land, and drop it there
    if ('rkCarry' in d) {
      if (!d.rkCarry) { dragging(false); return; }
      dragging(true); clearTimeout(dragT);
      showDrop(intentAt(d.rkCarry.x, d.rkCarry.y, document.elementFromPoint(d.rkCarry.x, d.rkCarry.y)));
    }
    if (d.rkCarryDrop) {
      var p = d.rkCarryDrop, it = intentAt(p.x, p.y, document.elementFromPoint(p.x, p.y)); dragging(false);
      parent.postMessage({ rkDrop: it ? { kind: it.kind, addr: it.addr || null, info: it.info || null, editId: it.editId || null, scope: it.scope || null, side: it.side || null } : null, carried: true }, '*');
    }
    if (d.rkScrollBy) scrollBy(0, d.rkScrollBy);
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
function elemDoc(c, e, mode, act, edit) {
  const html = compBlockDoc(c, { fill: 'own', recolor: !!e.recolor, props: e.props });
  const css = mode === 'crop'
    ? '<style>html{overflow:hidden!important}html,body{background:transparent!important}</style>'
    : '<style>html{overflow:hidden!important}</style>';
  const links = (e.links || []).map(l => ({ path: l.path, label: l.label }));
  return injectEnd(html, css + `<script>(${__rkElem})(${jsonForScript({ id: e.id, text: e.text || null, mode, act: !!act, links, inner: e.inner || [], nav: e.navFill ? navFillFor(c, e) : null, edit: !!edit })});<\/script>`);
}
/* ---- a navigation bar from the Library standing in for the site's own ----
   Navish by structure only: a <nav> / role=navigation in it, or a setting that is a list of links. */
const LINK_LABEL = /^(label|title|name|text)$/i, LINK_HREF = /^(href|url|link|to|path)$/i;
function typeKeys(code, name) {   // the fields of `interface Name { … }` / `type Name = { … }`
  const m = new RegExp(`(?:interface\\s+${name}\\b[^{]*|type\\s+${name}\\s*=\\s*)\\{`).exec(code); if (!m) return null;
  const open = m.index + m[0].length - 1, close = matchBrace(code, open); if (close < 0) return null;
  const txt = code.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return splitTop(txt.replace(/;/g, ',').replace(/\n/g, ',')).map(p => /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/.exec(p)).filter(Boolean).map(x => ({ name: x[1], opt: !!x[2], type: x[3].trim() }));
}
// the setting that takes a list of links, if it's one Reskin can fill on its own (label + address, plain words)
function linkListProp(c) {
  const P = parseProps(c); if (!P) return null;
  const code = splitBundle(c.code).js, TY = (P.samples && P.samples.types) || {};
  for (const f of P.fields) {
    const arr = /^(?:readonly\s+)?([A-Z]\w*)\[\]$|^Array<([A-Z]\w*)>$/.exec(TY[f.name] || ''); if (!arr) continue;
    const keys = typeKeys(code, arr[1] || arr[2]); if (!keys) continue;
    const lab = keys.find(k => LINK_LABEL.test(k.name)), href = keys.find(k => LINK_HREF.test(k.name)); if (!lab || !href) continue;
    const fillable = keys.every(k => k.opt || k === lab || k === href || /^(string|number|boolean)\b/.test(k.type));
    return { name: f.name, lab: lab.name, href: href.name, keys, fillable };
  }
  return null;
}
function isNavish(c) {
  if (!c) return false;
  if (/<nav\b|role=["'{]*navigation/i.test(c.code)) return true;
  return !!linkListProp(c);
}
// a navigation component's settings, filled from the site: its list of links, and its brand / call to action if it names them
function navPropsFor(c) {
  const m = state.model, out = {}, done = { links: false, brand: false, cta: false };
  const P = parseProps(c); if (!P || !m) return { props: out, done };
  const L = linkListProp(c);
  if (L && L.fillable && m.nav.length) {
    out[L.name] = m.nav.slice(0, 8).map((n, i) => {
      const o = { [L.lab]: n.text, [L.href]: n.href || '#' };
      L.keys.forEach(k => { if (k.opt || k.name in o) return; o[k.name] = /^number/.test(k.type) ? i : /^boolean/.test(k.type) ? i === 0 && /active|current|selected/i.test(k.name) : /^(id|key|value|slug)$/i.test(k.name) ? n.text.toLowerCase().replace(/\W+/g, '-') : n.text; });
      return o;
    });
    done.links = true;
  }
  const TY = (P.samples && P.samples.types) || {};
  P.fields.forEach(f => {
    if (f.type !== 'text' || (TY[f.name] && !/^string\b/.test(TY[f.name]))) return;
    if (m.brand && /^(brand|brandName|logoText|siteName|siteTitle|company|companyName)$/i.test(f.name)) { out[f.name] = m.brand; done.brand = true; }
    if (m.navCta && /^(cta|ctaText|ctaLabel|buttonText|buttonLabel|actionText|actionLabel)$/i.test(f.name)) { out[f.name] = m.navCta.text; done.cta = true; }
    if (m.navCta && /^(ctaHref|ctaUrl|ctaLink|buttonHref|buttonUrl|buttonLink|actionHref|actionUrl)$/i.test(f.name)) out[f.name] = m.navCta.href || '#';
  });
  return { props: out, done };
}
// what the frame fills in itself, for whatever the settings didn't cover
function navFillFor(c, e) {
  const m = state.model; if (!m) return null;
  const d = e.navFill || {};
  return { links: d.links ? [] : m.nav.slice(0, 8), brand: d.brand ? null : m.brand || null, cta: d.cta ? null : m.navCta || null };
}
// called by composeDoc (builder.js); mode: edit (Studio editor) · show (Build tab) · try (previews) · live (downloaded site)
function studioScript(p, mode) {
  const edits = (p.edits || []).map(e => {
    const c = e.compId && compById(e.compId), inline = isClicky(e.target.kind);
    if (c && mode === 'edit') ensureLibs(c, () => { if (state.view === 'studio') renderStudioPreview(); });
    const pc = e.action && e.action.type === 'popup' && compById(e.action.compId);
    return {
      id: e.id, target: e.target, mode: e.mode, inline, action: e.action || null, layout: e.layout || { flow: true, size: 'auto' }, text: e.mode === 'text' ? e.text : undefined, style: e.mode === 'style' ? e.style : undefined,
      besideOf: e.besideOf || null, side: e.side || null, width: e.width || null,
      links: (e.links || []).map((l, i) => { const lc = l.action && l.action.type === 'popup' && compById(l.action.compId); return { action: l.action, popDoc: lc ? elemDoc(lc, { id: 'pop-' + e.id + '-' + i, recolor: e.recolor }, 'fit', false) : null }; }),
      doc: c && e.mode !== 'action' ? elemDoc(c, { ...e, text: inline ? e.text : null }, inline ? 'crop' : 'fit', !!e.action, mode === 'edit') : null,
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
  $('stDl').onclick = async () => {
    // components that run code fetch their packages when the page opens: fix today's versions so it keeps working the same
    const used = [...new Set([...(p.edits || []).map(e => e.compId), ...p.blocks.filter(b => b.kind === 'comp').map(b => b.compId)])].map(compById).filter(c => c && c.kind === 'tsx');
    let note = '';
    if (used.length) {
      toast('Fixing package versions…', 2000);
      const { pins, missed } = await pinPackages(used.map(c => c.code));
      EXPORT_PINS = pins;
      note = ` · its components load React and their packages from the internet when the page opens${missed.length ? ` (couldn’t fix the version of ${missed.join(', ')} — check you’re online)` : ', versions fixed'}`;
    }
    let html; try { html = composeDoc({ preview: false }); } finally { EXPORT_PINS = null; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `${slug(p.name || 'site')}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Downloaded — this file is your whole site, with your changes' + note, note ? 7000 : 3000);
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

/* ---- "Restyle my whole site to match what I add" ----
   One saved choice, shown wherever components get added. When it's on, a component you put on your page also hands
   its look to your whole site: its colours, fonts and button shape become your page's template (the exact match).
   Undo puts your template back. */
const ADOPT = { on: store.get('reskin.adoptStyle', false) };
const adoptBox = id => `<label class="adopt-box" title="When you put a component on your page, your whole site takes its colours, fonts and button shape"><input type="checkbox" id="${id}" ${ADOPT.on ? 'checked' : ''}><span>Restyle my whole site to match what I add</span></label>`;
function wireAdopt(id) {
  const b = $(id); if (!b) return;
  b.onchange = () => {
    ADOPT.on = b.checked; store.set('reskin.adoptStyle', ADOPT.on);
    document.querySelectorAll('.adopt-box input').forEach(x => { x.checked = ADOPT.on; });
    toast(ADOPT.on ? 'Components you add will restyle your whole site' : 'Components you add keep your site’s style', 3000);
  };
}
async function adoptCompStyle(c, from = {}) {
  const p = B.project; if (!p || !c) return;
  const was = { style: p.style, tgt: state.tgt, styles: state.styles, mood: state.mood, varOf: state.varOf };
  toast(`Reading “${c.name}”’s style…`, 2500);
  setTarget({ name: c.name, text: c.code, kind: c.kind, assets: new Map(), tokens: null });
  try { await loadTarget(); } catch (e) {}
  if (!state.tgt || !state.tgt.tokens) { Object.assign(state, { tgt: was.tgt }); if (from.msg) toastUndo(from.msg, from.snap, from.more); toast(`Couldn’t read “${c.name}”’s style — your site keeps its own`, 4500); return; }
  try { await measureSource(); } catch (e) {}
  state.mood = 'target'; state.styles = batch(12, 'target', true); state.varOf = null;
  const st = state.styles.find(s => s.exact && !s.live) || state.styles.find(s => !s.live);
  if (!st) return;
  p.style = st; saveProject();
  if (state.view === 'studio') renderStudio(); else if (typeof wearStyle === 'function') wearStyle(null);
  toastUndo(`${from.msg ? from.msg + ' — and ' : ''}your whole site now wears “${c.name}”’s style`, () => {
    p.style = was.style; Object.assign(state, { tgt: was.tgt, styles: was.styles, mood: was.mood, varOf: was.varOf });
    if (from.snap) restorePage(from.snap); else saveProject();
    if (state.view === 'studio') renderStudio();
  }, from.more);
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
          <input id="stAddIn" placeholder="Paste a link or code (all files at once is fine) — uiverse, 21st.dev, React Bits, MUI…" autocomplete="off">
          <div class="bx-row"><button class="primary" id="stAddGo" type="submit">Add</button><button class="ghost" type="button" id="stAddFile">Upload a file</button></div>
          <p class="st-muted">Or drop a file — or drag a component’s link from another tab — straight onto your page.</p>
          ${adoptBox('stAdopt')}
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
    el.addEventListener('dragstart', e => { S.drag = c.id; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'reskin-component:' + c.id); el.classList.add('drag'); $('stFrame').classList.add('dropping'); stPost({ rkNavish: isNavish(c) }); stPost({ rkDragging: true }); });
    el.addEventListener('dragend', () => { el.classList.remove('drag'); const fr = $('stFrame'); if (fr) fr.classList.remove('dropping'); stPost({ rkDragging: false }); setTimeout(() => { S.drag = null; stPost({ rkNavish: false }); }, 400); });
    el.onclick = () => {
      if (S.swapFor) { const w = S.swapFor; S.swapFor = null; return placeComp(c.id, w.editId ? { kind: 'swap', editId: w.editId } : { kind: 'swapblock', scope: w.blockId }); }
      toast('Drag it onto your page');
    };
    rail.appendChild(el);
  });
  S.flash = null;
  if ($('stSwapX')) $('stSwapX').onclick = () => { S.swapFor = null; renderEditorWs(); };
  const addPasted = async v => {
    const id = await importDropped([], v);
    if (id) { $('stAddIn').value = ''; S.flash = id; renderEditorWs(); toast(`Added “${compById(id).name}” — drag it onto your page`, 3500); }
  };
  $('stAdd').onsubmit = async e => { e.preventDefault(); const v = $('stAddIn').value.trim(); if (v) addPasted(v); };
  wireAdopt('stAdopt');
  // a one-line field would squash pasted code (one file or "Copy all files") into a single line: take it whole, add it now
  $('stAddIn').onpaste = e => {
    const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!/\n/.test(t.trim())) return;
    e.preventDefault(); toast('Adding the pasted code…', 2000); addPasted(t);
  };
  $('stAddFile').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.html,.htm,.tsx,.jsx,image/*'; i.onchange = async () => { const id = await importDropped([...i.files], ''); if (id) { S.flash = id; renderEditorWs(); toast('Added — drag it onto your page'); } }; i.click(); };
  wireStToolbar();
  renderStudioPreview();
}

/* ---- placing: what you drop lands where the page showed it would, with sensible defaults; Undo is one click ---- */
const snapshotPage = () => JSON.stringify({ edits: B.project.edits || [], blocks: B.project.blocks, btnCss: B.project.btnCss || '', btnFrom: B.project.btnFrom || null });
function restorePage(snap) { const o = JSON.parse(snap); Object.assign(B.project, o); saveProject(); renderEditorWs(); }
function toastUndo(msg, snap, more) {
  let t = $('undoToast'); if (!t) { t = document.createElement('div'); t.id = 'undoToast'; t.className = 'undo-toast'; document.body.appendChild(t); }
  more = (more || []).filter(x => x && x.run);
  t.innerHTML = `<span>${esc(msg)}</span>${more.map((x, i) => `<button type="button" class="ut-more" data-i="${i}">${esc(x.short || x.label)}</button>`).join('')}<button type="button" class="ut-undo">Undo</button>`;
  t.classList.add('show'); clearTimeout(toastUndo.t); toastUndo.t = setTimeout(() => t.classList.remove('show'), more.length ? 10000 : 6500);
  t.querySelector('.ut-undo').onclick = () => { t.classList.remove('show'); typeof snap === 'function' ? snap() : restorePage(snap); toast('Undone'); };
  t.querySelectorAll('.ut-more').forEach(b => b.onclick = () => { t.classList.remove('show'); more[+b.dataset.i].run(); });
}
// Remove a component from the Library. If it's on your page, say so first; it comes off the page too
// (a component it replaced gives your own section back). Undo puts both back.
function removeComp(id) {
  const at = comps.list.findIndex(x => x.id === id); if (at < 0) return;
  const c = comps.list[at], p = typeof B !== 'undefined' && B.project;
  const usesIt = e => e.compId === id || (e.action && e.action.compId === id);
  const edits = p ? (p.edits || []).filter(usesIt) : [], blocks = p ? (p.blocks || []).filter(b => b.kind === 'comp' && b.compId === id) : [];
  const n = edits.length + blocks.length;
  if (n && !confirm(`“${c.name}” is on your page${n > 1 ? ` ${n} times` : ''}. Remove it from your Library and from your page?`)) return;
  const pageSnap = p ? snapshotPage() : null;
  comps.list.splice(at, 1);
  if (p && n) {
    p.edits = (p.edits || []).filter(e => !usesIt(e));
    let orphan; while ((orphan = p.edits.find(e => e.besideOf && !p.edits.some(x => x.id === e.besideOf)))) p.edits = withoutEdit(p.edits, orphan.id);   // what sat beside it goes too
    blocks.forEach(b => { const i = p.blocks.indexOf(b); if (i >= 0) p.blocks.splice(i, 1, ...(b.replaces ? siteBlocks(state.model).filter(x => x.ref === b.replaces) : [])); });
    saveProject();
  }
  comps.save();
  if (typeof INS !== 'undefined' && INS.compId === id) Object.assign(INS, { compId: null, map: null, pick: null, sel: null });
  const redraw = () => { if (LIB.detail && !compById(LIB.detail)) LIB.detail = null; if (state.view === 'library') renderLibrary(); else renderComps(); if (n && typeof renderEditorWs === 'function') try { renderEditorWs(); } catch (e) {} };
  redraw();
  toastUndo(`Removed “${c.name}”${n ? ' from your Library and your page' : ' from your Library'}`, () => {
    comps.list.splice(Math.min(at, comps.list.length), 0, c); comps.save();
    if (pageSnap) restorePage(pageSnap);
    redraw();
  });
}
// an edit gone, and whatever sat beside it (a search bar next to a navbar you removed)
function withoutEdit(list, id) {
  const gone = new Set([id]); let grew = true;
  while (grew) { grew = false; list.forEach(e => { if (e.besideOf && gone.has(e.besideOf) && !gone.has(e.id)) { gone.add(e.id); grew = true; } }); }
  return list.filter(e => !gone.has(e.id));
}
function placeComp(compId, it) {
  const c = compById(compId); if (!c || !it) return;
  ensureLibs(c, () => { if (state.view === 'studio') renderStudioPreview(); });
  const snap = snapshotPage(), edits = projectEdits(), recolor = !!(brandColor() && c.tokens && (c.tokens.accent || c.tokens.btnBg));
  let msg = '';
  if (it.kind === 'swap') {
    const e = editById(it.editId); if (!e) return;
    e.compId = c.id; delete e.inner; delete e.props; delete e.links; msg = `Swapped in “${c.name}”`;
    if (e.layout && e.layout.bar) { const np = navPropsFor(c); e.navFill = np.done; if (Object.keys(np.props).length) e.props = np.props; }
  } else if (it.kind === 'beside') {
    // next to a component already on your page (a search bar beside your navbar): they share one row
    const a = editById(it.editId); if (!a) return;
    const an = (compById(a.compId) || {}).name || 'it';
    edits.push({ id: newEditId(), target: a.target, targetLabel: `beside “${an}”`, mode: 'beside', besideOf: a.id, side: it.side === 'left' ? 'left' : 'right', compId: c.id, recolor, layout: { bar: !!(a.layout && a.layout.bar) } });
    msg = `“${c.name}” sits ${it.side === 'left' ? 'left of' : 'beside'} “${an}”`;
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
  } else if (it.kind === 'nav') {
    // your navigation, replaced: the bar shows your links, brand and call to action; Undo or Remove gives yours back
    const np = navPropsFor(c);
    edits.push({ id: newEditId(), target: { scope: 'nav', kind: 'section', idx: 0 }, targetLabel: 'your navigation', mode: 'replace', compId: c.id, recolor,
      layout: { bar: true }, navFill: np.done, ...(Object.keys(np.props).length ? { props: np.props } : {}) });
    msg = `“${c.name}” is your navigation now — with your links`;
  } else return;
  saveProject(); renderEditorWs();
  // right after a drop: where it should sit, without hunting for a menu
  const placed = it.kind === 'swap' || it.kind === 'swapblock' || it.kind === 'nav' || it.kind === 'beside' ? null : edits[edits.length - 1];
  const more = placed ? placeItems(placed).map(x => ({ ...x, short: /^Center/.test(x.label) ? 'Center' : /section/.test(x.label) ? 'Own section' : x.label })) : [];
  // "restyle my whole site to match what I add": the drop and the restyle are one step, undone together
  if (ADOPT.on) adoptCompStyle(c, { snap, more, msg }); else toastUndo(msg, snap, more);
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
      else if (/[<{]|^\s*(import|export|const|function|\/\/)/.test(text)) { text = mergePastedFiles(text); const kind = detectKind(text); items.push({ name: guessCompName(text, kind), source: 'pasted', kind, code: text }); }
    }
    if (!items.length) { if (text || (files && files.length)) toast('That isn’t a component Reskin can use — try a link, code, an .html/.tsx file or a picture', 4500); return null; }
    await readyComps(items);
    items.forEach(c => comps.list.unshift({ id: newId(), collection: 'My kit', created: Date.now(), ...c }));
    comps.save();
    return comps.list[0].id;
  } catch (e) { toast(e.message || 'Couldn’t add that', 4500); return null; }
}

function stPost(msg) { const f = $('stFrame') && $('stFrame').querySelector('iframe'); if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*'); }
/* ---- carry a component from the Library to your page: press and hold a card, it comes with you to Studio ----
   The stage is a sandboxed frame, so while carrying it ignores the pointer and the app tells it where the pointer
   is; the page shows the same live preview as a drag from the rail. */
const CARRY = { id: null, ghost: null, hint: null, scroll: 0, iv: 0, at: null, ready: false, drop: null };
function stageRect() { const f = $('stFrame') && $('stFrame').querySelector('iframe'); return f ? f.getBoundingClientRect() : null; }
function startCarry(c, x, y) {
  if (CARRY.id) endCarry();
  CARRY.id = c.id; S.drag = c.id;
  const g = CARRY.ghost = document.createElement('div'); g.className = 'carry-ghost';
  g.innerHTML = `<b>${esc(c.name)}</b><span>Drop it on your page</span>`;
  document.body.appendChild(g); moveGhost(x, y);
  document.body.classList.add('carrying');
  CARRY.ready = state.view === 'studio' && !!stageRect();
  if (state.view !== 'studio') setView('studio');
  let seen = false; try { seen = !!localStorage.getItem('reskin.carryTip'); localStorage.setItem('reskin.carryTip', '1'); } catch {}
  if (seen) return carryListen();
  const h = CARRY.hint = document.createElement('div'); h.className = 'carry-hint';
  h.innerHTML = 'On a button: <b>replaces it</b> · on a card or heading: <b>sits beside it</b> · between sections: <b>a full-width row</b> · <kbd>Esc</kbd> to cancel';
  document.body.appendChild(h); setTimeout(() => h.classList.add('fade'), 6000);
  carryListen();
}
function carryListen() {
  stPost({ rkNavish: isNavish(compById(CARRY.id)) });
  addEventListener('blur', carryCancel); addEventListener('pointercancel', carryCancel, true);
  addEventListener('pointermove', carryMove, true); addEventListener('pointerup', carryUp, true);
  addEventListener('wheel', carryWheel, { capture: true, passive: false }); addEventListener('keydown', carryKey, true);
  CARRY.iv = setInterval(() => { if (CARRY.scroll) stPost({ rkScrollBy: CARRY.scroll }); }, 16);
}
function moveGhost(x, y) { if (CARRY.ghost) CARRY.ghost.style.transform = `translate(${x + 14}px,${y + 14}px)`; }
function carryMove(e) {
  moveGhost(e.clientX, e.clientY);
  const r = stageRect(), on = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  CARRY.at = on ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
  if (CARRY.ghost) CARRY.ghost.classList.toggle('over', !!on);
  stPost({ rkCarry: CARRY.at });
  // near the top or bottom of the stage, the page scrolls by itself
  const EDGE = 70; CARRY.scroll = on ? (CARRY.at.y < EDGE ? -Math.ceil((EDGE - CARRY.at.y) / 5) : CARRY.at.y > r.height - EDGE ? Math.ceil((CARRY.at.y - (r.height - EDGE)) / 5) : 0) : 0;
}
function carryWheel(e) { if (!CARRY.at) return; e.preventDefault(); stPost({ rkScrollBy: e.deltaY }); setTimeout(() => stPost({ rkCarry: CARRY.at }), 30); }
function carryCancel() { if (!CARRY.id) return; stPost({ rkCarry: null }); endCarry(); toast('Put back'); }
function carryKey(e) { if (e.key === 'Escape') { e.preventDefault(); carryCancel(); } }
function carryUp() {
  if (!CARRY.id) return;
  if (CARRY.at) {
    CARRY.scroll = 0; clearInterval(CARRY.iv); CARRY.drop = CARRY.at;
    if (CARRY.ghost) CARRY.ghost.classList.add('landing');
    if (CARRY.ready) stPost({ rkCarryDrop: CARRY.drop });   // otherwise it's sent the moment the page is ready
    setTimeout(() => { if (CARRY.id) { endCarry(); toast('Your page didn’t load in time — try again'); } }, 8000);
    return;
  }
  stPost({ rkCarry: null }); endCarry(); toast('Not placed — let go over your page to put it there');
}
function endCarry() {
  removeEventListener('pointermove', carryMove, true); removeEventListener('pointerup', carryUp, true);
  removeEventListener('wheel', carryWheel, true); removeEventListener('keydown', carryKey, true);
  removeEventListener('blur', carryCancel); removeEventListener('pointercancel', carryCancel, true);
  clearInterval(CARRY.iv); CARRY.scroll = 0;
  if (CARRY.ghost) CARRY.ghost.remove(); if (CARRY.hint) CARRY.hint.remove();
  document.body.classList.remove('carrying'); stPost({ rkNavish: false });
  CARRY.id =CARRY.ghost = CARRY.hint = CARRY.at = CARRY.drop = null; CARRY.ready = false;
}
// press and hold (or press and move) on a card to pick it up; a plain click still opens it
function makeCarryable(el, c, onClick) {
  let t = 0, sx = 0, sy = 0, picked = false, down = false;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button,a,input,select,textarea,label')) return;
    down = true; picked = false; sx = e.clientX; sy = e.clientY;
    clearTimeout(t); t = setTimeout(() => { if (down) { picked = true; startCarry(c, sx, sy); } }, 280);
  });
  el.addEventListener('pointermove', e => {
    if (!down || picked || e.pointerType === 'touch') return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { clearTimeout(t); picked = true; startCarry(c, e.clientX, e.clientY); }
  });
  const stop = () => { down = false; clearTimeout(t); };
  el.addEventListener('pointerup', e => { const wasPicked = picked, was = down; stop(); if (was && !wasPicked && onClick && (!el.querySelector('.cthumb') || e.target.closest('.cthumb'))) onClick(); });
  el.addEventListener('pointercancel', stop);
  el.addEventListener('dragstart', e => e.preventDefault());   // no native image drag on the thumbnail
}

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
  if (d.rkReady && S.reveal) { stPost({ rkHi: { editId: S.reveal }, scroll: true }); S.reveal = null; }
  if (d.rkReady) {   // a fresh stage (after a tab switch or a re-render): pick up where the carry is
    if (CARRY.id) { CARRY.ready = true; stPost({ rkNavish: isNavish(compById(CARRY.id)) }); if (CARRY.drop) stPost({ rkCarryDrop: CARRY.drop }); else if (CARRY.at) stPost({ rkCarry: CARRY.at }); }
    return;
  }
  if ('rkDrop' in d) {
    const it = d.rkDrop; let compId = S.drag; S.drag = null;
    if (d.carried) { endCarry(); if (!it) { toast('Drop it on a button, next to something, or between two sections'); return; } }
    (async () => { if (!compId) compId = await importDropped(d.files, d.text); if (compId) placeComp(compId, it); })();
    return;
  }
  if (d.rkTool) {
    const t = d.rkTool, snap = snapshotPage();
    if (t.action === 'remove') {
      if (t.editId) { const e = editById(t.editId); B.project.edits = withoutEdit(projectEdits(), t.editId); saveProject(); renderEditorWs(); toastUndo(`Removed “${(compById(e && e.compId) || {}).name || 'it'}”`, snap); }
      else if (t.blockId) { removeBlock(t.blockId); toastUndo('Removed it', snap); }
    }
    if (t.action === 'swap') { S.swapFor = { editId: t.editId, blockId: t.blockId }; renderEditorWs(); toast('Pick the component to swap in — or drag one onto it'); }
    if (t.action === 'place' && t.editId) {
      const items = placeItems(editById(t.editId)), fr = $('stFrame').querySelector('iframe').getBoundingClientRect();
      if (items.length) { CTX_AT.x = fr.left + (t.x || 0); CTX_AT.y = fr.top + (t.y || 0); openCtx(CTX_AT.x, CTX_AT.y, items); }
      else toast('It sits in a button’s place — swap it, or drag it somewhere else');
    }
    if (t.action === 'size' && t.editId) {
      const e = editById(t.editId), order = ['auto', 's', 'wide', 'big', 'band', 'full'];
      const L = e.layout || (e.layout = { flow: true, size: 'auto' }), next = order[(order.indexOf(L.size) + 1) % order.length];
      L.size = next; L.flow = true; saveProject(); renderStudioPreview(); toast('Size: ' + sizeName(next));
    }
    return;
  }
  if (d.rkInnerWords) {
    const e = editById(d.rkInnerWords.editId), it = d.rkInnerWords.item; if (!e || !it) return;
    const snap = snapshotPage(), c = compById(e.compId), how = innerWords(e, c, it);
    saveProject(); if (how !== 'inner') { S.reveal = e.id; renderStudioPreview(); }   // shown again with the new setting, where you were
    toastUndo(`Changed to “${it.text.slice(0, 40)}”`, snap); return;
  }
  if (d.rkText) { saveTextEdit(d.rkText.addr, d.rkText.text, d.rkText.was); return; }
  if (d.rkCtx) {
    const fr = $('stFrame').querySelector('iframe').getBoundingClientRect();
    CTX_AT.x = fr.left + d.x; CTX_AT.y = fr.top + d.y;
    const items = ctxItems(d.rkCtx); if (items.length) openCtx(CTX_AT.x, CTX_AT.y, items);
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

// words typed inside a placed component go where they'll last: the button's own words; else the one setting that
// held exactly those words (a title, a link in its list); else this placement's override for that spot
function innerWords(e, c, it) {
  if (isClicky(e.target.kind) && it.was && it.was === (e.text || '').trim()) { e.text = it.text; return 'text'; }
  const P = c && c.kind === 'tsx' && it.was ? parseProps(c) : null;
  if (P) {
    // what it shows with: its own defaults, then what's set (by its demo, the Library, this placement)
    const M = mountFor(c, e.props), all = {}, hits = [];
    P.fields.forEach(f => { if (f.def !== undefined) all[f.name] = f.def; });
    Object.assign(all, M ? M.props : {});
    const walk = (v, path) => { if (typeof v === 'string') { if (v.replace(/\s+/g, ' ').trim() === it.was) hits.push(path); } else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], path.concat(k))); };
    Object.keys(all).forEach(k => walk(all[k], [k]));
    if (hits.length === 1) {
      const top = hits[0][0], props = { ...(e.props || {}) };
      props[top] = hits[0].length === 1 ? it.text : JSON.parse(JSON.stringify(all[top]));
      if (hits[0].length > 1) { let o = props[top]; hits[0].slice(1, -1).forEach(k => { o = o[k]; }); o[hits[0][hits[0].length - 1]] = it.text; }
      // only if it will really be shown with that setting (not left to its own demo)
      if (mountFor(c, props)) { e.props = props; return 'props'; }
    }
  }
  const inner = e.inner || (e.inner = []), ex = inner.find(x => x.path === it.path);
  if (ex) ex.text = it.text; else inner.push({ path: it.path, label: it.label, text: it.text });
  return 'inner';
}

/* ---- right-click menu ---- */
function saveTextEdit(addr, text, was) {
  const edits = projectEdits(), ex = edits.find(e => e.mode === 'text' && sameAddr(e.target, addr));
  if (ex) ex.text = text; else edits.push({ id: newEditId(), target: addr, targetLabel: was || '', mode: 'text', text });
  saveProject(); toast(`Text changed to “${text.slice(0, 40)}”`);
}
// Esc in the app (focus may be outside the stage) also ends "change its words"
function wordsEscape() {
  addEventListener('keydown', function off(ev) { if (ev.key !== 'Escape') return; removeEventListener('keydown', off, true); stPost({ rkWordsOff: true }); }, true);
}
const CTX_AT = { x: 0, y: 0 };
// where a component's button can go: your page's sections, your site's own links, or any address
function linkTargets(e, part) {
  const links = e.links || (e.links = []), at = links.findIndex(l => l.path === part.path), cur = at >= 0 ? links[at] : null;
  const set = (action, what) => {
    const l = { path: part.path, label: part.label, action };
    if (at >= 0) links[at] = l; else links.push(l);
    saveProject(); renderStudioPreview(); toast(`“${part.label}” now goes to ${what}`);
  };
  const same = a => cur && JSON.stringify(cur.action) === JSON.stringify(a), mark = a => same(a) ? '✓' : '';
  const items = [];
  B.project.blocks.filter(b => !b.hidden).forEach(b => { const a = { type: 'section', block: b.id }; items.push({ label: b.label, icon: mark(a) || '↓', hint: 'section', run: () => set(a, `“${b.label}”`) }); });
  const m = state.model, ext = [...(m.navCta ? [m.navCta] : []), ...(m.nav || []), ...(m.footerLinks || [])].filter((l, i, arr) => l && l.href && !/^#/.test(l.href) && arr.findIndex(x => x.href === l.href) === i).slice(0, 8);
  if (ext.length) items.push('-');
  ext.forEach(l => { const a = { type: 'link', href: l.href }; items.push({ label: l.text || l.href, icon: mark(a) || '↗', hint: 'your site', run: () => set(a, `“${l.text || l.href}”`) }); });
  items.push('-');
  items.push({ label: 'A web address…', icon: '🔗', run: () => {
    const v = prompt('Where should it go? (a web address)', cur && cur.action.type === 'link' ? cur.action.href : 'https://');
    if (!v || !v.trim() || v.trim() === 'https://') return;
    const href = /^(https?:|mailto:|tel:|#|\/)/i.test(v.trim()) ? v.trim() : 'https://' + v.trim();
    set({ type: 'link', href, newTab: !/^(#|\/)/.test(href) }, href);
  } });
  if (cur) items.push({ label: 'No link — just what it does', icon: '✕', run: () => { links.splice(at, 1); saveProject(); renderStudioPreview(); toast(`“${part.label}” isn’t linked any more`); } });
  return items;
}
// Where a placed component sits: centred in its row, or a full-width section of its own. One list, shown after a drop,
// in the hover toolbar's Place button and in the right-click menu.
function placeItems(e) {
  if (!e || !compById(e.compId) || (e.layout && e.layout.bar)) return [];   // a navigation bar sits where your navigation was
  const L = e.layout || { flow: true, size: 'auto' }, own = !!L.row && e.target.kind === 'section', out = [];
  // in a button's place it already sits where the button was: nothing to centre
  if (!isClicky(e.target.kind)) out.push({ label: L.center ? 'Back to the side' : 'Center it', icon: '↔', run: () => placeSet(e, 'center') });
  if (!own) out.push({ label: 'Make it its own section', icon: '▭', hint: 'full width', run: () => placeSet(e, 'section') });
  return out;
}
function placeSet(e, what) {
  const snap = snapshotPage(), L = e.layout || (e.layout = { flow: true, size: 'auto' });
  if (what === 'center') { L.center = !L.center; L.flow = true; }
  if (what === 'section') {
    // a component that took a button's place leaves that button hidden, not back
    if (e.mode === 'replace') projectEdits().push({ id: newEditId(), target: e.target, targetLabel: e.targetLabel || '', mode: 'hide' });
    e.target = { scope: e.target.scope, kind: 'section', idx: 0 }; e.mode = 'after'; e.targetLabel = blockLabel(e.target.scope);
    L.flow = true; L.row = true; L.size = 'auto'; delete e.action;
  }
  saveProject(); renderStudioPreview();
  toastUndo(what === 'center' ? (L.center ? 'Centred' : 'Back to the side') : 'Now a section of its own', snap);
}
function ctxItems(t) {
  const edits = projectEdits(), items = [];
  if (t.editId) {
    const e = editById(t.editId), c = e && compById(e.compId), snap = snapshotPage();
    if (!c) return [{ label: 'Remove', icon: '✕', danger: true, run: () => { B.project.edits = withoutEdit(edits, t.editId); saveProject(); renderEditorWs(); toastUndo('Removed', snap); } }];
    // a button or link inside it: say where it goes
    if (t.part) {
      const l = (e.links || []).find(x => x.path === t.part.path);
      items.push({ label: `Link “${t.part.label.slice(0, 24)}” to…`, icon: '↗', hint: l ? 'linked' : '', run: () => setTimeout(() => openCtx(CTX_AT.x, CTX_AT.y, linkTargets(e, t.part)), 0) });
      items.push('-');
    }
    // rework it, in place: its words, its colours; anything deeper lives on its Library page
    if (isClicky(e.target.kind)) items.push({ label: 'Change its words', icon: '✎', run: () => { const v = prompt('What should it say?', e.text || e.targetLabel || ''); if (v != null && v.trim()) { e.text = v.trim(); saveProject(); renderStudioPreview(); } } });
    else items.push({ label: 'Change its words', icon: '✎', hint: 'click the words, type', run: () => { stPost({ rkWordsIn: e.id }); toast('Click any words in it and type · Enter saves · Esc when done', 5000); wordsEscape(); } });
    const canMatch = !!(pageAccent() && c.tokens && (c.tokens.accent || c.tokens.btnBg));
    if (canMatch) items.push({ label: e.recolor ? 'Use its own colours' : 'Match my site’s colours', icon: '◐', run: () => { e.recolor = !e.recolor; saveProject(); renderStudioPreview(); toastUndo(e.recolor ? 'Now in your site’s colours' : 'Back to its own colours', snap); } });
    if (parseProps(c) && parseProps(c).fields.length) items.push({ label: 'More options…', icon: '⚙', hint: 'in Library', run: () => { LIB.detail = c.id; setView('library'); } });
    const pl = placeItems(e); if (pl.length) items.push('-', ...pl);
    items.push('-');
    items.push({ label: 'Swap for another component', icon: '⇄', run: () => { S.swapFor = { editId: e.id }; renderEditorWs(); } });
    items.push({ label: 'Remove', icon: '✕', danger: true, run: () => { B.project.edits = withoutEdit(edits, t.editId); saveProject(); renderEditorWs(); toastUndo('Removed', snap); } });
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
