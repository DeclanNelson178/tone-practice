/**
 * Keyboard mapping for the drill.
 *
 * Kept as a pure function so the bindings are testable without a DOM — driving the drill
 * from the keyboard is the difference between a few reps and a real practice session, and
 * it is the part hardest to verify by clicking around.
 *
 * Both `event.key` and `event.code` are consulted. `key` is what the layout produced;
 * `code` is the physical key. On AZERTY the unshifted "1" emits "&", and some IMEs
 * swallow the digit entirely — falling back to the physical position keeps 1-4 working
 * regardless of layout.
 */

import { NEUTRAL, type Tone } from '../core/tones';

export type DrillAction =
  | { kind: 'tone'; tone: Tone }
  | { kind: 'replay' }
  | { kind: 'next' }
  | { kind: 'undo' };

/** The parts of a KeyboardEvent this mapping reads. */
export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

const DIGIT_CODE = /^(?:Digit|Numpad)([0-9])$/;

function toneFromDigit(digit: string): Tone | null {
  if (digit === '0' || digit === '5') return NEUTRAL;
  if (/^[1-4]$/.test(digit)) return Number(digit) as Tone;
  return null;
}

export function keyToAction(event: KeyLike): DrillAction | null {
  // Shift is deliberately not included: some layouts need it to type a digit at all.
  if (event.metaKey || event.ctrlKey || event.altKey) return null;

  const { key, code } = event;

  if (key === ' ' || code === 'Space') return { kind: 'replay' };
  if (key === 'Enter' || code === 'Enter' || code === 'NumpadEnter') return { kind: 'next' };
  if (key === 'Backspace') return { kind: 'undo' };

  const fromKey = /^[0-9]$/.test(key) ? toneFromDigit(key) : null;
  if (fromKey !== null) return { kind: 'tone', tone: fromKey };

  const physical = DIGIT_CODE.exec(code)?.[1];
  if (physical !== undefined) {
    const tone = toneFromDigit(physical);
    if (tone !== null) return { kind: 'tone', tone };
  }

  return null;
}
