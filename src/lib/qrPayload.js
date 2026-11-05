/**
 * General QR Code Generator: payload builders, validation and colour checks.
 * Pure functions: no DOM, no storage, no network, no logging. Error messages never repeat what the user typed.
 *
 * Payload formats
 *   Website  https://example.com/path
 *   Text     the text itself
 *   Email    mailto:name@example.com?subject=...&body=...        (RFC 6068, percent-encoded UTF-8)
 *   Phone    tel:+441234567890                                    (RFC 3966, digits and a leading + only)
 *   SMS      sms:+441234567890?body=...                           (RFC 5724, percent-encoded UTF-8)
 *   Contact  vCard 3.0 (RFC 2426), CRLF line endings, 75-octet line folding
 */

export const QR_TYPES = [
  { id: 'url', label: 'Website', slug: 'website', noun: 'a website link' },
  { id: 'text', label: 'Text', slug: 'text', noun: 'plain text' },
  { id: 'email', label: 'Email', slug: 'email', noun: 'an email' },
  { id: 'phone', label: 'Phone', slug: 'phone', noun: 'a phone number' },
  { id: 'sms', label: 'SMS', slug: 'sms', noun: 'a text message' },
  { id: 'contact', label: 'Contact', slug: 'contact', noun: 'a contact card' },
];

/** Largest payload a QR code can hold at error-correction level M (version 40, byte mode). */
export const MAX_PAYLOAD_BYTES = 2331;
/** Above this a code gets dense and harder for cameras to read; the interface warns. */
export const DENSE_PAYLOAD_BYTES = 700;

export const QR_SIZES = [256, 512, 1024];
export const DEFAULT_SIZE = 512;
export const RECOMMENDED_COLORS = { fg: '#000000', bg: '#ffffff' };

export function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

/* -------------------------------------------------------------------- Website */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const OTHER_SCHEME = /^(?:javascript|data|vbscript|file|ftp|mailto|tel|sms|smsto|blob|about|wifi):/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Accepts http/https URLs; a bare domain such as "example.com/page" gets "https://" added.
 * Returns { ok, url } or { ok: false, message }.
 */
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, code: 'empty', message: 'Enter a website address.' };
  if (/\s/.test(raw)) return { ok: false, code: 'space', message: 'A web address cannot contain spaces.' };
  let candidate = raw;
  if (HAS_SCHEME.test(raw)) {
    if (!/^https?:\/\//i.test(raw)) return { ok: false, code: 'scheme', message: 'Only http:// and https:// addresses are supported.' };
  } else if (OTHER_SCHEME.test(raw)) {
    return { ok: false, code: 'scheme', message: 'Only http:// and https:// addresses are supported.' };
  } else {
    candidate = `https://${raw.replace(/^\/\//, '')}`;
  }
  let u;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, code: 'invalid', message: 'This does not look like a valid web address.' };
  }
  const host = u.hostname;
  const plausible = host === 'localhost' || (IPV4.test(host) && host.split('.').every((n) => Number(n) <= 255)) || /^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$/i.test(host);
  if (!plausible || host.startsWith('.') || host.includes('..')) return { ok: false, code: 'host', message: 'This does not look like a valid web address. Check the domain, for example example.com.' };
  // Keep exactly what was typed (plus https://) when it is plain ASCII; otherwise use the browser's encoded form.
  const url = /^[\x21-\x7e]+$/.test(candidate) ? candidate : u.href;
  return { ok: true, url };
}

/* ------------------------------------------------------------------ Phone, email */

const PHONE_CHARS = /^\+?[\d\s().\-/]+$/;

