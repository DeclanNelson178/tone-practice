/**
 * Tone parsing and pinyin rendering.
 *
 * Two upstream sources feed the decks and they spell tones differently:
 *
 *   Sinosplice MP3 basenames   hao3chi1, cong1ming0   (neutral = 0, no separators)
 *   CC-CEDICT pinyin fields    [hao3 chi1], cong1 ming5   (neutral = 5, space separated)
 *
 * Both normalize to `Tone`, where neutral is 0. Nothing downstream should ever
 * see a raw 5.
 */

export const NEUTRAL = 0;

export type Tone = 0 | 1 | 2 | 3 | 4;

export interface Syllable {
  /** Toneless pinyin, lowercase, with ü written as ü (never `u:`). */
  pinyin: string;
  tone: Tone;
}

export function isTone(value: number): value is Tone {
  return Number.isInteger(value) && value >= 0 && value <= 4;
}

/** Matches one syllable: pinyin letters (possibly containing `u:`) then a tone digit. */
const SYLLABLE = /([a-zü]+:?[a-zü]*)([0-5])/g;

/**
 * Parses a tone-numbered pinyin string into syllables.
 *
 * Returns `null` rather than a partial result when the input is not fully
 * parseable — the drill grades against these tones, so a half-parsed word would
 * become a silently wrong answer key. Junk cells from the source HTML (`(不),*`)
 * and toneless input both land here.
 */
export function parseToneString(input: string): Syllable[] | null {
  const cleaned = input
    .toLowerCase()
    .replace(/[[\]]/g, '')
    .trim();

  if (cleaned === '') return null;

  const syllables: Syllable[] = [];
  let consumed = 0;

  SYLLABLE.lastIndex = 0;
  for (let m = SYLLABLE.exec(cleaned); m !== null; m = SYLLABLE.exec(cleaned)) {
    const [full, letters, digit] = m as unknown as [string, string, string];
    const raw = Number(digit);
    // CEDICT writes neutral as 5; collapse it onto our 0.
    const tone = raw === 5 ? NEUTRAL : raw;
    if (!isTone(tone)) return null;

    syllables.push({ pinyin: letters.replace(/u:/g, 'ü'), tone });
    consumed += full.length;
  }

  if (syllables.length === 0) return null;

  // Everything except separators must have been consumed by the syllable regex.
  // This is what rejects `hao3chi` (trailing toneless syllable) and `123`.
  const separators = cleaned.replace(SYLLABLE, '').replace(/[\s'·-]/g, '');
  if (separators !== '' || consumed === 0) return null;

  return syllables;
}

const MARKS: Record<string, readonly string[]> = {
  //        tone: 1    2    3    4
  a: ['a', 'ā', 'á', 'ǎ', 'à'],
  e: ['e', 'ē', 'é', 'ě', 'è'],
  i: ['i', 'ī', 'í', 'ǐ', 'ì'],
  o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
  u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
  ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

const VOWELS = 'aeiouü';

/**
 * Picks the vowel that carries the tone mark, by the standard rule:
 * `a` wins, else `o`, else `e`, else the last vowel in the cluster
 * (which gives jiǔ, guì, shuǐ correctly).
 */
function markIndex(pinyin: string): number {
  for (const preferred of ['a', 'o', 'e']) {
    const i = pinyin.indexOf(preferred);
    if (i !== -1) return i;
  }
  for (let i = pinyin.length - 1; i >= 0; i--) {
    if (VOWELS.includes(pinyin[i]!)) return i;
  }
  return -1;
}

function markSyllable({ pinyin, tone }: Syllable): string {
  if (tone === NEUTRAL) return pinyin;

  const i = markIndex(pinyin);
  if (i === -1) return pinyin;

  const vowel = pinyin[i]!;
  const marked = MARKS[vowel]?.[tone];
  if (marked === undefined) return pinyin;

  return pinyin.slice(0, i) + marked + pinyin.slice(i + 1);
}

/** Renders syllables as space-separated pinyin with tone diacritics: `hǎo chī`. */
export function toDiacritics(syllables: readonly Syllable[]): string {
  return syllables.map(markSyllable).join(' ');
}

/** Canonical tone-pattern key used to group and score by tone pair: `3-1`, `1-0`, `4`. */
export function toneKey(syllables: readonly Syllable[]): string {
  return syllables.map((s) => s.tone).join('-');
}
