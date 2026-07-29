import { describe, expect, it } from 'vitest';

import {
  ALL_WORDS,
  EXTENDED_WORDS,
  SINOSPLICE_WORDS,
  availableToneKeys,
  buildPool,
  type PoolOptions,
} from '../src/core/deck';
import { toneKey } from '../src/core/tones';

const opts = (over: Partial<PoolOptions> = {}): PoolOptions => ({
  mode: 'mixed',
  decks: ['sinosplice'],
  includeNeutral: true,
  toneKeys: null,
  ...over,
});

/** Every neutral-tone word in the Sinosplice deck, as of the committed data. */
const SINO_NEUTRAL = ['聰明', '舒服', '清楚', '暖和', '便宜', '麻煩', '漂亮', '厲害', '客氣', '他們', '我們', '你們'];

describe('word lists', () => {
  it('splits by source and combine into ALL_WORDS', () => {
    expect(SINOSPLICE_WORDS.every((w) => w.source === 'sinosplice')).toBe(true);
    expect(EXTENDED_WORDS.every((w) => w.source === 'extended')).toBe(true);
    expect(ALL_WORDS).toHaveLength(SINOSPLICE_WORDS.length + EXTENDED_WORDS.length);
  });
});

describe('buildPool — mode', () => {
  it('restricts single mode to one-syllable words', () => {
    const pool = buildPool(SINOSPLICE_WORDS, opts({ mode: 'single' }));
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((w) => w.syllables.length === 1)).toBe(true);
  });

  it('restricts pair mode to two-syllable words', () => {
    const pool = buildPool(SINOSPLICE_WORDS, opts({ mode: 'pair' }));
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((w) => w.syllables.length === 2)).toBe(true);
  });

  it('combines both in mixed mode', () => {
    const single = buildPool(SINOSPLICE_WORDS, opts({ mode: 'single' })).length;
    const pair = buildPool(SINOSPLICE_WORDS, opts({ mode: 'pair' })).length;
    expect(buildPool(SINOSPLICE_WORDS, opts({ mode: 'mixed' }))).toHaveLength(single + pair);
  });
});

describe('buildPool — deck selection', () => {
  it('draws from the named decks only', () => {
    expect(buildPool(ALL_WORDS, opts({ decks: ['extended'] })).every((w) => w.source === 'extended')).toBe(true);
  });

  it('returns an empty pool when no deck is selected', () => {
    expect(buildPool(ALL_WORDS, opts({ decks: [] }))).toEqual([]);
  });

  it('drops duplicate headwords when both decks are selected', () => {
    // 50 words appear in both decks; the same word must not be drillable twice
    // in one session.
    const pool = buildPool(ALL_WORDS, opts({ decks: ['sinosplice', 'extended'] }));
    const heads = pool.map((w) => w.traditional);
    expect(heads).toHaveLength(new Set(heads).size);
  });

  it('prefers the human recording over synthesis for shared headwords', () => {
    const pool = buildPool(ALL_WORDS, opts({ decks: ['sinosplice', 'extended'] }));
    const shared = new Set(SINOSPLICE_WORDS.map((w) => w.traditional));
    const wrong = pool.filter((w) => shared.has(w.traditional) && w.audio.kind !== 'file');
    expect(wrong.map((w) => w.traditional)).toEqual([]);
  });

  it('keeps deck order stable regardless of how decks are listed', () => {
    const a = buildPool(ALL_WORDS, opts({ decks: ['sinosplice', 'extended'] })).map((w) => w.id);
    const b = buildPool(ALL_WORDS, opts({ decks: ['extended', 'sinosplice'] })).map((w) => w.id);
    expect(a).toEqual(b);
  });
});

describe('buildPool — neutral tone', () => {
  it('includes neutral-tone words by default', () => {
    const heads = buildPool(SINOSPLICE_WORDS, opts()).map((w) => w.traditional);
    expect(SINO_NEUTRAL.filter((t) => !heads.includes(t))).toEqual([]);
  });

  it('removes exactly the neutral-tone words when excluded', () => {
    const kept = buildPool(SINOSPLICE_WORDS, opts({ includeNeutral: false }));
    const heads = kept.map((w) => w.traditional);
    expect(SINO_NEUTRAL.filter((t) => heads.includes(t))).toEqual([]);
    expect(kept).toHaveLength(SINOSPLICE_WORDS.length - SINO_NEUTRAL.length);
    expect(kept.every((w) => w.syllables.every((s) => s.tone !== 0))).toBe(true);
  });
});

describe('buildPool — tone key restriction', () => {
  it('keeps only the requested tone patterns', () => {
    const pool = buildPool(SINOSPLICE_WORDS, opts({ mode: 'pair', toneKeys: ['3-3', '2-3'] }));
    expect(pool.length).toBeGreaterThan(0);
    expect(new Set(pool.map((w) => toneKey(w.syllables)))).toEqual(new Set(['3-3', '2-3']));
  });

  it('treats null as no restriction', () => {
    const all = buildPool(SINOSPLICE_WORDS, opts({ toneKeys: null }));
    expect(all).toHaveLength(SINOSPLICE_WORDS.length);
  });

  it('returns an empty pool for a pattern nothing matches', () => {
    // The UI must cope with an impossible filter rather than crash on an empty draw.
    expect(buildPool(SINOSPLICE_WORDS, opts({ toneKeys: ['1-1-1'] }))).toEqual([]);
  });

  it('combines with mode: a single-syllable key yields nothing in pair mode', () => {
    expect(buildPool(SINOSPLICE_WORDS, opts({ mode: 'pair', toneKeys: ['3'] }))).toEqual([]);
  });
});

describe('availableToneKeys', () => {
  it('lists the distinct patterns in a word list, sorted', () => {
    const keys = availableToneKeys(SINOSPLICE_WORDS.filter((w) => w.syllables.length === 1));
    expect(keys).toEqual(['1', '2', '3', '4']);
  });

  it('includes neutral patterns for pairs', () => {
    const keys = availableToneKeys(SINOSPLICE_WORDS.filter((w) => w.syllables.length === 2));
    expect(keys).toContain('1-0');
    expect(keys).toContain('3-3');
    expect(keys).toHaveLength(20);
  });
});
