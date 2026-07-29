/**
 * Regenerates both decks from their upstream sources. Run with `npm run build:decks`.
 *
 * Output (all committed, so the app itself needs no network):
 *   public/audio/sinosplice/*.mp3
 *   src/data/sinosplice-deck.json
 *   src/data/extended-deck.json
 *
 * Downloads are cached in .cache/ so reruns are cheap and don't hammer the source.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { parseToneString, toneKey, type Syllable } from '../src/core/tones.js';
import type { Deck, Word } from '../src/core/types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache');
const AUDIO_OUT = join(ROOT, 'public', 'audio', 'sinosplice');
const DATA_OUT = join(ROOT, 'src', 'data');

const CHART_URL = 'https://www.sinosplice.com/learn-chinese/tone-pair-drills/4';
const ZIP_URL = 'https://www.sinosplice.com/wp-content/uploads/files/sinosplice-tpd-10.zip';
const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
const CEDICT_LOCAL = resolve(ROOT, '..', 'anki', 'data', 'cedict.u8');
const HSK_LOCAL = resolve(ROOT, '..', 'anki', 'data', 'hsk_1_4_words.txt');

const SINOSPLICE_ATTRIBUTION =
  'Mandarin Chinese Tone Pair Drills by John Pasden / Sinosplice, ' +
  'CC BY-NC-SA 2.5 — https://www.sinosplice.com/learn-chinese/tone-pair-drills';
const CEDICT_ATTRIBUTION = 'Glosses from CC-CEDICT (MDBG), CC BY-SA 4.0';

const log = (msg: string) => console.log(msg);

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

async function cached(url: string, name: string): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const dest = join(CACHE, name);
  if (existsSync(dest)) return dest;

  log(`  fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// ---------------------------------------------------------------------------
// CC-CEDICT
// ---------------------------------------------------------------------------

interface CedictEntry {
  traditional: string;
  simplified: string;
  pinyin: string;
  senses: string[];
}

const CEDICT_LINE = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/;

async function loadCedict(): Promise<CedictEntry[]> {
  let text: string;
  if (existsSync(CEDICT_LOCAL)) {
    log(`  CC-CEDICT from ${CEDICT_LOCAL}`);
    text = readFileSync(CEDICT_LOCAL, 'utf8');
  } else {
    log('  CC-CEDICT not found locally; downloading');
    text = gunzipSync(readFileSync(await cached(CEDICT_URL, 'cedict.txt.gz'))).toString('utf8');
  }

  const entries: CedictEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const m = CEDICT_LINE.exec(line);
    if (!m) continue;
    entries.push({
      traditional: m[1]!,
      simplified: m[2]!,
      pinyin: m[3]!,
      senses: m[4]!.split('/').filter((s) => s.trim() !== ''),
    });
  }
  log(`  CC-CEDICT: ${entries.length} entries`);
  return entries;
}

function indexBy(entries: CedictEntry[], key: 'traditional' | 'simplified'): Map<string, CedictEntry[]> {
  const map = new Map<string, CedictEntry[]>();
  for (const e of entries) {
    const list = map.get(e[key]);
    if (list) list.push(e);
    else map.set(e[key], [e]);
  }
  return map;
}

/** CEDICT senses are verbose; keep the first couple so the reveal stays readable. */
function toGloss(entries: CedictEntry[] | undefined): string {
  if (!entries || entries.length === 0) return '';
  const senses = entries
    .flatMap((e) => e.senses)
    // Cross-references tell the learner nothing on a flashcard.
    .filter((s) => !/^(variant of|see |old variant|also written)/i.test(s));
  const chosen = (senses.length > 0 ? senses : entries.flatMap((e) => e.senses)).slice(0, 2);
  return chosen.join('; ');
}

// ---------------------------------------------------------------------------
// Sinosplice deck
// ---------------------------------------------------------------------------

