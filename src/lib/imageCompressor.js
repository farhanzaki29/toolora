/**
 * Image Compressor: pure logic. No DOM, canvas, storage or network access, so it can be tested in Node.
 * The browser-side encoding lives in imageCodec.js; the UI in src/scripts/imageCompressor.js.
 *
 * Files are identified by their CONTENT (magic bytes), never by their extension or reported MIME type.
 */

export const IMAGE_TYPES = {
  'image/jpeg': { ext: 'jpg', label: 'JPEG' },
  'image/png': { ext: 'png', label: 'PNG' },
  'image/webp': { ext: 'webp', label: 'WebP' },
};

/** Practical limits. Both are shown to the user in the interface. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
export const MAX_PIXELS = 100_000_000; // 100 megapixels (decoded size is ~4 bytes per pixel)
export const HEAD_BYTES = 1024 * 1024; // how much of a file is read to identify it and find its size

/** Quality presets (percent). Lossy for JPEG/WebP; for PNG they set how many colours are kept. */
export const PRESETS = {
  high: { label: 'High Quality', quality: 92, hint: 'Best-looking result, smaller savings.' },
  balanced: { label: 'Balanced', quality: 80, hint: 'A good starting point for most images.' },
  small: { label: 'Smaller File', quality: 60, hint: 'Smallest files; fine detail may soften.' },
};
export const QUALITY_MIN = 10;
export const QUALITY_MAX = 100;
export const DEFAULT_QUALITY = PRESETS.balanced.quality;

/* ------------------------------------------------------------------ Quality */

export function clampQuality(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_QUALITY;
  return Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, n));
}

/** 'high' | 'balanced' | 'small' when the value equals a preset, otherwise 'custom'. */
export function presetForQuality(quality) {
  const q = clampQuality(quality);
  return Object.keys(PRESETS).find((k) => PRESETS[k].quality === q) ?? 'custom';
}

/** The 0..1 value passed to canvas.toBlob for JPEG and WebP. */
export const canvasQuality = (quality) => clampQuality(quality) / 100;

/**
 * PNG is lossless, so "quality" cannot work the way it does for JPEG. Instead it controls how many bits per
 * colour channel are kept (8 = every colour, i.e. lossless). Transparency (the alpha channel) is never changed.
 */
export function pngBitsForQuality(quality) {
  return Math.min(8, Math.max(4, Math.round(4 + (4 * clampQuality(quality)) / 100)));
}

/* ------------------------------------------------------------ Type detection */

const ascii = (b, start, len) => String.fromCharCode(...b.subarray(start, start + len));

const UNSUPPORTED_LABELS = {
  gif: 'GIF',
  bmp: 'BMP',
  tiff: 'TIFF',
  heic: 'HEIC/HEIF',
  avif: 'AVIF',
  svg: 'SVG',
  pdf: 'PDF',
  ico: 'ICO',
  media: 'a video or audio',
};

/**
 * Identifies a file from its first bytes.
 * Returns { ok: true, type } for JPEG/PNG/WebP, else { ok: false, kind, label? }.
 */
export function detectImageType(bytes) {
  const b = bytes;
  if (!b || b.length === 0) return { ok: false, kind: 'empty' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ok: true, type: 'image/jpeg' };
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { ok: true, type: 'image/png' };
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF') {
    if (ascii(b, 8, 4) === 'WEBP') return { ok: true, type: 'image/webp' };
    return { ok: false, kind: 'media' };
  }
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return { ok: false, kind: 'gif' };
  if (b.length >= 10 && b[0] === 0x42 && b[1] === 0x4d && b[6] === 0 && b[7] === 0 && b[8] === 0 && b[9] === 0) return { ok: false, kind: 'bmp' };
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) {
    return { ok: false, kind: 'tiff' };
  }
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { ok: false, kind: 'avif' };
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return { ok: false, kind: 'heic' };
    return { ok: false, kind: 'media' };
  }
  if (b.length >= 4 && ascii(b, 0, 4) === '%PDF') return { ok: false, kind: 'pdf' };
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { ok: false, kind: 'ico' };
  const text = ascii(b, 0, Math.min(b.length, 256)).replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return { ok: false, kind: 'svg' };
  return { ok: false, kind: 'unknown' };
}

/* ------------------------------------------------------- Dimensions (header) */

/**
 * Reads pixel dimensions from the file header without decoding the image, so absurdly large files can be
 * refused before any memory is spent on them. Returns { width, height } or null when it cannot tell.
 */
export function readImageDimensions(b, type) {
  try {
    if (type === 'image/png') {
      if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
      const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      return { width: u32(16), height: u32(20) };
    }
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        if (m === 0xd9 || m === 0xda) return null;
        const len = (b[i + 2] << 8) | b[i + 3];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] };
        }
        i += 2 + len;
      }
      return null;
    }
    if (type === 'image/webp') {
      const chunk = ascii(b, 12, 4);
      if (chunk === 'VP8X' && b.length >= 30) {
        return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      }
      if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
        return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
      }
      if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/* --------------------------------------------------------------- Validation */

const REASON = {
  empty: 'This file is empty.',
  gif: 'GIF images are not supported. Use a JPG, PNG or WebP file.',
  unknown: 'This file is not a JPG, PNG or WebP image (its contents were not recognised).',
};

/**
 * Validates a file from its size and first bytes. Never trusts the name or MIME type.
 * Returns { ok: true, type, width?, height? } or { ok: false, code, message }.
 */
