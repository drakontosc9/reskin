/* Reskin cloud: optional Supabase accounts + sync.
   Off until config.js has supabaseUrl + supabaseAnonKey. Then: sign in with Google (when switched on in Supabase) or an emailed link,
   and projects / components sync to the tables in supabase/schema.sql. Everything keeps
   working without an account (saved in this browser). */
const Cloud = (() => {
  const cfg = window.RESKIN_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  let sb = null, user = null, timer = null, compTimer = null, syncedCompIds = new Set();

  function widget() {
    let w = document.getElementById('acct');
    if (!w) { w = document.createElement('div'); w.id = 'acct'; w.className = 'acct'; document.querySelector('.top').appendChild(w); }
    if (!enabled) {
      w.innerHTML = `<span class="dot"></span><span title="Add your Supabase details to config.js to sign in and save across devices">Saved in this browser</span>`;
    } else if (!user) {
      w.innerHTML = `<span class="dot"></span><button class="ghost" id="acctIn">Sign in to save</button>`;
      document.getElementById('acctIn').onclick = () => signIn();
    } else {
      w.innerHTML = `<span class="dot on"></span><span title="Your projects and components sync to your account">${esc(user.email || 'Signed in')}</span><button class="ghost" id="acctOut">Sign out</button>`;
      document.getElementById('acctOut').onclick = () => sb.auth.signOut();
    }
  }

  async function init() {
    widget();
    if (!enabled) return;
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
      sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data } = await sb.auth.getSession();
      user = data.session ? data.session.user : null;
      sb.auth.onAuthStateChange((_e, session) => {
        const was = user && user.id; user = session ? session.user : null; widget();
        if (user && user.id !== was) pull();
      });
      widget();
      if (user) pull();
      const bad = returnedWithError(); if (bad && !user) signIn('That didn’t sign you in: ' + bad);
    } catch (e) { console.warn('[reskin] Supabase not available:', e); }
  }

  // which ways in the project allows (Google shows up here by itself once it's switched on in Supabase)
  let ways = null;
  async function signInWays() {
    if (ways) return ways;
    try {
      const r = await fetch(cfg.supabaseUrl + '/auth/v1/settings', { headers: { apikey: cfg.supabaseAnonKey } });
      const d = await r.json(); ways = { google: !!(d.external && d.external.google) };
    } catch { ways = { google: false }; }
    return ways;
  }
  const back = () => location.origin + location.pathname;
  const G_MARK = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  // the sign-in sheet: Google (when it's on), or a link by email. Esc, ✕ or a click outside closes it.
  async function signIn(note) {
    let d = document.getElementById('signin');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'signin'; d.className = 'signin'; d.setAttribute('aria-labelledby', 'siTitle');
      document.body.appendChild(d);
      d.addEventListener('click', e => { if (e.target === d) d.close(); });   // the backdrop
    }
    const w = await signInWays();
    d.innerHTML = `
      <button type="button" class="si-x icon" aria-label="Close">✕</button>
      <div class="si-step" data-step="pick">
        <h2 id="siTitle">Sign in to Reskin</h2>
        <p class="si-sub">Keep your pages and components on every device. Everything still works without an account.</p>
        ${note ? `<p class="si-err" role="alert">${esc(note)}</p>` : ''}
        ${w.google ? `<button type="button" class="si-google">${G_MARK}<span>Continue with Google</span></button><div class="si-or"><span>or</span></div>` : ''}
        <form class="si-form" novalidate>
          <label for="siEmail">Email</label>
          <input id="siEmail" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" aria-describedby="siErr" required>
          <p class="si-err" id="siErr" role="alert" hidden></p>
          <button type="submit" class="primary si-send">Email me a sign-in link</button>
          <p class="si-fine">No password. We’ll email you a link that signs you in.</p>
        </form>
      </div>
      <div class="si-step" data-step="sent" hidden>
        <div class="si-mail" aria-hidden="true">✉</div>
        <h2>Check your email</h2>
        <p class="si-sub">We sent a sign-in link to <b class="si-to"></b>. Open it on this device and you’re in.</p>
        <p class="si-err" id="siErr2" role="alert" hidden></p>
        <div class="si-row"><button type="button" class="ghost si-again">Use a different email</button><button type="button" class="ghost si-resend" disabled>Send again</button></div>
      </div>`;
    const q = sel => d.querySelector(sel);
    const err = (id, msg) => { const e = q('#' + id); e.textContent = msg || ''; e.hidden = !msg; };
    q('.si-x').onclick = () => d.close();
    if (w.google) q('.si-google').onclick = async () => {
      const b = q('.si-google'); b.disabled = true; b.querySelector('span').textContent = 'Opening Google…';
      // your work is saved in this browser, so leaving the page for Google loses nothing
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back() } });
      if (error) { b.disabled = false; b.querySelector('span').textContent = 'Continue with Google'; err('siErr', `Google sign-in didn’t start: ${error.message}`); }
    };
    let to = '', cool = 0;
    const send = async () => {
      const { error } = await sb.auth.signInWithOtp({ email: to, options: { emailRedirectTo: back() } });
      if (error) return error;
      // sending again waits 30 s (Supabase limits how often a link can be sent)
      const r = q('.si-resend'); let n = 30; r.disabled = true; r.textContent = 'Send again (30)'; clearInterval(cool);
      cool = setInterval(() => { n--; r.textContent = n > 0 ? `Send again (${n})` : 'Send again'; if (n <= 0) { clearInterval(cool); r.disabled = false; } }, 1000);
      return null;
    };
    q('.si-form').onsubmit = async e => {
      e.preventDefault();
      const input = q('#siEmail'), v = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { err('siErr', 'That doesn’t look like an email address.'); input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      input.removeAttribute('aria-invalid'); err('siErr', '');
      const b = q('.si-send'); b.disabled = true; b.textContent = 'Sending…'; to = v;
      const error = await send();
      b.disabled = false; b.textContent = 'Email me a sign-in link';
      if (error) return err('siErr', `Couldn’t send the link: ${error.message}`);
      q('.si-to').textContent = to; q('[data-step="pick"]').hidden = true; q('[data-step="sent"]').hidden = false; q('.si-again').focus();
    };
    q('.si-again').onclick = () => { q('[data-step="sent"]').hidden = true; q('[data-step="pick"]').hidden = false; q('#siEmail').focus(); };
    q('.si-resend').onclick = async () => { const error = await send(); err('siErr2', error ? `Couldn’t send it again: ${error.message}` : ''); if (!error) toast('Sent again — check your email'); };
    d.addEventListener('close', () => clearInterval(cool), { once: true });
    if (!d.open) d.showModal();
    (w.google ? q('.si-google') : q('#siEmail')).focus();
  }
  // back from Google (or an expired link) with an error in the address: say so in the sheet, and tidy the address
  function returnedWithError() {
    const p = new URLSearchParams(location.search.slice(1) + '&' + location.hash.replace(/^#/, ''));
    const msg = p.get('error_description'); if (!msg) return null;
    history.replaceState(null, '', location.pathname);
    return msg;
  }

  // cloud → this browser (newer copy wins), then push anything only this browser has
  async function pull() {
    try {
      const [{ data: ps, error: e1 }, { data: cs, error: e2 }] = await Promise.all([
        sb.from('projects').select('id,name,data,updated_at'),
        sb.from('components').select('id,collection,data'),
      ]);
      if (e1 || e2) throw e1 || e2;
      const local = store.get('reskin.projects', []), byId = new Map(local.map(p => [p.id, p]));
      (ps || []).forEach(r => { const l = byId.get(r.id); if (!l || (r.data.updated || 0) > (l.updated || 0)) byId.set(r.id, r.data); });
      store.set('reskin.projects', [...byId.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 20));
      local.filter(p => !(ps || []).some(r => r.id === p.id)).forEach(p => saveProject(p, true));

      const have = new Set(comps.list.map(c => c.id));
      (cs || []).forEach(r => { if (!have.has(r.id)) comps.list.push({ ...r.data, id: r.id, collection: r.collection }); });
      syncedCompIds = new Set((cs || []).map(r => r.id));
      store.set('reskin.components', comps.list);
      syncComponents(comps.list);
      toast('Synced with your account');
      if (['studio', 'library'].includes(state.view)) renderGrid();
    } catch (e) { toast(`Sync failed: ${e.message || e}`, 5000); }
  }

  function saveProject(p, now) {
    if (!sb || !user) return;
    clearTimeout(timer);
    const go = async () => {
      const { error } = await sb.from('projects').upsert({ id: p.id, name: p.name, data: p, updated_at: new Date().toISOString() }, { onConflict: 'user_id,id' });
      if (error) toast(`Couldn’t save to your account: ${error.message}`, 5000);
    };
    if (now) go(); else timer = setTimeout(go, 800);
  }

  function syncComponents(list) {
    if (!sb || !user) return;
    clearTimeout(compTimer);
    compTimer = setTimeout(async () => {
      const rows = list.map(c => ({ id: c.id, collection: c.collection || 'My kit', data: c, updated_at: new Date().toISOString() }));
      if (rows.length) { const { error } = await sb.from('components').upsert(rows, { onConflict: 'user_id,id' }); if (error) return toast(`Couldn’t save components: ${error.message}`, 5000); }
      const gone = [...syncedCompIds].filter(id => !list.some(c => c.id === id));
      if (gone.length) await sb.from('components').delete().in('id', gone);
      syncedCompIds = new Set(list.map(c => c.id));
    }, 800);
  }

  init();
  return { saveProject, syncComponents, get user() { return user; }, enabled };
})();
window.Cloud = Cloud;
