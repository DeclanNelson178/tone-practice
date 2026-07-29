/**
 * Audio playback for both decks.
 *
 * The Sinosplice deck plays bundled MP3s; the extended deck is spoken by the browser.
 * Both sit behind `Player` so the drill never has to care which it is, and every browser
 * dependency is injected so the tests use fakes rather than real audio.
 *
 * Two browser realities shape this file:
 *
 *   1. `speechSynthesis.getVoices()` returns an empty array on first call in Chrome and
 *      populates later, firing `voiceschanged`. An empty list therefore means "not yet",
 *      not "no voices" — hence the `pending` status.
 *   2. iOS refuses to start audio outside a user gesture. Nothing here pre-warms audio;
 *      `play()` must be called from inside a click/keydown handler, and `unlock()` exists
 *      for the UI to prime synthesis on the first gesture.
 */

import type { Word } from '../core/types';

// --- injected browser shapes -----------------------------------------------

export interface VoiceLike {
  name: string;
  lang: string;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  voice: VoiceLike | null;
  rate: number;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface SpeechLike {
  getVoices(): VoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  addEventListener(type: 'voiceschanged', listener: () => void): void;
  removeEventListener?(type: 'voiceschanged', listener: () => void): void;
}

export interface AudioClip {
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
}

// --- voice selection -------------------------------------------------------

/** `zh-TW`, `zh_TW`, `zh-Hant-TW` all mean the same thing to us. */
const normalizeLang = (lang: string) => lang.toLowerCase().replace(/_/g, '-');

const isTaiwan = (v: VoiceLike) => /^zh(-hant)?-tw\b/.test(normalizeLang(v.lang));
const isHongKong = (v: VoiceLike) => /^zh(-hant)?-hk\b/.test(normalizeLang(v.lang));
const isChinese = (v: VoiceLike) => normalizeLang(v.lang).startsWith('zh');

export interface VoiceChoice {
  voice: VoiceLike;
  /** True only for a Taiwan voice — the right accent for traditional characters. */
  exact: boolean;
}

/**
 * Picks the best available Chinese voice: Taiwan, then Hong Kong, then any Chinese.
 *
 * Mainland voices still read traditional characters, so they are a usable fallback, but
 * they are marked inexact because their tone realization differs enough to matter when the
 * whole exercise is hearing tones.
 */
export function pickChineseVoice(voices: readonly VoiceLike[]): VoiceChoice | null {
  const tw = voices.find(isTaiwan);
  if (tw) return { voice: tw, exact: true };

  const hk = voices.find(isHongKong);
  if (hk) return { voice: hk, exact: false };

  const any = voices.find(isChinese);
  if (any) return { voice: any, exact: false };

  return null;
}

// --- text to speech --------------------------------------------------------

export type TtsStatus =
  | { kind: 'pending' }
  | { kind: 'ready'; voice: string; lang: string; exact: boolean }
  | { kind: 'unavailable'; reason: string };

const NO_CHINESE_VOICE =
  'No Chinese speech voice is installed, so the synthesized deck cannot play. ' +
  'Use the Sinosplice deck, or add a Chinese voice in your system settings.';

/** Slightly under normal speed: tone contours are easier to hear without sounding odd. */
const SPEECH_RATE = 0.85;

export class TtsEngine {
  private state: TtsStatus = { kind: 'pending' };
  private readonly subscribers: Array<(status: TtsStatus) => void> = [];

  constructor(
    private readonly speech: SpeechLike,
    private readonly makeUtterance: (text: string) => UtteranceLike,
  ) {
    this.refresh();
    // Chrome fills the voice list after construction; re-resolve when it does.
    this.speech.addEventListener('voiceschanged', () => {
      const before = this.state.kind;
      const changed = this.refresh();
      if (changed || before !== this.state.kind) {
        for (const cb of [...this.subscribers]) cb(this.state);
      }
    });
  }

  get status(): TtsStatus {
    return this.state;
  }

  onStatusChange(listener: (status: TtsStatus) => void): void {
    this.subscribers.push(listener);
  }

