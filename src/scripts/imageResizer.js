/**
 * Image Resizer UI controller. Everything runs locally in the browser: images are read from disk by the browser,
 * resized on a canvas and offered back as downloads. Nothing is uploaded, stored (no localStorage / sessionStorage
 * / cookies) or logged.
 *
 * Shares its libraries (file checks, limits, naming, ZIP, decoding) with the Image Compressor but not its UI code.
 */
import {
  IMAGE_TYPES, HEAD_BYTES, MAX_PIXELS, checkImageFile, fileKey, resolveOutputType, needsBackground, normalizeHexColor,
  formatBytes, compareSizes, describeSizeChange, summarizeBatch, formatDimensions,
} from '../lib/imageCompressor.js';
import {
  parseDimension, parsePercent, computeTarget, pairedDimension,
  buildResizedName, resizeSignature,
} from '../lib/imageResizer.js';
import { probeEncoders, decodeImage, makeThumbnail, hasTransparency, yieldToBrowser } from '../lib/imageCodec.js';
import { resizeFile } from '../lib/imageResizeCodec.js';
import { createZip } from '../lib/zip.js';
import { downloadBlob } from '../lib/clipboard.js';

const root = document.querySelector('[data-ir]');

if (root) {
  const MAX_IMAGES = 100; // keeps the number of results held in memory sensible
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const el = {
    drop: $('[data-ir-drop]'), input: $('[data-ir-input]'), browse: $('[data-ir-browse]'), notes: $('[data-ir-notes]'),
    modes: $$('input[name="ir-mode"]'), panels: { custom: $('[data-ir-panel-custom]'), percent: $('[data-ir-panel-percent]'), preset: $('[data-ir-panel-preset]') },
    width: $('[data-ir-width]'), height: $('[data-ir-height]'), widthMsg: $('[data-ir-width-msg]'), heightMsg: $('[data-ir-height-msg]'),
    lock: $('[data-ir-lock]'), lockNote: $('[data-ir-lock-note]'),
    percents: $$('input[name="ir-percent"]'), percentCustom: $('[data-ir-percent-custom]'), percentMsg: $('[data-ir-percent-msg]'),
    presets: $$('input[name="ir-size"]'), enlarge: $('[data-ir-keep-small]'),
    formats: $$('input[name="ir-format"]'), formatNote: $('[data-ir-format-note]'), bgField: $('[data-ir-bg-field]'), bg: $('[data-ir-bg]'), bgOut: $('[data-ir-bg-out]'),
    list: $('[data-ir-list]'), empty: $('[data-ir-empty]'), count: $('[data-ir-count]'), summary: $('[data-ir-summary]'),
    runAll: $('[data-ir-run-all]'), cancel: $('[data-ir-cancel]'), downloadAll: $('[data-ir-download-all]'), clearAll: $('[data-ir-clear-all]'),
    actions: $('[data-ir-toolbar-actions]'), confirm: $('[data-ir-confirm]'), confirmYes: $('[data-ir-confirm-yes]'), confirmNo: $('[data-ir-confirm-no]'),
    progress: $('[data-ir-progress]'), bar: $('[data-ir-bar]'), barFill: $('[data-ir-bar-fill]'), progressText: $('[data-ir-progress-text]'),
    live: $('[data-ir-live]'), toast: $('[data-ir-toast]'), tpl: $('[data-ir-template]'),
  };

  /* ---------------------------------------------------------------- State */
  const settings = {
    mode: 'custom',
    custom: { width: null, height: null, lock: true, driver: 'width' },
    percent: 50, percentText: '50',
    preset: '1920x1080', allowEnlarge: false, // "don't enlarge" is on by default
    format: 'original', background: '#ffffff',
  };
  const items = [];
  const keys = new Set();
  let seq = 0;
  let running = false;
  let cancelRequested = false;
  let comparing = null;
  const openUrls = new Set();
  const makeUrl = (blob) => { const u = URL.createObjectURL(blob); openUrls.add(u); return u; };
  const dropUrl = (u) => { if (openUrls.delete(u)) URL.revokeObjectURL(u); };
  root.__ir = { items, openUrls, settings }; // read-only handles for the automated browser tests

  const typeLabel = (t) => IMAGE_TYPES[t]?.label ?? 'image';
  const usable = (i) => i.status !== 'rejected' && i.status !== 'checking';
  const outTypeFor = (i) => resolveOutputType(i.type, settings.format);
  const view = () => ({ mode: settings.mode, custom: settings.custom, percent: settings.percent, preset: settings.preset, allowEnlarge: settings.allowEnlarge });
  const planFor = (i) => (usable(i) ? computeTarget(i, view()) : { ok: false, code: 'unusable', message: '' });
  const sigFor = (i) => { const t = planFor(i); return t.ok ? resizeSignature({ target: t, outputType: outTypeFor(i), background: settings.background, needsBg: needsBackground(i.hasAlpha, outTypeFor(i)) }) : null; };
  const isStale = (i) => Boolean(i.result) && i.result.signature !== sigFor(i);
  const reference = () => items.find((i) => usable(i) && i.width) ?? null;

  function nameMap() {
    const taken = new Set();
    const map = new Map();
    for (const i of items) if (i.result) map.set(i.id, buildResizedName(i.name, i.result.actualType, i.result.width, i.result.height, taken));
    return map;
  }

  /* ------------------------------------------------------------ Messages */
  let toastTimer;
  const say = (message, kind = 'ok', ms = 4500) => {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.dataset.kind = kind;
    if (ms) toastTimer = window.setTimeout(() => { el.toast.textContent = ''; delete el.toast.dataset.kind; }, ms);
  };
  const note = (lines) => {
    el.notes.replaceChildren(...lines.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
    el.notes.hidden = lines.length === 0;
  };
  const setMsg = (node, input, text) => { node.textContent = text; node.hidden = !text; input.setAttribute('aria-invalid', text ? 'true' : 'false'); };

  /* ------------------------------------------------------------ Settings UI */
  function syncPairedField() {
    const c = settings.custom;
    if (!c.lock) return;
    const other = c.driver === 'height' ? el.width : el.height;
    const drv = c.driver === 'height' ? c.height : c.width;
    const ref = reference();
    const paired = ref && drv ? pairedDimension(ref, c.driver, drv) : null;
    other.value = paired ? String(paired) : '';
    other.placeholder = ref ? '' : 'automatic';
    setMsg(c.driver === 'height' ? el.widthMsg : el.heightMsg, other, '');
  }

  function renderSettings() {
    const c = settings.custom;
    el.modes.forEach((r) => { r.checked = r.value === settings.mode; });
    for (const [k, p] of Object.entries(el.panels)) p.hidden = k !== settings.mode;
    el.lock.checked = c.lock;
    el.lockNote.textContent = c.lock
      ? 'Proportions are kept. The side you typed is applied to every image, and the other side follows each image’s own shape, so nothing is stretched or squashed.'
      : 'Unlocked: the width and height are applied exactly, which can stretch or squash the picture.';
    el.lockNote.dataset.kind = c.lock ? 'info' : 'warn';
    el.width.disabled = false;
    el.height.disabled = false;
    el.width.setAttribute('aria-describedby', 'ir-lock-note ir-width-msg');
    el.height.setAttribute('aria-describedby', 'ir-lock-note ir-height-msg');
    el.percents.forEach((r) => { r.checked = String(settings.percent) === r.value && settings.percentText === r.value; });
    el.presets.forEach((r) => { r.checked = r.value === settings.preset; });
    el.enlarge.checked = !settings.allowEnlarge;
    el.formats.forEach((r) => { r.checked = r.value === settings.format; });

    const transparent = items.filter((i) => usable(i) && needsBackground(i.hasAlpha, outTypeFor(i))).length;
    el.bgField.hidden = !(settings.format === 'image/jpeg' || transparent);
    el.bg.value = settings.background;
    el.bgOut.textContent = settings.background.toUpperCase();
    el.formatNote.textContent = transparent
      ? `${transparent} image${transparent === 1 ? ' has' : 's have'} transparent areas. JPEG cannot store transparency, so those areas will be filled with the background colour below.`
      : settings.format === 'image/jpeg' ? 'JPEG cannot store transparency. If an image has transparent areas they will be filled with the background colour below.' : '';
  }

  function onSettingsChanged() {
    syncPairedField();
    renderSettings();
    items.forEach(renderItem);
    renderToolbar();
  }

  /* ----------------------------------------------------------- Item rendering */
  function planText(item) {
    const t = planFor(item);
    if (!t.ok) return { text: t.message, kind: 'error' };
    const size = formatDimensions(t.width, t.height);
    const bits = [`Will be ${size}`];
    if (t.unchanged) bits.push('same size as the original');
    else if (t.enlarged) bits.push('enlarged: this cannot add detail, so it may look soft');
    if (t.stretch) bits.push('proportions change (stretched or squashed)');
    return { text: bits.join(' · '), kind: t.stretch || t.enlarged ? 'warn' : 'info' };
  }

  function buildItem(item) {
    const li = el.tpl.content.firstElementChild.cloneNode(true);
    const q = (s) => li.querySelector(s);
    item.ui = {
      li, thumb: q('[data-thumb]'), name: q('[data-name]'), meta: q('[data-meta]'), plan: q('[data-plan]'), state: q('[data-state]'), info: q('[data-info]'),
      result: q('[data-result]'), preview: q('[data-preview]'), rOrig: q('[data-r-orig]'), rNew: q('[data-r-new]'), rChange: q('[data-r-change]'), rFormat: q('[data-r-format]'), rDims: q('[data-r-dims]'),
      warn: q('[data-warn]'), run: q('[data-run]'), download: q('[data-download]'), compare: q('[data-compare]'), remove: q('[data-remove]'), cmp: q('[data-cmp]'),
    };
    item.ui.remove.addEventListener('click', () => removeItem(item, true));
    item.ui.run.addEventListener('click', () => runBatch([item]));
    item.ui.download.addEventListener('click', () => downloadOne(item));
    item.ui.compare.addEventListener('click', () => toggleCompare(item));
    el.list.appendChild(li);
  }

  function stateOf(item) {
    switch (item.status) {
      case 'checking': return ['Checking…', 'busy', '…'];
      case 'rejected': return ['Can’t use this file', 'error', '✕'];
      case 'ready': return [item.cancelledNote ? 'Cancelled' : 'Ready to resize', 'ready', '•'];
      case 'queued': return ['Waiting…', 'busy', '…'];
      case 'resizing': return ['Resizing…', 'busy', '…'];
      case 'failed': return ['Failed', 'error', '✕'];
      case 'done': return isStale(item) ? ['Settings changed. Resize again to update.', 'stale', '↻'] : ['Done', 'done', '✓'];
      default: return ['', '', ''];
    }
  }

  function renderItem(item) {
    const u = item.ui;
    if (!u) return;
    u.name.textContent = item.name;
    u.name.title = item.name;
    u.meta.textContent = [formatDimensions(item.width, item.height), formatBytes(item.size), item.type ? typeLabel(item.type) : ''].filter(Boolean).join(' · ');
    if (item.thumb && !u.thumb.contains(item.thumb)) u.thumb.replaceChildren(item.thumb);
    u.thumb.dataset.alpha = item.hasAlpha ? 'true' : 'false';

    const showPlan = usable(item);
    u.plan.hidden = !showPlan;
    if (showPlan) { const p = planText(item); u.plan.textContent = p.text; u.plan.dataset.kind = p.kind; }

    const [label, kind, icon] = stateOf(item);
    u.state.dataset.kind = kind;
    u.state.textContent = '';
    const ic = Object.assign(document.createElement('span'), { textContent: icon, className: 'state-icon' });
    ic.setAttribute('aria-hidden', 'true');
    u.state.append(ic, document.createTextNode(label));

    const extra = [];
    if (item.error) extra.push(item.error);
    if (item.formatNote) extra.push(item.formatNote);
    u.info.replaceChildren(...extra.map((t) => Object.assign(document.createElement('p'), { className: 'item-note', textContent: t })));
    u.info.hidden = extra.length === 0;

    const r = item.result;
    u.result.hidden = !r;
    u.warn.hidden = true;
    if (r) {
      u.rOrig.textContent = formatBytes(item.file.size);
      u.rNew.textContent = formatBytes(r.blob.size);
      u.rChange.textContent = describeSizeChange(item.file.size, r.blob.size);
      u.rChange.dataset.dir = compareSizes(item.file.size, r.blob.size).direction;
      u.rFormat.textContent = typeLabel(r.actualType);
      u.rDims.textContent = `${formatDimensions(item.width, item.height)} → ${formatDimensions(r.width, r.height)}`;
      if (item.resultThumb && !u.preview.contains(item.resultThumb)) u.preview.replaceChildren(item.resultThumb);
      u.preview.dataset.alpha = r.actualType === 'image/jpeg' ? 'false' : item.hasAlpha ? 'true' : 'false';
      const larger = r.blob.size >= item.file.size;
      u.warn.hidden = !larger;
      u.warn.textContent = larger ? 'The resized file is not smaller than the original. That can happen when enlarging, when changing format, or with an already well-compressed original.' : '';
    }

    const busy = item.status === 'resizing' || item.status === 'queued';
    const plan = planFor(item);
    u.run.hidden = !usable(item);
    u.run.disabled = busy || running || !plan.ok;
    u.run.textContent = item.result ? 'Resize again' : 'Resize';
    u.run.setAttribute('aria-label', `${item.result ? 'Resize again' : 'Resize'} ${item.name}`);
    u.download.hidden = !r;
    u.download.setAttribute('aria-label', `Download resized ${item.name}`);
    u.compare.hidden = !r;
    u.compare.setAttribute('aria-expanded', String(comparing?.item === item));
    u.compare.setAttribute('aria-label', `Compare original and resized ${item.name}`);
    u.remove.setAttribute('aria-label', `Remove ${item.name}`);
    u.li.dataset.status = item.status;
  }

  function renderToolbar() {
    const real = items.filter(usable);
    const done = items.filter((i) => i.result);
    const todo = real.filter((i) => planFor(i).ok && (!i.result || isStale(i) || i.status === 'failed' || i.status === 'ready'));
    el.empty.hidden = items.length > 0;
    el.list.hidden = items.length === 0;
    el.count.textContent = items.length ? `${items.length} image${items.length === 1 ? '' : 's'}` : '';
    el.runAll.disabled = running || todo.length === 0;
    el.runAll.textContent = todo.length > 1 ? `Resize ${todo.length} images` : 'Resize';
    el.cancel.hidden = !running;
    el.downloadAll.hidden = done.length === 0;
    el.downloadAll.textContent = done.length > 1 ? 'Download all (ZIP)' : 'Download';
    el.downloadAll.disabled = running;
    el.clearAll.disabled = items.length === 0;
    if (done.length) {
      const s = summarizeBatch(done.map((i) => ({ originalSize: i.file.size, size: i.result.blob.size })));
      const change = s.direction === 'smaller' ? `Total ${formatBytes(s.bytes)} smaller (${s.percent}%)` : s.direction === 'larger' ? `Total ${formatBytes(s.bytes)} larger (+${s.percent}%)` : 'No change in total size';
      el.summary.textContent = `${done.length} resized · ${formatBytes(s.original)} → ${formatBytes(s.result)} · ${change}`;
      el.summary.hidden = false;
    } else el.summary.hidden = true;
  }

  /* ------------------------------------------------------------ Adding files */
  const extType = (name) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[(/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()];

  async function analyze(item) {
    try {
      const head = new Uint8Array(await item.file.slice(0, Math.min(item.file.size, HEAD_BYTES)).arrayBuffer());
      const check = checkImageFile({ size: item.file.size, head });
      if (!check.ok) return reject(item, check.message);
      item.type = check.type;
      if (check.width) { item.width = check.width; item.height = check.height; }
      const claimed = extType(item.name);
      if (claimed && claimed !== item.type) item.formatNote = `The name says ${typeLabel(claimed)}, but the file is really ${typeLabel(item.type)}. It was identified by its contents.`;
      const decoded = await decodeImage(item.file);
      try {
        item.width = decoded.width;
        item.height = decoded.height;
        if (decoded.width * decoded.height > MAX_PIXELS) return reject(item, `This image is ${decoded.width.toLocaleString('en-US')} × ${decoded.height.toLocaleString('en-US')} px. The limit is ${MAX_PIXELS / 1e6} megapixels.`);
        item.thumb = makeThumbnail(decoded);
        item.hasAlpha = item.type === 'image/jpeg' ? false : await hasTransparency(decoded);
      } finally {
        decoded.release();
      }
      item.status = 'ready';
    } catch (e) {
      reject(item, e?.code === 'decode-failed' ? e.message : 'This file could not be read. It may be a folder, or it may have been moved or deleted.');
    }
  }
  const reject = (item, message) => { item.status = 'rejected'; item.error = message; };

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const fresh = [];
    const dupes = [];
    const overflow = [];
    for (const file of files) {
      const key = fileKey(file);
      if (keys.has(key)) { dupes.push(file.name); continue; }
      if (items.length >= MAX_IMAGES) { overflow.push(file.name); continue; }
      keys.add(key);
      const item = { id: ++seq, key, file, name: file.name, size: file.size, status: 'checking', type: null, width: 0, height: 0, hasAlpha: false, result: null, error: '', formatNote: '', thumb: null, resultThumb: null };
      items.push(item);
      buildItem(item);
      renderItem(item);
      fresh.push(item);
    }
    const lines = [];
    if (dupes.length) lines.push(`${dupes.length} file${dupes.length === 1 ? ' was' : 's were'} already in the list and skipped: ${dupes.slice(0, 5).join(', ')}${dupes.length > 5 ? ', …' : ''}.`);
    if (overflow.length) lines.push(`${overflow.length} file${overflow.length === 1 ? ' was' : 's were'} not added because the list holds up to ${MAX_IMAGES} images: ${overflow.slice(0, 5).join(', ')}${overflow.length > 5 ? ', …' : ''}.`);
    note(lines);
    renderToolbar();
    for (const item of fresh) {
      if (!items.includes(item)) continue;
      await analyze(item);
      if (items.includes(item)) renderItem(item);
      await yieldToBrowser();
    }
    const bad = fresh.filter((i) => i.status === 'rejected').length;
    const good = fresh.filter((i) => i.status === 'ready').length;
    el.live.textContent = `Added ${good} image${good === 1 ? '' : 's'}${bad ? `. ${bad} file${bad === 1 ? ' was' : 's were'} not accepted (see the list for the reason)` : ''}.`;
    syncPairedField();
    renderSettings();
    items.forEach(renderItem);
    renderToolbar();
  }

  /* --------------------------------------------------------------- Resizing */
  function setProgress(done, total, label) {
    el.progress.hidden = total === 0;
    el.bar.setAttribute('aria-valuenow', String(done));
    el.bar.setAttribute('aria-valuemax', String(total));
    el.bar.setAttribute('aria-valuetext', `${done} of ${total} images`);
    el.barFill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    el.progressText.textContent = label;
  }

  async function runBatch(targets) {
    targets = targets.filter((i) => usable(i) && items.includes(i));
    if (running || !targets.length) return;
    running = true;
    cancelRequested = false;
    el.cancel.disabled = false;
    closeCompare();
    targets.forEach((i) => { i.status = 'queued'; i.error = ''; i.cancelledNote = false; renderItem(i); });
    renderToolbar();
    let finished = 0, failed = 0, skipped = 0;
    setProgress(0, targets.length, `Starting… 0 of ${targets.length}`);
    for (const item of targets) {
      if (cancelRequested || !items.includes(item)) {
        if (items.includes(item)) { item.status = item.result ? 'done' : 'ready'; item.cancelledNote = true; renderItem(item); }
        skipped++;
        continue;
      }
      const plan = planFor(item);
      if (!plan.ok) { // this image cannot be resized with these settings: say so, and carry on with the others
        item.status = 'failed';
        item.error = plan.message;
        failed++; finished++;
        renderItem(item);
        continue;
      }
      item.status = 'resizing';
      renderItem(item);
      setProgress(finished, targets.length, `Resizing ${finished + 1} of ${targets.length}: ${item.name}`);
      const type = outTypeFor(item);
      const signature = sigFor(item);
      try {
        const out = await resizeFile(item.file, { width: plan.width, height: plan.height, type, background: settings.background, shouldCancel: () => cancelRequested || !items.includes(item) });
        if (!items.includes(item)) { skipped++; continue; }
        item.result = { blob: out.blob, requestedType: out.requestedType, actualType: out.actualType, width: out.width, height: out.height, signature };
        item.formatNote = out.actualType !== out.requestedType
          ? `Your browser could not export ${typeLabel(out.requestedType)} and produced ${typeLabel(out.actualType)} instead. The file is named and labelled as ${typeLabel(out.actualType)}.`
          : item.formatNote;
        item.resultThumb = null;
        try { const d = await decodeImage(out.blob); try { item.resultThumb = makeThumbnail(d); } finally { d.release(); } } catch { /* preview is optional */ }
        item.status = 'done';
      } catch (e) {
        if (e?.code === 'cancelled') { item.status = item.result ? 'done' : 'ready'; item.cancelledNote = true; skipped++; renderItem(item); continue; }
        item.status = 'failed';
        item.error = e?.message || 'This image could not be resized.';
        failed++;
      }
      finished++;
      renderItem(item);
      renderToolbar();
      setProgress(finished, targets.length, `Resized ${finished} of ${targets.length}`);
      await yieldToBrowser();
    }
    running = false;
    const ok = finished - failed;
    const text = cancelRequested
      ? `Stopped. ${ok} resized${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} not started` : ''}.`
      : `Finished. ${ok} resized${failed ? `, ${failed} failed (see the list)` : ''}.`;
    setProgress(targets.length - skipped, targets.length, text);
    el.live.textContent = text;
    say(text, failed ? 'bad' : 'ok', 8000);
    items.forEach(renderItem);
    renderToolbar();
  }

  /* --------------------------------------------------------------- Downloads */
  function downloadOne(item) {
    if (!item.result) return;
    const name = nameMap().get(item.id);
    downloadBlob(item.result.blob, name);
    say(`Downloaded ${name} (${formatBytes(item.result.blob.size)}).`);
  }

  async function downloadAll() {
    const done = items.filter((i) => i.result);
    if (!done.length) return;
    if (done.length === 1) return downloadOne(done[0]);
    el.downloadAll.disabled = true;
    say('Preparing the ZIP file…', 'ok', 0);
    try {
      const names = nameMap();
      const zip = await createZip(done.map((i) => ({ name: names.get(i.id), data: i.result.blob })));
      downloadBlob(zip, 'toolora-resized-images.zip');
      say(`Downloaded toolora-resized-images.zip (${done.length} images, ${formatBytes(zip.size)}).`);
    } catch (e) {
      say(`Couldn’t create the ZIP file: ${e?.message ?? 'unknown error'}. You can still download the images one at a time.`, 'bad', 10000);
    } finally {
      el.downloadAll.disabled = running;
    }
  }

  /* ----------------------------------------------------------------- Compare */
  function closeCompare() {
    if (!comparing) return;
    const { item, urls } = comparing;
    urls.forEach(dropUrl);
    if (item.ui) { item.ui.cmp.replaceChildren(); item.ui.cmp.hidden = true; item.ui.compare.setAttribute('aria-expanded', 'false'); item.ui.compare.textContent = 'Compare'; }
    comparing = null;
  }

  function toggleCompare(item) {
    if (comparing?.item === item) return closeCompare();
    closeCompare();
    if (!item.result) return;
    const before = makeUrl(item.file);
    const after = makeUrl(item.result.blob);
    comparing = { item, urls: [before, after] };
    const wrap = document.createElement('div');
    wrap.className = 'cmp-stage';
    wrap.style.aspectRatio = `${item.result.width} / ${item.result.height}`;
    const imgAfter = Object.assign(document.createElement('img'), { src: after, alt: `Resized version of ${item.name}`, className: 'cmp-after', draggable: false });
    const imgBefore = Object.assign(document.createElement('img'), { src: before, alt: `Original ${item.name}`, className: 'cmp-before', draggable: false });
    const handle = Object.assign(document.createElement('span'), { className: 'cmp-handle' });
    handle.setAttribute('aria-hidden', 'true');
    const l = Object.assign(document.createElement('span'), { className: 'cmp-label cmp-label-l', textContent: `Original · ${formatDimensions(item.width, item.height)}` });
    const r = Object.assign(document.createElement('span'), { className: 'cmp-label cmp-label-r', textContent: `Resized · ${formatDimensions(item.result.width, item.result.height)}` });
    wrap.append(imgAfter, imgBefore, handle, l, r);
    const range = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '100', value: '50', className: 'cmp-range' });
    range.setAttribute('aria-label', `Comparison position for ${item.name}: left shows the original, right shows the resized image`);
    const setPos = () => { wrap.style.setProperty('--pos', `${range.value}%`); range.setAttribute('aria-valuetext', `${range.value} percent original`); };
    range.addEventListener('input', setPos);
    setPos();
    const caption = Object.assign(document.createElement('p'), { className: 'item-note cmp-note', textContent: 'Both pictures are shown at the same display size so you can compare detail.' });
    item.ui.cmp.replaceChildren(wrap, range, caption);
    item.ui.cmp.hidden = false;
    item.ui.compare.setAttribute('aria-expanded', 'true');
    item.ui.compare.textContent = 'Hide comparison';
  }

  /* ------------------------------------------------------------ Remove / clear */
  function releaseItem(item) {
    if (comparing?.item === item) closeCompare();
    keys.delete(item.key);
    item.result = null;
    item.thumb = null;
    item.resultThumb = null;
    item.ui?.li.remove();
    item.ui = null;
  }
  function removeItem(item, moveFocus) {
    const idx = items.indexOf(item);
    if (idx < 0) return;
    items.splice(idx, 1);
    releaseItem(item);
    onSettingsChanged();
    if (moveFocus) (items[idx]?.ui?.remove ?? items[idx - 1]?.ui?.remove ?? el.browse).focus();
  }
  function clearAll() {
    cancelRequested = true;
    closeCompare();
    for (const item of items.splice(0)) releaseItem(item);
    keys.clear();
    note([]);
    setProgress(0, 0, '');
    onSettingsChanged();
    el.browse.focus();
    say('Cleared all images.');
  }

  /* ------------------------------------------------------------------ Events */
  el.browse.addEventListener('click', () => el.input.click());
  el.input.addEventListener('change', () => { addFiles(el.input.files); el.input.value = ''; });
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let dragDepth = 0;
  el.drop.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; el.drop.dataset.dragging = 'true'; });
  el.drop.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  el.drop.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) delete el.drop.dataset.dragging; });
  el.drop.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; delete el.drop.dataset.dragging; addFiles(e.dataTransfer.files); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e) && !el.drop.contains(e.target)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (hasFiles(e) && !el.drop.contains(e.target)) e.preventDefault(); });

  // Mode (switching never touches the uploaded images or their results)
  el.modes.forEach((r) => r.addEventListener('change', () => { settings.mode = r.value; onSettingsChanged(); }));

  // Custom size
  const onDimension = (which) => {
    const input = which === 'width' ? el.width : el.height;
    const msgEl = which === 'width' ? el.widthMsg : el.heightMsg;
    const text = input.value.trim();
    const parsed = text === '' ? { ok: false, code: 'empty' } : parseDimension(text);
    settings.custom[which] = parsed.ok ? parsed.value : null;
    if (settings.custom.lock) settings.custom.driver = which;
    setMsg(msgEl, input, text === '' || parsed.ok ? '' : parsed.message);
    onSettingsChanged();
  };
  el.width.addEventListener('input', () => onDimension('width'));
  el.height.addEventListener('input', () => onDimension('height'));
  el.lock.addEventListener('change', () => {
    settings.custom.lock = el.lock.checked;
    if (!settings.custom.lock) {
      // Unlocking: both numbers on screen become exact, independent values.
      for (const [k, input] of [['width', el.width], ['height', el.height]]) { const p = parseDimension(input.value); settings.custom[k] = p.ok ? p.value : null; }
    } else {
      // Locking again: keep the side you typed last and recompute the other from the image proportions.
      const drv = settings.custom.driver;
      if (!settings.custom[drv]) settings.custom.driver = settings.custom.width ? 'width' : 'height';
    }
    onSettingsChanged();
  });

  // Percentage
  el.percents.forEach((r) => r.addEventListener('change', () => { settings.percent = Number(r.value); settings.percentText = r.value; el.percentCustom.value = ''; setMsg(el.percentMsg, el.percentCustom, ''); onSettingsChanged(); }));
  el.percentCustom.addEventListener('input', () => {
    const text = el.percentCustom.value.trim();
    if (text === '') { setMsg(el.percentMsg, el.percentCustom, ''); settings.percent = NaN; settings.percentText = ''; return onSettingsChanged(); }
    const p = parsePercent(text);
    setMsg(el.percentMsg, el.percentCustom, p.ok ? '' : p.message);
    settings.percent = p.ok ? p.value : NaN;
    settings.percentText = p.ok ? text : '';
    onSettingsChanged();
  });

  // Presets
  el.presets.forEach((r) => r.addEventListener('change', () => { settings.preset = r.value; onSettingsChanged(); }));
  el.enlarge.addEventListener('change', () => { settings.allowEnlarge = !el.enlarge.checked; onSettingsChanged(); });

  // Output
  el.formats.forEach((r) => r.addEventListener('change', () => { settings.format = r.value; onSettingsChanged(); }));
  el.bg.addEventListener('input', () => { settings.background = normalizeHexColor(el.bg.value); onSettingsChanged(); });

  el.runAll.addEventListener('click', () => runBatch(items.filter((i) => usable(i) && planFor(i).ok && (!i.result || isStale(i) || i.status === 'failed' || i.status === 'ready'))));
  el.cancel.addEventListener('click', () => { cancelRequested = true; el.cancel.disabled = true; setProgress(Number(el.bar.getAttribute('aria-valuenow')), Number(el.bar.getAttribute('aria-valuemax')), 'Stopping after the current image…'); });
  el.downloadAll.addEventListener('click', downloadAll);

  const showConfirm = () => { el.actions.hidden = true; el.confirm.hidden = false; el.confirmNo.focus(); };
  const hideConfirm = (focus) => { el.confirm.hidden = true; el.actions.hidden = false; if (focus) el.clearAll.focus(); };
  el.clearAll.addEventListener('click', () => { if (items.length) showConfirm(); });
  el.confirmNo.addEventListener('click', () => hideConfirm(true));
  el.confirmYes.addEventListener('click', () => { hideConfirm(false); clearAll(); });
  el.confirm.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideConfirm(true); });

  window.addEventListener('pagehide', () => { closeCompare(); items.forEach((i) => { i.result = null; }); });

  /* -------------------------------------------------------------------- Init */
  (async () => {
    const encoders = await probeEncoders().catch(() => ({}));
    el.formats.forEach((r) => {
      if (r.value !== 'original' && encoders[r.value] === false) {
        r.disabled = true;
        r.closest('label')?.setAttribute('title', `${typeLabel(r.value)} export is not supported by this browser`);
        if (r.nextElementSibling) r.nextElementSibling.textContent += ' (unavailable)';
      }
    });
  })();
  renderSettings();
  renderToolbar();
  setProgress(0, 0, '');
}