/** Inner drill tables have no attributes; the outer layout tables do. */
const INNER_TABLE = /<table>\s*<tbody>([\s\S]*?)<\/tbody>\s*<\/table>/g;
const ROW = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
const CELL = /<td[^>]*>([\s\S]*?)<\/td>/g;
const MP3 = /tone-pair-drills\/([^"/]+)\.mp3/;

const SECTIONS: ReadonlyArray<readonly [label: string, category: string]> = [
  ['One-Character Adjectives', 'adjective'],
  ['Two-Character Adjectives', 'adjective'],
  ['One-Character Modifiers', 'modifier'],
  ['Two-Character Modifiers', 'modifier'],
  ['Pronouns', 'pronoun'],
];

/** The traditional chart writes 合適 with the simplified 适. */
const CHARACTER_FIXES: Record<string, string> = { 合适: '合適' };

/**
 * Compositional phrases the drills include but CC-CEDICT has no headword for.
 * Both are transparent 好/不 + verb constructions rather than lexicalized words.
 */
const GLOSS_OVERRIDES: Record<string, string> = {
  好懂: 'easy to understand',
  不太: 'not very; not too',
};

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function matchAll(re: RegExp, input: string): string[][] {
  const out: string[][] = [];
  re.lastIndex = 0;
  for (let m = re.exec(input); m !== null; m = re.exec(input)) out.push([...m]);
  return out;
}

interface RawItem {
  character: string;
  clip: string;
  category: string;
}

function parseChart(html: string): { items: RawItem[]; skipped: string[] } {
  const start = html.indexOf(SECTIONS[0]![0]);
  const end = html.indexOf('NOTE:');
  if (start === -1 || end === -1) throw new Error('chart markers not found — page layout changed?');
  const body = html.slice(start, end);

  const bounds = SECTIONS.map(([label]) => {
    const at = body.indexOf(label);
    if (at === -1) throw new Error(`section "${label}" not found — page layout changed?`);
    return at;
  });

  const items: RawItem[] = [];
  const skipped: string[] = [];

  SECTIONS.forEach(([label, category], i) => {
    const section = body.slice(bounds[i]!, bounds[i + 1] ?? body.length);

    for (const [, tbody] of matchAll(INNER_TABLE, section)) {
      const rows = matchAll(ROW, tbody!);
      if (rows.length < 2) continue;

      const chars = matchAll(CELL, rows[0]![1]!).map(([, c]) => stripTags(c!).replace(/[，,]$/, '').trim());
      const clips = matchAll(CELL, rows[1]![1]!).map(([, c]) => MP3.exec(c!)?.[1] ?? '');

      chars.forEach((raw, j) => {
        const clip = clips[j];
        if (!raw || !clip) return;

        // Footnote cells like "(不),*" and "(挺)*" are sandhi variants of a character
        // that also appears with its dictionary tone. Their recordings are genuine, but
        // showing "不 = tone 2" in the reveal without the sandhi context misleads, so
        // they are excluded and reported rather than silently dropped.
        if (/[()*]/.test(raw)) {
          skipped.push(`${raw} [${clip}] in ${label}`);
          return;
        }

        items.push({ character: CHARACTER_FIXES[raw] ?? raw, clip, category });
      });
    }
  });

  return { items, skipped };
}

async function buildSinospliceDeck(cedictByTrad: Map<string, CedictEntry[]>): Promise<Deck> {
  log('Sinosplice deck');

  const html = readFileSync(await cached(CHART_URL, 'chart-traditional.html'), 'utf8');
  const { items, skipped } = parseChart(html);
  log(`  parsed ${items.length} cells; skipped ${skipped.length} sandhi footnote cells:`);
  for (const s of skipped) log(`    - ${s}`);

  // Extract the audio package once, then copy only the clips the deck references.
  const zip = await cached(ZIP_URL, 'sinosplice-tpd-10.zip');
  const flat = join(CACHE, 'flat');
  mkdirSync(flat, { recursive: true });
  if (readdirSync(flat).length === 0) {
    execFileSync('unzip', ['-qq', '-o', '-j', zip, '*.mp3', '-d', flat]);
  }
  const available = new Set(readdirSync(flat).map((f) => basename(f, '.mp3')));

  // One recording can be listed under several characters (他/她/它 → ta1) or in two
  // sections (特別). Merge on the clip so the pool holds no acoustic duplicates.
  const byClip = new Map<string, { chars: string[]; category: string }>();
  for (const { character, clip, category } of items) {
    const group = byClip.get(clip);
    if (group) {
      if (!group.chars.includes(character)) group.chars.push(character);
    } else {
      byClip.set(clip, { chars: [character], category });
    }
  }

  mkdirSync(AUDIO_OUT, { recursive: true });
  const words: Word[] = [];

  for (const [clip, { chars, category }] of byClip) {
    if (!available.has(clip)) throw new Error(`${clip}.mp3 referenced by the chart but absent from the package`);

    const syllables = parseToneString(clip);
    if (!syllables) throw new Error(`could not derive tones from clip name "${clip}"`);

    const [traditional, ...alsoWritten] = chars as [string, ...string[]];
    if (syllables.length !== [...traditional].length) {
      throw new Error(`${traditional} has ${[...traditional].length} chars but ${clip} encodes ${syllables.length} syllables`);
    }

    copyFileSync(join(flat, `${clip}.mp3`), join(AUDIO_OUT, `${clip}.mp3`));

    words.push({
      id: `sino:${clip}`,
      traditional,
      syllables,
      gloss: GLOSS_OVERRIDES[traditional] ?? toGloss(cedictByTrad.get(traditional)),
      audio: { kind: 'file', src: `audio/sinosplice/${clip}.mp3` },
      source: 'sinosplice',
      ...(alsoWritten.length > 0 ? { alsoWritten } : {}),
      category,
    });
  }

  const missingGloss = words.filter((w) => w.gloss === '');
  if (missingGloss.length > 0) {
    log(`  WARNING no gloss for: ${missingGloss.map((w) => w.traditional).join(', ')}`);
  }

  log(`  ${words.length} words, ${words.length} clips copied`);
  return {
    source: 'sinosplice',
    attribution: `${SINOSPLICE_ATTRIBUTION}. ${CEDICT_ATTRIBUTION}`,
    generatedFrom: CHART_URL,
    words,
  };
}

// ---------------------------------------------------------------------------
// Extended deck
// ---------------------------------------------------------------------------

const HAN = /^[一-鿿]+$/;
/** 不 and 一 change tone in context, so the written answer key would not match the audio. */
const SANDHI_CHARS = /[不一]/;
const PROPER_NOUN = /^(surname|abbr\. for)|\(place in|\bprovince\b|\bcounty\b/i;

function buildExtendedDeck(
  cedictBySimp: Map<string, CedictEntry[]>,
  cedictByTrad: Map<string, CedictEntry[]>,
): Deck {
  log('Extended deck');

  if (!existsSync(HSK_LOCAL)) throw new Error(`HSK word list not found at ${HSK_LOCAL}`);
  const seeds = readFileSync(HSK_LOCAL, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  log(`  ${seeds.length} seed words`);

  const reasons = { notFound: 0, length: 0, sandhi: 0, ambiguous: 0, proper: 0, unparsed: 0 };
  const words: Word[] = [];
  const seen = new Set<string>();

  for (const simplified of seeds) {
    // The seed list is simplified; resolve to the traditional headword. Some words are
    // already identical in both scripts, in which case the simplified index still hits.
    const entries = cedictBySimp.get(simplified) ?? cedictByTrad.get(simplified);
    if (!entries || entries.length === 0) {
      reasons.notFound++;
      continue;
    }

    const traditional = entries[0]!.traditional;
    if (seen.has(traditional)) continue;

    if (!HAN.test(traditional) || traditional.length < 1 || traditional.length > 2) {
      reasons.length++;
      continue;
    }
    if (SANDHI_CHARS.test(traditional)) {
      reasons.sandhi++;
      continue;
    }

    const parsed = entries.map((e) => parseToneString(e.pinyin)).filter((p): p is Syllable[] => p !== null);
    if (parsed.length === 0) {
      reasons.unparsed++;
      continue;
    }

    // 多音字: if the readings disagree on tone, we cannot grade the audio.
    const keys = new Set(parsed.map(toneKey));
    if (keys.size > 1) {
      reasons.ambiguous++;
      continue;
    }

    const syllables = parsed[0]!;
    if (syllables.length !== [...traditional].length) {
      reasons.length++;
      continue;
    }

    const gloss = toGloss(entries);
    if (gloss === '' || PROPER_NOUN.test(gloss)) {
      reasons.proper++;
      continue;
    }

    seen.add(traditional);
    words.push({
      id: `ext:${traditional}`,
      traditional,
      syllables,
      gloss,
      audio: { kind: 'tts', text: traditional },
      source: 'extended',
      category: 'hsk1-4',
    });
  }

  log(`  ${words.length} words kept`);
  log(`  dropped: ${JSON.stringify(reasons)}`);
  return {
    source: 'extended',
    attribution: `${CEDICT_ATTRIBUTION}. Seed list: HSK 1-4 vocabulary. Audio is synthesized at runtime.`,
    generatedFrom: 'CC-CEDICT + HSK 1-4 word list',
    words,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const cedict = await loadCedict();
  const byTrad = indexBy(cedict, 'traditional');
  const bySimp = indexBy(cedict, 'simplified');

  const sinosplice = await buildSinospliceDeck(byTrad);
  const extended = buildExtendedDeck(bySimp, byTrad);

  mkdirSync(DATA_OUT, { recursive: true });
  for (const deck of [sinosplice, extended]) {
    const path = join(DATA_OUT, `${deck.source}-deck.json`);
    writeFileSync(path, `${JSON.stringify(deck, null, 2)}\n`);
    log(`wrote ${path}`);
  }

  const pairs = new Set(sinosplice.words.filter((w) => w.syllables.length === 2).map((w) => toneKey(w.syllables)));
  log(`\nSinosplice tone patterns present: ${[...pairs].sort().join(' ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
