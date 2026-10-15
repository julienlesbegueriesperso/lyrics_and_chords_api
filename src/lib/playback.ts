import { effectiveBeats, pitchToMidi, type Solo } from './solo';

/** Un segment = une note/silence positionné en temps (temps en battements, noire = 1). */
export interface PlaySeg {
  id: string;
  midi: number | null;
  start: number;
  dur: number;
  /** Liaison sortante vers la note suivante (prolongation, pas de ré-attaque). */
  tie: boolean;
  measureNum: number;
  noteNum: number;
}

/** Une attaque = un son continu (les notes liées sont fusionnées, sans ré-attaque). */
export interface PlayAttack {
  midi: number;
  start: number;
  dur: number;
}

export function buildSegments(solo: Solo): PlaySeg[] {
  const segs: PlaySeg[] = [];
  let t = 0;
  solo.measures.forEach((m, mi) => {
    m.notes.forEach((n, ni) => {
      const d = effectiveBeats(m, n);
      segs.push({
        id: n.id,
        midi: n.pitch === 'R' ? null : pitchToMidi(n.pitch),
        start: t,
        dur: d,
        tie: n.tie === true,
        measureNum: mi + 1,
        noteNum: ni + 1,
      });
      t += d;
    });
  });
  return segs;
}

export function totalBeats(segs: PlaySeg[]): number {
  return segs.reduce((s, x) => s + x.dur, 0);
}

export function buildAttacks(segs: PlaySeg[]): PlayAttack[] {
  const out: PlayAttack[] = [];
  let cur: PlayAttack | null = null;
  let last: PlaySeg | null = null;
  for (const s of segs) {
    const cont =
      last !== null && last.tie && last.midi !== null && s.midi !== null && last.midi === s.midi;
    if (cont && cur) {
      cur.dur += s.dur;
    } else if (s.midi !== null) {
      cur = { midi: s.midi, start: s.start, dur: s.dur };
      out.push(cur);
    } else {
      cur = null; // un silence casse la liaison
    }
    last = s;
  }
  return out;
}

/** Position (en battements) de la note `noteId`, ou null si introuvable. */
export function beatOfNote(solo: Solo, noteId: string): number | null {
  let t = 0;
  for (const m of solo.measures) {
    for (const n of m.notes) {
      if (n.id === noteId) return t;
      t += effectiveBeats(m, n);
    }
  }
  return null;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
