import type { Syllable } from './tones';

export type DeckSource = 'sinosplice' | 'extended';

/** Where a word's audio comes from: a bundled clip, or runtime speech synthesis. */
export type AudioRef =
  | { kind: 'file'; src: string }
  | { kind: 'tts'; text: string };

export interface Word {
  /** Stable across rebuilds, so saved stats survive: `sino:hao3chi1`, `ext:合適`. */
  id: string;
  traditional: string;
  /**
   * For Sinosplice words these come from the MP3 basename, not the dictionary,
   * so the displayed pinyin always matches the recording you just heard.
   */
  syllables: Syllable[];
  gloss: string;
  audio: AudioRef;
  source: DeckSource;
  /**
   * Homophone spellings that share this exact recording (他 → 她, 它). Shown in the
   * reveal; they are not separate drill items because they sound identical.
   */
  alsoWritten?: string[];
  category?: string;
}

export interface Deck {
  source: DeckSource;
  attribution: string;
  generatedFrom: string;
  words: Word[];
}
