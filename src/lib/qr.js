/**
 * Thin wrapper around the QR library (lean-qr, MIT, no dependencies, runs entirely in the browser),
 * plus SVG / canvas rendering. Keeping the library behind this file means it can be swapped in one place.
 *
 * The output is a genuine QR code: ISO/IEC 18004 byte/alphanumeric encoding with Reed-Solomon error
 * correction, rendered as black modules on a white background with the 4-module quiet zone the
 * specification requires.
 */
import { generate, mode } from 'lean-qr';

export const QUIET_ZONE = 4; // modules, per the QR specification
const ERROR_CORRECTION = { L: 0, M: 1, Q: 2, H: 3 };

// Text is encoded as numeric / alphanumeric / plain ASCII where possible, and as UTF-8 (with its ECI marker)
// otherwise. The library's default would use ISO-8859-1 for characters such as "e-acute", which many scanners
// and all WiFi stacks read as UTF-8; restricting the modes makes every non-ASCII name encode the same way.
const MODES = [mode.numeric, mode.alphaNumeric, mode.ascii, mode.utf8];

/** Returns { size, get(x, y) } where get() is true for a dark module. Throws if the text is too long. */
export function makeQr(text, level = 'M') {
  const code = generate(mode.auto(text, { modes: MODES }), { minCorrectionLevel: ERROR_CORRECTION[level] ?? 1 });
  return { size: code.size, get: (x, y) => code.get(x, y) };
}

/** Horizontal runs of dark modules: [[y, x, length], ...]. Shared by the SVG and canvas renderers. */
export function darkRuns(code) {
  const runs = [];
  for (let y = 0; y < code.size; y++) {
    let x = 0;
    while (x < code.size) {
      if (!code.get(x, y)) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < code.size && code.get(end, y)) end++;
      runs.push([y, x, end - x]);
      x = end;
    }
  }
  return runs;
}

/** SVG markup (numbers only; no user text is ever put into it). */
export function qrToSvg(code, { quiet = QUIET_ZONE, dark = '#000000', light = '#ffffff', xmlns = true } = {}) {
  const total = code.size + quiet * 2;
  const path = darkRuns(code)
    .map(([y, x, len]) => `M${x + quiet} ${y + quiet}h${len}v1h-${len}z`)
    .join('');
  return (
    `<svg ${xmlns ? 'xmlns="http://www.w3.org/2000/svg" ' : ''}viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<path fill="${dark}" d="${path}"/></svg>`
  );
}

/** Draws the code (with quiet zone) onto a canvas at an integer pixel scale. Returns the canvas size in px. */
export function drawQrToCanvas(code, canvas, targetPx = 1024, { quiet = QUIET_ZONE, dark = '#000000', light = '#ffffff' } = {}) {
  const total = code.size + quiet * 2;
  const scale = Math.max(1, Math.floor(targetPx / total)); // integer scale keeps every module pixel-sharp
  const px = total * scale;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = dark;
  for (const [y, x, len] of darkRuns(code)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, len * scale, scale);
  return px;
}