export function checkImageFile({ size, head }) {
  if (!size) return { ok: false, code: 'empty', message: REASON.empty };
  if (size > MAX_FILE_BYTES) {
    return { ok: false, code: 'too-large', message: `This file is ${formatBytes(size)}. The limit is ${formatBytes(MAX_FILE_BYTES)} per file.` };
  }
  const found = detectImageType(head);
  if (!found.ok) {
    if (found.kind === 'empty') return { ok: false, code: 'empty', message: REASON.empty };
    const label = UNSUPPORTED_LABELS[found.kind];
    if (found.kind === 'unknown' || !label) return { ok: false, code: 'unknown', message: REASON.unknown };
    if (found.kind === 'gif') return { ok: false, code: 'unsupported', message: REASON.gif };
    return { ok: false, code: 'unsupported', message: `${label} files are not supported. Use a JPG, PNG or WebP file.` };
  }
  const dims = readImageDimensions(head, found.type);
  if (dims && (dims.width === 0 || dims.height === 0)) {
    return { ok: false, code: 'corrupt', message: 'This image reports a size of zero, so it looks damaged.' };
  }
  if (dims && dims.width * dims.height > MAX_PIXELS) {
    const mp = Math.round((dims.width * dims.height) / 1e6);
    return {
      ok: false,
      code: 'too-many-pixels',
      message: `This image is ${dims.width.toLocaleString('en-US')} × ${dims.height.toLocaleString('en-US')} px (${mp} megapixels). The limit is ${MAX_PIXELS / 1e6} megapixels.`,
    };
  }
  return { ok: true, type: found.type, ...(dims ?? {}) };
}

/** Identity used to stop the same file being added twice. */
export const fileKey = ({ name, size, lastModified }) => `${name}\u0000${size}\u0000${lastModified ?? 0}`;

/* ------------------------------------------------------------ Output format */

/** choice: 'original' or an image MIME type. */
export function resolveOutputType(sourceType, choice) {
  if (choice && choice !== 'original' && IMAGE_TYPES[choice]) return choice;
  return IMAGE_TYPES[sourceType] ? sourceType : 'image/jpeg';
}

/** JPEG cannot store transparency, so transparent areas need a background colour. */
export const needsBackground = (hasAlpha, outputType) => Boolean(hasAlpha) && outputType === 'image/jpeg';

/** Returns a normalised "#rrggbb" or the fallback. Accepts "#abc", "abc", "#aabbcc", "aabbcc". */
export function normalizeHexColor(value, fallback = '#ffffff') {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!m) return fallback;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return `#${hex}`;
}

/** A string that changes whenever a setting that affects THIS image's output changes. */
export function settingsSignature({ quality, outputType, background, hasAlpha }) {
  return [clampQuality(quality), outputType, needsBackground(hasAlpha, outputType) ? normalizeHexColor(background) : ''].join('|');
}

/* ------------------------------------------------------------------ Names */

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** File name without folders or extension, with characters that are unsafe in file names replaced. */
export function sanitizeBaseName(name) {
  let base = String(name ?? '').replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  if (dot > 0) base = base.slice(0, dot);
  base = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  base = [...base].slice(0, 100).join('');
  if (!base) base = 'image';
  if (RESERVED.test(base)) base = `_${base}`;
  return base;
}

function uniqueName(base, ext, taken) {
  let name = `${base}.${ext}`;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base}-${n++}.${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

/** "holiday photo.PNG" + 'image/webp' -> "holiday photo-compressed.webp" (unique within `taken`). */
export function buildOutputName(originalName, outputType, taken = new Set(), suffix = '-compressed') {
  const ext = IMAGE_TYPES[outputType]?.ext ?? 'img';
  return uniqueName(sanitizeBaseName(originalName) + suffix, ext, taken);
}

/** The original file's own name (sanitised), made unique within `taken`. Used when the original is kept. */
export function buildOriginalName(originalName, sourceType, taken = new Set()) {
  const clean = String(originalName ?? '').replace(/^.*[\\/]/, '');
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && /^[a-z0-9]{1,5}$/i.test(clean.slice(dot + 1)) ? clean.slice(dot + 1).toLowerCase() : (IMAGE_TYPES[sourceType]?.ext ?? 'img');
  return uniqueName(sanitizeBaseName(originalName), ext, taken);
}

/* --------------------------------------------------------------- Formatting */

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** Size change: { direction: 'smaller' | 'larger' | 'same', bytes (absolute), percent (absolute, rounded) }. */
export function compareSizes(originalSize, newSize) {
  const diff = originalSize - newSize;
  const percent = originalSize > 0 ? (Math.abs(diff) / originalSize) * 100 : 0;
  return {
    direction: diff > 0 ? 'smaller' : diff < 0 ? 'larger' : 'same',
    bytes: Math.abs(diff),
    percent: percent < 10 ? Math.round(percent * 10) / 10 : Math.round(percent),
  };
}

export function describeSizeChange(originalSize, newSize) {
  const c = compareSizes(originalSize, newSize);
  if (c.direction === 'same') return 'No change in size';
  if (c.direction === 'smaller') return `Saved ${formatBytes(c.bytes)} (${c.percent}%)`;
  return `Larger by ${formatBytes(c.bytes)} (+${c.percent}%)`;
}

/** Totals over finished items: [{ originalSize, size }]. */
export function summarizeBatch(items) {
  const original = items.reduce((s, i) => s + i.originalSize, 0);
  const result = items.reduce((s, i) => s + i.size, 0);
  return { count: items.length, original, result, ...compareSizes(original, result) };
}

export const formatDimensions = (w, h) => (w && h ? `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px` : '');
