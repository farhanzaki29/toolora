/**
 * Image Resizer: logic tests that run in Node (no dependencies).
 *   node tests/imageResizer.test.mjs
 * Pixel-level behaviour (transparency, JPEG background, real exported files, batch, Stop, cleanup) is tested in
 * the real-browser suite: tests/imageResizer.browser.mjs.
 */
import {
  MAX_DIMENSION, MAX_OUTPUT_PIXELS, PERCENT_PRESETS, SIZE_PRESETS, RESIZE_QUALITY, parseDimension, parsePercent, roundDiv,
  heightForWidth, widthForHeight, scaleByPercent, fitWithin, aspectChange, checkOutputSize, computeTarget, pairedDimension,
  buildResizedName, resizeSignature,
} from '../src/lib/imageResizer.js';
import { checkImageFile, detectImageType, resolveOutputType, needsBackground, normalizeHexColor, MAX_FILE_BYTES, MAX_PIXELS } from '../src/lib/imageCompressor.js';
import { FIXTURES, fixtureBytes } from './fixtures/images.mjs';

let passed = 0;
let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
};
const dims = (t) => (t.ok ? [t.width, t.height] : t.code);
const img = (width, height) => ({ width, height });
const custom = (c) => ({ mode: 'custom', custom: { lock: true, driver: 'width', ...c } });

/* ---------------------------------------------- Input validation / detection */
for (const [key, f] of Object.entries(FIXTURES)) {
  const b = fixtureBytes(key);
  const r = checkImageFile({ size: b.length, head: b });
  eq(`real ${key}: accepted, type from content, ${f.width}x${f.height}`, [r.ok, r.type, r.width, r.height], [true, f.type, f.width, f.height]);
}
eq('a JPEG named .png is identified as JPEG', detectImageType(fixtureBytes('jpeg')).type, 'image/jpeg');
eq('text file is rejected', checkImageFile({ size: 40, head: new TextEncoder().encode('just some text pretending to be an image....') }).code, 'unknown');
eq('GIF is rejected with a reason', checkImageFile({ size: 20, head: new TextEncoder().encode('GIF89a\x01\x00\x01\x00\x80\x00\x00') }).message, 'GIF images are not supported. Use a JPG, PNG or WebP file.');
eq('empty file is rejected', checkImageFile({ size: 0, head: new Uint8Array(0) }).message, 'This file is empty.');
eq('file over the size limit is rejected (shared limit)', checkImageFile({ size: MAX_FILE_BYTES + 1, head: fixtureBytes('png') }).code, 'too-large');
const huge = fixtureBytes('png').slice(); new DataView(huge.buffer).setUint32(16, 20000); new DataView(huge.buffer).setUint32(20, 20000);
eq('input over the pixel limit is rejected before decoding', checkImageFile({ size: huge.length, head: huge }).code, 'too-many-pixels');
eq('shared limits: 100 MB and 100 megapixels', [MAX_FILE_BYTES / 1048576, MAX_PIXELS / 1e6, MAX_OUTPUT_PIXELS / 1e6], [100, 100, 100]);

/* ------------------------------------------------------ parseDimension / parsePercent */
eq('parseDimension: valid', ['800', ' 1920 ', '1', String(MAX_DIMENSION)].map((s) => parseDimension(s).value), [800, 1920, 1, MAX_DIMENSION]);
eq('parseDimension: empty', parseDimension('').code, 'empty');
eq('parseDimension: zero is rejected', [parseDimension('0').code, parseDimension('000').code], ['zero', 'zero']);
eq('parseDimension: negative, decimal, text are rejected', ['-5', '12.5', 'abc', '1e3', '8 00', '+5'].map((s) => parseDimension(s).code), ['format', 'format', 'format', 'format', 'format', 'format']);
eq('parseDimension: over the maximum is rejected', parseDimension(String(MAX_DIMENSION + 1)).code, 'max');
eq('parseDimension: message names the limit', parseDimension('99999').message, 'Must be 16,384 pixels or less.');
eq('parseDimension: null/undefined are "empty"', [parseDimension(null).code, parseDimension(undefined).code], ['empty', 'empty']);
eq('parsePercent: valid', ['50', '62.5', '100%', ' 150 ', '0.5'.replace('0.5', '1')].map((s) => parsePercent(s).value), [50, 62.5, 100, 150, 1]);
eq('parsePercent: rejects 0, negative, text, too many decimals, over 1000', ['0', '-10', 'x', '12.345', '1001'].map((s) => parsePercent(s).code), ['min', 'format', 'format', 'format', 'max']);

