/**
 * JSON Formatter logic tests. No dependencies.
 *   node tests/jsonFormatter.test.mjs
 *   node tests/jsonFormatter.test.mjs --bench
 */
import { validateJson, formatJson, minifyJson, rewriteJson, findErrorPosition, positionToLineColumn, byteLength, countLines, formatBytes, EXAMPLE_JSON, INDENTS } from '../src/lib/jsonFormatter.js';

const bench = process.argv.includes('--bench');
let failed = 0;
let passed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? passed++ : failed++;
  if (!ok) console.log(`FAIL  ${name}\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`);
  else console.log(`PASS  ${name}`);
};
const loc = (r) => (r.ok ? 'valid' : [r.error.line, r.error.column]);

/* ---------------- Empty / simple / nested / mixed ---------------- */
eq('empty input is invalid (no location)', [validateJson('').ok, validateJson('').error.line], [false, null]);
eq('simple object, 2 spaces', formatJson('{"a":1,"b":"x"}', '2').output, '{\n  "a": 1,\n  "b": "x"\n}');
eq('simple object, 4 spaces', formatJson('{"a":1}', '4').output, '{\n    "a": 1\n}');
eq('simple object, tab', formatJson('{"a":1}', 'tab').output, '{\n\t"a": 1\n}');
eq('default indent is 2 spaces', formatJson('{"a":1}').output, '{\n  "a": 1\n}');
eq('nested objects', formatJson('{"a":{"b":{"c":[1,{"d":null}]}}}').output, '{\n  "a": {\n    "b": {\n      "c": [\n        1,\n        {\n          "d": null\n        }\n      ]\n    }\n  }\n}');
eq('empty containers stay compact', formatJson('{"a":{},"b":[],"c":[[]],"d":{ }, "e":[ ]}').output, '{\n  "a": {},\n  "b": [],\n  "c": [\n    []\n  ],\n  "d": {},\n  "e": []\n}');
eq('arrays + mixed types', minifyJson('[1, "two", true, false, null, 3.5, -2, {"k": [ ]}, [ ]]').output, '[1,"two",true,false,null,3.5,-2,{"k":[]},[]]');
eq('top-level scalars', ['42', '"s"', 'true', 'null', ' 7 '].map((t) => minifyJson(t).output), ['42', '"s"', 'true', 'null', '7']);
eq('summary object/array', [formatJson('{"a":1,"b":2}').summary, formatJson('[1,2,3]').summary, formatJson('[]').summary, formatJson('{"a":1}').summary], ['Object with 2 keys', 'Array with 3 items', 'Array with 0 items', 'Object with 1 key']);

/* ---------------- Unicode / emoji / escapes preserved exactly ---------------- */
const uni = '{"emoji":"\u{1F600}\u{1F44D}","jp":"\u65e5\u672c\u8a9e","esc":"caf\\u00e9 \\ud83d\\ude00 \\/ \\" \\\\ \\n","k\u00e9y":1}';
eq('unicode text preserved (format)', JSON.parse(formatJson(uni).output), JSON.parse(uni));
eq('escape sequences preserved byte-for-byte', minifyJson(uni).output, uni);
eq('string ending in escaped backslash then quote', minifyJson('{"a":"x\\\\","b":"\\\\\\""}').output, '{"a":"x\\\\","b":"\\\\\\""}');
eq('whitespace inside strings untouched', minifyJson('{ "a" : "  spaced   text  " }').output, '{"a":"  spaced   text  "}');
eq('structural chars inside strings untouched', minifyJson('["{[,:]}", "a, b: c"]').output, '["{[,:]}","a, b: c"]');

/* ---------------- Fidelity: things JSON.stringify(JSON.parse()) would change ---------------- */
eq('big integer keeps every digit', minifyJson('{"id": 12345678901234567890}').output, '{"id":12345678901234567890}');
eq('number spellings preserved', minifyJson('[1.0, 1E+2, -0, 0.10, 1e-7]').output, '[1.0,1E+2,-0,0.10,1e-7]');
eq('integer-like key order preserved', minifyJson('{"b":1,"2":2,"a":3,"1":4}').output, '{"b":1,"2":2,"a":3,"1":4}');
eq('duplicate keys preserved', minifyJson('{"a":1,"a":2}').output, '{"a":1,"a":2}');
eq('contrast: JSON.stringify would have changed them', JSON.stringify(JSON.parse('{"id": 12345678901234567890}')), '{"id":12345678901234567000}');

