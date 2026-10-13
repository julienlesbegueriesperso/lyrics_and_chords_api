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
  Voice,
} from 'vexflow';
import { defaultAccidental, splitPitch, TIME_CAPACITY, type Solo, type SoloMeasure } from './solo';

/** Géométrie partagée : SoloEditor (interactions) + impression (lecture seule). */
export const SCORE = { measureW: 230, spacing: 12, staveY: 64, height: 190 } as const;
export const F5_INDEX = 10; // F5 dans STEPS

export interface ScoreGeom {
  measureX: number[];
  measureW: number[];
  noteX: Array<Array<{ id: string; x: number }>>;
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
    selectedId?: string | null;
  },
): ScoreGeom {
  const { solo, measures, systemIndex: si, totalSystems, measureW = SCORE.measureW, selectedId = null } = args;
  host.innerHTML = '';
  const capacity = TIME_CAPACITY[solo.timeSig];
  const widths = measures.map((_, i) => measureW + (i === 0 ? (si === 0 ? 110 : 70) : 0));
  const totalW = widths.reduce((a, b) => a + b, 0) + 20;
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(totalW, SCORE.height);
  const ctx = renderer.getContext();
  const geom: ScoreGeom = { measureX: [], measureW: [], noteX: [] };
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
      if (selectedId === n.id) sn.setStyle({ fillStyle: '#aa3bff', strokeStyle: '#aa3bff' });
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
    geom.noteX.push(m.notes.map((n, ni) => ({ id: n.id, x: snList[ni].getAbsoluteX() })));
    x += w;
  });
  return geom;
}
