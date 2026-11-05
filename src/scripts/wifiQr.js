/**
 * WiFi QR Generator UI controller. Everything runs locally in the browser:
 * the network name and password are never sent anywhere, never stored (no localStorage/sessionStorage,
 * no cookies, no URL parameters) and never logged.
 */
import { buildWifiPayload, validateNetwork, securitySummary } from '../lib/wifiQr.js';
import { makeQr, qrToSvg, drawQrToCanvas } from '../lib/qr.js';
import { downloadBlob } from '../lib/clipboard.js';

const root = document.querySelector('[data-wq]');

if (root) {
  const $ = (s) => root.querySelector(s);
  const form = $('[data-wq-form]');
  const ssidInput = $('[data-wq-ssid]');
  const passInput = $('[data-wq-password]');
  const passField = $('[data-wq-password-field]');
  const passToggle = $('[data-wq-toggle-password]');
  const hiddenInput = $('[data-wq-hidden]');
  const securityRadios = [...root.querySelectorAll('input[name="security"]')];
  const ssidMsg = $('[data-wq-ssid-msg]');
  const passMsg = $('[data-wq-password-msg]');
  const passHelp = $('[data-wq-password-help]');
  const clearBtn = $('[data-wq-clear]');
  const stage = $('[data-wq-stage]');
  const empty = $('[data-wq-empty]');
  const emptyList = $('[data-wq-empty-list]');
  const qrBox = $('[data-wq-qr]');
  const captionWrap = $('[data-wq-caption-wrap]');
  const caption = $('[data-wq-caption]');
  const captionSub = $('[data-wq-caption-sub]');
  const pngBtn = $('[data-wq-png]');
  const svgBtn = $('[data-wq-svg]');
  const printBtn = $('[data-wq-print]');
  const toast = $('[data-wq-toast]');
  const encoded = $('[data-wq-encoded]');
  const encodedWrap = $('[data-wq-encoded-wrap]');
  const liveStatus = $('[data-wq-live]');

  // Fields the user has interacted with; messages for untouched fields stay hidden.
  const touched = { ssid: false, password: false };
  let currentCode = null;

  const security = () => securityRadios.find((r) => r.checked)?.value ?? 'WPA';
  const values = () => ({ ssid: ssidInput.value, password: passInput.value, security: security(), hidden: hiddenInput.checked });

  /* ---------------------------------------------------------------- Messages */

  const showMsg = (el, input, error, warnings) => {
    const parts = [];
    if (error) parts.push({ text: error, kind: 'error' });
    for (const w of warnings) parts.push({ text: w, kind: 'warn' });
    el.replaceChildren(
      ...parts.map((p) => {
        const li = document.createElement('li');
        li.textContent = p.text;
        li.dataset.kind = p.kind;
        return li;
      })
    );
    el.hidden = parts.length === 0;
    input.setAttribute('aria-invalid', error ? 'true' : 'false');
  };

  /* ----------------------------------------------------------------- Preview */

  const hideQr = () => {
    currentCode = null;
    qrBox.replaceChildren();
    qrBox.hidden = true;
    captionWrap.hidden = true;
    stage.dataset.state = 'empty';
    empty.hidden = false;
    for (const b of [pngBtn, svgBtn, printBtn]) b.disabled = true;
    encodedWrap.hidden = true;
  };

  const setMissingList = (items) => {
    emptyList.replaceChildren(
      ...items.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      })
    );
    emptyList.hidden = items.length === 0;
  };

  /** Payload for display only: the password is masked unless the user chose to reveal it. */
  const displayPayload = (v) => {
    const shown = passInput.type === 'text' ? v.password : '•'.repeat(Math.min(v.password.length, 12));
    return buildWifiPayload({ ...v, password: shown });
  };

  let updateQueued = false;
  const scheduleUpdate = () => {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(() => {
      updateQueued = false;
      update();
    });
  };

  function update() {
    const v = values();
    const open = v.security === 'nopass';

    // Open network: the password field is disabled and nothing is encoded for it.
    passInput.disabled = open;
    passField.dataset.disabled = String(open);
    passToggle.disabled = open;
    passHelp.textContent = open ? 'Not needed for an open network.' : 'Shown only on this page. It is never saved or sent anywhere.';

    const result = validateNetwork(v);
    showMsg(ssidMsg, ssidInput, touched.ssid ? result.errors.ssid : null, result.warnings.ssid);
    showMsg(passMsg, passInput, !open && touched.password ? result.errors.password : null, open ? [] : result.warnings.password);
    clearBtn.disabled = !v.ssid && !v.password && !v.hidden && v.security === 'WPA';

    if (!result.valid) {
      hideQr();
      setMissingList([result.errors.ssid, result.errors.password].filter(Boolean));
      liveStatus.textContent = '';
      return;
    }

    let code;
    try {
      code = makeQr(buildWifiPayload(v), 'M');
    } catch {
      hideQr();
      setMissingList([]);
      empty.querySelector('[data-wq-empty-title]').textContent = 'Too much text for one QR code';
      return;
    }
    empty.querySelector('[data-wq-empty-title]').textContent = 'Your QR code appears here';
    setMissingList([]);
    currentCode = code;
    qrBox.innerHTML = qrToSvg(code, { xmlns: false }); // markup is numbers only; no user text is inserted
    const svg = qrBox.querySelector('svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code for joining the WiFi network you entered');
    qrBox.hidden = false;
    empty.hidden = true;
    stage.dataset.state = 'ready';
    captionWrap.hidden = false;
    caption.textContent = v.ssid; // textContent: never parsed as HTML
    captionSub.textContent = securitySummary(v);
    for (const b of [pngBtn, svgBtn, printBtn]) b.disabled = false;
    encoded.textContent = displayPayload(v);
    encodedWrap.hidden = false;
    liveStatus.textContent = 'QR code ready.';
  }

  /* ---------------------------------------------------------------- Events */

  ssidInput.addEventListener('input', () => { touched.ssid = true; scheduleUpdate(); });
  ssidInput.addEventListener('blur', () => { touched.ssid = true; scheduleUpdate(); });
  passInput.addEventListener('input', () => { touched.password = true; scheduleUpdate(); });
  passInput.addEventListener('blur', () => { if (!passInput.disabled) touched.password = true; scheduleUpdate(); });
  hiddenInput.addEventListener('change', scheduleUpdate);
  securityRadios.forEach((r) => r.addEventListener('change', scheduleUpdate));
  form.addEventListener('submit', (e) => e.preventDefault());

  passToggle.addEventListener('click', () => {
    const show = passInput.type === 'password';
    passInput.type = show ? 'text' : 'password';
    passToggle.setAttribute('aria-pressed', String(show));
    passToggle.textContent = show ? 'Hide' : 'Show';
    passToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    scheduleUpdate(); // refreshes the masked/unmasked encoded text
  });

  clearBtn.addEventListener('click', () => {
    form.reset(); // restores defaults: empty fields, WPA, not hidden
    passInput.type = 'password';
    passToggle.setAttribute('aria-pressed', 'false');
    passToggle.textContent = 'Show';
    passToggle.setAttribute('aria-label', 'Show password');
    touched.ssid = touched.password = false;
    update();
    say('Cleared the form.');
    ssidInput.focus();
  });

  /* ------------------------------------------------------------- Feedback */

  let toastTimer;
  const say = (message, kind = 'ok', ms = 3500) => {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.kind = kind;
    if (ms) toastTimer = window.setTimeout(() => { toast.textContent = ''; delete toast.dataset.kind; }, ms);
  };

  /* ------------------------------------------------------------- Downloads */

  pngBtn.addEventListener('click', () => {
    if (!currentCode) return;
    const canvas = document.createElement('canvas');
    const px = drawQrToCanvas(currentCode, canvas, 1024);
    canvas.toBlob((blob) => {
      if (!blob) return say('Couldn’t create the image in this browser.', 'bad', 7000);
      downloadBlob(blob, 'wifi-qr-code.png');
      say(`Downloaded wifi-qr-code.png (${px} × ${px} px).`);
    }, 'image/png');
  });

  svgBtn.addEventListener('click', () => {
    if (!currentCode) return;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${qrToSvg(currentCode)}\n`;
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'wifi-qr-code.svg');
    say('Downloaded wifi-qr-code.svg.');
  });

  // Print: build a one-page sheet (QR + network name, never the password), print it, then remove it.
  printBtn.addEventListener('click', () => {
    if (!currentCode) return;
    const sheet = document.createElement('div');
    sheet.className = 'wq-print-sheet';
    const lead = document.createElement('p');
    lead.className = 'ps-lead';
    lead.textContent = 'Scan with your phone’s camera to join this WiFi network';
    const qr = document.createElement('div');
    qr.className = 'ps-qr';
    qr.innerHTML = qrToSvg(currentCode, { xmlns: false }); // numbers only
    const name = document.createElement('p');
    name.className = 'ps-name';
    name.textContent = caption.textContent;
    const sub = document.createElement('p');
    sub.className = 'ps-sub';
    sub.textContent = captionSub.textContent;
    sheet.append(lead, qr, name, sub);
    document.body.appendChild(sheet);
    document.documentElement.classList.add('wq-printing');

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('afterprint', cleanup);
      document.documentElement.classList.remove('wq-printing');
      sheet.remove();
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(cleanup, 120000); // safety net for browsers that never fire afterprint
    window.print();
  });

  /* ------------------------------------------------------------------ Init */

  hideQr();
  update();
}
