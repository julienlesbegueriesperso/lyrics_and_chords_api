import {
  Accidental,
  Annotation,
  Barline,
  Beam,
  Dot,
  Formatter,
  GhostNote,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
} from 'vexflow';
import { defaultAccidental, splitPitch, stepIndexOf, TIME_CAPACITY, type Solo, type SoloMeasure } from './solo';

/** Géométrie partagée : SoloEditor (interactions) + impression (lecture seule). */
export const SCORE = { measureW: 230, spacing: 12, staveY: 64, height: 190 } as const;
export const F5_INDEX = 10; // F5 dans STEPS

export interface ScoreGeom {
  measureX: number[];
  measureW: number[];
  noteX: Array<Array<{ id: string; x: number; y: number }>>;
  /** Y (SVG) de la 1re ligne (Fa5) de chaque mesure : calibre le clic → hauteur. */
  staveTopY: number[];
  /** Demi-interligne réel (un degré diatonique) : calibre le glisser. */
  halfSpacing: number;
}

function vexKey(pitch: string): string {
  const s = splitPitch(pitch);
  if (!s) return 'b/4';
  return `${s.letter.toLowerCase()}/${s.octave}`;
}

/** Rend un système (ligne de portées) dans `host`, retourne la géométrie pour les interactions. */
export function renderSystem(
  host: HTMLDivElement,
  args: {
    solo: Solo;
    measures: SoloMeasure[];
    systemIndex: number;
    totalSystems: number;
    measureW?: number;
    selectedId?: string | string[] | null;
    playingId?: string | string[] | null;
  },
): ScoreGeom {
  const { solo, measures, systemIndex: si, totalSystems, measureW = SCORE.measureW, selectedId = null, playingId = null } = args;
  const selected = new Set(Array.isArray(selectedId) ? selectedId : selectedId ? [selectedId] : []);
  const playing = new Set(Array.isArray(playingId) ? playingId : playingId ? [playingId] : []);
  host.innerHTML = '';
  const capacity = TIME_CAPACITY[solo.timeSig];
  const widths = measures.map((_, i) => measureW + (i === 0 ? (si === 0 ? 110 : 70) : 0));
  const totalW = widths.reduce((a, b) => a + b, 0) + 20;
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(totalW, SCORE.height);
  const ctx = renderer.getContext();
  const geom: ScoreGeom = { measureX: [], measureW: [], noteX: [], staveTopY: [], halfSpacing: SCORE.spacing / 2 };
  // Ordre global des notes (toutes mesures) pour les liaisons, y compris entre mesures.
  const flat: Array<{ mId: string; nId: string; pitch: string }> = [];
  solo.measures.forEach((mm) => mm.notes.forEach((n) => flat.push({ mId: mm.id, nId: n.id, pitch: n.pitch })));
  const inSystem = new Set(measures.flatMap((m) => m.notes.map((n) => n.id)));
  const snById = new Map<string, StaveNote>();
  let x = 10;
  measures.forEach((m, i) => {
    const w = widths[i];
    const stave = new Stave(x, SCORE.staveY, w, { spacingBetweenLinesPx: SCORE.spacing });
    if (i === 0) {
      stave.addClef('treble');
      stave.addKeySignature(solo.keySig);
      if (si === 0) stave.addTimeSignature(solo.timeSig);
    }
    if (si === totalSystems - 1 && i === measures.length - 1) {
      stave.setEndBarType(Barline.type.END);
    }
    stave.setContext(ctx).draw();
    // Géométrie mesurée (auto-calibrée, insensible aux options VexFlow) :
    // Y de la 1re ligne + demi-interligne réel déduit des lignes extrêmes.
    geom.staveTopY.push(stave.getYForLine(0));
    geom.halfSpacing = (stave.getYForLine(4) - stave.getYForLine(0)) / 8;
    const topY = stave.getYForLine(0);
    const half = geom.halfSpacing;
    // Y attendu de chaque tête de note (même formule que le clic → hauteur) :
    // un clic près d'une tête = sélection, ailleurs = insertion à hauteur du clic.
    const headY = (pitch: string): number => {
      if (pitch === 'R') return topY + (F5_INDEX - 6) * half; // silence : milieu de portée (Si4)
      const s = stepIndexOf(pitch);
      return s < 0 ? topY + (F5_INDEX - 6) * half : topY + (F5_INDEX - s) * half;
    };

    const snList: StaveNote[] = m.notes.map((n) => {
      const isRest = n.pitch === 'R';
      const sn = new StaveNote({
        keys: [isRest ? 'b/4' : vexKey(n.pitch)],
        duration: isRest ? `${n.dur}r` : n.dur,
        clef: 'treble',
        autoStem: true,
      });
      if (!isRest) {
        const s = splitPitch(n.pitch);
        const expected = s ? defaultAccidental(s.letter, solo.keySig) : '';
        if (s && s.acc && s.acc !== expected) sn.addModifier(new Accidental(s.acc), 0);
      }
      if (n.chord) {
        const ann = new Annotation(n.chord);
        ann.setVerticalJustification(Annotation.VerticalJustify.TOP);
        ann.setFont('Arial', 11, 'bold');
        sn.addModifier(ann, 0);
      }
      if (n.dotted) Dot.buildAndAttach([sn], { all: true });
      if (selected.has(n.id)) sn.setStyle({ fillStyle: '#aa3bff', strokeStyle: '#aa3bff' });
      if (playing.has(n.id)) sn.setStyle({ fillStyle: '#e8590c', strokeStyle: '#e8590c' });
      snById.set(n.id, sn);
      return sn;
    });

    // Liaisons créées AVANT format/draw : Beam(autoStem) fige la direction
    // des hampes, voice.draw() les dessine ensuite de façon cohérente.
    const beams: Beam[] = [];
    let run: StaveNote[] = [];
    const flush = () => {
      if (run.length >= 2) beams.push(new Beam(run, true));
      run = [];
    };
    m.notes.forEach((n, ni) => {
      if ((n.dur === '8' || n.dur === '16') && n.pitch !== 'R') run.push(snList[ni]);
      else flush();
    });
    flush();

    const voice = new Voice({ numBeats: capacity, beatValue: 4 });
    voice.setStrict(false);
    if (snList.length === 0) voice.addTickables([new GhostNote({ duration: 'w' })]);
    else voice.addTickables(snList);
    new Formatter().joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());

    geom.measureX.push(x);
    geom.measureW.push(w);
    geom.noteX.push(m.notes.map((n, ni) => ({ id: n.id, x: snList[ni].getAbsoluteX(), y: headY(n.pitch) })));
    x += w;
  });

  // Liaisons de prolongation (tie) : entre mesures du système + demi-liaisons
  // aux bornes du système (liaison à cheval sur deux lignes).
  const canTie = (a: string, b: string) => a !== 'R' && a === b;
  const drawTie = (first: StaveNote | null, last: StaveNote | null) => {
    try {
      new StaveTie({ firstNote: first, lastNote: last, firstIndexes: [0], lastIndexes: [0] })
        .setContext(ctx)
        .draw();
    } catch {
      /* note hors contexte : ignore */
    }
  };
  measures.forEach((m) => {
    m.notes.forEach((n) => {
      if (!n.tie) return;
      const i = flat.findIndex((f) => f.nId === n.id);
      const next = i >= 0 ? flat[i + 1] : undefined;
      if (!next || !canTie(n.pitch, next.pitch)) return;
      const first = snById.get(n.id) ?? null;
      const last = snById.get(next.nId) ?? null;
      if (first && last) drawTie(first, last);
      else if (first && !inSystem.has(next.nId)) drawTie(first, null); // sort du système
    });
  });
  // Demi-liaison entrante : 1re note du système cible d'une liaison du système précédent.
  const firstInSystem = flat.find((f) => inSystem.has(f.nId));
  if (firstInSystem) {
    const i = flat.findIndex((f) => f.nId === firstInSystem.nId);
    const prev = i > 0 ? flat[i - 1] : undefined;
    const prevTied = prev
      ? solo.measures.some((mm) => mm.notes.some((n) => n.id === prev.nId && n.tie))
      : false;
    if (prev && prevTied && canTie(prev.pitch, firstInSystem.pitch) && !inSystem.has(prev.nId)) {
      const last = snById.get(firstInSystem.nId) ?? null;
      if (last) drawTie(null, last);
    }
  }
  return geom;
}
