/**
 * Single source of truth for brand + site-wide copy.
 * Change `name` here and it updates the header, footer, <title> and meta tags.
 */
export const site = {
  name: 'Toolora',
  tagline: 'Simple, fast online tools',
  description:
    'Free online tools that run in your browser: compress and resize images, count words, format JSON and generate WiFi QR codes.',
  // Company / legal links used in the footer. Point these at real pages later.
  links: {
    about: '/#about',
    contact: '/contact',
    privacy: '/privacy',
    terms: '/terms',
  },
  // Primary navigation (tools are added automatically from src/data/tools.js)
  nav: [
    { label: 'Tools', href: '/#tools' },
    { label: 'Why Toolora', href: '/#benefits' },
    { label: 'About', href: '/#about' },
  ],
};
