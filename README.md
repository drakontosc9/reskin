# Reskin

Paste your site — see it reimagined. Your content stays the same; only the design changes.

- **Explore** — dozens of generated styles for your page, save the ones you like, download the HTML.
- **I want it to look like…** — drop a design (saved `.htm` page with its `_files` folder, or a `.tsx`/`.jsx` component) and get your site in that design, including an *animated remix* that keeps the original page's effects.
- **Advanced** — choose a colour palette and hero type; drag images into logo / hero / feature slots.
- **Components** — save UI pieces from uiverse.io, MUI and 21st.dev (by link or pasted code) into collections and use them as the design.

Everything runs in your browser; pages are rendered in sandboxed frames.

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
Worker address in `DEFAULT_PROXY` in `index.html` (or in the Components tab's *Link proxy* field).
