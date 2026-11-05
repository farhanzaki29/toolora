# Toolora (Astro)

```bash
npm install
npm run dev      # http://localhost:4321
npm run build
```

- **Brand name and site copy:** `src/config/site.js`.
- **Tools:** `src/data/tools.js`. Add an object to add a card, a footer link, a search entry, a tool page (`/tools/<slug>`), its sitemap entry and its page content (how to use, limits, privacy, FAQ). Add its icon to `src/components/Icon.astro` and its workspace to `src/pages/tools/[slug].astro`.
- **Design tokens:** top of `src/styles/global.css`.
- **Production URL (required before launch):** the domain is not configured yet. Build with `SITE_URL=https://your-domain npm run build` (or edit `astro.config.mjs`). That enables absolute canonical URLs, Open Graph URLs, breadcrumb and website structured data, the sitemap entries and the `Sitemap:` line in `robots.txt`. Without it the site builds, but those items are left out on purpose.
- **Tests:** `node tests/<name>.test.mjs` for each tool, and `node tests/seo.test.mjs` (builds nothing; it inspects `dist/`). The `*.browser.mjs` files are run in the browser pane against the dev server.
- `/terms` is a draft and is marked `noindex` until real terms are written.
