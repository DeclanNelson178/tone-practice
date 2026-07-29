/**
 * Integrity tests for the generated decks.
 *
 * These guard the committed JSON, not the builder's internals. Their job is to fail loudly
 * if a rebuild ever reintroduces one of the upstream quirks the builder exists to fix, or
 * silently drops audio a word depends on.
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import extendedDeck from '../src/data/extended-deck.json';
import sinospliceDeck from '../src/data/sinosplice-deck.json';
import { isTone, toDiacritics, toneKey } from '../src/core/tones';
import type { Deck } from '../src/core/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR = join(ROOT, 'public', 'audio', 'sinosplice');

const sino = sinospliceDeck as Deck;
const extended = extendedDeck as Deck;
const allWords = [...sino.words, ...extended.words];

describe.each([
  ['sinosplice', sino],
  ['extended', extended],
])('%s deck', (name, deck) => {
  it('is non-empty and self-describing', () => {
    expect(deck.words.length).toBeGreaterThan(0);
    expect(deck.source).toBe(name);
    expect(deck.attribution).not.toBe('');
  });

  it('gives every word at least one syllable', () => {
    expect(deck.words.filter((w) => w.syllables.length === 0)).toEqual([]);
  });

  it('has one syllable per character', () => {
    // Sinosplice pairs characters and MP3 links positionally, so a layout change
    // could silently offset them. A syllable/character mismatch is the tell.
    const bad = deck.words
      .filter((w) => w.syllables.length !== [...w.traditional].length)
      .map((w) => `${w.traditional} (${w.syllables.length} syllables)`);
    expect(bad).toEqual([]);
  });

  it('uses only tones 0-4, never a raw CEDICT 5', () => {
    const bad = deck.words
      .filter((w) => !w.syllables.every((s) => isTone(s.tone)))
      .map((w) => `${w.traditional} → ${toneKey(w.syllables)}`);
    expect(bad).toEqual([]);
  });

  it('glosses every word', () => {
    expect(deck.words.filter((w) => w.gloss.trim() === '').map((w) => w.traditional)).toEqual([]);
  });

  it('contains only Han characters in the headword', () => {
    // Catches footnote artifacts like "(不),*" and any stray markup or punctuation
    // that survived HTML stripping.
    const bad = deck.words.filter((w) => !/^[一-鿿]+$/u.test(w.traditional));
    expect(bad.map((w) => w.traditional)).toEqual([]);
  });

  it('renders pinyin for every word', () => {
    const bad = deck.words.filter((w) => toDiacritics(w.syllables).trim() === '');
    expect(bad.map((w) => w.traditional)).toEqual([]);
  });
});

describe('deck ids', () => {
  it('are unique across both decks', () => {
    const ids = allWords.map((w) => w.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('are namespaced by source', () => {
    expect(sino.words.every((w) => w.id.startsWith('sino:'))).toBe(true);
    expect(extended.words.every((w) => w.id.startsWith('ext:'))).toBe(true);
  });
});

describe('sinosplice audio', () => {
  const clips = sino.words.flatMap((w) => (w.audio.kind === 'file' ? [w.audio.src] : []));

  it('is a bundled file for every word', () => {
    expect(clips.length).toBe(sino.words.length);
  });

  it('resolves every referenced clip on disk', () => {
    const missing = clips.filter((src) => !existsSync(join(ROOT, 'public', src.replace(/^audio\//, 'audio/'))));
    expect(missing).toEqual([]);
  });

  it('ships no orphan clips', () => {
    // Stale MP3s from an earlier build would bloat the repo unnoticed.
    const referenced = new Set(clips.map((src) => src.split('/').pop()));
    const onDisk = readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3'));
    expect(onDisk.filter((f) => !referenced.has(f))).toEqual([]);
  });

  it('names each clip after the tones it encodes', () => {
    // The clip filename is the answer key's origin; this asserts they never drift.
    const bad = sino.words.filter((w) => {
      if (w.audio.kind !== 'file') return false;
      const clip = w.audio.src.split('/').pop()!.replace('.mp3', '');
      const digits = clip.match(/[0-5]/g)!.map((d) => (d === '5' ? 0 : Number(d)));
      return digits.join('-') !== toneKey(w.syllables);
    });
    expect(bad.map((w) => w.traditional)).toEqual([]);
  });
});

describe('sinosplice tone coverage', () => {
  const pairKeys = new Set(sino.words.filter((w) => w.syllables.length === 2).map((w) => toneKey(w.syllables)));

  it('covers all 16 tone pairs', () => {
    const expected = [1, 2, 3, 4].flatMap((a) => [1, 2, 3, 4].map((b) => `${a}-${b}`));
    expect(expected.filter((k) => !pairKeys.has(k))).toEqual([]);
  });

  it('covers a neutral second syllable after each of the four tones', () => {
    expect([1, 2, 3, 4].filter((a) => !pairKeys.has(`${a}-0`))).toEqual([]);
  });

  it('covers all four tones as single syllables', () => {
    const singles = new Set(sino.words.filter((w) => w.syllables.length === 1).map((w) => toneKey(w.syllables)));
    expect([1, 2, 3, 4].filter((t) => !singles.has(String(t)))).toEqual([]);
  });
});

describe('sinosplice upstream quirks stay fixed', () => {
  const find = (t: string) => sino.words.find((w) => w.traditional === t);

  it('writes 合適 with the traditional 適', () => {
    expect(find('合適')).toBeDefined();
    expect(find('合适')).toBeUndefined();
  });

  it('excludes the sandhi footnote entries', () => {
    // 不/很/挺 appear a second time in the chart with a sandhi-altered tone. Those cells
    // must not become drill items, or 不 would have two contradictory answer keys.
    const bu = sino.words.filter((w) => w.traditional === '不');
    expect(bu).toHaveLength(1);
    expect(toneKey(bu[0]!.syllables)).toBe('4');
    expect(sino.words.filter((w) => w.traditional === '很').map((w) => toneKey(w.syllables))).toEqual(['3']);
    expect(sino.words.filter((w) => w.traditional === '挺').map((w) => toneKey(w.syllables))).toEqual(['3']);
  });

  it('merges characters that share one recording', () => {
    // 他/她/它 are homophones with a single clip; keeping three entries would triple
    // their odds of being drawn while sounding identical.
    expect(find('他')?.alsoWritten).toEqual(['她', '它']);
    expect(find('她')).toBeUndefined();
    expect(find('它')).toBeUndefined();
    expect(find('他們')?.alsoWritten).toEqual(['她們', '它們']);
  });

  it('lists 特別 once despite appearing in two chart sections', () => {
    expect(sino.words.filter((w) => w.traditional === '特別')).toHaveLength(1);
  });

  it('takes pinyin from the recording, not the dictionary', () => {
    // The chart links 暖和 to a nuan3he0 recording while CC-CEDICT reads it nuǎnhuo.
    // The displayed pinyin must match the audio the learner just heard.
    expect(toDiacritics(find('暖和')!.syllables)).toBe('nuǎn he');
    // 好奇 is hào qí here, which the dictionary confirms -- not a typo to "fix".
    expect(toDiacritics(find('好奇')!.syllables)).toBe('hào qí');
  });
});

describe('extended deck', () => {
  it('synthesizes all audio from the headword', () => {
    const bad = extended.words.filter((w) => w.audio.kind !== 'tts' || w.audio.text !== w.traditional);
    expect(bad.map((w) => w.traditional)).toEqual([]);
  });

  it('excludes 不 and 一, whose tone changes in context', () => {
    // Their spoken tone would not match the written answer key.
    expect(extended.words.filter((w) => /[不一]/.test(w.traditional)).map((w) => w.traditional)).toEqual([]);
  });

  it('excludes simplified-only characters', () => {
    // Guards the simplified→traditional conversion; these are the common giveaways.
    const simplifiedOnly = /[们学时关说车电语会这来对华汉个书买东问题图书门开长间边风]/u;
    const bad = extended.words.filter((w) => simplifiedOnly.test(w.traditional));
    expect(bad.map((w) => w.traditional)).toEqual([]);
  });

  it('converts known words to their traditional form', () => {
    const byTrad = new Set(extended.words.map((w) => w.traditional));
    for (const t of ['學習', '時間', '關係', '認識', '漢語', '說話']) {
      expect(byTrad.has(t), `expected ${t}`).toBe(true);
    }
  });

  it('is large enough to defeat memorizing clips', () => {
    // The whole point of this deck: the Sinosplice set has 1-3 words per tone pair.
    expect(extended.words.length).toBeGreaterThan(500);
  });

  it('provides at least 10 words for every tone pair', () => {
    const counts = new Map<string, number>();
    for (const w of extended.words.filter((w) => w.syllables.length === 2)) {
      const k = toneKey(w.syllables);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const expected = [1, 2, 3, 4].flatMap((a) => [1, 2, 3, 4].map((b) => `${a}-${b}`));
    const thin = expected.filter((k) => (counts.get(k) ?? 0) < 10).map((k) => `${k}=${counts.get(k) ?? 0}`);
    expect(thin).toEqual([]);
  });
});
