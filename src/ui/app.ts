/**
 * Screens and event wiring.
 *
 * Three screens — setup, drill, summary — rendered from a single state object. All the
 * logic worth testing lives in core/; this file is DOM assembly and keyboard handling.
 */

import { createBrowserPlayer, type Player, type TtsStatus } from '../audio/player';
import {
  ALL_WORDS,
  EXTENDED_WORDS,
  SINOSPLICE_WORDS,
  buildPool,
  countByToneKey,
  type DrillMode,
  type PoolOptions,
} from '../core/deck';
import { Session, type Grade, type Summary, type Tally } from '../core/session';
import { createStatsStore, resolveStore, type StatsStore } from '../core/stats';
import { NEUTRAL, toDiacritics, toneKey, type Tone } from '../core/tones';
import type { DeckSource, Word } from '../core/types';
import { ANSWER_ORDER, TONE_NAMES, contourPath, pitchToY, toneLabel } from './contour';
import { keyToAction } from './keys';

type Screen = 'setup' | 'drill' | 'summary';

interface Config {
  mode: DrillMode;
  decks: DeckSource[];
  includeNeutral: boolean;
  /** null means every pattern; otherwise the selected tone keys. */
  toneKeys: string[] | null;
}

interface State {
  screen: Screen;
  config: Config;
  session: Session | null;
  grade: Grade | null;
  pending: Tone[];
  lifetime: Map<string, Tally>;
  ttsStatus: TtsStatus;
  audioError: string | null;
}

const GLYPH_BOX = { width: 64, height: 40, pad: 6 };

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
};

const svg = (tag: string, attrs: Record<string, string> = {}): SVGElement => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** A contour drawn on the five-level staff — the shape of the pitch, not just a digit. */
function toneGlyph(tone: Tone): SVGElement {
  const box = GLYPH_BOX;
  const root = svg('svg', {
    class: 'tone__glyph',
    viewBox: `0 0 ${box.width} ${box.height}`,
    'aria-hidden': 'true',
  });

  const staff = svg('g', { class: 'staff' });
  for (const pitch of [1, 2, 3, 4, 5]) {
    const y = pitchToY(pitch, box);
    staff.append(
      svg('line', {
        x1: '2',
        x2: String(box.width - 2),
        y1: String(y),
        y2: String(y),
        ...(pitch === 3 ? { class: 'staff__mid' } : {}),
      }),
    );
  }
  root.append(staff);
  root.append(svg('path', { class: 'contour', d: contourPath(tone, box) }));
  return root;
}

function toneButton(tone: Tone, extraClass: string, disabled: boolean): HTMLButtonElement {
  const button = el(
    'button',
    {
      class: `tone ${extraClass}`.trim(),
      type: 'button',
      'data-tone': String(tone),
      'aria-label': tone === NEUTRAL ? 'Neutral tone (輕聲)' : `Tone ${tone} (${TONE_NAMES[tone]})`,
    },
    [],
  );
  button.append(toneGlyph(tone));
  button.append(el('span', { class: 'tone__name' }, [toneLabel(tone)]));
  if (disabled) button.disabled = true;
  return button;
}

// ---------------------------------------------------------------------------

