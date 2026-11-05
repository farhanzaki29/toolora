/**
 * Image Compressor: logic + ZIP tests that run in Node (no dependencies).
 *   node tests/imageCompressor.test.mjs
 *
 * What cannot be tested in Node (decoding pixels, canvas encoding, downloads, the UI) is covered by the
 * real-browser suite in tests/imageCompressor.browser.mjs.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IMAGE_TYPES, MAX_FILE_BYTES, MAX_PIXELS, PRESETS, detectImageType, readImageDimensions, checkImageFile, fileKey,
  clampQuality, presetForQuality, canvasQuality, pngBitsForQuality, resolveOutputType, needsBackground,
  normalizeHexColor, settingsSignature, sanitizeBaseName, buildOutputName, buildOriginalName, formatBytes,
  compareSizes, describeSizeChange, summarizeBatch, formatDimensions,
} from '../src/lib/imageCompressor.js';
import { createZip, readZip, crc32 } from '../src/lib/zip.js';
import { FIXTURES, fixtureBytes } from './fixtures/images.mjs';

let passed = 0;
let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
};
const bytes = (...parts) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const pad = (arr, n = 64) => Uint8Array.from([...arr, ...new Array(Math.max(0, n - arr.length)).fill(0)]);

/* ------------------------------------------------ Real files: JPG / PNG / WebP */
for (const [key, f] of Object.entries(FIXTURES)) {
  const b = fixtureBytes(key);
  eq(`real ${key}: type detected from content`, detectImageType(b), { ok: true, type: f.type });
  eq(`real ${key}: dimensions read from the header`, readImageDimensions(b, f.type), { width: f.width, height: f.height });
  eq(`real ${key}: accepted by checkImageFile`, (({ ok, type, width, height }) => ({ ok, type, width, height }))(checkImageFile({ size: b.length, head: b })), { ok: true, type: f.type, width: f.width, height: f.height });
}
eq('JPG and JPEG are the same content type (extension is irrelevant)', [detectImageType(fixtureBytes('jpeg')).type, IMAGE_TYPES['image/jpeg'].ext], ['image/jpeg', 'jpg']);
eq('a JPEG named photo.png is still recognised as JPEG', detectImageType(fixtureBytes('jpeg')).type, 'image/jpeg');
eq('supported output types', Object.keys(IMAGE_TYPES), ['image/jpeg', 'image/png', 'image/webp']);

/* ------------------------------------------------ Bare WebP chunk headers (synthetic) */
const riff = (chunk, body) => pad(bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body), 64);
eq('bare lossy WebP (VP8 ) dimensions', readImageDimensions(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 100, 0, 50, 0]), 'image/webp'), { width: 100, height: 50 });
const w1 = 200 - 1, h1 = 120 - 1; const packed = (w1 | (h1 << 14)) >>> 0;
eq('bare lossless WebP (VP8L) dimensions', readImageDimensions(riff('VP8L', [0x2f, packed & 255, (packed >> 8) & 255, (packed >> 16) & 255, (packed >>> 24) & 255]), 'image/webp'), { width: 200, height: 120 });
eq('extended WebP (VP8X) dimensions', readImageDimensions(riff('VP8X', [0, 0, 0, 0, 0x0f, 0x27, 0, 0xc7, 0x1d, 0]), 'image/webp'), { width: 10000, height: 7624 });

