/**
 * Image Compressor: REAL-BROWSER tests. They create real image files, run them through the real encoder and the
 * real UI, then decode the exported files and inspect their bytes and pixels.
 *
 * Run (dev server on http://localhost:4321):
 *   open /tools/image-compressor in a browser and run, in its console or via the Browser pane:
 *     const m = await import('/tests/imageCompressor.browser.mjs');  await m.runCodecTests();  await m.runUiTests();
 * Each function returns { passed, failed, results[] } and also logs a table.
 */
import { compressFile, decodeImage, encodeImage, hasTransparency, makeThumbnail, probeEncoders } from '../src/lib/imageCodec.js';
import { PRESETS, formatBytes } from '../src/lib/imageCompressor.js';
import { FIXTURES } from './fixtures/images.mjs';
import { readZip } from '../src/lib/zip.js';

/* ------------------------------------------------------------------ tiny runner */
function makeRunner(title) {
  const results = [];
  const test = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) });
    } catch (e) {
      results.push({ name, ok: false, detail: String(e && e.message ? e.message : e) });
    }
  };
  const finish = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`${title}: ${results.length - failed.length}/${results.length} passed`);
    return { title, passed: results.length - failed.length, failed: failed.length, results };
  };
  return { test, finish, results };
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
// Waits without relying on setTimeout, which browsers throttle to ~1/second in background tabs.
const tick = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
const sleep = async (ms) => { const end = performance.now() + ms; do { await tick(); } while (performance.now() < end); };

/* ------------------------------------------------------------------ image helpers */
let seed = 20240607;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

