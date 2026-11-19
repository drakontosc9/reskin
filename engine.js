/* Reskin engine: sample, content extraction, sandbox (probe / React runner / live remix), styles, renderer.
   Shared by the app (app.js) and the site builder (builder.js). */
/* =========================================================
   1. SAMPLE
   ========================================================= */
const SAMPLE = `<!DOCTYPE html>
<html>
<head><title>Northbound Coffee</title><meta name="theme-color" content="#b4532a"></head>
<body>
  <header>
    <div class="logo">Northbound Coffee</div>
    <nav>
      <a href="#beans">Beans</a>
      <a href="#lineup">Lineup</a>
      <a href="#visit">Visit</a>
      <a href="#shop" class="btn">Shop now</a>
    </nav>
  </header>

  <section class="hero">
    <p>Small-batch roasters since 2014</p>
    <h1>Coffee worth waking up for</h1>
    <p>We buy directly from farms we've visited, roast twice a week, and ship within 48 hours — so every cup tastes the way it should.</p>
    <a href="#shop" class="btn">Shop the roasts</a>
    <a href="#visit">Find our café</a>
  </section>

  <section id="beans">
    <h2>Why people switch to us</h2>
    <p>Three things we never compromise on.</p>
    <div class="features">
      <div><h3>Direct trade</h3><p>We pay farmers 2–3× the fair-trade minimum and publish every price we pay.</p></div>
      <div><h3>Roasted to order</h3><p>Every bag is dated and roasted after you order it. Nothing sits on a shelf.</p></div>
      <div><h3>Flexible subscription</h3><p>Free shipping, and you can pause, skip or swap roasts any time.</p></div>
    </div>
  </section>

  <section id="lineup">
    <h2>This month's lineup</h2>
    <ul>
      <li><strong>Ethiopia Guji</strong> — blueberry, jasmine, honey</li>
      <li><strong>Colombia Huila</strong> — red apple, caramel, cocoa</li>
      <li><strong>Kenya Nyeri</strong> — blackcurrant, grapefruit, cane sugar</li>
      <li><strong>House Espresso</strong> — chocolate, hazelnut, cherry</li>
    </ul>
  </section>

  <section>
    <blockquote>The best coffee subscription I've tried. It's the one thing I look forward to every other Tuesday.<cite>Maya R., subscriber since 2019</cite></blockquote>
  </section>

  <section id="visit">
    <h2>Come say hi</h2>
    <p>Our café and roastery is open daily 7am–5pm at 210 Harbor Street. Pull up a chair and watch us roast.</p>
    <a href="#map" class="btn">Get directions</a>
  </section>

  <footer>
    <p>© 2026 Northbound Coffee Co. · Roasted in Portland</p>
    <nav><a href="#">Instagram</a> <a href="#">Wholesale</a> <a href="#">Contact</a></nav>
  </footer>
</body>
</html>`;

/* =========================================================
   2. EXTRACT CONTENT  (HTML -> plain content model)
   ========================================================= */
const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const INLINE = new Set(['SPAN','STRONG','EM','B','I','A','SMALL','BR','CODE','MARK','U','SUP','SUB','TIME','ABBR','LABEL']);
const isBtn = a => /btn|button|cta/i.test(typeof a.className === 'string' ? a.className : '') || a.tagName === 'BUTTON';

