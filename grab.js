/* Reskin — save any part of a page to your Library.
   Works on every page Reskin shows: a style in Explore, the sample site, a reference design, your own page in Studio.
   The part keeps its look: its HTML plus only the CSS that styles it (the style's colours and fonts as they are now),
   wrapped in see-through copies of its ancestors so rules like `.hero h1` and inherited colours still apply.
   Saved as a plain HTML/CSS component (kind 'html') that you can drag onto any page.
   Needs app.js (comps, readyComps, toast), studio.js (toastUndo, ctx menu). */

/* ------------------------------------------------------------------ runs inside the page */
// el → { html, name, kind }. Self-contained: it is serialised into pages with `${__rkPart}`.
function __rkPart(el) {
  var doc = document, win = window;
  if (el.classList && el.classList.contains('rk-block') && el.children.length === 1) el = el.firstElementChild;
  var RK = /(^|\s)rk-[\w-]*/g;
  var isRk = function (n) { return n.nodeType === 1 && ((n.className && typeof n.className === 'string' && /(^|\s)rk-(tag|bar|ring|drop|tool|hl-box|pick)/.test(n.className)) || n.hasAttribute('data-rk-ui')); };
  // ---- what it is, for its name
  var tag = el.tagName.toLowerCase(), cls = typeof el.className === 'string' ? el.className : '';
  var kind = /^(header|nav)$/.test(tag) || /(^|\s)nav(\s|$|-)/.test(cls) || el.querySelector(':scope > nav, :scope > .wrap > nav') ? 'Navigation'
    : tag === 'footer' ? 'Footer'
    : /^h[1-6]$/.test(tag) ? 'Heading'
    : tag === 'button' || /(^|\s)btn(\s|$)/.test(cls) || (tag === 'a' && /btn|button/.test(cls)) ? 'Button'
    : tag === 'img' || tag === 'picture' || tag === 'svg' ? 'Picture'
    : tag === 'form' ? 'Form'
    : /card/.test(cls) || tag === 'article' ? 'Card'
    : tag === 'section' || /(^|\s)(sec|hero|section)(\s|$|-)/.test(cls) || el.getBoundingClientRect().width > innerWidth * 0.9 ? 'Section'
    : tag === 'ul' || tag === 'ol' ? 'List' : tag === 'a' ? 'Link' : tag === 'blockquote' || tag === 'figure' ? 'Quote' : 'Part';
  var h = el.matches('h1,h2,h3,h4') ? el : el.querySelector('h1,h2,h3,h4,blockquote,b,strong');
  var words = ((h || el).textContent || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ');
  if (words.length > 34) words = words.slice(0, 32).replace(/\s+\S*$/, '') + '…';
  var name = kind === 'Navigation' || kind === 'Footer' || !words ? kind : kind + ' · ' + words;

  // ---- the element, cleaned
  var abs = function (u) { if (!u || /^(data:|blob:|#|mailto:|tel:|javascript:)/i.test(u)) return u; try { return new URL(u, doc.baseURI).href; } catch (e) { return u; } };
  var clone = el.cloneNode(true);
  var all = [clone].concat([].slice.call(clone.querySelectorAll('*')));
  var live = [el].concat([].slice.call(el.querySelectorAll('*')));
  all.forEach(function (n, i) {
    var src = live[i];
    if (!n.parentNode && n !== clone) return;
    var t = n.tagName.toLowerCase();
    if (t === 'script' || t === 'noscript' || (t === 'iframe' && /rk-comp/.test(n.className)) || isRk(n)) { if (n !== clone) n.remove(); return; }
    [].slice.call(n.attributes).forEach(function (a) { if (/^data-rk|^contenteditable$|^draggable$|^spellcheck$/.test(a.name)) n.removeAttribute(a.name); });
    if (typeof n.className === 'string' && RK.test(n.className)) { var c = n.className.replace(RK, ' ').trim(); if (c) n.className = c; else n.removeAttribute('class'); }
    RK.lastIndex = 0;
    if (t === 'img' && src) { var s = src.currentSrc || src.src; if (s) n.setAttribute('src', s); n.removeAttribute('srcset'); n.removeAttribute('loading'); }
    if ((t === 'source') && n.getAttribute('srcset')) n.setAttribute('srcset', n.getAttribute('srcset').split(',').map(function (p) { var b = p.trim().split(/\s+/); b[0] = abs(b[0]); return b.join(' '); }).join(', '));
    if (t === 'a' && n.getAttribute('href')) { var hr = n.getAttribute('href'); if (/^about:srcdoc/.test(hr)) n.setAttribute('href', hr.replace(/^about:srcdoc/, '') || '#'); }
    if (n.getAttribute('style') && /opacity:\s*0\.28/.test(n.getAttribute('style'))) n.style.opacity = '';   // Studio's "hidden" marker
  });

  // ---- its ancestors, as see-through shells (selectors and inheritance still work, their boxes don't show)
  var chain = []; for (var a = el.parentElement; a && a !== doc.body && a !== doc.documentElement; a = a.parentElement) chain.unshift(a);
  var attrs = function (n, extra) {
    var out = '';
    [].slice.call(n.attributes).forEach(function (at) {
      if (/^(on|data-rk|data-block$|contenteditable|draggable)/i.test(at.name) || at.name === 'style') return;
      var v = at.value; if (at.name === 'class') { v = v.replace(RK, ' ').trim(); RK.lastIndex = 0; if (!v) return; }
      out += ' ' + at.name + '="' + v.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
    });
    var st = (n.getAttribute('style') || '').replace(/opacity:\s*0\.28;?/, '').trim();
    if (extra) st = (st ? st.replace(/;?$/, ';') : '') + extra;
    return out + (st ? ' style="' + st.replace(/"/g, '&quot;') + '"' : '');
  };
  var open = chain.map(function (n) { return '<' + n.tagName.toLowerCase() + attrs(n, 'display:contents!important') + '>'; }).join('');
  var close = chain.slice().reverse().map(function (n) { return '</' + n.tagName.toLowerCase() + '>'; }).join('');

  // ---- the CSS that styles it
  var ctx = chain.concat([doc.body, doc.documentElement]);
  var splitSel = function (s) { var out = [], d = 0, cur = ''; for (var i = 0; i < s.length; i++) { var ch = s[i]; if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  var bare = function (s) { return s.replace(/::?[a-zA-Z-]+(?!\()/g, '').replace(/::?(?:-webkit-|-moz-)?[a-z-]+\((?:[^()]|\([^()]*\))*\)/g, function (m) { return /^:(not|is|where|has|nth-|matches)/.test(m) ? m : ''; }).trim() || '*'; };
  var hits = function (sel) {
    if (/(^|[\s.#\[])(rk-|data-rk)/.test(sel) && splitSel(sel).every(function (x) { return /rk-|data-rk/.test(x); })) return false;   // Reskin's own studio styles
    return splitSel(sel).some(function (one) {
      var b = bare(one);
      try { return el.matches(b) || !!el.querySelector(b) || ctx.some(function (n) { return n.matches(b); }); } catch (e) { return true; }   // can't test it: keep it
    });
  };
  var keyframes = {}, links = [], used = [];
  var walk = function (rules, base) {
    var out = '';
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.type === 1) { if (hits(r.selectorText)) out += r.cssText + '\n'; }
      else if (r.type === 4 || r.type === 12 || (win.CSSLayerBlockRule && r instanceof CSSLayerBlockRule) || (win.CSSContainerRule && r instanceof CSSContainerRule)) {
        var inner = walk(r.cssRules, base); if (inner) out += r.cssText.slice(0, r.cssText.indexOf('{')) + '{\n' + inner + '}\n';
      }
      else if (r.type === 7) keyframes[r.name] = r.cssText;
      else if (r.type === 5 || r.type === 3) out += r.cssText + '\n';   // @font-face, @import
      else if (r.cssText && !r.selectorText && r.type !== 1) out += r.cssText + '\n';   // @property, @layer names…
      if (base && out) out = out.replace(/url\((['"]?)(?!data:|https?:|#)([^'")]+)\1\)/g, function (m, q, u) { try { return 'url(' + q + new URL(u, base).href + q + ')'; } catch (e) { return m; } });
    }
    return out;
  };
  var css = '';
  [].slice.call(doc.styleSheets).forEach(function (sh) {
    var own = sh.ownerNode;
    if (own && own.hasAttribute && own.hasAttribute('data-rk-ui')) return;
    var rules; try { rules = sh.cssRules; } catch (e) { rules = null; }
    if (!rules) { if (sh.href) links.push('<link rel="stylesheet" href="' + sh.href.replace(/"/g, '&quot;') + '"' + (sh.media && sh.media.mediaText ? ' media="' + sh.media.mediaText + '"' : '') + '>'); return; }
    var got = walk(rules, sh.href || null);
    if (got && sh.media && sh.media.mediaText && sh.media.mediaText !== 'all') got = '@media ' + sh.media.mediaText + '{\n' + got + '}\n';
    css += got;
  });
  Object.keys(keyframes).forEach(function (k) { if (css.indexOf(k) >= 0) used.push(keyframes[k]); });
  css += used.join('\n');
  [].slice.call(doc.querySelectorAll('link[rel~="preconnect"]')).forEach(function (l) { links.unshift(l.outerHTML); });

  // ---- how it sat on its page: what was behind it, how wide it was
  var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  var clear = function (s) { return !s.backgroundImage || s.backgroundImage === 'none' ? /rgba\(\d+,\s*\d+,\s*\d+,\s*0\)|transparent/.test(s.backgroundColor) : false; };
  var behind = '';
  if (clear(cs)) for (var b = el.parentElement; b; b = b.parentElement) { var bs = getComputedStyle(b); if (!clear(bs)) { behind = bs.backgroundImage !== 'none' && /gradient/.test(bs.backgroundImage) ? bs.backgroundImage : bs.backgroundColor; break; } }
  var narrow = r.width < innerWidth * 0.9 && kind !== 'Navigation' && kind !== 'Footer';
  clone.setAttribute('data-part', kind.toLowerCase());
  var fit = 'html,body{margin:0}' + (behind ? 'body{background:' + behind + '}' : 'html,body{background:transparent}') +
    (narrow ? '\n[data-part]{max-width:' + Math.ceil(r.width) + 'px;margin-left:auto!important;margin-right:auto!important;box-sizing:border-box}' : '\n[data-part]{width:100%}');
  var base = doc.querySelector('base[href^="http"]');
  var htmlAttrs = attrs(doc.documentElement), bodyAttrs = attrs(doc.body);
  var html = '<!doctype html>\n<html' + htmlAttrs + '>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + name.replace(/</g, '&lt;') + '</title>\n' +
    (base ? '<base href="' + base.getAttribute('href').replace(/"/g, '&quot;') + '">\n' : '') + links.join('\n') + '\n<style>\n' + css + '</style>\n<style>/* how it sat on its page */\n' + fit + '\n</style>\n</head>\n<body' + bodyAttrs + '>\n' +
    open + clone.outerHTML + close + '\n</body>\n</html>';
  return { html: html, name: name, kind: kind, w: Math.round(r.width), h: Math.round(r.height) };
}

// The pick mode inside a page: hover outlines the part under the pointer, ↑ / ↓ make it bigger / smaller,
// click saves it, Esc stops. Turned on and off by messages ({ rkPick: true | false }).
function __rkPicker() {
  var ON = false, cur = null, stack = [], box, lab;
  function ui() {
    if (box) return;
    var st = document.createElement('style'); st.setAttribute('data-rk-ui', '');
    st.textContent = '.rk-pick-box{position:fixed;z-index:2147483646;pointer-events:none;outline:2px solid #ff5b37;outline-offset:1px;background:rgba(255,91,55,.08);border-radius:3px;transition:all .08s ease-out;display:none}' +
      '.rk-pick-lab{position:fixed;z-index:2147483647;pointer-events:none;font:600 12px/1.2 system-ui,sans-serif;background:#ff5b37;color:#fff;padding:5px 8px;border-radius:6px;white-space:nowrap;display:none;box-shadow:0 2px 8px rgba(0,0,0,.2)}.rk-pick-lab small{font-weight:400;opacity:.85;margin-left:6px}' +
      'html.rk-picking,html.rk-picking *{cursor:copy!important}';
    document.head.appendChild(st);
    box = document.createElement('div'); box.className = 'rk-pick-box'; box.setAttribute('data-rk-ui', '');
    lab = document.createElement('div'); lab.className = 'rk-pick-lab'; lab.setAttribute('data-rk-ui', '');
    document.body.appendChild(box); document.body.appendChild(lab);
  }
  var SEM = /^(header|nav|footer|section|article|aside|form|figure|blockquote|ul|ol|li|table|button|img|picture|svg|video|h1|h2|h3|h4|h5|h6|p|a|input|select|textarea|label)$/;
  function own(el) {   // has a box of its own you can see
    var s = getComputedStyle(el);
    return (s.backgroundImage !== 'none') || !/rgba\(\d+,\s*\d+,\s*\d+,\s*0\)|transparent/.test(s.backgroundColor) || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0 || (s.boxShadow && s.boxShadow !== 'none');
  }
  function meaningful(el) {
    for (var n = el; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.hasAttribute('data-rk-ui')) return null;
      var r = n.getBoundingClientRect(), t = n.tagName.toLowerCase();
      if (r.width < 24 || r.height < 16) continue;
      if (/^(span|b|i|em|strong|small|code|br)$/.test(t) && !own(n)) continue;
      if (SEM.test(t) || own(n) || /card|btn|button|nav|hero|section|tile|panel|item/i.test(typeof n.className === 'string' ? n.className : '')) return n;
    }
    return null;
  }
  function what(n) {
    var t = n.tagName.toLowerCase(), c = typeof n.className === 'string' ? n.className : '';
    var k = /^(header|nav)$/.test(t) ? 'Navigation' : t === 'footer' ? 'Footer' : /^h[1-6]$/.test(t) ? 'Heading' : t === 'button' || /btn|button/.test(c) ? 'Button' : t === 'img' || t === 'svg' || t === 'picture' ? 'Picture' : t === 'form' ? 'Form' : /card/.test(c) || t === 'article' ? 'Card' : t === 'p' ? 'Text' : t === 'a' ? 'Link' : t === 'li' ? 'Item' : t === 'ul' || t === 'ol' ? 'List' : t === 'section' || n.getBoundingClientRect().width > innerWidth * 0.9 ? 'Section' : 'Part';
    var r = n.getBoundingClientRect();
    return k + '<small>' + Math.round(r.width) + ' × ' + Math.round(r.height) + ' · click to save · ↑ bigger · ↓ smaller</small>';
  }
  function show(n) {
    cur = n; if (!n) { box.style.display = lab.style.display = 'none'; return; }
    var r = n.getBoundingClientRect();
    box.style.display = 'block'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    lab.innerHTML = what(n); lab.style.display = 'block';
    var ly = r.top > 34 ? r.top - 30 : Math.min(r.bottom + 6, innerHeight - 30);
    lab.style.left = Math.max(6, Math.min(r.left, innerWidth - lab.offsetWidth - 6)) + 'px'; lab.style.top = ly + 'px';
  }
  function set(on) {
    ON = on; ui(); document.documentElement.classList.toggle('rk-picking', on);
    if (!on) { show(null); stack = []; }
  }
  document.addEventListener('mousemove', function (e) { if (!ON) return; stack = []; show(meaningful(e.target)); }, true);
  addEventListener('scroll', function () { if (ON && cur) show(cur); }, { passive: true });
  document.addEventListener('mouseleave', function () { if (ON) show(null); });
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'submit'].forEach(function (k) { document.addEventListener(k, function (e) { if (ON) { e.preventDefault(); e.stopPropagation(); } }, true); });
  document.addEventListener('click', function (e) {
    if (!ON) return; e.preventDefault(); e.stopPropagation();
    var n = cur && cur.contains(e.target) ? cur : meaningful(e.target); if (!n) return;   // what you clicked (or the bigger part around it you chose with ↑)
    try { parent.postMessage({ rkPartSaved: __rkPart(n) }, '*'); } catch (err) { parent.postMessage({ rkPartSaved: null, why: String(err && err.message || err) }, '*'); }
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!ON) return;
    if (e.key === 'Escape') { e.preventDefault(); set(false); parent.postMessage({ rkPickEnd: true }, '*'); }
    if (e.key === 'ArrowUp' && cur && cur.parentElement && cur.parentElement !== document.body) { e.preventDefault(); stack.push(cur); show(cur.parentElement); }
    if (e.key === 'ArrowDown' && stack.length) { e.preventDefault(); show(stack.pop()); }
    if (e.key === 'Enter' && cur) { e.preventDefault(); parent.postMessage({ rkPartSaved: __rkPart(cur) }, '*'); }
  }, true);
  addEventListener('message', function (e) {
    var d = e.data || {};
    if ('rkPick' in d) set(!!d.rkPick);
    if (d.rkPickKey && ON) document.dispatchEvent(new KeyboardEvent('keydown', { key: d.rkPickKey }));
  });
}

// Studio's stage: remembers what you right-clicked, saves it (or its whole section) when the app asks
function __rkPartStage() {
  var last = null;
  document.addEventListener('contextmenu', function (e) { last = e.target; }, true);
  var SEL = { heading: 'h1,h2,h3,h4,h5,h6', text: 'p,li,blockquote', button: 'a.btn,button,.btn,[role=button]', link: 'a', image: 'img,picture,svg,figure', card: '.card,article,li,figure', node: '*' };
  addEventListener('message', function (e) {
    var d = e.data || {}; if (!d.rkPartAt || !last) return;
    var k = d.rkPartAt.kind, el = null;
    if (k === 'section') el = last.closest('.rk-block,header.nav,aside.side,footer');
    else el = (last.closest && last.closest(SEL[k] || '*')) || last;
    if (!el) { parent.postMessage({ rkPartSaved: null, why: 'Nothing to save there' }, '*'); return; }
    try { parent.postMessage({ rkPartSaved: __rkPart(el), from: 'your page' }, '*'); } catch (err) { parent.postMessage({ rkPartSaved: null, why: String(err && err.message || err) }, '*'); }
  });
}
const partStageScript = () => `<script>${__rkPart};(${__rkPartStage})();<\/script>`;
const pickerScript = () => `<script>${__rkPart};(${__rkPicker})();<\/script>`;

/* ------------------------------------------------------------------ the app side */
const PART = { from: '', busy: false };
// a part came back from a page: it becomes a Library component (plain HTML/CSS), with Undo
async function saveGrabbed(g, from) {
  if (!g || !g.html) { toast('Couldn’t save that part' + (from && from.why ? ' — ' + from.why : ''), 4000); return null; }
  if (PART.busy) return null; PART.busy = true;
  try {
    let name = g.name || 'Saved part';
    if (comps.list.some(c => c.name === name)) { let n = 2; while (comps.list.some(c => c.name === `${name} (${n})`)) n++; name = `${name} (${n})`; }
    const item = { id: newId(), name, source: (typeof from === 'string' ? from : PART.from) || 'saved part', kind: 'html', code: g.html, collection: 'My kit', created: Date.now(), saved: { w: g.w, h: g.h, kind: g.kind } };
    await readyComps([item]);
    comps.list.unshift(item); comps.save();
    if (state.view === 'studio' && typeof renderEditorWs === 'function') { S.flash = item.id; try { renderEditorWs(); } catch (e) {} }
    else if (state.view === 'library' && typeof renderLibrary === 'function') renderLibrary();
    const undo = () => { const i = comps.list.findIndex(x => x.id === item.id); if (i >= 0) { comps.list.splice(i, 1); comps.save(); } if (state.view === 'studio') try { renderEditorWs(); } catch (e) {} else if (state.view === 'library' && typeof renderLibrary === 'function') renderLibrary(); toast('Undone'); };
    const inModal = !$('modal').hidden, inRail = state.view === 'studio' && !inModal;
    const put = state.model && !inRail ? [{ label: 'Put it on my page', run: () => { closeModalPick(); if (!$('modal').hidden) closeModal(); S.flash = item.id; if (state.view === 'studio') renderEditorWs(); else setView('studio'); toast(`Drag “${item.name}” from the rail onto your page`, 4000); } }] : [];
    const big = g.html.length > 400000 ? ` · it’s large (${Math.round(g.html.length / 1000)} KB), so it uses a lot of this browser’s storage` : '';
    pushToast({ text: `Saved “${item.name}” to your Library${inRail ? ' — it’s first in the rail, drag it onto any page' : ''}${big}`, more: put, ms: 9000, undo });
    if (!item.tokens && typeof ensureCompTokens === 'function') ensureCompTokens(item);   // its colours, for "match my site's colours"
    return item.id;
  } finally { PART.busy = false; }
}

/* ---- the full preview's "Save a part" mode ---- */
const MPICK = { on: false, html: null, s: null };
function modalPickButton() {
  let b = $('mPick'); if (b) return b;
  b = document.createElement('button'); b.className = 'ghost'; b.id = 'mPick'; b.type = 'button';
  b.title = 'Click any part of this page — a menu, a hero, a card, a button — to save it to your Library';
  b.innerHTML = ic('import') + ' Save a part';
  $('mVar').before(b);
  b.onclick = () => MPICK.on ? closeModalPick(true) : openModalPick();
  return b;
}
function paintModalPick() {
  const b = modalPickButton(); b.classList.toggle('on', MPICK.on); b.setAttribute('aria-pressed', MPICK.on);
  b.innerHTML = MPICK.on ? ic('check') + ' Done saving' : ic('import') + ' Save a part';
  let hint = $('mPickHint');
  if (MPICK.on && !hint) { hint = document.createElement('div'); hint.id = 'mPickHint'; hint.className = 'mpick-hint'; hint.innerHTML = 'Click any part to save it to your Library · <kbd>↑</kbd> bigger part · <kbd>↓</kbd> smaller · <kbd>Esc</kbd> done'; $('mStage').before(hint); }
  if (!MPICK.on && hint) hint.remove();
}
function openModalPick() {
  if (!MPICK.html) { toast('Nothing to save from here'); return; }
  MPICK.on = true; paintModalPick();
  // a fresh frame that may run the picker (static previews have no scripts of their own)
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox'); f.title = 'Full preview — pick a part to save';
  // only animated remixes run their page's own code; for everything else the page's scripts stay out
  const html = MPICK.s && MPICK.s.live ? MPICK.html : MPICK.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  f.srcdoc = injectEnd(injectPreviewCss(html), pickerScript());
  f.onload = () => { f.contentWindow.postMessage({ rkPick: true }, '*'); f.focus(); };
  $('mStage').replaceChildren(f);
}
function closeModalPick(remount) {
  if (!MPICK.on) return;
  MPICK.on = false; paintModalPick();
  const f = $('mStage') && $('mStage').querySelector('iframe'); if (f && f.contentWindow) f.contentWindow.postMessage({ rkPick: false }, '*');
}
// every full preview remembers what it shows, so "Save a part" can pick from it
const _setModalDoc = setModalDoc;
setModalDoc = function (html, s) {
  MPICK.on = false; MPICK.html = html; MPICK.s = s;
  const st = state.current;
  PART.from = st && st._built ? 'your page' : st && st.name ? st.name : 'a preview';
  _setModalDoc(html, s); paintModalPick();
};
const _closeModal = closeModal;
closeModal = function () { MPICK.on = false; paintModalPick(); _closeModal(); };
$('mClose').onclick = closeModal;
$('modal').onclick = e => { if (e.target === $('modal')) closeModal(); };
// Esc while the app has focus ends picking first, then closes as before
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !MPICK.on || $('modal').hidden) return;
  e.preventDefault(); e.stopImmediatePropagation(); closeModalPick();
}, true);
// the reference design's own page: "Save parts" opens it in the full preview, ready to pick
function openDesignForParts() {
  const t = state.tgt; if (!t || !t.viewHtml) { toast('Add a design first'); return; }
  state.current = { name: t.name, label: 'Your reference design', fontLabel: '', id: 'tgt', _tgt: true };
  $('mName').textContent = t.name; $('mInfo').textContent = 'Your reference design · click any part of it to save it';
  $('modal').hidden = false; document.body.style.overflow = 'hidden';
  setModalDoc(t.viewHtml, { live: t.kind === 'tsx' });
  $('mSave').hidden = $('mVar').hidden = true;   // those are for styles
  PART.from = t.name || 'your design';
  openModalPick();
}

addEventListener('message', e => {
  const d = e.data || {};
  if (!('rkPartSaved' in d) && !d.rkPickEnd) return;
  const mf = !$('modal').hidden && $('mStage').querySelector('iframe');
  const sf = $('stFrame') && $('stFrame').querySelector('iframe');
  const fromModal = mf && e.source === mf.contentWindow, fromStage = sf && e.source === sf.contentWindow;
  if (!fromModal && !fromStage) return;
  if (d.rkPickEnd) { if (fromModal) { MPICK.on = false; paintModalPick(); } return; }
  saveGrabbed(d.rkPartSaved, fromStage ? (B.project && B.project.name ? B.project.name : 'your page') : { why: d.why });
});

// the reference design's card gets "Save parts": its own page, ready to pick from
const _renderTargetCard = renderTargetCard;
renderTargetCard = function () {
  const r = _renderTargetCard.apply(this, arguments);
  const t = state.tgt, pv = $('tPrev');
  if (t && t.viewHtml && pv && !$('tParts')) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost tparts'; b.id = 'tParts';
    b.innerHTML = ic('import') + ' Save parts of it'; b.title = 'Open this design and click any part of it — a menu, a hero, a card — to save it to your Library';
    b.onclick = openDesignForParts; pv.after(b);
  }
  return r;
};
