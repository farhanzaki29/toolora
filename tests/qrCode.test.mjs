/**
 * General QR Code Generator tests.
 *   node tests/qrCode.test.mjs
 * Uses the dev dependency `jsqr` (an independent QR decoder) to prove that the generated codes decode to the expected payload.
 */
import jsQR from 'jsqr';
import {
  QR_TYPES, MAX_PAYLOAD_BYTES, QR_SIZES, RECOMMENDED_COLORS, normalizeUrl, normalizePhone, normalizeEmail, buildEmailPayload, buildSmsPayload,
  escapeVcard, foldVcardLine, buildVcardPayload, buildQr, parseHex, contrastRatio, assessColors, qrFilename, utf8Length,
} from '../src/lib/qrPayload.js';
import { moduleRects, svgDocument, modulePixels } from '../src/lib/qrExport.js';
import { makeQr, QUIET_ZONE } from '../src/lib/qr.js';

let passed = 0;
let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
};
const ok = (name, cond) => eq(name, Boolean(cond), true);

/* ---- Decoding helpers: rasterise the real export geometry / the real SVG text, then decode with jsQR ---- */
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function decodePixels(px, N) { return jsQR(px, N, N)?.data ?? null; }
function decodeRects(code, size, fg = '#000000', bg = '#ffffff') {
  const px = new Uint8ClampedArray(size * size * 4);
  const [br, bgc, bb] = hexRgb(bg); const [fr, fgc, fb] = hexRgb(fg);
  for (let i = 0; i < size * size; i++) { px[i * 4] = br; px[i * 4 + 1] = bgc; px[i * 4 + 2] = bb; px[i * 4 + 3] = 255; }
  for (const [x, y, w, h] of moduleRects(code, size)) for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) { const i = ((y + dy) * size + x + dx) * 4; px[i] = fr; px[i + 1] = fgc; px[i + 2] = fb; }
  return decodePixels(px, size);
}
function decodeSvgText(svg, scale = 6) {
  const total = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)[1]);
  const N = total * scale;
  const fill = (re) => hexRgb(re.exec(svg)[1]);
  const bg = fill(/<rect[^>]* fill="(#[0-9a-f]{6})"/); const fg = fill(/<path fill="(#[0-9a-f]{6})"/);
  const px = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) { px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255; }
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, len] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < len * scale; dx++) { const i = ((y * scale + dy) * N + x * scale + dx) * 4; px[i] = fg[0]; px[i + 1] = fg[1]; px[i + 2] = fg[2]; }
  }
  return decodePixels(px, N);
}
const scanBoth = (name, payload, size = 512) => {
  const code = makeQr(payload, 'M');
  eq(`decodes from PNG geometry (${size}px): ${name}`, decodeRects(code, size), payload);
  eq(`decodes from SVG file: ${name}`, decodeSvgText(svgDocument(code, size)), payload);
};

/* ================================================================== Website */
for (const [input, url] of [
  ['example.com', 'https://example.com'], ['  example.com/path?x=1&y=2#top  ', 'https://example.com/path?x=1&y=2#top'], ['http://example.com', 'http://example.com'],
  ['HTTPS://Example.COM/A', 'HTTPS://Example.COM/A'], ['www.example.co.uk', 'https://www.example.co.uk'], ['//example.com/x', 'https://example.com/x'],
  ['localhost:3000/app', 'https://localhost:3000/app'], ['192.168.1.10:8080', 'https://192.168.1.10:8080'], ['sub.domain.example.org:8443/a/b', 'https://sub.domain.example.org:8443/a/b'],
]) { const r = normalizeUrl(input); eq(`url ok: "${input}"`, r.ok && r.url, url); }
eq('url: non-ASCII host becomes its encoded form', normalizeUrl('bücher.de/straße').url, 'https://xn--bcher-kva.de/stra%C3%9Fe');
for (const [input, code] of [['', 'empty'], ['   ', 'empty'], ['javascript:alert(1)', 'scheme'], ['ftp://example.com', 'scheme'], ['file:///etc/passwd', 'scheme'], ['data:text/html,hi', 'scheme'], ['mailto:a@b.co', 'scheme'], ['not a url', 'space'], ['example', 'host'], ['http://', 'invalid'], ['http://.com', 'host'], ['exa mple.com', 'space'], ['256.1.1.1.1', 'invalid'], ['https://exa..mple.com', 'host']]) {
  const r = normalizeUrl(input); eq(`url rejected (${code}): "${input}"`, [r.ok, r.code], [false, code]);
}
ok('url error messages never repeat the input', !normalizeUrl('secret-token.not valid').message.includes('secret'));

