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
| **Sinosplice** (default) | 85 bundled human recordings | 85 | Real voice, authentic vocabulary, works offline |
| **Extended** | Browser `zh-TW` speech synthesis | 990 | The Sinosplice set has only 1–3 words per tone pair, so it becomes memorizable; this deck keeps at least 13 words behind every pair |

Both decks cover all 16 tone pairs, plus a neutral second syllable after each of the four
tones. Neutral tone (輕聲) is a fifth answer option, since a good deal of real two-syllable
vocabulary ends in it (聰明, 漂亮, 他們). It can be switched off.

## The interface

Answer buttons are pitch contours on the five-level staff Yuen Ren Chao devised for tone
notation, with the digit kept as a label — the drill is training the link between a sound
and a shape, so the shape leads. On a miss the reveal shows the correct contours beside the
ones you picked, so you can see the flat line you chose next to the dip you missed.

Tone pairs form a 4×4 space, so that matrix is both the pair filter on the setup screen and
the accuracy heatmap on the summary. Sessions over-sample the pairs you get wrong.

Keyboard: `1`–`4` and `0` for neutral, `space` to replay, `enter` for the next word,
`backspace` to undo a pick. During the reveal a tone key also moves to the next word,
so you never have to switch hands mid-drill — the press only advances, since the next
word's audio has not played yet.

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
