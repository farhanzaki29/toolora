/**
 * Static SEO / content checks on a BUILT site.
 *   node tests/seo.test.mjs [distDir] [siteUrl]
 * With a siteUrl the test also checks absolute canonicals, the sitemap and URL-based structured data; build such a
 * copy with:  SITE_URL=https://seo-test.invalid npx astro build --outDir dist-seo   (then delete dist-seo).
 * Without a siteUrl it checks that nothing absolute or invented is emitted.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const site = process.argv[3] ? process.argv[3].replace(/\/+$/, '') : null;
let passed = 0;
let failed = 0;
const ok = (name, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `\n      ${detail}`}`);
};

const htmlFiles = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') && htmlFiles.push(p);
  }
})(dist);
const routeOf = (file) => {
  const r = file.slice(dist.length).replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\/$/, '');
  return r === '' ? '/' : r;
};
const pages = htmlFiles.map((f) => ({ file: f, route: routeOf(f), html: readFileSync(f, 'utf8') })).filter((p) => p.route !== '/404.html');
const is404 = (p) => p.file.endsWith('404.html');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
const first = (html, re) => { const m = re.exec(html); return m ? decode(m[1]) : null; };
const title = (h) => first(h, /<title>([^<]*)<\/title>/);
const desc = (h) => first(h, /<meta name="description" content="([^"]*)"/);
const canonicalOf = (h) => first(h, /<link rel="canonical" href="([^"]*)"/);
const robotsOf = (h) => first(h, /<meta name="robots" content="([^"]*)"/);
const headings = (h) => [...h.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
const jsonLd = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

const all = htmlFiles.map((f) => ({ file: f, route: routeOf(f), html: readFileSync(f, 'utf8') }));
const content = all.filter((p) => !is404(p));
const indexable = content.filter((p) => !robotsOf(p.html)?.includes('noindex'));

console.log(`Checking ${all.length} HTML files in ${dist}${site ? ` as ${site}` : ' (no production URL configured)'}\n`);

/* ---- routes ---- */
const expected = ['/', '/tools', '/about', '/help', '/contact', '/privacy', '/terms', '/tools/image-compressor', '/tools/image-resizer', '/tools/word-counter', '/tools/json-formatter', '/tools/wifi-qr-generator', '/tools/qr-code-generator'];
ok('every expected route is generated and nothing else', JSON.stringify(content.map((p) => p.route).sort()) === JSON.stringify([...expected].sort()), content.map((p) => p.route).sort().join(', '));

/* ---- titles and descriptions ---- */
for (const p of content) {
  const t = title(p.html); const d = desc(p.html);
  ok(`${p.route}: title present, 15-65 chars`, t && t.length >= 15 && t.length <= 65, `"${t}" (${t?.length})`);
  ok(`${p.route}: description 70-165 chars`, d && d.length >= 70 && d.length <= 165, `"${d}" (${d?.length})`);
}
const titles = content.map((p) => title(p.html)); const descs = content.map((p) => desc(p.html));
ok('all titles are unique', new Set(titles).size === titles.length, titles.join(' | '));
ok('all descriptions are unique', new Set(descs).size === descs.length);
ok('no title is just the brand plus a generic word', !titles.some((t) => /^(Tools|About|Contact|Help|Home) · Toolora$/.test(t)), titles.join(' | '));

/* ---- indexing directives ---- */
ok('/terms (draft) is noindex', /noindex/.test(robotsOf(content.find((p) => p.route === '/terms').html) ?? ''));
ok('404 page is noindex', /noindex/.test(robotsOf(all.find(is404).html) ?? ''));
ok('no other page is noindex', indexable.length === content.length - 1, indexable.map((p) => p.route).join(', '));

