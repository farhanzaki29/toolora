/**
 * Word Counter logic. Pure functions: no DOM access, no storage, no network, no logging.
 * The input text is only ever read, never modified (any normalising happens on throwaway copies).
 *
 * Counting rules
 *  - Words:       text is split on whitespace and em dashes; a token counts only if it has a letter or
 *                 digit (so "-", "&", "..." are ignored). "don't" and "poorly-designed" are one word each.
 *                 Tokens containing scripts written without spaces (Chinese, Japanese, Thai, Lao, Khmer,
 *                 Myanmar) are counted with Intl.Segmenter (word granularity) instead. Text without those
 *                 scripts never touches the segmenter.
 *  - Characters:  String.length (UTF-16 code units), including every space, tab and line break.
 *                 `codePoints` is a separate Unicode code-point count; the two differ for emoji etc.
 *  - No spaces:   the same as Characters, with all whitespace removed.
 *  - Sentences:   counted within each paragraph (blank lines always separate sentences). A single line
 *                 break does NOT end a sentence; it is treated like a space. Intl.Segmenter finds the
 *                 boundaries (regex fallback without it); common abbreviations such as "Dr." are protected.
 *  - Paragraphs:  blocks of non-whitespace text separated by one or more blank lines.
 *  - Reading 200 wpm, speaking 130 wpm (estimates).
 */

export const READING_WPM = 200;
export const SPEAKING_WPM = 130;

const HAS_CONTENT = /[\p{L}\p{N}]/u;
const WORD_SPLIT = /[\s\u2014]+/u; // whitespace + em dash
const PARAGRAPH_SPLIT = /\r?\n[^\S\r\n]*(?:\r?\n[^\S\r\n]*)+/; // newline, then one or more blank lines
const LINE_BREAKS = /\r\n|[\n\r\u2028\u2029\u0085]/g;

/* ------------------------------------------------------------------ Segmenters (optional) */

function makeSegmenter(granularity) {
  try {
    return typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity }) : null;
  } catch {
    return null;
  }
}
const wordSegmenter = makeSegmenter('word');
const sentenceSegmenter = makeSegmenter('sentence');

/* ------------------------------------------------------------------------------- Words */

