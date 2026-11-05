/**
 * Word Counter logic tests. No dependencies.
 *   node tests/wordCount.test.mjs                  run with Intl.Segmenter (normal)
 *   node tests/wordCount.test.mjs --no-segmenter   simulate a browser without Intl.Segmenter
 *   node tests/wordCount.test.mjs --bench          also print benchmarks
 */
const noSegmenter = process.argv.includes('--no-segmenter');
const bench = process.argv.includes('--bench');
if (noSegmenter) Intl.Segmenter = undefined;

const { analyzeText, countWords, countSentences, countCodePoints, formatDuration } = await import('../src/lib/wordCount.js');

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
};
const stats = (t) => {
  const r = analyzeText(t);
  return [r.words, r.characters, r.charactersNoSpaces, r.sentences, r.paragraphs];
};

console.log(`Mode: ${noSegmenter ? 'WITHOUT Intl.Segmenter' : 'with Intl.Segmenter'}\n`);

/* ---- Original acceptance tests ---- */
eq('empty', analyzeText(''), { words: 0, characters: 0, codePoints: 0, charactersNoSpaces: 0, sentences: 0, paragraphs: 0, readingTime: null, speakingTime: null });
eq('"Hello world!"  words/chars/no-spaces/sentences/paragraphs', stats('Hello world!'), [2, 12, 11, 1, 1]);
eq("contraction + hyphenated: I don't like poorly-designed tools.", stats("I don't like poorly-designed tools."), [5, 35, 31, 1, 1]);
eq('paragraphs: blank lines', stats('One.\n\nTwo.\n\n\n\nThree.')[4], 3);
eq('paragraphs: CRLF + whitespace-only line', stats('One.\r\n  \r\nTwo.\r\n\r\n')[4], 2);
eq('paragraphs: single newline is the same paragraph', stats('line one\nline two')[4], 1);
eq('whitespace mix: spaces, tabs, line breaks', stats('  a \t\t b\n\n c  '), [3, 14, 3, 2, 2]);
eq('whitespace only', stats('   \n\t \n'), [0, 7, 0, 0, 0]);
eq('punctuation-only tokens ignored', countWords('hello - & ... world'), 2);
eq('em dash separates words', countWords('one—two'), 2);
eq('numbers', countWords('3.14 and 42'), 3);
eq('Cyrillic + (space-separated) text', countWords('Привет мир'), 2);
eq('Korean (space separated)', countWords('나는 어제 시장에 갔다'), 4);
eq('durations', [0, 50, 200, 400, 1000, 12000, 24000].map((n) => formatDuration(n, 200)), [null, 'Less than a minute', '1 minute', '2 minutes', '5 minutes', '1 hour', '2 hours']);

/* ---- Sentences ---- */
eq('sentences: three', countSentences('Hi there. How are you? Fine!'), 3);
eq('sentences: no terminal punctuation', countSentences('just words here'), 1);
eq('sentences: ellipsis only', countSentences('...'), 0);
eq('sentences: single line break is NOT a boundary', countSentences('one line\nsecond line'), 1);
eq('sentences: wrapped sentence across lines', countSentences('This sentence is\nwrapped across\nthree lines.'), 1);
eq('sentences: CRLF wrapped', countSentences('Wrapped\r\nsentence here.'), 1);
eq('sentences: punctuation + line break', countSentences('Hello.\nWorld.'), 2);
eq('sentences: blank line separates', countSentences('A heading\n\nBody text without a full stop'), 2);
eq('sentences: Dr. protected', countSentences('Dr. Smith went home. He slept.'), 2);
eq('sentences: Mr./Mrs. protected', countSentences('Mr. and Mrs. Jones left. Ok.'), 2);
eq('sentences: decimal', countSentences('Pi is 3.14 roughly. Next.'), 2);
eq('sentences: e.g.', countSentences('Use tools, e.g. a hammer. Done.'), 2);
eq('sentences: CJK terminators', countSentences('今日は晴れです。明日は雨です。'), 2);
eq('sentences: question + exclamation', countSentences('Really?! Yes! Good.'), 3);

