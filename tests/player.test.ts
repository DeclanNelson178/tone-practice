import { describe, expect, it, vi } from 'vitest';

import {
  ClipPlayer,
  Player,
  TtsEngine,
  pickChineseVoice,
  type AudioClip,
  type SpeechLike,
  type UtteranceLike,
  type VoiceLike,
} from '../src/audio/player';
import type { Word } from '../src/core/types';

const voice = (name: string, lang: string): VoiceLike => ({ name, lang });

const TW = voice('Meijia', 'zh-TW');
const HANT_TW = voice('Hant', 'zh-Hant-TW');
const UNDERSCORE_TW = voice('Legacy', 'zh_TW');
const HK = voice('Sinji', 'zh-HK');
const CN = voice('Tingting', 'zh-CN');
const EN = voice('Samantha', 'en-US');

function makeUtterance(text: string): UtteranceLike {
  return { text, lang: '', voice: null, rate: 1, onend: null, onerror: null };
}

/** Fake SpeechSynthesis whose voice list can change, as Chrome's does. */
class FakeSpeech implements SpeechLike {
  spoken: UtteranceLike[] = [];
  cancelled = 0;
  private listeners: Array<() => void> = [];
  /** When set, speak() reports this error instead of completing. */
  failWith: string | null = null;

  constructor(private voices: VoiceLike[]) {}

  getVoices(): VoiceLike[] {
    return this.voices;
  }

  speak(u: UtteranceLike): void {
    this.spoken.push(u);
    queueMicrotask(() => {
      if (this.failWith) u.onerror?.({ error: this.failWith });
      else u.onend?.();
    });
  }

  cancel(): void {
    this.cancelled++;
  }

  addEventListener(_type: 'voiceschanged', cb: () => void): void {
    this.listeners.push(cb);
  }

  removeEventListener(_type: 'voiceschanged', cb: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  /** Simulate the browser populating voices after construction. */
  arrive(voices: VoiceLike[]): void {
    this.voices = voices;
    for (const cb of [...this.listeners]) cb();
  }
}

class FakeClip implements AudioClip {
  currentTime = 0;
  plays = 0;
  pauses = 0;
  rejectWith: string | null = null;

  async play(): Promise<void> {
    this.plays++;
    if (this.rejectWith) throw new Error(this.rejectWith);
  }

  pause(): void {
    this.pauses++;
  }
}

const fileWord = (src: string): Word => ({
  id: 'sino:x',
  traditional: '好吃',
  syllables: [{ pinyin: 'hao', tone: 3 }],
  gloss: 'g',
  audio: { kind: 'file', src },
  source: 'sinosplice',
});

const ttsWord = (text: string): Word => ({
  id: 'ext:x',
  traditional: text,
  syllables: [{ pinyin: 'x', tone: 1 }],
  gloss: 'g',
  audio: { kind: 'tts', text },
  source: 'extended',
});

describe('pickChineseVoice', () => {
  it('prefers an exact zh-TW voice', () => {
    // Traditional characters and Taiwan readings — zh-TW is the target.
    expect(pickChineseVoice([EN, CN, TW])).toEqual({ voice: TW, exact: true });
  });

  it('recognizes zh-Hant-TW', () => {
    expect(pickChineseVoice([CN, HANT_TW])).toEqual({ voice: HANT_TW, exact: true });
  });

  it('recognizes an underscore locale', () => {
    // Some engines report zh_TW rather than zh-TW.
    expect(pickChineseVoice([CN, UNDERSCORE_TW])).toEqual({ voice: UNDERSCORE_TW, exact: true });
  });

  it('is case-insensitive about the locale tag', () => {
    expect(pickChineseVoice([voice('X', 'ZH-tw')])).toEqual({ voice: voice('X', 'ZH-tw'), exact: true });
  });

  it('prefers zh-HK over zh-CN when no zh-TW exists', () => {
    // Hong Kong voices also read traditional characters.
    expect(pickChineseVoice([CN, HK])).toEqual({ voice: HK, exact: false });
  });

  it('falls back to any Chinese voice', () => {
    expect(pickChineseVoice([EN, CN])).toEqual({ voice: CN, exact: false });
  });

  it('returns null when no Chinese voice exists', () => {
    expect(pickChineseVoice([EN])).toBeNull();
    expect(pickChineseVoice([])).toBeNull();
  });
});

describe('TtsEngine status', () => {
  it('is ready with an exact voice', () => {
    const engine = new TtsEngine(new FakeSpeech([TW]), makeUtterance);
    expect(engine.status).toEqual({ kind: 'ready', voice: 'Meijia', lang: 'zh-TW', exact: true });
  });

  it('flags an inexact fallback so the UI can say so', () => {
    // Tone rendering differs between Mainland and Taiwan voices; the learner should
    // know a suspicious answer may be the voice rather than their ear.
    const engine = new TtsEngine(new FakeSpeech([CN]), makeUtterance);
    expect(engine.status).toMatchObject({ kind: 'ready', exact: false, lang: 'zh-CN' });
  });

  it('reports unavailable with a reason when no Chinese voice exists', () => {
    const engine = new TtsEngine(new FakeSpeech([EN]), makeUtterance);
    expect(engine.status.kind).toBe('unavailable');
    expect(engine.status.kind === 'unavailable' && engine.status.reason).toMatch(/chinese/i);
  });

  it('starts pending when the voice list is still empty', () => {
    // Chrome populates getVoices() asynchronously; an empty list is not "no voices".
    const engine = new TtsEngine(new FakeSpeech([]), makeUtterance);
    expect(engine.status.kind).toBe('pending');
  });

  it('becomes ready when voices arrive later', () => {
    const speech = new FakeSpeech([]);
    const engine = new TtsEngine(speech, makeUtterance);
    expect(engine.status.kind).toBe('pending');

    speech.arrive([TW]);
    expect(engine.status).toMatchObject({ kind: 'ready', exact: true });
  });

  it('notifies subscribers when the status changes', () => {
    const speech = new FakeSpeech([]);
    const engine = new TtsEngine(speech, makeUtterance);
    const seen = vi.fn();
    engine.onStatusChange(seen);

    speech.arrive([TW]);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready' }));
  });

  it('settles on unavailable if voices arrive with no Chinese entry', () => {
    const speech = new FakeSpeech([]);
    const engine = new TtsEngine(speech, makeUtterance);
    speech.arrive([EN]);
    expect(engine.status.kind).toBe('unavailable');
  });
});

describe('TtsEngine speak', () => {
  it('speaks with the chosen voice and locale', async () => {
    const speech = new FakeSpeech([TW]);
    const engine = new TtsEngine(speech, makeUtterance);

    await engine.speak('好吃');

    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0]).toMatchObject({ text: '好吃', lang: 'zh-TW', voice: TW });
  });

