/**
 * Drill session: what to ask next, and whether the answer was right.
 *
 * The RNG is injected rather than reaching for Math.random so sessions are reproducible
 * and the weighting behaviour can be asserted exactly.
 */

import { toneKey, type Tone } from './tones';
import type { Word } from './types';

export type Rng = () => number;

/** mulberry32 — small, fast, and good enough for drawing flashcards. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Question {
  word: Word;
  /** How many tones the learner must supply — one button row per slot. */
  slots: number;
}

export interface Grade {
  correct: boolean;
  /** Per-syllable correctness, so the reveal can point at the half that was missed. */
  perSyllable: boolean[];
  expected: Tone[];
  given: Tone[];
}

export interface Tally {
  asked: number;
  correct: number;
}

export type StatsByToneKey = ReadonlyMap<string, Tally>;

export function grade(word: Word, answer: readonly Tone[]): Grade {
  const expected = word.syllables.map((s) => s.tone);
  const perSyllable = expected.map((tone, i) => answer[i] === tone);
  return {
    correct: perSyllable.every(Boolean) && answer.length === expected.length,
    perSyllable,
    expected,
    given: [...answer],
  };
}

export interface DrawOptions {
  /** Word ids to avoid re-drawing, most recent last. */
  recent?: readonly string[];
  /** How many of `recent` to honour. Default 10. */
  avoidWindow?: number;
  /** Multiplier per tone pattern; absent patterns weigh 1. */
  weights?: ReadonlyMap<string, number>;
}

export function drawWord(pool: readonly Word[], rng: Rng, options: DrawOptions): Word | null {
  if (pool.length === 0) return null;

  const { recent = [], avoidWindow = 10, weights } = options;
  const blocked = new Set(avoidWindow > 0 ? recent.slice(-avoidWindow) : []);

  // A narrow tone-pair filter can leave one word in the pool; repeating it is better
  // than stalling the drill, so fall back to the unfiltered pool.
  let candidates = pool.filter((w) => !blocked.has(w.id));
  if (candidates.length === 0) candidates = [...pool];

  if (!weights) {
    return candidates[Math.floor(rng() * candidates.length)] ?? candidates[candidates.length - 1]!;
  }

  const scores = candidates.map((w) => Math.max(0, weights.get(toneKey(w.syllables)) ?? 1));
  const total = scores.reduce((a, b) => a + b, 0);
  if (total <= 0) return candidates[Math.floor(rng() * candidates.length)]!;

  let pick = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    pick -= scores[i]!;
    if (pick < 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

export interface WeightOptions {
  /** How much a fully missed pattern is favoured: weight = 1 + boost * missRate. */
  boost?: number;
  /** Attempts needed before a pattern is judged weak. Default 3. */
  minAttempts?: number;
}

/**
 * Turns accuracy history into draw weights, so the pairs you actually miss come up more.
 *
 * Patterns with too few attempts are left out entirely — two wrong answers is noise, and
 * treating it as weakness would just chase whatever came up first.
 */
export function weightsFromStats(stats: StatsByToneKey, options: WeightOptions = {}): Map<string, number> {
  const { boost = 3, minAttempts = 3 } = options;
  const weights = new Map<string, number>();

  for (const [key, { asked, correct }] of stats) {
    if (asked < minAttempts) continue;
    const missRate = 1 - correct / asked;
    weights.set(key, 1 + boost * missRate);
  }

  return weights;
}

export interface Summary {
  asked: number;
  correct: number;
  /** 0 when nothing has been asked yet. */
  accuracy: number;
  streak: number;
  bestStreak: number;
  byToneKey: Map<string, Tally>;
}

export interface SessionOptions {
  rng?: Rng;
  avoidWindow?: number;
  /** Accuracy carried in from previous sessions, used to weight the draw. */
  priorStats?: StatsByToneKey;
  weightOptions?: WeightOptions;
}

export class Session {
  private readonly pool: readonly Word[];
  private readonly rng: Rng;
  private readonly avoidWindow: number;
  private readonly weights: ReadonlyMap<string, number> | undefined;

  private readonly recent: string[] = [];
  private readonly tallies = new Map<string, Tally>();

  private question: Question | null = null;
  private answered = false;

  private askedCount = 0;
  private correctCount = 0;
  private currentStreak = 0;
  private best = 0;

  constructor(pool: readonly Word[], options: SessionOptions = {}) {
    this.pool = pool;
    this.rng = options.rng ?? makeRng(1);
    this.avoidWindow = options.avoidWindow ?? 10;
    this.weights = options.priorStats
      ? weightsFromStats(options.priorStats, options.weightOptions)
      : undefined;
  }

  get current(): Question | null {
    return this.question;
  }

  /** True once the active question has been graded — the UI is showing the reveal. */
  get isAnswered(): boolean {
    return this.answered;
  }

  next(): Question | null {
    const word = drawWord(this.pool, this.rng, {
      recent: this.recent,
      avoidWindow: this.avoidWindow,
      ...(this.weights ? { weights: this.weights } : {}),
    });
    if (!word) {
      this.question = null;
      return null;
    }

    this.recent.push(word.id);
    if (this.recent.length > 100) this.recent.shift();

    this.question = { word, slots: word.syllables.length };
    this.answered = false;
    return this.question;
  }

  answer(tones: readonly Tone[]): Grade {
    if (!this.question) throw new Error('no active question — call next() first');
    if (this.answered) throw new Error('question already answered');

    const result = grade(this.question.word, tones);
    this.answered = true;

    this.askedCount++;
    const key = toneKey(this.question.word.syllables);
    const tally = this.tallies.get(key) ?? { asked: 0, correct: 0 };
    tally.asked++;

    if (result.correct) {
      this.correctCount++;
      tally.correct++;
      this.currentStreak++;
      this.best = Math.max(this.best, this.currentStreak);
    } else {
      this.currentStreak = 0;
    }

    this.tallies.set(key, tally);
    return result;
  }

  get summary(): Summary {
    return {
      asked: this.askedCount,
      correct: this.correctCount,
      accuracy: this.askedCount === 0 ? 0 : this.correctCount / this.askedCount,
      streak: this.currentStreak,
      bestStreak: this.best,
      byToneKey: new Map([...this.tallies].map(([k, v]) => [k, { ...v }])),
    };
  }
}
