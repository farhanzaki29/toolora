import type { APIRoute } from 'astro';

// Everything public may be crawled. The Sitemap line is only written once the production URL is configured,
// because a sitemap needs absolute URLs and a wrong domain would be worse than none.
export const GET: APIRoute = ({ site }) => {
  const lines = ['User-agent: *', 'Allow: /'];
  if (site) lines.push('', `Sitemap: ${new URL('/sitemap.xml', site).href}`);
  return new Response(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
