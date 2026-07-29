/**
 * Persistent accuracy history, keyed by tone pattern.
 *
 * This is what makes weak-pair weighting work across sessions: the numbers written here
 * feed weightsFromStats on the next visit. Storage is injected so it can be tested
 * without a DOM, and every access is defensive — losing history is acceptable, but a
 * storage failure must never take the drill down with it.
 */

import type { Tally } from './session';

export const STATS_VERSION = 1;
export const STORAGE_KEY = 'tone-practice:stats';

/** The slice of the Storage API we use; localStorage satisfies it. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StatsStore {
  load(): Map<string, Tally>;
  /** Adds a session's tallies to the stored totals and returns the new totals. */
  merge(session: ReadonlyMap<string, Tally>): Map<string, Tally>;
  reset(): void;
}

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/**
 * Returns localStorage when it is usable, otherwise an in-memory stand-in.
 *
 * Merely *reading* `window.localStorage` throws in some privacy configurations, so the
 * access itself has to be guarded, not just the calls on it.
 */
export function resolveStore(scope: { localStorage: KeyValueStore } = globalThis as never): KeyValueStore {
  try {
    const candidate = scope.localStorage;
    if (!candidate) return memoryStore();
    // Prove it actually works before trusting it.
    const probe = `${STORAGE_KEY}:probe`;
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return memoryStore();
  }
}

function isValidTally(value: unknown): value is Tally {
  if (typeof value !== 'object' || value === null) return false;
  const { asked, correct } = value as Record<string, unknown>;
  return (
    typeof asked === 'number' &&
    typeof correct === 'number' &&
    Number.isInteger(asked) &&
    Number.isInteger(correct) &&
    asked >= 0 &&
    correct >= 0 &&
    correct <= asked
  );
}

export function createStatsStore(storage: KeyValueStore): StatsStore {
  const forget = () => {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing useful to do; the next load will just discard it again.
    }
  };

  const load = (): Map<string, Tally> => {
    let raw: string | null;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      return new Map();
    }
    if (!raw) return new Map();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Clear it, or every future load pays the same cost for the same garbage.
      forget();
      return new Map();
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map();

    const { version, byToneKey } = parsed as Record<string, unknown>;
    if (version !== STATS_VERSION) return new Map();
    if (typeof byToneKey !== 'object' || byToneKey === null) return new Map();

    // Keep the valid entries and drop the rest: partial recovery beats discarding a
    // learner's whole history because one key went bad.
    const out = new Map<string, Tally>();
    for (const [key, value] of Object.entries(byToneKey)) {
      if (isValidTally(value)) out.set(key, { asked: value.asked, correct: value.correct });
    }
    return out;
  };

  const persist = (totals: ReadonlyMap<string, Tally>) => {
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: STATS_VERSION, byToneKey: Object.fromEntries(totals) }),
      );
    } catch {
      // Quota exceeded or a privacy mode that refuses writes. The session still works.
    }
  };

  return {
    load,

    merge(session) {
      const totals = load();
      for (const [key, tally] of session) {
        const existing = totals.get(key) ?? { asked: 0, correct: 0 };
        totals.set(key, {
          asked: existing.asked + tally.asked,
          correct: existing.correct + tally.correct,
        });
      }
      persist(totals);
      return totals;
    },

    reset: forget,
  };
}