/** Deterministic "photo-like" picture: smooth colour gradients plus fine noise. Optionally with transparency. */
function drawPicture(w, h, { alpha = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#2a6'); g.addColorStop(0.5, '#e83'); g.addColorStop(1, '#36c');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const img = x.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 36; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  x.putImageData(img, 0, 0);
  if (alpha) {
    // Everything outside a disc is transparent; a soft ring is semi-transparent; plus one lone transparent pixel.
    const a = x.getImageData(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.35;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const d = Math.hypot(px - cx, py - cy); const i = (py * w + px) * 4 + 3;
      a.data[i] = d <= r ? 255 : d <= r + 8 ? 128 : 0;
    }
    x.putImageData(a, 0, 0);
  }
  return c;
}
const makeFile = async (canvas, type, q, name) => new File([await toBlob(canvas, type, q)], name, { type, lastModified: 1700000000000 + Math.floor(rnd() * 1e6) });
const bytesOf = async (blob, n = 16) => new Uint8Array(await blob.slice(0, n).arrayBuffer());
const ascii = (b, s, l) => String.fromCharCode(...b.slice(s, s + l));
const pixels = async (blob) => {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  const data = x.getImageData(0, 0, bmp.width, bmp.height).data; const out = { width: bmp.width, height: bmp.height, data };
  bmp.close(); return out;
};
const px = (p, x, y) => { const i = (y * p.width + x) * 4; return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]]; };
const isPng = (b) => b[0] === 0x89 && ascii(b, 1, 3) === 'PNG';
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebp = (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP';
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/* ================================================================= codec tests */
export async function runCodecTests() {
  const R = makeRunner('Codec (real encoder, real pixels)');
  const W = 200, H = 140;
  const photoCanvas = drawPicture(W, H);
  const alphaCanvas = drawPicture(W, H, { alpha: true });
  const photoPng = await makeFile(photoCanvas, 'image/png', undefined, 'photo.png');
  const photoJpeg = await makeFile(photoCanvas, 'image/jpeg', 0.95, 'photo.jpg');
  const alphaPng = await makeFile(alphaCanvas, 'image/png', undefined, 'logo.png');
  const alphaWebp = await makeFile(alphaCanvas, 'image/webp', 1, 'logo.webp');
  const enc = (file, opts) => compressFile(file, opts);

  await R.test('encoders: JPEG, PNG and WebP export are all supported by this browser', async () => {
    const s = await probeEncoders(); assert(s['image/jpeg'] && s['image/png'] && s['image/webp'], JSON.stringify(s)); return JSON.stringify(s);
  });

  /* ---- Output file types: check the actual bytes ---- */
  for (const [type, check, label] of [['image/jpeg', isJpeg, 'JPEG'], ['image/png', isPng, 'PNG'], ['image/webp', isWebp, 'WebP']]) {
    await R.test(`${label} output: reported type matches the real file signature`, async () => {
      const out = await enc(photoPng, { type, quality: 80 });
      assert(out.actualType === type, `asked for ${type}, browser produced ${out.actualType}`);
      assert(out.blob.type === type, `blob.type ${out.blob.type}`);
      assert(check(await bytesOf(out.blob)), 'file signature does not match');
      return `${formatBytes(out.blob.size)}`;
    });
    await R.test(`${label} output: decodes as a valid image with the same dimensions`, async () => {
      const out = await enc(photoPng, { type, quality: 80 }); const p = await pixels(out.blob);
      assert(p.width === W && p.height === H, `${p.width}x${p.height}`); return `${p.width}x${p.height}`;
    });
  }

  /* ---- Transparency ---- */
  await R.test('PNG: alpha channel is preserved EXACTLY at lossless setting', async () => {
    const src = await pixels(alphaPng); const out = await enc(alphaPng, { type: 'image/png', quality: 100 }); const p = await pixels(out.blob);
    let diff = 0; for (let i = 3; i < src.data.length; i += 4) if (src.data[i] !== p.data[i]) diff++;
    assert(diff === 0, `${diff} pixels changed alpha`); assert(px(p, 2, 2)[3] === 0 && px(p, W / 2, H / 2)[3] === 255, 'corner/centre alpha wrong');
    return 'identical alpha for all ' + W * H + ' pixels';
  });
  await R.test('PNG: alpha is preserved exactly even with colour reduction (Smaller File)', async () => {
    const src = await pixels(alphaPng); const out = await enc(alphaPng, { type: 'image/png', quality: PRESETS.small.quality }); const p = await pixels(out.blob);
    let diff = 0, semi = 0; for (let i = 3; i < src.data.length; i += 4) { if (src.data[i] !== p.data[i]) diff++; if (src.data[i] > 0 && src.data[i] < 255) semi++; }
    assert(semi > 100, 'test picture has no semi-transparent pixels'); assert(diff === 0, `${diff} pixels changed alpha`); return `${semi} semi-transparent pixels kept`;
  });
  await R.test('PNG: transparent areas are NOT flattened onto white', async () => {
    const out = await enc(alphaPng, { type: 'image/png', quality: 80 }); const p = await pixels(out.blob); const c = px(p, 3, 3);
    assert(c[3] === 0, `corner is alpha ${c[3]}`); return `corner pixel = ${c}`;
  });
  await R.test('WebP: transparency is preserved (corner transparent, centre opaque, edge ring semi-transparent)', async () => {
    const out = await enc(alphaPng, { type: 'image/webp', quality: 80 }); assert(out.actualType === 'image/webp', out.actualType);
    const p = await pixels(out.blob); const corner = px(p, 3, 3)[3], centre = px(p, W / 2, H / 2)[3];
    assert(corner <= 3, `corner alpha ${corner}`); assert(centre >= 252, `centre alpha ${centre}`);
    const hdr = await bytesOf(out.blob, 32); assert(/VP8X|ALPH|VP8L/.test(ascii(hdr, 12, 4)), 'no alpha-capable WebP chunk'); return `corner ${corner}, centre ${centre}, chunk ${ascii(hdr, 12, 4)}`;
  });
  await R.test('WebP source with transparency -> PNG keeps the transparency', async () => {
    const out = await enc(alphaWebp, { type: 'image/png', quality: 100 }); const p = await pixels(out.blob); assert(px(p, 3, 3)[3] === 0 && px(p, W / 2, H / 2)[3] === 255, 'alpha lost'); return 'ok';
  });
  await R.test('JPEG: default background for transparent areas is white', async () => {
    const out = await enc(alphaPng, { type: 'image/jpeg', quality: 90 }); assert(isJpeg(await bytesOf(out.blob)), 'not a JPEG');
    const p = await pixels(out.blob); const c = px(p, 3, 3); assert(near(c.slice(0, 3), [255, 255, 255], 6), `corner ${c}`); assert(c[3] === 255, 'JPEG decoded with transparency'); return `corner = ${c}`;
  });
  for (const [hex, rgb] of [['#ff0000', [255, 0, 0]], ['#00ff00', [0, 255, 0]], ['#336699', [51, 102, 153]], ['#000000', [0, 0, 0]]]) {
    await R.test(`JPEG: chosen background ${hex} fills the transparent areas`, async () => {
      const out = await enc(alphaPng, { type: 'image/jpeg', quality: 92, background: hex }); const p = await pixels(out.blob); const c = px(p, 3, 3);
      assert(near(c.slice(0, 3), rgb, 12), `corner ${c} not near ${rgb}`); return `corner = ${c}`;
    });
  }
  await R.test('JPEG: output has no transparency anywhere (every decoded pixel is opaque)', async () => {
    const out = await enc(alphaPng, { type: 'image/jpeg', quality: 80, background: '#ff00ff' }); const p = await pixels(out.blob);
    for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 255) throw new Error('found a non-opaque pixel'); return 'all opaque';
  });
  await R.test('JPEG: opaque centre of the picture is NOT replaced by the background', async () => {
    const out = await enc(alphaPng, { type: 'image/jpeg', quality: 92, background: '#ff0000' }); const p = await pixels(out.blob); const c = px(p, W / 2, H / 2);
    assert(!near(c.slice(0, 3), [255, 0, 0], 40), `centre looks like background: ${c}`); return `centre = ${c}`;
  });
  await R.test('transparency detection: true for alpha PNG/WebP, false for JPEG and opaque PNG', async () => {
    const t = async (f) => { const d = await decodeImage(f); try { return await hasTransparency(d); } finally { d.release(); } };
    const r = [await t(alphaPng), await t(alphaWebp), await t(photoJpeg), await t(photoPng)]; assert(JSON.stringify(r) === '[true,true,false,false]', JSON.stringify(r)); return JSON.stringify(r);
  });
  await R.test('transparency detection finds a single transparent pixel in a large opaque image', async () => {
    const c = drawPicture(300, 200); c.getContext('2d').clearRect(123, 77, 1, 1); const f = await makeFile(c, 'image/png', undefined, 'dot.png');
    const d = await decodeImage(f); try { assert(await hasTransparency(d), 'missed it'); } finally { d.release(); } return 'found';
  });

  /* ---- Quality, presets, sizes ---- */
  await R.test('JPEG: custom quality values give strictly smaller files as quality drops (95 > 80 > 50 > 20)', async () => {
    const sizes = []; for (const q of [95, 80, 50, 20]) sizes.push((await enc(photoPng, { type: 'image/jpeg', quality: q })).blob.size);
    assert(sizes.every((s, i) => i === 0 || s < sizes[i - 1]), sizes.join(' > ')); return sizes.map(formatBytes).join(' > ');
  });
  await R.test('WebP: custom quality values give strictly smaller files as quality drops', async () => {
    const sizes = []; for (const q of [95, 80, 50, 20]) sizes.push((await enc(photoPng, { type: 'image/webp', quality: q })).blob.size);
    assert(sizes.every((s, i) => i === 0 || s < sizes[i - 1]), sizes.join(' > ')); return sizes.map(formatBytes).join(' > ');
  });
  for (const [type, label] of [['image/jpeg', 'JPEG'], ['image/webp', 'WebP'], ['image/png', 'PNG']]) {
    await R.test(`${label}: presets order High Quality > Balanced > Smaller File by file size`, async () => {
      const s = {}; for (const [k, p] of Object.entries(PRESETS)) s[k] = (await enc(photoPng, { type, quality: p.quality })).blob.size;
      assert(s.high > s.balanced && s.balanced > s.small, JSON.stringify(s)); return `${formatBytes(s.high)} > ${formatBytes(s.balanced)} > ${formatBytes(s.small)}`;
    });
  }
  await R.test('PNG: quality 100 is lossless (decoded pixels identical to the source)', async () => {
    const src = await pixels(photoPng); const p = await pixels((await enc(photoPng, { type: 'image/png', quality: 100 })).blob); let diff = 0;
    for (let i = 0; i < src.data.length; i++) if (src.data[i] !== p.data[i]) diff++; assert(diff === 0, `${diff} channel values differ`); return 'bit-identical';
  });
  await R.test('PNG: Smaller File really reduces the number of colours (<= 64 levels per channel)', async () => {
    const p = await pixels((await enc(photoPng, { type: 'image/png', quality: PRESETS.small.quality })).blob); const lv = new Set(); for (let i = 0; i < p.data.length; i += 4) lv.add(p.data[i]);
    assert(lv.size <= 64, `${lv.size} red levels`); return `${lv.size} distinct red levels`;
  });
  await R.test('compression can make a file LARGER (re-saving a small JPEG at high quality) and this is detectable', async () => {
    const small = await makeFile(photoCanvas, 'image/jpeg', 0.3, 'tiny.jpg'); const out = await enc(small, { type: 'image/jpeg', quality: PRESETS.high.quality });
    assert(out.blob.size > small.size, `${out.blob.size} <= ${small.size}`); return `${formatBytes(small.size)} -> ${formatBytes(out.blob.size)}`;
  });

  /* ---- Honest format reporting ---- */
  await R.test('unsupported output type: the browser falls back, and the result says what it REALLY produced', async () => {
    const out = await enc(photoPng, { type: 'image/avif', quality: 80 });
    assert(out.requestedType === 'image/avif', 'requested type lost'); assert(out.actualType === out.blob.type, 'actualType does not match the blob');
    if (out.actualType !== 'image/avif') assert(isPng(await bytesOf(out.blob)), 'reported fallback does not match the bytes'); return `asked image/avif, got ${out.actualType}`;
  });

  /* ---- Real sample files from the fixtures ---- */
  for (const [key, f] of Object.entries(FIXTURES)) {
    await R.test(`real ${key} file: decodes, reports ${f.width}x${f.height}, and compresses to all three formats`, async () => {
      const file = new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], `${key}.bin`, { type: f.type });
      const d = await decodeImage(file); assert(d.width === f.width && d.height === f.height, `${d.width}x${d.height}`); d.release();
      for (const type of ['image/jpeg', 'image/png', 'image/webp']) { const out = await enc(file, { type, quality: 80 }); assert(out.actualType === type, `${type} -> ${out.actualType}`); await pixels(out.blob); }
      return 'ok';
    });
  }

  /* ---- Errors and resources ---- */
  await R.test('corrupt image data: decode fails with a readable error (no crash)', async () => {
    const bad = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])], 'bad.jpg', { type: 'image/jpeg' });
    try { await decodeImage(bad); } catch (e) { assert(e.code === 'decode-failed' && /could not be read/.test(e.message), e.message); return e.message; } throw new Error('did not fail');
  });
  await R.test('thumbnail is small (max 96 px) so no full-size image stays on the page', async () => {
    const d = await decodeImage(photoPng); const t = makeThumbnail(d); d.release(); assert(Math.max(t.width, t.height) <= 96 && t.width / t.height > 1.3, `${t.width}x${t.height}`); return `${t.width}x${t.height}`;
  });
  await R.test('cleanup: every decoded bitmap is closed after compression (success and failure)', async () => {
    let created = 0, closed = 0; const oc = window.createImageBitmap, ocl = ImageBitmap.prototype.close;
    window.createImageBitmap = async (...a) => { const b = await oc(...a); created++; return b; }; ImageBitmap.prototype.close = function () { closed++; return ocl.call(this); };
    try {
      await enc(photoPng, { type: 'image/webp', quality: 70 }); await enc(alphaPng, { type: 'image/jpeg', quality: 70 });
      await enc(photoPng, { type: 'image/png', quality: 60 }).catch(() => {});
      await enc(photoPng, { type: 'image/png', quality: 60, shouldCancel: () => true }).then(() => { throw new Error('cancel ignored'); }, (e) => assert(e.code === 'cancelled', e.message));
    } finally { window.createImageBitmap = oc; ImageBitmap.prototype.close = ocl; }
    assert(created > 0 && created === closed, `created ${created}, closed ${closed}`); return `${created} bitmaps created, ${closed} closed`;
  });
  await R.test('cancelling stops colour reduction part-way without leaving anything running', async () => {
    let calls = 0; const err = await enc(photoPng, { type: 'image/png', quality: 60, shouldCancel: () => ++calls > 1 }).then(() => null, (e) => e); assert(err && err.code === 'cancelled', 'not cancelled'); return `cancelled after ${calls} checks`;
  });

  return R.finish();
}


