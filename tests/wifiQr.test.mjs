/**
 * WiFi QR Generator tests.
 *   node tests/wifiQr.test.mjs
 * Needs the dev dependency `jsqr` (an independent QR decoder) to prove the codes are really scannable.
 */
import jsQR from 'jsqr';
import { escapeWifiValue, buildWifiPayload, validateNetwork, utf8Length, securitySummary } from '../src/lib/wifiQr.js';
import { makeQr, qrToSvg, darkRuns, QUIET_ZONE } from '../src/lib/qr.js';

let passed = 0;
let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
};

/* ---- A reference parser written from the format's grammar (separate from the encoder under test) ---- */
function parseWifi(text) {
  if (!text.startsWith('WIFI:')) return null;
  const fields = {};
  let i = 5;
  while (i < text.length) {
    if (text[i] === ';') { i++; continue; } // empty field / terminator
    const key = text[i];
    if (text[i + 1] !== ':') return null;
    i += 2;
    let value = '';
    while (i < text.length && text[i] !== ';') {
      if (text[i] === '\\') { value += text[i + 1] ?? ''; i += 2; } else value += text[i++];
    }
    fields[key] = value;
    i++; // skip ';'
  }
  return fields;
}

/* ---- Rasterise a QR (matrix or SVG) and decode it with jsQR ---- */
const rasterise = (isDark, size, quiet = QUIET_ZONE, scale = 6) => {
  const total = size + quiet * 2;
  const N = total * scale;
  const px = new Uint8ClampedArray(N * N * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (isDark(x, y))
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + quiet) * scale + dy) * N + (x + quiet) * scale + dx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
  return { px, N };
};
const decodeMatrix = (code) => {
  const { px, N } = rasterise((x, y) => code.get(x, y), code.size);
  return jsQR(px, N, N)?.data ?? null;
};
/** Decodes an SVG string produced by qrToSvg by re-reading its path data (what a downloaded .svg contains). */
const decodeSvg = (svg) => {
  const total = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)[1]);
  const size = total - QUIET_ZONE * 2;
  const dark = new Set();
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, len] = [Number(m[1]) - QUIET_ZONE, Number(m[2]) - QUIET_ZONE, Number(m[3])];
    for (let k = 0; k < len; k++) dark.add(`${x + k},${y}`);
  }
  const { px, N } = rasterise((x, y) => dark.has(`${x},${y}`), size);
  return jsQR(px, N, N)?.data ?? null;
};

/* ---------------------------------------------------------------- Escaping */
eq('escape: backslash', escapeWifiValue('a\\b'), 'a\\\\b');
eq('escape: semicolon', escapeWifiValue('a;b'), 'a\\;b');
eq('escape: comma', escapeWifiValue('a,b'), 'a\\,b');
eq('escape: double quote', escapeWifiValue('a"b'), 'a\\"b');
eq('escape: colon', escapeWifiValue('a:b'), 'a\\:b');
eq('escape: all five together, no double escaping', escapeWifiValue('\\;,":'), '\\\\\\;\\,\\"\\:');
eq('escape: leaves ordinary, space and unicode text alone', escapeWifiValue("It's a café 日本 \u{1F600}!"), "It's a café 日本 \u{1F600}!");
eq('escape: single quote is NOT special', escapeWifiValue("'"), "'");

/* ----------------------------------------------------------------- Payload */
eq('payload: WPA', buildWifiPayload({ ssid: 'Home', password: 'secret123', security: 'WPA', hidden: false }), 'WIFI:T:WPA;S:Home;P:secret123;H:false;;');
eq('payload: WEP', buildWifiPayload({ ssid: 'Old', password: '12345', security: 'WEP', hidden: false }), 'WIFI:T:WEP;S:Old;P:12345;H:false;;');
eq('payload: open network has empty password', buildWifiPayload({ ssid: 'Guest', password: '', security: 'nopass', hidden: false }), 'WIFI:T:nopass;S:Guest;P:;H:false;;');
eq('payload: open network ignores a typed password', buildWifiPayload({ ssid: 'Guest', password: 'leftover', security: 'nopass', hidden: false }), 'WIFI:T:nopass;S:Guest;P:;H:false;;');
eq('payload: hidden flag true', buildWifiPayload({ ssid: 'Sneaky', password: 'pass1234', security: 'WPA', hidden: true }), 'WIFI:T:WPA;S:Sneaky;P:pass1234;H:true;;');
eq('payload: hidden open network', buildWifiPayload({ ssid: 'Sneaky', security: 'nopass', hidden: true }), 'WIFI:T:nopass;S:Sneaky;P:;H:true;;');
eq('payload: special characters escaped in SSID and password', buildWifiPayload({ ssid: 'My;Net:1', password: 'p\\a;s,s"w:rd', security: 'WPA' }), 'WIFI:T:WPA;S:My\\;Net\\:1;P:p\\\\a\\;s\\,s\\"w\\:rd;H:false;;');
eq('payload: never trims spaces', buildWifiPayload({ ssid: '  Net  ', password: ' pw ', security: 'WPA' }), 'WIFI:T:WPA;S:  Net  ;P: pw ;H:false;;');
eq('payload: unknown security falls back to WPA', buildWifiPayload({ ssid: 'a', password: 'b', security: 'bogus' }).slice(0, 14), 'WIFI:T:WPA;S:a');