/* -------------------------------------------------- Locked proportions + rounding */
eq('1600x1200 -> width 800 gives 800x600', dims(computeTarget(img(1600, 1200), custom({ width: 800 }))), [800, 600]);
eq('1600x1200 -> height 600 gives 800x600', dims(computeTarget(img(1600, 1200), custom({ height: 600, driver: 'height' }))), [800, 600]);
eq('locked: same width returns the exact original height (no drift)', dims(computeTarget(img(1234, 777), custom({ width: 1234 }))), [1234, 777]);
eq('locked: same height returns the exact original width (no drift)', dims(computeTarget(img(1234, 777), custom({ height: 777, driver: 'height' }))), [1234, 777]);
eq('half-up rounding: 1000x333 at width 500 -> height 167 (166.5)', dims(computeTarget(img(1000, 333), custom({ width: 500 }))), [500, 167]);
eq('rounding: 1600x1200 at width 333 -> height 250 (249.75)', dims(computeTarget(img(1600, 1200), custom({ width: 333 }))), [333, 250]);
eq('rounding is exact for large values (no float error)', heightForWidth(9999, 7777, 5000), Math.floor((2 * 5000 * 7777 + 9999) / (2 * 9999)));
eq('result is never smaller than 1 px', [dims(computeTarget(img(4000, 10), custom({ width: 5 }))), dims(computeTarget(img(10, 4000), custom({ height: 5, driver: 'height' })))], [[5, 1], [1, 5]]);
eq('roundDiv rounds halves up', [roundDiv(5, 2), roundDiv(7, 2), roundDiv(1, 3), roundDiv(2, 3)], [3, 4, 0, 1]);
eq('locked batch: each image keeps ITS OWN proportions at the same width', [img(1600, 1200), img(1000, 1000), img(900, 1600)].map((i) => dims(computeTarget(i, custom({ width: 800 })))), [[800, 600], [800, 800], [800, 1422]]);
eq('locked batch by height', [img(1600, 1200), img(1000, 1000), img(900, 1600)].map((i) => dims(computeTarget(i, custom({ height: 600, driver: 'height' })))), [[800, 600], [600, 600], [338, 600]]);
eq('pairedDimension shows the other side for a reference image', [pairedDimension(img(1600, 1200), 'width', 800), pairedDimension(img(1600, 1200), 'height', 600), pairedDimension(null, 'width', 800)], [600, 800, null]);
eq('round trip width -> height -> width is stable for 1600x1200', (() => { for (let w = 1; w <= 3000; w++) { const h = heightForWidth(1600, 1200, w); if (widthForHeight(1600, 1200, h) !== w && Math.abs(widthForHeight(1600, 1200, h) - w) > 1) return w; } return 'ok'; })(), 'ok');

/* ------------------------------------------------------------------ Unlocked */
eq('unlocked: exact width and height are used (distorting)', dims(computeTarget(img(1600, 1200), custom({ width: 500, height: 500, lock: false }))), [500, 500]);
eq('unlocked: flagged as stretching', computeTarget(img(1600, 1200), custom({ width: 500, height: 500, lock: false })).stretch, true);
eq('locked results are not flagged as stretching', computeTarget(img(1600, 1200), custom({ width: 500 })).stretch, false);
eq('unlocked with the original ratio is not flagged', computeTarget(img(1600, 1200), custom({ width: 800, height: 600, lock: false })).stretch, false);
eq('unlocked needs both sides', [computeTarget(img(10, 10), custom({ width: 5, height: null, lock: false })).code, computeTarget(img(10, 10), custom({ width: null, height: 5, lock: false })).code], ['missing', 'missing']);
eq('locked needs the driving side', [computeTarget(img(10, 10), custom({ width: null })).message, computeTarget(img(10, 10), custom({ height: null, driver: 'height' })).message], ['Enter a width.', 'Enter a height.']);
eq('aspectChange', [aspectChange(1600, 1200, 800, 600), +aspectChange(1600, 1200, 800, 800).toFixed(3)], [0, 0.25]);

