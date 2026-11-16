/**
 * Reskin component proxy (Cloudflare Worker)
 *
 *   GET https://<worker>.workers.dev/?url=<https url>
 *
 * Fetches a page from a short allow-list of component sites so Reskin can import
 * components by link when it's hosted on GitHub Pages (those sites block direct
 * fetches from other websites). Same rules as serve.py:
 *   - GET only, https only, only the hosts in ALLOWED_HOSTS
 *   - answers only pages served from ALLOWED_ORIGINS (set in wrangler.toml)
 *   - responses capped at 6 MB
 */
const ALLOWED_HOSTS = new Set([
  'uiverse.io', 'www.uiverse.io',
  '21st.dev', 'www.21st.dev',
  'mui.com', 'www.mui.com',
  'raw.githubusercontent.com', 'api.github.com',
]);
const MAX_BYTES = 6 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

export default {
  async fetch(request, env) {
    const origins = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = origins.includes('*') ? '*' : origins.includes(origin) ? origin : '';
    const cors = { 'Access-Control-Allow-Origin': allowOrigin || 'null', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
    const reply = (status, body, type = 'text/plain; charset=utf-8') => new Response(body, { status, headers: { ...cors, 'Content-Type': type } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return reply(405, 'Only GET is supported.');
    if (!allowOrigin) return reply(403, `This proxy only answers Reskin pages (origin “${origin || 'none'}” is not allowed).`);

    const target = new URL(request.url).searchParams.get('url') || '';
    let t;
    try { t = new URL(target); } catch { return reply(400, 'Add ?url=<https address>.'); }
    if (t.protocol !== 'https:' || !ALLOWED_HOSTS.has(t.hostname)) return reply(403, 'This address is not on the allow-list.');

    let res;
    try {
      res = await fetch(t.toString(), { headers: { 'User-Agent': UA, 'Accept': '*/*' }, redirect: 'follow', cf: { cacheTtl: 300, cacheEverything: true } });
    } catch (e) {
      return reply(502, `Could not reach the site: ${e.message}`);
    }
    if (!res.ok) return reply(res.status, `The site answered ${res.status}.`);
    const len = Number(res.headers.get('Content-Length') || 0);
    if (len > MAX_BYTES) return reply(413, 'Page too large.');
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return reply(413, 'Page too large.');
    return reply(200, body, res.headers.get('Content-Type') || 'text/plain; charset=utf-8');
  },
};
