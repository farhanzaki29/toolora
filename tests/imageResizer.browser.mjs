/**
 * Image Resizer: REAL-BROWSER tests. They create real image files, run them through the real resizer and the
 * real page, then decode the EXPORTED files and inspect their bytes, dimensions and pixels.
 *
 * Run with the dev server on http://localhost:4321, from the page /tools/image-resizer:
 *   const m = await import('/tests/imageResizer.browser.mjs');  await m.runCodecTests();  await m.runUiTests();
 * Each returns { passed, failed, results[] }.
 */
import { decodeImage, probeEncoders } from '../src/lib/imageCodec.js';
import { resizeImage, resizeFile } from '../src/lib/imageResizeCodec.js';
import { computeTarget, fitWithin } from '../src/lib/imageResizer.js';
import { readZip } from '../src/lib/zip.js';
import { formatBytes } from '../src/lib/imageCompressor.js';
import { FIXTURES } from './fixtures/images.mjs';
import { makeRunner, assert, sleep, drawPicture, makeFile, bytesOf, pixels, px, isPng, isJpeg, isWebp, near } from './imageCompressor.browser.mjs';

const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));
const lum = (p, x, y) => { const c = px(p, x, y); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
const sig = async (blob) => { const b = await bytesOf(blob, 16); return isPng(b) ? 'png' : isJpeg(b) ? 'jpeg' : isWebp(b) ? 'webp' : 'other'; };

/** Fine black/white checkerboard (1-pixel squares): the hardest picture for a resampler. */
function drawChecker(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const img = x.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) { const v = (i + y) % 2 ? 255 : 0; const o = (y * w + i) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255; }
  x.putImageData(img, 0, 0); return c;
}
/** Grey picture with 6-pixel coloured borders: red left, blue right, green top, yellow bottom (to prove nothing is cropped). */
function drawFramed(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, 6, h); x.fillStyle = '#0000ff'; x.fillRect(w - 6, 0, 6, h);
  x.fillStyle = '#00ff00'; x.fillRect(6, 0, w - 12, 6); x.fillStyle = '#ffff00'; x.fillRect(6, h - 6, w - 12, 6);
  return c;
}