/* ---------------- Errors ---------------- */
eq('missing comma (object)', loc(validateJson('{\n  "a": 1\n  "b": 2\n}')), [3, 3]);
eq('missing comma hint', validateJson('{"a":1 "b":2}').error.hint, 'A comma may be missing between the previous item and this one.');
eq('trailing comma (object)', loc(validateJson('{"a":1,}')), [1, 8]);
eq('trailing comma (array) + hint', [loc(validateJson('[1,2,]')), validateJson('[1,2,]').error.hint], [[1, 6], 'Trailing comma: JSON does not allow a comma after the last item.']);
eq('unquoted property name', [loc(validateJson('{name: "x"}')), validateJson('{name: "x"}').error.hint], [[1, 2], 'Property names must be wrapped in double quotes.']);
eq('unquoted string value', [loc(validateJson('{"a": hello}')), validateJson('{"a": hello}').error.hint], [[1, 7], 'Text values must be wrapped in double quotes. Only true, false and null may appear without quotes.']);
eq('missing closing quote', [validateJson('{"a": "x}').ok, validateJson('{"a": "x}').error.hint], [false, 'The JSON ends unexpectedly. A closing bracket, brace or quote may be missing.']);
eq('single quotes hint', validateJson("{'a':1}").error.hint, 'JSON uses double quotes ("). Single quotes are not allowed for strings or property names.');
eq('comment hint', validateJson('{"a":1 // c\n}').error.hint, 'Comments are not allowed in JSON.');
eq('undefined hint', validateJson('{"a":undefined}').error.hint, 'JSON has no "undefined" value. Use null, a number or a string instead.');
eq('unterminated input (end)', [validateJson('{"a":1').ok, validateJson('{"a":1').error.line, validateJson('{"a":1').error.column], [false, 1, 7]);
eq('extra content after value', validateJson('{"a":1} x').error.hint, 'There is extra content after the end of the JSON value. Only one top-level value is allowed.');
eq('control character in string', validateJson('{"a":"l1\nl2"}').error.hint, 'Line breaks and tabs inside a string must be escaped as \\n and \\t.');
eq('BOM is explained', validateJson('\uFEFF{}').error.message, 'Unexpected invisible character (byte-order mark)');
eq('message has no input snippet / position suffix', ['{"a":1 "b":2}', '[1,2,]', '{"a": hello}'].map((t) => validateJson(t).error.message), ["Expected ',' or '}' after property value", "Unexpected token ']'", "Unexpected token 'h'"]);
eq('error frame points at the character', (() => { const e = validateJson('{"a":1,}').error; return [e.frame.text, e.frame.caret]; })(), ['{"a":1,}', 7]);
eq('error never produced for valid input', ['{}', '[]', '0', '"x"', EXAMPLE_JSON].map((t) => validateJson(t).ok), [true, true, true, true, true]);
eq('invalid input returns no output', [formatJson('{').output, minifyJson('{"a":').output], [undefined, undefined]);

/* ---------------- Locator agrees with the engine ---------------- */
const badCorpus = ['{"a":1 "b":2}', '{"a":1,}', '[1,2,]', '{name:"x"}', '{"a": hello}', "{'a':1}", '{"a":"x', '{"a":1', '{"a":1} x', '{"a":"l1\nl2"}', '{"a":undefined}', '[1 2]', '}', '[01]', '{"a":tru}', '{"a" 1}', '{"a":}', '[,1]', '{,}', '[1,,2]', '{"a":"\\x"}', '{"a":"\\u12G4"}', '{"a":-}', '{"a":1.}', '{"a":.5}', '[1', '{"a":[1,2}', '[}', '"abc', 'nul', '{"a":1}}', '[1]]'];
let agree = 0;
const disagree = [];
for (const t of badCorpus) {
  let engine = null;
  try { JSON.parse(t); } catch (e) { const m = /position (\d+)/.exec(e.message); engine = m ? Number(m[1]) : null; }
  const mine = findErrorPosition(t);
  if (engine === null) { if (mine === -1) disagree.push(['locator missed an invalid input', t]); else agree++; }
  else if (engine === mine) agree++;
  else disagree.push([t, engine, mine]);
}
eq('locator: always flags invalid input, and matches engine positions', disagree, []);
eq('locator: -1 for valid documents', ['{}', '[1,{"a":[]}]', ' 0 ', '"\\u00e9"', EXAMPLE_JSON].map(findErrorPosition), [-1, -1, -1, -1, -1]);
eq('line/column helper (multi-line)', [positionToLineColumn('ab\ncd\nef', 0), positionToLineColumn('ab\ncd\nef', 4), positionToLineColumn('ab\ncd\nef', 7)], [{ line: 1, column: 1 }, { line: 2, column: 2 }, { line: 3, column: 2 }]);

