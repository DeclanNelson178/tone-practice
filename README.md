# tone-practice

Mandarin tone and tone-pair listening drills, in **traditional characters**.

You hear a word and pick the tones: one button for a single syllable, two rows for a tone
pair. Modelled on [Sinosplice's Tone Pair Drills](https://www.sinosplice.com/learn-chinese/tone-pair-drills/4)
(the traditional-character chart), whose recordings it uses.

**Live:** https://declannelson178.github.io/tone-practice/

## Why tone *pairs*

Isolated tones are the easy case. What trips people up is producing and hearing two tones in
succession, where the transition — and sandhi — changes what you actually hear. So the drill
grades each syllable of a pair independently and tracks accuracy per tone pair, which
surfaces the specific combinations you can't hear yet (3-3 and 2-3 are the usual suspects).

## Two decks

| Deck | Audio | Words | Why |
| --- | --- | --- | --- |
| **Sinosplice** (default) | 89 bundled human recordings | 92 | Real voice, authentic vocabulary, works offline |
| **Extended** | Browser `zh-TW` speech synthesis | ~300+ | The Sinosplice set has only 1–3 words per tone pair, so it becomes memorizable; this deck keeps the variety up |

Neutral tone (輕聲) is a fifth answer option, since a chunk of real two-syllable vocabulary
ends in it (聰明, 漂亮, 他們). It can be switched off.

## Running it

Requires Node 20+. On this machine bare `node` is an EOL v16, so use Homebrew's:

```sh
export PATH="/opt/homebrew/bin:$PATH"
npm install
npm run dev       # dev server
npm test          # unit tests
npm run build     # typecheck + production build
```

## Regenerating the decks

The deck JSON and the MP3s are committed, so the app needs no network at build time. To
rebuild them from source:

```sh
npm run build:decks
```

This downloads the official Sinosplice package, parses the traditional chart, and
cross-references CC-CEDICT for glosses and diacritic pinyin. It reads CC-CEDICT from
`../anki/data/cedict.u8` if present and downloads it otherwise.

The builder corrects a few known upstream quirks — sandhi footnote cells that would grade as
wrong answers, one simplified character on the traditional page (`合适` → `合適`), and
characters that share a recording (他/她/它). See `scripts/build-decks.ts`.

## Licensing

Code is MIT. The bundled audio is **CC BY-NC-SA 2.5** and the dictionary data **CC BY-SA
4.0** — so this project is non-commercial and must stay that way while it ships that audio.
See [ATTRIBUTION.md](ATTRIBUTION.md).

Tone Pair Drills © John Pasden / [Sinosplice](https://www.sinosplice.com/learn-chinese/tone-pair-drills).
