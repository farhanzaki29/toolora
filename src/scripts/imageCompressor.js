/**
 * Image Compressor UI controller. Everything runs locally in the browser: images are read from disk by the
 * browser, processed with its own image codecs and offered back as downloads. Nothing is uploaded, stored
 * (no localStorage / sessionStorage / cookies) or logged.
 */
import {
  IMAGE_TYPES, PRESETS, HEAD_BYTES, MAX_PIXELS, QUALITY_MAX, QUALITY_MIN, checkImageFile, clampQuality, fileKey,
  presetForQuality, resolveOutputType, needsBackground, normalizeHexColor, settingsSignature, buildOutputName, buildOriginalName,
  formatBytes, compareSizes, describeSizeChange, summarizeBatch, formatDimensions, pngBitsForQuality,
} from '../lib/imageCompressor.js';
import { probeEncoders, decodeImage, makeThumbnail, hasTransparency, compressFile, yieldToBrowser } from '../lib/imageCodec.js';
import { createZip } from '../lib/zip.js';
import { downloadBlob } from '../lib/clipboard.js';

const root = document.querySelector('[data-ic]');

if (root) {
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const el = {
    drop: $('[data-ic-drop]'), input: $('[data-ic-input]'), browse: $('[data-ic-browse]'), notes: $('[data-ic-notes]'),
    presets: $$('input[name="ic-preset"]'), slider: $('[data-ic-quality]'), sliderOut: $('[data-ic-quality-out]'), presetHint: $('[data-ic-preset-hint]'),
    qualityNote: $('[data-ic-quality-note]'),
    formats: $$('input[name="ic-format"]'), formatNote: $('[data-ic-format-note]'),
    bgField: $('[data-ic-bg-field]'), bg: $('[data-ic-bg]'), bgOut: $('[data-ic-bg-out]'),
    list: $('[data-ic-list]'), empty: $('[data-ic-empty]'), count: $('[data-ic-count]'), summary: $('[data-ic-summary]'),
    compressAll: $('[data-ic-compress-all]'), cancel: $('[data-ic-cancel]'), downloadAll: $('[data-ic-download-all]'), clearAll: $('[data-ic-clear-all]'),
    actions: $('[data-ic-toolbar-actions]'), confirm: $('[data-ic-confirm]'), confirmYes: $('[data-ic-confirm-yes]'), confirmNo: $('[data-ic-confirm-no]'),
    progress: $('[data-ic-progress]'), bar: $('[data-ic-bar]'), barFill: $('[data-ic-bar-fill]'), progressText: $('[data-ic-progress-text]'),
    live: $('[data-ic-live]'), toast: $('[data-ic-toast]'), tpl: $('[data-ic-template]'),
  };

  /* ---------------------------------------------------------------- State */
  const settings = { quality: PRESETS.balanced.quality, format: 'original', background: '#ffffff' };
  let encoders = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };
  const items = [];
  const keys = new Set();
  let seq = 0;
  let running = false;
  let cancelRequested = false;
  let comparing = null; // { item, urls: [] }
  const openUrls = new Set(); // every object URL this tool has created and not yet revoked

  const makeUrl = (blob) => { const u = URL.createObjectURL(blob); openUrls.add(u); return u; };
  const dropUrl = (u) => { if (openUrls.delete(u)) URL.revokeObjectURL(u); };
  root.__ic = { items, openUrls, settings }; // read-only handles for the automated browser tests

  const typeLabel = (t) => IMAGE_TYPES[t]?.label ?? 'image';
  const outTypeFor = (item) => resolveOutputType(item.type, settings.format);
  const sigFor = (item) => settingsSignature({ quality: settings.quality, outputType: outTypeFor(item), background: settings.background, hasAlpha: item.hasAlpha });
  const usable = (item) => item.status !== 'rejected' && item.status !== 'checking';
  const isStale = (item) => Boolean(item.result) && item.result.signature !== sigFor(item);

  /** Effective output of a finished item: the compressed file, or the untouched original if the user kept it. */
  const effective = (item, names) => {
    const r = item.result;
    if (r.keepOriginal) return { blob: item.file, type: item.type, size: item.file.size, name: names.get(item.id).original };
    return { blob: r.blob, type: r.actualType, size: r.blob.size, name: names.get(item.id).compressed };
  };
  /** Stable, unique file names for every finished item (same names for single and ZIP downloads). */
  function nameMap() {
    const taken = new Set();
    const map = new Map();
    for (const item of items) {
      if (!item.result) continue;
      map.set(item.id, {
        compressed: buildOutputName(item.name, item.result.actualType, taken),
        original: null,
      });
    }
    for (const item of items) {
      if (item.result?.keepOriginal) map.get(item.id).original = buildOriginalName(item.name, item.type, taken);
    }
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

  /* ------------------------------------------------------------ Settings UI */
  function renderSettings() {
    const q = settings.quality;
    el.slider.value = String(q);
    el.slider.setAttribute('aria-valuetext', `${q} percent`);
    el.sliderOut.textContent = `${q}%`;
    const preset = presetForQuality(q);
    el.presets.forEach((r) => { r.checked = r.value === preset; });
    el.presetHint.textContent = preset === 'custom'
      ? `Custom quality (${q}%). Presets: High Quality 92%, Balanced 80%, Smaller File 60%.`
      : `${PRESETS[preset].label}: ${PRESETS[preset].hint}`;

    const fmt = settings.format;
    el.formats.forEach((r) => { r.checked = r.value === fmt; });

    const types = new Set(items.filter(usable).map(outTypeFor));
    if (fmt !== 'original') types.add(fmt);
    const pngOut = types.has('image/png');
    const lossyOut = [...types].some((t) => t !== 'image/png') || types.size === 0;
    const parts = [];
    if (lossyOut) parts.push('Higher quality keeps more detail but makes a bigger file. Lower quality makes a smaller file but can soften detail or add blotchy areas. How much a file shrinks depends on the picture, so no saving is guaranteed.');
    if (pngOut) {
      const bits = pngBitsForQuality(q);
      parts.push(bits >= 8
        ? 'PNG is lossless: at this setting every colour is kept, so PNG files usually shrink only a little (and can even grow).'
        : `PNG is lossless, so for PNG files this setting reduces the number of colours instead (${2 ** bits} levels per colour channel). Transparency is never changed.`);
    }
    el.qualityNote.textContent = parts.join(' ');

    const showBg = fmt === 'image/jpeg' || items.some((i) => usable(i) && needsBackground(i.hasAlpha, outTypeFor(i)));
    el.bgField.hidden = !showBg;
    el.bg.value = settings.background;
    el.bgOut.textContent = settings.background.toUpperCase();
    const transparentToJpeg = items.filter((i) => usable(i) && needsBackground(i.hasAlpha, outTypeFor(i))).length;
    el.formatNote.textContent = transparentToJpeg
      ? `${transparentToJpeg} image${transparentToJpeg === 1 ? ' has' : 's have'} transparent areas. JPEG cannot store transparency, so those areas will be filled with the background colour below.`
      : fmt === 'image/jpeg' ? 'JPEG cannot store transparency. If an image has transparent areas they will be filled with the background colour below.' : '';
  }

  function onSettingsChanged() {
    renderSettings();
    items.forEach(renderItem);
    renderToolbar();
  }

  /* ----------------------------------------------------------- Item rendering */
  function buildItem(item) {
    const li = el.tpl.content.firstElementChild.cloneNode(true);
    const q = (s) => li.querySelector(s);
    item.ui = {
      li, thumb: q('[data-thumb]'), name: q('[data-name]'), meta: q('[data-meta]'), state: q('[data-state]'), info: q('[data-info]'),
      result: q('[data-result]'), rOrig: q('[data-r-orig]'), rNew: q('[data-r-new]'), rChange: q('[data-r-change]'), rFormat: q('[data-r-format]'), rDims: q('[data-r-dims]'),
      warn: q('[data-warn]'), keep: q('[data-keep]'),
      compress: q('[data-compress]'), download: q('[data-download]'), compare: q('[data-compare]'), remove: q('[data-remove]'),
      cmp: q('[data-cmp]'),
    };
    item.ui.remove.addEventListener('click', () => removeItem(item, true));
    item.ui.compress.addEventListener('click', () => runBatch([item]));
    item.ui.download.addEventListener('click', () => downloadOne(item));
    item.ui.compare.addEventListener('click', () => toggleCompare(item));
    item.ui.keep.addEventListener('click', () => {
      item.result.keepOriginal = !item.result.keepOriginal;
      closeCompare();
      renderItem(item);
      renderToolbar();
    });
    el.list.appendChild(li);
    return li;
  }

  function stateOf(item) {
    switch (item.status) {
      case 'checking': return ['Checking…', 'busy', '…'];
      case 'rejected': return ['Can’t use this file', 'error', '✕'];
      case 'ready': return [item.cancelledNote ? 'Cancelled' : 'Ready to compress', 'ready', '•'];
      case 'queued': return ['Waiting…', 'busy', '…'];
      case 'compressing': return ['Compressing…', 'busy', '…'];
      case 'failed': return ['Failed', 'error', '✕'];
      case 'done': return isStale(item) ? ['Settings changed. Compress again to update.', 'stale', '↻'] : ['Done', 'done', '✓'];
      default: return ['', '', ''];
    }
  }

  function renderItem(item) {
    const u = item.ui;
    if (!u) return;
    u.name.textContent = item.name;
    u.name.title = item.name;
    const dims = formatDimensions(item.width, item.height);
    u.meta.textContent = [dims, formatBytes(item.size), item.type ? typeLabel(item.type) : ''].filter(Boolean).join(' · ');
    if (item.thumb && !u.thumb.contains(item.thumb)) { u.thumb.replaceChildren(item.thumb); }
    u.thumb.dataset.alpha = item.hasAlpha ? 'true' : 'false';

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
      const eff = r.keepOriginal ? { size: item.file.size, type: item.type } : { size: r.blob.size, type: r.actualType };
      u.rOrig.textContent = formatBytes(item.file.size);
      u.rNew.textContent = r.keepOriginal ? `${formatBytes(item.file.size)} (original kept)` : formatBytes(r.blob.size);
      const cmp = compareSizes(item.file.size, eff.size);
      u.rChange.textContent = r.keepOriginal ? 'No change: your original file is kept as it is.' : describeSizeChange(item.file.size, eff.size);
      u.rChange.dataset.dir = r.keepOriginal ? 'same' : cmp.direction;
      u.rFormat.textContent = typeLabel(eff.type);
      u.rDims.textContent = formatDimensions(r.width, r.height);
      const larger = !r.keepOriginal && r.blob.size >= item.file.size;
      u.warn.hidden = !(larger || r.keepOriginal);
      u.warn.textContent = r.keepOriginal ? 'You chose to keep the original file for downloads.' : 'The compressed file is not smaller than the original. You can keep the original instead.';
      u.keep.hidden = !(larger || r.keepOriginal);
      u.keep.textContent = r.keepOriginal ? 'Use compressed file' : 'Keep original';
    }

    const busy = item.status === 'compressing' || item.status === 'queued';
    u.compress.hidden = !usable(item);
    u.compress.disabled = busy || running;
    u.compress.textContent = item.result ? 'Compress again' : 'Compress';
    u.compress.setAttribute('aria-label', `${item.result ? 'Compress again' : 'Compress'} ${item.name}`);
    u.download.hidden = !r;
    u.download.setAttribute('aria-label', `Download ${item.name} (${r?.keepOriginal ? 'original' : 'compressed'})`);
    u.compare.hidden = !r || r.keepOriginal;
    u.compare.setAttribute('aria-label', `Compare original and compressed ${item.name}`);
    u.compare.setAttribute('aria-expanded', String(comparing?.item === item));
    u.remove.setAttribute('aria-label', `Remove ${item.name}`);
    u.li.dataset.status = item.status;
  }

  function renderToolbar() {
    const real = items.filter(usable);
    const done = items.filter((i) => i.result);
    const todo = real.filter((i) => !i.result || isStale(i) || i.status === 'failed' || i.status === 'ready');
    el.empty.hidden = items.length > 0;
    el.list.hidden = items.length === 0;
    el.count.textContent = items.length ? `${items.length} image${items.length === 1 ? '' : 's'}` : '';

    el.compressAll.disabled = running || todo.length === 0;
    el.compressAll.textContent = todo.length > 1 ? `Compress ${todo.length} images` : 'Compress';
    el.cancel.hidden = !running;
    el.downloadAll.hidden = done.length === 0;
    el.downloadAll.textContent = done.length > 1 ? 'Download all (ZIP)' : 'Download';
    el.downloadAll.disabled = running;
    el.clearAll.disabled = items.length === 0;

    if (done.length) {
      const names = nameMap();
      const s = summarizeBatch(done.map((i) => ({ originalSize: i.file.size, size: effective(i, names).size })));
      const change = s.direction === 'smaller' ? `Saved ${formatBytes(s.bytes)} (${s.percent}%)` : s.direction === 'larger' ? `Larger by ${formatBytes(s.bytes)} (+${s.percent}%)` : 'No change in total size';
      el.summary.textContent = `${done.length} compressed · ${formatBytes(s.original)} → ${formatBytes(s.result)} · ${change}`;
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
  function reject(item, message) {
    item.status = 'rejected';
    item.error = message;
  }

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const fresh = [];
    const dupes = [];
    for (const file of files) {
      const key = fileKey(file);
      if (keys.has(key)) { dupes.push(file.name); continue; }
      keys.add(key);
      const item = { id: ++seq, key, file, name: file.name, size: file.size, status: 'checking', type: null, width: 0, height: 0, hasAlpha: false, result: null, error: '', formatNote: '', thumb: null };
      items.push(item);
      buildItem(item);
      renderItem(item);
      fresh.push(item);
    }
    const lines = [];
    if (dupes.length) lines.push(`${dupes.length} file${dupes.length === 1 ? ' was' : 's were'} already in the list and skipped: ${dupes.slice(0, 5).join(', ')}${dupes.length > 5 ? ', …' : ''}.`);
    note(lines);
    renderToolbar();
    for (const item of fresh) {
      if (!items.includes(item)) continue; // removed while waiting
      await analyze(item);
      if (items.includes(item)) renderItem(item);
      await yieldToBrowser();
    }
    const bad = fresh.filter((i) => i.status === 'rejected').length;
    const good = fresh.filter((i) => i.status === 'ready').length;
    const msg = `Added ${good} image${good === 1 ? '' : 's'}${bad ? `. ${bad} file${bad === 1 ? ' was' : 's were'} not accepted (see the list for the reason)` : ''}${dupes.length ? `. ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'} skipped` : ''}.`;
    el.live.textContent = msg;
    renderSettings();
    renderToolbar();
  }

  /* ------------------------------------------------------------- Compressing */
  function setProgress(done, total, label) {
    el.progress.hidden = total === 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    el.bar.setAttribute('aria-valuenow', String(done));
    el.bar.setAttribute('aria-valuemax', String(total));
    el.bar.setAttribute('aria-valuetext', `${done} of ${total} images`);
    el.barFill.style.width = `${pct}%`;
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
    let finished = 0, failed = 0, cancelled = 0;
    setProgress(0, targets.length, `Starting… 0 of ${targets.length}`);
    for (const item of targets) {
      if (cancelRequested || !items.includes(item)) {
        if (items.includes(item)) { item.status = item.result ? 'done' : 'ready'; item.cancelledNote = true; renderItem(item); }
        cancelled++;
        continue;
      }
      item.status = 'compressing';
      renderItem(item);
      setProgress(finished, targets.length, `Compressing ${finished + 1} of ${targets.length}: ${item.name}`);
      const type = outTypeFor(item);
      const signature = sigFor(item);
      try {
        const out = await compressFile(item.file, { type, quality: settings.quality, background: settings.background, shouldCancel: () => cancelRequested || !items.includes(item) });
        if (!items.includes(item)) { cancelled++; continue; } // removed meanwhile: drop the result
        item.result = { blob: out.blob, requestedType: out.requestedType, actualType: out.actualType, width: out.width, height: out.height, signature, keepOriginal: false };
        item.status = 'done';
        item.formatNote = out.actualType !== out.requestedType
          ? `Your browser could not export ${typeLabel(out.requestedType)} and produced ${typeLabel(out.actualType)} instead. The file is named and labelled as ${typeLabel(out.actualType)}.`
          : item.formatNote;
      } catch (e) {
        if (e?.code === 'cancelled') { item.status = item.result ? 'done' : 'ready'; item.cancelledNote = true; cancelled++; renderItem(item); continue; }
        item.status = 'failed';
        item.error = e?.message || 'This image could not be compressed.';
        failed++;
      }
      finished++;
      renderItem(item);
      renderToolbar();
      setProgress(finished, targets.length, `Compressed ${finished} of ${targets.length}`);
      await yieldToBrowser();
    }
    running = false;
    const ok = finished - failed;
    const text = cancelRequested
      ? `Stopped. ${ok} compressed${failed ? `, ${failed} failed` : ''}${cancelled ? `, ${cancelled} not started` : ''}.`
      : `Finished. ${ok} compressed${failed ? `, ${failed} failed (see the list)` : ''}.`;
    setProgress(targets.length - cancelled, targets.length, text);
    el.live.textContent = text;
    say(text, failed ? 'bad' : 'ok', 8000);
    items.forEach(renderItem);
    renderToolbar();
  }

  /* --------------------------------------------------------------- Downloads */
  function downloadOne(item) {
    if (!item.result) return;
    const eff = effective(item, nameMap());
    downloadBlob(eff.blob, eff.name);
    say(`Downloaded ${eff.name} (${formatBytes(eff.size)}).`);
  }

  async function downloadAll() {
    const done = items.filter((i) => i.result);
    if (!done.length) return;
    if (done.length === 1) return downloadOne(done[0]);
    el.downloadAll.disabled = true;
    say('Preparing the ZIP file…', 'ok', 0);
    try {
      const names = nameMap();
      const entries = done.map((i) => { const e = effective(i, names); return { name: e.name, data: e.blob }; });
      const zip = await createZip(entries);
      downloadBlob(zip, 'toolora-compressed-images.zip');
      say(`Downloaded toolora-compressed-images.zip (${done.length} images, ${formatBytes(zip.size)}).`);
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
    if (item.ui) {
      item.ui.cmp.replaceChildren();
      item.ui.cmp.hidden = true;
      item.ui.compare.setAttribute('aria-expanded', 'false');
      item.ui.compare.textContent = 'Compare';
    }
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
    const imgAfter = Object.assign(document.createElement('img'), { src: after, alt: `Compressed version of ${item.name}`, className: 'cmp-after', draggable: false });
    const imgBefore = Object.assign(document.createElement('img'), { src: before, alt: `Original ${item.name}`, className: 'cmp-before', draggable: false });
    const handle = Object.assign(document.createElement('span'), { className: 'cmp-handle' });
    handle.setAttribute('aria-hidden', 'true');
    const labelL = Object.assign(document.createElement('span'), { className: 'cmp-label cmp-label-l', textContent: `Original · ${formatBytes(item.file.size)}` });
    const labelR = Object.assign(document.createElement('span'), { className: 'cmp-label cmp-label-r', textContent: `Compressed · ${formatBytes(item.result.blob.size)}` });
    wrap.append(imgAfter, imgBefore, handle, labelL, labelR);
    const range = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '100', value: '50', className: 'cmp-range' });
    range.setAttribute('aria-label', `Comparison position for ${item.name}: left shows the original, right shows the compressed image`);
    const setPos = () => { wrap.style.setProperty('--pos', `${range.value}%`); range.setAttribute('aria-valuetext', `${range.value} percent original`); };
    range.addEventListener('input', setPos);
    setPos();
    item.ui.cmp.replaceChildren(wrap, range);
    item.ui.cmp.hidden = false;
    item.ui.compare.setAttribute('aria-expanded', 'true');
    item.ui.compare.textContent = 'Hide comparison';
  }

  /* ------------------------------------------------------------ Remove / clear */
  function releaseItem(item) {
    if (comparing?.item === item) closeCompare();
    keys.delete(item.key);
    item.result = null; // drops the compressed Blob
    item.thumb = null;
    item.ui?.li.remove();
    item.ui = null;
  }

  function removeItem(item, moveFocus) {
    const idx = items.indexOf(item);
    if (idx < 0) return;
    items.splice(idx, 1);
    releaseItem(item);
    renderSettings();
    renderToolbar();
    if (moveFocus) (items[idx]?.ui?.remove ?? items[idx - 1]?.ui?.remove ?? el.browse).focus();
  }

  function clearAll() {
    cancelRequested = true;
    closeCompare();
    for (const item of items.splice(0)) releaseItem(item);
    keys.clear();
    note([]);
    setProgress(0, 0, '');
    renderSettings();
    renderToolbar();
    el.browse.focus();
    say('Cleared all images.');
  }

  /* ------------------------------------------------------------------ Events */
  el.browse.addEventListener('click', () => el.input.click());
  el.input.addEventListener('change', () => {
    addFiles(el.input.files);
    el.input.value = ''; // allow choosing the same file again later
  });

  // Drag and drop (also stop the browser from navigating away if a file is dropped outside the zone)
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let dragDepth = 0;
  el.drop.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; el.drop.dataset.dragging = 'true'; });
  el.drop.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  el.drop.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) delete el.drop.dataset.dragging; });
  el.drop.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    delete el.drop.dataset.dragging;
    addFiles(e.dataTransfer.files);
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e) && !el.drop.contains(e.target)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (hasFiles(e) && !el.drop.contains(e.target)) e.preventDefault(); });

  el.presets.forEach((r) => r.addEventListener('change', () => { settings.quality = PRESETS[r.value].quality; onSettingsChanged(); }));
  el.slider.min = String(QUALITY_MIN);
  el.slider.max = String(QUALITY_MAX);
  el.slider.addEventListener('input', () => { settings.quality = clampQuality(el.slider.value); onSettingsChanged(); });
  el.formats.forEach((r) => r.addEventListener('change', () => { settings.format = r.value; onSettingsChanged(); }));
  el.bg.addEventListener('input', () => { settings.background = normalizeHexColor(el.bg.value); onSettingsChanged(); });

  el.compressAll.addEventListener('click', () => runBatch(items.filter((i) => usable(i) && (!i.result || isStale(i) || i.status === 'failed' || i.status === 'ready'))));
  el.cancel.addEventListener('click', () => { cancelRequested = true; el.cancel.disabled = true; setProgress(Number(el.bar.getAttribute('aria-valuenow')), Number(el.bar.getAttribute('aria-valuemax')), 'Stopping after the current image…'); });
  el.downloadAll.addEventListener('click', downloadAll);

  // Clear all, with an inline confirmation (same pattern as the other tools)
  const showConfirm = () => { el.actions.hidden = true; el.confirm.hidden = false; el.confirmNo.focus(); };
  const hideConfirm = (focus) => { el.confirm.hidden = true; el.actions.hidden = false; if (focus) el.clearAll.focus(); };
  el.clearAll.addEventListener('click', () => { if (items.length) showConfirm(); });
  el.confirmNo.addEventListener('click', () => hideConfirm(true));
  el.confirmYes.addEventListener('click', () => { hideConfirm(false); clearAll(); });
  el.confirm.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideConfirm(true); });

  // Free everything if the page is left
  window.addEventListener('pagehide', () => { closeCompare(); items.forEach((i) => { i.result = null; }); });

  /* -------------------------------------------------------------------- Init */
  (async () => {
    encoders = await probeEncoders().catch(() => encoders);
    el.formats.forEach((r) => {
      if (r.value !== 'original' && encoders[r.value] === false) {
        r.disabled = true;
        r.closest('label')?.setAttribute('title', `${typeLabel(r.value)} export is not supported by this browser`);
        const s = r.nextElementSibling;
        if (s) s.textContent += ' (unavailable)';
      }
    });
  })();
  renderSettings();
  renderToolbar();
  setProgress(0, 0, '');
}
