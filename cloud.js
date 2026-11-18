/* Reskin cloud: optional Supabase accounts + sync.
   Off until config.js has supabaseUrl + supabaseAnonKey. Then: email magic-link sign-in,
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
      document.getElementById('acctIn').onclick = signIn;
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
    } catch (e) { console.warn('[reskin] Supabase not available:', e); }
  }

  async function signIn() {
    const email = prompt('Your email address — we’ll send you a sign-in link (no password needed):');
    if (!email) return;
    const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin + location.pathname } });
    toast(error ? `Couldn’t send the link: ${error.message}` : 'Check your email and click the sign-in link', 6000);
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
      if (['components', 'build', 'component', 'studio'].includes(state.view)) renderGrid();
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