/** Plausible international phone number: 3 to 15 digits, optional leading +, common separators. */
export function normalizePhone(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, code: 'empty', message: 'Enter a phone number.' };
  if (!PHONE_CHARS.test(raw)) return { ok: false, code: 'chars', message: 'Use digits only, with an optional + at the start. Spaces, dashes, dots and brackets are fine.' };
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 3) return { ok: false, code: 'short', message: 'This phone number is too short.' };
  if (digits.length > 15) return { ok: false, code: 'long', message: 'This phone number is too long. Phone numbers have at most 15 digits.' };
  return { ok: true, number: (raw.startsWith('+') ? '+' : '') + digits };
}

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function normalizeEmail(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, code: 'empty', message: 'Enter an email address.' };
  if (!EMAIL.test(raw) || raw.includes('..') || raw.startsWith('.') || raw.split('@')[0].endsWith('.')) {
    return { ok: false, code: 'invalid', message: 'This does not look like a valid email address.' };
  }
  return { ok: true, address: raw };
}

/** Percent-encodes UTF-8 text for a URI query value; line breaks become %0D%0A. */
export const encodeQueryValue = (text) => encodeURIComponent(String(text).replace(/\r\n|\r|\n/g, '\r\n'));

/** mailto: address part: keep the characters RFC 6068 allows, encode the rest (% & # ? ; , and so on). */
const encodeMailAddress = (address) => address.replace(/[^A-Za-z0-9.!$'*+/=^_`{|}~@-]/g, (c) => encodeURIComponent(c));

export function buildEmailPayload({ address, subject = '', message = '' }) {
  const query = [];
  if (subject) query.push(`subject=${encodeQueryValue(subject)}`);
  if (message) query.push(`body=${encodeQueryValue(message)}`);
  return `mailto:${encodeMailAddress(address)}${query.length ? `?${query.join('&')}` : ''}`;
}

export const buildPhonePayload = (number) => `tel:${number}`;

export function buildSmsPayload({ number, message = '' }) {
  return `sms:${number}${message ? `?body=${encodeQueryValue(message)}` : ''}`;
}

/* --------------------------------------------------------------------- vCard */

/** vCard 3.0 TEXT escaping: backslash, semicolon, comma and line breaks. */
export function escapeVcard(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line to at most 75 octets per line (continuations start with one space); never splits a character. */
export function foldVcardLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // the leading space of a continuation line counts toward 75
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildVcardPayload({ firstName, lastName = '', phone = '', email = '', organization = '', website = '' }) {
  const full = [firstName, lastName].filter(Boolean).join(' ');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeVcard(lastName)};${escapeVcard(firstName)};;;`, `FN:${escapeVcard(full)}`];
  if (organization) lines.push(`ORG:${escapeVcard(organization)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${phone}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${email}`);
  if (website) lines.push(`URL:${website}`);
  lines.push('END:VCARD');
  return `${lines.map(foldVcardLine).join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------- Validation */

const stripCr = (s) => String(s ?? '');
const needs = (value) => stripCr(value).trim() === '';

/**
 * Validates the fields for one QR type and builds its payload.
 * @returns {{ valid: boolean, payload: string, errors: Record<string,string>, warnings: string[], missing: string[] }}
 *   `missing` lists required fields still empty (shown as hints, not as errors, until the user touches them).
 */
export function buildQr(type, f = {}) {
  const errors = {};
  const missing = [];
  const warnings = [];
  let payload = '';

  const fail = (field, result) => { if (result.code === 'empty') missing.push(field); else errors[field] = result.message; };

  switch (type) {
    case 'url': {
      const r = normalizeUrl(f.url);
      if (r.ok) payload = r.url; else fail('url', r);
      break;
    }
    case 'text': {
      if (needs(f.text)) missing.push('text');
      else payload = stripCr(f.text);
      break;
    }
    case 'email': {
      const r = normalizeEmail(f.address);
      if (r.ok) payload = buildEmailPayload({ address: r.address, subject: stripCr(f.subject), message: stripCr(f.message) }); else fail('address', r);
      break;
    }
    case 'phone': {
      const r = normalizePhone(f.phone);
      if (r.ok) payload = buildPhonePayload(r.number); else fail('phone', r);
      break;
    }
    case 'sms': {
      const r = normalizePhone(f.phone);
      if (r.ok) payload = buildSmsPayload({ number: r.number, message: stripCr(f.message) }); else fail('phone', r);
      break;
    }
    case 'contact': {
      const first = stripCr(f.firstName).trim();
      if (!first) missing.push('firstName');
      let phone = '';
      let email = '';
      let website = '';
      if (!needs(f.phone)) { const r = normalizePhone(f.phone); if (r.ok) phone = r.number; else errors.phone = r.message; }
      if (!needs(f.email)) { const r = normalizeEmail(f.email); if (r.ok) email = r.address; else errors.email = r.message; }
      if (!needs(f.website)) { const r = normalizeUrl(f.website); if (r.ok) website = r.url; else errors.website = r.message; }
      if (first && !Object.keys(errors).length) {
        payload = buildVcardPayload({ firstName: first, lastName: stripCr(f.lastName).trim(), phone, email, organization: stripCr(f.organization).trim(), website });
      }
      break;
    }
    default:
      errors.type = 'Choose what the QR code should contain.';
  }

  if (payload) {
    const bytes = utf8Length(payload);
    if (bytes > MAX_PAYLOAD_BYTES) {
      errors[type === 'text' ? 'text' : type === 'email' ? 'message' : type === 'sms' ? 'message' : 'general'] =
        `This is too long for one QR code (${bytes.toLocaleString('en-US')} of ${MAX_PAYLOAD_BYTES.toLocaleString('en-US')} bytes). Shorten it.`;
      payload = '';
    } else if (bytes > DENSE_PAYLOAD_BYTES) {
      warnings.push('This is a lot of data, so the code will be dense. Use the 1024 px size and test it with your phone before printing.');
    }
  }
  return { valid: Boolean(payload) && Object.keys(errors).length === 0, payload: Object.keys(errors).length ? '' : payload, errors, warnings, missing };
}

/* ------------------------------------------------------------------- Colours */

/** Parses #rgb or #rrggbb. Returns '#rrggbb' (lower case) or null. */
export function parseHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
}

export function hexToRgb(hex) {
  const h = parseHex(hex);
  if (!h) return null;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG relative luminance (0 to 1). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const MIN_BLOCK_RATIO = 1.5; // below this the code is not offered at all
export const MIN_GOOD_RATIO = 4.5; // below this a warning is shown

/**
 * Judges a colour pair.
 * level 'blocked': identical or nearly identical, no code is produced.
 * level 'warn': readable only with luck; a warning is shown and the recommended pair is offered.
 * level 'ok': fine.
 */
export function assessColors(fg, bg) {
  const f = parseHex(fg);
  const b = parseHex(bg);
  if (!f || !b) return { level: 'blocked', ratio: 0, messages: ['Choose valid colours.'] };
  const ratio = contrastRatio(f, b);
  const messages = [];
  if (f === b) return { level: 'blocked', ratio: 1, messages: ['The code and background colours are the same, so the code would be invisible. Choose different colours.'] };
  if (ratio < MIN_BLOCK_RATIO) return { level: 'blocked', ratio, messages: ['These colours are too similar for a QR code to be seen. Choose colours that differ more.'] };
  if (ratio < MIN_GOOD_RATIO) messages.push(`Low contrast (${ratio.toFixed(1)}:1). The code may not scan reliably. A contrast of at least ${MIN_GOOD_RATIO}:1 is recommended.`);
  if (luminance(f) > luminance(b)) messages.push('The code is lighter than its background. Many scanners cannot read light-on-dark codes.');
  return { level: messages.length ? 'warn' : 'ok', ratio, messages };
}

/* ------------------------------------------------------------------ Filenames */

export const qrFilename = (type, ext) => `toolora-${QR_TYPES.find((t) => t.id === type)?.slug ?? 'qr'}-qr.${ext}`;