  /** Recomputes status from the current voice list. Returns true if it changed. */
  private refresh(): boolean {
    const voices = this.speech.getVoices();
    const next: TtsStatus =
      voices.length === 0
        ? // Empty means "not populated yet", not "none available".
          { kind: 'pending' }
        : (() => {
            const choice = pickChineseVoice(voices);
            return choice
              ? {
                  kind: 'ready' as const,
                  voice: choice.voice.name,
                  lang: choice.voice.lang,
                  exact: choice.exact,
                }
              : { kind: 'unavailable' as const, reason: NO_CHINESE_VOICE };
          })();

    const changed = JSON.stringify(next) !== JSON.stringify(this.state);
    this.state = next;
    return changed;
  }

  private currentVoice(): VoiceChoice | null {
    // Resolve again at speak time: the learner may press play before voices arrived.
    this.refresh();
    return pickChineseVoice(this.speech.getVoices());
  }

  async speak(text: string): Promise<void> {
    const choice = this.currentVoice();
    if (!choice) throw new Error(NO_CHINESE_VOICE);

    // Never let two utterances overlap; the answer would be ambiguous.
    this.cancel();

    const utterance = this.makeUtterance(text);
    utterance.lang = choice.voice.lang;
    utterance.voice = choice.voice;
    utterance.rate = SPEECH_RATE;

    await new Promise<void>((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        const detail =
          typeof event === 'object' && event !== null && 'error' in event
            ? String((event as { error: unknown }).error)
            : 'speech synthesis failed';
        reject(new Error(detail));
      };
      this.speech.speak(utterance);
    });
  }

  cancel(): void {
    this.speech.cancel();
  }

  /**
   * Primes synthesis inside a user gesture. iOS ignores the first `speak()` unless it
   * happens in a gesture, so the UI calls this on the learner's first interaction.
   */
  unlock(): void {
    try {
      this.speech.cancel();
    } catch {
      // Priming is best-effort.
    }
  }
}

// --- bundled clips ---------------------------------------------------------

export class ClipPlayer {
  private readonly cache = new Map<string, AudioClip>();
  private active: AudioClip | null = null;

  constructor(
    private readonly makeClip: (src: string) => AudioClip,
    private readonly baseUrl = '',
  ) {}

  async play(src: string): Promise<void> {
    const url = `${this.baseUrl}${src}`;
    let clip = this.cache.get(url);
    if (!clip) {
      clip = this.makeClip(url);
      this.cache.set(url, clip);
    }

    this.cancel();
    // Replay must replay, not resume where the last play stopped.
    clip.currentTime = 0;
    this.active = clip;
    await clip.play();
  }

  cancel(): void {
    this.active?.pause();
  }
}

// --- unified player -------------------------------------------------------

export class Player {
  constructor(
    private readonly clips: ClipPlayer,
    private readonly tts: TtsEngine,
  ) {}

  get ttsStatus(): TtsStatus {
    return this.tts.status;
  }

  onTtsStatusChange(listener: (status: TtsStatus) => void): void {
    this.tts.onStatusChange(listener);
  }

  /** False when a synthesized word cannot be spoken on this device. */
  canPlay(word: Word): boolean {
    return word.audio.kind === 'file' || this.tts.status.kind !== 'unavailable';
  }

  async play(word: Word): Promise<void> {
    if (word.audio.kind === 'file') {
      this.tts.cancel();
      await this.clips.play(word.audio.src);
    } else {
      this.clips.cancel();
      await this.tts.speak(word.audio.text);
    }
  }

  cancel(): void {
    this.clips.cancel();
    this.tts.cancel();
  }

  unlock(): void {
    this.tts.unlock();
  }
}

/** Wires the real browser APIs. `baseUrl` should be Vite's `import.meta.env.BASE_URL`. */
export function createBrowserPlayer(baseUrl: string): Player {
  const clips = new ClipPlayer((src) => new Audio(src), baseUrl);
  const tts = new TtsEngine(
    window.speechSynthesis as unknown as SpeechLike,
    (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
  );
  return new Player(clips, tts);
}