function extract(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // forms first, while their fields are still here: a <form>, or (apps often skip the tag) any group of 2+ fields with a button.
  // Each field is named by its label, so "Project idea · Target users · Difficulty" survives the restyle.
  const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]),textarea,select';
  const fieldName = f => {
    const id = f.getAttribute('id'), byFor = id && doc.querySelector(`label[for="${CSS.escape(id)}"]`), wrap = f.closest('label');
    let prev = f.previousElementSibling; while (prev && !clean(prev.textContent)) prev = prev.previousElementSibling;
    const lab = byFor || wrap || (prev && /^(LABEL|SPAN|P|DIV|STRONG|B)$/.test(prev.tagName) && clean(prev.textContent).length <= 40 ? prev : null) || (f.parentElement && f.parentElement.querySelector('label'));
    const t = (lab ? clean(lab.textContent.replace(f.tagName === 'SELECT' ? f.textContent : '', '')) : '') || f.getAttribute('placeholder') || f.getAttribute('aria-label') || f.name || 'Your answer';
    return t.slice(0, 40);
  };
  const markForm = (box, fields) => {
    box.setAttribute('data-rk-form', JSON.stringify(fields.map(fieldName).slice(0, 6)));
    fields.forEach(f => { const l = f.id && doc.querySelector(`label[for="${CSS.escape(f.id)}"]`); if (l) l.setAttribute('data-rk-label', ''); const w = f.closest('label'); if (w) w.setAttribute('data-rk-label', ''); });
  };
  if (doc.body) {
    // pop-ups, dialogs and drawers (newsletter modals, cart drawers, search overlays) aren't the page's content
    const aside = el => el.closest('dialog,[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="popup"],[class*="drawer"],[class*="overlay"],[class*="search"],[class*="cart"]');
    doc.querySelectorAll('form').forEach(fm => { if (aside(fm)) { fm.setAttribute('data-rk-skip', ''); return; } const fs = [...fm.querySelectorAll(FIELD)]; markForm(fm, fs); });
    const loose = [...doc.body.querySelectorAll(FIELD)].filter(f => !f.closest('form') && !aside(f));
    if (loose.length >= 2) {
      let box = loose[0].parentElement; while (box && box !== doc.body && !loose.every(f => box.contains(f))) box = box.parentElement;
      if (box && box !== doc.body) { while (!box.querySelector('button,[type=submit]') && box.parentElement && box.parentElement !== doc.body) box = box.parentElement; markForm(box, loose.filter(f => box.contains(f))); }
    }
  }
  doc.querySelectorAll('script,style,noscript,template,iframe,svg,canvas,link,meta,select,video,audio,pre,textarea').forEach(e => e.remove());
  const m = { title: clean(doc.title), brand: '', logo: null, images: [], nav: [], navCta: null, footer: '', footerLinks: [], hero: null, sections: [] };
  // a page isn't rendered here, so separate boxes' words would run together ("Original BlackSmooth…"): space them
  if (doc.body) doc.body.querySelectorAll('*').forEach(e => { if (e.tagName === 'BR') e.replaceWith(' '); else if (!INLINE.has(e.tagName) && e.firstChild) e.append(' '); });

  // every image on the page (for the Advanced tab), before anything is removed
  const seen = new Set();
  const addImg = (src, alt) => { if (!src || seen.has(src) || m.images.length >= 80) return; seen.add(src); m.images.push({ src, alt: alt || '' }); };
  doc.querySelectorAll('img[src]').forEach(i => addImg(i.getAttribute('src'), i.alt));
  doc.querySelectorAll('[style*="url("]').forEach(e => { const u = /url\(\s*['"]?([^'")]+)/.exec(e.getAttribute('style')); if (u && !/^#/.test(u[1])) addImg(u[1], ''); });

  const LOGO_SEL = '.logo,.brand,.site-title,[class*="logo"],[class*="brand"],nav strong,header strong';
  const ownLogo = el => !/logos\b|partner|client|sponsor|press|featured/i.test(typeof el.className === 'string' ? el.className : '') && el.querySelectorAll('img').length <= 1 && !el.closest('[class*="logos"],[class*="partner"],[class*="client"],[class*="marquee"],footer');
  const logo = [...doc.querySelectorAll(`header :is(${LOGO_SEL}),nav :is(${LOGO_SEL}),:is(${LOGO_SEL})[href="/"],a[href="/"] :is(${LOGO_SEL})`)].find(ownLogo) || [...doc.querySelectorAll(LOGO_SEL)].find(ownLogo) || null;
  m.brand = logo ? clean(logo.textContent) : '';
  const logoImg = logo && (logo.tagName === 'IMG' ? logo : logo.querySelector('img'));
  if (logoImg && logoImg.getAttribute('src')) m.logo = { src: logoImg.getAttribute('src'), alt: logoImg.alt || '' };
  if (!m.brand && logoImg) m.brand = logoImg.alt;
  // the link back to the home page usually *is* the brand: its words, its picture's alt, or its label
  const firstHead = doc.querySelector('h1,h2');
  const home = [...doc.querySelectorAll('a[href="/"],a[href="./"],a[href="#"][class*="logo"],a[href="index.html"]')].find(a => !a.closest('footer') && (!firstHead || a.compareDocumentPosition(firstHead) & Node.DOCUMENT_POSITION_FOLLOWING));
  if (home) {
    const im = home.querySelector('img'), hn = clean(home.textContent) || (im && clean(im.alt)) || clean(home.getAttribute('aria-label') || home.getAttribute('title') || '');
    const name = hn.replace(/\s*(home( ?page)?|go to home(page)?)\s*$/i, '').replace(/^(home|go to)\s+/i, '').trim();
    if (name.length >= 2 && name.length <= 40 && !/^home$/i.test(name)) m.brand = name;
  }
  if (m.brand.length > 40) m.brand = '';
  const declared = doc.querySelector('meta[property="og:site_name"],meta[name="application-name"],meta[name="apple-mobile-web-app-title"]');
  if (declared && clean(declared.getAttribute('content')).length >= 2 && clean(declared.getAttribute('content')).length <= 40 && (!m.brand || !home)) m.brand = clean(declared.getAttribute('content'));
  if (!m.brand) {   // "Raw Local Honey in Rochester | Nettie's Bees": the short part is the name
    const parts = (m.title || '').split(/\s*[|–—·]\s*|:\s+|\s+-\s+/).map(clean).filter(Boolean);
    m.brand = parts.length > 1 ? parts.reduce((a, b) => b.length < a.length ? b : a) : (parts[0] || '');
  }

  const footer = doc.querySelector('footer');
  if (footer) {
    footer.querySelectorAll('a').forEach(a => { const t = clean(a.textContent); if (t && m.footerLinks.length < 6) m.footerLinks.push({ text: t, href: a.getAttribute('href') || '#' }); });
    const p = footer.querySelector('p');
    m.footer = clean(p ? p.textContent : footer.textContent).slice(0, 200);
    footer.remove();
  }

  // nav: the menu with the most real page links — a <nav>, a header, a menu overlay, a sidebar, or just a cluster
  // of short links at the top of the page (sites built without a <nav>)
  const UTIL = /^((search|cart|bag|basket|wishlist|account|log ?in|sign ?in|menu|close|open menu|toggle|skip to( content)?|navigation menu|your shopping bag|privacy policy)\b.*|[\d\s()]+)$/i;
  const linkText = a => {   // what the link says: without hover duplicates (aria-hidden copies), else its label
    const c = a.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove());
    // two labels side by side with no words of their own ("Let's talk" + "Say hi" on hover): the first is the link
    let box = c, own, parts;
    for (let d = 0; d < 4; d++) {
      own = [...box.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()); parts = [...box.children].filter(x => clean(x.textContent));
      if (own || parts.length !== 1) break; box = parts[0];
    }
    let t = (!own && parts.length >= 2 && parts.every(x => !x.querySelector('a'))) ? clean(parts[0].textContent) : clean(c.textContent);
    t = t || clean(a.getAttribute('aria-label') || a.getAttribute('title') || '');
    const w = t.split(' '), h = w.length / 2;   // "Search Search", "Shop Shop": the same words twice (rolling-text effects)
    if (w.length > 1 && w.length % 2 === 0 && w.slice(0, h).join(' ') === w.slice(h).join(' ')) t = w.slice(0, h).join(' ');
    return t;
  };
  const navLinks = el => {
    const seen = new Set(), out = [];
    el.querySelectorAll('a[href]').forEach(a => {
      const t = linkText(a); if (!t || t.length > 30 || a === home || t === m.brand || (m.brand && t.startsWith(m.brand)) || UTIL.test(t) || seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase()); out.push({ a, t });
    });
    return out;
  };
  const inFooter = el => !!el.closest('footer,[class*="footer"],[id*="footer"]');
  const cands = [...doc.querySelectorAll('nav,header,[role="navigation"],[class*="menu"],[class*="nav"],[id*="menu"],[id*="nav"],[class*="drawer"],[class*="sidebar"],aside')].filter(el => !inFooter(el) && el !== doc.body);
  let navEl = null, best = 1;
  // real menus (<nav>, role=navigation, the header) count extra; a container with dozens of links is a page, not a menu
  cands.forEach(el => { const n = navLinks(el).length, sc = n + (el.matches('nav,[role="navigation"],header') ? 3 : 0); if (n >= 2 && n <= 40 && sc > best) { best = sc; navEl = el; } });
  if (!navEl) {   // no menu element: the first container near the top holding 3+ short links
    const firstHead = doc.querySelector('h1,h2');
    navEl = [...doc.body.querySelectorAll('div,ul')].find(el => !inFooter(el) && navLinks(el).length >= 3 && navLinks(el).length <= 10 && (!firstHead || el.compareDocumentPosition(firstHead) & Node.DOCUMENT_POSITION_FOLLOWING) && !el.querySelector('h1,h2,h3,p')) || null;
  }
  if (navEl) {
    navLinks(navEl).forEach(({ a, t }) => {
      const item = { text: t, href: a.getAttribute('href') || '#' };
      if (isBtn(a) && a.tagName === 'A' && !m.navCta) m.navCta = item; else if (m.nav.length < 7) m.nav.push(item);
    });
    // a "book now" style button elsewhere in the header is the call to action
    if (!m.navCta) { const h = doc.querySelector('header'); const b = h && [...h.querySelectorAll('a[href]')].find(a => a !== navEl && !navEl.contains(a) && linkText(a) && linkText(a).length < 24 && !UTIL.test(linkText(a)) && linkText(a) !== m.brand); if (b) m.navCta = { text: linkText(b), href: b.getAttribute('href') || '#' }; }
    m.nav = m.nav.filter(n => !m.navCta || n.text !== m.navCta.text);
    if (!navEl.querySelector('h1,h2') ) navEl.remove();
    doc.querySelectorAll('nav').forEach(n => { if (!inFooter(n) && !n.querySelector('h1,h2')) n.remove(); });
  }
  if (logo && logo.isConnected) logo.remove();
  // a logo set as a heading (<h1 class="logo">Brand</h1>) isn't the page's title
  // …only when the page has a title of its own elsewhere (on a one-screen app, the brand heading *is* the title)
  doc.querySelectorAll('header h1,header h2,a[href="/"] h1,h1 a[href="/"]').forEach(h => {
    const hh = h.closest('h1,h2') || h; if (!hh.isConnected || clean(hh.textContent) !== m.brand) return;
    const other = [...doc.querySelectorAll('h1')].some(x => x !== hh && !hh.contains(x) && clean(x.textContent) && clean(x.textContent) !== m.brand);
    if (other) hh.remove();
  });

  const blocks = [];
  const push = b => blocks.push(b);
  const listItem = li => {
    const first = li.querySelector('strong,b,h3,h4');
    const all = clean(li.textContent);
    if (first && all.startsWith(clean(first.textContent)) && all.length > clean(first.textContent).length + 1) {
      const t = clean(first.textContent);
      return { title: t, text: all.slice(t.length).replace(/^[\s:—–-]+/, '') };
    }
    return { title: '', text: all };
  };
  function walk(el) {
    for (const c of el.children) {
      const t = c.tagName, txt = clean(c.textContent);
      if (/^H[1-6]$/.test(t)) { if (txt) push({ t: 'h', lvl: +t[1], text: txt, id: c.id || '' }); }
      else if (t === 'P') {
        const links = [...c.querySelectorAll('a,button')];
        c.querySelectorAll('img').forEach(i => i.getAttribute('src') && push({ t: 'img', src: i.getAttribute('src'), alt: i.alt }));
        if (links.length && clean(links.map(a => a.textContent).join(' ')) === txt) links.forEach(a => push({ t: 'btn', text: clean(a.textContent), href: a.getAttribute('href') || '#' }));
        else if (txt) push({ t: 'p', text: txt });
      }
      else if (t === 'UL' || t === 'OL' || t === 'DL') {
        const items = t === 'DL' ? [...c.querySelectorAll('dt')].map(dt => ({ title: clean(dt.textContent), text: clean(dt.nextElementSibling?.textContent) }))
                                 : [...c.children].filter(li => li.tagName === 'LI').map(listItem).filter(i => i.text || i.title);
        if (items.length) push({ t: 'list', items: items.slice(0, 12) });
      }
      else if (t === 'TABLE') {
        const items = [...c.querySelectorAll('tr')].map(tr => [...tr.children].map(td => clean(td.textContent)).filter(Boolean))
          .filter(r => r.length).map(r => ({ title: r[0], text: r.slice(1).join(' · ') }));
        if (items.length) push({ t: 'list', items: items.slice(0, 12) });
      }
      else if (t === 'IMG') { const s = c.getAttribute('src'); if (s && !/\.svg($|\?)/i.test(s)) push({ t: 'img', src: s, alt: c.alt }); }
      else if (t === 'PICTURE') { const i = c.querySelector('img'); if (i) push({ t: 'img', src: i.getAttribute('src'), alt: i.alt }); }
      else if (t === 'BLOCKQUOTE') {
        const cite = c.querySelector('cite,footer,figcaption'); const ct = cite ? clean(cite.textContent) : '';
        if (cite) cite.remove();
        push({ t: 'quote', text: clean(c.textContent).replace(/^["“]|["”]$/g, ''), cite: ct.replace(/^[—–-]\s*/, '') });
      }
      else if (t === 'FORM' || c.hasAttribute('data-rk-form')) {
        let fields = []; try { fields = JSON.parse(c.getAttribute('data-rk-form') || '[]'); } catch {}
        // the button that sends it: a submit, else the last button with words (custom dropdowns are wordless buttons too)
        if (c.hasAttribute('data-rk-skip')) continue;
        const bs = [...c.querySelectorAll('button,[type=submit]')].filter(b => (clean(b.textContent) || b.value) && !/^(close|cancel|dismiss|no thanks|×|x)$/i.test(clean(b.textContent) || b.value));
        let sub = bs.find(b => b.getAttribute('type') === 'submit') || bs[bs.length - 1] || null;
        if (!sub) {   // apps often put the button just after the form
          const nx = c.nextElementSibling, b = nx && (nx.matches('button,a[role=button],[type=submit]') ? nx : nx.children.length <= 2 && nx.querySelector('button'));
          if (b && clean(b.textContent).length <= 30) { sub = b; b.remove(); }
        }
        // the form's own heading or intro still comes along; its field labels don't become headings
        c.querySelectorAll('[data-rk-label],label').forEach(l => l.remove());
        if (sub) sub.setAttribute('data-rk-submit', '');
        if (c.querySelector('h1,h2,h3,h4,p')) { const keep = sub && sub.parentNode; if (sub) sub.remove(); walk(c); if (sub && keep) keep.appendChild(sub); }
        push({ t: 'form', fields: fields.length ? fields : ['Email address'], submit: sub ? (clean(sub.textContent) || sub.value || 'Submit') : 'Submit' });
      }
      else if (t === 'A' || t === 'BUTTON') {
        if (c.querySelector('h1,h2,h3,h4,h5,p,img,div')) walk(c);
        else if (txt && txt.length < 40) push({ t: 'btn', text: txt, href: c.getAttribute('href') || '#' });
      }
      else if (/^(INPUT|HR|BR|OPTION)$/.test(t)) {}
      else {
        const sec = /^(SECTION|ARTICLE|MAIN|ASIDE)$/.test(t);
        if (sec) push({ t: 'break', id: c.id || '' });
        const kids = [...c.children];
        if (!kids.length) { if (txt) push({ t: 'p', text: txt }); }
        else if (kids.every(k => INLINE.has(k.tagName))) {
          // a row of short links is buttons; a link holding a whole card's words is content
          if (kids.every(k => k.tagName === 'A' || k.tagName === 'BR') && kids.every(k => k.tagName !== 'A' || clean(k.textContent).length < 40)) kids.filter(k => k.tagName === 'A').forEach(a => push({ t: 'btn', text: clean(a.textContent), href: a.getAttribute('href') || '#' }));
          else if (txt) push({ t: 'p', text: txt });
        }
        else walk(c);
        if (sec) push({ t: 'break' });
      }
    }
  }
  walk(doc.body);

  let i0 = blocks.findIndex(b => b.t === 'h' && b.lvl === 1);
  if (i0 < 0) i0 = blocks.findIndex(b => b.t === 'h');
  const hero = { eyebrow: '', title: '', paras: [], buttons: [], img: null };
  let rest;
  if (i0 >= 0) {
    hero.title = blocks[i0].text;
    blocks.slice(0, i0).forEach(b => {
      if (b.t === 'p' && !hero.eyebrow && b.text.length < 60) hero.eyebrow = b.text;
      else if (b.t === 'p' && hero.paras.length < 2) hero.paras.push(b.text);
      else if (b.t === 'img' && !hero.img) hero.img = b;
      else if (b.t === 'btn' && hero.buttons.length < 3) hero.buttons.push(b);
    });
    let j = i0 + 1;
    for (; j < blocks.length; j++) {
      const b = blocks[j];
      if (b.t === 'h' || (b.t === 'break' && (hero.paras.length || hero.buttons.length))) break;
      if (b.t === 'p') hero.paras.push(b.text);
      else if (b.t === 'btn') hero.buttons.push(b);
      else if (b.t === 'img' && !hero.img) hero.img = b;
      else if (b.t !== 'break') break;
    }
    rest = blocks.slice(j);
  } else {
    hero.title = m.brand || 'Welcome';
    rest = blocks;
  }
  m.hero = hero;

  const lvls = rest.filter(b => b.t === 'h').map(b => b.lvl);
  const secLvl = lvls.length ? Math.min(...lvls) : 2;
  const newSec = () => ({ title: '', intro: [], cards: [], lists: [], imgs: [], quotes: [], buttons: [], forms: [] });
  const empty = s => !s.title && !s.intro.length && !s.cards.length && !s.lists.length && !s.imgs.length && !s.quotes.length && !s.buttons.length && !s.forms.length;
  let cur = newSec(), card = null;
  const flush = () => { if (!empty(cur)) m.sections.push(cur); cur = newSec(); card = null; };
  for (const b of rest) {
    if (b.t === 'break') { const keep = empty(cur) ? cur.id : ''; flush(); if (b.id || keep) cur.id = b.id || keep; continue; }
    if (b.t === 'h' && b.lvl <= secLvl) { const keep = empty(cur) ? cur.id : ''; flush(); cur.title = b.text; cur.id = b.id || keep || ''; continue; }
    if (b.t === 'h') { card = { title: b.text, text: [], img: null, buttons: [] }; cur.cards.push(card); continue; }
    if (card) {
      if (b.t === 'p') { if (card.text.length < 3) card.text.push(b.text); continue; }
      if (b.t === 'img' && !card.img) { card.img = b; continue; }
      if (b.t === 'btn') { card.buttons.push(b); continue; }
      if (b.t === 'list') { card.text.push(b.items.map(i => [i.title, i.text].filter(Boolean).join(' ')).join(' · ')); continue; }
    }
    if (b.t === 'p') cur.intro.push(b.text);
    else if (b.t === 'img') cur.imgs.push(b);
    else if (b.t === 'list') cur.lists.push(...b.items);
    else if (b.t === 'quote') cur.quotes.push(b);
    else if (b.t === 'btn') cur.buttons.push(b);
    else if (b.t === 'form') cur.forms.push(b);
  }
  flush();

  m.sections = m.sections.slice(0, 14);
  m.sections.forEach(s => {
    s.intro = s.intro.slice(0, 4); s.cards = s.cards.slice(0, 9); s.imgs = s.imgs.slice(0, 8); s.buttons = s.buttons.slice(0, 3);
    if (s.cards.length) s.kind = 'cards';
    else if (s.quotes.length && !s.lists.length && s.intro.length <= 1) s.kind = 'quote';
    else if (!s.lists.length && s.imgs.length < 2 && (s.buttons.length || s.forms.length) && s.intro.length <= 2) s.kind = 'cta';
    else if (s.imgs.length >= 2 && s.intro.length <= 2 && !s.lists.length) s.kind = 'gallery';
    else s.kind = 'text';
  });
  if (!m.brand) m.brand = hero.title.split(' ').slice(0, 3).join(' ');
  return m;
}

/* =========================================================
   3. SANDBOX: render any page / React component safely and measure it
   ---------------------------------------------------------
   Pages run in <iframe sandbox="allow-scripts"> (opaque origin: they can't
   touch this app). A probe script inside measures the rendered result and
   posts back { html, tokens }.
   ========================================================= */

// Runs INSIDE the sandbox. Serialised with Function.toString().
function __probe(ID, AUTO, MAX) {
  var sent = false;
  // ---- motion: which elements rewrite their own text (typewriter / scramble), and how
  var TXT = [], txtMap = new Map();
  try {
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        var el = m.type === 'characterData' ? m.target.parentElement : m.target;
        if (!el || el.nodeType !== 1 || /^(SCRIPT|STYLE|HEAD|TITLE)$/.test(el.tagName)) return;
        var host = el.closest('h1,h2,h3,p,span,div') || el, rec = txtMap.get(host);
        if (!rec) { rec = { el: host, n: 0, lens: [] }; txtMap.set(host, rec); TXT.push(rec); }
        rec.n++; if (rec.lens.length < 60) rec.lens.push((host.textContent || '').length);
      });
    }).observe(document.documentElement, { subtree: true, characterData: true, childList: true });
  } catch (e) {}
  function readMotion() {
    var items = [], all = document.body ? document.body.getElementsByTagName('*') : [], N = Math.min(all.length, 5000);
    var sheetsTxt = [], kf = {}, hover = { lift: 0, grow: 0, glow: 0, color: 0, underline: 0, sel: [] };
    function walk(rules) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.type === 7) kf[r.name] = r.cssText;
        else if (r.type === 1 && /:hover/.test(r.selectorText)) {
          var c = r.style.cssText;
          if (/transform:[^;]*translate(Y|3d)?\(\s*-/.test(c)) hover.lift++;
          else if (/transform:[^;]*scale/.test(c)) hover.grow++;
          if (/box-shadow|filter:[^;]*(drop-shadow|brightness)/.test(c)) hover.glow++;
          if (/(^|;\s*)(background|color|border-color)/.test(c)) hover.color++;
          if (/text-decoration|background-size/.test(c)) hover.underline++;
          if (hover.sel.length < 4 && /transform|shadow/.test(c)) hover.sel.push(r.selectorText.slice(0, 60));
        } else if (r.cssRules) walk(r.cssRules);
      }
    }
    for (var si = 0; si < document.styleSheets.length; si++) { try { walk(document.styleSheets[si].cssRules); } catch (e) {} }
    // keyframes actually in use, and what they do
    var used = {}, eases = {}, durs = [];
    for (var i = 0; i < N; i++) {
      var cs = getComputedStyle(all[i]), an = cs.animationName;
      if (an && an !== 'none') an.split(',').forEach(function (n, j) {
        n = n.trim(); var u = used[n] || (used[n] = { n: 0, inf: false, dur: 0, steps: false, tags: {} });
        u.n++; u.tags[all[i].tagName.toLowerCase()] = 1;
        if (/infinite/.test(cs.animationIterationCount)) u.inf = true;
        u.dur = parseFloat((cs.animationDuration.split(',')[j] || cs.animationDuration)) * 1000;
        if (/steps/.test(cs.animationTimingFunction)) u.steps = true;
      });
      var tr = cs.transitionDuration;
      if (tr && tr !== '0s' && /^(A|BUTTON)$/.test(all[i].tagName)) { durs.push(parseFloat(tr) * 1000); var e = cs.transitionTimingFunction.split(',')[0]; eases[e] = (eases[e] || 0) + 1; }
    }
    function kind(txt, u) {
      if (/translateX\(\s*-?(50|100)%/.test(txt) && u.inf) return ['marquee', 'Things slide past in an endless loop (marquee)'];
      if (u.steps && /width/.test(txt)) return ['typewriter', 'Text types itself out (CSS steps)'];
      if (u.steps || (/opacity/.test(txt) && u.inf && u.dur <= 1500)) return ['blink', 'A blinking caret or pulse'];
      if (/blur/.test(txt) && /opacity/.test(txt)) return ['blur-in', 'Things sharpen into view (blur + fade)'];
      if (/opacity:\s*0/.test(txt) && /translate/.test(txt)) return ['fade-up', 'Things fade in while sliding into place'];
      if (/clip-path|inset\(/.test(txt)) return ['wipe', 'Things are revealed by a wipe (clip-path)'];
      if (/rotate\(\s*(360deg|1turn)/.test(txt)) return ['spin', 'Something spins'];
      if (/background-position/.test(txt)) return ['flow', 'A gradient or shine flows across'];
      if (/scale/.test(txt) && u.inf) return ['pulse', 'Something gently pulses'];
      if (/scale/.test(txt)) return ['zoom', 'Things grow into view (scale)'];
      if (/opacity/.test(txt)) return ['fade', 'Things fade in'];
      return ['custom', 'A custom animation'];
    }
    Object.keys(used).forEach(function (n) {
      var u = used[n], k = kind(kf[n] || '', u);
      items.push({ kind: k[0], title: k[1], how: 'CSS @keyframes “' + n + '” on ' + u.n + ' element' + (u.n > 1 ? 's' : '') + ' (' + Object.keys(u.tags).slice(0, 3).join(', ') + '), ' + Math.round(u.dur) + ' ms' + (u.inf ? ', looping' : ''), tech: 'css' });
    });
    // headings split into letters / words (each piece animates on its own)
    var splits = 0;
    for (var i = 0; i < N && splits < 3; i++) {
      var el = all[i], ch = el.children; if (ch.length < 5 || /^(UL|OL|NAV|SELECT|TBODY|TR|svg)$/i.test(el.tagName)) continue;
      var one = 0, words = 0;
      for (var j = 0; j < ch.length; j++) { var t = (ch[j].textContent || '').trim(); if (!ch[j].children.length && t.length === 1) one++; else if (t && !/\s/.test(t) && t.length <= 16) words++; }
      var letters = one / ch.length > 0.7, wsplit = !letters && words / ch.length > 0.8 && /^(H1|H2|H3|P|SPAN|DIV)$/.test(el.tagName) && (el.textContent || '').trim().split(/\s+/).length >= 3;
      if (!letters && !wsplit) continue;
      var a = getComputedStyle(ch[0]), b = getComputedStyle(ch[Math.min(2, ch.length - 1)]);
      var d0 = parseFloat(a.animationDelay) || parseFloat(a.transitionDelay) || 0, d2 = parseFloat(b.animationDelay) || parseFloat(b.transitionDelay) || 0;
      var step = Math.round((d2 - d0) * 1000 / Math.min(2, ch.length - 1)), js = /opacity|transform/.test(ch[0].getAttribute('style') || '');
      var vars = /--(char-)?(index|i)\b/.test((ch[0].getAttribute('style') || '') + ' ' + (ch[1].getAttribute('style') || ''));
      items.push({ kind: letters ? 'split-letters' : 'split-words', title: letters ? 'The heading arrives letter by letter' : 'The heading arrives word by word',
        how: 'The ' + el.tagName.toLowerCase() + ' “' + (el.textContent || '').trim().slice(0, 30) + '” is split into ' + ch.length + (letters ? ' letter' : ' word') + ' pieces' + (step > 0 ? ', each ' + step + ' ms after the last' : '') + (js ? ' — moved by JavaScript' : vars ? ' — staggered with a CSS index variable' : ' — staggered in CSS'),
        tech: js ? 'js' : 'css', step: step > 0 ? step : 35, letters: letters });
      splits++;
    }
    // text that rewrites itself
    TXT.filter(function (r) { return r.n >= 6 && r.el.isConnected && (r.el.textContent || '').trim(); }).sort(function (x, y) { return y.n - x.n; }).slice(0, 2).forEach(function (r) {
      var grow = 0; for (var i = 1; i < r.lens.length; i++) if (r.lens[i] >= r.lens[i - 1]) grow++;
      var typing = grow >= (r.lens.length - 1) * 0.8 && r.lens[r.lens.length - 1] > r.lens[0];
      items.push({ kind: typing ? 'typewriter' : 'scramble', title: typing ? 'Text types itself out' : 'Text scrambles before it settles',
        how: 'JavaScript rewrote “' + (r.el.textContent || '').trim().slice(0, 30) + '” ' + r.n + ' times while the page loaded', tech: 'js', tag: r.el.tagName.toLowerCase() });
    });
    // waiting to reveal on scroll
    var hidden = 0;
    for (var i = 0; i < N; i++) { var rr = all[i].getBoundingClientRect(); if (rr.top > innerHeight && rr.height > 20) { var c2 = getComputedStyle(all[i]); if (c2.opacity === '0' || (c2.transform !== 'none' && /^matrix\(1, 0, 0, 1, 0, [1-9]/.test(c2.transform))) hidden++; } }
    // the page's own code — not Reskin's probe and runners, whose source names every library it looks for
    var code = ''; Array.prototype.forEach.call(document.scripts, function (sc) {
      var t = sc.textContent || '';
      if (/__reskin|readMotion|__rkMount|__rkElem|__rkStudio|__transplant/.test(t)) return;
      if (code.length < 4e6) code += (sc.src || '') + '\n' + t.slice(0, 2e6);
    });
    // libraries announce themselves as globals once loaded (bundled sites hide their names in file names)
    var G = window, glob = [['GSAP', G.gsap || G.TweenMax], ['ScrollTrigger', G.ScrollTrigger], ['Lenis smooth scroll', G.Lenis || G.lenis || document.documentElement.classList.contains('lenis')], ['three.js', G.THREE], ['Lottie', G.lottie || G.bodymovin], ['Swiper', G.Swiper], ['AOS', G.AOS], ['Locomotive Scroll', G.LocomotiveScroll || document.querySelector('[data-scroll-container]')], ['Barba page transitions', G.barba], ['Webflow interactions', G.Webflow || document.documentElement.hasAttribute('data-wf-page')]];
    var libs = [];
    [['GSAP', /gsap|TweenMax|ScrollTrigger/], ['Framer Motion', /framer-motion|whileInView|AnimatePresence|useMotionValue/], ['Lenis smooth scroll', /lenis/i], ['AOS', /AOS\.init|data-aos/],
     ['three.js', /THREE\.|WebGLRenderer/], ['Lottie', /lottie|bodymovin/i], ['Typed.js', /new Typed\(/], ['Splitting / SplitText', /Splitting\(|SplitText/], ['Swiper', /swiper/i], ['anime.js', /anime\(\{/]]
      .forEach(function (l) { if (l[1].test(code) || (l[0] === 'AOS' && document.querySelector('[data-aos]'))) libs.push(l[0]); });
    glob.forEach(function (g) { if (g[1] && libs.indexOf(g[0]) < 0 && !(g[0] === 'ScrollTrigger' && libs.indexOf('GSAP') < 0 && !G.gsap)) libs.push(g[0]); });
    if (hidden >= 2 || /IntersectionObserver|whileInView|ScrollTrigger|data-aos/.test(code)) items.push({ kind: 'reveal', title: 'Things fade or slide in as you scroll', how: (hidden ? hidden + ' parts wait off-screen, hidden' : 'Watches the scroll position') + (/IntersectionObserver/.test(code) ? ' (IntersectionObserver)' : '') + (/ScrollTrigger/.test(code) ? ' (GSAP ScrollTrigger)' : ''), tech: 'js' });
    if (document.querySelector('canvas') && document.querySelector('canvas').getBoundingClientRect().width > innerWidth * 0.5) items.push({ kind: 'canvas', title: 'An animated background is drawn live', how: 'A full-width <canvas>' + (/webgl/i.test(code) ? ' using WebGL' : ''), tech: 'js' });
    if (/mousemove|pointermove/.test(code)) items.push({ kind: 'pointer', title: 'Things react to your mouse', how: 'Listens to pointer movement (tilt, follow or spotlight effects)', tech: 'js' });
    if (hover.lift + hover.grow + hover.glow > 0) items.push({ kind: 'hover', title: hover.lift >= hover.grow ? 'Buttons and cards lift when you point at them' : 'Things grow when you point at them', how: (hover.lift + hover.grow) + ' hover rules move or scale things' + (hover.glow ? ', ' + hover.glow + ' add a glow or shadow' : '') + (hover.sel.length ? ' — e.g. ' + hover.sel.join(', ') : ''), tech: 'css' });
    if (getComputedStyle(document.documentElement).scrollBehavior === 'smooth' || libs.indexOf('Lenis smooth scroll') >= 0) items.push({ kind: 'smooth', title: 'Scrolling glides', how: libs.indexOf('Lenis smooth scroll') >= 0 ? 'Lenis smooth-scroll library' : 'CSS scroll-behavior: smooth', tech: 'css' });
    var ease = Object.keys(eases).sort(function (a, b) { return eases[b] - eases[a]; })[0] || null;
    durs.sort(function (a, b) { return a - b; });
    return { items: items, libs: libs, ease: ease, dur: durs.length ? Math.round(durs[durs.length >> 1]) : null, hover: hover.lift ? 'lift' : hover.grow ? 'grow' : hover.glow ? 'glow' : hover.color ? 'color' : null };
  }
  function post(p) { if (sent) return; sent = true; p.__reskin = ID; try { parent.postMessage(p, '*'); } catch (e) {} }
  window.__reskinFail = function (msg) { post({ error: String(msg) }); };
  function collect() { try { post(measure()); } catch (e) { post({ error: 'Could not measure the page: ' + e.message }); } }
  function measure() {
    var W = innerWidth, H = innerHeight;
    var cv = document.createElement('canvas'); cv.width = cv.height = 1;
    var cx = cv.getContext('2d', { willReadFrequently: true }), memo = {};
    function rgb(c) {
      if (!c || c === 'transparent' || c === 'none') return null;
      if (memo[c] !== undefined) return memo[c];
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
      var d = cx.getImageData(0, 0, 1, 1).data;
      return (memo[c] = d[3] < 10 ? null : [d[0], d[1], d[2], +(d[3] / 255).toFixed(2)]);
    }
    function key(c) { return c[0] + ',' + c[1] + ',' + c[2]; }
    function chroma(c) { return (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255; }
    function dist(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }
    function lum(c) { function f(v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); } return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); }
    function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
    function T() { var m = {}; return { add: function (k, w, v) { if (!m[k]) m[k] = { w: 0, v: v }; m[k].w += w; }, list: function () { return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.w - a.w; }); } }; }
    var cache = new Map();
    function S(el) { var s = cache.get(el); if (!s) { s = getComputedStyle(el); cache.set(el, s); } return s; }
    function box(el) {
      var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > 4000 || r.right < 0 || r.left > W) return null;
      var s = S(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.05) return null; return r;
    }
    function bgOf(el) { while (el && el.nodeType === 1) { var c = rgb(S(el).backgroundColor); if (c && c[3] > 0.5) return c; el = el.parentElement; } return null; }
    function zeroShadow(v) { return !v || v === 'none' || /^(\s*,?\s*rgba\(0, 0, 0, 0\)[^,]*)+$/.test(v); }
    var rootBg = rgb(S(document.body).backgroundColor) || rgb(S(document.documentElement).backgroundColor) || [255, 255, 255, 1];

    var bgT = T();
    for (var i = 0; i < 8; i++) for (var j = 0; j < 6; j++) {
      var pe = document.elementFromPoint(W * (i + .5) / 8, H * (j + .5) / 6);
      var pc = (pe && bgOf(pe)) || rootBg; bgT.add(key(pc), 1, pc);
    }
    var bgs = bgT.list(), bg = bgs[0].v, surface = null;
    for (var k = 1; k < bgs.length; k++) if (dist(bgs[k].v, bg) > 6 && bgs[k].w >= 3) { surface = bgs[k].v; break; }

    var els = Array.prototype.slice.call(document.body.getElementsByTagName('*'), 0, 8000);
    var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|path|g|circle|rect|line|polyline|polygon|defs|use|OPTION|BR|LINK|META)$/;
    var txtT = T(), fontT = T(), accT = T(), borderT = T(), cardT = T(), heads = [], btns = [];
    els.forEach(function (el) {
      if (SKIP.test(el.tagName)) return;
      var r = box(el); if (!r) return;
      var s = S(el), tag = el.tagName;
      var own = ''; for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.nodeValue;
      own = own.replace(/\s+/g, ' ').trim();
      var fs = parseFloat(s.fontSize);
      if (own) {
        var tc = rgb(s.color);
        if (tc) { txtT.add(key(tc), own.length, tc); if (chroma(tc) > 0.28 && own.length < 60) accT.add(key(tc), 4 * chroma(tc) * Math.min(own.length, 20), tc); }
        if (fs >= 12 && fs <= 20) fontT.add(s.fontFamily, own.length, s.fontFamily);
        if (own.length >= 2 && own.length <= 140 && tag !== 'CODE' && !/mono/i.test(s.fontFamily)) heads.push({ fs: fs, s: s, tag: tag });
      }
      var b = rgb(s.backgroundColor), area = r.width * r.height;
      var btn = tag === 'BUTTON' || el.getAttribute('role') === 'button' || (tag === 'INPUT' && /submit|button/.test(el.type)) || (tag === 'A' && b && b[3] > 0.5 && r.height < 70);
      if (b && b[3] > 0.5 && dist(b, bg) > 30 && area < W * H * 0.4) { var ch = chroma(b); if (ch > 0.2) accT.add(key(b), ch * Math.sqrt(area) * (btn ? 4 : 1), b); }
      if (btn && r.width < 480 && r.height >= 24 && r.height < 80 && (el.textContent || '').trim()) btns.push({ s: s, r: r, b: b && b[3] > 0.5 ? b : null });
      var bw = parseFloat(s.borderTopWidth) || 0, bc = bw ? rgb(s.borderTopColor) : null;
      if (bc && bc[3] > 0.08 && bw < 6) borderT.add(key(bc), 1, bc);
      if (/^(DIV|SECTION|ARTICLE|LI|ASIDE|FORM|A)$/.test(tag) && r.width >= 140 && r.height >= 60 && r.width <= W * 0.85 && r.height <= 1200) {
        var shadow = !zeroShadow(s.boxShadow);
        var pb = el.parentElement ? bgOf(el.parentElement) : bg;
        var ownBg = b && b[3] > 0.3 && pb && dist(b, pb) > 8;
        var hasBorder = bc && bc[3] > 0.08 && (parseFloat(s.borderBottomWidth) || 0) > 0 && (parseFloat(s.borderLeftWidth) || 0) > 0;
        if ((hasBorder || shadow || ownBg) && (el.textContent || '').trim().length > 2) {
          var rad = parseFloat(s.borderTopLeftRadius) || 0;
          var sig = [Math.round(rad), hasBorder ? bw + '/' + key(bc) : '-', ownBg ? key(b) : '-', shadow ? s.boxShadow : '-'].join('|');
          cardT.add(sig, 1 + Math.min(area / 40000, 4), { radius: rad, bw: hasBorder ? bw : 0, border: hasBorder ? bc : null, bg: ownBg ? b : null, shadow: shadow ? s.boxShadow : 'none' });
        }
      }
    });

    // no readable surface at all (e.g. a full-screen video) -> trust the page's colour scheme
    var root = document.documentElement, darkHint = /\bdark\b/.test(root.className) || /dark/.test(S(root).colorScheme || '');
    if (bgs.length === 1 && !rgb(S(document.body).backgroundColor) && !rgb(S(root).backgroundColor) && darkHint) bg = [10, 10, 10, 1];
    // main text = the highest-contrast colour among the frequently used ones (not just the most frequent grey)
    var txts = txtT.list(), text = null, muted = null, topW = txts.length ? txts[0].w : 0;
    txts.forEach(function (t) { if (t.w >= topW * 0.2 && contrast(t.v, bg) >= 4.5 && chroma(t.v) < 0.25 && (!text || contrast(t.v, bg) > contrast(text, bg))) text = t.v; });
    if (!text) for (var a = 0; a < txts.length; a++) if (contrast(txts[a].v, bg) >= 4) { text = txts[a].v; break; }
    if (!text) text = lum(bg) > .4 ? [17, 17, 17, 1] : [240, 240, 240, 1];
    for (var a2 = 0; a2 < txts.length; a2++) { var tv = txts[a2].v, cc = contrast(tv, bg); if (dist(tv, text) > 24 && cc >= 1.8 && cc < contrast(text, bg) && chroma(tv) < 0.25) { muted = tv; break; } }

    heads.sort(function (x, y) { return y.fs - x.fs; });
    var top1 = heads[0], real = heads.filter(function (h) { return /^H[1-3]$/.test(h.tag); });
    var head = real.length && top1 && real[0].fs >= top1.fs * 0.6 ? real[0] : top1;

    var accs = accT.list(), palette = [];
    accs.forEach(function (x) { if (palette.length < 6 && palette.every(function (p) { return dist(p, x.v) > 60; })) palette.push(x.v); });
    var accent = palette[0] || null;

    var pick = null;
    btns.forEach(function (x) { if (!x.b || dist(x.b, bg) < 30) return; var sc = x.r.width * x.r.height + (accent && dist(x.b, accent) < 40 ? 1e6 : 0); if (!pick || sc > pick.sc) pick = { x: x, sc: sc }; });
    if (!pick && btns.length) pick = { x: btns[0] };
    var btn = null;
    if (pick) {
      var bs = pick.x.s, brad = parseFloat(bs.borderTopLeftRadius) || 0;
      btn = { bg: pick.x.b, text: rgb(bs.color), radius: brad >= pick.x.r.height / 2 - 1 ? 999 : brad, weight: bs.fontWeight, transform: bs.textTransform, ls: bs.letterSpacing,
        shadow: zeroShadow(bs.boxShadow) ? 'none' : bs.boxShadow, bw: parseFloat(bs.borderTopWidth) || 0, border: rgb(bs.borderTopColor), padX: parseFloat(bs.paddingLeft) || 0, padY: parseFloat(bs.paddingTop) || 0, fs: parseFloat(bs.fontSize) };
    }

    var side = null, topbar = null;
    for (var q = 0; q < els.length && (!side || !topbar); q++) {
      var e = els[q]; if (SKIP.test(e.tagName)) continue;
      var rr = e.getBoundingClientRect(); if (rr.width < 2) continue;
      if (!side && rr.left <= 4 && rr.top <= 90 && rr.height >= H * 0.6 && rr.width >= 56 && rr.width <= 360 && e.querySelectorAll('a,button,[role=link],[role=menuitem],li').length >= 4) side = e;
      if (!topbar && rr.top <= 4 && rr.width >= W * 0.6 && rr.height >= 40 && rr.height <= 120 && e.querySelectorAll('a,button').length >= 2) topbar = e;
    }
    function areaTokens(e) {
      if (!e) return null;
      var tt = T(); Array.prototype.forEach.call(e.querySelectorAll('a,span,button,li'), function (x) { var c = rgb(S(x).color); if (c && (x.textContent || '').trim()) tt.add(key(c), 1, c); });
      var r = e.getBoundingClientRect();
      return { bg: bgOf(e) || bg, text: tt.list()[0] ? tt.list()[0].v : text, width: Math.round(r.width) };
    }

    var bodyFont = fontT.list()[0] ? fontT.list()[0].v : S(document.body).fontFamily;
    var headFont = head ? head.s.fontFamily : bodyFont;
    var fams = {};
    [headFont, bodyFont].join(',').split(',').forEach(function (f) { f = f.trim().replace(/^["']|["']$/g, '').toLowerCase(); if (f) fams[f] = 1; });
    var faces = [], size = 0, links = [];
    function walk(rules) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule.type === 5) { var fam = (rule.style.getPropertyValue('font-family') || '').trim().replace(/^["']|["']$/g, '').toLowerCase(); if (fams[fam] && size < 1.5e6) { faces.push(rule.cssText); size += rule.cssText.length; } }
        else if (rule.type === 3 && /fonts\.googleapis/.test(rule.href)) links.push(rule.href);
        else if (rule.cssRules) walk(rule.cssRules);
      }
    }
    for (var si = 0; si < document.styleSheets.length; si++) { try { walk(document.styleSheets[si].cssRules); } catch (e) {} }
    Array.prototype.forEach.call(document.querySelectorAll('link[href*="fonts.googleapis.com/css"]'), function (l) { links.push(l.href); });

    var bi = S(document.body).backgroundImage, bodyBg = /gradient/.test(bi) ? bi : null;
    var card = cardT.list()[0] ? cardT.list()[0].v : null;
    var clone = document.body.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('script,style,noscript,template'), function (n) { n.remove(); });
    var html = clone.innerHTML; if (html.length > 3e6) html = html.slice(0, 3e6);
    var hs = head ? head.s : null;
    return {
      title: document.title, html: html,
      tokens: {
        bg: bg, surface: surface, text: text, muted: muted, accent: accent, palette: palette, btn: btn, card: card,
        border: borderT.list()[0] ? borderT.list()[0].v : null,
        headFont: headFont, headWeight: hs ? hs.fontWeight : '700', headSize: head ? head.fs : 32,
        headLs: hs && hs.letterSpacing !== 'normal' ? +(parseFloat(hs.letterSpacing) / head.fs).toFixed(3) : 0,
        headCaps: hs ? hs.textTransform === 'uppercase' : false,
        bodyFont: bodyFont, side: areaTokens(side), topbar: areaTokens(topbar), bodyBg: bodyBg,
        faces: faces.join('\n'), fontLinks: links,
        motion: (function () { try { return readMotion(); } catch (e) { return { items: [], libs: [], error: e.message }; } })()
      }
    };
  }
  function start() {
    var t0 = Date.now(), last = -1, stable = 0;
    (function tick() {
      if (sent) return;
      var n = document.body ? document.body.getElementsByTagName('*').length * 7 + (document.body.innerText || '').length : 0;
      if (n === last && n > 5) stable++; else stable = 0; last = n;
      if (stable >= 3 || Date.now() - t0 > MAX) collect(); else setTimeout(tick, 250);
    })();
  }
  window.__reskinStart = start;
  if (AUTO) {
    if (document.readyState === 'complete') setTimeout(start, 200); else addEventListener('load', function () { setTimeout(start, 200); });
    setTimeout(function () { if (!sent) start(); }, 3500);
  }
}

// ---- React / TSX inside the sandbox -------------------------------------------------
// Stand-ins for imports: used for local files ("@/components/ui/button", "./Hero") and as a
// full fallback when real npm packages can't be loaded.
function __shims(R) {
  var h = R.createElement;
  var join = function () {
    var out = [];
    (function add(a) { if (!a) return; if (typeof a === 'string' || typeof a === 'number') out.push(a); else if (Array.isArray(a)) a.forEach(add); else if (typeof a === 'object') for (var k in a) if (a[k]) out.push(k); })(Array.prototype.slice.call(arguments));
    return out.join(' ');
  };
  // like tailwind-merge: later classes win over conflicting earlier ones (uses the real one when it loaded)
  var merge = function () { var s = join.apply(null, arguments); return window.__twMerge ? window.__twMerge(s) : s; };
  var cva = function (base, cfg) { cfg = cfg || {}; return function (p) { p = p || {}; var v = cfg.variants || {}, d = cfg.defaultVariants || {}, cls = [base]; for (var k in v) { var val = p[k] != null ? p[k] : d[k]; if (val != null && v[k][val]) cls.push(v[k][val]); } cls.push(p.className, p['class']); return join(cls); }; };
  var stub = function () { var f = function () { return stub(); }; return new Proxy(f, { get: function (t, k) { if (k === Symbol.toPrimitive) return function () { return ''; }; if (k === 'then' || k === '$$typeof' || k === 'current' || k === Symbol.iterator) return undefined; if (k === 'length') return 0; return stub(); } }); };
  var ALLOWED = /^(className|style|href|src|alt|placeholder|type|defaultValue|id|role|title|htmlFor|name|defaultChecked|disabled|colSpan|rowSpan|target|rel|width|height|onClick|onChange|onSubmit|rows|cols|min|max|step|tabIndex|dangerouslySetInnerHTML)$|^(aria|data)-/;
  var cleanP = function (p) {
    var o = {}; for (var k in p) if (ALLOWED.test(k)) o[k] = p[k];
    if (p.value !== undefined && typeof p.value !== 'object' && typeof p.value !== 'function') o.defaultValue = p.value;
    if (p.checked !== undefined) o.defaultChecked = !!p.checked;
    if (p['class'] && !o.className) o.className = p['class'];
    if (o.style && typeof o.style !== 'object') delete o.style;
    return o;
  };
  var domComp = function (tag) {
    return function (p) {
      p = p || {}; var props = cleanP(p);
      if (/^(img|input|hr|br)$/.test(tag)) return tag === 'img' && !props.src ? null : h(tag, props);
      return h(tag, props, p.children);
    };
  };
  var MAP = [[/^Table$/, 'table'], [/TableHeader$/, 'thead'], [/TableBody$/, 'tbody'], [/TableFooter$/, 'tfoot'], [/TableRow$/, 'tr'], [/TableHead$/, 'th'], [/TableCell$/, 'td'], [/TableCaption$/, 'caption'],
    [/Title$/, 'h3'], [/(Description|Paragraph|Text)$/, 'p'], [/(Trigger|Button|Action|Cancel|Close|Toggle|Submit)$/, 'button'],
    [/(Image|Img)$/, 'img'], [/(Link|Anchor)$/, 'a'], [/Label$/, 'label'], [/(Separator|Divider)$/, 'hr'], [/Input$/, 'input'], [/Textarea$/, 'textarea'],
    [/(Badge|Fallback|Value|Kbd|Avatar|Checkbox|Switch|RadioGroupItem)$/, 'span'], [/^(Nav|NavigationMenu|Navbar|NavBar|Menubar)$/, 'nav'], [/^(SiteHeader|TopBar|Topbar)$/, 'header'],
    [/^(Site)?Footer$/, 'footer'], [/Section$/, 'section'], [/^(Sidebar|Aside)$/, 'aside']];
  var tagFor = function (n) { for (var i = 0; i < MAP.length; i++) if (MAP[i][0].test(n)) return MAP[i][1]; return 'div'; };
  var cache = {};
  var comp = function (name, mod) {
    var ck = mod + '|' + name; if (cache[ck]) return cache[ck];
    var C, closed = /(dialog|popover|tooltip|dropdown|hover-?card|context-?menu|select|menubar|toast|sheet|drawer|command)/i.test(mod + ' ' + name);
    if (/^(Portal|Overlay|Backdrop|Arrow|ScrollUpButton|ScrollDownButton|Thumb|Indicator|Toaster|Sonner)$/.test(name) || (closed && /(Content|Overlay|Portal|Viewport)$/.test(name))) C = function () { return null; };
    else if (/(Provider|Presence|Slot|Suspense|Fragment|AnimatePresence|LayoutGroup|MotionConfig)$/.test(name)) C = function (p) { return p && p.children !== undefined ? p.children : null; };
    else {
      var tag = tagFor(name);
      C = function (p) {
        p = p || {};
        if (p.asChild && R.isValidElement(p.children)) return R.cloneElement(p.children, { className: join(p.className, p.children.props.className) });
        var props = cleanP(p);
        if (/^(img|input|hr)$/.test(tag)) return tag === 'img' && !props.src ? null : h(tag, props);
        var kids = p.children; if (kids === undefined && /Value$/.test(name) && p.placeholder) kids = p.placeholder;
        if (tag === 'button' && !props.type) props.type = 'button';
        return h(tag, props, kids);
      };
    }
    C.displayName = name; return (cache[ck] = C);
  };
  var wrap = function (C, base) {
    return R.forwardRef(function (p, ref) {
      p = p || {};
      if (p.asChild && R.isValidElement(p.children) && typeof C === 'string') return R.cloneElement(p.children, { className: join(base, p.className, p.children.props.className) });
      var o = Object.assign({}, p, { ref: ref, className: merge(base, p.className) });
      if (typeof C === 'string') delete o.asChild;
      return h(C, o);
    });
  };
  // shadcn/ui look-alikes (same class names as the real ones)
  var BTN_V = { 'default': 'bg-primary text-primary-foreground hover:bg-primary/90', destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90', outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground', secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80', ghost: 'hover:bg-accent hover:text-accent-foreground', link: 'text-primary underline-offset-4 hover:underline' };
  var BTN_S = { 'default': 'h-10 px-4 py-2', sm: 'h-9 rounded-md px-3', lg: 'h-11 rounded-md px-8', icon: 'h-10 w-10' };
  var Button = R.forwardRef(function (p, ref) {
    var cls = merge('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', BTN_V[p.variant] || BTN_V['default'], BTN_S[p.size] || BTN_S['default'], p.className);
    if (p.asChild && R.isValidElement(p.children)) return R.cloneElement(p.children, { className: join(cls, p.children.props.className) });
    var o = Object.assign({}, p, { ref: ref, className: cls }); delete o.variant; delete o.size; delete o.asChild;
    return h('button', o);
  });
  var BADGE_V = { 'default': 'border-transparent bg-primary text-primary-foreground', secondary: 'border-transparent bg-secondary text-secondary-foreground', destructive: 'border-transparent bg-destructive text-destructive-foreground', outline: 'text-foreground' };
  var Badge = function (p) { var o = Object.assign({}, p, { className: merge('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors', BADGE_V[p.variant] || BADGE_V['default'], p.className) }); delete o.variant; return h('div', o); };
  var UI = {
    Button: Button, Badge: Badge, buttonVariants: function (p) { p = p || {}; return join(BTN_V[p.variant] || BTN_V['default'], BTN_S[p.size] || BTN_S['default'], p.className); },
    Card: wrap('div', 'rounded-lg border bg-card text-card-foreground shadow-sm'),
    CardHeader: wrap('div', 'flex flex-col space-y-1.5 p-6'),
    CardTitle: wrap('h3', 'text-2xl font-semibold leading-none tracking-tight'),
    CardDescription: wrap('p', 'text-sm text-muted-foreground'),
    CardContent: wrap('div', 'p-6 pt-0'),
    CardFooter: wrap('div', 'flex items-center p-6 pt-0'),
    Input: wrap('input', 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground'),
    Textarea: wrap('textarea', 'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground'),
    Label: wrap('label', 'text-sm font-medium leading-none'),
    Separator: wrap('div', 'shrink-0 bg-border h-[1px] w-full'),
    Skeleton: wrap('div', 'animate-pulse rounded-md bg-muted'),
    Avatar: wrap('span', 'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full'),
    AvatarImage: wrap('img', 'aspect-square h-full w-full'),
    AvatarFallback: wrap('span', 'flex h-full w-full items-center justify-center rounded-full bg-muted'),
  };
  var Icon = function (p) { p = p || {}; var s = p.size || 20; return h('svg', { className: p.className, width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true }, h('circle', { cx: 12, cy: 12, r: 8 })); };
  var pass = function (p) { return p && p.children !== undefined ? p.children : null; };
  var motion = new Proxy(function (C) { return C; }, { get: function (t, tag) { return typeof tag === 'string' ? domComp(tag) : undefined; } });
  var cap = function (s) { return s.replace(/(^|[-_])(\w)/g, function (a, b, c) { return c.toUpperCase(); }); };
  var load = function (spec) {
    if (spec === 'react') return R;
    if (/^react-dom(\/client)?$/.test(spec)) return window.ReactDOM;
    if (/\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|mp4|webm|json|glsl|frag|vert)$/.test(spec)) return { __esModule: true, 'default': '' };
    if (/^(clsx|classnames|tailwind-merge|class-variance-authority)$/.test(spec) || /(^|\/)utils$/.test(spec)) return { __esModule: true, 'default': join, clsx: join, cn: merge, twMerge: merge, cva: cva, cx: join };
    if (/lucide|react-icons|heroicons|tabler|phosphor|radix-ui\/react-icons|iconify|@mui\/icons|feather/.test(spec)) return new Proxy({ __esModule: true }, { get: function (t, k) { return k === '__esModule' ? true : Icon; } });
    if (/framer-motion|^motion(\/react)?$/.test(spec)) return new Proxy({ __esModule: true }, { get: function (t, k) { if (k === '__esModule') return true; if (k === 'motion' || k === 'm') return motion; if (typeof k !== 'string') return undefined; if (/^[A-Z]/.test(k)) return pass; return function () { return stub(); }; } });
    if (spec === 'next/link') return { __esModule: true, 'default': domComp('a') };
    if (spec === 'next/image') return { __esModule: true, 'default': domComp('img') };
    var isUi = /(^|\/)ui\//.test(spec);
    var base = spec.split('/').pop().replace(/^react-/, '');
    return new Proxy({ __esModule: true }, { get: function (t, k) {
      if (k === '__esModule') return true; if (typeof k !== 'string') return undefined;
      if (isUi && UI[k]) return UI[k];
      if (k === 'default') return comp(cap(base), spec);
      if (/^[a-z]/.test(k)) return function () { return stub(); };
      return comp(k, spec);
    } });
  };
  var get = function (spec, name) { var m = load(spec); return name === 'default' ? (m['default'] !== undefined ? m['default'] : m) : m[name]; };
  return { h: h, join: merge, wrap: wrap, load: load, get: get, UI: UI };
}

// Mounts the component's default export (or first component export).
function __rkMount(mod, onEmpty) {
  var R = window.React, root = document.getElementById('root');
  var C = mod && mod['default'], P = {}, M = window.__RK_MOUNT, wrap = false;
  if (typeof C !== 'function' && mod) { C = null; for (var k in mod) if (typeof mod[k] === 'function' && /^[A-Z]/.test(k)) { C = mod[k]; break; } }
  // component settings: show the chosen component itself, with the chosen props, centred
  if (M && mod) {
    var pick = typeof mod[M.name] === 'function' ? mod[M.name] : mod['default'] && mod['default'].name === M.name ? mod['default'] : null;
    if (pick) { C = pick; P = M.props || {}; wrap = true; }
  }
  if (C && !root.children.length) {
    var EB = function (p) { R.Component.call(this, p); this.state = { e: null }; };
    EB.prototype = Object.create(R.Component.prototype);
    EB.getDerivedStateFromError = function (e) { window.__reskinErr = e && e.message; return { e: e }; };
    EB.prototype.render = function () { return this.state.e ? null : this.props.children; };
    var el = R.createElement(C, P);
    if (wrap) el = R.createElement('div', { style: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box' } }, el);
    window.ReactDOM.createRoot(root).render(R.createElement(EB, null, el));
  }
  setTimeout(function () {
    var empty = !root.innerHTML.trim() && !document.body.innerText.trim();
    if (empty && onEmpty) return onEmpty();
    window.__rkMounted = true;
    if (empty) return window.__reskinFail && window.__reskinFail(window.__reskinErr ? 'The component crashed while rendering: ' + window.__reskinErr : 'The component rendered nothing.');
    if (window.__reskinStart) window.__reskinStart();
  }, 900);
}

// Fallback: every import is a stand-in (always works offline, no real behaviour).
function __runner() {
  try {
    var old = document.getElementById('root'), fresh = document.createElement('div'); fresh.id = 'root'; old.replaceWith(fresh);
    var K = __shims(window.React);
    var out = Babel.transform(window.__CODE__, { filename: 'Component.tsx', presets: [['typescript', { isTSX: true, allExtensions: true }], ['react', { runtime: 'classic' }]], plugins: ['transform-modules-commonjs'] }).code;
    var module = { exports: {} };
    (new Function('require', 'module', 'exports', 'React', out))(K.load, module, module.exports, window.React);
    __rkMount(module.exports, null);
  } catch (e) { if (window.__reskinFail) window.__reskinFail('Could not compile the component: ' + String(e.message || e).split('\n')[0]); }
}

/* ---- click-to-edit: every element knows where it comes from in the code ----
   Inspect mode only. Each JSX element gets a number in source order (data-rk-part; data-rk-use on a component
   usage like <Button>, which passes it through to the DOM). The part map says, per number, where in the source its
   classes, inline style, words and literal values are, so the app can change the code itself. Built fresh on every
   compile, so it never goes stale. */
function __rkTagPlugin(babel) {
  var t = babel.types, MAP = window.__RK_MAP = [], n = 0;
  var COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch)\(.*\))$/i;
  function rng(x) { return x && x.start != null ? { s: x.start, e: x.end } : null; }
  function str(x) { return x && x.type === 'StringLiteral' ? x : x && x.type === 'TemplateLiteral' && !x.expressions.length ? x : null; }
  function attr(node, name) { for (var i = 0; i < node.attributes.length; i++) { var a = node.attributes[i]; if (a.type === 'JSXAttribute' && a.name && a.name.name === name) return a; } return null; }
  function val(a) { return !a || !a.value ? null : a.value.type === 'JSXExpressionContainer' ? a.value.expression : a.value; }
  function classes(a) {
    var v = val(a); if (!v) return null;
    var s = str(v); if (s) return { s: s.start + 1, e: s.end - 1, v: s.type === 'StringLiteral' ? s.value : s.quasis[0].value.raw };
    if (v.type === 'CallExpression' && v.arguments.length && (s = str(v.arguments[0]))) return { s: s.start + 1, e: s.end - 1, v: s.type === 'StringLiteral' ? s.value : s.quasis[0].value.raw, via: (v.callee.name || 'fn') };
    return { dynamic: true };
  }
  function lits(node, path, out, depth) {
    if (!node || depth > 3 || out.length > 24) return;
    if (node.type === 'NumericLiteral') out.push({ path: path, s: node.start, e: node.end, raw: String(node.value), kind: 'num' });
    else if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral') out.push({ path: path, s: node.start, e: node.end, raw: '-' + node.argument.value, kind: 'num' });
    else if (node.type === 'StringLiteral' && COLOR.test(node.value.trim())) out.push({ path: path, s: node.start + 1, e: node.end - 1, raw: node.value, kind: 'color' });
    else if (node.type === 'ObjectExpression') node.properties.forEach(function (p) { if (p.type === 'ObjectProperty' && !p.computed) lits(p.value, path + '.' + (p.key.name || p.key.value), out, depth + 1); });
    else if (node.type === 'ArrayExpression') node.elements.forEach(function (x, i) { lits(x, path + '[' + i + ']', out, depth + 1); });
  }
  function owner(p) {
    for (var q = p; q; q = q.parentPath) {
      if (q.isFunctionDeclaration() && q.node.id) return q.node.id.name;
      if (q.isVariableDeclarator() && q.node.id && q.node.id.name && /^[A-Z]/.test(q.node.id.name)) return q.node.id.name;
    }
    return '';
  }
  function inLoop(p) { for (var q = p; q; q = q.parentPath) { if (q.isCallExpression() && q.node.callee.property && /^(map|flatMap)$/.test(q.node.callee.property.name)) return true; if (q.isFunctionDeclaration()) return false; } return false; }
  return { visitor: { JSXOpeningElement: function (p) {
    var node = p.node, nm = node.name;
    if (node.start == null || attr(node, 'data-rk-part') || attr(node, 'data-rk-def')) return;
    var tag = nm.type === 'JSXIdentifier' ? nm.name : nm.type === 'JSXMemberExpression' ? (nm.object.name || '') + '.' + nm.property.name : '';
    if (!tag || tag === 'Fragment' || /\.Fragment$/.test(tag)) return;
    var use = /^[A-Z]/.test(tag) || tag.indexOf('.') > 0, id = n++;
    var st = val(attr(node, 'style')), entry = { n: id, tag: tag, use: use, s: node.start, e: node.end, at: nm.end, comp: owner(p), loop: inLoop(p) };
    var hint = ['aria-label', 'title', 'alt', 'placeholder', 'id', 'role'].map(function (k) { var v = val(attr(node, k)); return v && v.type === 'StringLiteral' ? v.value : ''; }).filter(Boolean)[0];
    if (hint) entry.hint = hint;
    var ca = attr(node, 'className') || attr(node, 'class'); if (ca) entry.cls = classes(ca);
    if (st && st.type === 'ObjectExpression') entry.style = { s: st.start, e: st.end, props: st.properties.filter(function (x) { return x.type === 'ObjectProperty' && !x.computed; }).map(function (x) { return { k: x.key.name || x.key.value, s: x.value.start, e: x.value.end }; }) };
    else if (st) entry.style = { dynamic: true };
    var L = []; node.attributes.forEach(function (a) { if (a.type === 'JSXAttribute' && a.name && typeof a.name.name === 'string' && !/^(className|class|key|style|tabIndex|id|role|aria-.*|data-.*)$/.test(a.name.name)) lits(val(a), a.name.name, L, 0); });
    lits(st, 'style', L, 0); entry.lits = L;
    var el = p.parentPath.node, T = [];
    (el.children || []).forEach(function (c) {
      if (c.type === 'JSXText' && c.value.trim()) { var lead = c.value.match(/^\s*/)[0].length, trail = c.value.match(/\s*$/)[0].length; T.push({ s: c.start + lead, e: c.end - trail, v: c.value.trim().replace(/\s+/g, ' ') }); }
      else if (c.type === 'JSXExpressionContainer' && c.expression.type === 'StringLiteral') T.push({ s: c.expression.start + 1, e: c.expression.end - 1, v: c.expression.value, q: 1 });
    });
    entry.texts = T;
    // A usage (<RichButton>) passes its tag down through {...props}; the element inside the component then carries
    // both: data-rk-use (this use, written first so a spread overrides it) and data-rk-def/part (the component's own).
    var A = function (k) { return t.jsxAttribute(t.jsxIdentifier(k), t.stringLiteral(String(id))); };
    if (use) { node.attributes.unshift(A('data-rk-use')); node.attributes.push(A('data-rk-def')); } else node.attributes.push(A('data-rk-part'));
    MAP.push(entry);
  } } };
}

/* In-frame inspector: hover or Tab shows a part's name and size; click (or Enter) pins it; Esc clears; ↑ goes to the
   part around it. Alt+click uses the component normally. Talks to the app by postMessage only. */
function __rkInspect() {
  var doc = document, pinned = null, hovered = null;
  var css = doc.createElement('style');
  css.textContent = '#rk-ins{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace}' +
    '#rk-ins .bx{position:fixed;border:1px solid #ff6a3d;background:rgba(255,106,61,.06);border-radius:2px;transition:all .12s ease}' +
    '#rk-ins .bx.pin{border-width:1.5px;background:rgba(255,106,61,.10)}#rk-ins .tw{position:fixed;border:1px dashed rgba(255,106,61,.55)}' +
    '#rk-ins .tag{position:fixed;padding:6px 9px;border-radius:6px;background:#111;color:#f3efe8;border:1px solid #333;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.35)}' +
    '#rk-ins .tag b{color:#ff6a3d;font-weight:500;margin-left:6px}#rk-ins .dim{position:fixed;color:#ff6a3d;font-size:10px;background:rgba(17,17,17,.85);padding:2px 4px;border-radius:3px}' +
    '#rk-ins svg{position:fixed;inset:0;width:100%;height:100%;overflow:visible}';
  (doc.head || doc.documentElement).appendChild(css);
  var layer = doc.createElement('div'); layer.id = 'rk-ins'; doc.documentElement.appendChild(layer);
  // an element can stand for several places in the code: this use of a component, and the component's own element
  function ids(el) { var out = []; ['data-rk-use', 'data-rk-def', 'data-rk-part'].forEach(function (k) { var v = el.getAttribute(k); if (v != null && out.indexOf(v) < 0) out.push(v); }); return out; }
  var focusId = null;   // which of an element's places is selected (the app may switch it)
  function idOf(el) { var l = ids(el); return focusId != null && l.indexOf(String(focusId)) >= 0 ? String(focusId) : l[0]; }
  function partOf(el) { while (el && el.nodeType === 1) { if (el.closest && el.closest('#rk-ins')) return null; if (ids(el).length) return el; el = el.parentElement; } return null; }
  function all(id) { return doc.querySelectorAll('[data-rk-use="' + id + '"],[data-rk-def="' + id + '"],[data-rk-part="' + id + '"]'); }
  function name(el) {
    var t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '').trim();
    if (!t) { var own = ''; el.childNodes.forEach(function (c) { if (c.nodeType === 3) own += c.nodeValue; }); t = own.trim(); }
    if (!t && el.children.length === 0) t = (el.textContent || '').trim();
    var tag = el.tagName.toLowerCase();
    var kind = { button: 'Button', a: 'Link', nav: 'Navigation', ul: 'List', li: 'List item', img: 'Picture', svg: 'Drawing', path: 'Shape', circle: 'Circle', line: 'Line', rect: 'Rectangle', g: 'Group', text: 'Label', input: 'Field', h1: 'Heading', h2: 'Heading', h3: 'Heading', p: 'Text', span: 'Text', section: 'Section', header: 'Header', footer: 'Footer' }[tag] || 'Box';
    return t ? kind + ' · ' + t.replace(/\s+/g, ' ').slice(0, 28) : kind;
  }
  function snap(el) { var c = getComputedStyle(el); return { color: c.color, bg: c.backgroundColor, fontSize: c.fontSize, fontWeight: c.fontWeight, pad: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft], radius: c.borderTopLeftRadius, opacity: c.opacity, fill: c.fill, stroke: c.stroke, strokeWidth: c.strokeWidth }; }
  function draw() {
    layer.innerHTML = '';
    [hovered && hovered !== pinned ? hovered : null, pinned].forEach(function (el, k) {
      if (!el || !el.isConnected) return;
      var id = idOf(el), r = el.getBoundingClientRect(), twins = all(id);
      if (k === 1) twins.forEach(function (x) { if (x === el) return; var q = x.getBoundingClientRect(); var d = doc.createElement('div'); d.className = 'tw'; d.style.cssText = 'left:' + q.left + 'px;top:' + q.top + 'px;width:' + q.width + 'px;height:' + q.height + 'px'; layer.appendChild(d); });
      var b = doc.createElement('div'); b.className = 'bx' + (k ? ' pin' : ''); b.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px'; layer.appendChild(b);
      // callout with a leader line, placed in whichever side has room
      var tag = doc.createElement('div'); tag.className = 'tag'; tag.innerHTML = name(el).replace(/[<&]/g, '') + (twins.length > 1 ? '<b>×' + twins.length + '</b>' : ''); layer.appendChild(tag);
      var tw = tag.offsetWidth, th = tag.offsetHeight, W = innerWidth, above = r.top > th + 30;
      var tx = Math.max(6, Math.min(W - tw - 6, r.left + r.width / 2 - tw / 2 + (r.left + r.width / 2 > W / 2 ? -40 : 40))), ty = above ? r.top - th - 22 : Math.min(innerHeight - th - 6, r.bottom + 22);
      tag.style.left = tx + 'px'; tag.style.top = ty + 'px';
      var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'), ln = doc.createElementNS(svg.namespaceURI, 'path');
      var ax = Math.max(r.left, Math.min(r.right, tx + tw / 2)), ay = above ? r.top : r.bottom, bx = tx + tw / 2, by = above ? ty + th : ty;
      ln.setAttribute('d', 'M' + ax + ' ' + ay + 'L' + ax + ' ' + (ay + by) / 2 + 'L' + bx + ' ' + (ay + by) / 2 + 'L' + bx + ' ' + by); ln.setAttribute('fill', 'none'); ln.setAttribute('stroke', '#ff6a3d'); ln.setAttribute('stroke-width', '1');
      svg.appendChild(ln); layer.appendChild(svg);
      if (k === 1) {   // dimensions of the pinned part
        var w = doc.createElement('div'); w.className = 'dim'; w.textContent = Math.round(r.width); w.style.left = (r.left + r.width / 2 - 12) + 'px'; w.style.top = (above ? r.bottom + 4 : r.top - 18) + 'px'; layer.appendChild(w);
        var h = doc.createElement('div'); h.className = 'dim'; h.textContent = Math.round(r.height); h.style.left = (r.right + 4) + 'px'; h.style.top = (r.top + r.height / 2 - 8) + 'px'; layer.appendChild(h);
      }
    });
  }
  function pin(el, quiet) {
    if (el !== pinned) focusId = null;
    pinned = el; draw();
    if (!quiet) parent.postMessage({ rkInspectPick: el ? { n: +idOf(el), places: ids(el).map(Number), label: name(el), tag: el.tagName.toLowerCase(), count: all(idOf(el)).length, cs: snap(el) } : null }, '*');
  }
  doc.addEventListener('mousemove', function (e) { var p = partOf(e.target); if (p !== hovered) { hovered = p; draw(); } }, true);
  doc.addEventListener('mouseleave', function () { hovered = null; draw(); });
  ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (ev) {
    doc.addEventListener(ev, function (e) { if (e.altKey) return; var p = partOf(e.target); if (!p) return; e.preventDefault(); e.stopPropagation(); if (ev === 'click') pin(p); }, true);
  });
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { pin(null); return; }
    if (e.key === 'ArrowUp' && pinned) { e.preventDefault(); var up = partOf(pinned.parentElement); if (up) pin(up); return; }
    if (e.key === 'Enter' && doc.activeElement && partOf(doc.activeElement)) { e.preventDefault(); pin(partOf(doc.activeElement)); }
  }, true);
  doc.addEventListener('focusin', function (e) { var p = partOf(e.target); if (p) { hovered = p; draw(); } });
  addEventListener('scroll', draw, true); addEventListener('resize', draw);
  setInterval(function () { if (pinned && !pinned.isConnected) { var again = all(pinned.getAttribute('data-rk-use') || pinned.getAttribute('data-rk-part'))[0]; pinned = again || null; } if (pinned || hovered) draw(); }, 400);
  addEventListener('message', function (e) {
    var d = e.data || {};
    if ('rkInspectSelect' in d) { var tries = 0; (function find() { var el = d.rkInspectSelect == null ? null : all(d.rkInspectSelect)[0]; if (el || d.rkInspectSelect == null || tries++ > 30) { pin(el || null, true); focusId = d.rkInspectSelect; pin(el || null); } else setTimeout(find, 150); })(); }
    if (d.rkInspectPreview) { var pv = d.rkInspectPreview; all(pv.n).forEach(function (el) { for (var k in pv.css) el.style.setProperty(k, pv.css[k], 'important'); }); draw(); }
  });
  // the app needs the part map (TSX: made by the compiler; it may finish after this runs)
  var sent = false;
  (function send() { if (window.__RK_MAP && window.__RK_MAP.length && !sent) { sent = true; parent.postMessage({ rkPartMap: window.__RK_MAP }, '*'); } else if (!sent) setTimeout(send, 150); })();
  parent.postMessage({ rkInspectReady: true }, '*');
}