/* ---------------- Round-trip property tests ---------------- */
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const randStr = () => pick(['', 'a', 'hello world', 'caf\u00e9', '\u65e5\u672c', '\u{1F600}', 'q"uote', 'back\\slash', 'line\nbreak', 'tab\t', '{[,:]}', '/']);
const gen = (d) => {
  const r = rnd();
  if (d > 4 || r < 0.35) return pick([null, true, false, 0, -1, 3.14, 1e21, 123456, randStr(), randStr()]);
  if (r < 0.65) return Array.from({ length: Math.floor(rnd() * 5) }, () => gen(d + 1));
  const o = {};
  for (let i = 0, n = Math.floor(rnd() * 5); i < n; i++) o[randStr() + i] = gen(d + 1);
  return o;
};
const sprinkle = (s) => s.replace(/([{}\[\],:])/g, (m) => pick(['', ' ', '\n', '\t  ']) + m + pick(['', ' ', '\r\n']));
let roundTripOk = 0, exactOk = 0;
const N = 400;
for (let k = 0; k < N; k++) {
  const value = gen(0);
  const base = JSON.stringify(value);
  // Whitespace may only be added OUTSIDE strings, so parse the sprinkled text and check it is the same data.
  let src = base;
  try { const sp = sprinkle(base); if (JSON.stringify(JSON.parse(sp)) === base) src = sp; } catch { /* sprinkle landed inside a string: keep base */ }
  for (const ind of ['2', '4', 'tab']) {
    const f = formatJson(src, ind);
    if (f.ok && JSON.stringify(JSON.parse(f.output)) === base) roundTripOk++;
    const expected = JSON.stringify(JSON.parse(src), null, ind === 'tab' ? '\t' : Number(ind));
    if (f.ok && f.output === expected) exactOk++;
  }
  const m = minifyJson(src);
  if (m.ok && m.output === base) roundTripOk++;
}
eq(`property: ${N} random docs format/minify to the same data`, roundTripOk, N * 4);
eq(`property: ${N} random docs format identically to JSON.stringify (when no fidelity difference)`, exactOk, N * 3);
eq('format then minify == minify', (() => { const f = formatJson(EXAMPLE_JSON, '4').output; return minifyJson(f).output === minifyJson(EXAMPLE_JSON).output; })(), true);
eq('format is idempotent', (() => { const a = formatJson(EXAMPLE_JSON, '2').output; return formatJson(a, '2').output === a; })(), true);
eq('deep nesting (50,000 levels) does not overflow the stack', (() => { const d = 50000; const t = '['.repeat(d) + ']'.repeat(d); return [findErrorPosition(t), minifyJson(t).ok || 'engine-rejected']; })()[0], -1);

/* ---------------- Utilities ---------------- */
eq('byteLength matches TextEncoder', ['', 'abc', 'caf\u00e9', '\u65e5\u672c', '\u{1F600}', 'a\u{1F600}b\u00e9\u65e5'].map((s) => byteLength(s) === new TextEncoder().encode(s).length), [true, true, true, true, true, true]);
eq('countLines', [countLines(''), countLines('a'), countLines('a\nb'), countLines('a\n')], [0, 1, 2, 2]);
eq('formatBytes', [formatBytes(12), formatBytes(2048), formatBytes(1536 * 1024)], ['12 B', '2.0 KB', '1.5 MB']);
eq('INDENTS', INDENTS, { '2': '  ', '4': '    ', tab: '\t' });

/* ---------------- Large documents ---------------- */
const makeBig = (records) => JSON.stringify({ items: Array.from({ length: records }, (_, i) => ({ id: i, name: `Item ${i}`, tags: ['a', 'b', 'c'], nested: { x: i * 1.5, y: null, ok: i % 2 === 0, text: 'caf\u00e9 \u65e5\u672c' } })) });
const big = makeBig(50000); // ~ 6 MB
const bigFmt = formatJson(big, '2');
eq(`large (${(big.length / 1e6).toFixed(1)} MB): formats and round-trips`, [bigFmt.ok, JSON.stringify(JSON.parse(bigFmt.output)) === big], [true, true]);
eq('large: minify of formatted equals original', minifyJson(bigFmt.output).output, big);

if (bench) {
  const time = (fn, runs = 3) => { let best = Infinity, r; for (let i = 0; i < runs; i++) { const t = performance.now(); r = fn(); best = Math.min(best, performance.now() - t); } return best.toFixed(1) + ' ms'; };
  console.log('\n--- Benchmarks (best of 3) ---');
  for (const records of [1000, 10000, 50000, 200000]) {
    const t = makeBig(records);
    const pretty = rewriteJson(t, '  ');
    console.log(`${(t.length / 1e6).toFixed(1).padStart(5)} MB (${records.toLocaleString()} records): validate ${time(() => validateJson(t))}  format ${time(() => formatJson(t, '2'))}  minify ${time(() => minifyJson(pretty))}  | native parse+stringify(2): ${time(() => JSON.stringify(JSON.parse(t), null, 2))}`);
  }
  const badBig = makeBig(50000).slice(0, -3) + ',]}';
  console.log(`6 MB invalid document -> error report: ${time(() => validateJson(badBig))}`);
  const noPos = '{"a": hello}'.padStart(3_000_000, ' ') ;
  console.log(`3 MB document with error that needs the locator: ${time(() => validateJson(noPos))}`);
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nAll ${passed} tests passed`);
process.exit(failed ? 1 : 0);