export function mount(root: HTMLElement): void {
  const player: Player = createBrowserPlayer(import.meta.env.BASE_URL);
  const stats: StatsStore = createStatsStore(resolveStore());

  const state: State = {
    screen: 'setup',
    config: { mode: 'pair', decks: ['sinosplice'], includeNeutral: true, toneKeys: null },
    session: null,
    grade: null,
    pending: [],
    lifetime: stats.load(),
    ttsStatus: player.ttsStatus,
    audioError: null,
  };

  player.onTtsStatusChange((status) => {
    state.ttsStatus = status;
    render();
  });

  const pool = () => buildPool(ALL_WORDS, state.config as PoolOptions);

  const play = () => {
    const word = state.session?.current?.word;
    if (!word) return;

    const disc = root.querySelector<HTMLElement>('.listen__disc');
    disc?.classList.remove('is-playing');
    // Restart the ripple on every replay.
    void disc?.offsetWidth;
    disc?.classList.add('is-playing');

    player.play(word).then(
      () => {
        if (state.audioError !== null) {
          state.audioError = null;
          render();
        }
      },
      (err: unknown) => {
        state.audioError = err instanceof Error ? err.message : 'Audio could not play.';
        render();
      },
    );
  };

  const startSession = () => {
    const words = pool();
    if (words.length === 0) return;

    state.session = new Session(words, {
      priorStats: state.lifetime,
      // A fresh seed each session; reproducibility matters for tests, not for drilling.
      rng: makeSeededRng(),
    });
    state.grade = null;
    state.pending = [];
    state.screen = 'drill';
    state.session.next();
    render();
    play();
  };

  const advance = () => {
    if (!state.session) return;
    state.grade = null;
    state.pending = [];
    state.session.next();
    render();
    play();
  };

  const choose = (tone: Tone) => {
    const session = state.session;
    const question = session?.current;
    if (!session || !question || state.grade) return;

    state.pending = [...state.pending, tone];
    if (state.pending.length < question.slots) {
      render();
      return;
    }

    state.grade = session.answer(state.pending);
    state.lifetime = stats.merge(new Map([[toneKey(question.word.syllables), tallyOf(state.grade)]]));
    render();
  };

  const undo = () => {
    if (state.grade || state.pending.length === 0) return;
    state.pending = state.pending.slice(0, -1);
    render();
  };

  const endSession = () => {
    state.screen = 'summary';
    player.cancel();
    render();
  };

  // ------------------------------------------------------------- rendering

  function render(): void {
    root.replaceChildren(shell());
  }

  function shell(): HTMLElement {
    const body =
      state.screen === 'setup' ? setupScreen() : state.screen === 'drill' ? drillScreen() : summaryScreen();

    const mainClass = state.screen === 'drill' ? 'main main--drill' : 'main';
    return el('div', { class: 'shell' }, [masthead(), el('main', { class: mainClass }, [body]), colophon()]);
  }

  function masthead(): HTMLElement {
    const nodes: Array<Node | string> = [
      el('h1', { class: 'masthead__title' }, ['聲調練習']),
      el('span', { class: 'masthead__latin' }, ['tone practice']),
      el('span', { class: 'masthead__spacer' }, []),
    ];

    if (state.screen === 'drill') {
      const stop = el('button', { class: 'linklike', type: 'button' }, ['end session']);
      stop.addEventListener('click', endSession);
      nodes.push(stop);
    } else if (state.screen === 'summary') {
      const back = el('button', { class: 'linklike', type: 'button' }, ['new session']);
      back.addEventListener('click', () => {
        state.screen = 'setup';
        render();
      });
      nodes.push(back);
    }

    return el('header', { class: 'masthead' }, nodes);
  }

  // -------------------------------------------------------------- setup

  function setupScreen(): HTMLElement {
    const size = pool().length;

    const modes: Array<[DrillMode, string]> = [
      ['pair', 'tone pairs'],
      ['single', 'single tones'],
      ['mixed', 'both'],
    ];
    const decks: Array<[DeckSource, string]> = [
      ['sinosplice', `recorded · ${SINOSPLICE_WORDS.length}`],
      ['extended', `synthesized · ${EXTENDED_WORDS.length}`],
    ];

    const modeChips = modes.map(([value, label]) =>
      chip(label, state.config.mode === value, () => {
        state.config.mode = value;
        // A pattern filter from another mode cannot apply here.
        state.config.toneKeys = null;
        render();
      }),
    );

    const deckChips = decks.map(([value, label]) =>
      chip(label, state.config.decks.includes(value), () => {
        const on = state.config.decks.includes(value);
        const next = on ? state.config.decks.filter((d) => d !== value) : [...state.config.decks, value];
        // Leaving zero decks selected would make the drill unstartable.
        if (next.length > 0) state.config.decks = next;
        render();
      }),
    );

    const neutralChip = chip('輕聲 neutral tone', state.config.includeNeutral, () => {
      state.config.includeNeutral = !state.config.includeNeutral;
      render();
    });

    const start = el('button', { class: 'primary', type: 'button' }, ['begin']);
    start.disabled = size === 0;
    start.addEventListener('click', startSession);

    const panels: Array<Node | string> = [
      panel('what to drill', el('div', { class: 'choices' }, modeChips)),
      panel('audio source', el('div', { class: 'choices' }, deckChips)),
      panel('include', el('div', { class: 'choices' }, [neutralChip])),
    ];

    if (state.config.mode === 'pair') {
      panels.push(panel('tone pairs · all selected by default', pairMatrix()));
    }

    const actions: Array<Node | string> = [
      start,
      el('span', { class: 'note' }, [
        size === 1 ? '1 word in pool' : `${size} words in pool`,
      ]),
    ];
    const notes: Array<Node | string> = [];

    if (state.config.decks.includes('extended')) {
      if (state.ttsStatus.kind === 'unavailable') {
        notes.push(el('p', { class: 'note note--warn' }, [state.ttsStatus.reason]));
      } else if (state.ttsStatus.kind === 'ready' && !state.ttsStatus.exact) {
        notes.push(
          el('p', { class: 'note note--warn' }, [
            `No Taiwan voice found — synthesized words use ${state.ttsStatus.voice} (${state.ttsStatus.lang}). ` +
              'Its tones may not match a Taiwan speaker exactly.',
          ]),
        );
      }
    }

    return el('section', {}, [...panels, el('div', { class: 'actions' }, actions), ...notes]);
  }

  function panel(label: string, content: Node): HTMLElement {
    return el('div', { class: 'panel' }, [el('p', { class: 'eyebrow' }, [label]), content]);
  }

  function chip(label: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
    const button = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed) }, [label]);
    button.addEventListener('click', onClick);
    return button;
  }

  /** The tone-pair space is a 4x4 matrix; the filter is drawn as the thing it selects. */
  function pairMatrix(): HTMLElement {
    const available = countByToneKey(
      buildPool(ALL_WORDS, { ...state.config, toneKeys: null } as PoolOptions),
    );
    const columns: Tone[] = [1, 2, 3, 4, NEUTRAL];
    const selected = state.config.toneKeys;

    const cells: Array<Node | string> = [
      el('div', { class: 'matrix__corner' }, []),
      ...columns.map((c) => el('div', { class: 'matrix__head' }, [toneLabel(c)])),
    ];

    for (const first of [1, 2, 3, 4] as Tone[]) {
      cells.push(el('div', { class: 'matrix__head' }, [String(first)]));
      for (const second of columns) {
        const key = `${first}-${second}`;
        const count = available.get(key) ?? 0;
        const on = selected === null || selected.includes(key);
        const cell = el(
          'button',
          {
            class: 'matrix__cell',
            type: 'button',
            'aria-pressed': String(on && count > 0),
            'aria-label': `Tone pair ${first}-${toneLabel(second)}, ${count} ${count === 1 ? 'word' : 'words'}`,
          },
          [String(count)],
        );
        if (count === 0) cell.disabled = true;
        cell.addEventListener('click', () => toggleKey(key));
        cells.push(cell);
      }
    }

    const parts: Array<Node | string> = [
      el('div', { class: 'matrix' }, cells),
      el('p', { class: 'legend' }, [
        'words available per pair · rows are the first tone, columns the second',
      ]),
    ];

    // Only offer the reset once there is something to reset.
    if (selected !== null) {
      const all = el('button', { class: 'linklike', type: 'button' }, ['select all pairs']);
      all.addEventListener('click', () => {
        state.config.toneKeys = null;
        render();
      });
      parts.push(all);
    }

    return el('div', {}, parts);
  }

  function toggleKey(key: string): void {
    const everyKey = [...countByToneKey(buildPool(ALL_WORDS, { ...state.config, toneKeys: null } as PoolOptions)).keys()];
    const current = state.config.toneKeys ?? everyKey;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    // Deselecting the last pattern would empty the pool; keep at least one.
    state.config.toneKeys = next.length === 0 ? current : next;
    render();
  }

  // -------------------------------------------------------------- drill

  function drillScreen(): HTMLElement {
    const session = state.session;
    const question = session?.current;
    if (!session || !question) return el('p', { class: 'note' }, ['No words match those settings.']);

    const disc = el('button', { class: 'listen__disc', type: 'button', 'aria-label': 'Play audio again' }, ['聽']);
    disc.addEventListener('click', play);

    const listen = el('div', { class: 'listen' }, [
      disc,
      el('p', { class: 'note' }, [state.grade ? '' : 'play again']),
    ]);

    const body: Array<Node | string> = [listen];

    if (state.audioError) {
      body.push(el('p', { class: 'note note--warn' }, [state.audioError]));
    }

    body.push(state.grade ? reveal(question.word, state.grade) : slots(question.slots));
    body.push(statusBar(session.summary, question.word));

    return el('section', {}, body);
  }

  function slots(count: number): HTMLElement {
    const rows: Array<Node | string> = [];

    for (let i = 0; i < count; i++) {
      const active = i === state.pending.length;
      const chosen = state.pending[i];

      const buttons = ANSWER_ORDER.map((tone) => {
        const button = toneButton(tone, chosen === tone ? 'is-chosen' : '', false);
        button.addEventListener('click', () => choose(tone));
        return button;
      });

      rows.push(
        el('div', { class: `slot ${active ? 'is-active' : ''}`.trim() }, [
          el('div', { class: 'slot__label' }, [
            count === 1 ? 'the tone you heard' : `syllable ${i + 1}`,
          ]),
          el('div', { class: 'tones' }, buttons),
        ]),
      );
    }

    // Nothing else advertises that the drill is fully keyboard-driven.
    rows.push(
      el('p', { class: 'keyhint' }, [
        keyCap('1'),
        keyCap('2'),
        keyCap('3'),
        keyCap('4'),
        ' tones · ',
        keyCap('0'),
        ' neutral · ',
        keyCap('space'),
        ' replay · ',
        keyCap('⌫'),
        ' undo',
      ]),
    );

    return el('div', { class: 'slots' }, rows);
  }

  function reveal(word: Word, grade: Grade): HTMLElement {
    const chars = [...word.traditional];
    const right = grade.correct;

    const cells = chars.map((char, i) =>
      el('div', { class: `graph__cell ${grade.perSyllable[i] ? '' : 'graph__cell--missed'}`.trim() }, [
        el('span', { class: 'graph__char' }, [char]),
      ]),
    );

    // The correct contours, always in jade. Colouring the right answer red on a miss
    // would read as "this tone was wrong" when it is in fact the answer.
    const answer = answerRow(
      right ? 'the tones' : 'the tones were',
      word.syllables.map((s) => s.tone),
      () => 'is-right',
    );

    const parts: Array<Node | string> = [
      el('p', { class: `verdict ${right ? 'verdict--right' : 'verdict--wrong'}` }, [
        right ? '對 correct' : chars.length > 1 && grade.perSyllable.some(Boolean) ? '半對 half right' : '錯 not quite',
      ]),
      el('div', { class: 'graph' }, cells),
      el('p', { class: 'pinyin' }, [toDiacritics(word.syllables)]),
      answer,
      el('p', { class: 'tonenames' }, [word.syllables.map((s) => TONE_NAMES[s.tone]).join(' · ')]),
    ];

    // Show the shapes actually chosen alongside, so the two contours can be compared —
    // seeing the wrong shape next to the right one is the teaching moment.
    if (!right) {
      parts.push(
        answerRow('you chose', grade.given, (i) => (grade.perSyllable[i] ? 'is-right' : 'is-wrong')),
      );
    }

    parts.push(el('p', { class: 'gloss' }, [word.gloss]));

    if (word.alsoWritten?.length) {
      parts.push(
        el('p', { class: 'variants' }, [
          'same sound: ',
          ...word.alsoWritten.flatMap((v, i) => [i > 0 ? ' ' : '', el('b', {}, [v])]),
        ]),
      );
    }

    const next = el('button', { class: 'primary', type: 'button' }, ['next · enter']);
    next.addEventListener('click', advance);
    parts.push(el('div', { class: 'actions' }, [next]));

    return el('div', { class: 'reveal' }, parts);
  }

  function keyCap(label: string): HTMLElement {
    return el('kbd', { class: 'keycap' }, [label]);
  }

  /** A labelled row of read-only contour glyphs, used for both halves of the reveal. */
  function answerRow(
    label: string,
    tones: readonly (Tone | undefined)[],
    variant: (index: number) => string,
  ): HTMLElement {
    const buttons = tones.map((tone, i) =>
      tone === undefined
        ? el('div', { class: 'tone tone--blank' }, [el('span', { class: 'tone__name' }, ['—'])])
        : toneButton(tone, variant(i), true),
    );

    return el('div', { class: 'answerrow' }, [
      el('div', { class: 'slot__label' }, [label]),
      el('div', { class: 'tones tones--answer' }, buttons),
    ]);
  }

  function statusBar(summary: Summary, word: Word): HTMLElement {
    const source = word.audio.kind === 'file' ? 'recorded' : 'synthesized';
    return el('div', { class: 'status' }, [
      el('span', {}, [
        'asked ',
        el('b', {}, [String(summary.asked)]),
        summary.asked > 0 ? ` · ${Math.round(summary.accuracy * 100)}%` : '',
      ]),
      el('span', {}, ['streak ', el('b', {}, [String(summary.streak)])]),
      el('span', { class: 'status__spacer' }, []),
      el('span', {}, [source]),
    ]);
  }

  // ------------------------------------------------------------ summary

  function summaryScreen(): HTMLElement {
    const summary = state.session?.summary;

    const tally = el('div', { class: 'tally' }, [
      tallyItem(String(summary?.asked ?? 0), 'asked'),
      tallyItem(summary && summary.asked > 0 ? `${Math.round(summary.accuracy * 100)}%` : '—', 'accuracy'),
      tallyItem(String(summary?.bestStreak ?? 0), 'best streak'),
    ]);

    const reset = el('button', { class: 'linklike', type: 'button' }, ['clear all history']);
    reset.addEventListener('click', () => {
      stats.reset();
      state.lifetime = new Map();
      render();
    });

    const again = el('button', { class: 'primary', type: 'button' }, ['drill again']);
    again.addEventListener('click', startSession);

    return el('section', {}, [
      el('p', { class: 'eyebrow' }, ['this session']),
      tally,
      panel('accuracy by tone pair · all time', statMatrix()),
      el('div', { class: 'actions' }, [again, reset]),
    ]);
  }

  function tallyItem(value: string, label: string): HTMLElement {
    return el('div', { class: 'tally__item' }, [
      el('span', { class: 'tally__value' }, [value]),
      el('span', { class: 'tally__label' }, [label]),
    ]);
  }

  /** The same 4x4 matrix as the filter, now shaded by accuracy — a map of the ear. */
  function statMatrix(): HTMLElement {
    const columns: Tone[] = [1, 2, 3, 4, NEUTRAL];
    const cells: Array<Node | string> = [
      el('div', { class: 'matrix__corner' }, []),
      ...columns.map((c) => el('div', { class: 'matrix__head' }, [toneLabel(c)])),
    ];

    for (const first of [1, 2, 3, 4] as Tone[]) {
      cells.push(el('div', { class: 'matrix__head' }, [String(first)]));
      for (const second of columns) {
        const tally = state.lifetime.get(`${first}-${second}`);
        const cell = el('div', { class: 'matrix__cell matrix__cell--stat' }, [
          tally ? `${Math.round((tally.correct / tally.asked) * 100)}` : '·',
        ]);
        if (tally) {
          const rate = tally.correct / tally.asked;
          // Shade toward jade as accuracy rises, cinnabar as it falls.
          const hue = rate >= 0.5 ? 'var(--jade)' : 'var(--cinnabar)';
          const weight = Math.round((rate >= 0.5 ? (rate - 0.5) * 2 : (0.5 - rate) * 2) * 45) + 5;
          cell.style.background = `color-mix(in srgb, ${hue} ${weight}%, var(--paper-raised))`;
          cell.title = `${tally.correct}/${tally.asked} correct`;
        }
        cells.push(cell);
      }
    }

    return el('div', {}, [
      el('div', { class: 'matrix' }, cells),
      el('p', { class: 'legend' }, ['percent correct · rows are the first tone, columns the second']),
    ]);
  }

  function colophon(): HTMLElement {
    const link = el('a', { href: 'https://www.sinosplice.com/learn-chinese/tone-pair-drills' }, [
      'Sinosplice Tone Pair Drills',
    ]);
    return el('footer', { class: 'colophon' }, [
      'Recordings from ',
      link,
      ' by John Pasden, used under CC BY-NC-SA 2.5. Glosses from CC-CEDICT (CC BY-SA 4.0).',
    ]);
  }

  // ------------------------------------------------------------ keyboard

  document.addEventListener('keydown', (event) => {
    if (state.screen !== 'drill') return;

    const action = keyToAction(event);
    if (!action) return;

    // preventDefault on keydown also stops space/enter from re-activating whichever
    // button the learner last clicked, which would otherwise double-fire.
    switch (action.kind) {
      case 'replay':
        event.preventDefault();
        play();
        break;
      case 'next':
        event.preventDefault();
        if (state.grade) advance();
        break;
      case 'undo':
        event.preventDefault();
        undo();
        break;
      case 'tone':
        // Ignored during the reveal. Advancing on a tone key would consume the press,
        // so the learner would believe they had answered the next word when they had not.
        if (!state.grade) {
          event.preventDefault();
          choose(action.tone);
        }
        break;
    }
  });

  render();
  // Priming synthesis needs a real gesture on iOS, so hook the first one.
  document.addEventListener('pointerdown', () => player.unlock(), { once: true });
}

function tallyOf(grade: Grade): Tally {
  return { asked: 1, correct: grade.correct ? 1 : 0 };
}

/**
 * A per-load seed. Sessions do not need to be reproducible in the browser — that
 * property exists for the tests, which inject their own RNG.
 */
function makeSeededRng(): () => number {
  return Math.random;
}