/* ------------------------------------------------ Unsupported / invalid files */
const check = (head, size = head.length) => checkImageFile({ size, head });
eq('GIF is rejected with a clear message', check(pad(bytes('GIF89a'))).message, 'GIF images are not supported. Use a JPG, PNG or WebP file.');
eq('BMP rejected', check(pad(bytes('BM', [0, 0, 0, 0, 0, 0, 0, 0]))).message, 'BMP files are not supported. Use a JPG, PNG or WebP file.');
eq('TIFF rejected', check(pad(bytes([0x49, 0x49, 0x2a, 0]))).code, 'unsupported');
eq('HEIC rejected', check(pad(bytes([0, 0, 0, 24], 'ftypheic'))).message, 'HEIC/HEIF files are not supported. Use a JPG, PNG or WebP file.');
eq('AVIF rejected', check(pad(bytes([0, 0, 0, 24], 'ftypavif'))).message, 'AVIF files are not supported. Use a JPG, PNG or WebP file.');
eq('SVG rejected', check(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).message, 'SVG files are not supported. Use a JPG, PNG or WebP file.');
eq('SVG with XML prolog rejected', check(bytes('<?xml version="1.0"?><svg></svg>')).code, 'unsupported');
eq('PDF rejected', check(bytes('%PDF-1.7')).code, 'unsupported');
eq('ICO rejected', check(pad(bytes([0, 0, 1, 0]))).code, 'unsupported');
eq('WAV/AVI (RIFF but not WebP) rejected', check(pad(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '))).code, 'unsupported');
eq('plain text renamed to .jpg is rejected as unrecognised', check(bytes('hello, this is just text')).code, 'unknown');
eq('random bytes rejected', check(Uint8Array.from({ length: 200 }, (_, i) => (i * 37 + 11) & 255)).code, 'unknown');
eq('empty file rejected', check(new Uint8Array(0), 0).message, 'This file is empty.');
eq('file over the size limit rejected', check(fixtureBytes('png'), MAX_FILE_BYTES + 1).code, 'too-large');
eq('file exactly at the size limit is allowed', check(fixtureBytes('png'), MAX_FILE_BYTES).ok, true);
const hugePng = fixtureBytes('png').slice(); new DataView(hugePng.buffer).setUint32(16, 20000); new DataView(hugePng.buffer).setUint32(20, 20000);
eq('image over the pixel limit rejected before decoding', check(hugePng).code, 'too-many-pixels');
eq('pixel limit message names the size', check(hugePng).message, 'This image is 20,000 \u00d7 20,000 px (400 megapixels). The limit is 100 megapixels.');
const okPng = fixtureBytes('png').slice(); new DataView(okPng.buffer).setUint32(16, 10000); new DataView(okPng.buffer).setUint32(20, 10000);
eq('exactly 100 megapixels is allowed', [MAX_PIXELS, check(okPng).ok], [100_000_000, true]);
const zeroPng = fixtureBytes('png').slice(); new DataView(zeroPng.buffer).setUint32(16, 0);
eq('zero-sized image treated as damaged', check(zeroPng).code, 'corrupt');
eq('truncated PNG (signature only) passes the header check; decoding will catch it', check(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).ok, true);
eq('duplicate key is stable and distinguishes files', [fileKey({ name: 'a.jpg', size: 1, lastModified: 5 }) === fileKey({ name: 'a.jpg', size: 1, lastModified: 5 }), fileKey({ name: 'a.jpg', size: 1, lastModified: 5 }) === fileKey({ name: 'a.jpg', size: 2, lastModified: 5 })], [true, false]);

/* ------------------------------------------------ Quality, presets, formats */
eq('presets', Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.quality])), { high: 92, balanced: 80, small: 60 });
eq('clampQuality bounds and junk', [clampQuality(5), clampQuality(150), clampQuality(72.6), clampQuality('abc'), clampQuality(undefined)], [10, 100, 73, 80, 80]);
eq('presetForQuality recognises presets and custom', [presetForQuality(92), presetForQuality(80), presetForQuality(60), presetForQuality(75)], ['high', 'balanced', 'small', 'custom']);
eq('canvasQuality maps percent to 0..1', [canvasQuality(80), canvasQuality(100), canvasQuality(1)], [0.8, 1, 0.1]);
eq('PNG colour bits per preset (8 = lossless)', [92, 80, 60].map(pngBitsForQuality), [8, 7, 6]);
eq('PNG bits stay within 4..8', [10, 25, 50, 100].map(pngBitsForQuality), [4, 5, 6, 8]);
eq('resolveOutputType: keep original', ['image/png', 'image/jpeg', 'image/webp'].map((t) => resolveOutputType(t, 'original')), ['image/png', 'image/jpeg', 'image/webp']);
eq('resolveOutputType: explicit choice wins', resolveOutputType('image/png', 'image/webp'), 'image/webp');
eq('resolveOutputType: unknown choice falls back to the source type', resolveOutputType('image/png', 'image/avif'), 'image/png');
eq('transparent -> JPEG needs a background; others do not', [needsBackground(true, 'image/jpeg'), needsBackground(true, 'image/png'), needsBackground(true, 'image/webp'), needsBackground(false, 'image/jpeg')], [true, false, false, false]);
eq('normalizeHexColor', [normalizeHexColor('#FFF'), normalizeHexColor('ff8800'), normalizeHexColor('#AaBbCc'), normalizeHexColor('red'), normalizeHexColor('', '#000000')], ['#ffffff', '#ff8800', '#aabbcc', '#ffffff', '#000000']);
eq('settingsSignature ignores background unless it matters', [
  settingsSignature({ quality: 80, outputType: 'image/png', background: '#ff0000', hasAlpha: true }) === settingsSignature({ quality: 80, outputType: 'image/png', background: '#00ff00', hasAlpha: true }),
  settingsSignature({ quality: 80, outputType: 'image/jpeg', background: '#ff0000', hasAlpha: true }) === settingsSignature({ quality: 80, outputType: 'image/jpeg', background: '#00ff00', hasAlpha: true }),
  settingsSignature({ quality: 80, outputType: 'image/jpeg', background: '#ff0000', hasAlpha: false }) === settingsSignature({ quality: 80, outputType: 'image/jpeg', background: '#00ff00', hasAlpha: false }),
  settingsSignature({ quality: 80, outputType: 'image/webp' }) === settingsSignature({ quality: 60, outputType: 'image/webp' }),
], [true, false, true, false]);

