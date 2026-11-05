/**
 * JSON Formatter logic. Pure functions: no DOM access, no storage, no network, no logging.
 *
 * How it works
 *  - Validation:  native JSON.parse is the single authority on whether the input is valid.
 *  - Formatting / minifying: once the input is known to be valid, the ORIGINAL TEXT is re-indented or
 *    compacted token by token. Values are never parsed and re-serialised, so nothing is altered:
 *    big numbers keep every digit (12345678901234567890), 1.0 / 1E+2 / -0 stay as written, "é"
 *    escapes stay as written, and key order and duplicate keys are untouched.
 *    (JSON.stringify(JSON.parse(x)) would change all of those.)
 *  - Errors:      the engine's message is cleaned up. Line/column come from the engine's position when it
 *    gives one; otherwise from a small strict locator (findErrorPosition). If neither can say where the
 *    problem is, no location is reported.
 */

export const INDENTS = { '2': '  ', '4': '    ', tab: '\t' };

/* -------------------------------------------------------------------------- Positions & sizes */

/** 1-based line and column for a UTF-16 offset. */
export function positionToLineColumn(text, position) {
  let line = 1;
  let lineStart = 0;
  let idx = text.indexOf('\n');
  while (idx !== -1 && idx < position) {
    line++;
    lineStart = idx + 1;
    idx = text.indexOf('\n', lineStart);
  }
  return { line, column: position - lineStart + 1 };
}