/* ================================================================= codec tests */
export async function runCodecTests() {
  const R = makeRunner('Resize codec (real encoder, real exported files)');
  const photoC = drawPicture(1600, 1200);
  const alphaC = drawPicture(1600, 1200, { alpha: true });
  const photoJpeg = await makeFile(photoC, 'image/jpeg', 0.95, 'photo.jpg');
  const alphaPng = await makeFile(alphaC, 'image/png', undefined, 'logo.png');
  const alphaWebp = await makeFile(alphaC, 'image/webp', 1, 'logo.webp');
  const run = (file, settings, o = {}) => { const d = file; return decodeImage(d).then(async (dec) => { try { const t = computeTarget({ width: dec.width, height: dec.height }, settings); assert(t.ok, t.message); const out = await resizeImage(dec, { width: t.width, height: t.height, type: o.type, background: o.background, shouldCancel: o.shouldCancel }); return { out, t }; } finally { dec.release(); } }); };
  const locked = (width) => ({ mode: 'custom', custom: { lock: true, driver: 'width', width } });

  await R.test('encoders available: JPEG, PNG, WebP', async () => { const s = await probeEncoders(); assert(s['image/jpeg'] && s['image/png'] && s['image/webp'], JSON.stringify(s)); return JSON.stringify(s); });

  /* ---- Requested example: 1600x1200 -> 800x600, locked ---- */
  for (const [type, label] of [['image/jpeg', 'JPEG'], ['image/png', 'PNG'], ['image/webp', 'WebP']]) {
    await R.test(`1600x1200 -> width 800 (locked) as ${label}: exported file is a real ${label} and decodes at exactly 800 x 600`, async () => {
      const { out, t } = await run(photoJpeg, locked(800), { type });
      assert(t.width === 800 && t.height === 600, `${t.width}x${t.height}`); assert(out.actualType === type, out.actualType); assert((await sig(out.blob)) === label.toLowerCase(), 'wrong signature');
      const p = await pixels(out.blob); assert(p.width === 800 && p.height === 600, `decoded ${p.width}x${p.height}`); return `${formatBytes(out.blob.size)}`;
    });
  }

  /* ---- Requested example: fit within 1920x1080 without cropping or stretching ---- */
  await R.test('1600x1200 fitted within 1920x1080 -> 1440 x 1080 (decoded from the exported file)', async () => {
    const { out, t } = await run(photoJpeg, { mode: 'preset', preset: '1920x1080' }, { type: 'image/png' }); assert(t.width === 1440 && t.height === 1080, `${t.width}x${t.height}`);
    const p = await pixels(out.blob); assert(p.width === 1440 && p.height === 1080, `${p.width}x${p.height}`); assert(Math.abs(p.width / p.height - 1600 / 1200) < 0.0005, 'proportions changed'); return 'exact 1440x1080, 4:3 kept';
  });
  await R.test('nothing is cropped: all four coloured borders of the source are still on the edges of the resized file', async () => {
    const framed = await makeFile(drawFramed(1600, 1200), 'image/png', undefined, 'framed.png'); const { out } = await run(framed, { mode: 'preset', preset: '1920x1080' }, { type: 'image/png' }); const p = await pixels(out.blob);
    const L = px(p, 1, p.height / 2), Rr = px(p, p.width - 2, p.height / 2), T = px(p, p.width / 2, 1), B = px(p, p.width / 2, p.height - 2), C = px(p, p.width / 2, p.height / 2);
    assert(L[0] > 200 && L[1] < 60 && L[2] < 60, `left ${L}`); assert(Rr[2] > 200 && Rr[0] < 60, `right ${Rr}`); assert(T[1] > 200 && T[0] < 60, `top ${T}`); assert(B[0] > 200 && B[1] > 200 && B[2] < 60, `bottom ${B}`); assert(near(C.slice(0, 3), [128, 128, 128], 4), `centre ${C}`);
    return 'red/blue/green/yellow edges present at the borders';
  });
  await R.test('nothing is stretched: content is in the same place proportionally (quadrant colours match the source)', async () => {
    const src = await pixels(photoJpeg); const { out } = await run(photoJpeg, { mode: 'preset', preset: '1080x1080' }, { type: 'image/png' }); const p = await pixels(out.blob); assert(p.width === 1080 && p.height === 810, `${p.width}x${p.height}`);
    const mean = (img, fx, fy) => { let r = 0, g = 0, b = 0, n = 0; const x0 = Math.floor(img.width * fx), y0 = Math.floor(img.height * fy), w = Math.floor(img.width / 4), h = Math.floor(img.height / 4); for (let y = y0; y < y0 + h; y += 3) for (let x = x0; x < x0 + w; x += 3) { const c = px(img, x, y); r += c[0]; g += c[1]; b += c[2]; n++; } return [r / n, g / n, b / n]; };
    for (const [fx, fy] of [[0.1, 0.1], [0.65, 0.1], [0.1, 0.65], [0.65, 0.65], [0.4, 0.4]]) { const a = mean(src, fx, fy), b = mean(p, fx, fy); assert(near(a, b, 6), `at ${fx},${fy}: source ${a.map(Math.round)} vs result ${b.map(Math.round)}`); }
    return '5 regions match within 6/255';
  });

  /* ---- Resampling quality ---- */
  await R.test('resampling quality: a 1px checkerboard shrunk 4x averages to mid-grey (no harsh aliasing)', async () => {
    const f = await makeFile(drawChecker(1600, 1200), 'image/png', undefined, 'checker.png'); const { out, t } = await run(f, { mode: 'percent', percent: 25 }, { type: 'image/png' }); assert(t.width === 400 && t.height === 300, `${t.width}x${t.height}`);
    const p = await pixels(out.blob); let s = 0, s2 = 0, n = 0; for (let y = 2; y < p.height - 2; y += 2) for (let x = 2; x < p.width - 2; x += 2) { const v = lum(p, x, y); s += v; s2 += v * v; n++; } const mean = s / n, sd = Math.sqrt(s2 / n - mean * mean);
    assert(mean > 118 && mean < 137, `mean ${mean.toFixed(1)}`); assert(sd < 30, `std ${sd.toFixed(1)}`); return `mean ${mean.toFixed(1)}, std ${sd.toFixed(1)} (ideal 127.5, 0)`;
  });
  await R.test('big reductions work in steps: 6000 x 4000 -> 600 x 400 exports correctly', async () => {
    const big = await makeFile(drawPicture(6000, 4000), 'image/jpeg', 0.8, 'big.jpg'); const t0 = performance.now(); const { out, t } = await run(big, { mode: 'percent', percent: 10 }, { type: 'image/jpeg' }); const ms = Math.round(performance.now() - t0);
    const p = await pixels(out.blob); assert(t.width === 600 && t.height === 400 && p.width === 600 && p.height === 400, `${p.width}x${p.height}`); return `24 MP -> 0.24 MP in ${ms} ms`;
  });
  await R.test('enlarging: 200% of 300 x 200 exports at 600 x 400', async () => { const f = await makeFile(drawPicture(300, 200), 'image/png', undefined, 's.png'); const { out, t } = await run(f, { mode: 'percent', percent: 200 }, { type: 'image/png' }); const p = await pixels(out.blob); assert(t.enlarged && p.width === 600 && p.height === 400, `${p.width}x${p.height}`); return 'ok'; });
  await R.test('unlocked custom size really stretches to the exact width and height asked for', async () => {
    const { out } = await run(photoJpeg, { mode: 'custom', custom: { lock: false, width: 500, height: 500 } }, { type: 'image/webp' }); const p = await pixels(out.blob); assert(p.width === 500 && p.height === 500, `${p.width}x${p.height}`); return '500 x 500';
  });

  /* ---- Transparency ---- */
  await R.test('PNG: transparency survives resizing (transparent corner, opaque centre, soft semi-transparent ring)', async () => {
    const { out } = await run(alphaPng, locked(800), { type: 'image/png' }); assert((await sig(out.blob)) === 'png', 'not PNG'); const p = await pixels(out.blob);
    assert(px(p, 2, 2)[3] === 0 && px(p, 797, 597)[3] === 0, 'corners are not transparent'); assert(px(p, 400, 300)[3] === 255, 'centre is not opaque');
    let semi = 0, sum = 0; for (let i = 3; i < p.data.length; i += 4) { sum += p.data[i]; if (p.data[i] > 10 && p.data[i] < 245) semi++; } assert(semi > 200, `${semi} semi-transparent pixels`);
    const src = await pixels(alphaPng); let ss = 0; for (let i = 3; i < src.data.length; i += 4) ss += src.data[i]; const a = sum / (p.width * p.height), b = ss / (src.width * src.height); assert(Math.abs(a - b) < 3, `mean alpha ${a.toFixed(1)} vs source ${b.toFixed(1)}`);
    return `${semi} semi-transparent px; mean alpha ${a.toFixed(1)} (source ${b.toFixed(1)})`;
  });
  await R.test('PNG: transparency is not flattened to white or black', async () => { const { out } = await run(alphaPng, locked(400), { type: 'image/png' }); const p = await pixels(out.blob); const c = px(p, 3, 3); assert(c[3] === 0, `corner alpha ${c[3]}`); return `corner = ${c}`; });
  await R.test('WebP: genuine WebP file with transparency preserved', async () => {
    const { out } = await run(alphaPng, locked(800), { type: 'image/webp' }); assert(out.actualType === 'image/webp' && (await sig(out.blob)) === 'webp', 'not WebP'); const p = await pixels(out.blob);
    assert(px(p, 2, 2)[3] <= 3, `corner alpha ${px(p, 2, 2)[3]}`); assert(px(p, 400, 300)[3] >= 252, `centre alpha ${px(p, 400, 300)[3]}`); const h = await bytesOf(out.blob, 32); return `chunk ${String.fromCharCode(...h.slice(12, 16))}`;
  });
  await R.test('WebP source with transparency resized to PNG keeps its alpha', async () => { const { out } = await run(alphaWebp, locked(600), { type: 'image/png' }); const p = await pixels(out.blob); assert(px(p, 2, 2)[3] === 0 && px(p, 300, 225)[3] === 255, 'alpha lost'); return 'ok'; });
  for (const [hex, rgb] of [[undefined, [255, 255, 255]], ['#ffffff', [255, 255, 255]], ['#ff0000', [255, 0, 0]], ['#336699', [51, 102, 153]], ['#000000', [0, 0, 0]]]) {
    await R.test(`JPEG from a transparent image: background ${hex ?? '(default)'} fills the transparent areas`, async () => {
      const { out } = await run(alphaPng, locked(800), { type: 'image/jpeg', background: hex }); assert((await sig(out.blob)) === 'jpeg', 'not JPEG'); const p = await pixels(out.blob); const c = px(p, 3, 3); assert(near(c.slice(0, 3), rgb, 12) && c[3] === 255, `corner ${c}`); return `corner = ${c}`;
    });
  }
  await R.test('JPEG output is fully opaque everywhere and the opaque centre keeps its own colours', async () => {
    const { out } = await run(alphaPng, locked(800), { type: 'image/jpeg', background: '#ff00ff' }); const p = await pixels(out.blob); for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 255) throw new Error('non-opaque pixel'); const c = px(p, 400, 300); assert(!near(c.slice(0, 3), [255, 0, 255], 60), `centre looks like the background: ${c}`); return 'all opaque';
  });
  await R.test('opaque JPEG source is unaffected by the background setting', async () => { const a = await run(photoJpeg, locked(400), { type: 'image/jpeg', background: '#ff0000' }); const p = await pixels(a.out.blob); assert(!near(px(p, 3, 3).slice(0, 3), [255, 0, 0], 40), 'background leaked'); return 'ok'; });

  /* ---- Honest format reporting + safeguards ---- */
  await R.test('format honesty: asking for an unsupported type reports the type the file REALLY has', async () => {
    const { out } = await run(photoJpeg, locked(200), { type: 'image/avif' }); const real = await sig(out.blob); assert(out.requestedType === 'image/avif', 'requested type lost'); if (real === 'png') assert(out.actualType === 'image/png', `bytes are PNG but actualType is ${out.actualType}`); assert(out.actualType !== 'image/avif' || real === 'other', 'claims AVIF but the bytes are not'); return `asked image/avif, file is ${out.actualType}`;
  });
  await R.test('safeguard: if the browser exports a different size than requested, it is reported (not silently accepted)', async () => {
    const small = await toBlob(drawPicture(10, 10), 'image/png'); const orig = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function (cb) { cb(small); };
    try { await run(photoJpeg, locked(200), { type: 'image/png' }); throw new Error('accepted a wrong-size export'); } catch (e) { assert(e.code === 'size-mismatch', e.message); return e.message; } finally { HTMLCanvasElement.prototype.toBlob = orig; }
  });
  await R.test('safeguard: encoder returning nothing gives a readable error', async () => {
    const orig = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
    try { await run(photoJpeg, locked(200), { type: 'image/png' }); throw new Error('no error'); } catch (e) { assert(e.code === 'encode-failed' && /could not create the resized image/.test(e.message), e.message); return e.message; } finally { HTMLCanvasElement.prototype.toBlob = orig; }
  });
  for (const [key, f] of Object.entries(FIXTURES)) {
    await R.test(`real ${key} sample (${f.width}x${f.height}): resizes to 24x16 and 96x64 in all three formats`, async () => {
      const file = new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], `${key}.bin`, { type: f.type });
      for (const [w, h] of [[24, 16], [96, 64]]) for (const type of ['image/jpeg', 'image/png', 'image/webp']) { const out = await resizeFile(file, { width: w, height: h, type }); assert(out.actualType === type, `${type}->${out.actualType}`); const p = await pixels(out.blob); assert(p.width === w && p.height === h, `${p.width}x${p.height}`); }
      return 'ok';
    });
  }

  /* ---- Resources and cancellation ---- */
  await R.test('cleanup: every decoded bitmap is closed (success, error and cancel)', async () => {
    let made = 0, closed = 0; const oc = window.createImageBitmap, ocl = ImageBitmap.prototype.close; window.createImageBitmap = async (...a) => { const b = await oc(...a); made++; return b; }; ImageBitmap.prototype.close = function () { closed++; return ocl.call(this); };
    try {
      await resizeFile(photoJpeg, { width: 400, height: 300, type: 'image/webp' }); await resizeFile(alphaPng, { width: 400, height: 300, type: 'image/jpeg' });
      await resizeFile(photoJpeg, { width: 400, height: 300, type: 'image/png', shouldCancel: () => true }).then(() => { throw new Error('cancel ignored'); }, (e) => assert(e.code === 'cancelled', e.message));
      const orig = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }; try { await resizeFile(photoJpeg, { width: 400, height: 300, type: 'image/png' }).catch(() => {}); } finally { HTMLCanvasElement.prototype.toBlob = orig; }
    } finally { window.createImageBitmap = oc; ImageBitmap.prototype.close = ocl; }
    assert(made === 4 && made === closed, `${made} created, ${closed} closed`); return `${made} bitmaps created, ${closed} closed`;
  });
  await R.test('cancel during a large reduction stops between steps', async () => { const big = await makeFile(drawPicture(4000, 3000), 'image/jpeg', 0.7, 'b.jpg'); let n = 0; const err = await resizeFile(big, { width: 200, height: 150, type: 'image/jpeg', shouldCancel: () => ++n > 1 }).then(() => null, (e) => e); assert(err && err.code === 'cancelled', 'not cancelled'); return `cancelled after ${n} checks`; });

  return R.finish();
}