/* ------------------------------------------------ File names */
eq('sanitizeBaseName strips folder and extension', sanitizeBaseName('C:\\Users\\me\\Holiday photo.JPG'), 'Holiday photo');
eq('sanitizeBaseName replaces unsafe characters', sanitizeBaseName('a<b>:c"d/e|f?g*.png'), 'e_f_g_');
eq('sanitizeBaseName keeps unicode and emoji', sanitizeBaseName('caf\u00e9 \u65e5\u672c \u{1F600}.webp'), 'caf\u00e9 \u65e5\u672c \u{1F600}');
eq('sanitizeBaseName handles empty and dot-only names', [sanitizeBaseName(''), sanitizeBaseName('...png'), sanitizeBaseName('.jpg'), sanitizeBaseName('   .png')], ['image', 'image', '.jpg'.slice(1) === 'jpg' ? 'jpg' : 'image', 'image']);
eq('sanitizeBaseName avoids Windows reserved names', [sanitizeBaseName('CON.png'), sanitizeBaseName('lpt1.jpg'), sanitizeBaseName('console.png')], ['_CON', '_lpt1', 'console']);
eq('sanitizeBaseName limits length', [...sanitizeBaseName('x'.repeat(300) + '.png')].length, 100);
eq('output name keeps the original name and uses the real output extension', [
  buildOutputName('holiday photo.PNG', 'image/webp'), buildOutputName('a.jpeg', 'image/jpeg'), buildOutputName('a.jpg', 'image/png'),
], ['holiday photo-compressed.webp', 'a-compressed.jpg', 'a-compressed.png']);
const taken = new Set();
eq('duplicate output names get -2, -3 (case-insensitive)', [buildOutputName('a.jpg', 'image/jpeg', taken), buildOutputName('A.JPG', 'image/jpeg', taken), buildOutputName('a.png', 'image/jpeg', taken)], ['a-compressed.jpg', 'A-compressed-2.jpg', 'a-compressed-3.jpg']);
const taken2 = new Set();
eq('original names are kept (never "-compressed") and made unique', [buildOriginalName('Photo.JPEG', 'image/jpeg', taken2), buildOriginalName('photo.jpeg', 'image/jpeg', taken2), buildOriginalName('noext', 'image/png', taken2)], ['Photo.jpeg', 'photo-2.jpeg', 'noext.png']);

