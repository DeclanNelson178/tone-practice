import { describe, expect, it } from 'vitest';
import {
  NEUTRAL,
  isTone,
  parseToneString,
  toDiacritics,
  toneKey,
  type Syllable,
} from '../src/core/tones';

const syl = (pinyin: string, tone: number): Syllable => ({ pinyin, tone: tone as never });

describe('NEUTRAL', () => {
  it('is tone 0', () => {
    expect(NEUTRAL).toBe(0);
  });
});

describe('isTone', () => {
  it('accepts 0 through 4', () => {
    expect([0, 1, 2, 3, 4].every(isTone)).toBe(true);
  });

  it('rejects 5, negative, and fractional values', () => {
    // 5 is CEDICT's neutral marker, not a tone in our model -- it must be
    // normalized by the parser, never accepted raw.
    expect(isTone(5)).toBe(false);
    expect(isTone(-1)).toBe(false);
    expect(isTone(1.5)).toBe(false);
  });
});

describe('parseToneString', () => {
  it('parses a Sinosplice MP3 basename', () => {
    expect(parseToneString('hao3chi1')).toEqual([syl('hao', 3), syl('chi', 1)]);
  });

  it('parses a single-syllable basename', () => {
    expect(parseToneString('e4')).toEqual([syl('e', 4)]);
  });

  it('treats Sinosplice tone 0 as neutral', () => {
    expect(parseToneString('cong1ming0')).toEqual([syl('cong', 1), syl('ming', NEUTRAL)]);
  });

  it('normalizes CEDICT tone 5 to neutral', () => {
    // The two sources disagree on how to write neutral tone; both must land
    // on the same internal representation or the decks cannot be compared.
    expect(parseToneString('cong1 ming5')).toEqual([syl('cong', 1), syl('ming', NEUTRAL)]);
  });

  it('accepts CEDICT bracket syntax', () => {
    expect(parseToneString('[hao3 chi1]')).toEqual([syl('hao', 3), syl('chi', 1)]);
  });

  it('converts the CEDICT u: digraph to ü', () => {
    expect(parseToneString('nu:e4')).toEqual([syl('nüe', 4)]);
    expect(parseToneString('lu:4')).toEqual([syl('lü', 4)]);
  });

  it('is case-insensitive', () => {
    expect(parseToneString('Hao3 Chi1')).toEqual([syl('hao', 3), syl('chi', 1)]);
  });

  it('parses the three-syllable pronoun forms', () => {
    expect(parseToneString('ta1men0')).toEqual([syl('ta', 1), syl('men', NEUTRAL)]);
  });

  it('returns null for input with no tone digits', () => {
    expect(parseToneString('hao')).toBeNull();
    expect(parseToneString('')).toBeNull();
  });

  it('returns null when any syllable lacks a tone digit', () => {
    // Partial parses are worse than no parse: a missing digit would silently
    // become a wrong answer key.
    expect(parseToneString('hao3chi')).toBeNull();
  });

  it('returns null for non-pinyin junk', () => {
    expect(parseToneString('(不),*')).toBeNull();
    expect(parseToneString('123')).toBeNull();
  });
});

describe('toDiacritics', () => {
  const render = (s: string) => toDiacritics(parseToneString(s)!);

  it('marks a when present', () => {
    expect(render('hao3')).toBe('hǎo');
    expect(render('wan3')).toBe('wǎn');
    expect(render('kuai4')).toBe('kuài');
  });

  it('marks o when there is no a', () => {
    expect(render('you2')).toBe('yóu');
    expect(render('duo1')).toBe('duō');
    expect(render('zhong4')).toBe('zhòng');
  });

  it('marks e when there is no a or o', () => {
    expect(render('mei3')).toBe('měi');
    expect(render('xie4')).toBe('xiè');
    expect(render('te4')).toBe('tè');
  });

  it('marks the last vowel in i/u/ü clusters', () => {
    expect(render('jiu3')).toBe('jiǔ');
    expect(render('gui4')).toBe('guì');
    expect(render('shui3')).toBe('shuǐ');
  });

  it('marks ü', () => {
    expect(render('lu:4')).toBe('lǜ');
    expect(render('nu:e4')).toBe('nüè');
  });

  it('leaves neutral-tone syllables unmarked', () => {
    expect(render('ming0')).toBe('ming');
    expect(render('cong1ming0')).toBe('cōng ming');
  });

  it('renders all four tones on the same vowel', () => {
    expect(['ma1', 'ma2', 'ma3', 'ma4'].map(render)).toEqual(['mā', 'má', 'mǎ', 'mà']);
  });

  it('space-separates multi-syllable words', () => {
    expect(render('hao3chi1')).toBe('hǎo chī');
    expect(render('ta1men0')).toBe('tā men');
  });
});

describe('toneKey', () => {
  it('joins tones with a hyphen', () => {
    expect(toneKey([syl('hao', 3), syl('chi', 1)])).toBe('3-1');
  });

  it('renders neutral as 0', () => {
    expect(toneKey([syl('cong', 1), syl('ming', NEUTRAL)])).toBe('1-0');
  });

  it('handles single syllables', () => {
    expect(toneKey([syl('e', 4)])).toBe('4');
  });
});