/* ================================================================== Text */
{
  const text = 'Héllo wörld 日本語 😀 — “quotes” & <tags> ; , : \\ \n second line';
  const r = buildQr('text', { text }); eq('text: payload is the text, untouched', [r.valid, r.payload], [true, text]);
  scanBoth('text with Unicode, emoji and symbols', text);
  scanBoth('text with newlines and tabs', 'line one\nline two\ttabbed\r\nline three');
  eq('text: empty is "missing", not an error', [buildQr('text', { text: '' }).valid, buildQr('text', { text: '' }).missing], [false, ['text']]);
  eq('text: whitespace-only is missing', buildQr('text', { text: '  \n ' }).missing, ['text']);
  const at = 'a'.repeat(MAX_PAYLOAD_BYTES); const over = 'a'.repeat(MAX_PAYLOAD_BYTES + 1);
  eq('text: exactly at capacity is accepted', buildQr('text', { text: at }).valid, true);
  ok('text: at capacity really produces a QR code', makeQr(at, 'M').size === 177);
  const big = buildQr('text', { text: over }); eq('text: one byte over capacity is rejected', [big.valid, Boolean(big.errors.text)], [false, true]);
  ok('text: the over-capacity message gives the limit but not the text', /2,331/.test(big.errors.text) && !big.errors.text.includes('aaaa'));
  eq('text: capacity counts UTF-8 bytes, not characters', buildQr('text', { text: '日'.repeat(800) }).valid, false); // 2,400 bytes
  eq('text: 700 CJK characters (2,100 bytes) fit', buildQr('text', { text: '日'.repeat(700) }).valid, true);
  ok('text: a large payload gets a density warning', buildQr('text', { text: 'x'.repeat(900) }).warnings.length === 1);
  ok('text: a short payload gets no warning', buildQr('text', { text: 'hi' }).warnings.length === 0);
  scanBoth('very long text (1,500 bytes)', 'The quick brown fox. '.repeat(71).slice(0, 1500), 1024);
}

/* ================================================================== Email */
eq('email: address only', buildEmailPayload({ address: 'a@b.co' }), 'mailto:a@b.co');
eq('email: subject and message', buildEmailPayload({ address: 'a@b.co', subject: 'Hello there', message: 'Line 1\nLine 2' }), 'mailto:a@b.co?subject=Hello%20there&body=Line%201%0D%0ALine%202');
eq('email: ampersand, equals, question, hash, plus, percent are encoded in values', buildEmailPayload({ address: 'a@b.co', subject: 'R&D = 100% #1? a+b' }), 'mailto:a@b.co?subject=R%26D%20%3D%20100%25%20%231%3F%20a%2Bb');
eq('email: Unicode becomes UTF-8 percent-encoding', buildEmailPayload({ address: 'a@b.co', message: 'Café 日本' }), 'mailto:a@b.co?body=Caf%C3%A9%20%E6%97%A5%E6%9C%AC');
eq('email: only a message', buildEmailPayload({ address: 'a@b.co', message: 'Hi' }), 'mailto:a@b.co?body=Hi');
eq('email: plus addressing is kept readable', buildEmailPayload({ address: 'first.last+tag@example.com' }), 'mailto:first.last+tag@example.com');
eq('email: a % in the address is encoded', buildEmailPayload({ address: "o'brien%x@example.com" }), "mailto:o'brien%25x@example.com");
{
  const r = buildQr('email', { address: ' me@example.com ', subject: 'Q&A: 50% off?', message: 'Hi,\nCafé ☕' });
  eq('email: whole flow', [r.valid, r.payload], [true, 'mailto:me@example.com?subject=Q%26A%3A%2050%25%20off%3F&body=Hi%2C%0D%0ACaf%C3%A9%20%E2%98%95']);
  const q = new URL(r.payload); eq('email: an independent URL parser reads the values back', [decodeURIComponent(q.pathname), q.searchParams.get('subject'), q.searchParams.get('body')], ['me@example.com', 'Q&A: 50% off?', 'Hi,\r\nCafé ☕']);
  scanBoth('email with subject and message', r.payload);
}
for (const a of ['', 'plain', 'a@b', 'a@@b.co', '@b.co', 'a b@c.co', 'a@b..co', '.a@b.co', 'a.@b.co', 'a@b.c', 'a@-b.co', 'ü@b.co']) eq(`email rejected: "${a}"`, normalizeEmail(a).ok, false);
for (const a of ['a@b.co', 'first.last+tag@sub.example.com', "o'brien@example.ie", 'x_y-z@my-domain.org']) eq(`email accepted: "${a}"`, normalizeEmail(a).ok, true);
eq('email: empty address is "missing"', buildQr('email', { address: '' }).missing, ['address']);
eq('email: bad address is an error on that field', Object.keys(buildQr('email', { address: 'nope' }).errors), ['address']);

