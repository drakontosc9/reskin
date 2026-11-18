# Reskin

Paste your site — see it reimagined. See a component you like — drag it onto your site. Easy as pie.

- **Explore** — paste your site (and, optionally, a design you love), press **Generate**.
- **Studio** — one stage: your page, your components beside it, styles underneath.
  - **Drag a component onto your page.** While you drag, the page shows what will happen: *Replace "Shop now"*
    over a button (it keeps that button's words and link), *Add it here* over a card or picture, or a line with
    *New section here* between sections. Drop, and it's placed — with **Undo**.
  - **Get components in** by pasting a link (uiverse, 21st.dev, MUI, GitHub) or code, uploading a file, or
    dropping a file, a picture or a component's link from another tab straight onto your page.
  - Components keep working on the stage. Point at one for **Swap · Size · Remove**. Double-click any words to
    edit them; right-click to hide or show.
  - The **filmstrip** restyles your page — and Reskin itself wears the style you pick (◐ turns that off).
    **⚙** holds colour palette, hero type and images.
- **Library** — styles and components you keep, sorted into categories. **✂ Grab from a page** saves a part of
  any saved page as a component; **Import icons (.zip)** adds an icon set.

Everything runs in your browser; pages are rendered in sandboxed frames.

## Files

| File | What it is |
|---|---|
| `index.html` | the page and its styles |
| `engine.js` | content extraction, sandbox, animated remix engine, style generator, renderer |
| `app.js` | Explore, styles, the component library, page settings |
| `builder.js`, `builder.css` | component page; `composeDoc` builds the finished page |
| `studio.js`, `studio.css` | Studio stage: drag-and-drop with live preview, placing + Undo, hover toolbar, filmstrip; the in-page runtime |
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
