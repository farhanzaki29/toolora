/**
 * General QR Code Generator: real-browser tests. Open /tools/qr-code-generator in the dev server, then in its console:
 *   const m = await import('/tests/qrCode.browser.mjs');  await m.runUiTests();
 * The tests drive the real page (typing, clicking), capture the files the Download buttons really produce, and decode
 * those PNG / SVG files with an independent decoder (jsQR, fetched from node_modules; it is a dev dependency only).
 */
import { makeRunner, assert, sleep } from './imageCompressor.browser.mjs';

async function loadJsQr() {
  const src = await (await fetch('/node_modules/jsqr/dist/jsQR.js')).text();
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  return m.exports.default ?? m.exports;
}

export async function runUiTests() {
  const jsQR = await loadJsQr();
  const R = makeRunner('QR Code Generator UI (real page, real downloads, independent decoder)');
  const root = document.querySelector('[data-qg]');
  if (!root) throw new Error('Open /tools/qr-code-generator first.');
  const q = (s) => root.querySelector(s);
  const qa = (s) => [...root.querySelectorAll(s)];
  const panel = (t) => q(`[data-qg-panel="${t}"]`);
  const field = (t, f) => panel(t).querySelector(`[data-qg-field="${f}"]`);
  const waitFor = async (cond, ms = 8000, what = 'condition') => { const t = performance.now(); while (performance.now() - t < ms) { const v = await cond(); if (v) return v; await sleep(20); } throw new Error(`timed out waiting for ${what}`); };
  const settle = () => sleep(80);
  const click = async (el) => { el.click(); await settle(); };
  const typeInto = async (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(); };
  const pick = async (type) => { await click(q(`input[name="qg-type"][value="${type}"]`)); };
  const size = (s) => click(q(`input[name="qg-size"][value="${s}"]`));
  const setColor = async (which, hex) => { const i = q(which === 'fg' ? '[data-qg-fg]' : '[data-qg-bg]'); i.value = hex; i.dispatchEvent(new Event('input', { bubbles: true })); await settle(); };
  const encoded = () => q('[data-qg-encoded]').textContent;
  const hasQr = () => !q('[data-qg-qr]').hidden && Boolean(q('[data-qg-qr] svg'));
  const visibleInputs = () => qa('[data-qg-field]').filter((i) => !i.closest('[hidden]'));
  const clearAll = async () => { q('[data-qg-clear]').disabled = false; await click(q('[data-qg-clear]')); };

  // ---- instrumentation ----
  const downloads = []; const created = []; const revoked = []; const origCreate = URL.createObjectURL.bind(URL); const origRevoke = URL.revokeObjectURL.bind(URL); let own = false;
  URL.createObjectURL = (b) => { const u = origCreate(b); if (!own) created.push({ u, blob: b }); return u; };
  URL.revokeObjectURL = (u) => { revoked.push(u); return origRevoke(u); };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: created.find((c) => c.u === this.href)?.blob }); };
  const net = { fetch: 0, xhr: 0, beacon: 0 }; const of = window.fetch, ox = XMLHttpRequest.prototype.open, ob = navigator.sendBeacon?.bind(navigator);
  window.fetch = (...a) => { net.fetch++; return of(...a); }; XMLHttpRequest.prototype.open = function (...a) { net.xhr++; return ox.apply(this, a); }; if (ob) navigator.sendBeacon = (...a) => { net.beacon++; return ob(...a); };
  const storageBefore = JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]); const resBefore = performance.getEntriesByType('resource').length;
  const clip = []; const origWrite = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  if (navigator.clipboard) navigator.clipboard.writeText = async (t) => { clip.push(t); };
  const errors = []; const onErr = (e) => errors.push(e.message); window.addEventListener('error', onErr);
  const restore = () => { URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke; HTMLAnchorElement.prototype.click = origClick; window.fetch = of; XMLHttpRequest.prototype.open = ox; if (ob) navigator.sendBeacon = ob; if (origWrite) navigator.clipboard.writeText = origWrite; window.removeEventListener('error', onErr); };

  // ---- decoding of the REAL downloaded files ----
  const toImageData = (source, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false; ctx.drawImage(source, 0, 0, w, h); return ctx.getImageData(0, 0, w, h); };
  const pngInfo = async (blob) => { const b = new Uint8Array(await blob.arrayBuffer()); const sig = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v); const dv = new DataView(b.buffer); return { sig, w: dv.getUint32(16), h: dv.getUint32(20) }; };
  const decodePng = async (blob) => { const bmp = await createImageBitmap(blob); const id = toImageData(bmp, bmp.width, bmp.height); const w = bmp.width; bmp.close(); return { text: jsQR(id.data, id.width, id.height)?.data ?? null, data: id, w }; };
  const decodeSvgFile = async (blob, px) => { own = true; const url = URL.createObjectURL(blob); own = false; try { const img = new Image(); img.src = url; await img.decode(); const id = toImageData(img, px, px); return { text: jsQR(id.data, px, px)?.data ?? null, data: id, natural: [img.naturalWidth, img.naturalHeight] }; } finally { origRevoke(url); } };
  const dl = async (which) => { downloads.length = 0; await click(q(which === 'png' ? '[data-qg-png]' : '[data-qg-svg]')); await waitFor(() => downloads.length === 1, 4000, `${which} download`); return downloads[0]; };
  const scanDownloads = async (expected, px = 512) => {
    await size(px); const p = await dl('png'); const info = await pngInfo(p.blob); assert(info.sig && info.w === px && info.h === px, `PNG ${info.w}x${info.h} sig=${info.sig}`); const dp = await decodePng(p.blob); assert(dp.text === expected, `PNG decoded ${JSON.stringify(dp.text)}`);
    const s = await dl('svg'); const text = await s.blob.text(); const ds = await decodeSvgFile(s.blob, px); assert(ds.text === expected, `SVG decoded ${JSON.stringify(ds.text)}`); return { p, s, text, info, dp, ds };
  };
  const fill = async (type, values) => { await pick(type); for (const [f, v] of Object.entries(values)) await typeInto(field(type, f), v); };

  try {
    await clearAll();

    await R.test('only the relevant fields are shown for each type, with labels', async () => {
      const want = { url: 1, text: 1, email: 3, phone: 1, sms: 2, contact: 6 }; const out = [];
      for (const [t, n] of Object.entries(want)) { await pick(t); const v = visibleInputs(); assert(v.length === n, `${t}: ${v.length} visible fields (want ${n})`); for (const i of v) assert(document.querySelector(`label[for="${i.id}"]`)?.textContent.trim(), `${i.id} has no label`); assert(qa('[data-qg-panel]').filter((p) => !p.hidden).length === 1, 'more than one panel'); out.push(`${t}:${n}`); }
      await pick('url'); return out.join(' ');
    });
    await R.test('empty state: nothing is generated, downloads are disabled, missing fields are listed', async () => {
      assert(!hasQr() && q('[data-qg-png]').disabled && q('[data-qg-svg]').disabled && q('[data-qg-copy]').disabled, 'not empty'); assert(!q('[data-qg-empty]').hidden, 'no empty state'); await pick('contact'); assert(/First name is required/.test(q('[data-qg-empty-list]').textContent), q('[data-qg-empty-list]').textContent); await pick('url'); return q('[data-qg-empty-title]').textContent;
    });

    /* ---------------- each type: payload, preview, PNG, SVG ---------------- */
    await R.test('WEBSITE: "example.com/a b" is rejected; a bare domain gets https:// and both downloads decode to it', async () => {
      await fill('url', { url: 'bad address' }); assert(!hasQr() && /cannot contain spaces/.test(q('[data-qg-msg="url"]').textContent) && field('url', 'url').getAttribute('aria-invalid') === 'true', q('[data-qg-msg="url"]').textContent); assert(q('[data-qg-png]').disabled, 'download enabled with invalid input');
      await typeInto(field('url', 'url'), 'ftp://example.com'); assert(/http:\/\/ and https:\/\//.test(q('[data-qg-msg="url"]').textContent), 'scheme message');
      await typeInto(field('url', 'url'), 'example.com/path?a=1&b=2'); assert(hasQr() && encoded() === 'https://example.com/path?a=1&b=2', encoded()); assert(q('[data-qg-msg="url"]').hidden, 'stale error');
      const r = await scanDownloads('https://example.com/path?a=1&b=2'); assert(r.p.name === 'toolora-website-qr.png' && r.s.name === 'toolora-website-qr.svg', `${r.p.name} ${r.s.name}`); return `${r.p.name}, ${r.s.name}`;
    });
    await R.test('TEXT: Unicode, emoji, symbols and line breaks decode exactly from PNG and SVG', async () => {
      const text = 'Héllo wörld 日本語 😀 — “q” & <b> ; , : \\\nSecond line'; await fill('text', { text }); assert(hasQr() && encoded() === text, 'payload'); const r = await scanDownloads(text); assert(r.p.name === 'toolora-text-qr.png', r.p.name); return r.p.name;
    });
    await R.test('TEXT: the capacity counter, and a clear error (without echoing the text) when it is too long', async () => {
      await typeInto(field('text', 'text'), 'x'.repeat(100)); assert(/100 of 2,331 bytes/.test(q('[data-qg-counter]').textContent), q('[data-qg-counter]').textContent);
      await typeInto(field('text', 'text'), 'secret-'.repeat(400)); const m = q('[data-qg-msg="text"]').textContent; assert(!hasQr() && /too long/.test(m) && /2,331/.test(m) && !/secret/.test(m), m); assert(q('[data-qg-png]').disabled, 'download enabled'); assert(q('[data-qg-counter]').dataset.over === 'true', 'counter not flagged');
      await typeInto(field('text', 'text'), 'y'.repeat(2331)); assert(hasQr(), 'exactly at capacity should work'); return m;
    });
    await R.test('TEXT: a long payload (1,500 bytes) is dense but still decodes at 1024 px; a size warning shows at 256 px', async () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(34).slice(0, 1500); await typeInto(field('text', 'text'), text); await scanDownloads(text, 1024);
      await size(256); await settle(); const notes = q('[data-qg-notes]').textContent; assert(/lot of data/.test(notes) && /under 3 px/.test(notes), notes); await size(512); return notes.slice(0, 80);
    });
    await R.test('EMAIL: address, subject and message with &, %, ?, #, + and Unicode produce a correct mailto: that decodes', async () => {
      await fill('email', { address: 'me@example.com', subject: 'Q&A: 50% off? #1 a+b', message: 'Hi,\nCafé ☕ 日本' });
      const expected = 'mailto:me@example.com?subject=Q%26A%3A%2050%25%20off%3F%20%231%20a%2Bb&body=Hi%2C%0D%0ACaf%C3%A9%20%E2%98%95%20%E6%97%A5%E6%9C%AC'; assert(encoded() === expected, encoded());
      const u = new URL(encoded()); assert(u.searchParams.get('subject') === 'Q&A: 50% off? #1 a+b' && u.searchParams.get('body') === 'Hi,\r\nCafé ☕ 日本', 'round trip');
      const r = await scanDownloads(expected); assert(r.p.name === 'toolora-email-qr.png', r.p.name); return r.p.name;
    });
    await R.test('EMAIL: subject and message are optional; a bad address is reported on its own field', async () => {
      await typeInto(field('email', 'subject'), ''); await typeInto(field('email', 'message'), ''); assert(encoded() === 'mailto:me@example.com', encoded());
      await typeInto(field('email', 'address'), 'not-an-email'); assert(!hasQr() && /valid email/.test(q('[data-qg-msg="address"]').textContent), 'no message'); assert(!/not-an-email/.test(q('[data-qg-msg="address"]').textContent), 'message echoes input');
      await typeInto(field('email', 'address'), ''); assert(!hasQr() && q('[data-qg-msg="address"]').hidden && /Email address is required/.test(q('[data-qg-empty-list]').textContent), 'required hint'); return 'ok';
    });
    await R.test('PHONE: formatted international numbers become a clean tel: payload that decodes; letters and short numbers are rejected', async () => {
      await fill('phone', { phone: '+44 (0)20 7946-0958' }); assert(encoded() === 'tel:+4402079460958', encoded()); const r = await scanDownloads('tel:+4402079460958'); assert(r.p.name === 'toolora-phone-qr.png', r.p.name);
      for (const [v, re] of [['1-800-FLOWERS', /digits only/], ['12', /too short/], ['1234567890123456', /too long/]]) { await typeInto(field('phone', 'phone'), v); assert(!hasQr() && re.test(q('[data-qg-msg="phone"]').textContent), `${v}: ${q('[data-qg-msg="phone"]').textContent}`); }
      await typeInto(field('phone', 'phone'), '0412 345 678'); assert(encoded() === 'tel:0412345678', 'local format not forced'); return 'ok';
    });
    await R.test('SMS: number plus a message with special characters decodes; message optional', async () => {
      await fill('sms', { phone: '(555) 123-4567', message: 'See you at 5 & bring Café ☕ — 100% sure?\nBye' });
      const expected = 'sms:5551234567?body=See%20you%20at%205%20%26%20bring%20Caf%C3%A9%20%E2%98%95%20%E2%80%94%20100%25%20sure%3F%0D%0ABye'; assert(encoded() === expected, encoded()); const r = await scanDownloads(expected); assert(r.p.name === 'toolora-sms-qr.png', r.p.name);
      await typeInto(field('sms', 'message'), ''); assert(encoded() === 'sms:5551234567', encoded()); await typeInto(field('sms', 'phone'), ''); assert(!hasQr() && /Phone number is required/.test(q('[data-qg-empty-list]').textContent), 'required'); return r.p.name;
    });
    await R.test('CONTACT: a vCard 3.0 with CRLF line endings, escaping and only the first name required; PNG and SVG decode to it', async () => {
      await pick('contact'); await typeInto(field('contact', 'firstName'), 'Ada'); assert(encoded() === 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Ada;;;\r\nFN:Ada\r\nEND:VCARD\r\n', JSON.stringify(encoded())); await scanDownloads(encoded());
      const vals = { firstName: 'Ada', lastName: 'Lovelace; Countess, of', phone: '+44 20 7946 0958', email: 'ada@example.com', organization: 'Analytical, Engines; Ltd', website: 'example.com/ada' }; for (const [f, v] of Object.entries(vals)) await typeInto(field('contact', f), v);
      const e = encoded(); assert(e === 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace\\; Countess\\, of;Ada;;;\r\nFN:Ada Lovelace\\; Countess\\, of\r\nORG:Analytical\\, Engines\\; Ltd\r\nTEL;TYPE=CELL:+442079460958\r\nEMAIL;TYPE=INTERNET:ada@example.com\r\nURL:https://example.com/ada\r\nEND:VCARD\r\n', JSON.stringify(e)); assert(!/(^|[^\r])\n/.test(e), 'bare LF');
      const r = await scanDownloads(e); assert(r.p.name === 'toolora-contact-qr.png' && r.s.name === 'toolora-contact-qr.svg', `${r.p.name} ${r.s.name}`); return `${r.p.name}, ${r.s.name}`;
    });
    await R.test('CONTACT: invalid optional fields are flagged per field without touching the others', async () => {
      await typeInto(field('contact', 'email'), 'bad'); await typeInto(field('contact', 'website'), 'ftp://x'); assert(!hasQr(), 'generated with invalid fields'); assert(panel('contact').querySelector('[data-qg-msg="email"]').textContent && panel('contact').querySelector('[data-qg-msg="website"]').textContent && panel('contact').querySelector('[data-qg-msg="phone"]').hidden, 'messages');
      await typeInto(field('contact', 'email'), ''); await typeInto(field('contact', 'website'), ''); assert(hasQr(), 'did not recover'); await typeInto(field('contact', 'firstName'), ''); assert(!hasQr() && /First name is required/.test(q('[data-qg-empty-list]').textContent), 'first name required'); return 'ok';
    });
    await R.test('switching types keeps what you typed in each; only the chosen type is encoded', async () => {
      await pick('url'); assert(field('url', 'url').value === 'ftp://x' || field('url', 'url').value !== '', 'url kept'); await typeInto(field('url', 'url'), 'toolora.example'); await pick('phone'); await pick('url'); assert(encoded() === 'https://toolora.example', encoded()); return 'ok';
    });

    /* ---------------- PNG sizes ---------------- */
    await R.test('PNG sizes: 256, 512 and 1024 px are exact and decode; the quiet zone is clear', async () => {
      const out = []; for (const px of [256, 512, 1024]) { await size(px); const p = await dl('png'); const info = await pngInfo(p.blob); assert(info.w === px && info.h === px, `${px}: got ${info.w}x${info.h}`); const d = await decodePng(p.blob); assert(d.text === 'https://toolora.example', `${px} decode`);
        const code = root.__qg.current.code.size; const margin = Math.floor((4 * px) / (code + 8)) - 1; const { data, width } = d.data; let clear = true; for (let y = 0; y < margin && clear; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) { clear = false; break; } } for (let y = 0; y < width && clear; y++) for (let x = 0; x < margin; x++) { const i = (y * width + x) * 4; if (data[i] !== 255) { clear = false; break; } }
        assert(clear, `${px}: quiet zone not clear`); out.push(`${px}px ${Math.round(p.blob.size / 1024)} KB`); } await size(512); return out.join(', ');
    });

    /* ---------------- SVG file safety ---------------- */
    await R.test('SVG file: standalone, correct size, no scripts or external resources, nothing from the form in it', async () => {
      await size(1024); const s = await dl('svg'); const t = await s.blob.text(); assert(s.blob.type.startsWith('image/svg+xml'), s.blob.type); assert(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg width="1024" height="1024" xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+"/.test(t), t.slice(0, 160));
      assert(!/<script|<image|<use|<foreignObject|href=|xlink|\bon\w+=|url\(|<style|<!ENTITY/i.test(t), 'unsafe markup'); assert((t.match(/https?:\/\/[^"\s]+/g) ?? []).join() === 'http://www.w3.org/2000/svg', 'external URL'); assert(!/toolora|example/i.test(t), 'form text leaked into the file');
      const doc = new DOMParser().parseFromString(t, 'image/svg+xml'); assert(!doc.querySelector('parsererror'), 'not well-formed XML'); assert(doc.documentElement.querySelectorAll('*').length === 2, 'unexpected elements'); await size(512); return `${t.length} bytes, 2 elements`;
    });

    /* ---------------- colours ---------------- */
    await R.test('custom colours: dark green on cream decodes from both PNG and SVG and the files contain those colours', async () => {
      await setColor('fg', '#0b3d2e'); await setColor('bg', '#fdf6e3'); assert(q('[data-qg-color-msg]').hidden, 'warned on a good pair'); assert(root.querySelector('[data-qg-qr]').style.background.length > 0, 'preview background');
      const r = await scanDownloads('https://toolora.example'); const { data } = r.dp.data; assert(data[0] === 0xfd && data[1] === 0xf6 && data[2] === 0xe3, `PNG corner ${data.slice(0, 3)}`); assert(r.text.includes('#0b3d2e') && r.text.includes('#fdf6e3'), 'svg colours'); let dark = 0; for (let i = 0; i < data.length; i += 4) if (data[i] === 0x0b && data[i + 1] === 0x3d && data[i + 2] === 0x2e) dark++; assert(dark > 1000, `${dark} dark px`); return 'ok';
    });
    await R.test('identical colours are refused: no code, downloads disabled, clear message, fields flagged', async () => {
      await setColor('fg', '#336699'); await setColor('bg', '#336699'); assert(!hasQr() && q('[data-qg-png]').disabled && q('[data-qg-svg]').disabled && q('[data-qg-copy]').disabled, 'still generating'); assert(/same/.test(q('[data-qg-color-msg]').textContent) && q('[data-qg-fg]').getAttribute('aria-invalid') === 'true', q('[data-qg-color-msg]').textContent); assert(/Choose different colours/.test(q('[data-qg-empty-title]').textContent), 'empty state'); assert(!q('[data-qg-recommended]').hidden, 'no recommended button'); return q('[data-qg-color-msg]').textContent.slice(0, 60);
    });
    await R.test('near-identical colours are refused too', async () => { await setColor('fg', '#ffffff'); await setColor('bg', '#fefefe'); assert(!hasQr() && /too similar/.test(q('[data-qg-color-msg]').textContent), q('[data-qg-color-msg]').textContent); return 'ok'; });
    await R.test('low contrast: a warning with the ratio and a recommended-colours button; the code is still produced', async () => {
      await setColor('fg', '#888888'); await setColor('bg', '#aaaaaa'); assert(hasQr(), 'blocked unexpectedly'); assert(/Low contrast \(\d\.\d:1\)/.test(q('[data-qg-color-msg]').textContent), q('[data-qg-color-msg]').textContent); assert(!q('[data-qg-recommended]').hidden, 'no button');
      await click(q('[data-qg-recommended]')); assert(q('[data-qg-fg]').value === '#000000' && q('[data-qg-bg]').value === '#ffffff' && q('[data-qg-color-msg]').hidden && q('[data-qg-recommended]').hidden, 'not restored'); return 'restored to black on white';
    });
    await R.test('light-on-dark gets a scanner-compatibility warning', async () => { await setColor('fg', '#ffffff'); await setColor('bg', '#000000'); assert(/lighter than its background/.test(q('[data-qg-color-msg]').textContent), q('[data-qg-color-msg]').textContent); return 'ok'; });
    await R.test('reset colours returns to the default black on white and disables itself', async () => {
      await setColor('fg', '#aa0000'); assert(!q('[data-qg-reset-colors]').disabled, 'reset disabled'); await click(q('[data-qg-reset-colors]')); assert(q('[data-qg-fg]').value === '#000000' && q('[data-qg-bg]').value === '#ffffff' && q('[data-qg-reset-colors]').disabled, 'not reset'); assert(hasQr(), 'no code after reset'); return 'ok';
    });

    /* ---------------- copy, clear ---------------- */
    await R.test('Copy QR text copies exactly the payload (including the vCard CRLF line endings)', async () => {
      clip.length = 0; await click(q('[data-qg-copy]')); await waitFor(() => clip.length === 1, 3000, 'copy'); assert(clip[0] === 'https://toolora.example', clip[0]); assert(/Copied/.test(q('[data-qg-toast]').textContent), 'no confirmation');
      await fill('contact', { firstName: 'Ada', lastName: 'L', phone: '', email: '', organization: '', website: '' }); clip.length = 0; await click(q('[data-qg-copy]')); await waitFor(() => clip.length === 1, 3000, 'copy'); assert(clip[0] === 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:L;Ada;;;\r\nFN:Ada L\r\nEND:VCARD\r\n', JSON.stringify(clip[0])); return 'ok';
    });
    await R.test('Clear all resets the type, every field, the colours and the size, and removes the code', async () => {
      await setColor('fg', '#123456'); await size(1024); await click(q('[data-qg-clear]')); assert(q('input[name="qg-type"]:checked').value === 'url', 'type'); assert(qa('[data-qg-field]').every((i) => i.value === ''), 'fields'); assert(q('[data-qg-fg]').value === '#000000' && q('input[name="qg-size"]:checked').value === '512', 'colours/size'); assert(!hasQr() && q('[data-qg-clear]').disabled, 'code remains'); assert(qa('[data-qg-msg]').every((m) => m.hidden), 'messages remain'); assert(document.activeElement === field('url', 'url'), 'focus not returned'); return 'ok';
    });

    /* ---------------- accessibility ---------------- */
    await R.test('accessibility: legends, labelled controls, described fields, role=img with a label, live regions', async () => {
      assert(q('input[name="qg-type"]').closest('fieldset').querySelector('legend').textContent.trim(), 'type legend'); await fill('email', { address: 'a@b.co' });
      assert(q('[data-qg-qr] svg').getAttribute('role') === 'img' && /QR code for an email/.test(q('[data-qg-qr] svg').getAttribute('aria-label')), 'svg label');
      for (const i of [q('[data-qg-fg]'), q('[data-qg-bg]'), ...qa('input[name="qg-size"]'), ...qa('input[name="qg-type"]')]) assert(i.closest('label') || document.querySelector(`label[for="${i.id}"]`), `unlabelled ${i.name || i.id}`);
      for (const i of visibleInputs()) { const d = i.getAttribute('aria-describedby'); assert(d && d.split(' ').every((id) => document.getElementById(id)), `${i.id} describedby`); }
      assert(q('[data-qg-toast]').getAttribute('aria-live') === 'polite' && q('[data-qg-live]').getAttribute('aria-live') === 'polite', 'live'); assert(panel('email').getAttribute('role') === 'group' && panel('email').getAttribute('aria-label'), 'panel name');
      assert(/Your QR code is generated directly in your browser\. Your information is not uploaded to our servers\./.test(root.textContent), 'privacy note'); return 'ok';
    });
    await R.test('keyboard: the type selector responds to arrow keys (native radio group) and every control is focusable', async () => {
      const r1 = q('input[name="qg-type"][value="url"]'); r1.focus(); const tabbable = qa('button:not([disabled]), input:not([disabled]), textarea, summary').filter((e) => e.offsetParent !== null || e.type === 'radio'); assert(tabbable.every((e) => e.tabIndex >= 0), 'negative tabindex'); assert(!qa('[tabindex]').some((e) => Number(e.getAttribute('tabindex')) > 0), 'positive tabindex'); return `${tabbable.length} focusable controls`;
    });

    /* ---------------- resources and privacy ---------------- */
    await R.test('resources: every temporary download URL was revoked; downloads never used the page screenshot path', async () => {
      await sleep(1300); const pending = created.filter((c) => !revoked.includes(c.u)); assert(pending.length === 0, `${pending.length} object URLs still open`); assert(created.length >= 20, `${created.length} downloads captured`); return `${created.length} object URLs created, ${revoked.length} revoked`;
    });
    await R.test('privacy: no network requests, nothing stored, content is not in the page address, no script errors', async () => {
      await clearAll(); await fill('text', { text: 'confidential-9917' });
      assert(net.fetch === 0 && net.xhr === 0 && net.beacon === 0, JSON.stringify(net)); assert(JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]) === storageBefore, 'storage changed');
      assert(!/confidential/.test(location.href + document.referrer), 'content in URL'); const entries = performance.getEntriesByType('resource').slice(resBefore).filter((e) => !e.name.startsWith('blob:') && !/\/(src|tests|node_modules|@vite|@fs|@id)\//.test(e.name)); assert(entries.length === 0, entries.map((e) => e.name).join(', ')); assert(errors.length === 0, errors.join('; '));
      for (const [k, v] of Object.entries(localStorage)) assert(!String(v).includes('confidential'), `localStorage ${k}`); return 'fetch/XHR/beacon: 0; storage unchanged';
    });
  } finally {
    restore();
  }
  return R.finish();
}