/** UTF-8 size in bytes (what a downloaded file will weigh). */
export function byteLength(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function countLines(text) {
  if (!text) return 0;
  let lines = 1;
  let idx = text.indexOf('\n');
  while (idx !== -1) {
    lines++;
    idx = text.indexOf('\n', idx + 1);
  }
  return lines;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------------------------------------------------------------------- Error location (strict) */

const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * Offset of the first character that makes `text` invalid JSON, or -1 if it is valid.
 * A strict, iterative checker (no recursion, so deep nesting cannot overflow the stack).
 * Only used to find WHERE an error is; JSON.parse still decides IF there is one.
 */
export function findErrorPosition(text) {
  const n = text.length;
  const stack = []; // 'o' | 'a'
  let i = 0;
  let state = 'value'; // value | valueOrClose | key | keyOrClose | after

  const skipWs = () => {
    while (i < n && isWs(text.charCodeAt(i))) i++;
  };
  /** Scans a string starting at the opening quote. Returns -1 when fine, else the error offset. */
  const scanString = () => {
    let j = i + 1;
    for (;;) {
      if (j >= n) return n; // unterminated
      const c = text.charCodeAt(j);
      if (c === 34) {
        i = j + 1;
        return -1;
      }
      if (c < 32) return j; // raw control character
      if (c === 92) {
        const e = text.charCodeAt(j + 1);
        if (e === 117) {
          for (let k = 2; k <= 5; k++) {
            const h = text.charCodeAt(j + k);
            const hex = (h >= 48 && h <= 57) || (h >= 65 && h <= 70) || (h >= 97 && h <= 102);
            if (!hex) return j + k >= n ? n : j + k;
          }
          j += 6;
          continue;
        }
        if ('"\\/bfnrt'.includes(text[j + 1] ?? '\0') && j + 1 < n) {
          j += 2;
          continue;
        }
        return j + 1 >= n ? n : j + 1; // bad escape
      }
      j++;
    }
  };

  for (;;) {
    skipWs();
    if (i >= n) return state === 'after' && stack.length === 0 ? -1 : n;
    const c = text[i];

    if (state === 'key' || state === 'keyOrClose') {
      if (state === 'keyOrClose' && c === '}') {
        stack.pop();
        i++;
        state = 'after';
        continue;
      }
      if (c !== '"') return i;
      const err = scanString();
      if (err !== -1) return err;
      skipWs();
      if (i >= n) return n;
      if (text[i] !== ':') return i;
      i++;
      state = 'value';
      continue;
    }

    if (state === 'value' || state === 'valueOrClose') {
      if (state === 'valueOrClose' && c === ']') {
        stack.pop();
        i++;
        state = 'after';
        continue;
      }
      if (c === '{') {
        stack.push('o');
        i++;
        state = 'keyOrClose';
      } else if (c === '[') {
        stack.push('a');
        i++;
        state = 'valueOrClose';
      } else if (c === '"') {
        const err = scanString();
        if (err !== -1) return err;
        state = 'after';
      } else if (c === '-' || (c >= '0' && c <= '9')) {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(text);
        if (!m) return i + 1 < n && c === '-' ? i + 1 : i;
        i += m[0].length;
        const next = text[i];
        if (next === '.') return i + 1 > n ? n : i + 1; // fraction needs a digit
        if (next === 'e' || next === 'E') {
          let k = i + 1;
          if (text[k] === '+' || text[k] === '-') k++;
          return Math.min(k, n); // exponent needs a digit
        }
        state = 'after';
      } else if (text.startsWith('true', i)) {
        i += 4;
        state = 'after';
      } else if (text.startsWith('false', i)) {
        i += 5;
        state = 'after';
      } else if (text.startsWith('null', i)) {
        i += 4;
        state = 'after';
      } else return i;
      continue;
    }

    // state === 'after'
    if (stack.length === 0) return i; // content after the top-level value
    const top = stack[stack.length - 1];
    if (c === ',') {
      i++;
      state = top === 'o' ? 'key' : 'value';
    } else if ((c === '}' && top === 'o') || (c === ']' && top === 'a')) {
      stack.pop();
      i++;
    } else return i;
  }
}

/* ------------------------------------------------------------------------------ Error reporting */

function cleanMessage(raw) {
  let m = String(raw)
    .replace(/^JSON\.parse:\s*/i, '')
    .replace(/\s*of the JSON data$/i, '')
    .replace(/,\s*(?:\.\.\.)?".*"(?:\.\.\.)?\s*is not valid JSON$/s, '') // V8 appends a snippet of the input
    .replace(/\s+in JSON at position \d+(?:\s*\(line \d+ column \d+\))?$/, '')
    .replace(/\s+at line \d+ column \d+$/, '')
    .replace(/\s+at position \d+$/, '');
  m = m.trim();
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Invalid JSON';
}

function positionFromMessage(raw, text) {
  let m = /\bposition (\d+)/.exec(raw);
  if (m) return Math.min(Number(m[1]), text.length);
  m = /\bline (\d+) column (\d+)/.exec(raw);
  if (m) {
    const line = Number(m[1]);
    const column = Number(m[2]);
    let start = 0;
    for (let l = 1; l < line; l++) {
      const nl = text.indexOf('\n', start);
      if (nl === -1) return null;
      start = nl + 1;
    }
    return Math.min(start + column - 1, text.length);
  }
  return null;
}

function previousNonWhitespace(text, position) {
  for (let i = position - 1; i >= 0; i--) if (!isWs(text.charCodeAt(i))) return text[i];
  return '';
}

/** A plain-language hint when the likely cause is clear from the characters around the error. */
export function hintFor(text, position, rawMessage) {
  const msg = String(rawMessage);
  if (position == null) return null;
  if (position >= text.length) {
    return 'The JSON ends unexpectedly. A closing bracket, brace or quote may be missing.';
  }
  const ch = text[position];
  const prev = previousNonWhitespace(text, position);
  if (ch === '﻿') return 'The text starts with an invisible byte-order mark. Delete the first character and try again.';
  if ((ch === '}' || ch === ']') && prev === ',') return 'Trailing comma: JSON does not allow a comma after the last item.';
  if (ch === "'") return 'JSON uses double quotes ("). Single quotes are not allowed for strings or property names.';
  if (ch === '/') return 'Comments are not allowed in JSON.';
  if (/non-whitespace character after JSON/i.test(msg)) return 'There is extra content after the end of the JSON value. Only one top-level value is allowed.';
  if (/[A-Za-z_$]/.test(ch)) {
    const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(position, position + 40))[0];
    if (word === 'undefined' || word === 'NaN' || word === 'Infinity') return `JSON has no "${word}" value. Use null, a number or a string instead.`;
    if (/property name/i.test(msg)) return 'Property names must be wrapped in double quotes.';
    return 'Text values must be wrapped in double quotes. Only true, false and null may appear without quotes.';
  }
  if (/control character/i.test(msg)) return 'Line breaks and tabs inside a string must be escaped as \\n and \\t.';
  if (/expected ',' or/i.test(msg)) return 'A comma may be missing between the previous item and this one.';
  return null;
}

/** A short excerpt of the offending line with a caret offset, safe for monospace display. */
function codeFrame(text, position) {
  const start = text.lastIndexOf('\n', position - 1) + 1;
  let end = text.indexOf('\n', position);
  if (end === -1) end = text.length;
  let line = text.slice(start, end).replace(/\t/g, ' ').replace(/\r$/, '');
  let caret = position - start;
  const WINDOW = 70;
  let prefix = '';
  if (line.length > WINDOW * 2) {
    const from = Math.max(0, caret - WINDOW);
    const to = Math.min(line.length, caret + WINDOW);
    prefix = from > 0 ? '…' : '';
    line = prefix + line.slice(from, to) + (to < line.length ? '…' : '');
    caret = caret - from + prefix.length;
  }
  return { text: line, caret: Math.max(0, Math.min(caret, line.length)) };
}

function describeError(text, rawMessage) {
  const blank = text.trim() === ''; // nothing to point at in empty input
  let position = blank ? null : positionFromMessage(rawMessage, text);
  let located = position != null ? 'engine' : null;
  if (position == null && !blank) {
    const found = findErrorPosition(text);
    if (found !== -1) {
      position = found;
      located = 'locator';
    }
  }
  const error = { message: cleanMessage(rawMessage), position: null, line: null, column: null, frame: null, hint: null, located };
  if (position != null) {
    const { line, column } = positionToLineColumn(text, position);
    error.position = position;
    error.line = line;
    error.column = column;
    error.frame = position < text.length || text.length === 0 ? codeFrame(text, position) : codeFrame(text, Math.max(0, text.length));
    error.hint = hintFor(text, position, rawMessage);
    if (text[position] === '﻿') error.message = 'Unexpected invisible character (byte-order mark)';
  }
  return error;
}

/* --------------------------------------------------------------------------------- Public API */

export function describeValue(value) {
  if (Array.isArray(value)) return `Array with ${value.length.toLocaleString()} ${value.length === 1 ? 'item' : 'items'}`;
  if (value === null) return 'null';
  switch (typeof value) {
    case 'object': {
      const keys = Object.keys(value).length;
      return `Object with ${keys.toLocaleString()} ${keys === 1 ? 'key' : 'keys'}`;
    }
    case 'string': return 'String';
    case 'number': return 'Number';
    case 'boolean': return 'Boolean';
    default: return typeof value;
  }
}

/** Validate with the engine's own parser. Returns { ok, summary } or { ok: false, error }. */
export function validateJson(text) {
  try {
    const value = JSON.parse(text);
    return { ok: true, summary: describeValue(value) };
  } catch (e) {
    return { ok: false, error: describeError(text, e && e.message) };
  }
}

/**
 * Re-indents (`indentUnit` non-empty) or compacts (`indentUnit` === '') VALID JSON text without changing
 * any token. Caller must have validated the text first.
 */
export function rewriteJson(text, indentUnit) {
  const pretty = indentUnit !== '';
  const n = text.length;
  const out = [];
  const lineBreaks = []; // cached "\n" + indent per depth
  const newline = (d) => lineBreaks[d] ?? (lineBreaks[d] = '\n' + indentUnit.repeat(d));
  let depth = 0;
  let i = 0;

  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 10 || c === 13 || c === 9) {
      i++;
    } else if (c === 34) {
      // String: find the closing quote, skipping escaped quotes (odd number of preceding backslashes).
      let j = i;
      let backslashes;
      do {
        j = text.indexOf('"', j + 1);
        backslashes = 0;
        for (let k = j - 1; text.charCodeAt(k) === 92; k--) backslashes++;
      } while (backslashes % 2 === 1);
      out.push(text.slice(i, j + 1));
      i = j + 1;
    } else if (c === 123 || c === 91) {
      // { or [ : keep empty containers as {} / []
      const closeCode = c === 123 ? 125 : 93;
      let k = i + 1;
      while (k < n && isWs(text.charCodeAt(k))) k++;
      if (text.charCodeAt(k) === closeCode) {
        out.push(c === 123 ? '{}' : '[]');
        i = k + 1;
      } else {
        out.push(c === 123 ? '{' : '[');
        depth++;
        if (pretty) out.push(newline(depth));
        i++;
      }
    } else if (c === 125 || c === 93) {
      depth--;
      if (pretty) out.push(newline(depth));
      out.push(c === 125 ? '}' : ']');
      i++;
    } else if (c === 44) {
      out.push(pretty ? ',' + newline(depth) : ',');
      i++;
    } else if (c === 58) {
      out.push(pretty ? ': ' : ':');
      i++;
    } else {
      // number, true, false or null: copy through to the next delimiter
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === 32 || d === 10 || d === 13 || d === 9 || d === 44 || d === 58 || d === 93 || d === 125) break;
        j++;
      }
      out.push(text.slice(i, j));
      i = j;
    }
  }
  return out.join('');
}

/** Format. `indent` is '2' | '4' | 'tab'. Returns { ok, output, summary } or { ok: false, error }. */
export function formatJson(text, indent = '2') {
  const v = validateJson(text);
  if (!v.ok) return v;
  return { ok: true, output: rewriteJson(text, INDENTS[indent] ?? INDENTS['2']), summary: v.summary };
}

/** Minify. Returns { ok, output, summary } or { ok: false, error }. */
export function minifyJson(text) {
  const v = validateJson(text);
  if (!v.ok) return v;
  return { ok: true, output: rewriteJson(text, ''), summary: v.summary };
}

export const EXAMPLE_JSON = `{
  "name": "Toolora",
  "free": true,
  "version": 1.2,
  "tools": ["image-compressor", "image-resizer", "word-counter", "json-formatter"],
  "author": { "name": "Ada", "email": null },
  "notes": "Unicode works: caf\\u00e9, 日本語, \u{1F44B}"
}`;
