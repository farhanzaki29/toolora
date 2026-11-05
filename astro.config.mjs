import { defineConfig } from 'astro/config';

// The production URL is NOT known yet, so it is not hard-coded. Set it when you deploy:
//   SITE_URL=https://your-domain.example npm run build
// (or replace `siteUrl` below). With it set, every page gets an absolute canonical URL, Open Graph URL and
// breadcrumb structured data, and /sitemap.xml and /robots.txt list the real addresses.
// Without it the site still builds; canonical tags, the sitemap and URL-based structured data are simply omitted.
const siteUrl = process.env.SITE_URL?.trim();

// https://astro.build/config
export default defineConfig({
  ...(siteUrl ? { site: siteUrl } : {}),
});