/* ---- canonical ---- */
if (site) {
  for (const p of indexable) {
    const c = canonicalOf(p.html);
    ok(`${p.route}: canonical is absolute and matches its route`, c === `${site}${p.route === '/' ? '/' : p.route}`, String(c));
    ok(`${p.route}: og:url equals canonical`, first(p.html, /<meta property="og:url" content="([^"]*)"/) === c);
  }
  ok('canonicals are unique', new Set(indexable.map((p) => canonicalOf(p.html))).size === indexable.length);
  ok('noindex pages have no canonical', content.filter((p) => !indexable.includes(p)).every((p) => !canonicalOf(p.html)));
} else {
  ok('no canonical or og:url is emitted without a configured production URL', all.every((p) => !canonicalOf(p.html) && !/og:url/.test(p.html)));
}

/* ---- headings ---- */
for (const p of content) {
  const h = headings(p.html);
  ok(`${p.route}: exactly one h1`, h.filter((n) => n === 1).length === 1, `h1 count ${h.filter((n) => n === 1).length}`);
  const jump = h.findIndex((n, i) => i > 0 && n > h[i - 1] + 1);
  ok(`${p.route}: no heading-level jumps`, jump === -1, `sequence ${h.join('')} jumps at index ${jump}`);
}

/* ---- structured data ---- */
for (const p of content) { let blocks; try { blocks = jsonLd(p.html); } catch (e) { blocks = null; } ok(`${p.route}: all JSON-LD parses`, blocks !== null, 'invalid JSON in ld+json'); }
for (const p of content.filter((c) => c.route.startsWith('/tools/'))) {
  const blocks = jsonLd(p.html); const app = blocks.find((b) => b['@type'] === 'WebApplication'); const faq = blocks.find((b) => b['@type'] === 'FAQPage');
  ok(`${p.route}: WebApplication structured data without prices or ratings`, app && app.name && !/offers|aggregateRating|review|price/i.test(JSON.stringify(app)), JSON.stringify(app));
  ok(`${p.route}: FAQPage matches the visible questions`, faq && faq.mainEntity.length > 0 && faq.mainEntity.every((q) => decode(p.html).includes(q.name) && decode(p.html).includes(q.acceptedAnswer.text.slice(0, 40))), 'FAQ text not visible on the page');
  if (site) { const bc = blocks.find((b) => b['@type'] === 'BreadcrumbList'); ok(`${p.route}: BreadcrumbList with absolute URLs`, bc && bc.itemListElement.length === 3 && bc.itemListElement[0].item === `${site}/` && bc.itemListElement[1].item === `${site}/tools`, JSON.stringify(bc)); ok(`${p.route}: WebApplication url is the canonical`, app.url === canonicalOf(p.html)); }
}
{ const home = jsonLd(content.find((p) => p.route === '/').html); ok(site ? 'home: WebSite structured data with the production URL' : 'home: no WebSite structured data without a production URL', site ? home.some((b) => b['@type'] === 'WebSite' && b.url === `${site}/`) : !home.some((b) => b['@type'] === 'WebSite')); }
ok('no Organization / Review / Rating / address data is invented anywhere', content.every((p) => !/"@type":"(Organization|Review|AggregateRating|PostalAddress|LocalBusiness)"/.test(p.html)));
ok('Help page FAQPage matches its visible questions', (() => { const p = content.find((c) => c.route === '/help'); const f = jsonLd(p.html).find((b) => b['@type'] === 'FAQPage'); return f && f.mainEntity.every((q) => decode(p.html).includes(q.name)); })());

