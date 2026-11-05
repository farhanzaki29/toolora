/**
 * Image Resizer: pure logic (dimension rules). No DOM, canvas, storage or network access.
 *
 * File identification, size/pixel limits, output-type rules, naming and formatting are shared with the
 * Image Compressor (src/lib/imageCompressor.js); this file only adds what is specific to resizing.
 *
 * Rounding: every calculation uses integer arithmetic and rounds half UP, so results are exact and repeatable
 * (no floating-point surprises such as 166.49999 instead of 166.5).
 */
import { MAX_PIXELS, buildOutputName } from './imageCompressor.js';

export const MIN_DIMENSION = 1;
/** Largest width or height of a result. Browsers differ; most canvases handle at least this. */
export const MAX_DIMENSION = 16384;
/** Largest result in pixels: the same 100-megapixel limit used for input images. */
export const MAX_OUTPUT_PIXELS = MAX_PIXELS;
export const PERCENT_MIN = 1;
export const PERCENT_MAX = 1000;
export const PERCENT_PRESETS = [25, 50, 75, 100, 150, 200];
/** JPEG and WebP results are saved at this fixed, high quality (percent) so resizing adds little extra loss. */
export const RESIZE_QUALITY = 92;

/** Common dimensions. They are a convenience, not a guarantee of what any platform needs. */
export const SIZE_PRESETS = [
  { id: '1920x1080', width: 1920, height: 1080, note: 'Full HD, 16:9 landscape' },
  { id: '1280x720', width: 1280, height: 720, note: 'HD, 16:9 landscape' },
  { id: '1080x1080', width: 1080, height: 1080, note: 'Square, 1:1' },
  { id: '1080x1350', width: 1080, height: 1350, note: 'Portrait, 4:5' },
  { id: '1080x1920', width: 1080, height: 1920, note: 'Tall, 9:16' },
];

/* ------------------------------------------------------------- Input parsing */

/** Parses a width/height typed by the user. Whole pixels only. */
export function parseDimension(text) {
  const s = String(text ?? '').trim();
  if (s === '') return { ok: false, code: 'empty', message: 'Enter a number of pixels.' };
  if (!/^\d+$/.test(s)) return { ok: false, code: 'format', message: 'Use whole pixels, for example 800.' };
  const value = Number(s);
  if (value < MIN_DIMENSION) return { ok: false, code: 'zero', message: `Must be at least ${MIN_DIMENSION} pixel.` };
  if (value > MAX_DIMENSION) return { ok: false, code: 'max', message: `Must be ${MAX_DIMENSION.toLocaleString('en-US')} pixels or less.` };
  return { ok: true, value };
}

/** Parses a percentage (whole number, or up to two decimals). */
export function parsePercent(text) {
  const s = String(text ?? '').trim().replace(/%$/, '').trim();
  if (s === '') return { ok: false, code: 'empty', message: 'Enter a percentage.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, code: 'format', message: 'Use a number such as 50 or 62.5.' };
  const value = Number(s);
  if (value < PERCENT_MIN) return { ok: false, code: 'min', message: `Must be at least ${PERCENT_MIN}%.` };
  if (value > PERCENT_MAX) return { ok: false, code: 'max', message: `Must be ${PERCENT_MAX}% or less.` };
  return { ok: true, value };
}

/* ------------------------------------------------------------------ Arithmetic */

/** round(a / b), halves rounded up, for positive integers. */
export const roundDiv = (a, b) => Math.floor((2 * a + b) / (2 * b));
const atLeastOne = (n) => Math.max(MIN_DIMENSION, n);

/** Height that keeps the original proportions for a new width. */
export const heightForWidth = (origW, origH, width) => atLeastOne(roundDiv(width * origH, origW));
/** Width that keeps the original proportions for a new height. */
export const widthForHeight = (origW, origH, height) => atLeastOne(roundDiv(height * origW, origH));

/** Scales both sides by a percentage. Percentages with up to two decimals are handled exactly. */
export function scaleByPercent(origW, origH, percent) {
  const p = Math.round(percent * 100); // hundredths of a percent, as an integer
  return { width: atLeastOne(roundDiv(origW * p, 10000)), height: atLeastOne(roundDiv(origH * p, 10000)) };
}

/**
 * Largest size that fits inside a box without cropping or stretching (proportions kept).
 * With allowEnlarge=false an image that already fits is returned unchanged.
 */
export function fitWithin(origW, origH, boxW, boxH, { allowEnlarge = true } = {}) {
  if (!allowEnlarge && origW <= boxW && origH <= boxH) return { width: origW, height: origH };
  if (boxW * origH <= boxH * origW) {
    // width is the limiting side
    return { width: boxW, height: Math.min(boxH, heightForWidth(origW, origH, boxW)) };
  }
  return { width: Math.min(boxW, widthForHeight(origW, origH, boxH)), height: boxH };
}

/** How much the proportions change, as a fraction (0 = identical, 0.1 = 10% stretched or squashed). */
export function aspectChange(origW, origH, w, h) {
  const a = (w * origH) / (h * origW);
  return Math.abs(a - 1);
}

/** Checks a RESULT size against the browser-friendly limits. */
export function checkOutputSize(width, height) {
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { ok: false, code: 'too-wide', message: `The result would be ${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')} px. Each side can be at most ${MAX_DIMENSION.toLocaleString('en-US')} px.` };
  }
  if (width * height > MAX_OUTPUT_PIXELS) {
    return { ok: false, code: 'too-many-pixels', message: `The result would be ${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')} px (${Math.round((width * height) / 1e6)} megapixels). The limit is ${MAX_OUTPUT_PIXELS / 1e6} megapixels.` };
  }
  return { ok: true };
}

