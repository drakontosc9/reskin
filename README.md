# Reskin

Paste your site — see it reimagined. Your content stays the same; only the design changes.

Three tabs — a journey, not a sitemap:

- **Explore** — the landing: paste your site (and, optionally, a design you love), press **Generate**.
- **Studio** — the stage: your page in the middle, a **filmstrip** of generated styles underneath (click one to
  put it on; ♡ to keep it; *More like this*, *Shuffle*, moods). **Reskin itself wears the style you pick** —
  its colours and fonts follow your page (◐ in the header turns that off). Three modes:
  - **Edit** — drag (or click, then click the page) a component onto any button, heading, picture, card or
    section; plain questions, a one-sentence check, done. Components become **bento tiles** that the page
    reflows around (or *keep everything where it is*). **Right-click** anything for *Edit text* (or double-click
    to type right on the page), *Configure…*, *Replace with a component…*, *Link to…*, *Hide*, *Undo*.
  - **Blocks** — the page as a stack of parts: drag to reorder, hide, add, and *when it shows* rules.
  - **🔗 Links** — a node view: wire buttons and the parts inside components (folders, files, menu items) to
    sections, popups or web pages.
  - **⚙** — page settings: colour palette, hero type, which images go where.
- **Library** — everything you keep: saved styles and components (by link from uiverse / MUI / 21st.dev, pasted
  code, or files). **✂ Grab from a page**: open any saved page, click the part you want (Bigger / Smaller to
  adjust) and save it as a component, with its look, fonts and images. **Import icons (.zip)** turns a zip of
  SVGs into an icon collection. Click a component for its own page: preview, variations, add to your site.

Everything runs in your browser; pages are rendered in sandboxed frames.

## Files

| File | What it is |
|---|---|
| `index.html` | the page and its styles |
| `engine.js` | content extraction, sandbox, animated remix engine, style generator, renderer |
| `app.js` | Explore, styles, the component library, page settings |
| `builder.js`, `builder.css` | component page, the Blocks editor; `composeDoc` builds the finished page |
| `studio.js`, `studio.css` | Studio stage: filmstrip, Edit / Blocks / Links, bento tiles, click actions, popups, right-click menu |
| `shell.js` | the three tabs, Library, ⚙ sheet, the app wearing your style, grab-from-a-page, icon zips |
| `serve.py` | local server + link-import proxy |
| `cloud.js`, `config.js` | optional Supabase accounts and sync |
| `supabase/schema.sql` | database tables + security rules for Supabase |

## Accounts and cloud saving (Supabase, optional)

Without it (empty `config.js`), projects and components are saved in the visitor's browser. To add sign-in and saving across devices:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project: **SQL Editor → New query**, paste `supabase/schema.sql`, **Run**.
3. **Authentication → URL Configuration**: add your site address (e.g. `https://drakontosc9.github.io/reskin/`) to *Redirect URLs*.
4. **Project Settings → API**: copy the *Project URL* and the *anon / publishable* key into `config.js`.

People then sign in with an emailed link (no password). The database rules only let each person read and change their own rows.

## Run locally

```bash
python serve.py
```

then open http://localhost:8766. (Opening `index.html` directly also works.)

## Link import proxy

uiverse.io and 21st.dev block fetches from other websites, so link import goes through a tiny
allow-listed proxy: `serve.py` locally, or the Cloudflare Worker in [`cloudflare-proxy/`](cloudflare-proxy/)
when hosted (e.g. on GitHub Pages). To deploy your own:

```bash
cd cloudflare-proxy
npx wrangler deploy
```

Add the page address(es) that may use it to `ALLOWED_ORIGINS` in `wrangler.toml`, and set the
Worker address in `DEFAULT_PROXY` in `app.js` (or in the Components tab's *Link proxy* field).
