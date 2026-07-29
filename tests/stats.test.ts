import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STATS_VERSION,
  STORAGE_KEY,
  createStatsStore,
  type KeyValueStore,
} from '../src/core/stats';
import type { Tally } from '../src/core/session';

class FakeStore implements KeyValueStore {
  readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const stored = (payload: unknown) => JSON.stringify(payload);
const tallies = (obj: Record<string, Tally>) => new Map(Object.entries(obj));

let backing: FakeStore;

beforeEach(() => {
  backing = new FakeStore();
});

describe('load', () => {
  it('is empty on first run', () => {
    expect(createStatsStore(backing).load().size).toBe(0);
  });

  it('round-trips what merge wrote', () => {
    const store = createStatsStore(backing);
    store.merge(tallies({ '3-3': { asked: 4, correct: 1 } }));

    expect(createStatsStore(backing).load()).toEqual(tallies({ '3-3': { asked: 4, correct: 1 } }));
  });

  it('recovers from corrupt JSON and clears it', () => {
    backing.setItem(STORAGE_KEY, '{not json at all');

    const store = createStatsStore(backing);
    expect(store.load().size).toBe(0);
    // Leaving the bad value in place would make every future load pay the same cost.
    expect(backing.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards data written by a different schema version', () => {
    backing.setItem(STORAGE_KEY, stored({ version: STATS_VERSION + 1, byToneKey: { '1-1': { asked: 5, correct: 5 } } }));
    expect(createStatsStore(backing).load().size).toBe(0);
  });

  it('ignores a payload that is not an object', () => {
    for (const junk of ['null', '42', '"text"', '[]']) {
      backing.setItem(STORAGE_KEY, junk);
      expect(createStatsStore(backing).load().size).toBe(0);
    }
  });

  it('drops nonsensical entries but keeps the valid ones', () => {
    // Partial recovery beats discarding a learner's whole history over one bad key.
    backing.setItem(
      STORAGE_KEY,
      stored({
        version: STATS_VERSION,
        byToneKey: {
          '1-1': { asked: 10, correct: 7 },
          '2-2': { asked: 3, correct: 9 }, // correct exceeds asked
          '3-3': { asked: -1, correct: 0 }, // negative
          '4-4': { asked: 2.5, correct: 1 }, // non-integer
          '1-2': { asked: 'x', correct: 1 }, // wrong type
          '1-3': null,
          '1-4': { correct: 3 }, // missing asked
        },
      }),
    );

    expect(createStatsStore(backing).load()).toEqual(tallies({ '1-1': { asked: 10, correct: 7 } }));
  });
});

describe('merge', () => {
  it('accumulates across sessions', () => {
    const store = createStatsStore(backing);
    store.merge(tallies({ '3-1': { asked: 2, correct: 1 } }));
    const after = store.merge(tallies({ '3-1': { asked: 3, correct: 3 }, '1-1': { asked: 1, correct: 0 } }));

    expect(after).toEqual(tallies({ '3-1': { asked: 5, correct: 4 }, '1-1': { asked: 1, correct: 0 } }));
    expect(createStatsStore(backing).load()).toEqual(after);
  });

  it('returns the merged totals', () => {
    const store = createStatsStore(backing);
    expect(store.merge(tallies({ '2-2': { asked: 1, correct: 1 } }))).toEqual(
      tallies({ '2-2': { asked: 1, correct: 1 } }),
    );
  });

  it('is a no-op for an empty session', () => {
    const store = createStatsStore(backing);
    store.merge(tallies({ '1-1': { asked: 1, correct: 1 } }));
    expect(store.merge(new Map())).toEqual(tallies({ '1-1': { asked: 1, correct: 1 } }));
  });

  it('writes the current schema version', () => {
    createStatsStore(backing).merge(tallies({ '1-1': { asked: 1, correct: 1 } }));
    expect(JSON.parse(backing.getItem(STORAGE_KEY)!).version).toBe(STATS_VERSION);
  });
});

describe('reset', () => {
  it('clears stored history', () => {
    const store = createStatsStore(backing);
    store.merge(tallies({ '1-1': { asked: 1, correct: 1 } }));
    store.reset();

    expect(store.load().size).toBe(0);
    expect(backing.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('hostile storage', () => {
  it('survives setItem throwing', () => {
    // Safari private browsing and a full quota both throw on write. Losing stats is
    // acceptable; losing the drill is not.
    const throwing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };

    const store = createStatsStore(throwing);
    expect(() => store.merge(tallies({ '1-1': { asked: 1, correct: 1 } }))).not.toThrow();
    expect(store.merge(tallies({ '1-1': { asked: 1, correct: 1 } }))).toEqual(
      tallies({ '1-1': { asked: 1, correct: 1 } }),
    );
  });

  it('survives getItem throwing', () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    };

    expect(() => createStatsStore(throwing).load()).not.toThrow();
    expect(createStatsStore(throwing).load().size).toBe(0);
  });

  it('survives removeItem throwing during corrupt-data cleanup', () => {
    const throwing: KeyValueStore = {
      getItem: () => 'garbage{',
      setItem: () => {},
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };

    expect(() => createStatsStore(throwing).load()).not.toThrow();
  });
});

describe('resolveStore', () => {
  it('falls back to memory when localStorage is unreachable', async () => {
    // Accessing window.localStorage itself throws in some privacy modes.
    const { resolveStore } = await import('../src/core/stats');
    const spy = vi.fn(() => {
      throw new Error('SecurityError');
    });
    const fallback = resolveStore({ get localStorage(): KeyValueStore { return spy(); } } as never);

    expect(() => fallback.setItem('k', 'v')).not.toThrow();
    expect(fallback.getItem('k')).toBe('v');
  });
});
