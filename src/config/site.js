/**
 * Single source of truth for brand + site-wide copy and navigation.
 * Change `name` here and it updates the header, footer, <title> and meta tags.
 */
export const site = {
  name: 'Toolora',
  tagline: 'Simple, fast online tools',
  description:
    'Free online tools that run in your browser: compress and resize images, count words, format JSON and create QR codes.',
  // Page routes used across the site.
  links: {
    home: '/',
    tools: '/tools',
    about: '/about',
    help: '/help',
    contact: '/contact',
    privacy: '/privacy',
    terms: '/terms',
  },
  // Primary navigation (shown in the header, desktop and mobile).
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Tools', href: '/tools' },
    { label: 'About', href: '/about' },
    { label: 'Help', href: '/help' },
    { label: 'Contact', href: '/contact' },
  ],
  // Footer link groups. The "Tools" group is generated from src/data/tools.js.
  footer: [
    {
      title: 'Company',
      links: [
        { label: 'About', href: '/about' },
        { label: 'Contact', href: '/contact' },
      ],
    },
    {
      title: 'Support',
      links: [{ label: 'Help / FAQ', href: '/help' }],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Privacy Policy', href: '/privacy' },
        { label: 'Terms of Use', href: '/terms' },
      ],
    },
  ],
};
