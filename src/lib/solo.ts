import { isChordToken, transposeChord } from './chords';

/** Durées supportées (pas de pointées en v1). */
export type NoteDur = 'w' | 'h' | 'q' | '8' | '16';
export type TimeSig = '4/4' | '3/4' | '2/4';

export const DUR_BEATS: Record<NoteDur, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
export const TIME_CAPACITY: Record<TimeSig, number> = { '4/4': 4, '3/4': 3, '2/4': 2 };
export const DUR_LABELS: Record<NoteDur, string> = {
  w: 'Ronde',
  h: 'Blanche',
  q: 'Noire',
  '8': 'Croche',
  '16': 'Double-croche',
};
export const KEY_SIGS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb'] as const;
export type KeySig = (typeof KEY_SIGS)[number];

/** pitch "C5", "F#4", "Bb3" ou "R" pour un silence. chord : accord optionnel au-dessus. */
export interface SoloNote {
  id: string;
  pitch: string;
  dur: NoteDur;
  dotted?: boolean;
  chord?: string;
}

export interface SoloMeasure {
  id: string;
  notes: SoloNote[];
}

export interface Solo {
  id: string;
  title: string;
  keySig: string;
  timeSig: TimeSig;
  measuresPerLine: number;
  measures: SoloMeasure[];
}

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newMeasure(): SoloMeasure {
  return { id: uid(), notes: [] };
}

export function newSolo(title = 'Solo'): Solo {
  return {
    id: uid(),
    title,
    keySig: 'C',
    timeSig: '4/4',
    measuresPerLine: 4,
    measures: [newMeasure(), newMeasure(), newMeasure(), newMeasure()],
  };
}

export function noteBeats(n: Pick<SoloNote, 'dur' | 'dotted'>): number {
  return DUR_BEATS[n.dur] * (n.dotted ? 1.5 : 1);
}

export function measureBeats(m: SoloMeasure): number {
  return m.notes.reduce((s, n) => s + noteBeats(n), 0);
}

/** Peut-on ajouter / passer à `dur` (+ point éventuel) dans cette mesure (contrôle strict) ? */
export function canFit(
  measure: SoloMeasure,
  timeSig: TimeSig,
  dur: NoteDur,
  ignoreNoteId?: string,
  dotted = false,
): boolean {
  const used = measure.notes.reduce((s, n) => (n.id === ignoreNoteId ? s : s + noteBeats(n)), 0);
  return used + DUR_BEATS[dur] * (dotted ? 1.5 : 1) <= TIME_CAPACITY[timeSig] + 1e-9;
}

// ---------- Hauteurs ----------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** Altérations par défaut induites par l'armature, par lettre. */
const KEY_ACCIDENTALS: Record<string, Record<string, string>> = {
  C: {},
  G: { F: '#' },
  D: { F: '#', C: '#' },
  A: { F: '#', C: '#', G: '#' },
  E: { F: '#', C: '#', G: '#', D: '#' },
  F: { B: 'b' },
  Bb: { B: 'b', E: 'b' },
  Eb: { B: 'b', E: 'b', A: 'b' },
};

export function defaultAccidental(letter: string, keySig: string): string {
  return KEY_ACCIDENTALS[keySig]?.[letter] ?? '';
}

/** Degrés diatoniques C4..B5 (index 0..13). Portée : E4 (idx 2, 1re ligne) .. F5 (idx 10, 5e ligne). */
export interface Step {
  letter: string;
  octave: number;
}

export const STEPS: Step[] = (() => {
  // C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 B5
  const out: Step[] = [];
  for (const oct of [4, 5]) {
    for (const l of LETTERS) out.push({ letter: l, octave: oct });
  }
  return out;
})();

