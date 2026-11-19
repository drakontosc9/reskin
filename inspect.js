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
};
function twToken(prop, v) {
  if (prop === 'color') return `text-[${v}]`;
  if (prop === 'bg') return `bg-[${v}]`;
  if (prop === 'fontSize') return { 12: 'text-xs', 14: 'text-sm', 16: 'text-base', 18: 'text-lg', 20: 'text-xl', 24: 'text-2xl', 30: 'text-3xl', 36: 'text-4xl', 48: 'text-5xl', 60: 'text-6xl' }[v] || `text-[${v}px]`;
  if (prop === 'radius') return v >= 999 ? 'rounded-full' : { 0: 'rounded-none', 2: 'rounded-sm', 4: 'rounded', 6: 'rounded-md', 8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl', 24: 'rounded-3xl' }[v] || `rounded-[${v}px]`;
  if (prop === 'pad') return v % 4 === 0 && v <= 64 ? `p-${v / 4}` : `p-[${v}px]`;
}
// the new class takes the old one's place, so the list still reads the way its author wrote it
function twSwap(cls, prop, v) {
  const toks = cls.split(/\s+/).filter(Boolean), at = toks.findIndex(TW_DROP[prop]), keep = toks.filter(t => !TW_DROP[prop](t));
  keep.splice(at < 0 ? keep.length : at, 0, twToken(prop, v));
  return keep.join(' ');
}
// the same edit as a style property (no classes to edit, or an SVG part)
const STYLE_KEY = { color: 'color', bg: 'backgroundColor', fontSize: 'fontSize', radius: 'borderRadius', pad: 'padding', fill: 'fill', stroke: 'stroke', strokeWidth: 'strokeWidth' };
const CSS_KEY = { color: 'color', bg: 'background-color', fontSize: 'font-size', radius: 'border-radius', pad: 'padding', fill: 'fill', stroke: 'stroke', strokeWidth: 'stroke-width' };
const PX = { fontSize: 1, radius: 1, pad: 1, strokeWidth: 1 };
const cssVal = (prop, v) => PX[prop] ? v + 'px' : v;

/* ---- edits on React source: returns the new source text, or throws a plain-words reason ---- */
function tsxEdit(text, part, ed) {
  if (ed.t === 'text') { const x = part.texts[ed.i]; return splice(text, x.s, x.e, x.q ? ed.v.replace(/["\\]/g, '\\$&') : ed.v.replace(/[{}<>]/g, m => `{'${m}'}`)); }
  if (ed.t === 'lit') { const x = part.lits[ed.i]; return splice(text, x.s, x.e, x.kind === 'num' ? String(+ed.v) : ed.v); }
  if (ed.t === 'look') {
    const svgish = /^(path|circle|line|rect|ellipse|polygon|polyline|g|svg|text)$/.test(part.tag) || /^(fill|stroke|strokeWidth)$/.test(ed.prop);
    if (!svgish && part.cls && !part.cls.dynamic) return splice(text, part.cls.s, part.cls.e, twSwap(part.cls.v, ed.prop, ed.v));
    if (!svgish && !part.cls) return splice(text, part.at, part.at, ` className="${twToken(ed.prop, ed.v)}"`);
    // write strings the way this file does ('…' or "…")
    const q = (text.match(/'/g) || []).length > (text.match(/"/g) || []).length ? "'" : '"';
    const key = STYLE_KEY[ed.prop], lit = q + String(cssVal(ed.prop, ed.v)).replace(new RegExp('[\\\\' + q + ']', 'g'), '\\$&') + q;
    if (part.style && part.style.dynamic) throw new Error('its style is worked out in code');
    if (part.style) {
      const have = part.style.props.find(p => p.k === key);
      if (have) return splice(text, have.s, have.e, lit);
      const inner = text.slice(part.style.s + 1, part.style.e - 1), body = inner.replace(/\s+$/, '');
      const at = part.style.s + 1 + body.length;
      if (!body.trim()) return splice(text, part.style.s + 1, part.style.e - 1, ` ${key}: ${lit} `);
      return splice(text, at, at, (/,$/.test(body) ? ' ' : ', ') + `${key}: ${lit}`);
    }
    return splice(text, part.at, part.at, ` style={{ ${key}: ${lit} }}`);
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
const RULE_NAMES = { color: ['color'], bg: ['background-color', 'background'], fontSize: ['font-size'], radius: ['border-radius'], pad: ['padding'], fill: ['fill'], stroke: ['stroke'], strokeWidth: ['stroke-width'] };
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
function insDoc(c) { return c.kind === 'tsx' ? tsxDoc(c.code, 'comp', typeof mountFor === 'function' ? mountFor(c) : null, { inspect: true }) : htmlInspectDoc(c.code); }
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
const rgbHex = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return /^#/.test(c || '') ? c : '#000000'; const [r, g, b] = m[1].split(/[ ,/]+/).map(Number); return '#' + [r, g, b].map(x => (x | 0).toString(16).padStart(2, '0')).join(''); };
const transparent = c => !c || /rgba\([^)]*,\s*0\)$/.test(c) || c === 'transparent' || c === 'none';
function insRender() {
  const p = INS.panel; if (!p) return;
  const part = INS.map && INS.sel != null ? INS.map.find(x => x.n === INS.sel) : null, k = INS.pick;
  const hist = `<div class="ins-hist"><button class="ghost" id="insUndo" ${INS.undo.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">↶ Undo</button><button class="ghost" id="insRedo" ${INS.redo.length ? '' : 'disabled'}>↷ Redo</button>${INS.undo.length ? `<small>${INS.undo.length} change${INS.undo.length > 1 ? 's' : ''} in its code</small>` : ''}</div>`;
  if (!INS.map) { p.innerHTML = `<div class="ins-empty"><span class="spin"></span> Reading its parts…</div>${hist}`; return insWire(null); }
  if (!part || !k) { p.innerHTML = `<div class="ins-empty"><b>Click any part</b> to change it.<br><small>Hover or Tab to see a part · Enter pins it · Esc clears · ↑ selects the part around it · Alt+click uses it normally</small><br><small>${INS.map.length} parts found</small></div>${hist}`; return insWire(null); }
  const cs = k.cs, svg = /^(path|circle|line|rect|ellipse|polygon|polyline|g|svg|text)$/.test(k.tag);
  const where = part.rule ? `its CSS rule ${part.rule}` : !c_kindTsx() ? 'its style' : part.cls && !part.cls.dynamic ? 'its classes' : part.cls ? 'its style (classes are worked out in code)' : svg ? 'its style' : 'new classes';
  const look = svg ? [
    ['fill', 'Fill', 'color', transparent(cs.fill) ? '#000000' : rgbHex(cs.fill)],
    ['stroke', 'Line colour', 'color', transparent(cs.stroke) ? '#000000' : rgbHex(cs.stroke)],
    ['strokeWidth', 'Line width', 'num', parseFloat(cs.strokeWidth) || 1, 0, 20, .5],
  ] : [
    ['color', 'Text colour', 'color', rgbHex(cs.color)],
    ['bg', 'Background', 'color', transparent(cs.bg) ? '#ffffff' : rgbHex(cs.bg)],
    ['fontSize', 'Text size', 'num', parseFloat(cs.fontSize), 8, 96, 1],
    ['pad', 'Padding', 'num', parseFloat(cs.pad[0]), 0, 96, 1],
    ['radius', 'Corners', 'num', Math.min(parseFloat(cs.radius) || 0, 64), 0, 64, 1, parseFloat(cs.radius) >= 64 ? 'full' : null],
  ];
  const ctl = (id, label, type, v, min, max, step, shown) => type === 'color'
    ? `<label class="ins-row"><span>${label}</span><input type="color" data-look="${id}" value="${v}"></label>`
    : `<label class="ins-row"><span>${label}</span><input type="range" data-look="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${shown || Math.round(v * 10) / 10}</output></label>`;
  const litCtl = (x, i) => x.kind === 'color'
    ? `<label class="ins-row"><span title="${esc(x.path)}">${esc(x.path)}</span><input type="color" data-lit="${i}" value="${/^#[0-9a-f]{6}$/i.test(x.raw) ? x.raw : rgbHex(x.raw)}"></label>`
    : `<label class="ins-row"><span title="${esc(x.path)}">${esc(x.path)}</span><input type="number" data-lit="${i}" value="${esc(x.raw)}" step="any"></label>`;
  p.innerHTML = `
    <div class="ins-h"><b>${esc(k.label)}</b>${k.count > 1 ? `<span class="ins-x" title="Made in a loop: a change applies to all of them">×${k.count}</span>` : ''}
      <small>&lt;${esc(part.tag)}&gt;${part.comp ? ` in ${esc(part.comp)}` : ''}${k.count > 1 ? ' · changes all of them' : ''}${part.rule ? ` · look changes every ${esc(part.rule)}` : ''}</small></div>
    ${(k.places || []).length > 1 ? `<div class="ins-places" role="radiogroup" aria-label="What to change">${k.places.map(n => { const q = INS.map.find(x => x.n === n); if (!q) return ''; const lbl = q.use && n === k.places[0] ? `This ${q.tag}` : `Inside ${q.comp || q.tag} · everywhere`; return `<button role="radio" aria-checked="${n === part.n}" class="${n === part.n ? 'on' : ''}" data-place="${n}">${esc(lbl)}</button>`; }).join('')}</div>` : ''}
    ${part.texts.length ? `<div class="ins-sec"><h4>Words</h4>${part.texts.map((x, i) => `<input class="ins-text" data-text="${i}" value="${esc(x.v)}">`).join('')}</div>` : ''}
    <div class="ins-sec"><h4>Look <small>→ ${where}</small></h4>${look.map(l => ctl(...l)).join('')}</div>
    ${part.lits.length ? `<div class="ins-sec"><h4>From its code</h4>${part.lits.map(litCtl).join('')}</div>` : ''}
    <details class="ins-sec ins-code"><summary>Show its code</summary><pre></pre></details>
    ${hist}`;
  if (c_kindTsx()) { const src = insSource(compById(INS.compId)).text; p.querySelector('pre').textContent = src.slice(part.s, Math.min(part.e, part.s + 600)) + (part.e - part.s > 600 ? '\n…' : ''); }
  else p.querySelector('.ins-code').remove();
  insWire(part);
}
const c_kindTsx = () => (compById(INS.compId) || {}).kind === 'tsx';
function insWire(part) {
  const p = INS.panel;
  const u = p.querySelector('#insUndo'), r = p.querySelector('#insRedo');
  if (u) u.onclick = () => insUndo(false); if (r) r.onclick = () => insUndo(true);
  if (!part) return;
  p.querySelectorAll('[data-place]').forEach(b => b.onclick = () => insPost({ rkInspectSelect: +b.dataset.place }));
  p.querySelectorAll('[data-text]').forEach(inp => inp.onchange = () => { const v = inp.value.trim(); if (v) insApply({ t: 'text', i: +inp.dataset.text, v }, `words → “${v.slice(0, 30)}”`); });
  p.querySelectorAll('[data-look]').forEach(inp => {
    const prop = inp.dataset.look, out = inp.nextElementSibling;
    inp.oninput = () => { if (out && out.tagName === 'OUTPUT') out.textContent = inp.value; insPost({ rkInspectPreview: { n: INS.sel, css: { [CSS_KEY[prop]]: cssVal(prop, inp.value) } } }); };
    inp.onchange = () => insApply({ t: 'look', prop, v: inp.type === 'range' ? +inp.value : inp.value }, `${prop} → ${inp.value}`);
  });
  p.querySelectorAll('[data-lit]').forEach(inp => inp.onchange = () => { const x = part.lits[+inp.dataset.lit]; insApply({ t: 'lit', i: +inp.dataset.lit, v: inp.value }, `${x.path} → ${inp.value}`); });
}
addEventListener('keydown', e => {
  if (!INS.on || !INS.panel || !INS.panel.isConnected || !(e.ctrlKey || e.metaKey) || e.target.closest('input,textarea')) return;
  if (e.key.toLowerCase() === 'z') { e.preventDefault(); insUndo(e.shiftKey); }
  if (e.key.toLowerCase() === 'y') { e.preventDefault(); insUndo(true); }
});