/* ------------------------------------------------------------------ Percentage */
const pct = (i, p) => dims(computeTarget(i, { mode: 'percent', percent: p }));
eq('percent presets list', PERCENT_PRESETS, [25, 50, 75, 100, 150, 200]);
eq('percent presets on 1600x1200', PERCENT_PRESETS.map((p) => pct(img(1600, 1200), p)), [[400, 300], [800, 600], [1200, 900], [1600, 1200], [2400, 1800], [3200, 2400]]);
eq('100% is unchanged', computeTarget(img(1234, 777), { mode: 'percent', percent: 100 }).unchanged, true);
eq('percent rounding (33.3% of 1000x333)', pct(img(1000, 333), 33.3), [333, 111]);
eq('percent with two decimals is exact (12.34% of 10000x5000)', pct(img(10000, 5000), 12.34), [1234, 617]);
eq('tiny percent never gives 0 px', pct(img(50, 50), 1), [1, 1]);
eq('percent: not set', computeTarget(img(10, 10), { mode: 'percent', percent: NaN }).code, 'missing');
eq('scaleByPercent keeps proportions (odd sizes)', scaleByPercent(1001, 667, 50), { width: 501, height: 334 });
eq('enlarging is flagged', [computeTarget(img(100, 100), { mode: 'percent', percent: 200 }).enlarged, computeTarget(img(100, 100), { mode: 'percent', percent: 50 }).enlarged], [true, false]);

/* ------------------------------------------------------------------- Presets */
const preset = (i, id, allowEnlarge) => dims(computeTarget(i, { mode: 'preset', preset: id, allowEnlarge }));
eq('preset list', SIZE_PRESETS.map((p) => `${p.width}x${p.height}`), ['1920x1080', '1280x720', '1080x1080', '1080x1350', '1080x1920']);
eq('1600x1200 fits within 1920x1080 as 1440x1080 (no crop, no stretch)', preset(img(1600, 1200), '1920x1080'), [1440, 1080]);
eq('fit keeps the exact proportions (no stretching)', aspectChange(1600, 1200, 1440, 1080), 0);
eq('wide image is limited by width', preset(img(4000, 1000), '1920x1080'), [1920, 480]);
eq('tall image is limited by height', preset(img(1000, 4000), '1080x1920'), [480, 1920]);
eq('square preset with a landscape image', preset(img(1600, 1200), '1080x1080'), [1080, 810]);
eq('square preset with a portrait image', preset(img(1200, 1600), '1080x1080'), [810, 1080]);
eq('portrait 4:5 preset', preset(img(3000, 2000), '1080x1350'), [1080, 720]);
eq('result never exceeds the box (all images x all presets)', (() => { for (const p of SIZE_PRESETS) for (const [w, h] of [[1600, 1200], [1, 1], [10000, 3], [3, 10000], [1920, 1080], [4032, 3024], [999, 1001]]) { const t = computeTarget(img(w, h), { mode: 'preset', preset: p.id }); if (!t.ok || t.width > p.width || t.height > p.height || t.width < 1 || t.height < 1) return `${p.id} ${w}x${h} -> ${t.width}x${t.height}`; if (t.width !== p.width && t.height !== p.height) return `${p.id} ${w}x${h} touches neither side`; } return 'ok'; })(), 'ok');
eq('a small image is enlarged to fill the box when allowed', preset(img(480, 270), '1920x1080', true), [1920, 1080]);
eq('"don\'t enlarge" leaves a small image alone', preset(img(480, 270), '1920x1080', false), [480, 270]);
eq('"don\'t enlarge" still shrinks a big one', preset(img(4000, 3000), '1920x1080', false), [1440, 1080]);
eq('"don\'t enlarge" with one side too big still shrinks to fit', preset(img(2000, 500), '1920x1080', false), [1920, 480]);
eq('exact preset size is unchanged', computeTarget(img(1920, 1080), { mode: 'preset', preset: '1920x1080' }).unchanged, true);
eq('unknown preset', computeTarget(img(10, 10), { mode: 'preset', preset: 'nope' }).code, 'missing');
eq('fitWithin handles extreme ratios without 0 px', [fitWithin(10000, 1, 1920, 1080), fitWithin(1, 10000, 1920, 1080)], [{ width: 1920, height: 1 }, { width: 1, height: 1080 }]);