// Scripts whose words are not separated by spaces.
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
// Fallback when Intl.Segmenter is missing: each Han/kana character counts as one word.
const IDEOGRAPH_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const FALLBACK_PIECE_SPLIT = /[^\p{L}\p{N}\p{M}'\u2019-]+/u;
const SEGMENT_CHUNK = 2000; // measured sweet spot: ~3x faster than 20k-char chunks on Chinese

function countWordsWhitespace(text) {
  let count = 0;
  for (const token of text.split(WORD_SPLIT)) {
    if (token && HAS_CONTENT.test(token)) count++;
  }
  return count;
}

function countWordLikeSegments(str) {
  let n = 0;
  for (const s of wordSegmenter.segment(str)) if (s.isWordLike) n++;
  return n;
}

function countSegmentedToken(token) {
  if (!wordSegmenter) {
    let n = 0;
    const rest = token.replace(IDEOGRAPH_OR_KANA, () => {
      n++;
      return ' ';
    });
    for (const piece of rest.split(FALLBACK_PIECE_SPLIT)) if (piece && HAS_CONTENT.test(piece)) n++;
    return n;
  }
  if (token.length <= SEGMENT_CHUNK) return countWordLikeSegments(token);
  // Long unbroken runs are segmented in chunks (whole-string segmentation is super-linear). Each chunk is
  // cut right after its last non-word segment (punctuation), so a word is never split across chunks.
  // If a chunk has no such cut it is counted whole.
  let n = 0;
  let pos = 0;
  while (pos < token.length) {
    const window = token.slice(pos, pos + SEGMENT_CHUNK);
    const isLast = pos + SEGMENT_CHUNK >= token.length;
    let total = 0;
    let countAtCut = 0;
    let cutEnd = 0;
    for (const s of wordSegmenter.segment(window)) {
      if (s.isWordLike) total++;
      else if (s.index > 0) {
        cutEnd = s.index + s.segment.length;
        countAtCut = total;
      }
    }
    if (isLast || cutEnd === 0 || cutEnd >= window.length) {
      n += total;
      pos += window.length;
    } else {
      n += countAtCut;
      pos += cutEnd;
    }
  }
  return n;
}
export function countWords(text) {
  // Fast path: ordinary whitespace-separated text never touches Intl.Segmenter.
  if (!NO_SPACE_SCRIPT.test(text)) return countWordsWhitespace(text);
  let count = 0;
  for (const token of text.split(WORD_SPLIT)) {
    if (!token || !HAS_CONTENT.test(token)) continue;
    count += NO_SPACE_SCRIPT.test(token) ? countSegmentedToken(token) : 1;
  }
  return count;
}

/* --------------------------------------------------------------------------- Characters */

export function countCharactersNoSpaces(text) {
  return text.replace(/\s/gu, '').length;
}

const SURROGATE_PAIR = /[\ud800-\udbff][\udc00-\udfff]/g;

/** Unicode code points (an emoji outside the BMP is 1 here but 2 in String.length). */
export function countCodePoints(text) {
  const pairs = text.match(SURROGATE_PAIR);
  return text.length - (pairs ? pairs.length : 0);
}

/* --------------------------------------------------------------------------- Sentences */

// Titles/abbreviations whose full stop is not a sentence end. Applied to a throwaway copy only.
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|Gen|Col|Capt|Lt|Sgt|Rev|Hon|vs|cf|e\.g|i\.e)\.(?=\s)/g;
const PROTECTED_DOT = '\u00b7'; // middle dot: not a sentence terminator
const SENTENCE_CHUNK = 20000;
// Without Intl.Segmenter: a sentence ends at . ! ? … (optionally followed by closing quotes/brackets)
// then whitespace or end, or at CJK terminators.
const FALLBACK_SENTENCE_END = /(?:[.!?\u2026]+["'\u201d\u2019)\]]*(?=\s|$))|[\u3002\uff01\uff1f]+/u;

function countSentencesFallback(text) {
  let count = 0;
  for (const part of text.split(FALLBACK_SENTENCE_END)) if (HAS_CONTENT.test(part)) count++;
  return count;
}

function countSentencesSegmented(text) {
  // Intl.Segmenter slows down sharply on very large strings (about 50 s for 700k characters), so work in
  // chunks. Each chunk's last (possibly unfinished) sentence is carried into the next chunk.
  let count = 0;
  let pos = 0;
  while (pos < text.length) {
    const chunk = text.slice(pos, pos + SENTENCE_CHUNK);
    const isLast = pos + SENTENCE_CHUNK >= text.length;
    const segs = [...sentenceSegmenter.segment(chunk)];
    const keep = isLast ? segs.length : segs.length - 1;
    for (let i = 0; i < keep; i++) if (HAS_CONTENT.test(segs[i].segment)) count++;
    if (isLast) break;
    const lastStart = segs[segs.length - 1].index;
    if (lastStart === 0) {
      // One unbroken sentence longer than a chunk: count the remainder with the simple fallback.
      return count + countSentencesFallback(text.slice(pos));
    }
    pos += lastStart;
  }
  return count;
}

export function countSentences(text) {
  let count = 0;
  for (const paragraph of text.split(PARAGRAPH_SPLIT)) {
    if (!HAS_CONTENT.test(paragraph)) continue;
    const flat = paragraph.replace(LINE_BREAKS, ' ').replace(ABBREVIATION, (m) => m.slice(0, -1) + PROTECTED_DOT);
    count += sentenceSegmenter ? countSentencesSegmented(flat) : countSentencesFallback(flat);
  }
  return count;
}

/* ---------------------------------------------------------------------------- Paragraphs */

export function countParagraphs(text) {
  let count = 0;
  for (const block of text.split(PARAGRAPH_SPLIT)) {
    if (block.trim()) count++;
  }
  return count;
}

/* -------------------------------------------------------------------------------- Time */

/** Human-readable duration for `words` at `wpm`. Returns null for no words (nothing to estimate). */
export function formatDuration(words, wpm) {
  if (words <= 0) return null;
  const minutes = words / wpm;
  if (minutes < 1) return 'Less than a minute';
  const total = Math.max(1, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (h === 0) return plural(m, 'minute');
  return m === 0 ? plural(h, 'hour') : `${plural(h, 'hour')} ${plural(m, 'minute')}`;
}

export function analyzeText(text) {
  const words = countWords(text);
  return {
    words,
    characters: text.length,
    codePoints: countCodePoints(text),
    charactersNoSpaces: countCharactersNoSpaces(text),
    sentences: countSentences(text),
    paragraphs: countParagraphs(text),
    readingTime: formatDuration(words, READING_WPM),
    speakingTime: formatDuration(words, SPEAKING_WPM),
  };
}