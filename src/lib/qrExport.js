/**
 * QR export: draws the code at an exact pixel size (PNG) or as a standalone SVG file.
 * Rendering is built from integer rectangles so the same geometry can be tested without a browser.
 * Reuses the QR matrix and SVG writer from qr.js (the same ones the WiFi QR Generator uses).
 */
import { darkRuns, qrToSvg, QUIET_ZONE } from './qr.js';
import { parseHex } from './qrPayload.js';

/** Fewest pixels per module at which cameras read reliably; below this the interface warns. */
export const MIN_MODULE_PX = 3;

export const modulePixels = (code, px) => px / (code.size + QUIET_ZONE * 2);

/**
 * Rectangles [x, y, w, h] (integer pixels) of the dark modules for a canvas of exactly `px` x `px`.
 * Edges are rounded from the exact module position so the code fills the whole canvas, quiet zone included.
 */
export function moduleRects(code, px) {
  const total = code.size + QUIET_ZONE * 2;
  const at = (n) => Math.round((n * px) / total);
  return darkRuns(code).map(([y, x, len]) => {
    const x0 = at(x + QUIET_ZONE);
    const y0 = at(y + QUIET_ZONE);
    return [x0, y0, at(x + QUIET_ZONE + len) - x0, at(y + QUIET_ZONE + 1) - y0];
  });
}

/** Paints the code onto a canvas of exactly px x px. */
export function drawQr(code, canvas, px, { fg = '#000000', bg = '#ffffff' } = {}) {
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = parseHex(bg) ?? '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = parseHex(fg) ?? '#000000';
  for (const [x, y, w, h] of moduleRects(code, px)) ctx.fillRect(x, y, w, h);
  return px;
}

/** Standalone SVG text: numbers and two validated #rrggbb colours only, no scripts and no external references. */
export function svgDocument(code, px, { fg = '#000000', bg = '#ffffff' } = {}) {
  const svg = qrToSvg(code, { dark: parseHex(fg) ?? '#000000', light: parseHex(bg) ?? '#ffffff' });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace('<svg ', `<svg width="${px}" height="${px}" `)}\n`;
}