/* -------------------------------------------------------------------- Limits */
eq('a side over the maximum is refused with a clear message', computeTarget(img(1000, 1000), custom({ width: MAX_DIMENSION + 1, lock: false, height: 10 })).code, 'too-wide');
eq('too many pixels is refused (e.g. 16384 x 16384)', computeTarget(img(1000, 1000), custom({ width: 16384, height: 16384, lock: false })).code, 'too-many-pixels');
eq('exactly 100 megapixels is allowed (10000 x 10000)', computeTarget(img(1000, 1000), custom({ width: 10000, height: 10000, lock: false })).ok, true);
eq('one pixel over 100 megapixels is refused', checkOutputSize(10001, 10000).code, 'too-many-pixels');
eq('limit message names the size and the limit', checkOutputSize(16384, 16384).message, 'The result would be 16,384 × 16,384 px (268 megapixels). The limit is 100 megapixels.');
eq('a locked width can push the HEIGHT over the limit and is caught (tall image)', computeTarget(img(100, 1000), custom({ width: 5000 })).code, 'too-wide');
eq('percent that makes the result too big is refused per image', [computeTarget(img(8000, 8000), { mode: 'percent', percent: 200 }).code, computeTarget(img(1000, 1000), { mode: 'percent', percent: 200 }).ok], ['too-many-pixels', true]);
eq('unknown input size is reported', computeTarget(img(0, 0), custom({ width: 5 })).code, 'unknown-size');
eq('1x1 image can be resized', dims(computeTarget(img(1, 1), custom({ width: 10 }))), [10, 10]);

/* ------------------------------------------------- Output format selection + names */
eq('output format: same as original', ['image/jpeg', 'image/png', 'image/webp'].map((t) => resolveOutputType(t, 'original')), ['image/jpeg', 'image/png', 'image/webp']);
eq('output format: explicit choice', ['image/jpeg', 'image/png', 'image/webp'].map((c) => resolveOutputType('image/png', c)), ['image/jpeg', 'image/png', 'image/webp']);
eq('JPEG output of a transparent image needs a background; white is the default fallback', [needsBackground(true, 'image/jpeg'), needsBackground(true, 'image/png'), normalizeHexColor('nonsense')], [true, false, '#ffffff']);
eq('quality for lossy output is fixed and high', RESIZE_QUALITY, 92);
eq('file names carry the new size and the real extension', [buildResizedName('holiday photo.PNG', 'image/webp', 800, 600), buildResizedName('a.jpeg', 'image/jpeg', 1920, 1080), buildResizedName('a.jpg', 'image/png', 50, 50)], ['holiday photo-800x600.webp', 'a-1920x1080.jpg', 'a-50x50.png']);
const taken = new Set();
eq('duplicate names are made unique (same size)', [buildResizedName('a.jpg', 'image/jpeg', 100, 100, taken), buildResizedName('A.JPG', 'image/jpeg', 100, 100, taken), buildResizedName('a.png', 'image/jpeg', 100, 100, taken)], ['a-100x100.jpg', 'A-100x100-2.jpg', 'a-100x100-3.jpg']);
eq('names are made safe', buildResizedName('bad<name>:x?.png', 'image/png', 10, 20), 'bad_name__x_-10x20.png');
eq('resizeSignature changes with size, type and (when relevant) background', [
  resizeSignature({ target: { width: 1, height: 2 }, outputType: 'image/png', background: '#fff', needsBg: false }) === resizeSignature({ target: { width: 1, height: 2 }, outputType: 'image/png', background: '#000', needsBg: false }),
  resizeSignature({ target: { width: 1, height: 2 }, outputType: 'image/jpeg', background: '#fff', needsBg: true }) === resizeSignature({ target: { width: 1, height: 2 }, outputType: 'image/jpeg', background: '#000', needsBg: true }),
  resizeSignature({ target: { width: 1, height: 2 }, outputType: 'image/png' }) === resizeSignature({ target: { width: 1, height: 3 }, outputType: 'image/png' }),
], [true, false, false]);

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nAll ${passed} tests passed`);
process.exit(failed ? 1 : 0);