/* --------------------------------------------------------------- Target size */

/**
 * The size an image will be resized to under the current settings.
 *
 * settings:
 *   { mode: 'custom',  custom:  { width, height, lock, driver } }   width/height: whole numbers or null
 *                                 lock=true: `driver` ('width' | 'height') is applied to every image and the other
 *                                            side follows that image's own proportions.
 *                                 lock=false: both are applied exactly (may stretch).
 *   { mode: 'percent', percent: number }
 *   { mode: 'preset',  preset: id, allowEnlarge: boolean }
 *
 * Returns { ok: true, width, height, unchanged, enlarged, stretch } or { ok: false, code, message }.
 */
export function computeTarget(img, settings) {
  const { width: ow, height: oh } = img;
  if (!ow || !oh) return { ok: false, code: 'unknown-size', message: 'The size of this image is not known yet.' };
  let w;
  let h;

  if (settings.mode === 'percent') {
    if (!Number.isFinite(settings.percent)) return { ok: false, code: 'missing', message: 'Enter a percentage.' };
    ({ width: w, height: h } = scaleByPercent(ow, oh, settings.percent));
  } else if (settings.mode === 'preset') {
    const preset = SIZE_PRESETS.find((p) => p.id === settings.preset);
    if (!preset) return { ok: false, code: 'missing', message: 'Choose a size.' };
    ({ width: w, height: h } = fitWithin(ow, oh, preset.width, preset.height, { allowEnlarge: settings.allowEnlarge !== false }));
  } else {
    const c = settings.custom ?? {};
    if (c.lock !== false) {
      if (c.driver === 'height') {
        if (!c.height) return { ok: false, code: 'missing', message: 'Enter a height.' };
        h = c.height;
        w = widthForHeight(ow, oh, h);
      } else {
        if (!c.width) return { ok: false, code: 'missing', message: 'Enter a width.' };
        w = c.width;
        h = heightForWidth(ow, oh, w);
      }
    } else {
      if (!c.width || !c.height) return { ok: false, code: 'missing', message: 'Enter both a width and a height.' };
      w = c.width;
      h = c.height;
    }
  }

  const size = checkOutputSize(w, h);
  if (!size.ok) return size;
  return {
    ok: true,
    width: w,
    height: h,
    unchanged: w === ow && h === oh,
    enlarged: w > ow || h > oh,
    stretch: aspectChange(ow, oh, w, h) > 0.01,
  };
}

/** The other side of a locked pair, shown next to the one the user typed, based on a reference image. */
export function pairedDimension(ref, driver, value) {
  if (!ref || !ref.width || !ref.height || !value) return null;
  return driver === 'height' ? widthForHeight(ref.width, ref.height, value) : heightForWidth(ref.width, ref.height, value);
}

/* --------------------------------------------------------------------- Names */

/** "holiday photo.PNG" -> "holiday photo-800x600.webp" (unique within `taken`). */
export const buildResizedName = (originalName, outputType, width, height, taken) =>
  buildOutputName(originalName, outputType, taken, `-${width}x${height}`);

/** A string that changes when anything that affects an image's OUTPUT changes. */
export function resizeSignature({ target, outputType, background, needsBg }) {
  return [target.width, target.height, outputType, needsBg ? background : ''].join('|');
}