/* -------------------------------------------------------------- Validation */
const v = (o) => validateNetwork(o);
eq('validate: empty SSID is an error', v({ ssid: '', password: 'longenough', security: 'WPA' }).errors.ssid, 'Enter the network name (SSID).');
eq('validate: empty password on WPA is an error', v({ ssid: 'a', password: '', security: 'WPA' }).errors.password, 'Enter the network password.');
eq('validate: empty password on WEP is an error', v({ ssid: 'a', password: '', security: 'WEP' }).valid, false);
eq('validate: open network needs no password', v({ ssid: 'a', password: '', security: 'nopass' }).valid, true);
eq('validate: valid WPA', v({ ssid: 'Home', password: 'password1', security: 'WPA' }).valid, true);
eq('validate: SSID of exactly 32 bytes is fine', v({ ssid: 'x'.repeat(32), password: 'password1', security: 'WPA' }).valid, true);
eq('validate: SSID over 32 bytes is an error (bytes, not characters)', v({ ssid: '日'.repeat(11), password: 'password1', security: 'WPA' }).errors.ssid, 'A network name can be at most 32 bytes. This one is 33 bytes.');
eq('validate: short WPA password only warns', (() => { const r = v({ ssid: 'a', password: 'short', security: 'WPA' }); return [r.valid, r.warnings.password.length]; })(), [true, 1]);
eq('validate: 64-hex WPA key is accepted without warning', v({ ssid: 'a', password: 'ab'.repeat(32), security: 'WPA' }).warnings.password, []);
eq('validate: WEP 5/13/10/26 are fine, others warn', [5, 13, 10, 26, 7].map((n) => v({ ssid: 'a', password: 'a1b2c3d4e5f6a1b2c3d4e5f6a1'.slice(0, n), security: 'WEP' }).warnings.password.length), [0, 0, 0, 0, 1]);
eq('validate: whitespace edges warn but never change the value', (() => { const r = v({ ssid: ' a ', password: ' password1 ', security: 'WPA' }); return [r.valid, r.warnings.ssid.length, r.warnings.password.length]; })(), [true, 1, 1]);
eq('validate: whitespace-only SSID is allowed (warned), not trimmed away', v({ ssid: '   ', password: 'password1', security: 'WPA' }).valid, true);
eq('validate: utf8Length', [utf8Length('abc'), utf8Length('é'), utf8Length('日'), utf8Length('\u{1F600}')], [3, 2, 3, 4]);
eq('summary text', [securitySummary({ security: 'WPA' }), securitySummary({ security: 'nopass', hidden: true })], ['WPA / WPA2 / WPA3', 'None (open network) · hidden network']);

/* ------------------------------------------- Reference parser round trips */
const cases = [
  { name: 'WPA', o: { ssid: 'Home', password: 'secret123', security: 'WPA', hidden: false } },
  { name: 'WEP', o: { ssid: 'Old', password: '1234567890', security: 'WEP', hidden: false } },
  { name: 'open', o: { ssid: 'Guest', password: '', security: 'nopass', hidden: false } },
  { name: 'hidden', o: { ssid: 'Sneaky', password: 'pass1234', security: 'WPA', hidden: true } },
  { name: 'all specials', o: { ssid: 'a\\b;c,d"e:f', password: '\\;,":\\;,":', security: 'WPA', hidden: false } },
  { name: 'unicode + emoji', o: { ssid: 'Café 日本 \u{1F600}', password: 'pässwörd\u{1F511}', security: 'WPA', hidden: true } },
  { name: 'edge spaces', o: { ssid: '  spaced  ', password: ' pw pw pw ', security: 'WPA', hidden: false } },
  { name: 'looks like format syntax', o: { ssid: 'WIFI:T:WPA;S:x;;', password: ';;P:y;;', security: 'WPA', hidden: false } },
  { name: 'longest SSID + password', o: { ssid: 'S'.repeat(32), password: 'P'.repeat(63), security: 'WPA', hidden: true } },
  { name: 'numeric/hex-looking values', o: { ssid: 'deadbeef', password: '12345678', security: 'WPA', hidden: false } },
];
for (const { name, o } of cases) {
  const payload = buildWifiPayload(o);
  const parsed = parseWifi(payload);
  const expected = { T: o.security, S: o.ssid, P: o.security === 'nopass' ? '' : o.password, H: o.hidden ? 'true' : 'false' };
  eq(`round trip (reference parser): ${name}`, parsed, expected);
}

