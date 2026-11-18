# Reskin

Paste your site — see it reimagined. Your content stays the same; only the design changes.

- **Explore** — dozens of generated styles for your page, save the ones you like, download the HTML.
- **Studio** — three connected workspaces on one project:
  - **Site** — pick a template for your page.
  - **Component** — your saved UI pieces (in your account when signed in). *Apply its style…* restyles all your
    buttons to match one, or makes new templates from it.
  - **Editor** — drag a component onto a button, heading, picture, card or section of your page (or click it, then
    click the page). Studio asks plain questions — new or replacing? what does it say? what happens when it's
    clicked (scroll, link, popup)? — shows a one-sentence summary, and writes the code. Components become
    **bento tiles**: the parts around them reflow (sizes Auto, 1×1, 2×1, 1×2, 2×2, full width), or choose
    *Keep everything where it is*. *Try it* makes buttons and popups work in the preview.
  - **🔗 Links** — a node view of everything clickable: your page's buttons and the parts *inside* placed components
    (folders, files, menu items) on the left; sections, back to top, popups and web pages on the right. Drag a
    wire (or click one dot, then the other) to link them; click a wire to remove it.
- **I want it to look like…** — drop a design (saved `.htm` page with its `_files` folder, or a `.tsx`/`.jsx` component) and get your site in that design, including an *animated remix* that keeps the original page's effects.
- **Advanced** — choose a colour palette and hero type; drag images into logo / hero / feature slots.
- **Components** — save UI pieces from uiverse.io, MUI and 21st.dev (by link or pasted code) into collections and use them as the design.

- **Component** — preview one component on its own, with variations (your brand colour, your words), and add it to your site.
- **Build** — your site as a stack of parts: drag to reorder, hide, replace a part with a component or add a new one. A step-by-step
  *wire up* panel asks what it replaces, what it should say, and when it shows (screens, after scrolling / a few seconds, dates).
  **Download site** gives you the finished page as one HTML file.

Everything runs in your browser; pages are rendered in sandboxed frames.

## Files

| File | What it is |
|---|---|
| `index.html` | the page and its styles |
| `engine.js` | content extraction, sandbox, animated remix engine, style generator, renderer |
| `app.js` | Explore / Saved / Advanced / Components tabs |
| `builder.js`, `builder.css` | Component page + Build tab; `composeDoc` builds the finished page |
| `studio.js`, `studio.css` | Studio tab: Site / Component / Editor, bento tiles, click actions, popups |
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
