/**
 * Pitch contour glyphs.
 *
 * The answer buttons show the shape of the pitch rather than only a digit, drawn on the
 * five-level staff Yuen Ren Chao devised for exactly this purpose. Straight segments are
 * not a stylistic shortcut — Chao tone letters are straight-line notation.
 *
 * Training the sound-to-contour association is the point of the drill; the digit is kept
 * as a label because that is how the tones are named, not as the primary signal.
 */

import { NEUTRAL, type Tone } from '../core/tones';

/** Chao five-level pitch values: 5 is the top of the register, 1 the bottom. */
export const TONE_PITCHES: Record<Tone, readonly number[]> = {
  1: [5, 5], // 陰平 — high level
  2: [3, 5], // 陽平 — rising
  3: [2, 1, 4], // 上聲 — dipping
  4: [5, 1], // 去聲 — falling
  0: [3], // 輕聲 — unstressed, brief, mid
};

export interface ContourBox {
  width: number;
  height: number;
  pad: number;
}

/** Maps a pitch level onto an SVG y coordinate, where y grows downward. */
export function pitchToY(pitch: number, box: ContourBox): number {
  const usable = box.height - 2 * box.pad;
  return box.pad + ((5 - pitch) / 4) * usable;
}

/** How wide the neutral-tone mark is, as a share of the usable width. */
const NEUTRAL_WIDTH = 0.3;

export function contourPath(tone: Tone, box: ContourBox): string {
  const pitches = TONE_PITCHES[tone];
  const usable = box.width - 2 * box.pad;

  // Neutral tone gets a short centred mark. Drawn full width it would read as tone 1.
  if (tone === NEUTRAL) {
    const half = (usable * NEUTRAL_WIDTH) / 2;
    const mid = box.pad + usable / 2;
    const y = pitchToY(pitches[0]!, box);
    return `M ${mid - half} ${y} L ${mid + half} ${y}`;
  }

  const step = usable / (pitches.length - 1);
  return pitches
    .map((pitch, i) => {
      const x = box.pad + i * step;
      const y = pitchToY(pitch, box);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

/** The name a learner uses for a tone. Neutral is 輕聲, never "tone 0" or "tone 5". */
export function toneLabel(tone: Tone): string {
  return tone === NEUTRAL ? '輕' : String(tone);
}

/** Traditional tone names, shown in the reveal. */
export const TONE_NAMES: Record<Tone, string> = {
  1: '陰平',
  2: '陽平',
  3: '上聲',
  4: '去聲',
  0: '輕聲',
};

export const ANSWER_ORDER: readonly Tone[] = [1, 2, 3, 4, NEUTRAL];