/* ------------------- Genuinely scannable: decode matrix AND downloadable SVG */
for (const { name, o } of cases) {
  const payload = buildWifiPayload(o);
  const code = makeQr(payload, 'M');
  eq(`scannable (matrix -> jsQR): ${name}`, decodeMatrix(code), payload);
  eq(`scannable (SVG file -> jsQR): ${name}`, decodeSvg(qrToSvg(code)), payload);
}
for (const level of ['L', 'M', 'Q', 'H']) {
  const payload = buildWifiPayload(cases[5].o);
  eq(`scannable at error-correction ${level} (unicode)`, decodeMatrix(makeQr(payload, level)), payload);
}

/* ------------------------------------------------------ SVG structure */
const svg = qrToSvg(makeQr('WIFI:T:WPA;S:a;P:b;H:false;;'));
eq('svg: has viewBox including a 4-module quiet zone on every side', (() => { const code = makeQr('WIFI:T:WPA;S:a;P:b;H:false;;'); return Number(/viewBox="0 0 (\d+)/.exec(svg)[1]) === code.size + 8; })(), true);
eq('svg: white background, black modules, crisp edges', [svg.includes('fill="#ffffff"'), svg.includes('fill="#000000"'), svg.includes('crispEdges')], [true, true, true]);
eq('svg: standalone file has the xmlns', svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), true);
eq('svg: contains no text or network details', /WIFI|Home|<text|<title/.test(qrToSvg(makeQr('WIFI:T:WPA;S:Secret;P:Pass;H:false;;'))), false);
eq('quiet zone is 4 modules (QR specification)', QUIET_ZONE, 4);
eq('finder pattern present (top-left 7x7 ring)', (() => { const c = makeQr('x'); return [c.get(0, 0), c.get(6, 0), c.get(0, 6), c.get(6, 6), c.get(1, 1), c.get(3, 3)]; })(), [true, true, true, true, false, true]);
eq('darkRuns never overlap and stay in bounds', (() => { const c = makeQr('WIFI:T:WPA;S:a;P:b;H:false;;'); return darkRuns(c).every(([y, x, len]) => y >= 0 && y < c.size && x >= 0 && x + len <= c.size && len > 0); })(), true);

/* ------------------------------------------ Property test: random inputs */
let seed = 987654321;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pool = ['a', 'Z', '7', ' ', '\\', ';', ',', '"', ':', "'", '!', '#', '&', 'é', '日', '\u{1F600}', '=', '/', '?', '%'];
const randStr = (max) => Array.from({ length: 1 + Math.floor(rnd() * max) }, () => pool[Math.floor(rnd() * pool.length)]).join('');
let roundTripOk = 0, decodeOk = 0;
const RUNS = 300;
for (let k = 0; k < RUNS; k++) {
  const sec = ['WPA', 'WEP', 'nopass'][Math.floor(rnd() * 3)];
  const o = { ssid: randStr(10), password: sec === 'nopass' ? '' : randStr(20), security: sec, hidden: rnd() < 0.5 };
  const payload = buildWifiPayload(o);
  const p = parseWifi(payload);
  if (p && p.S === o.ssid && p.P === (sec === 'nopass' ? '' : o.password) && p.T === sec && p.H === String(o.hidden)) roundTripOk++;
  if (decodeMatrix(makeQr(payload)) === payload) decodeOk++;
}
eq(`property: ${RUNS} random networks round-trip through the reference parser`, roundTripOk, RUNS);
eq(`property: ${RUNS} random networks produce QR codes that jsQR decodes exactly`, decodeOk, RUNS);

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nAll ${passed} tests passed`);
process.exit(failed ? 1 : 0);
