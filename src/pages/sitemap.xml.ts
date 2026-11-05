import type { APIRoute } from 'astro';
import { indexableRoutes, absoluteUrl } from '../lib/seo.js';

// Lists only canonical, indexable pages (no 404, no noindex drafts, no placeholder tools).
// Without a configured production URL there are no valid absolute addresses, so the file is an empty, valid urlset.
export const GET: APIRoute = ({ site }) => {
  const urls = site ? indexableRoutes().map((r) => `  <url><loc>${absoluteUrl(site, r)}</loc></url>`).join('\n') : '';
  const note = site ? '' : '  <!-- Set SITE_URL when building for production to list the pages here. -->\n';
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${note}${urls}${urls ? '\n' : ''}</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
