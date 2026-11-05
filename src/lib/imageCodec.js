/**
 * Image Compressor: the browser-only part (decoding, canvas drawing, encoding).
 * Everything happens locally with the browser's own image codecs; nothing is sent anywhere.
 *
 * Notes on honesty: canvas.toBlob silently falls back to PNG when it cannot encode the requested type, so the
 * type of the returned Blob is always checked and reported as `actualType`.
 */
import { canvasQuality, pngBitsForQuality, normalizeHexColor, IMAGE_TYPES } from './imageCompressor.js';

export class CodecError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Lets the browser paint and handle input between chunks of heavy work. Uses scheduler.yield() where available,
 * otherwise a MessageChannel task. (setTimeout(0) would be throttled to about once a second whenever the tab is
 * in the background, which would make a batch crawl if the user switches tabs.)
 */
export const yieldToBrowser = () => {
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
};

const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Which output types this browser can really encode: { 'image/jpeg': true, ... }. */
export async function probeEncoders() {
  const out = {};
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  c.getContext('2d').fillRect(0, 0, 2, 2);
  for (const type of Object.keys(IMAGE_TYPES)) {
    const blob = await canvasToBlob(c, type, 0.8).catch(() => null);
    out[type] = Boolean(blob && blob.type === type);
  }
  c.width = c.height = 0;
  return out;
}

/**
 * Decodes a File into an ImageBitmap (preferred: off the DOM, easily released) or, failing that, an <img>.
 * Returns { source, width, height, release() }. The EXIF orientation is applied by the browser.
 */
export async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      let bitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        if (e instanceof TypeError) bitmap = await createImageBitmap(file); // older browsers reject the option
        else throw e;
      }
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      throw new CodecError('decode-failed', 'This image could not be read. The file may be damaged or not a real image.');
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => { img.src = ''; } };
  } catch {
    throw new CodecError('decode-failed', 'This image could not be read. The file may be damaged or not a real image.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A small canvas element for the list preview (so no full-size image stays on the page). */
export function makeThumbnail(decoded, max = 96) {
  const scale = Math.min(1, max / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** True when any pixel is not fully opaque. Scans in bands so memory stays small. */
export async function hasTransparency(decoded) {
  const { width, height } = decoded;
  const band = Math.max(1, Math.min(height, Math.floor(2_000_000 / width)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = band;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try {
    for (let y = 0; y < height; y += band) {
      const h = Math.min(band, height - y);
      ctx.clearRect(0, 0, width, band);
      ctx.drawImage(decoded.source, 0, y, width, h, 0, 0, width, h);
      const data = ctx.getImageData(0, 0, width, h).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
      if (y + band < height) await yieldToBrowser();
    }
    return false;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** Reduces colour precision in place (alpha is never touched). Done in chunks so the page stays responsive. */
async function reduceColours(ctx, width, height, bits, shouldCancel) {
  const levels = 2 ** bits;
  const step = 255 / (levels - 1);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round(v / step) * step);
  const rows = Math.max(1, Math.floor(1_000_000 / width));
  for (let y = 0; y < height; y += rows) {
    if (shouldCancel?.()) throw new CodecError('cancelled', 'Cancelled.');
    const h = Math.min(rows, height - y);
    const img = ctx.getImageData(0, y, width, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue; // fully transparent: colour is invisible, leave it
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
    ctx.putImageData(img, 0, y);
    await yieldToBrowser();
  }
}

/**
 * Encodes a decoded image.
 * @param decoded  result of decodeImage()
 * @param {{ type: string, quality: number, background?: string, shouldCancel?: () => boolean }} options
 * @returns {{ blob: Blob, requestedType: string, actualType: string, width: number, height: number }}
 *   `actualType` is what the browser REALLY produced; it can differ from `requestedType`.
 */
export async function encodeImage(decoded, { type, quality, background = '#ffffff', shouldCancel }) {
  const { width, height } = decoded;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d', { alpha: type !== 'image/jpeg' });
    if (!ctx) throw new CodecError('canvas-failed', 'This image is too large for your browser to process.');
    if (type === 'image/jpeg') {
      // JPEG has no transparency: transparent areas are filled with the chosen colour.
      ctx.fillStyle = normalizeHexColor(background);
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(decoded.source, 0, 0, width, height);
    if (shouldCancel?.()) throw new CodecError('cancelled', 'Cancelled.');

    if (type === 'image/png') {
      const bits = pngBitsForQuality(quality);
      if (bits < 8) await reduceColours(ctx, width, height, bits, shouldCancel);
    }

    const blob = await canvasToBlob(canvas, type, type === 'image/png' ? undefined : canvasQuality(quality));
    if (!blob) throw new CodecError('encode-failed', 'Your browser could not create the compressed image. It may be too large.');
    return { blob, requestedType: type, actualType: blob.type, width, height };
  } finally {
    canvas.width = canvas.height = 0; // release the pixel buffer immediately
  }
}

/** Full pipeline for one file: decode, encode, and always release the decoded image. */
export async function compressFile(file, options) {
  const decoded = await decodeImage(file);
  try {
    return await encodeImage(decoded, options);
  } finally {
    decoded.release();
  }
}