/* ---- robots.txt and sitemap ---- */
const robots = existsSync(join(dist, 'robots.txt')) ? readFileSync(join(dist, 'robots.txt'), 'utf8') : '';
ok('robots.txt exists, allows crawling, blocks nothing', /User-agent: \*/.test(robots) && /Allow: \//.test(robots) && !/Disallow: \S/.test(robots), robots);
ok(site ? 'robots.txt points at the sitemap' : 'robots.txt has no Sitemap line without a production URL', site ? robots.includes(`Sitemap: ${site}/sitemap.xml`) : !/Sitemap:/.test(robots));
const sm = existsSync(join(dist, 'sitemap.xml')) ? readFileSync(join(dist, 'sitemap.xml'), 'utf8') : '';
ok('sitemap.xml exists and is a urlset', /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/.test(sm) && sm.trim().endsWith('</urlset>'));
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (site) {
  const want = indexable.map((p) => `${site}${p.route === '/' ? '/' : p.route}`).sort();
  ok('sitemap lists exactly the canonical, indexable pages', JSON.stringify([...locs].sort()) === JSON.stringify(want), `${locs.length} vs ${want.length}`);
  ok('sitemap has no 404, noindex or development URLs', !locs.some((l) => /404|terms|localhost|127\.0\.0\.1/.test(l)));
  ok('every sitemap URL is also that page\'s canonical', locs.every((l) => indexable.some((p) => canonicalOf(p.html) === l)));
} else {
  ok('sitemap is an empty valid urlset without a production URL (no invented domain)', locs.length === 0);
}

/* ---- links and images ---- */
const exists = (href) => { const clean = href.split('#')[0].split('?')[0]; if (!clean || clean === '/') return true; const base = join(dist, clean.replace(/^\//, '')); return [base, join(base, 'index.html'), `${base}.html`].some((c) => existsSync(c) && statSync(c).isFile()); };
let linkCount = 0; const broken = []; const vague = [];
for (const p of all) {
  for (const m of p.html.matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    linkCount++; if (!exists(m[1])) broken.push(`${p.route} -> ${m[1]}`);
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); if (/^(click here|here|read more|more|link)$/.test(text)) vague.push(`${p.route}: "${text}"`);
  }
}
ok(`all ${linkCount} internal links resolve`, broken.length === 0, broken.slice(0, 5).join('; '));
ok('no vague link text ("click here", "here", "read more")', vague.length === 0, vague.join('; '));
ok('every page is linked from the footer or header (no orphans)', content.every((p) => p.route === '/' || content.some((q) => q !== p && new RegExp(`href="${p.route}"`).test(q.html))), 'orphan page found');
ok('every <img> has alt text', all.every((p) => [...p.html.matchAll(/<img\b[^>]*>/g)].every((m) => /\balt="/.test(m[0]))));
ok('no external scripts, styles or trackers are loaded', all.every((p) => !/<script\b[^>]*src="https?:\/\//.test(p.html) && !/<link\b[^>]*rel="(stylesheet|preload|modulepreload|preconnect|dns-prefetch|prefetch)"[^>]*>/.test(p.html.replace(/<link[^>]*href="\/[^"]*"[^>]*>/g, ''))));
ok('no inline event-handler attributes', all.every((p) => !/<[a-z][^>]*\son(click|load|error|mouseover)=/i.test(p.html)));

/* ---- content accuracy ---- */
const stale = /not (been )?built yet|tools are not yet available|working tools are still to be built|structural placeholder|Five tools|starting with five|planned layout|interface goes here/i;
ok('no stale "tools are not built yet" copy on any page', content.every((p) => !stale.test(p.html.replace(/<script[\s\S]*?<\/script>/g, ''))), content.filter((p) => stale.test(p.html)).map((p) => p.route).join(', '));
for (const p of content.filter((c) => c.route.startsWith('/tools/'))) {
  const text = p.html;
  for (const id of ['howto-title', 'limits-title', 'privacy-title', 'faq-title']) ok(`${p.route}: has the "${id.replace('-title', '')}" section`, text.includes(`id="${id}"`));
}
const privacy = content.find((p) => p.route === '/privacy').html;
ok('privacy page states the theme preference storage honestly', /local storage/.test(privacy) && /theme/.test(privacy));
ok('about page lists every live tool', ['image-compressor', 'image-resizer', 'word-counter', 'json-formatter', 'wifi-qr-generator', 'qr-code-generator'].every((s) => content.find((p) => p.route === '/about').html.includes(`href="/tools/${s}"`)));

console.log(`\n${failed ? `${failed} FAILED, ` : 'All '}${passed} ${failed ? 'passed' : 'checks passed'}`);
process.exit(failed ? 1 : 0);