/* ================================================================== Phone */
for (const [input, tel] of [['+44 20 7946 0958', '+442079460958'], ['(555) 123-4567', '5555551234567'.slice(0, 0) + '5551234567'], ['+1 (555) 123-4567', '+15551234567'], ['020.7946.0958', '02079460958'], ['+81-3-1234-5678', '+81312345678'], ['112', '112'], ['+49 30 / 123456', '+4930123456'], ['  07911 123456  ', '07911123456']]) {
  const r = normalizePhone(input); eq(`phone ok: "${input}"`, r.ok && r.number, tel);
}
for (const [input, code] of [['', 'empty'], ['  ', 'empty'], ['12', 'short'], ['+', 'chars'], ['+1', 'short'], ['1234567890123456', 'long'], ['1-800-FLOWERS', 'chars'], ['12+34567', 'chars'], ['++441234', 'chars'], ['call me', 'chars'], ['555;123', 'chars'], ['555 123 4567 ext 9', 'chars']]) {
  const r = normalizePhone(input); eq(`phone rejected (${code}): "${input}"`, [r.ok, r.code], [false, code]);
}
eq('phone: payload', buildQr('phone', { phone: '+44 20 7946 0958' }).payload, 'tel:+442079460958');
eq('phone: 15 digits (E.164 maximum) accepted', buildQr('phone', { phone: '+123456789012345' }).valid, true);
eq('phone: no country format is forced', buildQr('phone', { phone: '0412 345 678' }).payload, 'tel:0412345678');
scanBoth('phone number', 'tel:+442079460958');

/* ================================================================== SMS */
eq('sms: number only', buildSmsPayload({ number: '+15551234567' }), 'sms:+15551234567');
eq('sms: message with special characters', buildSmsPayload({ number: '+15551234567', message: 'Hi! R&D: 50% off? a=b #1 + "q"\nBye' }), 'sms:+15551234567?body=Hi!%20R%26D%3A%2050%25%20off%3F%20a%3Db%20%231%20%2B%20%22q%22%0D%0ABye');
eq('sms: Unicode message', buildSmsPayload({ number: '123', message: 'Café 😀' }), 'sms:123?body=Caf%C3%A9%20%F0%9F%98%80');
{
  const r = buildQr('sms', { phone: '(555) 123-4567', message: 'See you at 5 & bring Café ☕' });
  eq('sms: whole flow', [r.valid, r.payload], [true, 'sms:5551234567?body=See%20you%20at%205%20%26%20bring%20Caf%C3%A9%20%E2%98%95']);
  eq('sms: an independent parser reads the message back', decodeURIComponent(r.payload.split('?body=')[1]), 'See you at 5 & bring Café ☕');
  scanBoth('sms with message', r.payload);
}
eq('sms: phone required', buildQr('sms', { phone: '', message: 'hi' }).missing, ['phone']);
eq('sms: invalid phone is an error', Object.keys(buildQr('sms', { phone: 'abc', message: 'hi' }).errors), ['phone']);
eq('sms: an over-long message reports the message field', Object.keys(buildQr('sms', { phone: '555', message: 'x'.repeat(2400) }).errors), ['message']);

