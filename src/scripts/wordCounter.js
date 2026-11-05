/**
 * Word Counter UI controller. Everything runs locally in the browser:
 * the text is never sent anywhere, never stored (no localStorage/sessionStorage) and never logged.
 */
import { analyzeText } from '../lib/wordCount.js';

const root = document.querySelector('[data-wc]');

if (root) {
  const input = root.querySelector('[data-wc-input]');
  const copyBtn = root.querySelector('[data-wc-copy]');
  const clearBtn = root.querySelector('[data-wc-clear]');
  const actions = root.querySelector('[data-wc-actions]');
  const confirmBox = root.querySelector('[data-wc-confirm]');
  const confirmYes = root.querySelector('[data-wc-confirm-yes]');
  const confirmNo = root.querySelector('[data-wc-confirm-no]');
  const status = root.querySelector('[data-wc-status]');
  const mini = root.querySelector('[data-wc-mini]');
  const codePointsRow = root.querySelector('[data-wc-codepoints]');
  const codePointsN = root.querySelector('[data-wc-codepoints-n]');
  const out = Object.fromEntries([...root.querySelectorAll('[data-stat]')].map((el) => [el.dataset.stat, el]));

  const fmt = new Intl.NumberFormat();
  const EMPTY = '—';

  /* ---- Rendering ---- */
  const render = () => {
    const text = input.value;
    const s = analyzeText(text);
    const empty = text.length === 0;

    out.words.textContent = fmt.format(s.words);
    out.characters.textContent = fmt.format(s.characters);
    // Shown only when it differs from the standard count (emoji and other astral characters).
    codePointsRow.hidden = s.codePoints === s.characters;
    codePointsN.textContent = fmt.format(s.codePoints);
    out.charactersNoSpaces.textContent = fmt.format(s.charactersNoSpaces);
    out.sentences.textContent = fmt.format(s.sentences);
    out.paragraphs.textContent = fmt.format(s.paragraphs);
    out.readingTime.textContent = s.readingTime ?? EMPTY;
    out.speakingTime.textContent = s.speakingTime ?? EMPTY;
    root.toggleAttribute('data-empty', empty);

    mini.textContent = `${fmt.format(s.words)} ${s.words === 1 ? 'word' : 'words'} · ${fmt.format(s.characters)} ${s.characters === 1 ? 'character' : 'characters'}`;

    copyBtn.disabled = empty;
    clearBtn.disabled = empty;
    if (empty && !confirmBox.hidden) hideConfirm();
  };

  // Coalesce rapid input events (fast typing, large pastes) into one update per frame. For very large
  // documents, wait for a short pause in typing instead, so each keystroke stays responsive.
  const LARGE_TEXT = 150000;
  let queued = false;
  let timer;
  const schedule = () => {
    window.clearTimeout(timer);
    if (input.value.length > LARGE_TEXT) {
      queued = false;
      timer = window.setTimeout(render, 250);
      return;
    }
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };

  /* ---- Status message ---- */
  let statusTimer;
  const say = (message, kind = 'ok', ms = 3000) => {
    window.clearTimeout(statusTimer);
    status.textContent = message;
    status.dataset.kind = kind;
    if (ms) statusTimer = window.setTimeout(() => { status.textContent = ''; delete status.dataset.kind; }, ms);
  };

  /* ---- Copy ---- */
  const legacyCopy = () => {
    // Fallback for browsers/contexts without the async Clipboard API.
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.focus();
    input.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    input.setSelectionRange(start, end);
    return ok;
  };

  copyBtn.addEventListener('click', async () => {
    if (!input.value) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(input.value);
      } else if (!legacyCopy()) {
        throw new Error('copy unavailable');
      }
      say('Copied to clipboard.');
    } catch {
      if (legacyCopy()) say('Copied to clipboard.');
      else say('Couldn’t copy automatically. Select the text and press Ctrl+C (⌘C on Mac).', 'bad', 6000);
    }
  });

  /* ---- Clear (with inline confirmation) ---- */
  function showConfirm() {
    actions.hidden = true;
    confirmBox.hidden = false;
    confirmNo.focus(); // safest default: keep the text
  }
  function hideConfirm() {
    confirmBox.hidden = true;
    actions.hidden = false;
  }

  clearBtn.addEventListener('click', () => {
    if (input.value) showConfirm();
  });
  confirmNo.addEventListener('click', () => {
    hideConfirm();
    clearBtn.focus();
  });
  confirmYes.addEventListener('click', () => {
    input.value = '';
    hideConfirm();
    render();
    input.focus();
    say('Text cleared.');
  });
  confirmBox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideConfirm();
      clearBtn.focus();
    }
  });

  input.addEventListener('input', schedule);
  render();
}