// Compiles TSX to an ES module: npm imports -> esm.sh, local files -> stand-in modules.
function __rkTransform(code) {
  var DEPS = '?deps=react@18.3.1,react-dom@18.3.1';
  var PIN = { 'framer-motion': 'framer-motion@11.11.17', 'motion': 'motion@11.11.17', 'lucide-react': 'lucide-react@0.460.0', '@mui/material': '@mui/material@6.1.7', '@mui/icons-material': '@mui/icons-material@6.1.7', '@emotion/react': '@emotion/react@11.13.3', '@emotion/styled': '@emotion/styled@11.13.0' };
  var RADIX = { tabs: '1.1.1', accordion: '1.2.1', dialog: '1.1.2', 'switch': '1.1.1' };
  var UI_SRC = {
    tabs: "M.Tabs = P.Root; M.TabsList = w(P.List, 'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground'); M.TabsTrigger = w(P.Trigger, 'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm'); M.TabsContent = w(P.Content, 'mt-2');",
    accordion: "M.Accordion = P.Root; M.AccordionItem = w(P.Item, 'border-b'); M.AccordionTrigger = R.forwardRef(function (p, ref) { return h(P.Header, { className: 'flex' }, h(P.Trigger, Object.assign({}, p, { ref: ref, className: j('flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>span]:rotate-180', p.className) }), p.children, h('span', { className: 'transition-transform' }, '▾'))); }); M.AccordionContent = R.forwardRef(function (p, ref) { return h(P.Content, Object.assign({}, p, { ref: ref, className: 'overflow-hidden text-sm' }), h('div', { className: j('pb-4 pt-0', p.className) }, p.children)); });",
    dialog: "M.Dialog = P.Root; M.DialogTrigger = P.Trigger; M.DialogPortal = P.Portal; M.DialogClose = P.Close; M.DialogOverlay = w(P.Overlay, 'fixed inset-0 z-50 bg-black/80'); M.DialogContent = R.forwardRef(function (p, ref) { return h(P.Portal, null, h(P.Overlay, { className: 'fixed inset-0 z-50 bg-black/80' }), h(P.Content, Object.assign({}, p, { ref: ref, className: j('fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg sm:rounded-lg', p.className) }), p.children, h(P.Close, { className: 'absolute right-4 top-4 opacity-70 hover:opacity-100' }, '✕'))); }); M.DialogHeader = w('div', 'flex flex-col space-y-1.5 text-center sm:text-left'); M.DialogFooter = w('div', 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2'); M.DialogTitle = w(P.Title, 'text-lg font-semibold leading-none tracking-tight'); M.DialogDescription = w(P.Description, 'text-sm text-muted-foreground');",
    'switch': "M.Switch = R.forwardRef(function (p, ref) { return h(P.Root, Object.assign({}, p, { ref: ref, className: j('peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input', p.className) }), h(P.Thumb, { className: 'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0' })); });",
  };
  var J = JSON.stringify;
  var modUrl = function (s) { return URL.createObjectURL(new Blob([s], { type: 'text/javascript' })); };
  var npm = function (spec) {
    var m = /^((?:@[^/]+\/)?[^/@]+)(@[^/]+)?(\/.*)?$/.exec(spec); if (!m) return 'https://esm.sh/' + spec + DEPS;
    return 'https://esm.sh/' + (m[2] ? m[1] + m[2] : PIN[m[1]] || (window.__RK_PINS || {})[m[1]] || m[1]) + (m[3] || '') + DEPS;
  };
  var shim = function (spec, names) {
    var ui = /(^|\/)components\/ui\/([\w-]+)$/.exec(spec), kind = ui && ui[2];
    var src = 'const S = window.__rkShim, h = S.h, w = S.wrap, j = S.join, R = window.React; const M = {};\n';
    if (kind && RADIX[kind]) src += 'import * as P from ' + J('https://esm.sh/@radix-ui/react-' + kind + '@' + RADIX[kind] + DEPS) + ';\n' + UI_SRC[kind] + '\n';
    src += names.map(function (n) { return n === 'default' ? 'export default (M["default"] || S.get(' + J(spec) + ', "default"));' : 'export const ' + n + ' = M.' + n + ' || S.get(' + J(spec) + ', ' + J(n) + ');'; }).join('\n');
    return modUrl(src);
  };
  var plugin = function (api) {
    var t = api.types;
    return { visitor: {
      ImportDeclaration: function (path) {
        var src = path.node.source.value;
        if (/\.(css|scss|sass|less)(\?.*)?$/.test(src)) { path.remove(); return; }
        if (/^(react|react-dom)(\/.*)?$/.test(src)) return;
        if (/^(\.|\/|~\/|@\/|#|src\/|next(\/|$))/.test(src)) {
          var names = [];
          path.node.specifiers.forEach(function (s) {
            if (s.type === 'ImportDefaultSpecifier') names.push('default');
            else if (s.type === 'ImportSpecifier') names.push(s.imported.name || s.imported.value);
            else {
              var b = path.scope.getBinding(s.local.name);
              (b ? b.referencePaths : []).forEach(function (r) { var p = r.parentPath; if (p && (p.isMemberExpression() || p.isJSXMemberExpression()) && p.node.property && p.node.property.name) names.push(p.node.property.name); });
            }
          });
          names = names.filter(function (n, i) { return names.indexOf(n) === i && /^[A-Za-z_$][\w$]*$/.test(n) || n === 'default' && names.indexOf(n) === i; });
          path.node.source = t.stringLiteral(shim(src, names));
        } else path.node.source = t.stringLiteral(npm(src));
      },
      ExportAllDeclaration: function (path) { path.remove(); },
      ExportNamedDeclaration: function (path) { if (path.node.source) path.remove(); },
    } };
  };
  return Babel.transform(code, { filename: 'Component.tsx', presets: [['typescript', { isTSX: true, allExtensions: true }], ['react', { runtime: 'automatic' }]], plugins: window.__RK_INSPECT && window.__rkTagPlugin ? [window.__rkTagPlugin, plugin] : [plugin] }).code;
}

// Preferred path: real React + real npm packages (framer-motion, Radix, lucide…), so things animate and click.
async function __runner2() {
  var fail = function (m) { if (window.__reskinFail) window.__reskinFail(m); };
  try {
    var Rm = await import('react'), Dm = await import('react-dom/client');
    window.React = Rm['default'] || Rm;
    window.ReactDOM = { createRoot: Dm.createRoot || (Dm['default'] && Dm['default'].createRoot) };
  } catch (e) { return fail('Could not load React (offline?): ' + e.message); }
  try { var TM = await import('https://esm.sh/tailwind-merge@2.5.4'); window.__twMerge = TM.twMerge; } catch (e) {}
  window.__rkShim = __shims(window.React);
  var src;
  try { src = __rkTransform(window.__CODE__); }
  catch (e) { return fail('Could not compile the component: ' + String(e.message || e).split('\n')[0]); }
  try {
    var mod = await import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    __rkMount(mod, function () { __runner(); });
  } catch (e) { console.warn('[reskin] a package failed to load, using stand-ins:', e); __runner(); }
}

/* ---------------------------------------------------------------------------------------
   LIVE REMIX: runs inside the TARGET page (its own CSS + scripts keep running, so all its
   animations stay) and swaps the target's sample content for the user's content.
   --------------------------------------------------------------------------------------- */
function __transplant(DATA) {
  var C = DATA.content, O = DATA.opts || {}, doc = document, root = doc.documentElement;
  window.__reskinStart = function () {};               // don't run the measuring probe in live pages
  var gate = doc.createElement('style');
  var keep = O.thumb ? 'html,body{overflow:hidden!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}' :'html{scroll-behavior:smooth}';
  gate.textContent = 'body{opacity:0!important}' + keep;
  (doc.head || root).appendChild(gate);
  var shown = false;
  function reveal() { if (shown) return; shown = true; gate.textContent = 'body{opacity:1;transition:opacity .35s ease}' + keep; }
  setTimeout(reveal, 12000);
  if (C && C.title) {
    doc.title = C.title;
    // frameworks that own <head> (React 19, Next.js) render their own title back in: keep the user's
    new MutationObserver(function () { if (doc.title !== C.title) doc.title = C.title; }).observe(doc.head || root, { subtree: true, childList: true, characterData: true });
  }
  // React/TSX pages: wait until the component has actually mounted (packages load from a CDN first)
  var isTsx = window.__CODE__ !== undefined;
  var ready = function () { return !isTsx || window.__rkMounted; };

  // links: in-page anchors scroll, external links open in a new tab, everything else stays put
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^#./.test(href)) { var t = doc.getElementById(href.slice(1)); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else e.preventDefault(); return; }
    if (/^https?:\/\//i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; return; }
    e.preventDefault();
  }, true);
  doc.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  var last = -1, stable = 0, t0 = Date.now();
  function size() { var b = doc.body; return b ? b.getElementsByTagName('*').length * 7 + (b.innerText || '').length : 0; }
  (function tick() {
    var n = size(); if (n === last && n > 10) stable++; else stable = 0; last = n;
    var limit = isTsx ? 12000 : 3000;
    if ((ready() && stable >= 2 && (doc.body.innerText || '').trim()) || Date.now() - t0 > limit) { try { apply(); } catch (e) { console.error('[reskin]', e); } reveal(); watch(); }
    else setTimeout(tick, 120);
  })();
  // The design's own scripts keep running after the swap: a hydrating app, a page-transition library or a loader can
  // render the page's original content back over it. If the user's headline goes missing, swap again once things settle.
  function watch() {
    var key = C && C.hero && C.hero.title && C.hero.title.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!key) return;
    var redo = 0, calm = 0, prev = size(), end = Date.now() + 20000;
    var iv = setInterval(function () {
      var n = size(); calm = n === prev ? calm + 1 : 0; prev = n;
      var here = (doc.body.textContent || '').toLowerCase().replace(/\s+/g, ' ').indexOf(key) >= 0;
      if (!here && calm >= 2 && redo < 3) { redo++; calm = 0; try { apply(); } catch (e) { console.error('[reskin]', e); } }
      if (Date.now() > end || redo >= 3) clearInterval(iv);
    }, 600);
  }

  function apply() {
    if (!C) { if (O.recolor) recolor(O.recolor); return; }   // colour-only mode: keep the page's own words
    var W = innerWidth, H = innerHeight, B = doc.body;
    var done = new WeakSet(), dict = new Map();
    var SK = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|path|g|defs|use|circle|rect|line|polyline|polygon|IFRAME|OPTION)$/i;
    var S = function (el) { return getComputedStyle(el); };
    var norm = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };
    var own = function (el) { var s = ''; for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) s += n.nodeValue; return norm(s); };
    var vis = function (el) { var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; var s = S(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
    // laid out but waiting for the design's own reveal (split-text titles start hidden): still the page's words to replace
    var present = function (el) { var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || S(el).display === 'none') return false; return !el.closest('[aria-hidden="true"]'); };
    var hide = function (el) { if (el && el !== B && el !== root) { el.style.setProperty('display', 'none', 'important'); el.setAttribute('data-rk-hidden', ''); done.add(el); } };
    var inside = function (el, list) { for (var i = 0; i < list.length; i++) if (list[i] && list[i] !== el && list[i].contains(el)) return true; return false; };
    var before = function (a, b) { return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); };
    var doneUp = function (el) { for (var x = el; x && x !== B; x = x.parentElement) if (done.has(x)) return true; return false; };

    function setText(el, t) {
      if (!el) return; t = t == null ? '' : String(t); done.add(el);
      var tw = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, nodes = [], all = [];
      while ((n = tw.nextNode())) { if (/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) continue; all.push(n); if (n.nodeValue.trim()) nodes.push(n); }
      var oldT = norm(el.textContent);
      if (oldT && oldT.length > 1 && oldT !== t && !dict.has(oldT)) dict.set(oldT, t);
      if (!nodes.length) { el.appendChild(doc.createTextNode(t)); return; }
      var total = nodes.reduce(function (a, x) { return a + x.nodeValue.trim().length; }, 0), avg = total / nodes.length;
      if (nodes.length > 3 && avg <= 1.5) {                       // text split into letters (letter animations)
        if (resplit(el, t, nodes, false)) return;
        var ch = Array.from(t);
        all.forEach(function (x, i) { x.nodeValue = i < all.length - 1 ? (ch[i] || '') : ch.slice(i).join(''); });
      } else if (nodes.length > 3 && avg <= 14 && (el.textContent.match(/\s+/g) || []).length >= nodes.length - 1) {   // text split into words (word animations)
        if (resplit(el, t, nodes, true)) return;
        var words = t.split(/\s+/);
        nodes.forEach(function (x, i) {
          var lead = /^\s/.test(x.nodeValue) ? ' ' : '', trail = /\s$/.test(x.nodeValue) ? ' ' : '';
          var w = i < nodes.length - 1 ? words[i] : words.slice(i).join(' ');
          x.nodeValue = w ? lead + w + trail : '';
        });
      } else nodes.forEach(function (x, i) { x.nodeValue = i === 0 ? (/^\s/.test(x.nodeValue) ? ' ' : '') + t : ''; });
    }
    // ---- motion-aware text: understand HOW the heading animates, then do the same with the user's words
    var MOT = O.motion || { items: [] };
    var motionOf = function (k) { return (MOT.items || []).filter(function (x) { return k.test(x.kind); })[0] || null; };
    var rkCss = false;
    function motionCss() {
      if (rkCss) return; rkCss = true;
      var st = doc.createElement('style');
      st.textContent = '@keyframes rkIn{from{opacity:0;transform:translateY(.45em);filter:blur(4px)}}.rk-in{display:inline-block;animation:rkIn .7s cubic-bezier(.2,.7,.2,1) both}' +
        '@keyframes rkCaret{50%{opacity:0}}.rk-caret{display:inline-block;width:.08em;height:.9em;margin-left:.06em;vertical-align:-.08em;background:currentColor;animation:rkCaret 1s steps(1) infinite}';
      (doc.head || root).appendChild(st);
    }
    // the original stays in the page (hidden) so the design's own scripts keep a node to talk to; we show a copy
    function stand(el) {
      var copy = el.cloneNode(false); copy.removeAttribute('id');
      el.style.setProperty('display', 'none', 'important'); el.setAttribute('data-rk-orig', '');
      el.parentNode.insertBefore(copy, el.nextSibling); done.add(el); done.add(copy);
      return copy;
    }
    function resplit(el, t, nodes, byWord) {
      var pieces = nodes.map(function (n) { return n.parentNode; });
      if (pieces.some(function (x) { return x === el || !el.contains(x); })) return false;
      var tmpl = pieces[0], grp = !byWord && tmpl.parentNode !== el && pieces.every(function (x) { return x.parentNode.parentNode === el; }) ? tmpl.parentNode : null;
      var c0 = S(pieces[0]), c2 = S(pieces[Math.min(2, pieces.length - 1)]), gap = Math.min(2, pieces.length - 1) || 1;
      var a0 = parseFloat(c0.animationDelay) || 0, aStep = ((parseFloat(c2.animationDelay) || 0) - a0) / gap;
      var t0 = parseFloat(c0.transitionDelay) || 0, tStep = ((parseFloat(c2.transitionDelay) || 0) - t0) / gap;
      var jsMoved = /opacity|transform/.test(tmpl.getAttribute('style') || ''), animated = c0.animationName !== 'none' || aStep > 0 || tStep > 0;
      var sp = motionOf(/^split-/), step = sp && sp.step ? sp.step : 35;
      var vars = ['--i', '--index', '--char-index', '--word-index', '--char', '--delay'].filter(function (v) { return tmpl.style.getPropertyValue(v) !== ''; });
      var flex = /flex|grid/.test(S(el).display);
      var copy = stand(el), n = 0;
      function piece(text) {
        var x = tmpl.cloneNode(false); x.removeAttribute('id'); x.textContent = text;
        var i = n++;
        if (aStep > 0) x.style.animationDelay = (a0 + i * aStep).toFixed(3) + 's';
        if (tStep > 0) x.style.transitionDelay = (t0 + i * tStep).toFixed(3) + 's';
        vars.forEach(function (v) { x.style.setProperty(v, v === '--delay' ? (i * step) + 'ms' : String(i)); });
        if (jsMoved || !animated) {   // it was moved by JavaScript (or not at all): replay the arrival ourselves, same rhythm
          x.style.opacity = ''; x.style.transform = ''; x.style.visibility = '';
          motionCss(); x.classList.add('rk-in'); x.style.animationDelay = (i * step) + 'ms';
        }
        return x;
      }
      var space = function () { if (!flex) return doc.createTextNode(' '); var g = doc.createElement('span'); g.textContent = ' '; g.style.display = 'inline-block'; return g; };
      var words = String(t).split(/\s+/).filter(Boolean);
      words.forEach(function (w, wi) {
        if (byWord) copy.appendChild(piece(w));
        else if (grp) { var g = grp.cloneNode(false); g.removeAttribute('id'); Array.from(w).forEach(function (c) { g.appendChild(piece(c)); }); copy.appendChild(g); }
        else Array.from(w).forEach(function (c) { copy.appendChild(piece(c)); });
        if (wi < words.length - 1) copy.appendChild(grp || byWord ? space() : piece(' '));
      });
      return true;
    }
    // text the design's JavaScript types or scrambles: show the user's words with the same effect
    function liveTitle(el, t) {
      var lv = motionOf(/^(typewriter|scramble)$/);
      if (!lv || O.thumb) return false;
      var copy = stand(el); copy.textContent = t;
      motionCss();
      if (lv.kind === 'typewriter') {
        var i = 0, caret = doc.createElement('span'); caret.className = 'rk-caret';
        copy.textContent = ''; var txt = doc.createTextNode(''); copy.appendChild(txt); copy.appendChild(caret);
        (function type() { txt.nodeValue = t.slice(0, ++i); if (i < t.length) setTimeout(type, 38 + Math.random() * 40); })();
      } else {
        var glyphs = '!<>-_\\/[]{}=+*^?#ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', frame = 0, total = 28;
        (function scramble() {
          var done = Math.floor(t.length * frame / total), out = t.slice(0, done);
          for (var k = done; k < t.length; k++) out += t[k] === ' ' ? ' ' : glyphs[Math.floor(Math.random() * glyphs.length)];
          copy.textContent = out; if (frame++ < total) setTimeout(scramble, 40); else copy.textContent = t;
        })();
      }
      return true;
    }
    function unfreeze(el) {
      [el].concat(Array.prototype.slice.call(el.querySelectorAll('*'))).forEach(function (x) {
        var st = x.style; if (!st) return;
        if (x.hasAttribute('data-rk-hidden')) { st.removeProperty('display'); x.removeAttribute('data-rk-hidden'); }
        if (st.opacity === '0') st.opacity = '';
        if (st.transform && st.transform !== 'none') st.transform = '';
        if (st.visibility === 'hidden') st.visibility = '';
        if (x.id) x.removeAttribute('id');
      });
    }
    function appendP(after, text) {
      var p = doc.createElement('p'); p.textContent = text;
      p.style.cssText = 'margin-top:1rem;opacity:.8;max-width:44rem;line-height:1.6';
      if (S(after).textAlign === 'center' || S(after.parentElement || after).textAlign === 'center') p.style.marginInline = 'auto';
      after.after(p); done.add(p); return p;
    }

    // ---- regions: nav (top bar / header / sidebar) and footer
    function pickNav() {
      var hd = doc.querySelector('header, [role=banner]') || doc.querySelector('nav, [role=navigation]');
      if (hd && vis(hd)) {
        var r = hd.getBoundingClientRect();
        if (hd.querySelector('h1') || r.height > H * 0.4) hd = hd.querySelector('nav') || null;
        if (hd) return hd;
      }
      var els = B.getElementsByTagName('*');
      for (var i = 0; i < els.length && i < 5000; i++) {
        var e = els[i]; if (SK.test(e.tagName)) continue;
        var rr = e.getBoundingClientRect();
        if (((rr.top <= 4 && rr.width >= W * 0.6 && rr.height >= 36 && rr.height <= 130) || (rr.left <= 4 && rr.top <= 90 && rr.height >= H * 0.6 && rr.width >= 56 && rr.width <= 360)) && e.querySelectorAll('a,button').length >= 2) return e;
      }
      return null;
    }
    var nav = pickNav(), foot = doc.querySelector('footer');
    var zones = [nav, foot].filter(Boolean);

    // ---- headings (tags first; otherwise the biggest text acts as the title)
    var heads = Array.prototype.slice.call(B.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(function (h) { return present(h) && norm(h.textContent) && !inside(h, zones); })
      .map(function (h) { return { el: h, lvl: +h.tagName[1], fs: parseFloat(S(h).fontSize) }; });
    var bySize = heads.slice().sort(function (a, b) { return b.fs - a.fs; });
    if (!heads.some(function (h) { return h.lvl === 1; })) {
      var big = Array.prototype.slice.call(B.querySelectorAll('div,span,p,a,strong')).filter(function (el) { var t = own(el); return t.length >= 3 && t.length <= 120 && !inside(el, zones) && vis(el); })
        .map(function (el) { return { el: el, fs: parseFloat(S(el).fontSize) }; }).sort(function (a, b) { return b.fs - a.fs; });
      // pages: the title must look like one (28px+); components with no headings at all (e.g. MUI Typography divs): the biggest text
      if (big[0] && (big[0].fs >= 28 || (!bySize.length && big[0].fs >= 16 && big[0].fs > (big[1] ? big[1].fs : 0))) && (!bySize[0] || big[0].fs > bySize[0].fs * 1.15)) heads.push({ el: big[0].el, lvl: 1, fs: big[0].fs });
      else if (bySize[0]) bySize[0].lvl = 1;
    }
    heads.sort(function (a, b) { return a.el === b.el ? 0 : before(a.el, b.el) ? -1 : 1; });
    var h1 = heads.filter(function (h) { return h.lvl === 1; })[0] || null;
    var rest = heads.filter(function (h) { return h !== h1; });
    var secLvl = rest.length ? Math.min.apply(null, rest.map(function (h) { return h.lvl; })) : 2;
    heads.forEach(function (h) { h.el.setAttribute('data-rk-h', h === h1 ? 'top' : String(h.lvl)); });
    var secHeadEls = rest.filter(function (h) { return h.lvl === secLvl; }).map(function (h) { return h.el; });

    function climb(el, stopAt, others) {
      var cur = el;
      while (cur.parentElement && cur.parentElement !== stopAt && cur.parentElement !== B && cur.parentElement !== root &&
        !others.some(function (o) { return o !== el && cur.parentElement.contains(o); })) cur = cur.parentElement;
      return cur;
    }
    function cardsOf(box) {
      var hs = Array.prototype.slice.call(box.querySelectorAll('[data-rk-h]')).filter(function (e) { var v = e.getAttribute('data-rk-h'); return v !== 'top' && +v > secLvl && !e.hasAttribute('data-rk-hidden'); });
      return hs.map(function (hd) { return { head: hd, box: climb(hd, box, hs) }; });
    }
    function blocks(box, excl, allowZones) {
      return Array.prototype.slice.call(box.querySelectorAll('p,blockquote,figcaption,li,div,span,small,dd')).filter(function (el) {
        if (doneUp(el) || (!allowZones && inside(el, zones)) || (excl && inside(el, excl))) return false;
        if (el.closest('[data-rk-h],code,pre,label')) return false;
        var cl = el.closest('button,a'); if (cl && box.contains(cl) && cl !== box && cl.getBoundingClientRect().height < 70) return false;
        var t = el.tagName === 'P' || el.tagName === 'BLOCKQUOTE' ? norm(el.textContent) : own(el);
        if (t.length < (el.tagName === 'P' ? 2 : 20)) return false;
        if (el.querySelector('p,h1,h2,h3,h4,h5,h6,[data-rk-h]')) return false;
        return vis(el);
      });
    }
    function buttons(box, excl) {
      return Array.prototype.slice.call(box.querySelectorAll('button,a,[role=button]')).filter(function (el) {
        if (doneUp(el) || inside(el, zones) || (excl && inside(el, excl))) return false;
        if (el.parentElement && el.parentElement.closest('button,a')) return false;
        var t = norm(el.textContent); if (!t || t.length > 40 || !vis(el)) return false;
        if (el.tagName !== 'A') return true;
        var s = S(el); return !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.paddingLeft) >= 8;
      });
    }
    function images(box, excl) {
      return Array.prototype.slice.call(box.querySelectorAll('img,[style*="background-image"]')).filter(function (el) {
        if (done.has(el) || inside(el, zones) || (excl && inside(el, excl)) || !vis(el)) return false;
        var r = el.getBoundingClientRect(); return r.width >= 60 && r.height >= 40;
      });
    }
    function setImg(el, im) {
      done.add(el);
      if (el.tagName === 'IMG') { el.removeAttribute('srcset'); el.src = im.src; el.alt = im.alt || ''; if (!el.style.objectFit) el.style.objectFit = 'cover'; }
      else el.style.backgroundImage = 'url("' + im.src + '")';
    }
    function fillTexts(list, arr, anchor) {
      arr = (arr || []).filter(Boolean);
      list.forEach(function (el, i) { if (i >= arr.length) hide(el); else setText(el, arr[i]); });
      // more of the user's lines than the target has slots: repeat the last slot (one line per item)
      var prev = list[list.length - 1];
      for (var i = list.length; i < arr.length && prev; i++) { var c = prev.cloneNode(true); unfreeze(c); prev.after(c); setText(c, arr[i]); prev = c; }
      if (!list.length && arr.length && anchor) arr.forEach(function (t) { anchor = appendP(anchor, t); });
    }
    function fillButtons(list, data, anchor) {
      data = data || []; var prev = list[list.length - 1];
      if (!list.length && data.length && btnTpl && anchor) {   // no button here in the target: borrow the hero's
        var row = doc.createElement('div'); row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-top:1.5rem;justify-content:' + (S(anchor).textAlign === 'center' ? 'center' : 'flex-start');
        anchor.after(row);
        data.forEach(function (d) { var b = btnTpl.cloneNode(true); row.appendChild(b); setText(b, d.text); if (b.tagName === 'A') b.setAttribute('href', d.href || '#'); });
        return;
      }
      list.forEach(function (b, i) {
        if (i < data.length) { setText(b, data[i].text); if (b.tagName === 'A') b.setAttribute('href', data[i].href || '#'); }
        else hide(b);
      });
      for (var i = list.length; i < data.length && prev; i++) {
        var c = prev.cloneNode(true); unfreeze(c); prev.after(c); prev = c;
        setText(c, data[i].text); if (c.tagName === 'A') c.setAttribute('href', data[i].href || '#');
      }
    }

    // ---- brand + nav
    if (nav) {
      var links = Array.prototype.slice.call(nav.querySelectorAll('a,button')).filter(function (a) { return vis(a) && !(a.parentElement && a.parentElement.closest('a,button') && nav.contains(a.parentElement.closest('a,button'))); });
      var brandEl = nav.querySelector('[class*="logo" i],[class*="brand" i]');
      if (!brandEl) brandEl = links.filter(function (a) { return a.querySelector('img,svg') || /^(\/|#|\.\/|index\.html?)?$/.test(a.getAttribute('href') || ''); })[0] || null;
      if (brandEl) {
        var bt = norm(brandEl.textContent);
        if (C.logo) {
          var im = brandEl.tagName === 'IMG' ? brandEl : brandEl.querySelector('img'), sv = brandEl.querySelector('svg');
          if (im) { im.removeAttribute('srcset'); im.src = C.logo.src; }
          else { var ni = doc.createElement('img'); ni.src = C.logo.src; ni.alt = C.brand; var hh = sv ? sv.getBoundingClientRect().height : 0; ni.style.cssText = 'height:' + (hh || 28) + 'px;width:auto;display:inline-block;vertical-align:middle'; if (sv) sv.replaceWith(ni); else brandEl.prepend(ni); }
        }
        if (bt) { setText(brandEl, C.logo && C.hideName ? '' : C.brand); if (bt.length > 1) dict.set(bt, C.brand); }
        done.add(brandEl);
        links = links.filter(function (a) { return a !== brandEl && !brandEl.contains(a) && !a.contains(brandEl); });
      }
      links = links.filter(function (a) { var t = norm(a.textContent); return t && t.length <= 30; });
      var isCta = function (a) { var s = S(a); return a.tagName === 'BUTTON' || !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) || parseFloat(s.borderTopWidth) > 0; };
      var ctas = links.filter(isCta), plain = links.filter(function (a) { return !isCta(a); });
      var navData = (C.nav || []).slice();
      var li = function (a) { var l = a.closest('li'); return l && nav.contains(l) ? l : a; };
      plain.forEach(function (a, i) { if (i < navData.length) { setText(a, navData[i].text); if (a.tagName === 'A') a.setAttribute('href', navData[i].href || '#'); } else hide(li(a)); });
      for (var k = plain.length; k < navData.length && plain.length; k++) {
        var src = li(plain[plain.length - 1]), cl = src.cloneNode(true); unfreeze(cl); src.parentNode.insertBefore(cl, src.nextSibling);
        var ca = cl.matches('a,button') ? cl : cl.querySelector('a,button'); if (ca) { setText(ca, navData[k].text); ca.setAttribute('href', navData[k].href || '#'); }
        plain.push(ca || cl);
      }
      ctas.forEach(function (a, i) { if (i === 0 && C.navCta) { setText(a, C.navCta.text); if (a.tagName === 'A') a.setAttribute('href', C.navCta.href || '#'); } else if (norm(a.textContent).length > 1) hide(a); });
    }

    // ---- hero
    var heroBox = h1 ? climb(h1.el, null, secHeadEls) : null;
    var btnTpl = null;   // an untouched copy of the target's main button, for sections that need one
    if (heroBox) { var hb0 = buttons(heroBox)[0]; if (hb0) { btnTpl = hb0.cloneNode(true); unfreeze(btnTpl); } }
    if (h1) {
      if (!liveTitle(h1.el, C.hero.title)) setText(h1.el, C.hero.title);
      if (heroBox) {
        var eb = Array.prototype.slice.call(heroBox.querySelectorAll('span,p,div,small,a')).filter(function (el) {
          var t = own(el); return !doneUp(el) && !inside(el, zones) && before(el, h1.el) && !el.contains(h1.el) && t.length >= 2 && t.length <= 60 && !el.querySelector('h1,h2,h3,p') && vis(el);
        })[0];
        if (eb) {
          if (C.hero.eyebrow) setText(eb, C.hero.eyebrow);
          else { var pill = eb.closest('a,span'); hide(pill && heroBox.contains(pill) && pill.getBoundingClientRect().height < 60 ? pill : eb); }   // just the label, never its container
        }
        fillTexts(blocks(heroBox), C.hero.paras, h1.el);
        fillButtons(buttons(heroBox), C.hero.buttons);
        var hi = images(heroBox); if (C.hero.img && hi[0]) setImg(hi[0], C.hero.img);
      }
    }

    // ---- sections: reuse the target's sections in order, clone when the user has more, hide the rest
    var tsecs = secHeadEls.map(function (hd) { return { head: hd, box: climb(hd, null, secHeadEls.concat(h1 ? [h1.el] : [])) }; })
      .filter(function (s) { return !(heroBox && (s.box.contains(heroBox) || heroBox.contains(s.box))) && !inside(s.box, zones); });
    function fillCard(tc, c) {
      if (tc.head) setText(tc.head, c.title);
      fillTexts(blocks(tc.box), c.text, tc.head);
      var im = images(tc.box); if (c.img && im[0]) setImg(im[0], c.img);
      if (c.buttons && c.buttons.length) fillButtons(buttons(tc.box), c.buttons);
    }
    function fillSection(box, us) {
      if (us.id) box.id = us.id;
      // the target's own tab bars / toggles belong to its sample content
      Array.prototype.forEach.call(box.querySelectorAll('[role=tablist]'), hide);
      var head = box.querySelector('[data-rk-h="' + secLvl + '"]');
      if (head) { if (us.title) setText(head, us.title); else hide(head); }
      var cards = cardsOf(box), cardBoxes = cards.map(function (c) { return c.box; }), extra = [];
      var uc = us.cards.length ? us.cards : (cards.length ? us.lists.map(function (it) { return { title: it.title || it.text, text: it.title && it.text ? [it.text] : [], img: null, buttons: [] }; }) : []);
      if (cards.length) {
        var prev = cards[cards.length - 1].box;
        uc.forEach(function (c, j) {
          var tc = cards[j];
          if (!tc) {
            var tpl = cards[cards.length - 1]; tpl.head.setAttribute('data-rk-tpl', '');
            var nb = tpl.box.cloneNode(true); tpl.head.removeAttribute('data-rk-tpl');
            unfreeze(nb); prev.after(nb); prev = nb; cardBoxes.push(nb);
            var nh = nb.querySelector('[data-rk-tpl]'); if (nh) nh.removeAttribute('data-rk-tpl');
            tc = { box: nb, head: nh };
          }
          fillCard(tc, c);
        });
        cards.slice(uc.length).forEach(function (c) { hide(c.box); });
        if (us.cards.length) us.lists.forEach(function (it) { extra.push((it.title ? it.title + ' — ' : '') + it.text); });
      } else {
        us.cards.forEach(function (c) { extra.push(c.title + (c.text.length ? ' — ' + c.text.join(' ') : '')); });
        us.lists.forEach(function (it) { extra.push((it.title ? it.title + ' — ' : '') + it.text); });
      }
      var quotes = us.quotes.map(function (q) { return '“' + q.text + '”' + (q.cite ? ' — ' + q.cite : ''); });
      fillTexts(blocks(box, cardBoxes), us.intro.concat(quotes, extra), head || box.firstElementChild);
      var txts = box.querySelectorAll('p:not([data-rk-hidden])');
      fillButtons(buttons(box, cardBoxes), us.buttons, txts.length ? txts[txts.length - 1] : head);
      var imgs = images(box, cardBoxes); (us.imgs || []).forEach(function (im, i) { if (imgs[i]) setImg(imgs[i], im); });
    }
    function freshSection(after) {
      var s = doc.createElement('section');
      s.style.cssText = 'max-width:1100px;margin:0 auto;padding:72px 24px;position:relative;z-index:1';
      var hd = doc.createElement('h2'); hd.setAttribute('data-rk-h', String(secLvl)); hd.style.cssText = 'font-size:2rem;font-weight:700;line-height:1.2;margin:0 0 12px';
      var p = doc.createElement('p'); p.style.cssText = 'opacity:.75;max-width:44rem;line-height:1.6';
      s.appendChild(hd); s.appendChild(p);
      if (after && after.parentNode) after.after(s); else B.appendChild(s);
      return s;
    }
    var used = {}, ti = 0, lastBox = heroBox;
    var hasCards = function (s) { return cardsOf(s.box).length > 0; };
    (C.sections || []).forEach(function (us) {
      var want = us.cards.length > 0 || us.lists.length > 1, pick = null, box;
      for (var k = ti; k < Math.min(tsecs.length, ti + 3); k++) if (!used[k] && hasCards(tsecs[k]) === want) { pick = k; break; }
      if (pick == null && ti < tsecs.length) pick = ti;
      if (pick != null) {
        for (var z = ti; z < pick; z++) if (!used[z]) { hide(tsecs[z].box); used[z] = 1; }
        used[pick] = 1; ti = pick + 1; box = tsecs[pick].box;
      } else if (tsecs.length) {
        var tpl = tsecs.filter(function (s) { return hasCards(s) === want; })[0] || tsecs[tsecs.length - 1];
        box = tpl.box.cloneNode(true); unfreeze(box);
        (lastBox && lastBox.parentNode ? lastBox : tpl.box).after(box);
      } else box = freshSection(lastBox);
      lastBox = box;
      fillSection(box, us);
    });
    for (var k2 = ti; k2 < tsecs.length; k2++) if (!used[k2]) hide(tsecs[k2].box);

    // ---- footer
    if (foot) {
      var fl = Array.prototype.slice.call(foot.querySelectorAll('a')).filter(function (a) { var t = norm(a.textContent); return vis(a) && t && t.length <= 30; });
      var fdata = (C.footerLinks && C.footerLinks.length ? C.footerLinks : C.nav) || [];
      fl.forEach(function (a, i) { if (i < fdata.length) { setText(a, fdata[i].text); a.setAttribute('href', fdata[i].href || '#'); } else { var l = a.closest('li'); hide(l && foot.contains(l) ? l : a); } });
      for (var fi = fl.length, fprev = fl[fl.length - 1]; fi < fdata.length && fprev; fi++) {
        var fc = fprev.cloneNode(true); fprev.after(doc.createTextNode(' '), fc); setText(fc, fdata[fi].text); fc.setAttribute('href', fdata[fi].href || '#'); fprev = fc;
      }
      var fp = blocks(foot, null, true);
      if (fp.length) { setText(fp[0], C.footer || ('© ' + new Date().getFullYear() + ' ' + C.brand)); fp.slice(1).forEach(hide); }
    }

    // ---- leftovers: any sample headline or paragraph we didn't replace gets hidden
    Array.prototype.slice.call(B.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,[data-rk-h]')).forEach(function (el) {
      if (!doneUp(el) && !inside(el, zones) && vis(el) && !el.closest('[data-rk-hidden]')) hide(el);
    });
    // ---- the target's brand name anywhere else -> the user's brand
    var tw2 = doc.createTreeWalker(B, NodeFilter.SHOW_TEXT), tn;
    while ((tn = tw2.nextNode())) { var key = norm(tn.nodeValue); if (key && dict.has(key) && !doneUp(tn.parentNode)) tn.nodeValue = dict.get(key); }
    // ---- keep the swap when React re-renders text
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        var fix = function (t) { var k = norm(t.nodeValue); if (k && dict.has(k)) t.nodeValue = dict.get(k); };
        if (m.type === 'characterData') fix(m.target);
        else m.addedNodes.forEach(function (n) { if (n.nodeType === 3) fix(n); else if (n.nodeType === 1) { var w = doc.createTreeWalker(n, NodeFilter.SHOW_TEXT), x; while ((x = w.nextNode())) fix(x); } });
      });
    }).observe(B, { subtree: true, childList: true, characterData: true });

    if (O.recolor) recolor(O.recolor);
    if (O.font) {
      var fs = doc.createElement('style');
      fs.textContent = (O.font.faces || '') + '\nbody,body *:not(code):not(pre):not(kbd):not(samp):not(svg):not(svg *):not([class*="icon" i]){font-family:' + O.font.stack + ' !important}';
      doc.head.appendChild(fs);
      (O.font.links || []).forEach(function (l) { var k = doc.createElement('link'); k.rel = 'stylesheet'; k.href = l; doc.head.appendChild(k); });
    }
  }

  // ---- shift the target's palette to the user's brand colour (stylesheets, CSS variables, inline styles, SVG, media)
  function recolor(R) {
    var cv = doc.createElement('canvas'); cv.width = cv.height = 1; var cx = cv.getContext('2d', { willReadFrequently: true }), memo = {};
    function rgb(c) { if (memo[c] !== undefined) return memo[c]; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); var d = cx.getImageData(0, 0, 1, 1).data; return (memo[c] = d[3] < 3 ? null : [d[0], d[1], d[2], +(d[3] / 255).toFixed(3)]); }
    function toHsl(c) { var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0; if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return { h: h, s: s, l: l }; }
    function toRgb(h, s, l) { var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0; h = ((h % 360) + 360) % 360; if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; } return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]; }
    var A = toHsl(R.from), Bc = toHsl(R.to), delta = Bc.h - A.h;
    var clamp = function (v) { return Math.max(0, Math.min(1, v)); };
    function map(c, prop) {
      if (R.mono) {   // target has no colour of its own: only its main button colour becomes the brand colour
        if (!/background|border|fill|outline|--/.test(prop || '')) return null;
        return Math.abs(c[0] - R.from[0]) + Math.abs(c[1] - R.from[1]) + Math.abs(c[2] - R.from[2]) < 30 ? R.to.slice(0, 3) : null;
      }
      var x = toHsl(c); if (x.s < 0.12 || x.l < 0.05 || x.l > 0.97) return null;
      var dh = Math.abs(((x.h - A.h + 540) % 360) - 180), w = Math.max(0, 1 - dh / 70);
      var s = clamp(x.s + (clamp(x.s * (A.s > 0.05 ? Bc.s / A.s : 1)) - x.s) * w), l = clamp(x.l + (Bc.l - A.l) * w);
      return toRgb(x.h + delta, s, l);
    }
    var RX = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\((?:[^()]|\([^()]*\))*\)/g;
    function fixValue(v, prop) {
      v = v.replace(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(\s*[\/,]\s*var\((?:[^()]|\([^()]*\))*\))\s*\)/g, function (all, r, g, b, rest) {
        var n = map([+r, +g, +b, 1], prop); return n ? 'rgb(' + n[0] + ' ' + n[1] + ' ' + n[2] + rest + ')' : all;
      });
      var out = v.replace(RX, function (tok) { if (/var\(/.test(tok)) return tok; var c = rgb(tok); if (!c) return tok; var n = map(c, prop); return n ? 'rgb(' + n[0] + ' ' + n[1] + ' ' + n[2] + (c[3] < 1 ? ' / ' + c[3] : '') + ')' : tok; });
      if (prop && prop.indexOf('--') === 0) {   // shadcn style "262 83% 58%"
        var m = /^\s*(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(out);
        if (m) { var c2 = rgb('hsl(' + m[1] + ' ' + m[2] + '% ' + m[3] + '%)'), n2 = c2 && map(c2, prop); if (n2) { var hh = toHsl(n2); out = Math.round(hh.h) + ' ' + Math.round(hh.s * 100) + '% ' + Math.round(hh.l * 100) + '%'; } }
      }
      return out;
    }
    function fixStyle(st) { for (var j = 0; j < st.length; j++) { var p = st[j], v = st.getPropertyValue(p); if (!v || !/[#(%]/.test(v)) continue; var nv = fixValue(v, p); if (nv !== v) st.setProperty(p, nv, st.getPropertyPriority(p)); } }
    function walk(rules) { for (var i = 0; i < rules.length; i++) { var r = rules[i]; if (r.style) fixStyle(r.style); if (r.cssRules) walk(r.cssRules); } }
    var seen = new WeakSet();
    function sheets() { for (var i = 0; i < doc.styleSheets.length; i++) { var sh = doc.styleSheets[i]; if (seen.has(sh)) continue; seen.add(sh); try { walk(sh.cssRules); } catch (e) {} } }
    sheets();
    Array.prototype.forEach.call(doc.querySelectorAll('[style]'), function (el) { fixStyle(el.style); });
    Array.prototype.forEach.call(doc.querySelectorAll('[fill],[stroke],[stop-color]'), function (el) { ['fill', 'stroke', 'stop-color'].forEach(function (a) { var v = el.getAttribute(a); if (v && v !== 'none' && !/url\(|currentColor/i.test(v)) { var nv = fixValue(v, 'fill'); if (nv !== v) el.setAttribute(a, nv); } }); });
    if (!R.mono && Math.abs(delta) > 8) Array.prototype.forEach.call(doc.querySelectorAll('video,canvas'), function (el) { el.style.filter = (el.style.filter || '') + ' hue-rotate(' + Math.round(delta) + 'deg)'; });
    // stylesheets that appear later (e.g. Tailwind generating classes on the fly)
    var tm; new MutationObserver(function () { clearTimeout(tm); tm = setTimeout(sheets, 150); }).observe(doc.head, { childList: true, subtree: true, characterData: true });
  }
}

const SHADCN_CSS = `:root{--background:0 0% 100%;--foreground:222.2 84% 4.9%;--card:0 0% 100%;--card-foreground:222.2 84% 4.9%;--popover:0 0% 100%;--popover-foreground:222.2 84% 4.9%;--primary:222.2 47.4% 11.2%;--primary-foreground:210 40% 98%;--secondary:210 40% 96.1%;--secondary-foreground:222.2 47.4% 11.2%;--muted:210 40% 96.1%;--muted-foreground:215.4 16.3% 46.9%;--accent:210 40% 96.1%;--accent-foreground:222.2 47.4% 11.2%;--destructive:0 84.2% 60.2%;--destructive-foreground:210 40% 98%;--border:214.3 31.8% 91.4%;--input:214.3 31.8% 91.4%;--ring:222.2 84% 4.9%;--radius:.5rem}
.dark{--background:222.2 84% 4.9%;--foreground:210 40% 98%;--card:222.2 84% 4.9%;--card-foreground:210 40% 98%;--popover:222.2 84% 4.9%;--popover-foreground:210 40% 98%;--primary:210 40% 98%;--primary-foreground:222.2 47.4% 11.2%;--secondary:217.2 32.6% 17.5%;--secondary-foreground:210 40% 98%;--muted:217.2 32.6% 17.5%;--muted-foreground:215 20.2% 65.1%;--accent:217.2 32.6% 17.5%;--accent-foreground:210 40% 98%;--destructive:0 62.8% 30.6%;--destructive-foreground:210 40% 98%;--border:217.2 32.6% 17.5%;--input:217.2 32.6% 17.5%;--ring:212.7 26.8% 83.9%}
*{border-color:hsl(var(--border))}body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground));font-family:ui-sans-serif,system-ui,sans-serif}`;
const TW_CONFIG = `tailwind.config={darkMode:'class',theme:{extend:{colors:{border:'hsl(var(--border))',input:'hsl(var(--input))',ring:'hsl(var(--ring))',background:'hsl(var(--background))',foreground:'hsl(var(--foreground))',primary:{DEFAULT:'hsl(var(--primary))',foreground:'hsl(var(--primary-foreground))'},secondary:{DEFAULT:'hsl(var(--secondary))',foreground:'hsl(var(--secondary-foreground))'},destructive:{DEFAULT:'hsl(var(--destructive))',foreground:'hsl(var(--destructive-foreground))'},muted:{DEFAULT:'hsl(var(--muted))',foreground:'hsl(var(--muted-foreground))'},accent:{DEFAULT:'hsl(var(--accent))',foreground:'hsl(var(--accent-foreground))'},popover:{DEFAULT:'hsl(var(--popover))',foreground:'hsl(var(--popover-foreground))'},card:{DEFAULT:'hsl(var(--card))',foreground:'hsl(var(--card-foreground))'}},borderRadius:{lg:'var(--radius)',md:'calc(var(--radius) - 2px)',sm:'calc(var(--radius) - 4px)'}}}}`;
const jsonForScript = v => JSON.stringify(v).replace(/</g, '\\u003c');

function prepareTsx(code) {
  // bare JSX snippet -> wrap it in a component; components without an export -> export the last one
  if (!/\bexport\b/.test(code)) {
    const names = [...code.matchAll(/(?:function|const|let|class)\s+([A-Z]\w*)/g)].map(x => x[1]);
    if (names.length) code += `\nexport default ${names[names.length - 1]};`;
    else code = `export default function Snippet(){ return (<>\n${code}\n</>); }`;
  }
  return code;
}
// bundled exports often append files like "/* ---- Card.css ---- */ ...css..." after the component
function splitBundle(code) {
  const parts = code.split(/^\/\*\s*-{2,}\s*([^*\n]+?)\s*-{2,}\s*\*\/\s*$/m);
  let js = parts[0], css = '';
  for (let i = 1; i < parts.length; i += 2) {
    if (/\.(css|scss|sass|less)$/i.test(parts[i])) css += parts[i + 1] + '\n'; else js += '\n' + parts[i + 1];
  }
  return { js, css };
}
// mount (optional): { name, props } — show that component with those props (Studio's component settings)
// opt.inspect: click-to-edit mode — compile with source tags and run the part inspector
function tsxDoc(code, id, mount, opt = {}) {
  const bundle = splitBundle(code);
  code = bundle.js;
  const dark = /\bclassName=["'`][^"'`]*\bdark\b/.test(code) ? 'dark' : '';
  return `<!doctype html><html class="${dark}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="importmap">${JSON.stringify(IMPORT_MAP)}<\/script>
<script src="https://cdn.tailwindcss.com/3.4.16"><\/script><script>${TW_CONFIG}<\/script><style>${SHADCN_CSS}</style><style>${bundle.css.replace(/<\/style/gi, '')}</style>
<script src="https://unpkg.com/@babel/standalone@7.26.4/babel.min.js"><\/script>
</head><body><div id="root"></div>
<script>(${__probe})(${jsonForScript(id)}, false, 6000);<\/script>
<script>window.__CODE__=${jsonForScript(prepareTsx(code))};${mount ? `window.__RK_MOUNT=${jsonForScript(mount)};` : ''}${EXPORT_PINS ? `window.__RK_PINS=${jsonForScript(EXPORT_PINS)};` : ''}<\/script>
${opt.inspect ? `<script>window.__RK_INSPECT=true;\n${__rkTagPlugin}\n${__rkInspect}\n__rkInspect();<\/script>` : ''}
<script>${__shims}\n${__rkMount}\n${__runner}\n${__rkTransform}\n${__runner2}\n__runner2();<\/script></body></html>`;
}
// set while building a download: package versions fixed at that moment, so the downloaded site keeps working the same way
let EXPORT_PINS = null;
// every package a component imports without a version → "name@version" (today's latest, from the npm registry)
async function pinPackages(codes) {
  const names = new Set();
  codes.forEach(code => { for (const m of code.matchAll(/(?:^|\n)\s*import\s[^'"]*?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] || m[2]; if (!spec || /^(\.|\/|~\/|@\/|#|src\/|https?:|next(\/|$)|react(-dom)?(\/|$))/.test(spec) || /\.(css|scss|sass|less)$/.test(spec)) continue;
    const n = /^((?:@[^/]+\/)?[^/@]+)(@[^/]+)?/.exec(spec); if (n && !n[2]) names.add(n[1]);
  } });
  const pins = {}, missed = [];
  await Promise.all([...names].map(async n => {
    try { const r = await fetch('https://registry.npmjs.org/' + n.replace('/', '%2F') + '/latest'); const j = await r.json(); if (j.version) pins[n] = n + '@' + j.version; else missed.push(n); }
    catch { missed.push(n); }
  }));
  return { pins, missed };
}
const IMPORT_MAP = { imports: {
  'react': 'https://esm.sh/react@18.3.1', 'react/': 'https://esm.sh/react@18.3.1/',
  'react-dom': 'https://esm.sh/react-dom@18.3.1', 'react-dom/': 'https://esm.sh/react-dom@18.3.1/',
} };

/* ---- live remix: the target page itself, with the user's content swapped in ---- */
function liveContent(m) {
  const v = structuredClone(m), fix = im => im ? { ...im, src: resolveSrc(im.src) } : im;
  v.logo = fix(v.logo); v.hero.img = fix(v.hero.img);
  v.sections.forEach(s => { s.imgs = s.imgs.map(fix); s.cards.forEach(c => { c.img = fix(c.img); }); });
  delete v.images;
  return v;
}
function placeholderDoc(msg) {
  return `<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;font:20px system-ui;color:#6f6a63;background:#f5f3ef;text-align:center;padding:40px">${esc(msg)}</body></html>`;
}
function liveDoc(m, s, opt) {
  const t = state.tgt;
  if (!t || !t.tokens || t.name !== s.target || !t.liveBase) return placeholderDoc(`Load “${s.target}” as the design again to see this animated remix.`);
  const T = t.tokens;
  const brand = s.recolor ? brandColor() : null;
  const from = T.accent || (T.btn && T.btn.bg) || null;
  const recolor = brand && from ? { from, to: brand, mono: !T.accent } : null;
  const ST = state.srcTokens;
  const font = s.myFont && ST ? { stack: ST.bodyFont, faces: ST.faces, links: ST.fontLinks } : null;
  const motion = typeof state !== 'undefined' && state.tgt && state.tgt.tokens && state.tgt.tokens.motion || null;
  const data = { content: liveContent(m), opts: { thumb: !!opt.thumb, recolor, font, motion } };
  const tag = `<script>(${__transplant})(${jsonForScript(data)});<\/script><script>(${__rkUnstick})();<\/script>`;
  const html = injectHeadStart(t.liveBase, SRCDOC_SHIM), i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html + tag;
}
// A design runs here as "about:srcdoc", and plenty of site code builds addresses from its own location
// (new URL(path, location.href)) — that throws, and the loader, split text, 3D… never start. Resolve against the
// page's real address (its <base>) instead. Goes first in <head>, before any of the design's scripts.
function __rkSrcdocShim() {
  var U = window.URL; if (!U || U.__rk) return;
  function P(u, b) {
    if (arguments.length > 1) { try { return new U(u, b); } catch (e) { try { return new U(u, document.baseURI); } catch (e2) { throw e; } } }
    try { return new U(u); } catch (e) { try { return new U(u, document.baseURI); } catch (e3) { throw e; } }
  }
  P.prototype = U.prototype; P.__rk = true;
  ['createObjectURL', 'revokeObjectURL', 'canParse', 'parse'].forEach(function (k) { if (U[k]) P[k] = U[k].bind(U); });
  window.URL = P;
  // Single-page apps (Next.js, Nuxt, SvelteKit…) write their real address into history on start. A sandboxed srcdoc page
  // can't hold another site's address, so that throws and the app falls over to its error screen. Keep the page where it is.
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k]; if (!orig) return;
    history[k] = function (st, t, url) { try { return orig.call(history, st, t, url); } catch (e) { try { return orig.call(history, st, t); } catch (e2) {} } };
  });
  // Storage and cookies throw in a sandboxed page; sites that touch them on start would stop there. Give them a scratch copy.
  function mem() { var d = {}; return { getItem: function (k) { return k in d ? d[k] : null; }, setItem: function (k, v) { d[k] = String(v); }, removeItem: function (k) { delete d[k]; }, clear: function () { d = {}; }, key: function (i) { return Object.keys(d)[i] || null; }, get length() { return Object.keys(d).length; } }; }
  ['localStorage', 'sessionStorage'].forEach(function (k) {
    var ok = false; try { ok = !!window[k] && (window[k].length, true); } catch (e) {}
    if (!ok) try { Object.defineProperty(window, k, { value: mem(), configurable: true }); } catch (e) {}
  });
  try { document.cookie; } catch (e) {
    var jar = '';
    try { Object.defineProperty(document, 'cookie', { get: function () { return jar; }, set: function (v) { var kv = String(v).split(';')[0]; jar = jar ? jar + '; ' + kv : kv; }, configurable: true }); } catch (e2) {}
  }
}
const injectHeadStart = (html, tag) => { const m = /<head[^>]*>/i.exec(html); return m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : tag + html; };
const SRCDOC_SHIM = `<script>(${__rkSrcdocShim})();<\/script>`;
// A design's own scripts run its loader, its reveals and its transitions. When one of them can't finish here (it waits
// on a service, a module or a font that never arrives), the page would sit behind its loading screen or stay
// invisible. This steps in only for what's stuck: animations that do run are left alone.
function __rkUnstick() {
  var W = window, D = document, done = [];
  function cs(el) { return W.getComputedStyle(el); }
  function opaque(c) { var m = /rgba?\(([^)]+)\)/.exec(c.backgroundColor); if (c.backgroundImage && c.backgroundImage !== 'none') return true; if (!m) return false; var a = m[1].split(','); return a.length < 4 || +a[3] > 0.5; }
  function fade(el, how) {
    if (done.indexOf(el) >= 0) return; done.push(el);
    el.style.setProperty('transition', 'opacity .6s ease, visibility 0s linear .6s', 'important');
    el.style.setProperty('opacity', '0', 'important'); el.style.setProperty('pointer-events', 'none', 'important');
    setTimeout(function () { el.style.setProperty('visibility', 'hidden', 'important'); }, 650);
    if (how) try { console.info('[reskin] ' + how); } catch (e) {}
  }
  function show(el) {
    if (done.indexOf(el) >= 0) return; done.push(el);
    el.style.setProperty('transition', 'opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1)', 'important');
    el.style.setProperty('visibility', 'visible', 'important'); el.style.setProperty('opacity', '1', 'important');
    if (/matrix/.test(cs(el).transform)) el.style.setProperty('transform', 'none', 'important');
  }
  // 1. a loading screen: fixed, on top of everything, covering the window, still there
  function covers() {
    var out = [], all = D.body ? D.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length && i < 4000; i++) {
      var el = all[i], c = cs(el); if (c.position !== 'fixed' || c.display === 'none' || c.visibility === 'hidden' || c.opacity === '0') continue;
      var r = el.getBoundingClientRect(); if (r.width < innerWidth * 0.85 || r.height < innerHeight * 0.85 || !opaque(c)) continue;
      var top = D.elementFromPoint(innerWidth / 2, innerHeight / 2); if (top && (el === top || el.contains(top))) out.push(el);
    }
    return out;
  }
  // 2. words and pictures on screen that are still invisible, waiting for a script that won't come
  function stuck() {
    var all = D.body ? D.body.querySelectorAll('h1,h2,h3,h4,p,li,a,button,img,picture,video,figure,[class*="title"],[class*="text"],[class*="reveal"],[data-aos],[data-scroll],[data-animate]') : [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i], r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
      var c = cs(el); if (c.display === 'none') continue;
      if (!(c.visibility === 'hidden' || +c.opacity < 0.05)) continue;
      // hidden on purpose: closed menus, dropdowns, dialogs, tooltips, and anything Reskin itself set aside
      if (el.closest('[data-rk-orig],nav,[role="menu"],[role="dialog"],dialog,[aria-hidden="true"],[class*="menu"],[class*="dropdown"],[class*="modal"],[class*="tooltip"],[class*="popup"],[class*="drawer"]')) continue;
      // only the outermost stuck piece: if its parent is hidden too, the parent is the one to show
      var fixedLayer = false; for (var x = el; x && x !== D.body; x = x.parentElement) if (cs(x).position === 'fixed') { fixedLayer = true; break; }
      if (fixedLayer) continue;
      var p = el.parentElement, pc = p && cs(p);
      if (pc && (pc.visibility === 'hidden' || +pc.opacity < 0.05) && p !== D.body) { if (!p.closest('nav,[role="dialog"],dialog,[class*="menu"],[class*="modal"]')) show(p); continue; }
      show(el);
    }
  }
  var seenAt = new WeakMap();
  function check() {
    covers().forEach(function (el) { var t = seenAt.get(el); if (!t) seenAt.set(el, Date.now()); else if (Date.now() - t > 1500) fade(el, 'a loading screen never finished — hidden so your page shows'); });
    stuck();
  }
  // give the design's own loader time to do its thing first
  setTimeout(function () { check(); setInterval(check, 1200); }, 3500);
  // things that only appear once scrolled to: if they're still invisible a moment after arriving, show them
  var st = 0; addEventListener('scroll', function () { clearTimeout(st); st = setTimeout(stuck, 1400); }, { passive: true });
}
function withProbe(html, id) {
  html = injectHeadStart(html, SRCDOC_SHIM);
  const tag = `<script>(${__probe})(${jsonForScript(id)}, true, 7000);<\/script>`;
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html + tag;
}
function runSandbox(build, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const id = 'r' + Math.random().toString(36).slice(2);
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.className = 'sandbox-runner';
    const done = () => { removeEventListener('message', onMsg); clearTimeout(timer); f.remove(); };
    const onMsg = e => {
      if (e.source !== f.contentWindow || !e.data || e.data.__reskin !== id) return;
      done(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data);
    };
    addEventListener('message', onMsg);
    const timer = setTimeout(() => { done(); reject(new Error('Rendering took too long')); }, timeout);
    f.srcdoc = build(id);
    document.body.appendChild(f);
  });
}