export function stepIndexOf(pitch: string): number {
  const m = pitch.match(/^([A-G])([#b]?)(-?\d)$/);
  if (!m) return -1;
  const idx = STEPS.findIndex((s) => s.letter === m[1] && s.octave === Number(m[3]));
  return idx;
}

export function pitchAtStep(idx: number, keySig: string, keepAcc?: string, keepLetter?: string): string {
  const clamped = Math.max(0, Math.min(STEPS.length - 1, idx));
  const s = STEPS[clamped];
  const acc = s.letter === keepLetter && keepAcc ? keepAcc : defaultAccidental(s.letter, keySig);
  return `${s.letter}${acc}${s.octave}`;
}

export function splitPitch(pitch: string): { letter: string; acc: string; octave: number } | null {
  const m = pitch.match(/^([A-G])([#b]?)(-?\d)$/);
  if (!m) return null;
  return { letter: m[1], acc: m[2] ?? '', octave: Number(m[3]) };
}

// MIDI pour la transposition (conserve la hauteur absolue, octave incluse)
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchToMidi(pitch: string): number | null {
  const s = splitPitch(pitch);
  if (!s) return null;
  let semi = SEMI[s.letter] + (s.acc === '#' ? 1 : s.acc === 'b' ? -1 : 0);
  return (s.octave + 1) * 12 + semi;
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToPitch(midi: number, useSharps: boolean): string {
  const names = useSharps ? SHARP_NAMES : FLAT_NAMES;
  const semi = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${names[semi]}${octave}`;
}

export function transposeSoloPitch(pitch: string, delta: number, useSharps: boolean): string {
  if (pitch === 'R') return 'R';
  const midi = pitchToMidi(pitch);
  if (midi === null) return pitch;
  return midiToPitch(midi + delta, useSharps);
}

export function transposeSolo(solo: Solo, delta: number, useSharps: boolean): Solo {
  return {
    ...solo,
    measures: solo.measures.map((m) => ({
      ...m,
      notes: m.notes.map((n) => ({
        ...n,
        pitch: transposeSoloPitch(n.pitch, delta, useSharps),
        chord:
          n.chord && isChordToken(n.chord) ? transposeChord(n.chord, delta, useSharps) : n.chord,
      })),
    })),
  };
}

export function respellSolo(solo: Solo, useSharps: boolean): Solo {
  return transposeSolo(solo, 12, useSharps);
}

// ---------- Sérialisation bloc ```solo ----------

export function serializeSolo(solo: Solo): string {
  const lines = solo.measures.map((m) =>
    m.notes
      .map((n) => {
        const chord = n.chord ? `[${n.chord}]` : '';
        const body = n.pitch === 'R' ? `${n.dur}${n.dotted ? '.' : ''}:R` : `${n.dur}${n.dotted ? '.' : ''}:${n.pitch}`;
        return `${chord}${body}`;
      })
      .join(' '),
  );
  const head = `\`\`\`solo "${solo.title.replace(/"/g, "'")}" key=${solo.keySig} time=${solo.timeSig} mpl=${solo.measuresPerLine}`;
  return `${head}\n${lines.join(' | ')}\n\`\`\``;
}

const TOKEN_RE = /^(?:\[([^\]]+)\])?([whq]|16|8)(\.?):([A-G][#b]?-?\d|R)$/;

export function parseSoloBlock(title: string, keySig: string, timeSig: string, mpl: string, body: string): Solo {
  if (!KEY_SIGS.includes(keySig as KeySig)) throw new Error(`Armature inconnue : ${keySig}`);
  if (!(timeSig in TIME_CAPACITY)) throw new Error(`Signature inconnue : ${timeSig}`);
  const measuresPerLine = Math.max(1, Math.min(8, Number(mpl) || 4));
  const time = timeSig as TimeSig;
  const capacity = TIME_CAPACITY[time];
  const measureTexts = body
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const measures: SoloMeasure[] = measureTexts.map((mt, mi) => {
    const tokens = mt.split(/\s+/).filter(Boolean);
    let used = 0;
    const notes: SoloNote[] = tokens.map((tok) => {
      const m = tok.match(TOKEN_RE);
      if (!m) throw new Error(`Mesure ${mi + 1} : note invalide « ${tok} »`);
      const [, chord, dur, dot, pitch] = m;
      if (chord !== undefined && !isChordToken(chord)) throw new Error(`Mesure ${mi + 1} : accord invalide « ${chord} »`);
      used += DUR_BEATS[dur as NoteDur] * (dot === '.' ? 1.5 : 1);
      if (used > capacity + 1e-9) throw new Error(`Mesure ${mi + 1} : dépasse ${time}`);
      return { id: uid(), pitch, dur: dur as NoteDur, ...(dot === '.' ? { dotted: true } : {}), ...(chord ? { chord } : {}) };
    });
    return { id: uid(), notes };
  });
  if (measures.length === 0) measures.push(newMeasure());
  return { id: uid(), title, keySig, timeSig: time, measuresPerLine, measures };
}