  it('slows the rate slightly so tones are audible', async () => {
    const speech = new FakeSpeech([TW]);
    await new TtsEngine(speech, makeUtterance).speak('好吃');
    expect(speech.spoken[0]!.rate).toBeLessThan(1);
  });

  it('cancels anything in flight before speaking', async () => {
    // Overlapping utterances would make the answer ambiguous.
    const speech = new FakeSpeech([TW]);
    const engine = new TtsEngine(speech, makeUtterance);
    await engine.speak('一');
    await engine.speak('二');
    expect(speech.cancelled).toBeGreaterThanOrEqual(2);
  });

  it('rejects when synthesis reports an error', async () => {
    const speech = new FakeSpeech([TW]);
    speech.failWith = 'synthesis-failed';
    await expect(new TtsEngine(speech, makeUtterance).speak('好')).rejects.toThrow(/synthesis-failed/);
  });

  it('rejects with a clear message when no Chinese voice exists', async () => {
    const engine = new TtsEngine(new FakeSpeech([EN]), makeUtterance);
    await expect(engine.speak('好')).rejects.toThrow(/chinese/i);
  });

  it('retries voice resolution at speak time', async () => {
    // The learner may press play before the voice list has populated.
    const speech = new FakeSpeech([]);
    const engine = new TtsEngine(speech, makeUtterance);
    speech.arrive([TW]);
    await expect(engine.speak('好')).resolves.toBeUndefined();
  });
});

describe('ClipPlayer', () => {
  it('resolves the src against the base url', async () => {
    const made: string[] = [];
    const player = new ClipPlayer((src) => {
      made.push(src);
      return new FakeClip();
    }, '/tone-practice/');

    await player.play('audio/sinosplice/hao3.mp3');
    expect(made).toEqual(['/tone-practice/audio/sinosplice/hao3.mp3']);
  });

  it('reuses the element for a repeated clip', async () => {
    let built = 0;
    const clip = new FakeClip();
    const player = new ClipPlayer(() => {
      built++;
      return clip;
    });

    await player.play('a.mp3');
    await player.play('a.mp3');
    expect(built).toBe(1);
    expect(clip.plays).toBe(2);
  });

  it('restarts from the beginning on replay', async () => {
    // Replay must replay, not resume from where a previous play ended.
    const clip = new FakeClip();
    const player = new ClipPlayer(() => clip);

    await player.play('a.mp3');
    clip.currentTime = 1.5;
    await player.play('a.mp3');

    expect(clip.currentTime).toBe(0);
  });

  it('pauses the active clip on cancel', async () => {
    const clip = new FakeClip();
    const player = new ClipPlayer(() => clip);
    await player.play('a.mp3');
    player.cancel();
    expect(clip.pauses).toBe(1);
  });

  it('propagates a blocked autoplay rejection', async () => {
    // iOS rejects play() outside a user gesture; the UI needs to hear about it.
    const clip = new FakeClip();
    clip.rejectWith = 'NotAllowedError';
    const player = new ClipPlayer(() => clip);
    await expect(player.play('a.mp3')).rejects.toThrow(/NotAllowedError/);
  });
});

describe('Player', () => {
  const build = (voices: VoiceLike[] = [TW]) => {
    const speech = new FakeSpeech(voices);
    const clip = new FakeClip();
    const clips = new ClipPlayer(() => clip);
    const player = new Player(clips, new TtsEngine(speech, makeUtterance));
    return { player, speech, clip };
  };

  it('plays a bundled clip for a file word', async () => {
    const { player, clip, speech } = build();
    await player.play(fileWord('audio/sinosplice/hao3.mp3'));
    expect(clip.plays).toBe(1);
    expect(speech.spoken).toHaveLength(0);
  });

  it('synthesizes a tts word', async () => {
    const { player, clip, speech } = build();
    await player.play(ttsWord('學習'));
    expect(speech.spoken.map((u) => u.text)).toEqual(['學習']);
    expect(clip.plays).toBe(0);
  });

  it('stops the other source when switching kinds', async () => {
    // A pending clip must not talk over a new utterance.
    const { player, clip, speech } = build();
    await player.play(fileWord('a.mp3'));
    await player.play(ttsWord('學習'));
    expect(clip.pauses).toBeGreaterThanOrEqual(1);
    expect(speech.spoken).toHaveLength(1);
  });

  it('reports whether a word is playable', () => {
    const { player } = build([EN]);
    expect(player.canPlay(fileWord('a.mp3'))).toBe(true);
    // No Chinese voice: synthesized words cannot be drilled.
    expect(player.canPlay(ttsWord('學習'))).toBe(false);
  });
});
