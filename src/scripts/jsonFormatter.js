/**
 * JSON Formatter UI controller. Everything runs locally in the browser:
 * the JSON is never sent anywhere, never stored (no localStorage/sessionStorage) and never logged.
 */
import { validateJson, formatJson, minifyJson, byteLength, countLines, formatBytes, EXAMPLE_JSON } from '../lib/jsonFormatter.js';
import { copyText, downloadText } from '../lib/clipboard.js';
import { createVirtualViewer } from './virtualViewer.js';

const root = document.querySelector('[data-jf]');

if (root) {
  const $ = (s) => root.querySelector(s);
  const input = $('[data-jf-input]');
  const output = $('[data-jf-output]'); // native textarea, for ordinary-sized output
  const viewerEl = $('[data-jf-viewer]'); // windowed viewer, for very large output
  const viewNote = $('[data-jf-view-note]');
  const viewer = createVirtualViewer(viewerEl);
  const btn = {
    format: $('[data-jf-format]'),
    minify: $('[data-jf-minify]'),
    validate: $('[data-jf-validate]'),
    example: $('[data-jf-example]'),
    clear: $('[data-jf-clear]'),
    copy: $('[data-jf-copy]'),
    download: $('[data-jf-download]'),
    jump: $('[data-jf-jump]'),
  };
  const inputActions = $('[data-jf-input-actions]');
  const confirmBox = $('[data-jf-confirm]');
  const confirmText = $('[data-jf-confirm-text]');
  const confirmYes = $('[data-jf-confirm-yes]');
  const confirmNo = $('[data-jf-confirm-no]');
  const status = $('[data-jf-status]');
  const statusTitle = $('[data-jf-status-title]');
  const statusDetail = $('[data-jf-status-detail]');
  const errBox = $('[data-jf-error]');
  const errLoc = $('[data-jf-error-loc]');
  const errFrame = $('[data-jf-error-frame]');
  const errHint = $('[data-jf-error-hint]');
  const inputMeta = $('[data-jf-input-meta]');
  const outputMeta = $('[data-jf-output-meta]');
  const stale = $('[data-jf-stale]');
  const outputEmpty = $('[data-jf-output-empty]');
  const toast = $('[data-jf-toast]');
  const indentRadios = [...root.querySelectorAll('input[name="indent"]')];

  const INDENT_LABEL = { '2': '2 spaces', '4': '4 spaces', tab: 'tabs' };
  const LARGE = 300000; // characters: show a busy state first, and debounce live updates
  const VIEWER_MIN_LINES = 4000; // above this the output uses the windowed viewer (a textarea takes seconds)
  const VIEWER_MAX_LINES = 1000000; // browsers cap element height, so extremely long output is previewed

  /** State of the output panel. `source` is the exact input text the output was made from. */
  let outputText = '';
  let outputLines = 0;
  let mode = null; // 'format' | 'minify' | null
  let source = null;
  let lastError = null;

  const hasInput = () => /\S/.test(input.value);
  const indent = () => indentRadios.find((r) => r.checked)?.value ?? '2';

  /* ------------------------------------------------------------------ Rendering */

  const setStatus = (state, title, detail = '') => {
    status.dataset.state = state;
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
  };

  const showOutputState = (state) => {
    // state: 'result' | 'idle' | 'error'. (For 'result', setOutputView decides textarea vs viewer.)
    if (state !== 'result') {
      output.hidden = true;
      viewerEl.hidden = true;
      viewNote.hidden = true;
    }
    outputEmpty.hidden = state === 'result';
    outputEmpty.dataset.state = state;
    outputEmpty.querySelector('[data-jf-output-empty-title]').textContent =
      state === 'error' ? 'No output' : 'Output appears here';
    outputEmpty.querySelector('[data-jf-output-empty-text]').textContent =
      state === 'error'
        ? 'The input is not valid JSON, so nothing was formatted. Your original input has not been changed.'
        : 'Choose Format or Minify to see the result.';
  };

  const renderControls = () => {
    const has = hasInput();
    btn.format.disabled = btn.minify.disabled = btn.validate.disabled = !has;
    btn.clear.disabled = !has && !outputText;
    btn.example.disabled = false;
    const hasOutput = outputText !== '';
    btn.copy.disabled = btn.download.disabled = !hasOutput;
    stale.hidden = !(hasOutput && source !== input.value);
  };

  const renderInputMeta = () => {
    const v = input.value;
    inputMeta.textContent = v ? `${countLines(v).toLocaleString()} ${countLines(v) === 1 ? 'line' : 'lines'} · ${formatBytes(byteLength(v))}` : 'Empty';
  };

  /** Puts the result on screen: a native textarea normally, the windowed viewer when it is very long. */
  const setOutputView = (text) => {
    outputLines = countLines(text);
    showOutputState('result');
    if (outputLines <= VIEWER_MIN_LINES) {
      viewer.clear();
      viewerEl.hidden = true;
      viewNote.hidden = true;
      output.hidden = false;
      output.value = text;
      output.scrollTop = 0;
      output.scrollLeft = 0;
      return;
    }
    output.value = '';
    output.hidden = true;
    viewerEl.hidden = false;
    const shown = viewer.setText(text, VIEWER_MAX_LINES);
    viewNote.hidden = false;
    viewNote.textContent =
      shown < outputLines
        ? `Very large result: previewing the first ${shown.toLocaleString()} of ${outputLines.toLocaleString()} lines. Copy or Download gives the complete output.`
        : 'Large result: only the visible lines are drawn, so your browser\u2019s Find won\u2019t search the rest. Copy or Download gives the complete output.';
  };

  const renderOutputMeta = () => {
    if (!outputText) {
      outputMeta.textContent = '';
      return;
    }
    const label = mode === 'minify' ? 'Minified' : `Formatted · ${INDENT_LABEL[indent()]}`;
    outputMeta.textContent = `${label} · ${outputLines.toLocaleString()} ${outputLines === 1 ? 'line' : 'lines'} · ${formatBytes(byteLength(outputText))}`;
  };

  const showError = (error) => {
    lastError = error;
    setStatus('invalid', 'Invalid JSON', error.line != null ? `Line ${error.line}, column ${error.column}` : '');
    errBox.hidden = false;
    errLoc.textContent = error.message;
    errHint.textContent = error.hint ?? '';
    errHint.hidden = !error.hint;
    if (error.frame) {
      errFrame.hidden = false;
      errFrame.textContent = `${error.frame.text}\n${' '.repeat(error.frame.caret)}^`;
    } else {
      errFrame.hidden = true;
      errFrame.textContent = '';
    }
    btn.jump.hidden = error.position == null;
  };

  const clearError = () => {
    lastError = null;
    errBox.hidden = true;
    errFrame.textContent = '';
  };

  const clearOutput = () => {
    outputText = '';
    outputLines = 0;
    output.value = '';
    viewer.clear();
    mode = null;
    source = null;
    renderOutputMeta();
  };

  /* -------------------------------------------------------------------- Toast */

  let toastTimer;
  const say = (message, kind = 'ok', ms = 3500) => {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.kind = kind;
    if (ms) toastTimer = window.setTimeout(() => { toast.textContent = ''; delete toast.dataset.kind; }, ms);
  };

  /* ------------------------------------------------------------------ Actions */

  // Large documents: let the browser paint a "working" state before the synchronous work begins.
  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  let running = false;
  async function run(action) {
    if (running || !hasInput()) return;
    const text = input.value;
    running = true;
    try {
      if (text.length > LARGE) {
        setStatus('busy', 'Working…', `${formatBytes(byteLength(text))}`);
        root.setAttribute('aria-busy', 'true');
        await nextPaint();
      }
      const result = action === 'minify' ? minifyJson(text) : action === 'validate' ? validateJson(text) : formatJson(text, indent());

      if (!result.ok) {
        // Invalid: report it, drop any previous output, and leave the user's input exactly as it was.
        // (Validate never touches the output: the "out of date" badge already tells the user.)
        if (action !== 'validate') {
          clearOutput();
          showOutputState('error');
        }
        showError(result.error);
        return;
      }

      clearError();
      if (action === 'validate') {
        setStatus('valid', 'Valid JSON', result.summary);
        // A validate-only run leaves any existing output alone.
        if (!outputText) showOutputState('idle');
        return;
      }
      mode = action;
      source = text;
      outputText = result.output;
      setOutputView(outputText);
      setStatus('valid', 'Valid JSON', `${result.summary} · ${action === 'minify' ? 'minified' : `formatted with ${INDENT_LABEL[indent()]}`}`);
      renderOutputMeta();
    } finally {
      running = false;
      root.removeAttribute('aria-busy');
      renderControls();
    }
  }

  btn.format.addEventListener('click', () => run('format'));
  btn.minify.addEventListener('click', () => run('minify'));
  btn.validate.addEventListener('click', () => run('validate'));

  // Changing indentation re-formats the current output (never the input).
  indentRadios.forEach((r) =>
    r.addEventListener('change', () => {
      if (mode === 'format' && hasInput()) run('format');
    })
  );

  /* ------------------------------------------------------------- Jump to error */

  btn.jump.addEventListener('click', () => {
    if (!lastError || lastError.position == null) return;
    const pos = Math.min(lastError.position, input.value.length);
    input.focus();
    input.setSelectionRange(pos, Math.min(pos + 1, input.value.length));
    // Bring the position into view (textarea does not always scroll to a programmatic selection).
    const style = getComputedStyle(input);
    const lh = parseFloat(style.lineHeight) || 20;
    input.scrollTop = Math.max(0, (lastError.line - 1) * lh - input.clientHeight / 2);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    const cw = ctx.measureText('0').width || 8;
    input.scrollLeft = Math.max(0, (lastError.column - 1) * cw - input.clientWidth / 2);
  });

  /* ------------------------------------------------------- Copy and download */

  const outputName = () => (mode === 'minify' ? 'minified' : 'formatted');

  btn.copy.addEventListener('click', async () => {
    if (!outputText) return;
    const ok = await copyText(outputText);
    if (ok) say(`Copied ${outputName()} JSON to the clipboard.`);
    else say('Couldn’t copy automatically. Select the output and press Ctrl+C (⌘C on Mac).', 'bad', 7000);
  });

  btn.download.addEventListener('click', () => {
    if (!outputText) return;
    try {
      const size = downloadText(outputText, `${outputName()}.json`);
      say(`Downloaded ${outputName()}.json (${formatBytes(size)}).`);
    } catch {
      say('Couldn’t start the download in this browser. Use Copy instead.', 'bad', 7000);
    }
  });

  /* ------------------------------------------------- Clear / Load example (confirm) */

  let pending = null;
  let origin = null; // the button that opened the prompt, so focus can return to it
  const askConfirm = (message, yesLabel, onYes, from) => {
    pending = onYes;
    origin = from;
    confirmText.textContent = message;
    confirmYes.textContent = yesLabel;
    inputActions.hidden = true;
    confirmBox.hidden = false;
    confirmNo.focus(); // safest default: keep the user's input
  };
  const closeConfirm = (returnFocus = false) => {
    pending = null;
    confirmBox.hidden = true;
    inputActions.hidden = false;
    if (returnFocus) origin?.focus();
  };

  const doClear = () => {
    input.value = '';
    clearOutput();
    clearError();
    showOutputState('idle');
    setStatus('idle', 'Ready', 'Paste JSON, then choose Format, Minify or Validate.');
    renderInputMeta();
    renderControls();
    input.focus();
    say('Cleared input and output.');
  };
  const doExample = () => {
    input.value = EXAMPLE_JSON;
    clearOutput();
    clearError();
    showOutputState('idle');
    setStatus('idle', 'Example loaded', 'Choose Format, Minify or Validate.');
    renderInputMeta();
    renderControls();
    input.focus();
    input.setSelectionRange(0, 0);
    say('Loaded the example.');
  };

  btn.clear.addEventListener('click', () => {
    if (!hasInput() && !outputText) return;
    askConfirm('Clear the input and output?', 'Yes, clear', doClear, btn.clear);
  });
  btn.example.addEventListener('click', () => {
    if (!input.value) doExample();
    else askConfirm('Replace your input with the example?', 'Yes, replace', doExample, btn.example);
  });
  confirmYes.addEventListener('click', () => {
    const fn = pending;
    closeConfirm();
    fn?.();
  });
  confirmNo.addEventListener('click', () => closeConfirm(true));
  confirmBox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeConfirm(true);
  });

  /* ------------------------------------------------------------- Input events */

  let queued = false;
  let timer;
  const onInput = () => {
    renderControls();
    window.clearTimeout(timer);
    if (input.value.length > LARGE) {
      queued = false;
      timer = window.setTimeout(renderInputMeta, 250);
      return;
    }
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderInputMeta();
    });
  };
  input.addEventListener('input', onInput);

  // Ctrl/Cmd + Enter formats.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run('format');
    }
  });

  /* --------------------------------------------------------------------- Init */

  showOutputState('idle');
  setStatus('idle', 'Ready', 'Paste JSON, then choose Format, Minify or Validate.');
  renderInputMeta();
  renderControls();
}
