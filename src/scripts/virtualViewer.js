/**
 * A tiny read-only "virtual" text viewer for very large monospace text.
 *
 * Browsers render a <textarea> with 100k+ lines very slowly (seconds), so only the lines that are
 * visible (plus a small buffer) are put in the DOM; a spacer element gives the scrollbar its full size.
 * Each line must be a fixed height (`--vlh` in CSS, in px). Used by the JSON Formatter for big output.
 *
 * Expected CSS on the host element: overflow:auto; position:relative; font + line-height set.
 */
export function createVirtualViewer(host) {
  const sizer = document.createElement('div');
  const pre = document.createElement('pre');
  sizer.className = 'vsizer';
  pre.className = 'vlines';
  sizer.appendChild(pre);
  host.appendChild(sizer);

  const BUFFER = 40; // extra lines drawn above and below the visible area
  let lines = [];
  let lineHeight = 21;
  let charWidth = 8;
  const PAD_Y = 14; // px of space above/below and to the left/right of the text
  const PAD_X = 16;
  let first = -1; // first rendered line
  let last = -1; // one past the last rendered line
  let raf = 0;

  const measure = () => {
    const cs = getComputedStyle(host);
    lineHeight = parseFloat(cs.getPropertyValue('--vlh')) || parseFloat(cs.lineHeight) || 21;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
    probe.textContent = '0'.repeat(100);
    host.appendChild(probe);
    charWidth = probe.getBoundingClientRect().width / 100 || 8;
    probe.remove();
  };

  const render = (force = false) => {
    if (!lines.length) return;
    const visibleStart = Math.max(0, Math.floor(host.scrollTop / lineHeight));
    const visibleCount = Math.ceil(host.clientHeight / lineHeight) + 1;
    const visibleEnd = Math.min(lines.length, visibleStart + visibleCount);
    // Still inside the already-drawn window with a margin: nothing to do.
    if (!force && first !== -1 && visibleStart >= first + 3 && visibleEnd <= last - 3) return;
    first = Math.max(0, visibleStart - BUFFER);
    last = Math.min(lines.length, visibleEnd + BUFFER);
    pre.textContent = lines.slice(first, last).join('\n');
    pre.style.transform = `translateY(${first * lineHeight}px)`;
  };

  host.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        render();
      });
    },
    { passive: true }
  );
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => render(true)).observe(host);

  return {
    /**
     * Shows `text`. At most `maxLines` lines are drawn (browsers cap element height at ~33M px).
     * Returns the number of lines actually available to scroll through.
     */
    setText(text, maxLines = Infinity) {
      measure();
      lines = text.split('\n');
      if (lines.length > maxLines) lines.length = maxLines;
      let maxCols = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let cols = line.length;
        for (let k = 0; k < line.length && line.charCodeAt(k) === 9; k++) cols += 1; // leading tabs are 2 columns wide
        if (cols > maxCols) maxCols = cols;
      }
      sizer.style.height = `${lines.length * lineHeight + PAD_Y * 2}px`;
      sizer.style.minWidth = `${Math.ceil(maxCols * charWidth + PAD_X * 2)}px`;
      pre.style.top = `${PAD_Y}px`;
      pre.style.left = `${PAD_X}px`;
      host.scrollTop = 0;
      host.scrollLeft = 0;
      first = last = -1;
      render(true);
      return lines.length;
    },
    clear() {
      lines = [];
      first = last = -1;
      pre.textContent = '';
      sizer.style.height = '0px';
      sizer.style.minWidth = '0px';
      host.scrollTop = 0;
      host.scrollLeft = 0;
    },
  };
}
