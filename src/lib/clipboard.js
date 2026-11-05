/**
 * Clipboard + file download helpers (browser only). Nothing here logs, stores or transmits the text.
 */

/** Copies text. Resolves true on success, false if the browser refused. Never throws. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  // Legacy fallback: a temporary off-screen textarea (does not touch the page's own fields).
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(helper);
  const active = document.activeElement;
  helper.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  helper.remove();
  if (active && typeof active.focus === 'function') active.focus();
  return ok;
}

/** Downloads text as a file via a Blob URL, then revokes the URL. Returns the Blob size in bytes. */
export function downloadText(text, filename, type = 'application/json;charset=utf-8') {
  return downloadBlob(new Blob([text], { type }), filename);
}

/** Downloads any Blob (text, image, ...) as a file, then revokes the temporary URL. Returns its size in bytes. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the temporary URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob.size;
}