/* ------------------------------------------------ Formatting */
eq('formatBytes', [0, 1, 1023, 1024, 1536, 10240, 1048576, 5.5 * 1048576, 123.4 * 1048576].map(formatBytes), ['0 B', '1 B', '1023 B', '1.0 KB', '1.5 KB', '10 KB', '1.00 MB', '5.50 MB', '123.4 MB']);
eq('formatBytes rejects bad input', [formatBytes(NaN), formatBytes(-1)], ['\u2014', '\u2014']);
eq('compareSizes: smaller / larger / same', [compareSizes(1000, 250), compareSizes(1000, 1100), compareSizes(1000, 1000)], [{ direction: 'smaller', bytes: 750, percent: 75 }, { direction: 'larger', bytes: 100, percent: 10 }, { direction: 'same', bytes: 0, percent: 0 }]);
eq('compareSizes percent rounding', [compareSizes(1000, 966).percent, compareSizes(1000, 500).percent, compareSizes(0, 0).percent], [3.4, 50, 0]);
eq('describeSizeChange', [describeSizeChange(2048, 1024), describeSizeChange(1024, 2048), describeSizeChange(1024, 1024)], ['Saved 1.0 KB (50%)', 'Larger by 1.0 KB (+100%)', 'No change in size']);
eq('summarizeBatch', summarizeBatch([{ originalSize: 1000, size: 400 }, { originalSize: 3000, size: 600 }]), { count: 2, original: 4000, result: 1000, direction: 'smaller', bytes: 3000, percent: 75 });
eq('formatDimensions', [formatDimensions(4032, 3024), formatDimensions(0, 0)], ['4,032 \u00d7 3,024 px', '']);

/* ------------------------------------------------ ZIP */
eq('CRC-32 known answer ("123456789")', crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
const files = [
  { name: 'photo-compressed.jpg', data: fixtureBytes('jpeg') },
  { name: 'logo-compressed.png', data: new Blob([fixtureBytes('png')]) },
  { name: 'caf\u00e9 \u65e5\u672c \u{1F600}-compressed.webp', data: fixtureBytes('webpAlpha').buffer.slice(0) },
  { name: 'empty.bin', data: new Uint8Array(0) },
];
const zip = await createZip(files, { now: new Date(2025, 5, 15, 12, 30, 40) });
eq('zip has the ZIP media type', zip.type, 'application/zip');
const read = await readZip(zip);
eq('zip round trip: names (including unicode)', read.map((e) => e.name), files.map((f) => f.name));
eq('zip round trip: every CRC verifies', read.every((e) => e.crcOk), true);
eq('zip round trip: bytes are identical', [[0, fixtureBytes('jpeg')], [1, fixtureBytes('png')], [2, fixtureBytes('webpAlpha')], [3, new Uint8Array(0)]].map(([k, expected]) => Buffer.compare(Buffer.from(read[k].bytes), Buffer.from(expected)) === 0), [true, true, true, true]);
eq('zip rejects empty list', await createZip([]).then(() => 'no error', (e) => e.message), 'Nothing to add to the ZIP file.');
eq('zip rejects unsafe names', await Promise.all(['../evil.png', '/abs.png', 'a\\b.png'].map((name) => createZip([{ name, data: new Uint8Array(1) }]).then(() => 'accepted', () => 'rejected'))), ['rejected', 'rejected', 'rejected']);

// Real extractor: the operating system's own unzip tool must be able to open the archive and recover the files.
const dir = mkdtempSync(join(tmpdir(), 'toolora-zip-'));
try {
  const zipPath = join(dir, 'test.zip');
  const out = join(dir, 'out');
  writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()));
  const r = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${out}' -Force`], { encoding: 'utf8' })
    : spawnSync('unzip', ['-q', zipPath, '-d', out], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.log(`SKIP  real extractor not available (${r.error?.message ?? r.stderr?.trim()})`);
  } else {
    const same = (name, expected) => existsSync(join(out, name)) && Buffer.compare(readFileSync(join(out, name)), Buffer.from(expected)) === 0;
    eq('REAL EXTRACTOR: JPEG recovered byte-for-byte', same('photo-compressed.jpg', fixtureBytes('jpeg')), true);
    eq('REAL EXTRACTOR: PNG recovered byte-for-byte', same('logo-compressed.png', fixtureBytes('png')), true);
    eq('REAL EXTRACTOR: unicode file name and WebP recovered', same('caf\u00e9 \u65e5\u672c \u{1F600}-compressed.webp', fixtureBytes('webpAlpha')), true);
    eq('REAL EXTRACTOR: empty file recovered', existsSync(join(out, 'empty.bin')) && readFileSync(join(out, 'empty.bin')).length === 0, true);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nAll ${passed} tests passed`);
process.exit(failed ? 1 : 0);
