/**
 * Deck loading and pool construction.
 *
 * A "pool" is the set of words a session may draw from, after applying the learner's
 * choices. Building it is pure and synchronous so the session logic stays testable.
 */

import extendedDeck from '../data/extended-deck.json';
import sinospliceDeck from '../data/sinosplice-deck.json';
import { toneKey } from './tones';
import type { Deck, DeckSource, Word } from './types';

export const SINOSPLICE_DECK = sinospliceDeck as Deck;
export const EXTENDED_DECK = extendedDeck as Deck;

export const SINOSPLICE_WORDS: readonly Word[] = SINOSPLICE_DECK.words;
export const EXTENDED_WORDS: readonly Word[] = EXTENDED_DECK.words;
export const ALL_WORDS: readonly Word[] = [...SINOSPLICE_WORDS, ...EXTENDED_WORDS];

export type DrillMode = 'single' | 'pair' | 'mixed';

export interface PoolOptions {
  mode: DrillMode;
  decks: readonly DeckSource[];
  /** Neutral tone (輕聲) is a real answer option; switching it off drops those words. */
  includeNeutral: boolean;
  /** Restrict to these tone patterns (`3-3`, `2-3`). `null` means no restriction. */
  toneKeys: readonly string[] | null;
}

function matchesMode(word: Word, mode: DrillMode): boolean {
  switch (mode) {
    case 'single':
      return word.syllables.length === 1;
    case 'pair':
      return word.syllables.length === 2;
    case 'mixed':
      return word.syllables.length === 1 || word.syllables.length === 2;
  }
}

/**
 * Applies the learner's choices to a word list.
 *
 * When both decks are selected the ~50 shared headwords are deduplicated, keeping the
 * Sinosplice entry so the learner hears the human recording rather than synthesis. Order
 * follows the input list, not the `decks` array, so the pool is stable however the UI
 * happens to order its checkboxes.
 */
export function buildPool(words: readonly Word[], options: PoolOptions): Word[] {
  const { mode, decks, includeNeutral, toneKeys } = options;
  const wanted = new Set(decks);
  const allowedKeys = toneKeys === null ? null : new Set(toneKeys);

  const pool: Word[] = [];
  const byHeadword = new Map<string, number>();

  for (const word of words) {
    if (!wanted.has(word.source)) continue;
    if (!matchesMode(word, mode)) continue;
    if (!includeNeutral && word.syllables.some((s) => s.tone === 0)) continue;
    if (allowedKeys !== null && !allowedKeys.has(toneKey(word.syllables))) continue;

    const seenAt = byHeadword.get(word.traditional);
    if (seenAt !== undefined) {
      // Prefer a bundled recording over synthesis for the same headword.
      if (pool[seenAt]!.audio.kind !== 'file' && word.audio.kind === 'file') {
        pool[seenAt] = word;
      }
      continue;
    }

    byHeadword.set(word.traditional, pool.length);
    pool.push(word);
  }

  return pool;
}

/** Distinct tone patterns present in a word list, sorted — used to build the filter UI. */
export function availableToneKeys(words: readonly Word[]): string[] {
  return [...new Set(words.map((w) => toneKey(w.syllables)))].sort();
}

/** Words in the pool whose tone pattern matches, for showing counts next to a filter. */
export function countByToneKey(words: readonly Word[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of words) {
    const key = toneKey(w.syllables);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
