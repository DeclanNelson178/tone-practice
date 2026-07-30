import { describe, expect, it } from 'vitest';

import { TONE_PITCHES, contourPath, pitchToY, toneLabel } from '../src/ui/contour';
import type { Tone } from '../src/core/tones';

/** Pulls the numeric pairs out of an SVG path so geometry can be asserted. */
function points(path: string): Array<[number, number]> {
  return [...path.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
}

const BOX = { width: 100, height: 60, pad: 10 };
const draw = (tone: Tone) => points(contourPath(tone, BOX));

describe('TONE_PITCHES', () => {
  it('uses Chao pitch values for the four tones', () => {
    // The standard five-level notation: 55 level, 35 rising, 214 dipping, 51 falling.
    expect(TONE_PITCHES[1]).toEqual([5, 5]);
    expect(TONE_PITCHES[2]).toEqual([3, 5]);
    expect(TONE_PITCHES[3]).toEqual([2, 1, 4]);
    expect(TONE_PITCHES[4]).toEqual([5, 1]);
  });

  it('gives neutral tone a single mid pitch', () => {
    expect(TONE_PITCHES[0]).toEqual([3]);
  });
});

describe('pitchToY', () => {
  it('puts pitch 5 at the top and pitch 1 at the bottom', () => {
    // SVG y grows downward, so high pitch must map to a small y.
    expect(pitchToY(5, BOX)).toBe(10);
    expect(pitchToY(1, BOX)).toBe(50);
  });

  it('puts pitch 3 in the middle', () => {
    expect(pitchToY(3, BOX)).toBe(30);
  });

  it('is monotonic in pitch', () => {
    const ys = [1, 2, 3, 4, 5].map((p) => pitchToY(p, BOX));
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
  });
});

describe('contourPath', () => {
  it('draws tone 1 flat and high', () => {
    const [start, end] = draw(1) as [[number, number], [number, number]];
    expect(start[1]).toBe(end[1]);
    expect(start[1]).toBe(pitchToY(5, BOX));
  });

  it('draws tone 2 rising to the top', () => {
    const [start, end] = draw(2) as [[number, number], [number, number]];
    expect(end[1]).toBeLessThan(start[1]);
    expect(end[1]).toBe(pitchToY(5, BOX));
  });

  it('draws tone 4 falling from top to bottom', () => {
    const [start, end] = draw(4) as [[number, number], [number, number]];
    expect(start[1]).toBe(pitchToY(5, BOX));
    expect(end[1]).toBe(pitchToY(1, BOX));
  });

  it('draws tone 3 dipping below its start before rising above it', () => {
    // The dip is what distinguishes tone 3 by ear; it must be visible in the glyph.
    const [start, dip, end] = draw(3) as Array<[number, number]>;
    expect(dip![1]).toBeGreaterThan(start![1]);
    expect(end![1]).toBeLessThan(start![1]);
  });

  it('draws neutral tone as a short mark, not a full-width line', () => {
    // Neutral is unstressed and brief; a full-width bar would read as tone 1.
    const marks = draw(0);
    const width = marks[marks.length - 1]![0] - marks[0]![0];
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan((BOX.width - 2 * BOX.pad) / 2);
  });

  it('centres the neutral mark at mid pitch', () => {
    const marks = draw(0);
    expect(marks.every(([, y]) => y === pitchToY(3, BOX))).toBe(true);
  });

  it('spans the full width for the four numbered tones', () => {
    for (const tone of [1, 2, 3, 4] as Tone[]) {
      const marks = draw(tone);
      expect(marks[0]![0]).toBe(BOX.pad);
      expect(marks[marks.length - 1]![0]).toBe(BOX.width - BOX.pad);
    }
  });

  it('stays inside the box for every tone', () => {
    for (const tone of [0, 1, 2, 3, 4] as Tone[]) {
      for (const [x, y] of draw(tone)) {
        expect(x).toBeGreaterThanOrEqual(BOX.pad);
        expect(x).toBeLessThanOrEqual(BOX.width - BOX.pad);
        expect(y).toBeGreaterThanOrEqual(BOX.pad);
        expect(y).toBeLessThanOrEqual(BOX.height - BOX.pad);
      }
    }
  });

  it('starts with a move command', () => {
    expect(contourPath(1, BOX).startsWith('M ')).toBe(true);
  });

  it('uses straight segments, as Chao tone letters do', () => {
    expect(contourPath(3, BOX)).not.toMatch(/[QCS]/);
    expect(contourPath(3, BOX).match(/L /g)).toHaveLength(2);
  });
});

describe('toneLabel', () => {
  it('labels the numbered tones with their digit', () => {
    expect(toneLabel(1)).toBe('1');
    expect(toneLabel(4)).toBe('4');
  });

  it('labels neutral tone with 輕 rather than a digit', () => {
    // Calling it "tone 0" or "tone 5" would invent a number learners do not use.
    expect(toneLabel(0)).toBe('輕');
  });
});
