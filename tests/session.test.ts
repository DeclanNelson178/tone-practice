import { describe, expect, it } from 'vitest';

import { Session, drawWord, grade, makeRng, weightsFromStats } from '../src/core/session';
import type { Tone } from '../src/core/tones';
import type { Word } from '../src/core/types';

function word(traditional: string, tones: Tone[]): Word {
  return {
    id: `t:${traditional}`,
    traditional,
    syllables: tones.map((tone, i) => ({ pinyin: `s${i}`, tone })),
    gloss: 'gloss',
    audio: { kind: 'tts', text: traditional },
    source: 'extended',
  };
}

/** An RNG that replays a fixed script, so draws are exactly predictable. */
const scripted = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('differs between seeds', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it('stays within [0, 1)', () => {
    const rng = makeRng(7);
    const values = Array.from({ length: 500 }, rng);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('grade', () => {
  const haochi = word('好吃', [3, 1]);

  it('accepts a fully correct answer', () => {
    expect(grade(haochi, [3, 1])).toEqual({
      correct: true,
      perSyllable: [true, true],
      expected: [3, 1],
      given: [3, 1],
    });
  });

  it('reports which syllable was wrong', () => {
    // Knowing *which* half you missed is the point of drilling pairs.
    const g = grade(haochi, [2, 1]);
    expect(g.correct).toBe(false);
    expect(g.perSyllable).toEqual([false, true]);
  });

  it('reports a second-syllable miss', () => {
    expect(grade(haochi, [3, 4]).perSyllable).toEqual([true, false]);
  });

  it('grades neutral tone as its own answer', () => {
    const congming = word('聰明', [1, 0]);
    expect(grade(congming, [1, 0]).correct).toBe(true);
    // Neutral is not interchangeable with any numbered tone.
    expect(grade(congming, [1, 1]).correct).toBe(false);
  });

  it('grades single syllables', () => {
    expect(grade(word('大', [4]), [4]).correct).toBe(true);
    expect(grade(word('大', [4]), [3]).correct).toBe(false);
  });

  it('rejects an answer with the wrong number of tones', () => {
    const g = grade(haochi, [3]);
    expect(g.correct).toBe(false);
    expect(g.perSyllable).toEqual([true, false]);
  });
});

describe('drawWord', () => {
  const pool = [word('A', [1]), word('B', [2]), word('C', [3])];

  it('returns null for an empty pool', () => {
    expect(drawWord([], makeRng(1), {})).toBeNull();
  });

  it('picks by scaled random index', () => {
    expect(drawWord(pool, scripted(0), {})?.traditional).toBe('A');
    expect(drawWord(pool, scripted(0.5), {})?.traditional).toBe('B');
    expect(drawWord(pool, scripted(0.99), {})?.traditional).toBe('C');
  });

  it('avoids recently seen words', () => {
    const picked = drawWord(pool, scripted(0), { recent: ['t:A'] });
    expect(picked?.traditional).toBe('B');
  });

  it('falls back to the full pool when everything is recent', () => {
    // A tone-pair filter can leave a single word in the pool. Repeating it beats
    // returning null and stalling the drill.
    const one = [word('A', [1])];
    expect(drawWord(one, makeRng(3), { recent: ['t:A'] })?.traditional).toBe('A');
  });

  it('honours the avoid window size', () => {
    const recent = ['t:A', 't:B'];
    expect(drawWord(pool, scripted(0), { recent, avoidWindow: 1 })?.traditional).toBe('A');
    expect(drawWord(pool, scripted(0), { recent, avoidWindow: 2 })?.traditional).toBe('C');
  });

  it('respects weights when choosing', () => {
    // Weights 1 and 3 over [A, B] give a total of 4; a draw of 0.5 lands at 2.0,
    // past A's cumulative 1, so B wins.
    const two = [word('A', [1]), word('B', [2])];
    const weights = new Map([
      ['1', 1],
      ['2', 3],
    ]);
    expect(drawWord(two, scripted(0.2), { weights })?.traditional).toBe('A');
    expect(drawWord(two, scripted(0.5), { weights })?.traditional).toBe('B');
  });

  it('draws heavily weighted words more often', () => {
    const two = [word('A', [1]), word('B', [2])];
    const weights = new Map([
      ['1', 1],
      ['2', 3],
    ]);
    const rng = makeRng(99);
    const counts = { A: 0, B: 0 };
    for (let i = 0; i < 4000; i++) {
      counts[drawWord(two, rng, { weights })!.traditional as 'A' | 'B']++;
    }
    // Expect roughly 1:3; allow slack so the test is not flaky-by-design.
    expect(counts.B / counts.A).toBeGreaterThan(2.5);
    expect(counts.B / counts.A).toBeLessThan(3.5);
  });
});

describe('weightsFromStats', () => {
  it('weights an unseen pattern neutrally', () => {
    expect(weightsFromStats(new Map())).toEqual(new Map());
  });

  it('ignores patterns with too few attempts to judge', () => {
    // Two attempts is noise, not evidence of weakness.
    const stats = new Map([['3-3', { asked: 2, correct: 0 }]]);
    expect(weightsFromStats(stats).get('3-3')).toBeUndefined();
  });

  it('weights a perfectly answered pattern at 1', () => {
    const stats = new Map([['1-1', { asked: 10, correct: 10 }]]);
    expect(weightsFromStats(stats).get('1-1')).toBe(1);
  });

  it('scales weight with miss rate', () => {
    const stats = new Map([
      ['3-3', { asked: 10, correct: 0 }],
      ['2-3', { asked: 10, correct: 5 }],
    ]);
    const w = weightsFromStats(stats, { boost: 3 });
    expect(w.get('3-3')).toBeCloseTo(4);
    expect(w.get('2-3')).toBeCloseTo(2.5);
  });
});

describe('Session', () => {
  const pool = [word('A', [1]), word('B', [2]), word('C', [3])];

  it('yields a question and tracks it as current', () => {
    const s = new Session(pool, { rng: makeRng(1) });
    const q = s.next();
    expect(q).not.toBeNull();
    expect(s.current).toBe(q);
    expect(q!.slots).toBe(1);
  });

  it('reports slot count from the word', () => {
    const s = new Session([word('好吃', [3, 1])], { rng: makeRng(1) });
    expect(s.next()!.slots).toBe(2);
  });

  it('returns null when the pool is empty', () => {
    expect(new Session([], { rng: makeRng(1) }).next()).toBeNull();
  });

  it('counts score and streak', () => {
    const s = new Session([word('X', [1])], { rng: makeRng(1) });
    s.next();
    s.answer([1]);
    s.next();
    s.answer([1]);
    expect(s.summary.asked).toBe(2);
    expect(s.summary.correct).toBe(2);
    expect(s.summary.streak).toBe(2);
    expect(s.summary.accuracy).toBe(1);
  });

  it('resets the streak on a miss but keeps the best', () => {
    const s = new Session([word('X', [1])], { rng: makeRng(1) });
    for (const a of [[1], [1], [1]] as Tone[][]) {
      s.next();
      s.answer(a);
    }
    expect(s.summary.streak).toBe(3);
    s.next();
    s.answer([2]);
    expect(s.summary.streak).toBe(0);
    expect(s.summary.bestStreak).toBe(3);
    expect(s.summary.accuracy).toBeCloseTo(0.75);
  });

  it('reports accuracy as 0 before anything is asked', () => {
    expect(new Session(pool, { rng: makeRng(1) }).summary.accuracy).toBe(0);
  });

  it('breaks results down by tone pattern', () => {
    const s = new Session([word('好吃', [3, 1])], { rng: makeRng(1) });
    s.next();
    s.answer([3, 1]);
    s.next();
    s.answer([2, 1]);
    expect(s.summary.byToneKey.get('3-1')).toEqual({ asked: 2, correct: 1 });
  });

  it('refuses to grade with no active question', () => {
    const s = new Session(pool, { rng: makeRng(1) });
    expect(() => s.answer([1])).toThrow(/no active question/i);
  });

  it('refuses to grade the same question twice', () => {
    // Double-submits (a stray keypress during the reveal) must not inflate the score.
    const s = new Session(pool, { rng: makeRng(1) });
    s.next();
    s.answer([1]);
    expect(() => s.answer([1])).toThrow(/already answered/i);
  });

  it('avoids immediate repeats when the pool allows it', () => {
    const s = new Session(pool, { rng: makeRng(5), avoidWindow: 2 });
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      seen.push(s.next()!.word.traditional);
      s.answer([1]);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).not.toBe(seen[i - 1]);
    }
  });

  it('is reproducible for a given seed', () => {
    const run = () => {
      const s = new Session(pool, { rng: makeRng(2024) });
      const out: string[] = [];
      for (let i = 0; i < 10; i++) {
        out.push(s.next()!.word.traditional);
        s.answer([1]);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('over-samples patterns the learner keeps missing', () => {
    // The reason weighting exists: 3-3 should come up more once it is clearly weak.
    const mixed = [word('AA', [3, 3]), word('BB', [1, 1])];
    const priorStats = new Map([
      ['3-3', { asked: 20, correct: 0 }],
      ['1-1', { asked: 20, correct: 20 }],
    ]);
    const weighted = new Session(mixed, { rng: makeRng(11), priorStats, avoidWindow: 0 });
    const plain = new Session(mixed, { rng: makeRng(11), avoidWindow: 0 });

    const countThrees = (s: Session) => {
      let n = 0;
      for (let i = 0; i < 600; i++) {
        if (s.next()!.word.traditional === 'AA') n++;
        s.answer([9 as Tone]);
      }
      return n;
    };

    expect(countThrees(weighted)).toBeGreaterThan(countThrees(plain) * 1.4);
  });
});
