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

/** pitch "C5", "F#4", "Bb3" ou "R" pour un silence. chord : accord optionnel au-dessus.
 *  tie : liaison de prolongation vers la note suivante (même hauteur).
 *  tuplet : id de groupe de triolet (3 notes en le temps de 2, mêmes durées). */
export interface SoloNote {
  id: string;
  pitch: string;
  dur: NoteDur;
  dotted?: boolean;
  chord?: string;
  tie?: boolean;
  tuplet?: string;
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

/**
 * Totaux consécutifs de notes partageant le même id de triolet, dans une mesure.
 * Seuls les groupes d'exactement 3 notes sont des triolets valides (3 en le temps de 2).
 */
export function tupletRuns(m: SoloMeasure): SoloNote[][] {
  const runs: SoloNote[][] = [];
  let cur: SoloNote[] = [];
  for (const n of m.notes) {
    if (n.tuplet && cur.length > 0 && cur[0].tuplet === n.tuplet) cur.push(n);
    else {
      if (cur.length > 0) runs.push(cur);
      cur = n.tuplet ? [n] : [];
    }
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

/** Durée effective : un membre d'un triolet valide vaut 2/3 de sa durée nominale. */
export function effectiveBeats(m: SoloMeasure, n: SoloNote): number {
  if (!n.tuplet) return noteBeats(n);
  const ok = tupletRuns(m).some((r) => r.length === 3 && r.some((x) => x.id === n.id));
  return noteBeats(n) * (ok ? 2 / 3 : 1);
}

export function measureBeats(m: SoloMeasure): number {
  return m.notes.reduce((s, n) => s + effectiveBeats(m, n), 0);
}

/** Enlève les marques de triolet des groupes incomplets (!== 3 notes consécutives). */
export function clearIncompleteTuplets(measures: SoloMeasure[]): SoloMeasure[] {
  let changed = false;
  const out = measures.map((m) => {
    const valid = new Set(tupletRuns(m).filter((r) => r.length === 3).flatMap((r) => r.map((n) => n.id)));
    if (m.notes.every((n) => !n.tuplet || valid.has(n.id))) return m;
    changed = true;
    return {
      ...m,
      notes: m.notes.map((n) => {
        if (n.tuplet && !valid.has(n.id)) {
          const { tuplet: _drop, ...rest } = n;
          return rest;
        }
        return n;
      }),
    };
  });
  return changed ? out : measures;
}

/** Peut-on ajouter / passer à `dur` (+ point éventuel) dans cette mesure (contrôle strict) ? */
export function canFit(
  measure: SoloMeasure,
  timeSig: TimeSig,
  dur: NoteDur,
  ignoreNoteId?: string,
  dotted = false,
): boolean {
  const used = measure.notes.reduce((s, n) => (n.id === ignoreNoteId ? s : s + effectiveBeats(measure, n)), 0);
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
  const lines = solo.measures.map((m) => {
    // Index de groupe de triolet (1, 2, ...) : lève l'ambiguïté entre triolets adjacents.
    const groupIndex = new Map<string, number>();
    for (const n of m.notes) {
      if (n.tuplet && !groupIndex.has(n.tuplet)) groupIndex.set(n.tuplet, groupIndex.size + 1);
    }
    return m.notes
      .map((n) => {
        const chord = n.chord ? `[${n.chord}]` : '';
        const body = n.pitch === 'R' ? `${n.dur}${n.dotted ? '.' : ''}:R` : `${n.dur}${n.dotted ? '.' : ''}:${n.pitch}`;
        const tup = n.tuplet ? `{3:${groupIndex.get(n.tuplet) ?? 1}}` : '';
        return `${chord}${body}${n.tie ? '~' : ''}${tup}`;
      })
      .join(' ');
  });
  const head = `\`\`\`solo "${solo.title.replace(/"/g, "'")}" key=${solo.keySig} time=${solo.timeSig} mpl=${solo.measuresPerLine}`;
  return `${head}\n${lines.join(' | ')}\n\`\`\``;
}

const TOKEN_RE = /^(?:\[([^\]]+)\])?([whq]|16|8)(\.?):([A-G][#b]?-?\d|R)(~?)(\{3(?::(\d+))?\})?$/;

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
    const tupIds = new Map<string, string>(); // "groupe du bloc" -> id stable
    const notes: SoloNote[] = [];
    for (const tok of tokens) {
      const m = tok.match(TOKEN_RE);
      if (!m) throw new Error(`Mesure ${mi + 1} : note invalide « ${tok} »`);
      const [, chord, dur, dot, pitch, tie, tupBrace, tupNum] = m;
      if (chord !== undefined && !isChordToken(chord)) throw new Error(`Mesure ${mi + 1} : accord invalide « ${chord} »`);
      let tuplet: string | undefined;
      if (tupBrace !== undefined) {
        const key = `${mi}:${tupNum ?? '1'}`;
        if (!tupIds.has(key)) tupIds.set(key, uid());
        tuplet = tupIds.get(key);
      }
      const note: SoloNote = {
        id: uid(),
        pitch,
        dur: dur as NoteDur,
        ...(dot === '.' ? { dotted: true } : {}),
        ...(chord ? { chord } : {}),
        ...(tie === '~' ? { tie: true as const } : {}),
        ...(tuplet ? { tuplet } : {}),
      };
      notes.push(note);
    }
    // Contrôle de capacité avec durées effectives (triolets = 2/3).
    const tmp: SoloMeasure = { id: 'tmp', notes };
    const used = notes.reduce((s, n) => s + effectiveBeats(tmp, n), 0);
    if (used > capacity + 1e-9) throw new Error(`Mesure ${mi + 1} : dépasse ${time}`);
    return { id: uid(), notes };
  });
  if (measures.length === 0) measures.push(newMeasure());
  return { id: uid(), title, keySig, timeSig: time, measuresPerLine, measures };
}