/* ================================================================== vCard */
eq('vcard: escaping', escapeVcard('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
{
  const v = buildVcardPayload({ firstName: 'Ada', lastName: 'Lovelace', phone: '+442079460958', email: 'ada@example.com', organization: 'Analytical, Engines; Ltd', website: 'https://example.com' });
  eq('vcard: full card', v, 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace;Ada;;;\r\nFN:Ada Lovelace\r\nORG:Analytical\\, Engines\\; Ltd\r\nTEL;TYPE=CELL:+442079460958\r\nEMAIL;TYPE=INTERNET:ada@example.com\r\nURL:https://example.com\r\nEND:VCARD\r\n');
  ok('vcard: every line break is CRLF (no bare LF)', !/(^|[^\r])\n/.test(v));
  eq('vcard: first name only', buildVcardPayload({ firstName: 'Ada' }), 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Ada;;;\r\nFN:Ada\r\nEND:VCARD\r\n');
  scanBoth('vCard (full)', v);
  scanBoth('vCard (name only)', buildVcardPayload({ firstName: 'Ada' }));
}
{
  const r = buildQr('contact', { firstName: ' José ', lastName: 'O’Brien; Jr.', phone: '+34 91 123 45 67', email: 'jose@example.es', organization: 'Café, S.L.', website: 'example.es/contacto' });
  eq('vcard: whole flow valid', r.valid, true);
  ok('vcard: name parts are escaped', r.payload.includes('N:O’Brien\\; Jr.;José;;;') && r.payload.includes('FN:José O’Brien\\; Jr.') && r.payload.includes('ORG:Café\\, S.L.'));
  ok('vcard: website gets https', r.payload.includes('URL:https://example.es/contacto'));
  scanBoth('vCard with Unicode and escapes', r.payload);
  const long = buildQr('contact', { firstName: 'A', organization: 'Org '.repeat(60).trim(), website: 'https://example.com/' + 'p'.repeat(150) });
  const lines = long.payload.split('\r\n'); ok('vcard: lines are folded to 75 octets', lines.every((l) => utf8Length(l) <= 75));
  eq('vcard: unfolding restores the content', long.payload.replace(/\r\n /g, '').includes('ORG:' + 'Org '.repeat(60).trim()), true);
  scanBoth('vCard with folded lines', long.payload, 1024);
}
{
  const f = foldVcardLine('NOTE:' + '日'.repeat(60)); const parts = f.split('\r\n');
  ok('vcard fold: never splits a multi-byte character', parts.every((p) => !p.includes('�')) && f.replace(/\r\n /g, '') === 'NOTE:' + '日'.repeat(60) && parts.every((p) => utf8Length(p) <= 75));
}
eq('vcard: first name is required', buildQr('contact', { firstName: '  ', lastName: 'X' }).missing, ['firstName']);
eq('vcard: optional fields are optional', buildQr('contact', { firstName: 'Ada' }).valid, true);
eq('vcard: invalid optional fields are reported per field', Object.keys(buildQr('contact', { firstName: 'Ada', phone: 'x', email: 'y', website: 'ftp://z' }).errors).sort(), ['email', 'phone', 'website']);
eq('vcard: an invalid field blocks the payload', buildQr('contact', { firstName: 'Ada', email: 'bad' }).payload, '');
eq('vcard: line breaks in names cannot inject extra properties', buildVcardPayload({ firstName: 'A\nEND:VCARD\nBEGIN:VCARD' }).split('\r\n').filter((l) => l === 'END:VCARD').length, 1);

/* ================================================================== Every type decodes */
const samples = {
  url: { url: 'toolora.example/qr?utm=1&x=%20' }, text: { text: 'Hello, Wörld! 🌍' }, email: { address: 'hi@example.com', subject: 'Hi', message: 'Body' },
  phone: { phone: '+1 555 010 9999' }, sms: { phone: '+15550109999', message: 'Hello & welcome' }, contact: { firstName: 'Ada', lastName: 'Lovelace', phone: '+442079460958', email: 'ada@example.com', organization: 'ACME', website: 'example.com' },
};
for (const t of QR_TYPES) { const r = buildQr(t.id, samples[t.id]); ok(`type ${t.id}: valid`, r.valid); scanBoth(`type ${t.id} (${t.label})`, r.payload); for (const size of QR_SIZES) eq(`type ${t.id}: decodes at ${size}px`, decodeRects(makeQr(r.payload, 'M'), size), r.payload); }
eq('unknown type is an error', buildQr('nope', {}).valid, false);

/* ================================================================== Export geometry */
{
  const code = makeQr('https://example.com', 'M');
  for (const px of QR_SIZES) {
    const rects = moduleRects(code, px);
    ok(`geometry ${px}px: every rectangle lies inside the canvas`, rects.every(([x, y, w, h]) => x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= px && y + h <= px));
    ok(`geometry ${px}px: the quiet zone is empty (${QUIET_ZONE} modules)`, rects.every(([x, y, w, h]) => x >= Math.floor((QUIET_ZONE * px) / (code.size + 8)) - 1 && y >= Math.floor((QUIET_ZONE * px) / (code.size + 8)) - 1));
  }
  ok('module size is reported in pixels', Math.abs(modulePixels(code, 512) - 512 / (code.size + 8)) < 1e-9);
  const dense = makeQr('x'.repeat(1500), 'M'); ok('a dense code at 256px is below the 3px-per-module guideline', modulePixels(dense, 256) < 3);
  ok('a dense code at 1024px meets the guideline', modulePixels(dense, 1024) >= 3);
}

/* ================================================================== SVG file */
{
  const code = makeQr('https://example.com', 'M');
  const svg = svgDocument(code, 1024, { fg: '#1a2b3c', bg: '#fffbe6' });
  ok('svg: starts with an XML declaration and a standalone svg element', svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg" viewBox='));
  ok('svg: no scripts, external references, images or event handlers', !/<script|<image|<use|<foreignObject|href=|xlink|on\w+=|url\(|<!ENTITY|<style/i.test(svg));
  ok('svg: the only URL is the SVG namespace', (svg.match(/https?:\/\/[^"\s]+/g) ?? []).join() === 'http://www.w3.org/2000/svg');
  ok('svg: carries the chosen colours', svg.includes('fill="#fffbe6"') && svg.includes('fill="#1a2b3c"'));
  ok('svg: contains no user text', !svg.includes('example'));
  eq('svg: custom colours still decode', decodeSvgText(svg), 'https://example.com');
  eq('png geometry: custom dark colours decode', decodeRects(code, 512, '#0b3d2e', '#fdf6e3'), 'https://example.com');
  ok('svg: an invalid colour cannot inject markup', !svgDocument(code, 256, { fg: '"/><script>', bg: 'red' }).includes('<script'));
}

/* ================================================================== Colours */
eq('parseHex: #rgb expands', parseHex('#AbC'), '#aabbcc');
eq('parseHex: rejects junk', [parseHex('red'), parseHex('#12'), parseHex(''), parseHex('#ggg')], [null, null, null, null]);
eq('contrast: black on white is 21', Math.round(contrastRatio('#000000', '#ffffff') * 10) / 10, 21);
eq('contrast: identical colours is 1', contrastRatio('#336699', '#336699'), 1);
eq('contrast: is symmetric', contrastRatio('#123456', '#fedcba'), contrastRatio('#fedcba', '#123456'));
eq('identical colours are blocked', assessColors('#336699', '#336699').level, 'blocked');
eq('identical colours (different spelling) are blocked', assessColors('#FFF', '#ffffff').level, 'blocked');
eq('near-identical colours are blocked', assessColors('#ffffff', '#fefefe').level, 'blocked');
eq('black on white is ok', [assessColors('#000000', '#ffffff').level, assessColors('#000000', '#ffffff').messages], ['ok', []]);
eq('dark green on cream is ok', assessColors('#0b3d2e', '#fdf6e3').level, 'ok');
{ const a = assessColors('#888888', '#aaaaaa'); eq('low contrast warns with the ratio', [a.level, /Low contrast/.test(a.messages[0])], ['warn', true]); }
{ const a = assessColors('#ffffff', '#000000'); eq('inverted (light on dark) warns', [a.level, /lighter than its background/.test(a.messages[0])], ['warn', true]); }
eq('invalid colours are blocked', assessColors('nope', '#fff').level, 'blocked');
eq('reset: the recommended pair is black on white and is ok', [RECOMMENDED_COLORS, assessColors(RECOMMENDED_COLORS.fg, RECOMMENDED_COLORS.bg).level], [{ fg: '#000000', bg: '#ffffff' }, 'ok']);

/* ================================================================== Filenames and sizes */
eq('filenames', [qrFilename('url', 'png'), qrFilename('email', 'png'), qrFilename('contact', 'svg'), qrFilename('text', 'svg'), qrFilename('phone', 'png'), qrFilename('sms', 'svg')], ['toolora-website-qr.png', 'toolora-email-qr.png', 'toolora-contact-qr.svg', 'toolora-text-qr.svg', 'toolora-phone-qr.png', 'toolora-sms-qr.svg']);
eq('sizes', QR_SIZES, [256, 512, 1024]);

/* ================================================================== Property test */
{
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const alphabet = ['a', 'Z', '0', ' ', '&', '=', '?', '#', '%', ';', ',', ':', '\\', '"', "'", '<', '>', 'é', 'ß', '日', '😀', '\n'];
  const RUNS = 150; let good = 0;
  for (let i = 0; i < RUNS; i++) {
    const text = Array.from({ length: 1 + Math.floor(rnd() * 120) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    if (!text.trim()) { good++; continue; }
    const r = buildQr('text', { text }); const kind = i % 3;
    const payload = kind === 0 ? r.payload : kind === 1 ? buildQr('sms', { phone: '+15550100', message: text }).payload : buildQr('email', { address: 'p@example.com', subject: text, message: text }).payload;
    const got = decodeRects(makeQr(payload, 'M'), 768); if (got === payload) good++;
  }
  eq(`property: ${RUNS} random payloads (text, SMS, email) decode exactly`, good, RUNS);
}

console.log(`\n${failed ? `${failed} FAILED, ` : 'All '}${passed} ${failed ? 'passed' : 'tests passed'}`);
process.exit(failed ? 1 : 0);
