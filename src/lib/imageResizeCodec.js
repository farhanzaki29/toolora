/**
 * Image Resizer: the browser-only part (drawing at the new size and encoding).
 * Decoding, thumbnails, transparency detection and yielding are shared with the Image Compressor
 * (src/lib/imageCodec.js); nothing here is tied to the Compressor's user interface.
 *
 * Quality: large reductions are done in steps of at most 2:1, each with the browser's high-quality smoothing,
 * which avoids the harsh aliasing a single big jump can produce. The exported file is then inspected: its REAL
 * format and size are read from its own bytes, so a mislabelled or wrongly sized file is reported, never hidden.
 */
import { CodecError, decodeImage, yieldToBrowser } from './imageCodec.js';
import { detectImageType, readImageDimensions, normalizeHexColor, canvasQuality } from './imageCompressor.js';
import { RESIZE_QUALITY } from './imageResizer.js';

const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawSmooth(ctx, source, w, h) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
}

/**
 * Draws `source` (sw x sh) at dw x dh. When shrinking by more than 2:1 it goes through half-size steps.
 * Returns { canvas, cleanup } where `canvas` holds the final pixels; cleanup() frees every temporary canvas.
 */
async function scaleDown(source, sw, sh, dw, dh, { shouldCancel, finalAlpha, background }) {
  const temps = [];
  let current = source;
  let cw = sw;
  let ch = sh;
  const free = () => temps.forEach((c) => { c.width = c.height = 0; });
  try {
    while (dw * 2 < cw || dh * 2 < ch) {
      if (shouldCancel?.()) throw new CodecError('cancelled', 'Cancelled.');
      const nw = Math.max(dw, Math.ceil(cw / 2));
      const nh = Math.max(dh, Math.ceil(ch / 2));
      const step = makeCanvas(nw, nh);
      const sctx = step.getContext('2d');
      if (!sctx) throw new CodecError('canvas-failed', 'This image is too large for your browser to process.');
      drawSmooth(sctx, current, nw, nh);
      temps.push(step);
      if (current !== source) {
        const prev = temps[temps.length - 2];
        prev.width = prev.height = 0; // release the previous step as soon as it has been used
      }
      current = step;
      cw = nw;
      ch = nh;
      await yieldToBrowser();
    }
    if (shouldCancel?.()) throw new CodecError('cancelled', 'Cancelled.');
    const out = makeCanvas(dw, dh);
    const ctx = out.getContext('2d', { alpha: finalAlpha });
    if (!ctx) throw new CodecError('canvas-failed', 'This image is too large for your browser to process.');
    if (!finalAlpha) {
      ctx.fillStyle = normalizeHexColor(background);
      ctx.fillRect(0, 0, dw, dh);
    }
    drawSmooth(ctx, current, dw, dh);
    return { canvas: out, free };
  } catch (e) {
    free();
    throw e;
  }
}

/**
 * Resizes a decoded image and encodes it.
 * @param decoded  result of decodeImage()
 * @param {{ width: number, height: number, type: string, background?: string, shouldCancel?: () => boolean }} o
 * @returns {{ blob, requestedType, actualType, width, height }} `actualType`/`width`/`height` come from the bytes of the
 *   exported file itself, not from what was requested.
 */
export async function resizeImage(decoded, { width, height, type, background = '#ffffff', shouldCancel }) {
  const jpeg = type === 'image/jpeg';
  const { canvas, free } = await scaleDown(decoded.source, decoded.width, decoded.height, width, height, {
    shouldCancel,
    finalAlpha: !jpeg,
    background,
  });
  try {
    const blob = await canvasToBlob(canvas, type, type === 'image/png' ? undefined : canvasQuality(RESIZE_QUALITY));
    if (!blob) throw new CodecError('encode-failed', 'Your browser could not create the resized image. The result may be too large for it.');

    // Inspect the real file: format and pixel size come from its own header, not from the Blob label.
    const head = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer());
    const sniffed = detectImageType(head);
    const actualType = sniffed.ok ? sniffed.type : blob.type;
    const real = readImageDimensions(head, actualType);
    if (real && (real.width !== width || real.height !== height)) {
      throw new CodecError(
        'size-mismatch',
        `Your browser produced a ${real.width} × ${real.height} px image instead of ${width} × ${height} px (it may limit very large canvases). Try a smaller size.`
      );
    }
    return { blob, requestedType: type, actualType, width, height };
  } finally {
    canvas.width = canvas.height = 0;
    free();
  }
}

/** Decode, resize, encode, and always release the decoded image. */
export async function resizeFile(file, options) {
  const decoded = await decodeImage(file);
  try {
    return await resizeImage(decoded, options);
  } finally {
    decoded.release();
  }
}
