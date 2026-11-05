# Toolora homepage (Astro)

```bash
npm install
npm run dev      # http://localhost:4321
npm run build
```

- **Brand name:** `src/config/site.js` (`name`), the only place to edit.
- **Tools:** `src/data/tools.js`. Add an object to add a card, footer link and search entry. Add its icon to `src/components/Icon.astro`.
- **Design tokens:** top of `src/styles/global.css`.
- Tool pages (`/tools/<slug>`), `/contact`, `/privacy` and `/terms` are not built yet, so those links 404 for now.