/* ================================================================= UI tests (drive the real page) */
const fileOf = (bytes, name, type = '') => new File([bytes], name, { type, lastModified: 1700000000000 + Math.floor(Math.random() * 1e6) });
const ascii8 = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

export async function runUiTests() {
  const R = makeRunner('Resizer UI (real page, real files, real downloads)');
  const root = document.querySelector('[data-ir]');
  if (!root) throw new Error('Open /tools/image-resizer first.');
  const ir = root.__ir;
  const q = (s) => root.querySelector(s);
  const qa = (s) => [...root.querySelectorAll(s)];
  const waitFor = async (cond, ms = 20000, what = 'condition') => { const t = performance.now(); while (performance.now() - t < ms) { const v = await cond(); if (v) return v; await sleep(25); } throw new Error(`timed out waiting for ${what}`); };
  const idle = () => waitFor(() => !ir.items.some((i) => ['checking', 'queued', 'resizing'].includes(i.status)), 40000, 'work to finish');
  const addViaInput = async (files) => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); const input = q('[data-ir-input]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(20); await idle(); };
  const byName = (n) => ir.items.find((i) => i.name === n);
  const click = async (el) => { el.click(); await sleep(30); };
  const type = async (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(30); };
  const mode = (v) => click(q(`input[name="ir-mode"][value="${v}"]`));
  const fmt = (v) => click(q(`input[name="ir-format"][value="${v}"]`));
  const plan = (n) => byName(n).ui.plan.textContent;
  const resizeAll = async () => { await click(q('[data-ir-run-all]')); await waitFor(() => !ir.items.some((i) => ['queued', 'resizing'].includes(i.status)), 60000, 'batch'); };
  const clearAll = async () => { await click(q('[data-ir-clear-all]')); await click(q('[data-ir-confirm-yes]')); };
  const resizeOne = async (name, check) => { await click(byName(name).ui.run); await waitFor(() => byName(name).status !== 'resizing' && byName(name).status !== 'queued' && check(byName(name)), 30000, `${name} resize`); };

  // Instrumentation
  const downloads = []; const created = []; const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = origCreate(b); created.push({ u, blob: b }); return u; };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: created.find((c) => c.u === this.href)?.blob }); };
  let bitmapsMade = 0, bitmapsClosed = 0; const ocib = window.createImageBitmap, ocl = ImageBitmap.prototype.close;
  window.createImageBitmap = async (...a) => { const b = await ocib(...a); bitmapsMade++; return b; }; ImageBitmap.prototype.close = function () { bitmapsClosed++; return ocl.call(this); };
  const net = { fetch: 0, xhr: 0, beacon: 0 }; const of = window.fetch, ox = XMLHttpRequest.prototype.open, ob = navigator.sendBeacon?.bind(navigator);
  window.fetch = (...a) => { net.fetch++; return of(...a); }; XMLHttpRequest.prototype.open = function (...a) { net.xhr++; return ox.apply(this, a); }; if (ob) navigator.sendBeacon = (...a) => { net.beacon++; return ob(...a); };
  const storageBefore = JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]); const resBefore = performance.getEntriesByType('resource').length;
  const restore = () => { URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick; window.createImageBitmap = ocib; ImageBitmap.prototype.close = ocl; window.fetch = of; XMLHttpRequest.prototype.open = ox; if (ob) navigator.sendBeacon = ob; };
  const dl = async (name) => { downloads.length = 0; await click(byName(name).ui.download); await sleep(40); assert(downloads.length === 1, `${downloads.length} downloads`); return downloads[0]; };

  try {
    /* ---- fixtures ---- */
    const holiday = await makeFile(drawPicture(1600, 1200), 'image/jpeg', 0.92, 'holiday.jpg');
    const logo = await makeFile(drawPicture(800, 600, { alpha: true }), 'image/png', undefined, 'logo.png');
    const banner = await makeFile(drawPicture(1000, 500), 'image/webp', 0.9, 'banner.webp');
    const hugeHdr = new Uint8Array(await (await makeFile(drawPicture(40, 30), 'image/png', undefined, 'h.png')).arrayBuffer()); new DataView(hugeHdr.buffer).setUint32(16, 20000); new DataView(hugeHdr.buffer).setUint32(20, 20000);
    const bad = {
      gif: fileOf(ascii8('GIF89a\x01\x00\x01\x00\x80\x00\x00'), 'anim.gif', 'image/gif'), fakePng: fileOf(ascii8('this is only text pretending to be a picture'), 'fake.png', 'image/png'), empty: fileOf(new Uint8Array(0), 'empty.jpg', 'image/jpeg'),
      broken: fileOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 9, 9, 9, 9, 9, 9, 9, 9]), 'broken.jpg', 'image/jpeg'),
      huge: fileOf(hugeHdr, 'huge.png', 'image/png'), svg: fileOf(ascii8('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'), 'drawing.svg', 'image/svg+xml'),
    };

    /* ---- upload ---- */
    await R.test('upload: JPG, PNG and WebP are accepted with preview, name, original size and original dimensions', async () => {
      await addViaInput([holiday, logo, banner]);
      for (const [n, type, w, h] of [['holiday.jpg', 'image/jpeg', 1600, 1200], ['logo.png', 'image/png', 800, 600], ['banner.webp', 'image/webp', 1000, 500]]) {
        const it = byName(n); assert(it && it.status === 'ready' && it.type === type && it.width === w && it.height === h, `${n}: ${it?.status} ${it?.type} ${it?.width}x${it?.height}`);
        const li = it.ui.li; assert(li.querySelector('canvas'), 'no preview'); assert(it.ui.name.textContent === n, 'no name'); const meta = it.ui.meta.textContent; assert(meta.includes(`${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px`) && /\d+(\.\d+)? (B|KB|MB)/.test(meta), meta);
      }
      assert(byName('logo.png').hasAlpha && !byName('holiday.jpg').hasAlpha, 'alpha flags'); return '3 ready';
    });
    await R.test('upload: invalid files are never skipped silently; each is listed with a reason and offers no Resize', async () => {
      await addViaInput(Object.values(bad)); const out = [];
      for (const n of ['anim.gif', 'fake.png', 'empty.jpg', 'broken.jpg', 'huge.png', 'drawing.svg']) { const it = byName(n); assert(it?.status === 'rejected', `${n}: ${it?.status}`); assert(it.error.length > 10 && it.ui.info.textContent.includes(it.error), `${n}: no reason shown`); assert(it.ui.run.hidden, `${n} offers Resize`); out.push(`${n}: ${it.error}`); }
      assert(/megapixel/.test(byName('huge.png').error), byName('huge.png').error); return out.join(' | ');
    });
    await R.test('upload: duplicates are reported, not silently ignored', async () => { const n = ir.items.length; await addViaInput([holiday, logo]); assert(ir.items.length === n, 'added duplicates'); const t = q('[data-ir-notes]').textContent; assert(/2 files were already in the list and skipped/.test(t), t); return t; });
    await R.test('upload: drag and drop adds files; a drop outside the zone does not navigate away', async () => {
      const zone = q('[data-ir-drop]'); const extra = await makeFile(drawPicture(120, 90), 'image/png', undefined, 'dropped.png'); const dt = new DataTransfer(); dt.items.add(extra);
      zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); assert(zone.dataset.dragging === 'true', 'no highlight'); zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); await sleep(20); await idle(); assert(byName('dropped.png')?.status === 'ready', 'not added'); assert(!zone.dataset.dragging, 'highlight stuck');
      const dt2 = new DataTransfer(); dt2.items.add(holiday); const ev = new DragEvent('drop', { dataTransfer: dt2, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); assert(ev.defaultPrevented, 'page would navigate'); await click(byName('dropped.png').ui.remove); return 'ok';
    });
    await R.test('the aspect-ratio lock is ON by default, with a clear explanation', async () => { assert(q('[data-ir-lock]').checked, 'lock is off'); assert(/Proportions are kept/.test(q('[data-ir-lock-note]').textContent), q('[data-ir-lock-note]').textContent); return q('[data-ir-lock-note]').textContent.slice(0, 70); });

    /* ---- custom size, locked ---- */
    await R.test('locked: typing a width 800 shows height 600 and every image gets its OWN proportions', async () => {
      await type(q('[data-ir-width]'), '800'); assert(q('[data-ir-height]').value === '600', `height field "${q('[data-ir-height]').value}"`);
      assert(/Will be 800 × 600 px/.test(plan('holiday.jpg')), plan('holiday.jpg')); assert(/Will be 800 × 600 px.*same size as the original/.test(plan('logo.png')), plan('logo.png')); assert(/Will be 800 × 400 px/.test(plan('banner.webp')), plan('banner.webp')); return '1600x1200->800x600, 800x600 unchanged, 1000x500->800x400';
    });
    await R.test('locked: typing a height updates the width the same way', async () => { await type(q('[data-ir-height]'), '300'); assert(q('[data-ir-width]').value === '400', `width field "${q('[data-ir-width]').value}"`); assert(/Will be 400 × 300 px/.test(plan('holiday.jpg')), plan('holiday.jpg')); assert(/Will be 600 × 300 px/.test(plan('banner.webp')), plan('banner.webp')); return 'ok'; });
    await R.test('locked: no drift from rounding (333 -> 250 -> back to 333, and focusing a field changes nothing)', async () => {
      await type(q('[data-ir-width]'), '333'); assert(q('[data-ir-height]').value === '250', q('[data-ir-height]').value); q('[data-ir-height]').focus(); q('[data-ir-height]').blur(); await sleep(30); assert(q('[data-ir-width]').value === '333' && /Will be 333 × 250 px/.test(plan('holiday.jpg')), plan('holiday.jpg'));
      await type(q('[data-ir-height]'), '250'); assert(q('[data-ir-width]').value === '333', `width drifted to ${q('[data-ir-width]').value}`); return '333 <-> 250 stable';
    });
    await R.test('invalid dimensions: zero, negative, decimal, text and too-large show a message and block resizing', async () => {
      const w = q('[data-ir-width]'); for (const [v, re] of [['0', /at least 1 pixel/], ['-5', /whole pixels/], ['12.5', /whole pixels/], ['abc', /whole pixels/], ['99999', /16,384 pixels or less/]]) { await type(w, v); assert(re.test(q('[data-ir-width-msg]').textContent) && w.getAttribute('aria-invalid') === 'true', `${v}: "${q('[data-ir-width-msg]').textContent}"`); assert(q('[data-ir-run-all]').disabled, `${v}: Resize enabled`); assert(/Enter a width\./.test(plan('holiday.jpg')), plan('holiday.jpg')); }
      await type(w, '800'); assert(!q('[data-ir-width-msg]').textContent && !q('[data-ir-run-all]').disabled && w.getAttribute('aria-invalid') === 'false', 'did not recover'); return 'ok';
    });
    await R.test('RESIZE: 1600 x 1200 -> 800 x 600 with the ratio locked: the downloaded file is a real JPEG, exactly 800 x 600', async () => {
      await resizeAll(); const it = byName('holiday.jpg'); assert(it.status === 'done', `${it.status} ${it.error}`); const d = await dl('holiday.jpg'); assert(d.name === 'holiday-800x600.jpg', d.name); assert(isJpeg(await bytesOf(d.blob)), 'not JPEG');
      const p = await pixels(d.blob); assert(p.width === 800 && p.height === 600, `${p.width}x${p.height}`); return `${d.name} ${formatBytes(d.blob.size)}`;
    });
    await R.test('RESIZE: the rest of the batch has the right exported dimensions (800x600 PNG, 800x400 WebP)', async () => {
      for (const [n, ext, w, h, chk] of [['logo.png', 'png', 800, 600, isPng], ['banner.webp', 'webp', 800, 400, isWebp]]) { assert(byName(n).status === 'done', `${n}: ${byName(n).status}`); const d = await dl(n); assert(d.name === `${n.split('.')[0]}-${w}x${h}.${ext}`, d.name); assert(chk(await bytesOf(d.blob)), `${n} wrong signature`); const p = await pixels(d.blob); assert(p.width === w && p.height === h, `${n}: ${p.width}x${p.height}`); } return 'ok';
    });
    await R.test('results show original and new dimensions, both sizes, the change, format and a preview', async () => {
      for (const it of ir.items.filter((i) => i.result)) { const li = it.ui.li; const t = it.ui.result.textContent; assert(!it.ui.result.hidden, 'hidden'); assert(/Original/.test(t) && /Resized/.test(t) && /Change/.test(t) && /Format/.test(t) && /→/.test(t), t); assert(/(Saved|Larger by|No change)/.test(t), t); assert(it.ui.preview.querySelector('canvas'), `${it.name}: no preview`); assert(!it.ui.compare.hidden && !it.ui.download.hidden, 'actions missing'); }
      const t = byName('holiday.jpg').ui.rDims.textContent; assert(t === '1,600 × 1,200 px → 800 × 600 px', t); return t;
    });
    await R.test('reported sizes equal the real blob sizes; the summary totals the batch; originals are untouched', async () => {
      const it = byName('holiday.jpg'); assert(it.ui.rNew.textContent === formatBytes(it.result.blob.size), 'size label'); assert(/resized .* → .*(smaller|larger|No change)/.test(q('[data-ir-summary]').textContent), q('[data-ir-summary]').textContent);
      const a = new Uint8Array(await it.file.arrayBuffer()), b = new Uint8Array(await holiday.arrayBuffer()); assert(a.length === b.length && a.every((v, i) => v === b[i]), 'original changed'); return q('[data-ir-summary]').textContent;
    });

    /* ---- unlocked ---- */
    await R.test('unlocked: warns that it can distort, applies the exact width and height, and exports exactly that', async () => {
      await click(q('[data-ir-lock]')); assert(!q('[data-ir-lock]').checked, 'still locked'); assert(/stretch or squash/.test(q('[data-ir-lock-note]').textContent), q('[data-ir-lock-note]').textContent);
      await type(q('[data-ir-width]'), '500'); await type(q('[data-ir-height]'), '500'); assert(/Will be 500 × 500 px.*proportions change/.test(plan('holiday.jpg')), plan('holiday.jpg'));
      await resizeOne('holiday.jpg', (i) => i.result?.width === 500); const d = await dl('holiday.jpg'); const p = await pixels(d.blob); assert(p.width === 500 && p.height === 500, `${p.width}x${p.height}`); return 'exported 500x500';
    });
    await R.test('unlocked: both sides are required', async () => { await type(q('[data-ir-height]'), ''); assert(/Enter both a width and a height/.test(plan('holiday.jpg')), plan('holiday.jpg')); assert(q('[data-ir-run-all]').disabled, 'Resize enabled'); return 'ok'; });
    await R.test('re-locking recomputes the other side from the image proportions', async () => { await click(q('[data-ir-lock]')); assert(q('[data-ir-lock]').checked, 'not locked'); assert(q('[data-ir-width]').value === '500' && q('[data-ir-height]').value === '375', `${q('[data-ir-width]').value}x${q('[data-ir-height]').value}`); return '500 -> 375'; });

    /* ---- mode switching keeps images and results ---- */
    await R.test('switching between custom, percentage and common sizes never loses the images or results', async () => {
      const n = ir.items.length, done = ir.items.filter((i) => i.result).length; for (const m of ['percent', 'preset', 'custom', 'preset', 'percent']) { await mode(m); assert(ir.items.length === n && ir.items.filter((i) => i.result).length === done && qa('.item').length === n, `lost images in ${m}`); } return `${n} images, ${done} results kept`;
    });

    /* ---- percentage ---- */
    await R.test('percentage: presets 25/50/75/100/150/200 show the resulting dimensions before processing', async () => {
      await mode('percent'); assert(qa('input[name="ir-percent"]').map((r) => r.value).join() === '25,50,75,100,150,200', 'presets');
      const want = { 25: '400 × 300', 50: '800 × 600', 75: '1,200 × 900', 100: '1,600 × 1,200', 150: '2,400 × 1,800', 200: '3,200 × 2,400' };
      for (const [p, dims] of Object.entries(want)) { await click(q(`input[name="ir-percent"][value="${p}"]`)); assert(plan('holiday.jpg').includes(`Will be ${dims} px`), `${p}%: ${plan('holiday.jpg')}`); } return 'ok';
    });
    await R.test('percentage: custom value, invalid values and enlarging warnings', async () => {
      const c = q('[data-ir-percent-custom]'); await type(c, '62.5'); assert(plan('holiday.jpg').includes('Will be 1,000 × 750 px'), plan('holiday.jpg')); assert(!qa('input[name="ir-percent"]').some((r) => r.checked), 'a preset is still checked');
      for (const [v, re] of [['0', /at least 1%/], ['abc', /Use a number/], ['1001', /1000% or less/], ['12.345', /Use a number/]]) { await type(c, v); assert(re.test(q('[data-ir-percent-msg]').textContent), `${v}: ${q('[data-ir-percent-msg]').textContent}`); assert(/Enter a percentage/.test(plan('holiday.jpg')), plan('holiday.jpg')); }
      await type(c, '200'); assert(/enlarged/.test(plan('holiday.jpg')), plan('holiday.jpg')); await click(q('input[name="ir-percent"][value="100"]')); assert(/same size as the original/.test(plan('holiday.jpg')), plan('holiday.jpg')); return 'ok';
    });
    await R.test('percentage: 25% really exports 400 x 300', async () => {
      await click(q('input[name="ir-percent"][value="25"]')); await resizeOne('holiday.jpg', (i) => i.result?.width === 400); const d = await dl('holiday.jpg'); const p = await pixels(d.blob); assert(p.width === 400 && p.height === 300, `${p.width}x${p.height}`); return d.name;
    });

    /* ---- presets ---- */
    await R.test('common sizes: 1600 x 1200 fits within 1920 x 1080 as 1440 x 1080; smaller images are not enlarged by default', async () => {
      await mode('preset'); assert(/not a guarantee/i.test(q('[data-ir-panel-preset]').textContent), 'no disclaimer'); assert(q('[data-ir-keep-small]').checked, 'default should be not enlarging');
      assert(plan('holiday.jpg').includes('Will be 1,440 × 1,080 px'), plan('holiday.jpg')); assert(/Will be 800 × 600 px.*same size/.test(plan('logo.png')), plan('logo.png')); assert(/Will be 1,000 × 500 px.*same size/.test(plan('banner.webp')), plan('banner.webp')); return 'ok';
    });
    await R.test('common sizes: with "don\'t enlarge" off, small images are scaled up to fit the box (still no crop or stretch)', async () => {
      await click(q('[data-ir-keep-small]')); assert(plan('logo.png').includes('Will be 1,440 × 1,080 px'), plan('logo.png')); assert(plan('banner.webp').includes('Will be 1,920 × 960 px'), plan('banner.webp')); assert(/enlarged/.test(plan('logo.png')), plan('logo.png')); await click(q('[data-ir-keep-small]')); return 'ok';
    });
    await R.test('common sizes: all five presets are offered and produce boxes the image fits inside', async () => {
      const ids = qa('input[name="ir-size"]').map((r) => r.value); assert(ids.join() === '1920x1080,1280x720,1080x1080,1080x1350,1080x1920', ids.join());
      const want = { '1280x720': '960 × 720', '1080x1080': '1,080 × 810', '1080x1350': '1,080 × 810', '1080x1920': '1,080 × 810' }; for (const [id, dims] of Object.entries(want)) { await click(q(`input[name="ir-size"][value="${id}"]`)); assert(plan('holiday.jpg').includes(`Will be ${dims} px`), `${id}: ${plan('holiday.jpg')}`); } await click(q('input[name="ir-size"][value="1920x1080"]')); return 'ok';
    });
    await R.test('common sizes: the exported file is exactly 1440 x 1080 (decoded), 4:3, content not cropped', async () => {
      await fmt('image/png'); await resizeOne('holiday.jpg', (i) => i.result?.width === 1440); const d = await dl('holiday.jpg'); assert(d.name === 'holiday-1440x1080.png', d.name); assert(isPng(await bytesOf(d.blob)), 'not PNG');
      const p = await pixels(d.blob); assert(p.width === 1440 && p.height === 1080 && Math.abs(p.width / p.height - 4 / 3) < 0.001, `${p.width}x${p.height}`); return d.name;
    });

    /* ---- output formats and transparency ---- */
    await R.test('PNG output keeps transparency of a resized transparent PNG', async () => {
      await mode('percent'); await click(q('input[name="ir-percent"][value="50"]')); await fmt('image/png'); await resizeOne('logo.png', (i) => i.result?.width === 400 && i.result.actualType === 'image/png');
      const d = await dl('logo.png'); const p = await pixels(d.blob); assert(isPng(await bytesOf(d.blob)) && p.width === 400 && p.height === 300, `${p.width}x${p.height}`); assert(px(p, 3, 3)[3] === 0 && px(p, 200, 150)[3] === 255, `corner/centre alpha ${px(p, 3, 3)[3]}/${px(p, 200, 150)[3]}`); let semi = 0; for (let i = 3; i < p.data.length; i += 4) if (p.data[i] > 10 && p.data[i] < 245) semi++; assert(semi > 20, `${semi}`); return `${semi} semi-transparent px kept`;
    });
    await R.test('WebP output is a genuine WebP file and keeps transparency', async () => {
      await fmt('image/webp'); await resizeOne('logo.png', (i) => i.result?.actualType === 'image/webp'); const d = await dl('logo.png'); assert(d.name === 'logo-400x300.webp' && isWebp(await bytesOf(d.blob)), d.name); const p = await pixels(d.blob); assert(px(p, 3, 3)[3] <= 3 && px(p, 200, 150)[3] >= 252, `${px(p, 3, 3)[3]}/${px(p, 200, 150)[3]}`); return d.name;
    });
    await R.test('JPEG output of a transparent image: a background selector appears (default white) with an explanation', async () => {
      await fmt('image/jpeg'); assert(!q('[data-ir-bg-field]').hidden, 'no selector'); assert(q('[data-ir-bg]').value === '#ffffff', q('[data-ir-bg]').value); assert(/filled with the background colour/.test(q('[data-ir-format-note]').textContent), q('[data-ir-format-note]').textContent); assert(/transparent areas are filled with this colour/.test(q('[data-ir-bg-field]').textContent), 'no explanation'); return 'ok';
    });
    await R.test('JPEG output: default white fills the transparent areas; the file is a real, fully opaque JPEG', async () => {
      await resizeOne('logo.png', (i) => i.result?.actualType === 'image/jpeg'); const d = await dl('logo.png'); assert(d.name === 'logo-400x300.jpg' && isJpeg(await bytesOf(d.blob)), d.name); const p = await pixels(d.blob); assert(near(px(p, 3, 3).slice(0, 3), [255, 255, 255], 6), `${px(p, 3, 3)}`); for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 255) throw new Error('non-opaque pixel'); return 'white corner, fully opaque';
    });
    await R.test('JPEG output: a chosen background colour (red) fills the transparent areas of the exported file', async () => {
      const bg = q('[data-ir-bg]'); bg.value = '#ff0000'; bg.dispatchEvent(new Event('input', { bubbles: true })); await sleep(30); assert(/Settings changed/.test(byName('logo.png').ui.state.textContent), 'result not marked stale');
      await resizeOne('logo.png', (i) => i.result && i.ui.state.textContent.includes('Done')); const d = await dl('logo.png'); const p = await pixels(d.blob); const c = px(p, 3, 3); assert(near(c.slice(0, 3), [255, 0, 0], 14) && c[3] === 255, `corner ${c}`); assert(!near(px(p, 200, 150).slice(0, 3), [255, 0, 0], 40), 'centre replaced'); return `corner = ${c}`;
    });
    await R.test('"Same as original": each image keeps its own format (JPEG stays JPEG, PNG stays PNG, WebP stays WebP)', async () => {
      await fmt('original'); await resizeAll(); for (const [n, chk] of [['holiday.jpg', isJpeg], ['logo.png', isPng], ['banner.webp', isWebp]]) { const d = await dl(n); assert(chk(await bytesOf(d.blob)), `${n}: ${d.name}`); } return 'ok';
    });
    await R.test('never mislabels: every result\'s label and file signature agree', async () => {
      for (const it of ir.items.filter((i) => i.result)) { const r = it.result; const h = await bytesOf(r.blob); const real = isPng(h) ? 'image/png' : isJpeg(h) ? 'image/jpeg' : isWebp(h) ? 'image/webp' : '?'; assert(real === r.actualType, `${it.name}: bytes are ${real}, label says ${r.actualType}`); } return 'all agree';
    });

    /* ---- larger results are reported honestly ---- */
    await R.test('a result that is NOT smaller is reported plainly (resizing never promises smaller files)', async () => {
      const tiny = await makeFile(drawPicture(300, 200), 'image/jpeg', 0.2, 'tiny.jpg'); await addViaInput([tiny]); await mode('percent'); await click(q('input[name="ir-percent"][value="200"]')); await fmt('image/png'); await resizeOne('tiny.jpg', (i) => i.result);
      const it = byName('tiny.jpg'); assert(/Larger by/.test(it.ui.rChange.textContent), it.ui.rChange.textContent); assert(!it.ui.warn.hidden && /not smaller than the original/.test(it.ui.warn.textContent), 'no warning'); return it.ui.rChange.textContent;
    });

    /* ---- limits and per-file failures ---- */
    await R.test('a file that cannot be resized with the current settings is flagged ON ITS OWN; the others still succeed', async () => {
      await clearAll(); const wide = await makeFile(drawPicture(3000, 400), 'image/png', undefined, 'wide.png'); const small = await makeFile(drawPicture(100, 100), 'image/png', undefined, 'small.png'); await addViaInput([wide, small]); await fmt('original');
      await mode('percent'); await type(q('[data-ir-percent-custom]'), '700'); assert(/16,384/.test(plan('wide.png')) && /Will be 700 × 700 px/.test(plan('small.png')), `${plan('wide.png')} | ${plan('small.png')}`); assert(byName('wide.png').ui.run.disabled, 'Resize should be disabled for the impossible image');
      await resizeAll(); assert(byName('small.png').status === 'done' && byName('small.png').result.width === 700, `small: ${byName('small.png').status}`); assert(!byName('wide.png').result, 'wide should not have a result'); return plan('wide.png').slice(0, 100);
    });
    await R.test('limits are shown in the interface (file size, megapixels, maximum side)', async () => { const t = root.textContent; assert(/100 MB/.test(t) && /100 megapixels/.test(t) && /16,384/.test(t), 'limits not shown'); return 'shown'; });

    /* ---- ZIP ---- */
    await R.test('Download all: a valid ZIP with unique names, real image files at the right sizes', async () => {
      await click(q('input[name="ir-percent"][value="50"]')); const dup1 = await makeFile(drawPicture(200, 100), 'image/jpeg', 0.9, 'same.jpg'); const dup2 = await makeFile(drawPicture(200, 100), 'image/jpeg', 0.8, 'same.jpg'); await addViaInput([dup1, dup2]); await resizeAll();
      downloads.length = 0; await click(q('[data-ir-download-all]')); await waitFor(() => downloads.length === 1, 10000, 'zip'); const d = downloads[0]; assert(d.name === 'toolora-resized-images.zip' && d.blob.type === 'application/zip', `${d.name} ${d.blob?.type}`);
      const entries = await readZip(d.blob); const done = ir.items.filter((i) => i.result); assert(entries.length === done.length && entries.length === 4, `${entries.length} vs ${done.length}`); assert(new Set(entries.map((e) => e.name.toLowerCase())).size === entries.length, 'duplicate names'); assert(entries.every((e) => e.crcOk), 'bad CRC');
      assert(entries.some((e) => e.name === 'same-100x50.jpg') && entries.some((e) => e.name === 'same-100x50-2.jpg'), `names: ${entries.map((e) => e.name).join(', ')}`);
      for (const e of entries) { const h = e.bytes.slice(0, 16); const m = /-(\d+)x(\d+)(?:-\d+)?\.(jpg|png|webp)$/.exec(e.name); assert(m, e.name); assert((m[3] === 'jpg' && isJpeg(h)) || (m[3] === 'png' && isPng(h)) || (m[3] === 'webp' && isWebp(h)), `${e.name} signature`); const p = await pixels(new Blob([e.bytes])); assert(p.width === Number(m[1]) && p.height === Number(m[2]), `${e.name}: decoded ${p.width}x${p.height}`); }
      return `${entries.length} files: ${entries.map((e) => e.name).join(', ')}`;
    });

    /* ---- compare ---- */
    await R.test('compare: before/after view with two object URLs; revoked when closed; only one open at a time', async () => {
      const [a, b] = ir.items.filter((i) => i.result); const base = ir.openUrls.size; await click(a.ui.compare); assert(!a.ui.cmp.hidden && ir.openUrls.size === base + 2, `${ir.openUrls.size - base}`); await waitFor(() => [...a.ui.cmp.querySelectorAll('img')].every((i) => i.complete && i.naturalWidth > 0), 5000, 'images');
      const range = a.ui.cmp.querySelector('input[type=range]'); assert(range.getAttribute('aria-label'), 'unlabelled'); range.value = '25'; range.dispatchEvent(new Event('input')); assert(a.ui.cmp.firstChild.style.getPropertyValue('--pos') === '25%', 'slider');
      await click(b.ui.compare); assert(a.ui.cmp.hidden && !b.ui.cmp.hidden && ir.openUrls.size === base + 2, 'second did not replace first'); await click(b.ui.compare); assert(ir.openUrls.size === base, `${ir.openUrls.size - base} leaked`); return 'balanced';
    });

    /* ---- Stop ---- */
    await R.test('Stop: processes one at a time, stops after the current image, and reports it', async () => {
      await clearAll(); const many = []; for (let i = 0; i < 6; i++) many.push(await makeFile(drawPicture(2000, 1400), 'image/png', undefined, `big-${i}.png`)); await addViaInput(many);
      await mode('percent'); await click(q('input[name="ir-percent"][value="50"]')); let maxAtOnce = 0; const mo = new MutationObserver(() => { maxAtOnce = Math.max(maxAtOnce, ir.items.filter((i) => i.status === 'resizing').length); }); mo.observe(q('[data-ir-list]'), { subtree: true, attributes: true, childList: true, characterData: true });
      await click(q('[data-ir-run-all]')); await waitFor(() => ir.items.some((i) => i.status === 'done'), 30000, 'first result'); assert(!q('[data-ir-cancel]').hidden, 'no Stop button'); await click(q('[data-ir-cancel]')); await waitFor(() => !ir.items.some((i) => ['resizing', 'queued'].includes(i.status)), 30000, 'stop'); mo.disconnect();
      const done = ir.items.filter((i) => i.status === 'done').length, ready = ir.items.filter((i) => i.status === 'ready').length; assert(done >= 1 && ready >= 1 && done + ready === 6, `${done} done, ${ready} ready`); assert(maxAtOnce <= 1, `${maxAtOnce} at once`); await waitFor(() => /Stopped/.test(q('[data-ir-progress-text]').textContent), 3000, 'stopped text'); return `${done} done, ${ready} not started: ${q('[data-ir-progress-text]').textContent}`;
    });

    /* ---- accessibility basics ---- */
    await R.test('accessibility: inputs have labels, errors are linked and announced, progress bar is a labelled progressbar', async () => {
      for (const id of ['ir-width', 'ir-height', 'ir-percent-custom', 'ir-bg']) assert(document.querySelector(`label[for="${id}"]`)?.textContent.trim(), `${id} has no label`);
      assert(q('[data-ir-width]').getAttribute('aria-describedby').includes('ir-width-msg'), 'width not linked to its message'); assert(q('[data-ir-bar]').getAttribute('role') === 'progressbar' && q('[data-ir-bar]').getAttribute('aria-label'), 'progress bar'); assert(q('[data-ir-toast]').getAttribute('aria-live') === 'polite', 'toast');
      for (const it of ir.items) { assert(it.ui.remove.getAttribute('aria-label')?.includes(it.name), `remove label for ${it.name}`); } return 'ok';
    });
    await R.test('keyboard: removing an image moves focus to the next Remove button (never lost)', async () => { const first = ir.items[0], next = ir.items[1]; first.ui.remove.focus(); await click(first.ui.remove); assert(document.activeElement === next.ui.remove, document.activeElement.outerHTML.slice(0, 80)); return 'ok'; });

    /* ---- responsiveness, cleanup, privacy ---- */
    await R.test('responsive: the main thread is never blocked for long while resizing large images', async () => {
      await clearAll(); const big = []; for (let i = 0; i < 3; i++) big.push(await makeFile(drawPicture(2800, 1900), 'image/png', undefined, `large-${i}.png`)); await addViaInput(big);
      let worst = 0, last = performance.now(), run = true; const loop = () => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; if (run) { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); loop(); }; ch.port2.postMessage(0); } }; loop();
      const t0 = performance.now(); await click(q('[data-ir-run-all]')); await waitFor(() => ir.items.every((i) => i.status === 'done'), 60000, 'large batch'); const total = performance.now() - t0; run = false; assert(worst < 500, `main thread blocked ${Math.round(worst)} ms`); return `3 x 5.3 MP images in ${Math.round(total)} ms; longest block ${Math.round(worst)} ms`;
    });
    await R.test('cleanup: after Clear all there are no open object URLs and every decoded bitmap was closed', async () => {
      await clearAll(); assert(ir.items.length === 0 && qa('.item').length === 0, 'items remain'); assert(ir.openUrls.size === 0, `${ir.openUrls.size} URLs open`); assert(bitmapsMade > 0 && bitmapsMade === bitmapsClosed, `${bitmapsMade} created / ${bitmapsClosed} closed`); assert(!q('[data-ir-empty]').hidden && q('[data-ir-download-all]').hidden, 'toolbar not reset'); return `${bitmapsMade} bitmaps created, ${bitmapsClosed} closed`;
    });
    await R.test('privacy: no network requests, nothing stored, no unexpected resource loads', async () => {
      assert(net.fetch === 0 && net.xhr === 0 && net.beacon === 0, JSON.stringify(net)); assert(JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]) === storageBefore, 'storage changed');
      const entries = performance.getEntriesByType('resource').slice(resBefore).filter((e) => !e.name.startsWith('blob:') && !/\/(src|tests|node_modules|@vite|@fs|@id)\//.test(e.name)); assert(entries.length === 0, entries.map((e) => e.name).join(', ')); return 'fetch/XHR/beacon: 0; storage unchanged';
    });
  } finally {
    restore();
  }
  return R.finish();
}

export { fitWithin, readZip, drawChecker, drawFramed };
