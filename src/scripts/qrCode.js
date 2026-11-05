/**
 * General QR Code Generator UI controller. Everything runs locally in the browser: what you type is never sent
 * anywhere, never stored (no localStorage / sessionStorage / cookies / URL parameters) and never logged.
 *
 * QR matrix + SVG writer come from src/lib/qr.js (shared with the WiFi QR Generator); payloads, validation and colour
 * checks from src/lib/qrPayload.js; exact-size PNG / SVG output from src/lib/qrExport.js.
 */
import {
  QR_TYPES, MAX_PAYLOAD_BYTES, RECOMMENDED_COLORS, DEFAULT_SIZE, buildQr, assessColors, parseHex, qrFilename, utf8Length,
} from '../lib/qrPayload.js';
import { makeQr, qrToSvg } from '../lib/qr.js';
import { drawQr, svgDocument, modulePixels, MIN_MODULE_PX } from '../lib/qrExport.js';
import { copyText, downloadBlob } from '../lib/clipboard.js';

const root = document.querySelector('[data-qg]');

if (root) {
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const el = {
    form: $('[data-qg-form]'), typeRadios: $$('input[name="qg-type"]'), panels: $$('[data-qg-panel]'),
    fg: $('[data-qg-fg]'), bg: $('[data-qg-bg]'), fgOut: $('[data-qg-fg-out]'), bgOut: $('[data-qg-bg-out]'), colorMsg: $('[data-qg-color-msg]'),
    useRecommended: $('[data-qg-recommended]'), resetColors: $('[data-qg-reset-colors]'), sizeRadios: $$('input[name="qg-size"]'),
    clear: $('[data-qg-clear]'), counter: $('[data-qg-counter]'),
    stage: $('[data-qg-stage]'), empty: $('[data-qg-empty]'), emptyTitle: $('[data-qg-empty-title]'), emptyText: $('[data-qg-empty-text]'), emptyList: $('[data-qg-empty-list]'),
    qr: $('[data-qg-qr]'), cap: $('[data-qg-caption-wrap]'), capName: $('[data-qg-caption]'), capSub: $('[data-qg-caption-sub]'), notes: $('[data-qg-notes]'),
    png: $('[data-qg-png]'), svg: $('[data-qg-svg]'), copy: $('[data-qg-copy]'), toast: $('[data-qg-toast]'), live: $('[data-qg-live]'),
    encodedWrap: $('[data-qg-encoded-wrap]'), encoded: $('[data-qg-encoded]'),
  };

  let current = null; // { code, payload, type, colors }
  const state = { type: 'url' };
  root.__qg = { get current() { return current; }, state }; // read-only handle for the automated browser tests

  const typeInfo = (id) => QR_TYPES.find((t) => t.id === id);
  const selectedType = () => el.typeRadios.find((r) => r.checked)?.value ?? 'url';
  const selectedSize = () => Number(el.sizeRadios.find((r) => r.checked)?.value ?? DEFAULT_SIZE);
  const colors = () => ({ fg: parseHex(el.fg.value) ?? RECOMMENDED_COLORS.fg, bg: parseHex(el.bg.value) ?? RECOMMENDED_COLORS.bg });
  const activePanel = (type) => el.panels.find((p) => p.dataset.qgPanel === type);

  function readFields(type) {
    const fields = {};
    for (const input of activePanel(type).querySelectorAll('[data-qg-field]')) fields[input.dataset.qgField] = input.value;
    return fields;
  }

  /* ---------------------------------------------------------------- Messages */
  const say = (() => {
    let timer;
    return (message, kind = 'ok', ms = 3500) => {
      window.clearTimeout(timer);
      el.toast.textContent = message;
      el.toast.dataset.kind = kind;
      if (ms) timer = window.setTimeout(() => { el.toast.textContent = ''; delete el.toast.dataset.kind; }, ms);
    };
  })();

  function showFieldErrors(type, errors) {
    for (const input of activePanel(type).querySelectorAll('[data-qg-field]')) {
      const msg = activePanel(type).querySelector(`[data-qg-msg="${input.dataset.qgField}"]`);
      const text = errors[input.dataset.qgField] ?? '';
      if (msg) { msg.textContent = text; msg.hidden = !text; }
      input.setAttribute('aria-invalid', text ? 'true' : 'false');
    }
  }

  const labelOf = (type, field) => activePanel(type).querySelector(`[data-qg-field="${field}"]`)?.dataset.qgLabel ?? field;

  /* ----------------------------------------------------------------- Preview */
  function hideQr(title, text, list = []) {
    current = null;
    el.qr.replaceChildren();
    el.qr.hidden = true;
    el.cap.hidden = true;
    el.stage.dataset.state = 'empty';
    el.empty.hidden = false;
    el.emptyTitle.textContent = title;
    el.emptyText.textContent = text;
    el.emptyList.replaceChildren(...list.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    el.emptyList.hidden = list.length === 0;
    for (const b of [el.png, el.svg, el.copy]) b.disabled = true;
    el.encodedWrap.hidden = true;
    el.encodedWrap.open = false;
  }

  function showNotes(lines) {
    el.notes.replaceChildren(...lines.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    el.notes.hidden = lines.length === 0;
  }

  let queued = false;
  const scheduleUpdate = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; update(); }); // coalesces input + change events; no frame timing needed
  };

  function update() {
    const type = selectedType();
    state.type = type;
    for (const p of el.panels) p.hidden = p.dataset.qgPanel !== type;

    const c = colors();
    el.fgOut.textContent = c.fg.toUpperCase();
    el.bgOut.textContent = c.bg.toUpperCase();
    const a = assessColors(c.fg, c.bg);
    const isDefault = c.fg === RECOMMENDED_COLORS.fg && c.bg === RECOMMENDED_COLORS.bg;
    el.resetColors.disabled = isDefault;
    el.colorMsg.replaceChildren(...a.messages.map((t) => Object.assign(document.createElement('li'), { textContent: t, className: a.level === 'blocked' ? 'is-error' : '' })));
    el.colorMsg.hidden = a.messages.length === 0;
    el.useRecommended.hidden = a.level === 'ok';
    for (const input of [el.fg, el.bg]) input.setAttribute('aria-invalid', a.level === 'blocked' ? 'true' : 'false');

    const fields = readFields(type);
    const result = buildQr(type, fields);
    showFieldErrors(type, result.errors);

    // Live byte counter for the free-text types.
    const counted = type === 'text' ? utf8Length(fields.text ?? '') : null;
    el.counter.hidden = type !== 'text';
    if (counted !== null) {
      el.counter.textContent = `${counted.toLocaleString('en-US')} of ${MAX_PAYLOAD_BYTES.toLocaleString('en-US')} bytes (about ${MAX_PAYLOAD_BYTES.toLocaleString('en-US')} Latin characters; fewer for emoji and non-Latin text)`;
      el.counter.dataset.over = String(counted > MAX_PAYLOAD_BYTES);
    }
    el.clear.disabled = $$('[data-qg-field]').every((i) => !i.value) && type === 'url' && isDefault && selectedSize() === DEFAULT_SIZE;

    if (!result.valid) {
      const blocking = Object.values(result.errors);
      const missing = result.missing.map((f) => labelOf(type, f));
      if (a.level === 'blocked' && !blocking.length && !missing.length) {
        hideQr('Choose different colours', a.messages[0] ?? '');
      } else if (blocking.length) {
        hideQr('Fix the highlighted field', 'The QR code appears as soon as the details are valid.');
      } else {
        hideQr('Your QR code appears here', `Enter ${typeInfo(type).noun === 'plain text' ? 'some text' : 'the details'} and the code is created instantly, right on this page.`, missing.map((m) => `${m} is required`));
      }
      showNotes([]);
      el.live.textContent = '';
      return;
    }
    if (a.level === 'blocked') {
      hideQr('Choose different colours', a.messages[0] ?? '');
      showNotes([]);
      return;
    }

    let code;
    try {
      code = makeQr(result.payload, 'M');
    } catch {
      hideQr('Too much data for one QR code', 'Shorten what you entered.');
      showNotes([]);
      return;
    }
    current = { code, payload: result.payload, type, colors: c };
    el.qr.innerHTML = qrToSvg(code, { xmlns: false, dark: c.fg, light: c.bg }); // markup is numbers and validated colours only
    const svg = el.qr.querySelector('svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `QR code for ${typeInfo(type).noun}`);
    el.qr.style.background = c.bg;
    el.qr.hidden = false;
    el.empty.hidden = true;
    el.stage.dataset.state = 'ready';
    el.cap.hidden = false;
    el.capName.textContent = `${typeInfo(type).label} QR code`;
    const size = selectedSize();
    el.capSub.textContent = `Downloads at ${size} × ${size} px`;
    for (const b of [el.png, el.svg, el.copy]) b.disabled = false;
    el.encoded.textContent = result.payload;
    el.encodedWrap.hidden = false;

    const notes = [...result.warnings, ...(a.level === 'warn' ? [] : [])];
    if (modulePixels(code, size) < MIN_MODULE_PX) notes.push(`At ${size} px each square is under ${MIN_MODULE_PX} px, which is hard for cameras to read. Choose a larger download size.`);
    showNotes(notes);
    el.live.textContent = 'QR code ready.';
  }

  /* ------------------------------------------------------------------ Events */
  el.form.addEventListener('input', scheduleUpdate);
  el.form.addEventListener('change', scheduleUpdate);
  el.form.addEventListener('submit', (e) => e.preventDefault());

  const setColors = (c) => { el.fg.value = c.fg; el.bg.value = c.bg; };
  el.useRecommended.addEventListener('click', () => { setColors(RECOMMENDED_COLORS); update(); say('Restored the recommended colours: black on white.'); });
  el.resetColors.addEventListener('click', () => { setColors(RECOMMENDED_COLORS); update(); say('Colours reset to black on white.'); });

  el.clear.addEventListener('click', () => {
    el.form.reset(); // empty fields, Website type, default colours and size
    update();
    say('Cleared the form.');
    activePanel('url').querySelector('[data-qg-field]').focus();
  });

  /* --------------------------------------------------------------- Downloads */
  el.png.addEventListener('click', () => {
    if (!current) return;
    const size = selectedSize();
    const canvas = document.createElement('canvas');
    drawQr(current.code, canvas, size, current.colors);
    const name = qrFilename(current.type, 'png');
    canvas.toBlob((blob) => {
      canvas.width = canvas.height = 0; // release the pixel buffer
      if (!blob) return say('Couldn’t create the image in this browser.', 'bad', 7000);
      downloadBlob(blob, name);
      say(`Downloaded ${name} (${size} × ${size} px).`);
    }, 'image/png');
  });

  el.svg.addEventListener('click', () => {
    if (!current) return;
    const size = selectedSize();
    const name = qrFilename(current.type, 'svg');
    downloadBlob(new Blob([svgDocument(current.code, size, current.colors)], { type: 'image/svg+xml;charset=utf-8' }), name);
    say(`Downloaded ${name}.`);
  });

  el.copy.addEventListener('click', async () => {
    if (!current) return;
    const ok = await copyText(current.payload);
    say(ok ? 'Copied the text the QR code contains.' : 'Couldn’t copy automatically. Open “Show the encoded text” and copy it from there.', ok ? 'ok' : 'bad', ok ? 3500 : 7000);
  });

  /* -------------------------------------------------------------------- Init */
  update();
}