/* ---- files, folders and saved-page assets ---- */
const CODE_EXT = /\.(html?|xhtml|tsx|jsx|ts|js|txt)$/i;
function detectKind(text, name = '') {
  if (/\.(tsx|jsx|ts|js)$/i.test(name)) return 'tsx';
  if (/\.(html?|xhtml)$/i.test(name)) return 'html';
  const t = text.trim();
  if (/^(<!doctype|<html|<head|<body|<meta|<!--)/i.test(t)) return 'html';
  if (/\bimport\s[\s\S]+?\sfrom\s|export\s+(default\s+)?(function|const|class)|className=|=>\s*\(?\s*</.test(t) || /<[A-Z][A-Za-z]*(\.[A-Z]\w*)?[\s>/]/.test(t)) return 'tsx';
  return 'html';
}
async function filesFromDrop(dt) {
  const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  async function walk(entry) {
    if (entry.isFile) { const f = await new Promise((r, j) => entry.file(r, j)); f._path = entry.fullPath; out.push(f); }
    else if (entry.isDirectory) {
      const rd = entry.createReader(); let batch;
      do { batch = await new Promise((r, j) => rd.readEntries(r, j)); for (const e of batch) await walk(e); } while (batch.length);
    }
  }
  for (const e of entries) await walk(e);
  return out;
}
function splitFiles(files) {
  const depth = f => (f._path || f.name).split('/').length;
  const mains = files.filter(f => CODE_EXT.test(f.name) && !/\.js$/i.test(f.name) || /\.(tsx|jsx)$/i.test(f.name)).sort((a, b) => depth(a) - depth(b));
  const main = mains[0] || files.find(f => /\.js$/i.test(f.name) && depth(f) <= 2);
  const assets = new Map();
  files.forEach(f => { if (f !== main) assets.set(f.name.toLowerCase(), f); });
  return { main, assets };
}
const readDataUrl = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(f); });

