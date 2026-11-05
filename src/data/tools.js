/**
 * Tool registry. To add a tool: add an object here (and an icon in components/Icon.astro).
 * Cards, footer links, nav dropdown, search, the sitemap and tool-page content all read from this file.
 * `status: 'live'` shows in Featured tools; `'planned'` shows in the "More tools" section.
 *
 * Fields used by tool pages:
 *   metaTitle / metaDescription  <title> and meta description (the brand is appended to the title)
 *   audience   who it is for        howTo[]   numbered steps     limits[]   things worth knowing
 *   privacy    what happens to the user's data (must match the implementation)
 *   faq[]      visible questions and answers; also emitted as FAQPage structured data
 *   appCategory  schema.org applicationCategory
 */
export const tools = [
  {
    slug: 'image-compressor',
    name: 'Image Compressor',
    description: 'Reduce JPG, PNG and WebP file sizes while keeping them looking sharp.',
    metaTitle: 'Image Compressor for JPG, PNG and WebP',
    metaDescription:
      'Compress JPG, PNG and WebP images in your browser. Pick a quality preset, convert formats and download single files or a ZIP. Nothing is uploaded.',
    icon: 'compress',
    tone: 'sage',
    category: 'Images',
    appCategory: 'MultimediaApplication',
    keywords: 'photo jpg png webp shrink optimize size',
    summary: 'Make image files smaller so pages load faster and uploads fit size limits, without giving up visible quality.',
    audience: 'Useful for anyone who needs lighter photos for a website, an email attachment or a form with a file-size limit.',
    benefits: [
      'Smaller files for websites, email and uploads',
      'Aims to keep images looking sharp',
      'Designed around common formats such as JPG, PNG and WebP',
    ],
    howTo: [
      'Add your images by dragging them onto the page or choosing them from your device. You can add several at once.',
      'Choose a quality preset (High Quality, Balanced or Smaller File) or set your own quality, and pick an output format.',
      'Select Compress, then check the before and after sizes for each image.',
      'Download images one by one, or download them all as a single ZIP file.',
    ],
    limits: [
      'Accepts JPG, PNG and WebP files, up to 100 MB and 100 megapixels each. The file contents are checked, not just the extension.',
      'PNG is lossless, so it may not get smaller. If a result is not smaller than the original, the tool says so and lets you keep the original.',
      'Animated images are not supported; only a single frame is processed. EXIF details such as camera model and location are not copied into the compressed file.',
    ],
    privacy:
      'Images are decoded, compressed and encoded by your browser on your own device. They are not uploaded, and no file or setting is saved.',
    faq: [
      { q: 'Does Image Compressor upload my pictures?', a: 'No. The compression runs in your browser, so the images stay on your device and are not uploaded.' },
      { q: 'Which quality setting should I choose?', a: 'Balanced is a good starting point for most photos. Choose Smaller File when size matters most and a little softness is acceptable, or High Quality when you want the best-looking result. Compare the before and after sizes and adjust.' },
      { q: 'Why did my PNG not get smaller?', a: 'PNG compression is lossless, so some images, especially ones that are already well optimised, cannot shrink much. Converting to WebP or JPEG can give smaller files, though JPEG cannot keep transparency.' },
    ],
    status: 'live',
  },
  {
    slug: 'image-resizer',
    name: 'Image Resizer',
    description: 'Resize images to exact dimensions or percentages for web, social or print.',
    metaTitle: 'Image Resizer: Change Photo Dimensions',
    metaDescription:
      'Resize JPG, PNG and WebP images by exact pixels, percentage or common sizes. Keep proportions, convert formats and download a ZIP. Nothing is uploaded.',
    icon: 'resize',
    tone: 'slate',
    category: 'Images',
    appCategory: 'MultimediaApplication',
    keywords: 'photo dimensions scale width height crop',
    summary: 'Change an image to the exact size you need, whether that is set dimensions, a percentage, or a size for a particular platform.',
    audience: 'Useful for preparing photos for websites, social posts, documents or print without opening an editor.',
    benefits: [
      'Exact pixel dimensions or percentage scaling',
      'Useful for web, social media and print',
      'One simple step instead of opening an editor',
    ],
    howTo: [
      'Add one or more JPG, PNG or WebP images.',
      'Choose how to resize: custom width and height, a percentage, or a common size. Each image shows the exact size it will become before you start.',
      'Choose the output format. For custom sizes, leave "Keep proportions" on unless you really want to stretch the picture.',
      'Select Resize, then download each image or all of them as a ZIP file.',
    ],
    limits: [
      'Resizing never crops. Common sizes fit the whole picture inside the box, so one side may be smaller than the box. They are common sizes, not a guarantee of what a given website or app requires.',
      'Each side can be up to 16,384 px, and images are limited to 100 MB and 100 megapixels. Images that would exceed this are flagged individually.',
      'Enlarging cannot add detail, so enlarged images may look soft. JPEG output cannot keep transparency; you choose the background colour used instead.',
    ],
    privacy:
      'Images are resized by your browser on your own device. They are not uploaded, and no file or setting is saved.',
    faq: [
      { q: 'Will resizing change the proportions of my image?', a: 'Not unless you turn off "Keep proportions" in custom mode. With it on, the side you type is applied and the other side follows each image’s own shape, so nothing is stretched. Unlocking shows a warning because the picture can be distorted.' },
      { q: 'Does the Image Resizer crop pictures?', a: 'No. The whole picture is always kept. If you need a particular shape, choose a common size and the image is fitted inside it without cropping or stretching.' },
      { q: 'Can I resize many images at once?', a: 'Yes. Add several images and they are resized one after another with the same settings, with progress shown for each. You can stop the batch at any point and download the finished ones.' },
    ],
    status: 'live',
  },
  {
    slug: 'word-counter',
    name: 'Word Counter',
    description: 'Count words, characters, sentences and estimate reading time as you type.',
    metaTitle: 'Word Counter and Reading Time Calculator',
    metaDescription:
      'Count words, characters, sentences and paragraphs as you type, with reading and speaking time estimates. Works with Unicode text. Your text stays in your browser.',
    icon: 'text',
    tone: 'clay',
    category: 'Text',
    appCategory: 'UtilitiesApplication',
    keywords: 'characters sentences reading time writing',
    summary: 'See live counts for words, characters and sentences, plus an estimated reading time, while you write or paste text.',
    audience: 'Useful for writers, students and anyone working to a word or character limit.',
    benefits: [
      'Live counts as you type',
      'Handy for essays, posts and character limits',
      'Reading-time estimate at a glance',
    ],
    howTo: [
      'Type or paste your text into the box.',
      'Read the live counts for words, characters (with and without spaces), sentences and paragraphs.',
      'Check the reading and speaking time estimates if you are preparing something to read or present.',
      'Use Copy Text to copy what you wrote, or Clear to start again.',
    ],
    limits: [
      'Reading time assumes 200 words per minute and speaking time 130 words per minute. These are estimates, and real speeds vary.',
      'Sentences and words are counted using standard rules. Unusual punctuation or abbreviations can make sentence counts differ slightly from other tools.',
    ],
    privacy:
      'Your text is counted by your browser. It is not uploaded, and it is not saved: closing or reloading the page discards it.',
    faq: [
      { q: 'Does the Word Counter work with other languages?', a: 'Yes. It counts Unicode text, including accented letters, emoji and languages such as Chinese that do not separate words with spaces.' },
      { q: 'How is reading time calculated?', a: 'It divides the word count by an average reading speed of 200 words per minute. Speaking time uses 130 words per minute. Treat both as estimates.' },
      { q: 'Is my text stored anywhere?', a: 'No. The count happens in your browser and the text is not saved or sent anywhere.' },
    ],
    status: 'live',
  },
  {
    slug: 'json-formatter',
    name: 'JSON Formatter',
    description: 'Format, validate and minify JSON with clear, readable error messages.',
    metaTitle: 'JSON Formatter, Validator and Minifier',
    metaDescription:
      'Format, validate and minify JSON with clear error messages that show the line and column. Copy or download the result. Runs in your browser.',
    icon: 'braces',
    tone: 'ochre',
    category: 'Developer',
    appCategory: 'DeveloperApplication',
    keywords: 'validate beautify minify pretty print developer',
    summary: 'Turn messy JSON into readable, indented text, check that it is valid, or minify it again when you need it compact.',
    audience: 'Useful for developers and anyone who needs to read, check or tidy JSON from an API, a config file or a log.',
    benefits: [
      'Format, validate and minify in one place',
      'Clear, readable error messages',
      'Quick checks without installing anything',
    ],
    howTo: [
      'Paste your JSON into the Input box.',
      'Choose an indent style (2 spaces, 4 spaces or tab), then select Format to make it readable, or Minify to make it compact.',
      'If the JSON is not valid, the error message shows what is wrong and where, by line and column.',
      'Copy the result, or download it as a .json file.',
    ],
    limits: [
      'The tool checks standard JSON. Comments, trailing commas and single-quoted strings are not valid JSON and are reported as errors.',
      'Very large results are previewed in part to keep the page responsive; Copy and Download always give the complete output.',
    ],
    privacy:
      'Your JSON is processed by your browser. It is not uploaded, and it is not saved: closing or reloading the page discards it.',
    faq: [
      { q: 'Is it safe to paste private JSON here?', a: 'The JSON is processed in your browser and is not sent anywhere or saved. As with any tool, avoid pasting secrets on a shared or untrusted computer.' },
      { q: 'What is the difference between formatting and minifying?', a: 'Formatting adds line breaks and indentation so people can read the data. Minifying removes all unnecessary whitespace so the data is as compact as possible. The values stay the same.' },
      { q: 'Why does my JSON show an error?', a: 'Common causes are a missing or extra comma, unquoted keys, single quotes instead of double quotes, or a trailing comma. The message points to the line and column where parsing failed.' },
    ],
    status: 'live',
  },
  {
    slug: 'wifi-qr-generator',
    name: 'WiFi QR Generator',
    description: 'Create a QR code guests can scan to join your WiFi network instantly.',
    metaTitle: 'WiFi QR Code Generator',
    metaDescription:
      'Create a WiFi QR code that lets guests join your network by scanning. Download it as PNG or SVG, or print it. Your password never leaves your browser.',
    icon: 'wifi',
    tone: 'umber',
    category: 'Utilities',
    appCategory: 'UtilitiesApplication',
    keywords: 'wifi qr code network password guest share',
    summary: 'Create a QR code for your WiFi network so guests can join by scanning it instead of typing a long password.',
    audience: 'Useful for homes, offices, cafés and holiday rentals where guests regularly ask for the WiFi password.',
    benefits: [
      'Easy joining for guests and visitors',
      'No typing out long passwords',
      'Printable code for a home, office or shop',
    ],
    howTo: [
      'Enter the network name (SSID) exactly as it appears on your devices.',
      'Choose the security type (WPA/WPA2/WPA3, WEP or none), then enter the password. Tick "hidden network" if the network does not broadcast its name.',
      'The QR code appears as you type. Check it with your own phone.',
      'Download it as a PNG or SVG, or print it. The printed sheet shows the network name, never the password.',
    ],
    limits: [
      'Anyone who can scan or photograph the code can join the network, so share or print it only where that is acceptable.',
      'Most recent iPhone and Android cameras can join from a scan. Older phones may need a QR scanner app.',
      'Network names and passwords are limited to the lengths WiFi allows, and the tool warns when yours is outside them.',
    ],
    privacy:
      'The network name and password are turned into a QR code by your browser. They are not uploaded and are not saved.',
    faq: [
      { q: 'Is my WiFi password sent anywhere?', a: 'No. The code is generated in your browser, and neither the name nor the password is uploaded or stored.' },
      { q: 'Which security type should I choose?', a: 'Most modern networks use WPA, WPA2 or WPA3, so choose WPA / WPA2 / WPA3. Choose WEP only for older equipment, and None for an open network without a password.' },
      { q: 'Does it handle special characters in passwords?', a: 'Yes. Characters such as semicolons, commas, colons and quotes are escaped correctly, so the code contains exactly what you typed.' },
    ],
    status: 'live',
  },
  {
    slug: 'qr-code-generator',
    name: 'QR Code Generator',
    description: 'Make a QR code for a website, text, email, phone number, SMS or contact card.',
    metaTitle: 'QR Code Generator for Links, Text and Contacts',
    metaDescription:
      'Create QR codes for websites, text, email, phone numbers, SMS and contact cards. Choose colours and size, then download PNG or SVG. Made in your browser.',
    icon: 'qr',
    tone: 'slate',
    category: 'Utilities',
    appCategory: 'UtilitiesApplication',
    keywords: 'qr code generator link url vcard contact email sms phone text barcode scan',
    summary: 'Turn a link, message, email, phone number or contact card into a QR code you can download as a PNG or SVG, made entirely in your browser.',
    audience: 'Useful for flyers, menus, business cards, signs and slides where people should be able to scan instead of type.',
    benefits: [
      'Six common types: website, text, email, phone, SMS and contact',
      'Download a sharp PNG or SVG in the size you need',
      'Created in your browser, so what you enter stays on your device',
    ],
    howTo: [
      'Choose what the QR code should contain: a website, text, email, phone number, SMS or contact card.',
      'Fill in the fields. The code updates as you type, and anything invalid is explained next to the field.',
      'Optionally change the colours and the download size (256, 512 or 1024 px).',
      'Download a PNG or SVG, or copy the text the code contains. Always test the code with a phone before printing.',
    ],
    limits: [
      'A code holds up to about 2,300 characters, and less for emoji and non-Latin text. Dense codes are harder to scan, so keep the content short.',
      'Keep strong contrast: a dark code on a light background scans best. Identical or nearly identical colours are refused, and low contrast shows a warning.',
      'Codes are static: the content is fixed inside the image, so there are no scan statistics and it cannot be changed later.',
    ],
    privacy:
      'The code is generated by your browser. What you enter is not uploaded, saved, or added to the page address.',
    faq: [
      { q: 'Does the QR Code Generator send my data anywhere?', a: 'The code is generated in your browser and nothing you enter is uploaded or saved. The page makes no network requests while you create a code.' },
      { q: 'Do these QR codes expire?', a: 'No. They are static codes, so they contain your content directly and keep working for as long as the content (for example a website address) is valid.' },
      { q: 'Should I download PNG or SVG?', a: 'Use PNG for documents, slides and screens. Use SVG when the code will be printed or resized, because it stays sharp at any size.' },
      { q: 'How can I make a code that scans reliably?', a: 'Use dark on light colours, leave the white border around the code, keep the content short, and print it large enough. Test it with a phone before you print many copies.' },
    ],
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

/** Related tools: same category first, then the rest of the live tools. */
export const relatedTools = (tool, limit = 3) =>
  liveTools
    .filter((t) => t.slug !== tool.slug)
    .sort((a, b) => Number(b.category === tool.category) - Number(a.category === tool.category))
    .slice(0, limit);

/** Spells out small counts for headings ("Six tools"). */
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const countWord = (n) => NUMBER_WORDS[n] ?? String(n);