/* ================================================================= UI tests (drive the real page) */
const fileOf = (bytes, name, type = '') => new File([bytes], name, { type, lastModified: 1700000000000 + Math.floor(rnd() * 1e6) });
const ascii8 = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

export async function runUiTests() {
  const R = makeRunner('UI (real page, real files, real downloads)');
  const root = document.querySelector('[data-ic]');
  if (!root) throw new Error('Open /tools/image-compressor first.');
  const ic = root.__ic;
  const q = (s, ctx = root) => ctx.querySelector(s);
  const qa = (s, ctx = root) => [...ctx.querySelectorAll(s)];
  const waitFor = async (cond, ms = 15000, what = 'condition') => { const t = performance.now(); while (performance.now() - t < ms) { const v = await cond(); if (v) return v; await sleep(25); } throw new Error(`timed out waiting for ${what}`); };
  const idle = () => waitFor(() => !ic.items.some((i) => ['checking', 'queued', 'compressing'].includes(i.status)), 20000, 'work to finish');
  const addViaInput = async (files) => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); const input = q('[data-ic-input]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(20); await idle(); };
  const byName = (n) => ic.items.find((i) => i.name === n);
  const row = (n) => byName(n).ui.li;
  const click = async (el) => { el.click(); await sleep(30); };

  // Instrumentation: downloads, object URLs, bitmaps, network, storage
  const downloads = []; const created = []; const origCreate = URL.createObjectURL.bind(URL); const origRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = origCreate(b); created.push({ u, blob: b }); return u; };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { const rec = { name: this.download, href: this.href }; const m = created.find((c) => c.u === this.href); rec.blob = m?.blob; downloads.push(rec); };
  let bitmapsMade = 0, bitmapsClosed = 0; const ocib = window.createImageBitmap, ocl = ImageBitmap.prototype.close;
  window.createImageBitmap = async (...a) => { const b = await ocib(...a); bitmapsMade++; return b; }; ImageBitmap.prototype.close = function () { bitmapsClosed++; return ocl.call(this); };
  const net = { fetch: 0, xhr: 0, beacon: 0, ws: 0 }; const of = window.fetch, ox = XMLHttpRequest.prototype.open, ob = navigator.sendBeacon?.bind(navigator);
  window.fetch = (...a) => { net.fetch++; return of(...a); }; XMLHttpRequest.prototype.open = function (...a) { net.xhr++; return ox.apply(this, a); }; if (ob) navigator.sendBeacon = (...a) => { net.beacon++; return ob(...a); };
  const storageBefore = JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]);
  const resBefore = performance.getEntriesByType('resource').length;
  const restore = () => { URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick; window.createImageBitmap = ocib; ImageBitmap.prototype.close = ocl; window.fetch = of; XMLHttpRequest.prototype.open = ox; if (ob) navigator.sendBeacon = ob; };

  try {
    /* ---- fixtures ---- */
    const photoC = drawPicture(640, 420), alphaC = drawPicture(320, 220, { alpha: true });
    const photo = await makeFile(photoC, 'image/jpeg', 0.92, 'photo.jpg');
    const jpegExt = await makeFile(drawPicture(300, 200), 'image/jpeg', 0.9, 'camera.jpeg');
    const logo = await makeFile(alphaC, 'image/png', undefined, 'logo.png');
    const banner = await makeFile(alphaC, 'image/webp', 0.9, 'banner.webp');
    const mislabelled = fileOf(new Uint8Array(await (await makeFile(drawPicture(120, 80), 'image/jpeg', 0.8, 'x.jpg')).arrayBuffer()), 'really-a-jpeg.png', 'image/png');
    const hugeHdr = new Uint8Array(await (await makeFile(drawPicture(40, 30), 'image/png', undefined, 'h.png')).arrayBuffer()); new DataView(hugeHdr.buffer).setUint32(16, 20000); new DataView(hugeHdr.buffer).setUint32(20, 20000);
    const bad = {
      gif: fileOf(ascii8('GIF89a\x01\x00\x01\x00\x80\x00\x00'), 'anim.gif', 'image/gif'),
      fakePng: fileOf(ascii8('this is only text pretending to be a picture'), 'fake.png', 'image/png'),
      empty: fileOf(new Uint8Array(0), 'empty.jpg', 'image/jpeg'),
      broken: fileOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 9, 9, 9, 9, 9, 9, 9, 9]), 'broken.jpg', 'image/jpeg'),
      huge: fileOf(hugeHdr, 'huge.png', 'image/png'),
      svg: fileOf(ascii8('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'), 'drawing.svg', 'image/svg+xml'),
    };

    /* ---- upload & validation ---- */
    await R.test('upload: 4 valid images (JPG, JPEG, PNG, WebP) are accepted with preview, name, size and dimensions', async () => {
      await addViaInput([photo, jpegExt, logo, banner]);
      for (const [n, type, w, h] of [['photo.jpg', 'image/jpeg', 640, 420], ['camera.jpeg', 'image/jpeg', 300, 200], ['logo.png', 'image/png', 320, 220], ['banner.webp', 'image/webp', 320, 220]]) {
        const it = byName(n); assert(it && it.status === 'ready', `${n} status ${it?.status}`); assert(it.type === type, `${n} type ${it.type}`); assert(it.width === w && it.height === h, `${n} ${it.width}x${it.height}`);
        const li = row(n); assert(li.querySelector('canvas'), `${n} has no preview`); assert(li.textContent.includes(n), 'name missing'); assert(/\d+(\.\d+)? (KB|B|MB)/.test(li.querySelector('[data-meta]').textContent), 'size missing'); assert(li.querySelector('[data-meta]').textContent.includes(`${w} \u00d7 ${h}`), 'dimensions missing');
      }
      return '4 ready';
    });
    await R.test('upload: transparency is detected for PNG/WebP with alpha, not for JPEG', async () => {
      assert(byName('logo.png').hasAlpha && byName('banner.webp').hasAlpha && !byName('photo.jpg').hasAlpha, 'wrong alpha flags'); return 'ok';
    });
    await R.test('upload: invalid files are NOT skipped silently: each is listed with a specific reason', async () => {
      await addViaInput(Object.values(bad));
      const expect = { 'anim.gif': /GIF images are not supported/, 'fake.png': /not a JPG, PNG or WebP image/, 'empty.jpg': /empty/, 'broken.jpg': /could not be read|damaged/, 'huge.png': /20,000 \u00d7 20,000 px .*limit is 100 megapixels/, 'drawing.svg': /SVG files are not supported/ };
      const out = [];
      for (const [n, re] of Object.entries(expect)) { const it = byName(n); assert(it && it.status === 'rejected', `${n}: ${it?.status}`); const text = row(n).textContent; assert(re.test(text), `${n}: "${text.slice(0, 160)}"`); assert(row(n).querySelector('[data-compress]').hidden, `${n} still offers Compress`); out.push(`${n}: ${it.error.slice(0, 50)}`); }
      return out.join(' | ');
    });
    await R.test('upload: file type is decided by content, not extension (a JPEG named .png is accepted and flagged)', async () => {
      await addViaInput([mislabelled]); const it = byName('really-a-jpeg.png'); assert(it.status === 'ready' && it.type === 'image/jpeg', `${it.status} ${it.type}`); assert(/name says PNG, but the file is really JPEG/.test(row(it.name).textContent), 'no note'); return 'ok';
    });
    await R.test('upload: duplicates are detected and reported (not silently ignored)', async () => {
      const before = ic.items.length; await addViaInput([photo, logo]); assert(ic.items.length === before, 'duplicates were added');
      const msg = q('[data-ic-notes]').textContent; assert(/2 files were already in the list and skipped/.test(msg), msg); return msg;
    });
    await R.test('upload: drag and drop works (drag highlight, then files added)', async () => {
      const zone = q('[data-ic-drop]'); const extra = await makeFile(drawPicture(100, 80), 'image/png', undefined, 'dropped.png');
      const dt = new DataTransfer(); dt.items.add(extra);
      zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); assert(zone.dataset.dragging === 'true', 'no drag highlight');
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); assert(!zone.dataset.dragging, 'highlight stuck'); await idle();
      assert(byName('dropped.png')?.status === 'ready', 'dropped file not added'); return 'ok';
    });
    await R.test('upload: a file dropped outside the zone does not navigate the page away', async () => {
      const dt = new DataTransfer(); dt.items.add(photo); const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); assert(ev.defaultPrevented, 'default not prevented'); return 'prevented';
    });

    /* ---- settings ---- */
    await R.test('settings: presets set the quality slider; moving the slider switches to Custom', async () => {
      const preset = (v) => q(`input[name="ic-preset"][value="${v}"]`); const slider = q('[data-ic-quality]');
      await click(preset('high')); assert(slider.value === '92' && preset('high').checked, 'high'); await click(preset('small')); assert(slider.value === '60', 'small'); await click(preset('balanced')); assert(slider.value === '80', 'balanced');
      slider.value = '73'; slider.dispatchEvent(new Event('input', { bubbles: true })); assert(!qa('input[name="ic-preset"]').some((r) => r.checked), 'a preset is still selected'); assert(/Custom quality \(73%\)/.test(q('[data-ic-preset-hint]').textContent), q('[data-ic-preset-hint]').textContent);
      await click(preset('balanced')); return 'ok';
    });
    await R.test('settings: the quality note explains the trade-off and does not promise a saving', async () => {
      const t = q('[data-ic-quality-note]').textContent; assert(/no saving is guaranteed/.test(t) && /bigger file/.test(t) && /smaller file/.test(t), t); return t.slice(0, 80) + '\u2026';
    });

    /* ---- compression: same format ---- */
    let sawProgress = new Set();
    await R.test('compress all (Balanced, same format): every valid image is compressed, with live progress', async () => {
      const bar = q('[data-ic-bar]'); const mo = new MutationObserver(() => sawProgress.add(bar.getAttribute('aria-valuetext'))); mo.observe(bar, { attributes: true });
      await click(q('[data-ic-compress-all]')); await waitFor(() => q('[data-ic-compress-all]').disabled && !ic.items.some((i) => i.status === 'compressing'), 20000, 'batch'); mo.disconnect();
      const good = ic.items.filter((i) => i.status !== 'rejected'); assert(good.length === 6, `${good.length} compressible items`); for (const it of good) assert(it.status === 'done' && it.result, `${it.name}: ${it.status} ${it.error}`);
      assert(sawProgress.size >= 3, `only saw ${[...sawProgress]}`); return `done: ${good.length}; progress states: ${[...sawProgress].join(' / ')}`;
    });
    await R.test('results: each row shows original size, compressed size, change, format and dimensions', async () => {
      for (const it of ic.items.filter((i) => i.result)) { const li = it.ui.li; const t = li.querySelector('[data-result]').textContent; assert(!li.querySelector('[data-result]').hidden, 'result hidden'); assert(/Original/.test(t) && /Compressed/.test(t) && /Change/.test(t) && /Format/.test(t) && /Dimensions/.test(t), t); assert(/(Saved|Larger by|No change)/.test(t), t); }
      const photoRow = row('photo.jpg').querySelector('[data-result]').textContent; return photoRow.replace(/\s+/g, ' ');
    });
    await R.test('results: reported sizes match the real blob sizes', async () => {
      const it = byName('photo.jpg'); const shown = it.ui.li.querySelector('[data-r-new]').textContent; assert(shown === formatBytes(it.result.blob.size), `${shown} vs ${it.result.blob.size}`); return shown;
    });
    await R.test('summary line totals the batch', async () => { const s = q('[data-ic-summary]'); assert(!s.hidden && /compressed .* \u2192 .*(Saved|Larger by)/.test(s.textContent), s.textContent); return s.textContent; });

    /* ---- real downloads of real exported files ---- */
    const dl = async (name) => { downloads.length = 0; await click(row(name).querySelector('[data-download]')); await sleep(50); assert(downloads.length === 1, `${downloads.length} downloads`); return downloads[0]; };
    await R.test('download PNG: the exported file is a real PNG, named from the original, and keeps transparency', async () => {
      const d = await dl('logo.png'); assert(d.name === 'logo-compressed.png', d.name); assert(isPng(await bytesOf(d.blob)), 'not a PNG'); assert(d.blob.type === 'image/png', d.blob.type);
      const p = await pixels(d.blob); assert(px(p, 3, 3)[3] === 0 && px(p, 160, 110)[3] === 255, `alpha ${px(p, 3, 3)} / ${px(p, 160, 110)}`); return `${d.name} ${formatBytes(d.blob.size)}`;
    });
    await R.test('download JPEG: a real JPEG, named .jpg, that decodes', async () => {
      const d = await dl('photo.jpg'); assert(d.name === 'photo-compressed.jpg', d.name); assert(isJpeg(await bytesOf(d.blob)), 'not a JPEG'); const p = await pixels(d.blob); assert(p.width === 640 && p.height === 420, `${p.width}x${p.height}`); return d.name;
    });
    await R.test('download JPEG from a ".jpeg" input keeps the base name and uses .jpg for output', async () => { const d = await dl('camera.jpeg'); assert(d.name === 'camera-compressed.jpg', d.name); return d.name; });
    await R.test('download WebP: a real WebP with transparency', async () => {
      const d = await dl('banner.webp'); assert(d.name === 'banner-compressed.webp', d.name); assert(isWebp(await bytesOf(d.blob)), 'not WebP'); const p = await pixels(d.blob); assert(px(p, 3, 3)[3] <= 3 && px(p, 160, 110)[3] >= 252, `${px(p, 3, 3)} ${px(p, 160, 110)}`); return d.name;
    });
    await R.test('originals are never modified: the source File objects are byte-identical afterwards', async () => {
      const again = new Uint8Array(await byName('photo.jpg').file.arrayBuffer()); const orig = new Uint8Array(await photo.arrayBuffer()); assert(again.length === orig.length && again.every((v, i) => v === orig[i]), 'original changed'); return 'unchanged';
    });

    /* ---- changing output format ---- */
    await R.test('format -> JPEG: results are marked "settings changed", and a background colour selector appears for transparent images', async () => {
      await click(q('input[name="ic-format"][value="image/jpeg"]')); assert(!q('[data-ic-bg-field]').hidden, 'no background selector'); assert(/transparent areas/.test(q('[data-ic-format-note]').textContent), q('[data-ic-format-note]').textContent);
      assert(/Settings changed/.test(row('logo.png').querySelector('[data-state]').textContent), 'logo not stale'); assert(!/Settings changed/.test(row('photo.jpg').querySelector('[data-state]').textContent), 'JPEG source should not be stale'); assert(q('[data-ic-bg]').value === '#ffffff', 'default background is not white'); return 'ok';
    });
    await R.test('format -> JPEG with a red background: exported JPEGs have no transparency and red where it was transparent', async () => {
      const bg = q('[data-ic-bg]'); bg.value = '#ff0000'; bg.dispatchEvent(new Event('input', { bubbles: true }));
      await click(q('[data-ic-compress-all]')); await waitFor(() => !ic.items.some((i) => i.status === 'compressing' || i.status === 'queued'), 20000, 'batch');
      for (const n of ['logo.png', 'banner.webp']) { const d = await dl(n); assert(d.name.endsWith('-compressed.jpg'), d.name); assert(isJpeg(await bytesOf(d.blob)), `${n} not JPEG`); const p = await pixels(d.blob); const c = px(p, 3, 3); assert(near(c.slice(0, 3), [255, 0, 0], 14) && c[3] === 255, `${n} corner ${c}`); }
      const d = await dl('photo.jpg'); assert(d.name === 'photo-compressed.jpg', d.name); return 'corner pixels red, all outputs real JPEG';
    });
    await R.test('format -> PNG then WebP: outputs are real PNG / WebP files and transparency survives in both', async () => {
      await click(q('input[name="ic-format"][value="image/png"]')); await click(q('[data-ic-compress-all]')); await waitFor(() => !ic.items.some((i) => i.status === 'compressing' || i.status === 'queued'), 20000, 'png batch');
      let d = await dl('banner.webp'); assert(d.name === 'banner-compressed.png' && isPng(await bytesOf(d.blob)), `${d.name}`); assert(px(await pixels(d.blob), 3, 3)[3] === 0, 'alpha lost in PNG');
      d = await dl('photo.jpg'); assert(d.name === 'photo-compressed.png' && isPng(await bytesOf(d.blob)), d.name);
      await click(q('input[name="ic-format"][value="image/webp"]')); await click(q('[data-ic-compress-all]')); await waitFor(() => !ic.items.some((i) => i.status === 'compressing' || i.status === 'queued'), 20000, 'webp batch');
      d = await dl('logo.png'); assert(d.name === 'logo-compressed.webp' && isWebp(await bytesOf(d.blob)), d.name); const p = await pixels(d.blob); assert(px(p, 3, 3)[3] <= 3 && px(p, 160, 110)[3] >= 252, 'alpha lost in WebP'); return 'ok';
    });
    await R.test('exported type is never mislabelled: every result\'s blob type equals the type its name and label claim', async () => {
      for (const it of ic.items.filter((i) => i.result)) { const r = it.result; const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[r.blob.type]; assert(r.actualType === r.blob.type, `${it.name}: ${r.actualType} vs ${r.blob.type}`); const h = await bytesOf(r.blob); assert((r.blob.type === 'image/png' && isPng(h)) || (r.blob.type === 'image/jpeg' && isJpeg(h)) || (r.blob.type === 'image/webp' && isWebp(h)), `${it.name}: bytes do not match ${r.blob.type}`); assert(ext, 'unknown type'); }
      return 'all match';
    });

    /* ---- larger output: keep original ---- */
    await R.test('output larger than the original: the user is told, and can keep the original instead (byte-identical download)', async () => {
      const smallJpg = await makeFile(drawPicture(400, 300), 'image/jpeg', 0.2, 'tiny.jpg'); await addViaInput([smallJpg]);
      await click(q('input[name="ic-format"][value="image/png"]')); await click(q('input[name="ic-preset"][value="high"]'));
      await click(byName('tiny.jpg').ui.compress); await waitFor(() => byName('tiny.jpg').status === 'done', 15000, 'tiny'); const it = byName('tiny.jpg');
      assert(it.result.blob.size > it.file.size, `${it.result.blob.size} <= ${it.file.size}`); const li = it.ui.li;
      assert(!li.querySelector('[data-warn]').hidden && /not smaller than the original/.test(li.querySelector('[data-warn]').textContent), 'no warning'); assert(/Larger by/.test(li.querySelector('[data-r-change]').textContent), li.querySelector('[data-r-change]').textContent);
      assert(!li.querySelector('[data-keep]').hidden, 'no keep button'); await click(li.querySelector('[data-keep]'));
      assert(/original kept/.test(li.querySelector('[data-r-new]').textContent), 'not marked kept'); const d = await dl('tiny.jpg'); assert(d.name === 'tiny.jpg', d.name); assert(d.blob === it.file, 'download is not the original file object');
      const a = new Uint8Array(await d.blob.arrayBuffer()), b = new Uint8Array(await smallJpg.arrayBuffer()); assert(a.length === b.length && a.every((v, i) => v === b[i]), 'bytes differ'); return `${formatBytes(it.file.size)} -> compressed ${formatBytes(it.result.blob.size)}; original kept`;
    });

    /* ---- batch ZIP ---- */
    await R.test('Download all: a valid ZIP with unique, meaningful names and every file decodable', async () => {
      downloads.length = 0; await click(q('[data-ic-download-all]')); await waitFor(() => downloads.length === 1, 8000, 'zip download'); const d = downloads[0];
      assert(d.name === 'toolora-compressed-images.zip', d.name); assert(d.blob.type === 'application/zip', d.blob.type);
      const entries = await readZip(d.blob); const done = ic.items.filter((i) => i.result); assert(entries.length === done.length, `${entries.length} entries for ${done.length} images`);
      assert(new Set(entries.map((e) => e.name.toLowerCase())).size === entries.length, 'duplicate names'); assert(entries.every((e) => e.crcOk), 'bad CRC');
      for (const e of entries) { const blob = new Blob([e.bytes]); const h = e.bytes.slice(0, 16); if (/\.jpe?g$/.test(e.name)) assert(isJpeg(h), `${e.name} not JPEG`); else if (/\.png$/.test(e.name)) assert(isPng(h), `${e.name} not PNG`); else if (/\.webp$/.test(e.name)) assert(isWebp(h), `${e.name} not WebP`); await pixels(blob); }
      assert(entries.some((e) => e.name === 'tiny.jpg'), 'the kept original is missing from the ZIP'); window.__lastZip = d.blob; return `${entries.length} files, ${formatBytes(d.blob.size)}: ${entries.map((e) => e.name).join(', ')}`;
    });

    /* ---- compare, cleanup ---- */
    await R.test('compare: opens a before/after view with two object URLs and revokes them when closed', async () => {
      const it = byName('logo.png'); const before = ic.openUrls.size; await click(it.ui.compare); assert(!it.ui.cmp.hidden && it.ui.cmp.querySelectorAll('img').length === 2, 'no comparison'); assert(ic.openUrls.size === before + 2, `${ic.openUrls.size - before} URLs`);
      await waitFor(() => [...it.ui.cmp.querySelectorAll('img')].every((i) => i.complete && i.naturalWidth > 0), 5000, 'images'); const range = it.ui.cmp.querySelector('input[type=range]'); assert(range.getAttribute('aria-label'), 'slider unlabeled'); range.value = '20'; range.dispatchEvent(new Event('input')); assert(it.ui.cmp.firstChild.style.getPropertyValue('--pos') === '20%', 'slider does nothing');
      await click(it.ui.compare); assert(it.ui.cmp.hidden && ic.openUrls.size === before, `${ic.openUrls.size} open URLs after close`); return 'balanced';
    });
    await R.test('compare: opening a second comparison closes the first (only one pair of URLs at a time)', async () => {
      const a = byName('photo.jpg'), b = byName('banner.webp'); const base = ic.openUrls.size; await click(a.ui.compare); await click(b.ui.compare); assert(a.ui.cmp.hidden && !b.ui.cmp.hidden, 'wrong panels'); assert(ic.openUrls.size === base + 2, `${ic.openUrls.size - base}`); await click(b.ui.compare); assert(ic.openUrls.size === base, 'leak'); return 'ok';
    });
    await R.test('remove: removing one image frees it, keeps the others, and allows adding the same file again', async () => {
      const n = ic.items.length; const it = byName('dropped.png'); await click(it.ui.remove); assert(ic.items.length === n - 1 && !byName('dropped.png') && !root.textContent.includes('dropped.png'), 'not removed');
      await addViaInput([await makeFile(drawPicture(100, 80), 'image/png', undefined, 'dropped.png')]); assert(byName('dropped.png'), 're-add failed'); return 'ok';
    });
    await R.test('remove: keyboard focus moves to a sensible control (never lost)', async () => { const it = ic.items[0]; const next = ic.items[1]; it.ui.remove.focus(); await click(it.ui.remove); assert(document.activeElement === next.ui.remove, document.activeElement.outerHTML.slice(0, 60)); return 'next item\'s Remove button'; });
    await R.test('Clear all asks for confirmation, then frees everything', async () => {
      await click(q('[data-ic-clear-all]')); assert(!q('[data-ic-confirm]').hidden, 'no confirm'); await click(q('[data-ic-confirm-no]')); assert(ic.items.length > 0, 'cleared despite Keep');
      await click(q('[data-ic-clear-all]')); await click(q('[data-ic-confirm-yes]')); assert(ic.items.length === 0 && qa('.item').length === 0, 'items remain'); assert(ic.openUrls.size === 0, `${ic.openUrls.size} object URLs still open`); assert(!q('[data-ic-empty]').hidden, 'empty state not shown'); assert(q('[data-ic-download-all]').hidden && q('[data-ic-compress-all]').disabled, 'toolbar not reset'); return 'clean';
    });

    /* ---- cancel & batch behaviour ---- */
    await R.test('batch: images are processed one at a time; Stop cancels the rest and says so', async () => {
      await click(q('input[name="ic-format"][value="original"]'));
      const many = []; for (let i = 0; i < 6; i++) many.push(await makeFile(drawPicture(1400, 1000), 'image/png', undefined, `big-${i}.png`)); await addViaInput(many);
      let maxConcurrent = 0; const mo = new MutationObserver(() => { maxConcurrent = Math.max(maxConcurrent, ic.items.filter((i) => i.status === 'compressing').length); }); mo.observe(q('[data-ic-list]'), { subtree: true, attributes: true, childList: true, characterData: true });
      await click(q('input[name="ic-preset"][value="small"]')); await click(q('[data-ic-compress-all]')); await waitFor(() => ic.items.some((i) => i.status === 'done'), 20000, 'first result');
      assert(!q('[data-ic-cancel]').hidden, 'no Stop button'); await click(q('[data-ic-cancel]')); await waitFor(() => !ic.items.some((i) => ['compressing', 'queued'].includes(i.status)), 20000, 'stop'); mo.disconnect();
      const done = ic.items.filter((i) => i.status === 'done').length, notStarted = ic.items.filter((i) => i.status === 'ready').length; assert(done >= 1 && notStarted >= 1 && done + notStarted === 6, `${done} done, ${notStarted} ready`); assert(maxConcurrent <= 1, `${maxConcurrent} at once`);
      assert(/Stopped/.test(q('[data-ic-progress-text]').textContent), q('[data-ic-progress-text]').textContent); return `${done} done, ${notStarted} not started, max ${maxConcurrent} at a time`;
    });
    await R.test('batch: the page stays responsive while compressing (main thread is never blocked for long)', async () => {
      await click(q('[data-ic-clear-all]')); await click(q('[data-ic-confirm-yes]'));
      const many = []; for (let i = 0; i < 3; i++) many.push(await makeFile(drawPicture(2400, 1600), 'image/png', undefined, `large-${i}.png`)); await addViaInput(many);
      // Measures how long the main thread is ever blocked: the gap between back-to-back tasks (works in background tabs too).
      let worst = 0, last = performance.now(), run = true, ticks = 0; const loop = () => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; ticks++; if (run) { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); loop(); }; ch.port2.postMessage(0); } }; loop();
      await click(q('[data-ic-compress-all]')); await waitFor(() => ic.items.every((i) => i.status === 'done'), 40000, 'large batch'); run = false;
      assert(worst < 400, `main thread blocked for ${Math.round(worst)} ms at once`); return `3 x 3.8 MP images; longest main-thread block ${Math.round(worst)} ms (${ticks} ticks)`;
    });

    /* ---- resources, privacy ---- */
    await R.test('cleanup: after clearing, no object URLs are open and every decoded bitmap was closed', async () => {
      await click(q('[data-ic-clear-all]')); await click(q('[data-ic-confirm-yes]')); const outstandingUrls = created.filter((c) => ic.openUrls.has(c.u)).length;
      assert(ic.openUrls.size === 0 && outstandingUrls === 0, `${ic.openUrls.size} open`); assert(bitmapsMade > 0 && bitmapsMade === bitmapsClosed, `${bitmapsMade} created / ${bitmapsClosed} closed`);
      return `${created.length} object URLs created by the tool + downloads; ${bitmapsMade} bitmaps created, ${bitmapsClosed} closed`;
    });
    await R.test('privacy: no network requests, no storage, nothing logged or sent', async () => {
      assert(net.fetch === 0 && net.xhr === 0 && net.beacon === 0, JSON.stringify(net));
      assert(JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]) === storageBefore, 'storage changed');
      const entries = performance.getEntriesByType('resource').slice(resBefore).filter((e) => !e.name.startsWith('blob:') && !/\/(src|tests|node_modules|@vite|@fs|@id)\//.test(e.name));
      assert(entries.length === 0, `unexpected requests: ${entries.map((e) => e.name).join(', ')}`); return 'fetch/XHR/beacon: 0; storage unchanged; no unexpected resource requests';
    });
  } finally {
    restore();
  }
  return R.finish();
}

export { makeRunner, assert, sleep, drawPicture, makeFile, bytesOf, pixels, px, isPng, isJpeg, isWebp, near, ascii };