const TRACKERS = /googletagmanager|google-analytics|gtag\(|\bga\(|doubleclick|connect\.facebook|fbq\(|hotjar|clarity\.ms|segment\.(com|io)|plausible\.io|static\.ads-twitter|analytics\.tiktok|snap\.licdn|klaviyo|_vercel\/insights|_vercel\/speed-insights|cdn\.mxpnl|heap(analytics)?\.|fullstory|posthog|intercom|hs-scripts|hs-analytics|cookiebot|onetrust|cookielaw|complianz|cmplz|cookieyes|iubenda|usercentrics|termly|cookie-script|borlabs|quantcast|didomi|consentmanager/i;
async function prepareHtml(text, assets) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  doc.querySelectorAll('meta[http-equiv]').forEach(m => /security-policy|refresh/i.test(m.getAttribute('http-equiv')) && m.remove());
  const visibleText = clean([...doc.body.querySelectorAll('*')].filter(e => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(e.tagName) && !e.children.length).map(e => e.textContent).join(' '));
  const runScripts = visibleText.length < 40 && !!doc.querySelector('script');
  // A saved page's own address (<base href>, http/https only) lets its root-relative CSS, images and scripts load
  // (Next.js: /_next/...). Anything else — a relative or data: base, a target — is dropped.
  let base = '';
  const baseEl = doc.querySelector('base[href]');
  if (baseEl) { try { const u = new URL(baseEl.getAttribute('href')); if (/^https?:$/.test(u.protocol)) base = u.href; } catch {} }
  doc.querySelectorAll('base').forEach(b => b.remove());
  // trackers never help a design render, and would report every preview back to the site's analytics
  doc.querySelectorAll('script').forEach(s => { if (TRACKERS.test((s.getAttribute('src') || '') + ' ' + s.textContent.slice(0, 3000))) s.remove(); });

  const isRel = u => u && !/^(data:|https?:|blob:|#|mailto:|tel:|javascript:|\/\/)/i.test(u.trim());
  const find = u => {
    if (!isRel(u)) return null;
    let n = u.split(/[?#]/)[0]; try { n = decodeURIComponent(n); } catch {}
    return assets.get(n.split('/').pop().toLowerCase()) || null;
  };
  const missing = new Set();
  const fixCss = async css => {
    if (!css || !assets.size || !/url\(/.test(css)) return css;
    for (const m of [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]) {
      const f = find(m[2]); if (!f || f.size > 6e6) continue;
      const d = await readDataUrl(f); if (d) css = css.split(m[0]).join(`url("${d}")`);
    }
    return css;
  };
  for (const l of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const href = l.getAttribute('href'), f = find(href);
    if (f) { const st = doc.createElement('style'); st.textContent = await fixCss(await f.text()); l.replaceWith(st); }
    else if (isRel(href) && !base) missing.add(href);
  }
  for (const st of doc.querySelectorAll('style')) st.textContent = await fixCss(st.textContent);
  for (const s of doc.querySelectorAll('script[src]')) {
    const src = s.getAttribute('src'), f = find(src);
    if (f) { const ns = doc.createElement('script'); for (const a of s.attributes) if (!/^(src|crossorigin|integrity)$/.test(a.name)) ns.setAttribute(a.name, a.value); ns.textContent = await f.text(); s.replaceWith(ns); }
    else if (isRel(src) && !base && runScripts) missing.add(src);
  }
  for (const el of doc.querySelectorAll('[src],[poster]')) {
    let local = false;
    for (const at of ['src', 'poster']) {
      const v = el.getAttribute(at); if (!isRel(v)) continue;
      const f = find(v);
      if (f && f.size < 6e6) { const d = await readDataUrl(f); if (d) { el.setAttribute(at, d); local = true; } }
      else if (!f && !base && el.tagName !== 'SCRIPT') missing.add(v);
    }
    if (el.hasAttribute('srcset') && (local || !base)) el.removeAttribute('srcset');   // with a base, srcset still resolves
  }
  for (const el of doc.querySelectorAll('[style*="url("]')) el.setAttribute('style', await fixCss(el.getAttribute('style')));
  if (base) { const b = doc.createElement('base'); b.setAttribute('href', base); doc.head.prepend(b); }
  // liveHtml keeps the design's own scripts: the animated remix runs them (sandboxed: allow-scripts only, so no
  // same-origin access, top navigation or popups). html is the script-free copy used for reading and previews.
  const liveHtml = '<!doctype html>\n' + doc.documentElement.outerHTML;
  if (!runScripts) doc.querySelectorAll('script').forEach(s => s.remove());
  const html = '<!doctype html>\n' + doc.documentElement.outerHTML;
  return { html, liveHtml, runScripts, base, missing: [...missing] };
}
function missingNote(missing) {
  if (!missing.length) return '';
  const dirs = [...new Set(missing.map(u => { try { u = decodeURIComponent(u); } catch {} return u.includes('/') ? u.split('/').slice(0, -1).join('/') : ''; }).filter(Boolean))];
  return `${missing.length} linked file${missing.length > 1 ? 's' : ''} missing${dirs.length ? ` from <b>${esc(dirs[0])}</b>` : ''}. Drop the page together with that folder so its CSS and images load.`;
}

/* =========================================================
   4. STYLE GENERATOR
   ========================================================= */
const R = (a, b) => a + Math.random() * (b - a);
const RI = (a, b) => Math.round(R(a, b));
const pick = a => a[Math.floor(Math.random() * a.length)];
const chance = p => Math.random() < p;
const wrapH = h => ((Math.round(h) % 360) + 360) % 360;
const hsl = (h, s, l, a) => `hsl(${wrapH(h)} ${s}% ${l}%${a != null ? ` / ${a}` : ''})`;
function lum(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  return .2126 * lin(f(0)) + .7152 * lin(f(8)) + .0722 * lin(f(4));
}
const ink = (h, s, l, dark = '#111') => lum(wrapH(h), s, l) > 0.2 ? dark : '#fff';

// rgb-array colour helpers (for sampled colours)
const Cx = {
  css: c => c ? (c[3] != null && c[3] < 0.99 ? `rgb(${c[0]} ${c[1]} ${c[2]} / ${c[3]})` : `rgb(${c[0]} ${c[1]} ${c[2]})`) : null,
  mix: (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] * (1 - t) + b[i] * t)).concat(1),
  lum: c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); },
  dist: (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]),
  hue: c => { const [r, g, b] = c.map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return wrapH(h * 60); },
  chroma: c => (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255,
};
Cx.on = c => Cx.lum(c) > 0.2 ? [17, 17, 17, 1] : [255, 255, 255, 1];

const HUES = [[0,'Crimson'],[16,'Ember'],[28,'Tangerine'],[42,'Amber'],[54,'Citrus'],[85,'Lime'],[140,'Emerald'],[165,'Jade'],[180,'Teal'],[195,'Lagoon'],[210,'Azure'],[225,'Cobalt'],[245,'Indigo'],[265,'Violet'],[285,'Orchid'],[305,'Magenta'],[325,'Fuchsia'],[345,'Rose']];
const hueName = h => { h = wrapH(h); let best = HUES[0], d = 999; for (const x of HUES) { const dd = Math.min(Math.abs(x[0] - h), 360 - Math.abs(x[0] - h)); if (dd < d) { d = dd; best = x; } } return best[1]; };

const FONTS = {
  'Inter':'400;600;700;800','DM Sans':'400;500;700','Manrope':'400;600;800','Outfit':'400;600;700','Sora':'400;600;700',
  'Space Grotesk':'400;500;700','JetBrains Mono':'400;700','Unbounded':'400;600;700','Playfair Display':'400;700;900',
  'Source Sans 3':'400;600','DM Serif Display':'400','Archivo Black':'400','Archivo':'400;600','Fraunces':'400;600;800',
  'Syne':'400;700;800','Fredoka':'400;500;600;700','Nunito':'400;700;800','Cormorant Garamond':'400;500;600','Montserrat':'400;500;600',
  'IBM Plex Sans':'400;600;700','IBM Plex Mono':'400;600','Instrument Serif':'400','Bricolage Grotesque':'400;600;800',
  'Work Sans':'400;600','Libre Franklin':'400;600;800','Space Mono':'400;700','Abril Fatface':'400','Poppins':'400;600;700;800',
  'Lora':'400;600','Bebas Neue':'400','Righteous':'400','Plus Jakarta Sans':'400;600;800','Newsreader':'400;600','Rubik':'400;600;800',
};
const F = (d, b, dw = 700) => ({ d, b, dw });

const ARCH = {
  minimal: {
    label: 'Minimal', words: ['Quiet','Clean','Airy','Calm','Still','Pure'],
    fonts: [F('Inter','Inter',700), F('DM Sans','DM Sans',700), F('Manrope','Manrope',800), F('Outfit','Outfit',600), F('Sora','Sora',600), F('Plus Jakarta Sans','Plus Jakarta Sans',800)],
    make(h) {
      const a = [h, RI(60, 80), RI(42, 50)];
      return { pal: { bg:'#fff', surface:hsl(h,25,97), card:'#fff', text:hsl(h,14,9), muted:hsl(h,6,40), accent:hsl(...a), accentText:ink(...a), border:hsl(h,12,90), heroBg:'#fff', heroText:hsl(h,14,9), navBg:'#fff', deco:`linear-gradient(135deg, ${hsl(h,70,90)}, ${hsl(h+40,70,82)})` },
        r: RI(4, 12), bw: 1, shadow: 'none', nav: pick(['bar','center','side']), hero: pick(['center','left','split']), cards: pick(['bordered','plain','filled']),
        alt: chance(.5), centerHeads: chance(.4), dls: '-0.035em', h1: 76 };
    }
  },
  corporate: {
    label: 'Corporate', words: ['Trusted','Steady','Clear','Prime','Solid'],
    fonts: [F('IBM Plex Sans','IBM Plex Sans',600), F('Inter','Inter',700), F('Libre Franklin','Libre Franklin',800), F('Poppins','Poppins',600), F('Plus Jakarta Sans','Plus Jakarta Sans',800), F('Rubik','Rubik',600)],
    make(h) {
      h = pick([205, 215, 225, 240, 160, 175, h]);
      const a = [h, RI(70, 85), RI(42, 50)], darkHero = chance(.45);
      return { pal: { bg:'#fff', surface:hsl(h,40,97), card:'#fff', text:hsl(222,30,12), muted:hsl(222,10,42), accent:hsl(...a), accentText:ink(...a), border:hsl(h,20,90),
          heroBg: darkHero ? hsl(h,55,14) : hsl(h,60,97), heroText: darkHero ? '#fff' : hsl(222,30,12), navBg: darkHero ? hsl(h,55,14) : '#fff', navText: darkHero ? '#fff' : null,
          heroBtnBg: darkHero ? hsl(h,85,60) : null, heroBtnText: darkHero ? ink(h,85,60) : null,
          deco:`linear-gradient(160deg, ${hsl(h,80,60)}, ${hsl(h+30,80,45)})` },
        r: RI(6, 12), bw: 1, shadow: '0 1px 2px rgba(16,24,40,.06), 0 12px 32px -12px rgba(16,24,40,.14)', nav: pick(['bar','bar','side']), hero: pick(['split','left','center']),
        cards: pick(['bordered','bordered','filled']), alt: true, centerHeads: chance(.6), dls: '-0.02em', h1: 62 };
    }
  },
  dark: {
    label: 'Dark & Neon', words: ['Midnight','Neon','Electric','Nocturne','Afterglow','Laser'],
    fonts: [F('Space Grotesk','Space Grotesk',700), F('Sora','Inter',700), F('Unbounded','Inter',700), F('JetBrains Mono','Inter',700), F('Syne','Manrope',800), F('Outfit','Outfit',700)],
    make(h) {
      const h2 = h + pick([0, 40, 160, 200, -60]), a = [h2, RI(90, 100), RI(58, 66)];
      return { pal: { bg:hsl(h,30,6), surface:hsl(h,25,9), card:hsl(h,22,11), text:hsl(h,25,95), muted:hsl(h,12,66), accent:hsl(...a), accentText:hsl(h,30,6), border:hsl(h,20,20),
          heroBg:hsl(h,30,6), heroText:hsl(h,25,96), navBg:hsl(h,30,8),
          heroGlow:`radial-gradient(800px 400px at 70% -10%, ${hsl(h2,95,60,.28)}, transparent), radial-gradient(600px 400px at 10% 110%, ${hsl(h,90,55,.18)}, transparent)`,
          deco:`radial-gradient(circle at 30% 30%, ${hsl(h2,95,62)}, transparent 55%), radial-gradient(circle at 75% 70%, ${hsl(h+80,95,58)}, transparent 50%), ${hsl(h,30,10)}` },
        r: RI(10, 18), bw: 1, shadow: `0 0 0 1px ${hsl(h,20,18)}, 0 24px 60px -24px ${hsl(h2,95,60,.4)}`, btnShadow: `0 0 24px ${hsl(h2,95,60,.45)}`,
        nav: pick(['bar','pill','side']), hero: pick(['center','split','big']), cards: pick(['bordered','filled']), alt: false, centerHeads: chance(.6), dls: '-0.03em', h1: 80 };
    }
  },
  bold: {
    label: 'Bold', words: ['Loud','Punchy','Vivid','Big','Electric','Rally'],
    fonts: [F('Archivo Black','Archivo',400), F('Syne','Manrope',800), F('Bebas Neue','Inter',400), F('Unbounded','Work Sans',700), F('Rubik','Rubik',800), F('Bricolage Grotesque','Inter',800)],
    make(h, font) {
      const a = [h, RI(85, 95), RI(50, 58)], t = ink(...a, hsl(h, 50, 8));
      return { pal: { bg:'#fff', surface:hsl(h,70,96), card:'#fff', text:hsl(h,40,8), muted:hsl(h,10,35), accent:hsl(...a), accentText:t, border:hsl(h,30,88),
          heroBg:hsl(...a), heroText:t, navBg:hsl(...a), navText:t, heroBtnBg:t, heroBtnText:hsl(...a),
          deco:`linear-gradient(135deg, ${hsl(h+30,95,60)}, ${hsl(h-30,95,50)})` },
        r: pick([0, 0, 8, 16]), bw: 2, shadow: 'none', nav: 'bar', hero: pick(['big','big','left']), cards: pick(['bordered','rows','filled']),
        alt: chance(.6), centerHeads: false, caps: font.d === 'Bebas Neue' || chance(.3), dls: font.d === 'Bebas Neue' ? '0.01em' : '-0.04em', h1: font.d === 'Bebas Neue' ? 150 : 108 };
    }
  },
  playful: {
    label: 'Playful', words: ['Bubbly','Sunny','Jolly','Bouncy','Sherbet','Candy'],
    fonts: [F('Fredoka','Nunito',600), F('Poppins','Nunito',800), F('Bricolage Grotesque','Nunito',800), F('Rubik','Rubik',700), F('Righteous','Nunito',400)],
    make(h) {
      const a = [h, RI(85, 95), RI(58, 66)], ink0 = hsl(h, 45, 16);
      return { pal: { bg:hsl(h,90,97), surface:hsl(h+50,85,93), card:'#fff', text:ink0, muted:hsl(h,20,38), accent:hsl(...a), accentText:ink(...a, ink0), border:ink0,
          heroBg:hsl(h,90,97), heroText:ink0, navBg:hsl(h,90,97),
          deco:`radial-gradient(circle at 25% 30%, ${hsl(h+50,90,75)} 0 22%, transparent 23%), radial-gradient(circle at 72% 65%, ${hsl(h-40,90,72)} 0 28%, transparent 29%), ${hsl(h,90,85)}` },
        r: RI(20, 30), btnR: 999, bw: 2, shadow: `5px 6px 0 ${ink0}`, btnShadow: `3px 4px 0 ${ink0}`, nav: pick(['pill','bar']), hero: pick(['split','center']),
        cards: 'bordered', alt: true, centerHeads: true, dls: '-0.02em', h1: 72 };
    }
  },
  elegant: {
    label: 'Elegant', words: ['Velvet','Ivory','Atelier','Linen','Maison','Gilded'],
    fonts: [F('Cormorant Garamond','Montserrat',500), F('Playfair Display','Source Sans 3',400), F('DM Serif Display','DM Sans',400), F('Instrument Serif','Inter',400), F('Newsreader','Inter',400)],
    make(h) {
      const a = [h, RI(25, 40), RI(32, 40)];
      return { pal: { bg:hsl(40,35,97), surface:hsl(38,30,93), card:hsl(40,35,97), text:hsl(30,20,12), muted:hsl(30,8,40), accent:hsl(...a), accentText:'#fff', border:hsl(35,18,82),
          heroBg:hsl(40,35,97), heroText:hsl(30,20,12), navBg:hsl(40,35,97),
          deco:`linear-gradient(180deg, ${hsl(35,30,85)}, ${hsl(h,20,70)})` },
        r: 0, bw: 1, shadow: 'none', nav: 'center', hero: pick(['center','split']), cards: 'plain', alt: chance(.5), centerHeads: true,
        navCaps: true, dls: '-0.01em', h1: 84, heroPad: 150 };
    }
  },
  brutalist: {
    label: 'Brutalist', words: ['Raw','Concrete','Blunt','Block','Grid','Stamp'],
    fonts: [F('Space Mono','Space Mono',700), F('Archivo Black','Space Mono',400), F('JetBrains Mono','JetBrains Mono',700), F('IBM Plex Mono','IBM Plex Mono',600), F('Archivo Black','Archivo',400)],
    make(h) {
      const a = [h, RI(90, 100), RI(55, 62)], hb = [h + pick([60, 120, 180]), 95, 70];
      const bg = chance(.5) ? '#fff' : hsl(h + 180, 70, 92);
      return { pal: { bg, surface:hsl(...hb), card:'#fff', text:'#000', muted:'#222', accent:hsl(...a), accentText:ink(...a, '#000'), border:'#000',
          heroBg:hsl(...hb), heroText:'#000', navBg:bg, deco:`repeating-linear-gradient(45deg, #000 0 2px, ${hsl(...a)} 2px 18px)` },
        r: 0, bw: 3, shadow: '8px 8px 0 #000', btnShadow: '4px 4px 0 #000', nav: 'bar', hero: pick(['left','split']), cards: 'bordered',
        alt: chance(.5), centerHeads: false, caps: true, dls: '-0.02em', h1: 82, bullet: '"→"' };
    }
  },
  retro: {
    label: 'Retro', words: ['Groovy','Vintage','Diner','Analog','Sunset','Vinyl'],
    fonts: [F('Fraunces','Lora',800), F('Righteous','Nunito',400), F('Abril Fatface','Lora',400), F('Bricolage Grotesque','Lora',800), F('Fraunces','Work Sans',600)],
    make(h) {
      h = pick([8, 18, 28, 40, 170, 190, 350, h]);
      const a = [h, RI(65, 78), RI(46, 52)], t = hsl(18, 45, 14);
      return { pal: { bg:hsl(40,60,93), surface:hsl(36,55,86), card:hsl(42,70,96), text:t, muted:hsl(18,20,35), accent:hsl(...a), accentText:ink(...a, t), border:t,
          heroBg:hsl(40,60,93), heroText:t, navBg:hsl(40,60,93),
          deco:`repeating-linear-gradient(180deg, ${hsl(8,75,52)} 0 14%, ${hsl(28,85,55)} 14% 28%, ${hsl(42,90,58)} 28% 42%, ${hsl(175,45,40)} 42% 56%, ${hsl(40,60,93)} 56% 100%)` },
        r: RI(10, 18), btnR: 999, bw: 2, shadow: `5px 5px 0 ${t}`, btnShadow: `3px 3px 0 ${t}`, nav: pick(['bar','center']), hero: pick(['split','center','left']),
        cards: pick(['bordered','filled']), alt: true, centerHeads: chance(.5), dls: '-0.02em', h1: 80 };
    }
  },
  glass: {
    label: 'Glass', words: ['Aurora','Prism','Frost','Halo','Mist','Lucid'],
    fonts: [F('Outfit','Outfit',600), F('Sora','Sora',600), F('Manrope','Manrope',800), F('Plus Jakarta Sans','Plus Jakarta Sans',800), F('Space Grotesk','Inter',600)],
    make(h) {
      const h2 = h + RI(40, 90);
      return { pal: { bg:hsl(h,60,45), bodyBg:`radial-gradient(900px 600px at 0% 0%, ${hsl(h,90,62)}, transparent), radial-gradient(900px 700px at 100% 30%, ${hsl(h2,90,58)}, transparent), linear-gradient(160deg, ${hsl(h,70,40)}, ${hsl(h2,70,30)})`,
          surface:'rgba(255,255,255,.06)', card:'rgba(255,255,255,.12)', text:'#fff', muted:'rgba(255,255,255,.78)', accent:'#fff', accentText:hsl(h,60,32), border:'rgba(255,255,255,.28)',
          heroBg:'transparent', heroText:'#fff', navBg:'rgba(255,255,255,.1)', deco:`linear-gradient(135deg, rgba(255,255,255,.35), rgba(255,255,255,.05))` },
        r: RI(18, 26), btnR: 999, bw: 1, shadow: '0 20px 50px -20px rgba(0,0,0,.35)', nav: 'pill', hero: pick(['center','split']), cards: 'bordered',
        alt: false, centerHeads: true, dls: '-0.03em', h1: 78, glass: true };
    }
  },
  editorial: {
    label: 'Editorial', words: ['Gazette','Journal','Column','Press','Folio','Ledger'],
    fonts: [F('Instrument Serif','Inter',400), F('Playfair Display','Libre Franklin',900), F('Fraunces','Libre Franklin',600), F('Newsreader','Inter',600), F('DM Serif Display','Work Sans',400)],
    make(h) {
      const a = [h, RI(70, 85), RI(40, 46)];
      return { pal: { bg:'#fbf9f4', surface:'#f3efe6', card:'#fbf9f4', text:'#141414', muted:'#555049', accent:hsl(...a), accentText:'#fff', border:'#141414',
          heroBg:'#fbf9f4', heroText:'#141414', navBg:'#fbf9f4', deco:`linear-gradient(135deg, ${hsl(h,40,80)}, ${hsl(h+20,50,55)})` },
        r: 0, bw: 1, shadow: 'none', nav: 'center', hero: pick(['left','big']), cards: pick(['plain','rows']), alt: false, centerHeads: false,
        navCaps: true, dls: '-0.025em', h1: 104, editorial: true };
    }
  },
};
const ARCH_IDS = Object.keys(ARCH);

let uid = 0;
const newId = () => 's' + Date.now().toString(36) + (uid++);
function accentHue(s) { const m = /hsl\((\d+)/.exec(s.pal.accent); return m ? +m[1] : s.hue; }
function makeStyle(arch, o = {}) {
  const A = ARCH[arch];
  const hue = o.hue != null ? o.hue : R(0, 360);
  const font = o.font || pick(A.fonts);
  const spec = A.make(hue, font);
  const st = {
    id: newId(), arch, label: A.label, hue, font, fontLabel: font.d + (font.b !== font.d ? ' + ' + font.b : ''),
    btnR: spec.btnR ?? spec.r, heroPad: 120, secPad: 104, bullet: '"✓"', caps: false, navCaps: false, btnShadow: 'none',
    ...spec, ...(o.layout || {}),
  };
  if (st.nav === 'side') { st.heroPad = 80; st.h1 = Math.min(st.h1, 64); }
  st.name = `${pick(A.words)} ${hueName(accentHue(st))}`;
  return st;
}

/* ---- styles that copy a target design ---- */
const LAYOUT_NAMES = { side: 'Sidebar app', bar: 'Top bar', center: 'Centered nav', pill: 'Floating nav' };
const firstFamily = stack => { const f = (stack || '').split(',')[0].trim().replace(/^["']|["']$/g, ''); return /^(ui-sans-serif|system-ui|-apple-system|sans-serif|BlinkMacSystemFont)$/i.test(f) ? 'System sans' : /^(ui-monospace|monospace)$/i.test(f) ? 'System mono' : f; };
function targetStyle(T, o = {}) {
  const exact = !!o.exact;
  const nav = o.nav || (exact ? (T.side ? 'side' : 'bar') : pick(T.side ? ['side', 'side', 'bar', 'pill'] : ['bar', 'bar', 'center', 'pill', 'side']));
  const hero = o.hero || (exact ? (nav === 'side' ? 'left' : 'center') : pick(['left', 'center', 'split', 'big']));
  const cards = o.cards || (exact ? (T.card ? (T.card.bg && !T.card.bw ? 'filled' : 'bordered') : 'plain') : pick(['bordered', 'bordered', 'filled', 'plain', 'rows']));
  const bg = T.bg, text = T.text, dark = Cx.lum(bg) < 0.3;
  let accent = o.accent || T.accent || (T.btn && T.btn.bg) || text;
  if (!exact && !o.accent && T.palette.length > 1 && chance(.35)) accent = pick(T.palette.slice(1));
  const btnMatches = T.btn && T.btn.bg && Cx.dist(T.btn.bg, accent) < 40;
  const accentText = btnMatches && T.btn.text ? T.btn.text : Cx.on(accent);
  const surface = T.surface || Cx.mix(bg, text, dark ? 0.05 : 0.035);
  const card = T.card && T.card.bg ? T.card.bg : (dark ? Cx.mix(bg, text, 0.05) : (T.surface && Cx.lum(T.surface) > Cx.lum(bg) ? T.surface : bg));
  const border = (T.card && T.card.border) || T.border || Cx.mix(text, bg, 0.86);
  const navArea = nav === 'side' ? (T.side || T.topbar) : (T.topbar || T.side);
  const pal = {
    bg: Cx.css(bg), bodyBg: T.bodyBg ? `${T.bodyBg}, ${Cx.css(bg)}` : null, surface: Cx.css(surface), card: Cx.css(card),
    text: Cx.css(text), muted: Cx.css(T.muted || Cx.mix(text, bg, 0.42)), accent: Cx.css(accent), accentText: Cx.css(accentText),
    border: Cx.css(border), heroBg: Cx.css(bg), heroText: Cx.css(text),
    navBg: Cx.css(navArea ? navArea.bg : bg), navText: Cx.css(navArea ? navArea.text : text),
    deco: `linear-gradient(135deg, ${Cx.css(accent)}, ${Cx.css(Cx.mix(accent, bg, 0.55))})`,
  };
  const r = Math.max(0, Math.min(32, Math.round(T.card ? T.card.radius : (T.btn ? Math.min(T.btn.radius, 16) : 8))));
  const b = T.btn || {};
  const headPx = T.headSize || 32;
  const h1 = nav === 'side' ? Math.max(36, Math.min(60, headPx * 1.3)) : Math.max(44, Math.min(88, headPx * 1.6));
  const headExtra = (T.fontLinks || []).map(l => `<link href="${esc(l)}" rel="stylesheet">`).join('') + (T.faces ? `<style>${T.faces}</style>` : '');
  const extraCss = `.btn{font-weight:${b.weight || 600};${b.transform && b.transform !== 'none' ? `text-transform:${b.transform};` : ''}${b.ls && b.ls !== 'normal' ? `letter-spacing:${b.ls};` : ''}${b.padY ? `padding:${Math.round(Math.max(b.padY, 8) * 1.25)}px ${Math.round(Math.max(b.padX, 14) * 1.2)}px;` : ''}${b.bw ? `border-width:${b.bw}px;` : ''}}`;
  const word = exact ? '' : pick(['Echo', 'Remix', 'Riff', 'Twin', 'Mirror', 'Variant', 'Spin']);
  return {
    id: newId(), arch: 'target', label: `Like ${T.name}`, target: T.name, exact,
    name: exact ? 'Exact match' : `${word} · ${LAYOUT_NAMES[nav]}`,
    fontLabel: firstFamily(T.headFont) + (firstFamily(T.bodyFont) !== firstFamily(T.headFont) ? ' + ' + firstFamily(T.bodyFont) : ''),
    pal, r, btnR: b.radius != null ? Math.min(b.radius, 999) : r, bw: Math.max(1, Math.min(3, Math.round((T.card && T.card.bw) || 1))),
    shadow: (T.card && T.card.shadow) || 'none', btnShadow: b.shadow || 'none',
    fd: T.headFont, fb: T.bodyFont, dw: T.headWeight || 700, dls: `${T.headLs || 0}em`, caps: !!T.headCaps,
    h1: Math.round(h1), heroPad: nav === 'side' ? 72 : 112, secPad: nav === 'side' ? 72 : 96, bullet: '"•"', navCaps: false,
    nav, hero, cards, alt: o.alt ?? (exact ? !!T.surface : chance(.5)), centerHeads: o.centerHeads ?? (exact ? hero === 'center' : chance(.4)),
    headExtra, extraCss, accentRgb: accent,
  };
}

/* =========================================================
   5. RENDER  (content model + style -> full HTML page)
   ========================================================= */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const safeHref = h => /^\s*javascript:/i.test(h || '') ? '#' : (h || '#');
const img = (im, cls = 'img') => `<div class="${cls}" role="img" aria-label="${esc(im.alt)}" style="background-image:url('${String(im.src).replace(/['"()\\\s]/g, c => encodeURIComponent(c))}'), var(--deco)"></div>`;
const btns = (list, extra = '') => list.length ? `<div class="btns ${extra}">${list.slice(0, 3).map((b, i) => `<a class="btn${i ? ' alt' : ''}" ${L(b.href)}>${esc(b.text)}</a>`).join('')}</div>` : '';
const fontLink = names => 'https://fonts.googleapis.com/css2?' + [...new Set(names)].map(n => `family=${n.replace(/ /g, '+')}:wght@${FONTS[n] || '400;700'}`).join('&') + '&display=swap';

/* links: in previews, #anchors scroll, real URLs open in a new tab, unresolvable relative links do nothing */
let LINKOPT = {};
function L(h) {
  h = safeHref(h);
  if (!LINKOPT.preview) return `href="${esc(h)}"`;
  // previews are srcdoc frames: a bare "#shop" resolves against the app's own address and loads the app
  // inside the preview. "about:srcdoc#shop" is the preview itself, so it just scrolls (no scripts needed).
  if (/^#/.test(h)) return `href="about:srcdoc${esc(h)}"`;
  let abs = h;
  if (!/^(https?:|mailto:|tel:)/i.test(h)) {
    if (!LINKOPT.base) return `href="about:srcdoc#" title="${esc(h)}"`;
    try { abs = new URL(h, LINKOPT.base).href; } catch { return 'href="about:srcdoc#"'; }
  }
  return `href="${esc(abs)}" target="_blank" rel="noopener"`;
}

/* Advanced-tab overrides: a chosen palette and hero type apply to every style */
const PALETTES = [
  { name: 'Ocean', accent: [14, 116, 214] }, { name: 'Sunset', accent: [244, 99, 52] }, { name: 'Forest', accent: [22, 128, 80] },
  { name: 'Grape', accent: [124, 58, 237] }, { name: 'Rose', accent: [225, 29, 96] }, { name: 'Gold', accent: [202, 138, 4] },
  { name: 'Midnight', accent: [129, 140, 248], bg: [11, 13, 23], text: [236, 238, 245] },
  { name: 'Paper', accent: [17, 17, 17], bg: [250, 248, 243], text: [20, 20, 20] },
  { name: 'Mint night', accent: [45, 212, 191], bg: [8, 20, 20], text: [224, 242, 240] },
  { name: 'Cream & clay', accent: [194, 84, 45], bg: [250, 243, 232], text: [52, 33, 22] },
];
function withOverrides(s) {
  const P = state.palette, H = state.heroType;
  if (!P && (!H || H === 'auto')) return s;
  const o = { ...s, pal: { ...s.pal } }, p = o.pal;
  if (H && H !== 'auto') o.hero = H;
  if (P && P.bg) {
    const bg = P.bg, text = P.text || Cx.on(bg), dark = Cx.lum(bg) < 0.3;
    Object.assign(p, { bg: Cx.css(bg), bodyBg: null, surface: Cx.css(Cx.mix(bg, text, dark ? 0.06 : 0.04)), card: Cx.css(dark ? Cx.mix(bg, text, 0.07) : Cx.mix(bg, [255, 255, 255], 0.6)),
      text: Cx.css(text), muted: Cx.css(Cx.mix(text, bg, 0.42)), border: Cx.css(Cx.mix(text, bg, 0.84)), heroBg: Cx.css(bg), heroText: Cx.css(text), navBg: Cx.css(bg), navText: Cx.css(text), heroGlow: null });
    if (o.glass) { o.glass = false; }
  }
  if (P && P.accent) {
    const a = P.accent, at = Cx.on(a);
    Object.assign(p, { accent: Cx.css(a), accentText: Cx.css(at), deco: `linear-gradient(135deg, ${Cx.css(a)}, ${Cx.css(Cx.mix(a, [255, 255, 255], 0.45))})` });
    if (s.arch === 'bold' && !P.bg) Object.assign(p, { heroBg: Cx.css(a), navBg: Cx.css(a), heroText: Cx.css(at), navText: Cx.css(at), heroBtnBg: Cx.css(at), heroBtnText: Cx.css(a) });
    else Object.assign(p, { heroBtnBg: null, heroBtnText: null });
  }
  return o;
}
// the brand colour used for animated remixes: picked palette > the user's site > none
function brandColor() {
  if (state.palette && state.palette.accent) return state.palette.accent;
  return state.autoBrand || null;
}

// thumbnails are scaled-down snapshots: no page or inner scrollbars (also inlined in __transplant, which runs inside the frame)
const THUMB_CSS = 'html,body{overflow:hidden!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}';
function renderSite(m, s, opt = {}) {
  if (s.live) return liveDoc(m, s, opt);
  s = withOverrides(s);
  LINKOPT = opt;
  const navLinks = m.nav.map(l => `<li><a ${L(l.href)}>${esc(l.text)}</a></li>`).join('');
  const brand = `<a class="brand" ${L('#')}>${m.logo ? `<img class="logo" src="${esc(m.logo.src)}" alt="${esc(m.logo.alt || m.brand)}">` : ''}${m.logo && m.hideName ? '' : esc(m.brand)}</a>`;
  const cta = m.navCta ? `<a class="btn btn-sm" ${L(m.navCta.href)}>${esc(m.navCta.text)}</a>` : '';
  const nav = `<header class="nav nav-${s.nav}"><div class="wrap">${brand}${navLinks ? `<ul>${navLinks}</ul>` : ''}${cta}</div></header>`;

  const h = m.hero;
  const heroText = `${h.eyebrow ? `<span class="eyebrow">${esc(h.eyebrow)}</span>` : ''}<h1>${esc(h.title)}</h1>${h.paras.slice(0, 2).map(t => `<p>${esc(t)}</p>`).join('')}${btns(h.buttons)}`;
  let hero;
  if (s.hero === 'split') hero = `<section class="hero hero-split"><div class="wrap"><div class="hero-text">${heroText}</div><div class="hero-visual">${h.img ? img(h.img, 'img fill') : '<span class="deco-dot"></span>'}</div></div></section>`;
  else hero = `<section class="hero hero-${s.hero}"><div class="wrap"><div class="hero-text">${heroText}</div>${h.img ? `<div class="hero-media">${img(h.img, 'img fill')}</div>` : ''}</div></section>`;

  const sectionList = m.sections.map((sec, i) => {
    const alt = s.alt && i % 2 === 0 ? ' alt' : '';
    const intro = sec.intro.map(t => `<p>${esc(t)}</p>`).join('');
    const forms = sec.forms.map(fm => `<form class="form" onsubmit="return false">${fm.fields.map(x => `<input placeholder="${esc(x)}">`).join('')}<button class="btn" type="button">${esc(fm.submit)}</button></form>`).join('');
    const idA = sec.id ? ` id="${esc(sec.id)}"` : '';
    if (sec.kind === 'cta') return `<section class="sec"${idA}><div class="wrap"><div class="cta">${sec.title ? `<h2>${esc(sec.title)}</h2>` : ''}${intro}${forms}${btns(sec.buttons, 'center')}</div></div></section>`;
    if (sec.kind === 'quote') {
      const q = sec.quotes.map(qq => `<figure class="quote"><blockquote>${esc(qq.text)}</blockquote>${qq.cite ? `<figcaption>— ${esc(qq.cite)}</figcaption>` : ''}</figure>`).join('');
      return `<section class="sec${alt}"${idA}><div class="wrap">${sec.title ? `<div class="sec-head"><h2>${esc(sec.title)}</h2></div>` : ''}${q}${intro ? `<div class="prose center">${intro}</div>` : ''}${btns(sec.buttons)}</div></section>`;
    }
    const head = sec.title || (sec.kind !== 'text' && intro) ? `<div class="sec-head">${sec.title ? `<h2>${esc(sec.title)}</h2>` : ''}${sec.kind === 'text' ? '' : intro}</div>` : '';
    const prose = sec.kind === 'text' && intro ? `<div class="prose">${intro}</div>` : '';
    const cards = sec.cards.length ? `<div class="cards cards-${s.cards}">${sec.cards.map((c, k) => `<article class="card">${c.img ? img(c.img, 'img card-img') : ''}<span class="num">${String(k + 1).padStart(2, '0')}</span><div><h3>${esc(c.title)}</h3>${c.text.map(t => `<p>${esc(t)}</p>`).join('')}${c.buttons.length ? `<a class="link" ${L(c.buttons[0].href)}>${esc(c.buttons[0].text)} →</a>` : ''}</div></article>`).join('')}</div>` : '';
    const list = sec.lists.length ? `<ul class="list">${sec.lists.map(it => `<li><span>${it.title ? `<b>${esc(it.title)}</b>` : ''}${it.text ? `<span>${esc(it.text)}</span>` : ''}</span></li>`).join('')}</ul>` : '';
    const gallery = sec.imgs.length ? `<div class="gallery">${sec.imgs.map(im => img(im, 'img')).join('')}</div>` : '';
    const quotes = sec.quotes.map(qq => `<figure class="quote small"><blockquote>${esc(qq.text)}</blockquote>${qq.cite ? `<figcaption>— ${esc(qq.cite)}</figcaption>` : ''}</figure>`).join('');
    return `<section class="sec${alt}"${idA}><div class="wrap">${head}${prose}${cards}${list}${gallery}${quotes}${forms}${btns(sec.buttons)}</div></section>`;
  });
  // page body: the normal order, or the site builder's block list
  // (opt.blocks = [{ id, ref: 'hero' | 'section:N', attrs? } | { id, html, attrs? }], each wrapped so it can be found and shown/hidden)
  const sections = opt.blocks
    ? opt.blocks.map(b => `<div class="rk-block" data-block="${esc(b.id)}"${b.attrs || ''}>${b.html != null ? b.html : b.ref === 'hero' ? hero : /^section:\d+$/.test(b.ref || '') ? (sectionList[+b.ref.split(':')[1]] || '') : ''}</div>`).join('\n')
    : hero + sectionList.join('');

  const fl = (m.footerLinks.length ? m.footerLinks : m.nav).map(l => `<li><a ${L(l.href)}>${esc(l.text)}</a></li>`).join('');
  const footer = `<footer><div class="wrap"><div>${brand}${m.footer ? `<p>${esc(m.footer)}</p>` : ''}</div>${fl ? `<ul>${fl}</ul>` : ''}</div></footer>`;

  const body = s.nav === 'side'
    ? `<div class="shell"><aside class="side">${brand}${navLinks ? `<ul>${navLinks}</ul>` : ''}${cta}</aside><main class="main">${sections}${opt.hideFooter ? '' : footer}</main></div>`
    : `${opt.hideNav ? '' : nav}\n${sections}\n${opt.hideFooter ? '' : footer}`;
  const fonts = s.headExtra != null ? s.headExtra
    : `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${fontLink([s.font.d, s.font.b])}" rel="stylesheet">`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.title || m.brand)}</title>
${opt.base ? `<base href="${esc(opt.base)}">` : ''}${fonts}
<style>
${siteCss(s)}${s.extraCss ? '\n' + s.extraCss : ''}${opt.thumb ? '\n' + THUMB_CSS : ''}
</style>${opt.extraHead || ''}
</head>
<body>
${body}${opt.extraBody || ''}
</body>
</html>`;
}

function siteCss(s) {
  const p = s.pal, f = s.font || {};
  const caps = s.caps ? 'uppercase' : 'none';
  return `:root{
  --bg:${p.bg};--body-bg:${p.bodyBg || p.bg};--surface:${p.surface};--card:${p.card};--text:${p.text};--muted:${p.muted};
  --accent:${p.accent};--accent-text:${p.accentText};--border:${p.border};
  --hero-bg:${p.heroBg};--hero-text:${p.heroText};--hero-btn:${p.heroBtnBg || p.accent};--hero-btn-text:${p.heroBtnText || p.accentText};
  --nav-bg:${p.navBg};--nav-text:${p.navText || p.text};--deco:${p.deco};
  --r:${s.r}px;--btn-r:${s.btnR}px;--bw:${s.bw}px;--shadow:${s.shadow};--btn-shadow:${s.btnShadow};
  --fd:${s.fd || `'${f.d}',Georgia,serif`};--fb:${s.fb || `'${f.b}',system-ui,sans-serif`};--dw:${s.dw ?? f.dw};--dls:${s.dls};--h1:${s.h1}px;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--body-bg);color:var(--text);font-family:var(--fb);font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1160px;margin:0 auto;padding:0 40px}
.brand{display:inline-flex;align-items:center;gap:10px}
.brand .logo{height:1.5em;width:auto;max-width:180px;object-fit:contain;border-radius:4px}
h1,h2,h3,.brand{font-family:var(--fd);font-weight:var(--dw);letter-spacing:var(--dls);text-transform:${caps};line-height:1.08}
h1{font-size:clamp(36px,6.5vw,var(--h1))}
h2{font-size:clamp(28px,4vw,${Math.round(Math.max(30, s.h1 * .62))}px);margin-bottom:14px}
h3{font-size:21px;line-height:1.25;margin-bottom:8px}
p{color:var(--muted)}
.img{background-size:cover;background-position:center;border-radius:var(--r);aspect-ratio:4/3}
.img.fill{width:100%;height:100%;aspect-ratio:auto;border-radius:0}

/* nav */
.nav{background:var(--nav-bg);color:var(--nav-text);border-bottom:var(--bw) solid ${s.glass ? 'transparent' : 'var(--border)'};position:relative;z-index:2}
.nav .wrap{display:flex;align-items:center;gap:36px;height:76px}
.nav .brand{font-size:22px;text-decoration:none;margin-right:auto}
.nav ul{display:flex;gap:30px;list-style:none;font-size:15px;font-weight:500}
.nav ul a{text-decoration:none;opacity:.82}
${s.navCaps ? '.nav ul{text-transform:uppercase;letter-spacing:.14em;font-size:12px}' : ''}
.nav-center .wrap{flex-direction:column;height:auto;padding-top:26px;padding-bottom:20px;gap:14px}
.nav-center .brand{margin:0;font-size:30px}
.nav-center .btn{display:none}
${s.editorial ? '.nav-center{border-bottom:3px double var(--border)}' : ''}
.nav-pill{background:transparent;border:0;padding-top:20px;position:relative;z-index:3}
.nav-pill .wrap{background:var(--nav-bg);border:var(--bw) solid var(--border);border-radius:999px;height:62px;padding:0 10px 0 28px;max-width:1080px;box-shadow:var(--shadow);${s.glass ? 'backdrop-filter:blur(14px);' : ''}}
.nav-pill + .hero{margin-top:-82px;padding-top:calc(var(--hp) + 82px)}

/* sidebar app layout */
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;background:var(--nav-bg);color:var(--nav-text);border-right:var(--bw) solid var(--border);padding:26px 16px;display:flex;flex-direction:column;gap:26px;overflow:auto}
.side .brand{font-size:20px;padding:0 12px;text-decoration:none}
.side ul{list-style:none;display:flex;flex-direction:column;gap:2px}
.side ul a{display:block;padding:10px 12px;border-radius:min(var(--r),10px);text-decoration:none;opacity:.78;font-size:15px;font-weight:500}
.side ul li:first-child a{background:color-mix(in srgb, var(--accent) 16%, transparent);color:var(--accent);opacity:1}
.side .btn{margin-top:auto;justify-content:center}
.main{min-width:0}
.main .wrap{max-width:1080px}
.main .hero-big h1{font-size:clamp(40px,5.5vw,calc(var(--h1) * 1.2))}

/* buttons */
.btn{display:inline-flex;align-items:center;gap:8px;padding:15px 28px;font-weight:600;font-size:16px;line-height:1;text-decoration:none;border-radius:var(--btn-r);background:var(--accent);color:var(--accent-text);border:var(--bw) solid var(--accent);box-shadow:var(--btn-shadow);font-family:var(--fb);${s.caps ? 'text-transform:uppercase;letter-spacing:.04em;font-size:14px;' : ''}transition:transform .15s}
.btn:hover{transform:translateY(-2px)}
.btn.alt{background:transparent;color:inherit;border-color:currentColor;box-shadow:none}
.btn-sm{padding:11px 20px;font-size:14px}
.btns{display:flex;gap:14px;flex-wrap:wrap;margin-top:34px}
.btns.center{justify-content:center}
.link{display:inline-block;margin-top:14px;font-weight:600;color:var(--accent);text-decoration:none}

/* hero */
.hero{--hp:${s.heroPad}px;background:${p.heroGlow ? `${p.heroGlow}, ${p.heroBg}` : 'var(--hero-bg)'};color:var(--hero-text);padding:var(--hp) 0;position:relative;overflow:hidden}
.hero p{color:inherit;opacity:.78;font-size:20px;max-width:600px;margin-top:24px}
.hero .btn{background:var(--hero-btn);color:var(--hero-btn-text);border-color:var(--hero-btn)}
.hero .btn.alt{background:transparent;color:var(--hero-text);border-color:currentColor}
.eyebrow{display:inline-block;font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-bottom:22px;padding:7px 14px;border:var(--bw) solid currentColor;border-radius:999px;opacity:.85}
.hero-center{text-align:center}
.hero-center p{margin-left:auto;margin-right:auto}
.hero-center .btns{justify-content:center}
.hero-center h1{max-width:960px;margin:0 auto}
.hero-left h1{max-width:900px}
.hero-big h1{font-size:clamp(52px,10vw,${Math.round(s.h1 * 1.3)}px);line-height:.95;max-width:1100px}
.hero-big p{font-size:22px}
.hero-split .wrap{display:grid;grid-template-columns:1.05fr .95fr;gap:64px;align-items:center}
.hero-visual{aspect-ratio:1/1;border-radius:var(--r);overflow:hidden;background:var(--deco);border:var(--bw) solid var(--border);box-shadow:var(--shadow);position:relative}
.deco-dot{position:absolute;inset:22%;border-radius:${s.r > 10 ? '50%' : s.r + 'px'};background:var(--accent);opacity:.9;${s.arch === 'brutalist' ? 'border:3px solid #000;' : ''}${/^(retro|editorial|elegant|target)$/.test(s.arch) ? 'display:none;' : ''}}
.hero-media{margin-top:64px;aspect-ratio:21/9;border-radius:var(--r);overflow:hidden;border:var(--bw) solid var(--border);box-shadow:var(--shadow)}

/* sections */
.sec{padding:${s.secPad}px 0}
.sec.alt{background:var(--surface)}
.sec-head{max-width:720px;margin-bottom:44px}
${s.centerHeads ? '.sec-head{margin-left:auto;margin-right:auto;text-align:center}' : ''}
${s.editorial ? '.sec-head h2{border-top:2px solid var(--text);padding-top:20px}.sec-head{max-width:none}' : ''}
.sec-head p{font-size:19px}
.sec-head p+p,.prose p+p{margin-top:14px}
.prose{max-width:720px;font-size:19px}
${s.centerHeads ? '.prose{margin:0 auto;text-align:center}' : ''}
${s.editorial ? '.prose{columns:2;column-gap:56px;max-width:none;font-size:18px}.prose p:first-child::first-letter{font-family:var(--fd);float:left;font-size:4.2em;line-height:.85;padding:6px 10px 0 0;color:var(--accent)}' : ''}
.prose.center{text-align:center;margin:28px auto 0}

/* cards */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px}
.card{background:var(--card);border:var(--bw) solid var(--border);border-radius:var(--r);padding:30px;box-shadow:var(--shadow)${s.glass ? ';backdrop-filter:blur(14px)' : ''}}
.card .num{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:${Math.min(s.r, 14)}px;background:var(--accent);color:var(--accent-text);font-family:var(--fd);font-size:16px;margin-bottom:22px}
.card-img{margin:-30px -30px 24px;border-radius:var(--r) var(--r) 0 0;aspect-ratio:16/10}
.cards-plain .card{background:none;border:0;box-shadow:none;border-top:${Math.max(2, s.bw)}px solid var(--text);border-radius:0;padding:26px 0 0}
.cards-plain .num{background:none;color:var(--accent);width:auto;height:auto;display:block;margin-bottom:12px;font-size:15px}
.cards-plain .card-img{margin:0 0 20px;border-radius:var(--r)}
.cards-filled .card{background:var(--surface);border-color:transparent;box-shadow:none}
.sec.alt .cards-filled .card{background:var(--bg)}
.cards-rows{grid-template-columns:1fr;gap:0}
.cards-rows .card{display:grid;grid-template-columns:120px 1fr;gap:24px;align-items:start;background:none;box-shadow:none;border:0;border-top:var(--bw) solid var(--border);border-radius:0;padding:34px 0}
.cards-rows .num{background:none;color:var(--accent);font-size:44px;width:auto;height:auto;margin:0;line-height:1}
.cards-rows .card-img{display:none}
.card p{font-size:16px}

/* list */
.list{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 48px}
.list li{display:flex;gap:16px;padding:20px 0;border-bottom:var(--bw) solid var(--border);font-size:17px}
.list li::before{content:${s.bullet};color:var(--accent);font-weight:700;flex:none}
.list b{display:block;font-family:var(--fd);font-weight:var(--dw);font-size:20px;color:var(--text);${s.caps ? 'text-transform:uppercase;' : ''}}
.list li > span > span{color:var(--muted)}

/* quote */
.quote{max-width:900px;margin:0 auto;text-align:center}
.quote blockquote{font-family:var(--fd);font-weight:var(--dw);font-size:clamp(26px,3.4vw,42px);line-height:1.25;letter-spacing:var(--dls);color:var(--text)}
.quote blockquote::before{content:"“";display:block;font-size:2.4em;line-height:.6;color:var(--accent);margin-bottom:10px}
.quote figcaption{margin-top:24px;color:var(--muted);font-size:15px;letter-spacing:.04em}
.quote.small{margin-top:48px}
.quote.small blockquote{font-size:26px}

/* gallery */
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}
.gallery .img{border:var(--bw) solid var(--border)}

/* cta */
.cta{background:${s.glass ? 'rgba(255,255,255,.14)' : 'var(--accent)'};color:${s.glass ? '#fff' : 'var(--accent-text)'};border-radius:var(--r);padding:80px 48px;text-align:center;border:var(--bw) solid ${s.bw > 1 ? 'var(--border)' : 'transparent'};box-shadow:var(--shadow)${s.glass ? ';backdrop-filter:blur(16px)' : ''}}
.cta p{color:inherit;opacity:.85;font-size:19px;max-width:620px;margin:0 auto}
.cta .btn{background:${s.glass ? '#fff' : 'var(--accent-text)'};color:${s.glass ? p.accentText : 'var(--accent)'};border-color:${s.glass ? '#fff' : 'var(--accent-text)'}}
.cta .btn.alt{background:transparent;color:inherit;border-color:currentColor}

/* form */
.form{display:flex;gap:12px;flex-wrap:wrap;margin-top:32px;justify-content:center}
.form input{flex:1;min-width:220px;max-width:360px;padding:15px 18px;font:inherit;font-size:16px;border:var(--bw) solid var(--border);border-radius:var(--btn-r);background:var(--bg);color:var(--text)}
.cta .form input{border-color:transparent}

/* footer */
footer{border-top:var(--bw) solid var(--border);padding:56px 0;font-size:15px}
footer .wrap{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap;align-items:flex-start}
footer .brand{font-size:22px;text-decoration:none}
footer p{margin-top:8px;font-size:14px}
footer ul{display:flex;gap:26px;list-style:none;flex-wrap:wrap}
footer ul a{text-decoration:none;color:var(--muted)}

@media (max-width:820px){
  .wrap{padding:0 22px}
  .nav ul{display:none}
  .nav .wrap{height:64px}
  .nav-center .wrap{height:auto}
  .hero{--hp:72px}
  .hero-split .wrap{grid-template-columns:1fr;gap:40px}
  .hero p{font-size:18px}
  .sec{padding:72px 0}
  .cta{padding:52px 24px}
  .cards-rows .card{grid-template-columns:1fr;gap:8px}
  .prose{columns:1 !important}
  .hero-media{aspect-ratio:4/3}
  .shell{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;align-items:center;padding:14px 20px;border-right:0;border-bottom:var(--bw) solid var(--border)}
  .side ul{display:none}
  .side .btn{margin:0 0 0 auto}
}`;
}
