/* Click-to-edit (prototype): inspect any part of a component and change it with controls; Reskin rewrites the
   component's own code. Needs engine.js (tsxDoc, __rkInspect, splitBundle, prepareTsx) and app.js (comps).

   React components: the compiler tags every element with a number in source order and sends a part map (where its
   classes, style, words and literal values sit in the source). An edit is a precise splice into that source, so the
   code keeps its formatting; after each edit it compiles again and the map is rebuilt, so it never goes stale.
   Look edits go into Tailwind classes when the part has them (rounded-md → rounded-xl), else into its style.
   HTML components: the same numbering over the document's elements; edits change the document and save it. */

const INS = { on: false, compId: null, sel: null, map: null, pick: null, undo: [], redo: [], frame: null, panel: null };

/* ---- the exact text the compiler saw, and how to put the saved code back together ---- */
function insSource(c) {
  if (c.kind !== 'tsx') return { text: c.code, wrap: s => s };
  const b = splitBundle(c.code), text = prepareTsx(b.js);
  return { text, wrap: s => s + (b.css.trim() ? `\n/* ---- styles.css ---- */\n${b.css}` : '') };
}
const splice = (s, a, b, v) => s.slice(0, a) + v + s.slice(b);

/* ---- Tailwind: swap one property's class for the new value; hover:/md: variants are left alone ---- */
const TW_SIZE = /^text-(xs|sm|base|lg|[2-9]?xl|\[[\d.]+(px|rem|em)\])$/;
const TW_TEXT_OTHER = /^text-(left|center|right|justify|start|end|ellipsis|clip|wrap|nowrap|balance|pretty)$/;
const TW_DROP = {
  color: t => /^text-/.test(t) && !TW_SIZE.test(t) && !TW_TEXT_OTHER.test(t),
  bg: t => /^bg-/.test(t) && !/^bg-(gradient|cover|contain|center|top|bottom|left|right|no-repeat|repeat|fixed|local|scroll|clip|origin|blend|none|\[url)/.test(t),
  fontSize: t => TW_SIZE.test(t),
  radius: t => /^rounded(-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?$/.test(t),
  pad: t => /^p[xytrbl]?-/.test(t),
  blur: t => /^backdrop-blur(-|$)/.test(t),
};
function twToken(prop, v) {
  if (prop === 'color') return `text-[${v}]`;
  if (prop === 'bg') return `bg-[${v}]`;
  if (prop === 'fontSize') return { 12: 'text-xs', 14: 'text-sm', 16: 'text-base', 18: 'text-lg', 20: 'text-xl', 24: 'text-2xl', 30: 'text-3xl', 36: 'text-4xl', 48: 'text-5xl', 60: 'text-6xl' }[v] || `text-[${v}px]`;
  if (prop === 'radius') return v >= 999 ? 'rounded-full' : { 0: 'rounded-none', 2: 'rounded-sm', 4: 'rounded', 6: 'rounded-md', 8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl', 24: 'rounded-3xl' }[v] || `rounded-[${v}px]`;
  if (prop === 'pad') return v % 4 === 0 && v <= 64 ? `p-${v / 4}` : `p-[${v}px]`;
  if (prop === 'blur') return +v ? `backdrop-blur-[${v}px]` : 'backdrop-blur-none';
}
// the new class takes the old one's place, so the list still reads the way its author wrote it
function twSwap(cls, prop, v) {
  const toks = cls.split(/\s+/).filter(Boolean), at = toks.findIndex(TW_DROP[prop]), keep = toks.filter(t => !TW_DROP[prop](t));
  keep.splice(at < 0 ? keep.length : at, 0, twToken(prop, v));
  return keep.join(' ');
}
// the same edit as a style property (no classes to edit, or an SVG part)
const STYLE_KEY = { color: 'color', bg: 'backgroundColor', fontSize: 'fontSize', radius: 'borderRadius', pad: 'padding', fill: 'fill', stroke: 'stroke', strokeWidth: 'strokeWidth', blur: 'backdropFilter', bgImage: 'backgroundImage' };
const CSS_KEY = { color: 'color', bg: 'background-color', fontSize: 'font-size', radius: 'border-radius', pad: 'padding', fill: 'fill', stroke: 'stroke', strokeWidth: 'stroke-width', blur: 'backdrop-filter', bgImage: 'background-image' };
const PX = { fontSize: 1, radius: 1, pad: 1, strokeWidth: 1 };
const cssVal = (prop, v) => prop === 'blur' ? (+v ? `blur(${v}px)` : 'none')
  : prop === 'bgImage' ? (v ? `url('${String(v).replace(/["'\\]/g, encodeURIComponent)}')` : 'none')
  : PX[prop] ? v + 'px' : v;
// a picture as a background covers the part and stays centred (the way a hero photo behaves)
const BG_FIT = [['backgroundSize', 'cover'], ['backgroundPosition', 'center']];

/* ---- write style properties into a part's style={{…}}: added when there's none, wrapped when it's worked out in code ---- */
function styleWrite(text, part, kv) {
  // write strings the way this file does ('…' or "…")
  const q = (text.match(/'/g) || []).length > (text.match(/"/g) || []).length ? "'" : '"';
  const lit = v => q + String(v).split('\\').join('\\\\').split(q).join('\\' + q) + q;
  const pairs = kv.map(([k, v]) => `${k}: ${lit(v)}`).join(', ');
  if (!part.style) return splice(text, part.at, part.at, ` style={{ ${pairs} }}`);
  if (part.style.dynamic) {   // style={someStyle}: keep what it works out, and put the change after it
    if (part.style.s == null) throw new Error('its style is worked out in code');
    return splice(text, part.style.s, part.style.e, `{ ...(${text.slice(part.style.s, part.style.e)}), ${pairs} }`);
  }
  const have = kv.map(([k, v]) => ({ k, v, at: part.style.props.find(p => p.k === k) }));
  // new ones go at the end of the object first (it's later in the text), then the ones already there, last first
  const add = have.filter(x => !x.at);
  if (add.length) {
    const inner = text.slice(part.style.s + 1, part.style.e - 1), body = inner.replace(/\s+$/, ''), at = part.style.s + 1 + body.length;
    const ins = add.map(x => `${x.k}: ${lit(x.v)}`).join(', ');
    text = !body.trim() ? splice(text, part.style.s + 1, part.style.e - 1, ` ${ins} `) : splice(text, at, at, (/,$/.test(body) ? ' ' : ', ') + ins);
  }
  have.filter(x => x.at).sort((a, b) => b.at.s - a.at.s).forEach(x => { text = splice(text, x.at.s, x.at.e, lit(x.v)); });
  return text;
}

/* ---- edits on React source: returns the new source text, or throws a plain-words reason ---- */
function tsxEdit(text, part, ed) {
  if (ed.t === 'text') { const x = part.texts[ed.i]; return splice(text, x.s, x.e, x.q ? ed.v.replace(/["\\]/g, '\\$&') : ed.v.replace(/[{}<>]/g, m => `{'${m}'}`)); }
  if (ed.t === 'lit') { const x = part.lits[ed.i]; return splice(text, x.s, x.e, x.kind === 'num' ? String(+ed.v) : ed.v); }
  if (ed.t === 'src') { if (!part.src) throw new Error('its picture is worked out in code'); return splice(text, part.src.s, part.src.e, String(ed.v).replace(/["'`\\]/g, encodeURIComponent)); }
  // a background picture always goes in its style (a picture address doesn't belong in a class name)
  if (ed.t === 'look' && ed.prop === 'bgImage') {
    const had = part.style && part.style.props && part.style.props.some(p => p.k === 'backgroundImage');
    return styleWrite(text, part, [['backgroundImage', cssVal('bgImage', ed.v)], ...(ed.v && !had ? BG_FIT : [])]);
  }
  if (ed.t === 'look') {
    const svgish = /^(path|circle|line|rect|ellipse|polygon|polyline|g|svg|text)$/.test(part.tag) || /^(fill|stroke|strokeWidth)$/.test(ed.prop);
    if (!svgish && part.cls && !part.cls.dynamic) return splice(text, part.cls.s, part.cls.e, twSwap(part.cls.v, ed.prop, ed.v));
    if (!svgish && !part.cls) return splice(text, part.at, part.at, ` className="${twToken(ed.prop, ed.v)}"`);
    return styleWrite(text, part, [[STYLE_KEY[ed.prop], cssVal(ed.prop, ed.v)]]);
  }
  throw new Error('unknown change');
}

/* ---- HTML components: number the elements the same way every time ---- */
const htmlEls = doc => [...doc.querySelectorAll('body *')].filter(e => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BR)$/.test(e.tagName));
function htmlParse(code) { return new DOMParser().parseFromString(code, 'text/html'); }
function htmlSerialize(doc, orig) { return /<html[\s>]/i.test(orig) ? '<!doctype html>\n' + doc.documentElement.outerHTML : doc.head.innerHTML + doc.body.innerHTML; }
// the component's own CSS rule for this element: the last plain rule in its <style> whose selector matches it
// (".btn", ".card h3"…). Hover/focus rules, at-rules and page-wide ones (html, body, *) are left alone.
function htmlRule(doc, el) {
  let best = null;
  for (const st of doc.querySelectorAll('style')) {
    const re = /([^{}]+)\{([^{}]*)\}/g; let m;
    while ((m = re.exec(st.textContent))) {
      const sel = m[1].trim(), list = sel.split(',').map(s => s.trim());
      if (!sel || /^@/.test(sel) || /:/.test(sel) || list.some(s => /^(html|body|\*)$/i.test(s))) continue;
      let ok = false; try { ok = list.some(s => el.matches(s)); } catch {}
      if (ok) best = { st, sel, s: m.index + m[0].indexOf('{') + 1, e: m.index + m[0].length - 1 };
    }
  }
  return best;
}
const RULE_NAMES = { color: ['color'], bg: ['background-color', 'background'], fontSize: ['font-size'], radius: ['border-radius'], pad: ['padding'], fill: ['fill'], stroke: ['stroke'], strokeWidth: ['stroke-width'], blur: ['backdrop-filter'], bgImage: ['background-image'] };
function ruleEdit(r, prop, v) {
  const txt = r.st.textContent, block = txt.slice(r.s, r.e), val = cssVal(prop, v);
  for (const name of RULE_NAMES[prop]) {
    const m = new RegExp('(^|;)\\s*' + name + '\\s*:\\s*([^;]*)').exec(block);
    // a background shorthand holding more than a colour (an image, a gradient) is left alone: add the colour instead
    if (m && !(name === 'background' && /url\(|gradient/.test(m[2]))) { const vs = r.s + m.index + m[0].length - m[2].length; r.st.textContent = splice(txt, vs, vs + m[2].trimEnd().length, val); return; }
  }
  const body = block.replace(/[\s;]+$/, ''), at = r.s + body.length;
  r.st.textContent = splice(txt, at, at, (body.trim() ? ';' : '') + `${CSS_KEY[prop]}:${val}`);
}
function htmlMap(code) {
  const doc = htmlParse(code);
  return htmlEls(doc).map((el, n) => {
    const rule = htmlRule(doc, el);
    const texts = [...el.childNodes].filter(x => x.nodeType === 3 && x.nodeValue.trim()).map(x => ({ v: x.nodeValue.trim().replace(/\s+/g, ' ') }));
    const lits = [...el.attributes].filter(a => /^-?[\d.]+$/.test(a.value.trim()) || /^(#[0-9a-f]{3,8}|rgba?\(.*\)|hsla?\(.*\))$/i.test(a.value.trim()))
      .filter(a => !/^(data-|tabindex|id$|class$)/.test(a.name)).map(a => ({ path: a.name, raw: a.value.trim(), kind: /^-?[\d.]+$/.test(a.value.trim()) ? 'num' : 'color' }));
    return { n, tag: el.tagName.toLowerCase(), use: false, texts, lits, cls: null, rule: rule && rule.sel, comp: '' };
  });
}
function htmlEdit(code, part, ed) {
  const doc = htmlParse(code), el = htmlEls(doc)[part.n];
  if (!el) throw new Error('that part moved');
  if (ed.t === 'text') { const tn = [...el.childNodes].filter(x => x.nodeType === 3 && x.nodeValue.trim())[ed.i]; const lead = tn.nodeValue.match(/^\s*/)[0], trail = tn.nodeValue.match(/\s*$/)[0]; tn.nodeValue = lead + ed.v + trail; }
  else if (ed.t === 'lit') el.setAttribute(part.lits[ed.i].path, ed.v);
  else if (ed.t === 'src') el.setAttribute('src', ed.v);
  else if (ed.t === 'look') { const r = htmlRule(doc, el); if (r) ruleEdit(r, ed.prop, ed.v); else el.style.setProperty(CSS_KEY[ed.prop], cssVal(ed.prop, ed.v)); }
  return htmlSerialize(doc, code);
}
function htmlInspectDoc(code) {
  const doc = htmlParse(code);
  htmlEls(doc).forEach((el, n) => el.setAttribute('data-rk-part', n));
  const tag = `<script>window.__RK_MAP=${jsonForScript(htmlMap(code))};(${__rkInspect})();<\/script>`;
  const out = htmlSerialize(doc, code), i = out.toLowerCase().lastIndexOf('</body>');
  return reviveSaved(i >= 0 ? out.slice(0, i) + tag + out.slice(i) : out + tag);
}

/* ---- mount: frame + panel ---- */
function insDoc(c) { return c.kind === 'tsx' ? tsxDoc(c.code, 'comp', typeof mountFor === 'function' ? mountFor(c) : null, { inspect: true, libs: c.libs }) : htmlInspectDoc(c.code); }
function insMount(c, box) {
  if (INS.compId !== c.id) Object.assign(INS, { compId: c.id, sel: null, map: null, pick: null, undo: [], redo: [] });
  box.classList.add('ins-on');
  const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.title = 'Inspect ' + c.name;
  const panel = document.createElement('aside'); panel.className = 'ins-panel'; panel.setAttribute('aria-live', 'polite');
  box.replaceChildren(f, panel);
  INS.frame = f; INS.panel = panel;
  f.srcdoc = insDoc(c);
  insRender();
}
function insReload() { const c = compById(INS.compId); if (!c || !INS.frame) return; INS.map = null; INS.frame.srcdoc = insDoc(c); insRender(); }
function insPost(m) { INS.frame && INS.frame.contentWindow && INS.frame.contentWindow.postMessage(m, '*'); }

addEventListener('message', e => {
  if (!INS.frame || e.source !== INS.frame.contentWindow) return;
  const d = e.data || {};
  if (d.rkPartMap) { INS.map = d.rkPartMap; if (INS.sel != null) insPost({ rkInspectSelect: INS.sel }); insRender(); }
  if ('rkInspectPick' in d) { INS.pick = d.rkInspectPick; INS.sel = d.rkInspectPick ? d.rkInspectPick.n : null; insRender(); }
});

/* ---- change the code ---- */
function insApply(ed, what) {
  const c = compById(INS.compId), part = INS.map && INS.map.find(p => p.n === INS.sel);
  if (!c || !part) return;
  const src = insSource(c);
  let next;
  try { next = c.kind === 'tsx' ? tsxEdit(src.text, part, ed) : htmlEdit(src.text, part, ed); }
  catch (err) { toast(`Can’t change that here: ${err.message}`, 3500); return; }
  INS.undo.push({ code: c.code, what }); INS.redo = [];
  c.code = src.wrap(next); comps.save();
  insReload();
}
function insUndo(redo) {
  const c = compById(INS.compId), from = redo ? INS.redo : INS.undo, to = redo ? INS.undo : INS.redo, step = from.pop();
  if (!c || !step) return;
  to.push({ code: c.code, what: step.what }); c.code = step.code; comps.save(); insReload();
  toast(`${redo ? 'Redone' : 'Undone'}: ${step.what}`);
}

/* ---- the panel ---- */
// any CSS colour the browser can paint (rgb, oklch and oklab from Tailwind 4, color(srgb …), names) → its red, green,
// blue and alpha: paint one pixel and read it back
function toRgba(c) {
  if (!c || c === 'none') return null;
  const x = toRgba.cx || (toRgba.cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true }));
  x.clearRect(0, 0, 1, 1); x.fillStyle = 'rgba(0,0,0,0)'; x.fillStyle = c; x.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 };
}
const rgbHex = c => { const v = toRgba(c); return v ? '#' + [v.r, v.g, v.b].map(n => n.toString(16).padStart(2, '0')).join('') : '#000000'; };
const transparent = c => { const v = toRgba(c); return !v || v.a === 0; };
const alphaOf = c => { const v = toRgba(c); return v ? Math.round(v.a * 100) : 0; };
const withAlpha = (hex, pct) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.round(pct) / 100})`; };
const blurOf = f => { const m = /blur\(([\d.]+)px\)/.exec(f || ''); return m ? +m[1] : 0; };
const urlOf = b => { const m = /url\(["']?(.*?)["']?\)/.exec(b || ''); return m ? m[1] : ''; };
// a picture from your computer, made small enough to live in the component's code (longest side 1600 px, JPEG)
function pictureFile(cb) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = () => {
    const f = i.files[0]; if (!f) return;
    const img = new Image(), u = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u);
      cb(cv.toDataURL(/png|svg|gif|webp/.test(f.type) ? 'image/png' : 'image/jpeg', .85));   // PNG keeps see-through parts
    };
    img.onerror = () => toast('That picture couldn’t be read');
    img.src = u;
  };
  i.click();
}
function insRender() {
  const p = INS.panel; if (!p) return;
  const part = INS.map && INS.sel != null ? INS.map.find(x => x.n === INS.sel) : null, k = INS.pick;
  const hist = `<div class="ins-hist"><button class="ghost" id="insUndo" ${INS.undo.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">↶ Undo</button><button class="ghost" id="insRedo" ${INS.redo.length ? '' : 'disabled'}>↷ Redo</button>${INS.undo.length ? `<small>${INS.undo.length} change${INS.undo.length > 1 ? 's' : ''} in its code</small>` : ''}</div>`;
  // the component's own settings (a lens's blur, bevel, logo…): what can't be clicked — drawn on a canvas, worked out
  // in code — is usually one of these
  const P = c_kindTsx() && typeof parseProps === 'function' ? parseProps(compById(INS.compId)) : null, hasSet = !!(P && P.fields.length);
  const sets = hasSet ? `<details class="ins-sec ins-sets" ${!part || !k || INS.setsOpen ? 'open' : ''}><summary><h4>Its settings <small>→ everywhere it’s used</small></h4></summary><div class="ins-pp"></div></details>` : '';
  if (!INS.map) { p.innerHTML = `<div class="ins-empty"><span class="spin"></span> Reading its parts…</div>${sets}${hist}`; insSets(); return insWire(null); }
  if (!part || !k) { p.innerHTML = `<div class="ins-empty"><b>Click any part</b> to change it.<br><small>Hover or Tab to see a part · Enter pins it · Esc clears · ↑ selects the part around it · Alt+click uses it normally</small><br><small>${INS.map.length} parts found</small></div>${sets}${hist}`; insSets(); return insWire(null); }
  const cs = k.cs, svg = /^(path|circle|line|rect|ellipse|polygon|polyline|g|svg|text)$/.test(k.tag);
  const where = part.rule ? `its CSS rule ${part.rule}` : !c_kindTsx() ? 'its style' : part.cls && !part.cls.dynamic ? 'its classes' : part.cls ? 'its style (classes are worked out in code)' : svg ? 'its style' : 'new classes';
  const look = svg ? [
    ['fill', 'Fill', 'color', transparent(cs.fill) ? '#000000' : rgbHex(cs.fill)],
    ['stroke', 'Line colour', 'color', transparent(cs.stroke) ? '#000000' : rgbHex(cs.stroke)],
    ['strokeWidth', 'Line width', 'num', parseFloat(cs.strokeWidth) || 1, 0, 20, .5],
  ] : [
    ['color', 'Text colour', 'color', rgbHex(cs.color)],
    ['bg', 'Background', 'color', transparent(cs.bg) ? '#ffffff' : rgbHex(cs.bg), 0, 0, 0, transparent(cs.bg) ? 'none' : null],
    // how solid the background colour is: frosted glass is a light colour you can partly see through
    ['bgAlpha', 'Background strength', 'num', alphaOf(cs.bg), 0, 100, 1, alphaOf(cs.bg) + '%'],
    ['blur', 'Frost (glass blur)', 'num', Math.min(blurOf(cs.backdrop), 60), 0, 60, 1, blurOf(cs.backdrop) + 'px'],
    ['fontSize', 'Text size', 'num', parseFloat(cs.fontSize), 8, 96, 1],
    ['pad', 'Padding', 'num', parseFloat(cs.pad[0]), 0, 96, 1],
    ['radius', 'Corners', 'num', Math.min(parseFloat(cs.radius) || 0, 64), 0, 64, 1, parseFloat(cs.radius) >= 64 ? 'full' : null],
  ];
  const ctl = (id, label, type, v, min, max, step, shown) => type === 'color'
    ? `<label class="ins-row"><span>${label}</span><input type="color" data-look="${id}" value="${v}">${shown ? `<output>${shown}</output>` : ''}</label>`
    : `<label class="ins-row"><span>${label}</span><input type="range" data-look="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${shown || Math.round(v * 10) / 10}</output></label>`;
  // a picture: the part's background picture, or (for a picture itself) which picture it shows
  const bgUrl = urlOf(cs.bgImage), isImg = k.tag === 'img';
  const pic = svg ? '' : isImg
    ? `<div class="ins-sec"><h4>Picture</h4><div class="ins-pic"><span class="ins-thumb" style="background-image:url('${esc(k.cs.src || '')}')"></span><button type="button" class="ghost" data-pic="file">Choose a picture…</button></div>
       <input class="ins-text" data-pic="url" placeholder="…or paste a picture’s web address" value="${esc(part.src && !/^data:/.test(part.src.v) ? part.src.v : '')}"></div>`
    : `<div class="ins-sec"><h4>Background picture</h4><div class="ins-pic">${bgUrl ? `<span class="ins-thumb" style="background-image:url('${esc(bgUrl)}')"></span>` : '<span class="ins-thumb none">none</span>'}<button type="button" class="ghost" data-pic="file">Choose a picture…</button>${bgUrl ? '<button type="button" class="ghost" data-pic="none">Remove</button>' : ''}</div>
       <input class="ins-text" data-pic="url" placeholder="…or paste a picture’s web address" value="${esc(/^data:/.test(bgUrl) ? '' : bgUrl)}"></div>`;
  const litCtl = (x, i) => x.kind === 'color'
    ? `<label class="ins-row"><span title="${esc(x.path)}">${esc(x.path)}</span><input type="color" data-lit="${i}" value="${/^#[0-9a-f]{6}$/i.test(x.raw) ? x.raw : rgbHex(x.raw)}"></label>`
    : `<label class="ins-row"><span title="${esc(x.path)}">${esc(x.path)}</span><input type="number" data-lit="${i}" value="${esc(x.raw)}" step="any"></label>`;
  p.innerHTML = `
    <div class="ins-h"><b>${esc(k.label)}</b>${k.count > 1 ? `<span class="ins-x" title="Made in a loop: a change applies to all of them">×${k.count}</span>` : ''}
      <small>&lt;${esc(part.tag)}&gt;${part.comp ? ` in ${esc(part.comp)}` : ''}${k.count > 1 ? ' · changes all of them' : ''}${part.rule ? ` · look changes every ${esc(part.rule)}` : ''}</small></div>
    ${(k.places || []).length > 1 ? `<div class="ins-places" role="radiogroup" aria-label="What to change">${k.places.map(n => { const q = INS.map.find(x => x.n === n); if (!q) return ''; const lbl = q.use && n === k.places[0] ? `This ${q.tag}` : `Inside ${q.comp || q.tag} · everywhere`; return `<button role="radio" aria-checked="${n === part.n}" class="${n === part.n ? 'on' : ''}" data-place="${n}">${esc(lbl)}</button>`; }).join('')}</div>` : ''}
    ${part.texts.length ? `<div class="ins-sec"><h4>Words</h4>${part.texts.map((x, i) => `<input class="ins-text" data-text="${i}" value="${esc(x.v)}">`).join('')}</div>` : ''}
    ${k.cs.up ? '<button type="button" class="ghost ins-up" data-up title="Select the part around this one (↑)">↑ The part around it</button>' : ''}
    <div class="ins-sec"><h4>Look <small>→ ${where}</small></h4>${look.map(l => ctl(...l)).join('')}</div>
    ${pic}
    ${part.lits.length ? `<div class="ins-sec"><h4>From its code</h4>${part.lits.map(litCtl).join('')}</div>` : ''}
    ${sets}
    <details class="ins-sec ins-code"><summary>Show its code</summary><pre></pre></details>
    ${hist}`;
  insSets();
  if (c_kindTsx()) { const src = insSource(compById(INS.compId)).text; p.querySelector('pre').textContent = src.slice(part.s, Math.min(part.e, part.s + 600)) + (part.e - part.s > 600 ? '\n…' : ''); }
  else p.querySelector('.ins-code').remove();
  insWire(part);
}
const c_kindTsx = () => (compById(INS.compId) || {}).kind === 'tsx';
function insSets() {
  const box = INS.panel && INS.panel.querySelector('.ins-pp'), c = compById(INS.compId); if (!box || !c) return;
  const d = box.closest('details'); d.ontoggle = () => { INS.setsOpen = d.open; };
  renderPropsPanel(box, c, null, () => {
    INS.setsOpen = true; insReload();
    const lib = $('ppBox'); if (lib) renderPropsPanel(lib, c, null, () => renderCompView());   // the Library's copy shows the same values
  });
}
function insWire(part) {
  const p = INS.panel;
  const u = p.querySelector('#insUndo'), r = p.querySelector('#insRedo');
  if (u) u.onclick = () => insUndo(false); if (r) r.onclick = () => insUndo(true);
  if (!part) return;
  p.querySelectorAll('[data-place]').forEach(b => b.onclick = () => insPost({ rkInspectSelect: +b.dataset.place }));
  p.querySelectorAll('[data-text]').forEach(inp => inp.onchange = () => { const v = inp.value.trim(); if (v) insApply({ t: 'text', i: +inp.dataset.text, v }, `words → “${v.slice(0, 30)}”`); });
  // the background is one colour with a strength: the colour picker keeps the strength, the strength keeps the colour
  const bgIn = p.querySelector('[data-look="bg"]'), aIn = p.querySelector('[data-look="bgAlpha"]');
  const bgNow = () => !aIn || +aIn.value >= 100 ? bgIn.value : withAlpha(bgIn.value, +aIn.value);
  const UNIT = { bgAlpha: '%', blur: 'px' }, SAY = { bg: 'background', bgAlpha: 'background strength', blur: 'frost', radius: 'corners', pad: 'padding', fontSize: 'text size', color: 'text colour' };
  p.querySelectorAll('[data-look]').forEach(inp => {
    const prop = inp.dataset.look, out = inp.nextElementSibling;
    const edit = () => {
      // a colour picked for a part with no background starts fully solid (strength 0 would hide it)
      if (prop === 'bg' && aIn && +aIn.value === 0) { aIn.value = 100; if (aIn.nextElementSibling) aIn.nextElementSibling.textContent = '100%'; }
      return prop === 'bg' || prop === 'bgAlpha' ? { prop: 'bg', v: bgNow() } : { prop, v: inp.type === 'range' ? +inp.value : inp.value };
    };
    inp.oninput = () => {
      if (out && out.tagName === 'OUTPUT') out.textContent = inp.value + (UNIT[prop] || '');
      if (prop === 'bgAlpha' && bgIn && +inp.value > 0 && bgIn.nextElementSibling && bgIn.nextElementSibling.tagName === 'OUTPUT') bgIn.nextElementSibling.remove();
      const e = edit(); insPost({ rkInspectPreview: { n: INS.sel, css: { [CSS_KEY[e.prop]]: cssVal(e.prop, e.v), ...(e.prop === 'blur' ? { '-webkit-backdrop-filter': cssVal('blur', e.v) } : {}) } } });
    };
    inp.onchange = () => { const e = edit(); insApply({ t: 'look', prop: e.prop, v: e.v }, `${SAY[prop] || prop} → ${inp.value}${UNIT[prop] || ''}`); };
  });
  const up = p.querySelector('[data-up]'); if (up) up.onclick = () => insPost({ rkInspectUp: true });
  // pictures: from a file, a web address, or none
  const setPic = (v, what) => part.tag === 'img' || (INS.pick && INS.pick.tag === 'img') ? insApply({ t: 'src', v }, what) : insApply({ t: 'look', prop: 'bgImage', v }, what);
  const pf = p.querySelector('[data-pic="file"]'); if (pf) pf.onclick = () => pictureFile(u => setPic(u, 'picture → your file'));
  const pn = p.querySelector('[data-pic="none"]'); if (pn) pn.onclick = () => setPic('', 'background picture → none');
  const pu = p.querySelector('[data-pic="url"]'); if (pu) pu.onchange = () => { const v = pu.value.trim(); if (v) setPic(v, `picture → ${v.slice(0, 40)}`); };
  p.querySelectorAll('[data-lit]').forEach(inp => inp.onchange = () => { const x = part.lits[+inp.dataset.lit]; insApply({ t: 'lit', i: +inp.dataset.lit, v: inp.value }, `${x.path} → ${inp.value}`); });
}
addEventListener('keydown', e => {
  if (!INS.on || !INS.panel || !INS.panel.isConnected || !(e.ctrlKey || e.metaKey) || e.target.closest('input,textarea')) return;
  if (e.key.toLowerCase() === 'z') { e.preventDefault(); insUndo(e.shiftKey); }
  if (e.key.toLowerCase() === 'y') { e.preventDefault(); insUndo(true); }
});
