/**
 * Tool registry. To add a tool: add an object here (and an icon in components/Icon.astro).
 * Cards, footer links, nav dropdown and search all read from this file.
 * `status: 'live'` shows in Featured tools; `'planned'` shows in the "More tools" section.
 */
export const tools = [
  {
    slug: 'image-compressor',
    name: 'Image Compressor',
    description: 'Reduce JPG, PNG and WebP file sizes while keeping them looking sharp.',
    icon: 'compress',
    category: 'Images',
    keywords: 'photo jpg png webp shrink optimize size',
    status: 'live',
  },
  {
    slug: 'image-resizer',
    name: 'Image Resizer',
    description: 'Resize images to exact dimensions or percentages for web, social or print.',
    icon: 'resize',
    category: 'Images',
    keywords: 'photo dimensions scale width height crop',
    status: 'live',
  },
  {
    slug: 'word-counter',
    name: 'Word Counter',
    description: 'Count words, characters, sentences and estimate reading time as you type.',
    icon: 'text',
    category: 'Text',
    keywords: 'characters sentences reading time writing',
    status: 'live',
  },
  {
    slug: 'json-formatter',
    name: 'JSON Formatter',
    description: 'Format, validate and minify JSON with clear, readable error messages.',
    icon: 'braces',
    category: 'Developer',
    keywords: 'validate beautify minify pretty print developer',
    status: 'live',
  },
  {
    slug: 'wifi-qr-generator',
    name: 'WiFi QR Generator',
    description: 'Create a QR code guests can scan to join your WiFi network instantly.',
    icon: 'wifi',
    category: 'Utilities',
    keywords: 'wifi qr code network password guest share',
    status: 'live',
  },

  // Roadmap placeholders — shown in the "More tools" section. Edit freely.
  { slug: 'base64', name: 'Base64 Encoder', description: 'Encode and decode text.', icon: 'code', category: 'Developer', keywords: '', status: 'planned' },
  { slug: 'color-picker', name: 'Color Converter', description: 'HEX, RGB and HSL in one place.', icon: 'palette', category: 'Design', keywords: '', status: 'planned' },
  { slug: 'pdf-tools', name: 'PDF Tools', description: 'Merge, split and organize PDFs.', icon: 'file', category: 'Documents', keywords: '', status: 'planned' },
  { slug: 'case-converter', name: 'Case Converter', description: 'Switch between text cases.', icon: 'case', category: 'Text', keywords: '', status: 'planned' },
];

export const liveTools = tools.filter((t) => t.status === 'live');
export const plannedTools = tools.filter((t) => t.status === 'planned');
export const toolHref = (tool) => `/tools/${tool.slug}`;