/* ---- International word counting ---- */
eq('Chinese', countWords('我今天去了北京的图书馆，借了三本书。'), noSegmenter ? 16 : 10);
eq('Japanese', countWords('私は昨日東京で友達に会いました。'), noSegmenter ? 15 : 10);
eq('Thai', countWords('ฉันไปตลาดเมื่อวานนี้'), noSegmenter ? 1 : 6);
eq('Latin + Chinese mixed', countWords('Hello 你好 world'), noSegmenter ? 4 : 3);
eq('Latin hyphen untouched next to CJK sentence', countWords('poorly-designed 你好'), noSegmenter ? 3 : 2);
eq('CJK punctuation-only token ignored', countWords('你好 。。 世界'), noSegmenter ? 4 : 2);

/* ---- Characters ---- */
eq('code points: BMP text equal to length', [countCodePoints('Hello'), 'Hello'.length], [5, 5]);
eq('code points: emoji counts as 1 (length 2)', [countCodePoints('a\u{1F600}b'), 'a\u{1F600}b'.length], [3, 4]);
eq('characters metric unchanged (UTF-16 length)', analyzeText('a\u{1F600}b').characters, 4);
eq('code points: lone surrogate counted once', countCodePoints('\ud83d'), 1);

/* ---- Large documents ---- */
const para = "The quick brown fox jumps over the lazy dog. It's a well-known sentence!\n\n";
const big = para.repeat(10000);
const r = analyzeText(big);
eq('large (740k chars): words/sentences/paragraphs', [r.words, r.sentences, r.paragraphs], [130000, 20000, 10000]);
const wrapped = ('This sentence is wrapped\nacross two lines. Another one here.\n').repeat(10000);
eq('large single paragraph with single newlines (600k chars)', countSentences(wrapped), 20000);
const longSentence = ('word '.repeat(30000) + 'end.');
eq('one unbroken 150k-char sentence', countSentences(longSentence), 1);
const zh = '我今天去了北京的图书馆，借了三本书。'.repeat(50000);
eq('large Chinese document counted', countWords(zh) > 0, true);

/* ---- Benchmarks ---- */
if (bench) {
  const time = (fn, runs = 3) => {
    let best = Infinity;
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      fn();
      best = Math.min(best, performance.now() - t);
    }
    return best.toFixed(1) + ' ms';
  };
  const en = para.repeat(10000);
  const mixed = en + '你好'; // forces the segmenter path on a large Latin document
  const seg = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  console.log('\n--- Benchmarks (best of 3) ---');
  console.log(`English, ${en.length.toLocaleString()} chars, ${r.words.toLocaleString()} words`);
  console.log('  whitespace fast path (countWords):          ', time(() => countWords(en)));
  if (seg) {
    console.log('  countWords on same text + 1 CJK token:      ', time(() => countWords(mixed)), '(only the CJK token is segmented)');
    // Segmenter on English at growing sizes, to show why it is not used for ordinary text.
    // (Kept small on purpose: whole-string segmentation grows super-linearly and takes minutes at ~1M chars.)
    for (const n of [500, 1000, 2000, 4000]) {
      const sample = para.repeat(n);
      const words = countWords(sample);
      const segMs = time(() => { let c = 0; for (const s of seg.segment(sample)) if (s.isWordLike) c++; return c; }, 1);
      console.log(`  ${sample.length.toLocaleString().padStart(9)} chars (${words.toLocaleString()} words): whitespace ${time(() => countWords(sample))}  vs  Intl.Segmenter ${segMs}`);
    }
  }
  console.log(`Chinese, ${zh.length.toLocaleString()} chars, ${countWords(zh).toLocaleString()} words (one unbroken token)`);
  console.log('  countWords (segmented in chunks):           ', time(() => countWords(zh)));
  const zhSpaced = zh.slice(0, 200000).replace(/。/g, '。 ');
  console.log(`Chinese with spaces, ${zhSpaced.length.toLocaleString()} chars:`, time(() => countWords(zhSpaced)));
  console.log(`Sentences, ${big.length.toLocaleString()} chars (blank-line paragraphs):`, time(() => countSentences(big)));
  console.log(`Sentences, ${wrapped.length.toLocaleString()} chars (one huge paragraph):`, time(() => countSentences(wrapped)));
  console.log(`analyzeText, ${big.length.toLocaleString()} chars:`, time(() => analyzeText(big)));
}

console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
