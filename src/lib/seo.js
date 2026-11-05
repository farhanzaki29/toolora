/**
 * SEO helpers: canonical URLs, the list of indexable routes, and JSON-LD builders.
 * Pure functions (no DOM). Absolute URLs are only produced when the production URL is configured (astro `site`).
 */
import { liveTools, toolHref } from '../data/tools.js';

/** Routes that must not be indexed (drafts, error pages). They are also left out of the sitemap. */
export const NOINDEX_ROUTES = ['/terms'];

/** Every indexable route, in sitemap order. Built from the tool registry so new tools are included automatically. */
export const indexableRoutes = () => [
  '/',
  '/tools',
  ...liveTools.map(toolHref),
  '/about',
  '/help',
  '/contact',
  '/privacy',
].filter((r) => !NOINDEX_ROUTES.includes(r));

/** "/tools/" and "/tools/index.html" both become "/tools"; the home page stays "/". */
export function normalizePath(pathname = '/') {
  const p = pathname.replace(/index\.html$/, '').replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** Absolute URL for a path, or null when no production URL is configured. */
export function absoluteUrl(site, pathname) {
  if (!site) return null;
  return new URL(normalizePath(pathname), site).href;
}

/** JSON for a <script type="application/ld+json"> tag; "<" is escaped so content can never close the tag. */
export const jsonLdString = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

/** BreadcrumbList. `items` = [{ label, href? }] (Home is added). Needs absolute URLs, so null without a site. */
export function breadcrumbLd(site, items) {
  if (!site) return null;
  const all = [{ label: 'Home', href: '/' }, ...items];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: all.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(site, item.href) } : {}),
    })),
  };
}

/** WebApplication for one tool. Only facts that are visible on the page; no ratings, reviews or prices. */
export function toolLd(site, tool) {
  const url = absoluteUrl(site, toolHref(tool));
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: tool.name,
    description: tool.metaDescription ?? tool.description,
    applicationCategory: tool.appCategory ?? 'UtilitiesApplication',
    operatingSystem: 'Any (runs in a web browser)',
    browserRequirements: 'Requires JavaScript',
    ...(url ? { url } : {}),
  };
}

/** FAQPage, built from the same questions that are printed on the page. */
export function faqLd(faq) {
  if (!faq?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/** WebSite for the home page. Needs the URL, so null without a site. */
export function websiteLd(site, { name, description }) {
  if (!site) return null;
  return { '@context': 'https://schema.org', '@type': 'WebSite', name, description, url: absoluteUrl(site, '/') };
}
