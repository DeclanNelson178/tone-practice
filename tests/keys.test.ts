import { describe, expect, it } from 'vitest';

import { keyToAction, resolveAction } from '../src/ui/keys';

/** Builds the subset of KeyboardEvent the mapper reads. */
const ev = (key: string, code = '', mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe('tone keys', () => {
  it('maps 1 through 4 to their tones', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(keyToAction(ev(String(n)))).toEqual({ kind: 'tone', tone: n });
    }
  });

  it('maps 0 to neutral', () => {
    expect(keyToAction(ev('0'))).toEqual({ kind: 'tone', tone: 0 });
  });

  it('also accepts 5 for neutral', () => {
    // CC-CEDICT writes neutral as 5, and 5 is the natural reach after 1-4.
    expect(keyToAction(ev('5'))).toEqual({ kind: 'tone', tone: 0 });
  });

  it('accepts the numpad digits', () => {
    expect(keyToAction(ev('1', 'Numpad1'))).toEqual({ kind: 'tone', tone: 1 });
    expect(keyToAction(ev('0', 'Numpad0'))).toEqual({ kind: 'tone', tone: 0 });
  });

  it('falls back to the physical key when the layout does not produce a digit', () => {
    // On AZERTY the unshifted "1" key emits "&"; on other layouts it may emit a dead
    // key or nothing useful. The physical position is what the learner pressed.
    expect(keyToAction(ev('&', 'Digit1'))).toEqual({ kind: 'tone', tone: 1 });
    expect(keyToAction(ev('"', 'Digit3'))).toEqual({ kind: 'tone', tone: 3 });
    expect(keyToAction(ev('à', 'Digit0'))).toEqual({ kind: 'tone', tone: 0 });
  });

  it('ignores digits outside 0-5', () => {
    expect(keyToAction(ev('6'))).toBeNull();
    expect(keyToAction(ev('9'))).toBeNull();
  });
});

describe('transport keys', () => {
  it('maps space to replay', () => {
    expect(keyToAction(ev(' ', 'Space'))).toEqual({ kind: 'replay' });
  });

  it('maps enter to next', () => {
    expect(keyToAction(ev('Enter', 'Enter'))).toEqual({ kind: 'next' });
    expect(keyToAction(ev('Enter', 'NumpadEnter'))).toEqual({ kind: 'next' });
  });

  it('maps backspace to undo', () => {
    expect(keyToAction(ev('Backspace'))).toEqual({ kind: 'undo' });
  });
});

describe('keys that must be left alone', () => {
  it('ignores modified keys so browser shortcuts still work', () => {
    // Cmd-1 switches tabs; intercepting it would be hostile.
    expect(keyToAction(ev('1', 'Digit1', { metaKey: true }))).toBeNull();
    expect(keyToAction(ev('1', 'Digit1', { ctrlKey: true }))).toBeNull();
    expect(keyToAction(ev('1', 'Digit1', { altKey: true }))).toBeNull();
  });

  it('ignores keys with no drill meaning', () => {
    for (const key of ['a', 'Tab', 'Escape', 'ArrowLeft', 'F5']) {
      expect(keyToAction(ev(key, key))).toBeNull();
    }
  });

  it('does not treat shift as a modifier that blocks input', () => {
    // Shift is required for digits on some layouts, so it must not disable them.
    expect(keyToAction({ ...ev('1', 'Digit1'), shiftKey: true } as never)).toEqual({
      kind: 'tone',
      tone: 1,
    });
  });
});

describe('tone keys during the reveal', () => {
  it('advances instead of dying silently', () => {
    // The reveal is where a learner naturally types their next answer. Ignoring the
    // press outright is what made 1-4 feel broken while space and enter kept working.
    for (const tone of [1, 2, 3, 4, 0] as const) {
      expect(resolveAction({ kind: 'tone', tone }, true)).toEqual({ kind: 'next' });
    }
  });

  it('discards the tone rather than answering a word that has not played', () => {
    // Carrying the tone through would commit an answer before the next audio starts,
    // which in a listening drill is worse than dropping the press.
    const resolved = resolveAction({ kind: 'tone', tone: 3 }, true);
    expect(resolved).not.toHaveProperty('tone');
  });

  it('leaves tone keys untouched while answering', () => {
    expect(resolveAction({ kind: 'tone', tone: 3 }, false)).toEqual({ kind: 'tone', tone: 3 });
  });

  it('passes transport keys through in both states', () => {
    for (const revealed of [true, false]) {
      expect(resolveAction({ kind: 'replay' }, revealed)).toEqual({ kind: 'replay' });
      expect(resolveAction({ kind: 'next' }, revealed)).toEqual({ kind: 'next' });
      expect(resolveAction({ kind: 'undo' }, revealed)).toEqual({ kind: 'undo' });
    }
  });

  it('passes an unmapped key through as null', () => {
    expect(resolveAction(null, true)).toBeNull();
    expect(resolveAction(null, false)).toBeNull();
  });
});
