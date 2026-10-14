import { useEffect, useRef, useState } from 'react';
import { isChordToken } from '../lib/chords';
import { F5_INDEX, SCORE, renderSystem, type ScoreGeom } from '../lib/renderScore';
import {
  canFit,
  measureBeats,
  newMeasure,
  pitchAtStep,
  splitPitch,
  stepIndexOf,
  STEPS,
  TIME_CAPACITY,
  DUR_LABELS,
  KEY_SIGS,
  uid,
  type NoteDur,
  type Solo,
  type SoloMeasure,
  type TimeSig,
} from '../lib/solo';
import { SoloPlayer } from './SoloPlayer';

const DUR_ORDER: NoteDur[] = ['w', 'h', 'q', '8', '16'];
const DUR_SHORT: Record<NoteDur, string> = { w: 'Ronde', h: 'Blanche', q: 'Noire', '8': 'Croche', '16': 'Double' };

interface Selection {
  measureId: string;
  noteId: string;
}

interface Props {
  solo: Solo;
  onChange: (s: Solo) => void;
  onDelete: () => void;
}

export function SoloEditor({ solo, onChange, onDelete }: Props) {
  const [selected, setSelected] = useState<Selection[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [addDur, setAddDur] = useState<NoteDur>('q');
  const [addMode, setAddMode] = useState<'note' | 'rest'>('note');
  const [warn, setWarn] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const svgRefs = useRef<Array<HTMLDivElement | null>>([]);
  const geomRef = useRef<ScoreGeom[]>([]);
  const dragRef = useRef<Selection | null>(null);
  // Historique annuler/refaire (10 actions), local au solo
  const pastRef = useRef<Solo[]>([]);
  const futureRef = useRef<Solo[]>([]);
  const dragStartRef = useRef<Solo | null>(null);
  const [, setHistTick] = useState(0);
  const soloRef = useRef(solo);
  soloRef.current = solo;

  const capacity = TIME_CAPACITY[solo.timeSig];
  const systems: SoloMeasure[][] = [];
  for (let i = 0; i < solo.measures.length; i += solo.measuresPerLine) {
    systems.push(solo.measures.slice(i, i + solo.measuresPerLine));
  }

  const flash = (msg: string) => {
    setWarn(msg);
    setTimeout(() => setWarn(null), 2500);
  };

  const pushHistory = (prev: Solo) => {
    pastRef.current.push(prev);
    if (pastRef.current.length > 10) pastRef.current.shift();
    futureRef.current = [];
    setHistTick((t) => t + 1);
  };

  /** Mise à jour discrète (avec point d'historique). */
  const update = (next: Solo) => {
    pushHistory(soloRef.current);
    onChange(next);
  };

  const patchMeasures = (fn: (measures: SoloMeasure[]) => SoloMeasure[], commit = true) => {
    const base = soloRef.current;
    const next = { ...base, measures: fn(base.measures) };
    if (commit) pushHistory(base);
    onChange(next);
  };

  const undo = () => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(soloRef.current);
    setHistTick((t) => t + 1);
    setSelected((sel) =>
      sel.filter((s) => prev.measures.some((m) => m.id === s.measureId && m.notes.some((n) => n.id === s.noteId))),
    );
    onChange(prev);
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(soloRef.current);
    setHistTick((t) => t + 1);
    onChange(next);
  };

  // ---------- rendu VexFlow ----------
  useEffect(() => {
    geomRef.current = systems.map((measures, si) => {
      const host = svgRefs.current[si];
      if (!host) return { measureX: [], measureW: [], noteX: [] };
      return renderSystem(host, {
        solo,
        measures,
        systemIndex: si,
        totalSystems: systems.length,
        selectedId: selected.map((s) => s.noteId),
        playingId,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo, selected, playingId]);

  // ---------- interactions ----------
  const posToStep = (y: number): number => {
    const idx = Math.round(F5_INDEX - (y - SCORE.staveY) / (SCORE.spacing / 2));
    return Math.max(0, Math.min(STEPS.length - 1, idx));
  };

  const findNote = (m: SoloMeasure, id: string) => m.notes.find((n) => n.id === id);

  const handleDown = (si: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const geom = geomRef.current[si];
    if (!geom) return;
    const localMi = geom.measureX.findIndex((mx, i) => px >= mx && px <= mx + geom.measureW[i]);
    if (localMi < 0) return;
    const globalMi = si * solo.measuresPerLine + localMi;
    const measure = solo.measures[globalMi];
    const hit = geom.noteX[localMi].find((p) => Math.abs(p.x - px) < 22);
    if (hit) {
      const sel = { measureId: measure.id, noteId: hit.id };
      // Ctrl/Cmd/Shift + clic = multi-sélection (pour lier plusieurs notes)
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        setSelected((prev) =>
          prev.some((s) => s.noteId === hit.id) ? prev.filter((s) => s.noteId !== hit.id) : [...prev, sel],
        );
      } else {
        setSelected([sel]);
      }
      dragRef.current = { measureId: measure.id, noteId: hit.id };
      dragStartRef.current = soloRef.current;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // Ajout à l'endroit cliqué : l'index d'insertion suit la position X
    // par rapport aux notes déjà rendues (entre 2 notes = entre les 2).
    if (!canFit(measure, solo.timeSig, addDur)) {
      flash(`Mesure pleine (${solo.timeSig})`);
      return;
    }
    const pitch = addMode === 'rest' ? 'R' : pitchAtStep(posToStep(py), solo.keySig);
    const note = { id: uid(), pitch, dur: addDur };
    const at = geom.noteX[localMi].filter((p) => p.x < px).length;
    patchMeasures((ms) =>
      ms.map((mm) => {
        if (mm.id !== measure.id) return mm;
        const notes = [...mm.notes];
        notes.splice(Math.min(at, notes.length), 0, note);
        return { ...mm, notes };
      }),
    );
    setSelected([{ measureId: measure.id, noteId: note.id }]);
  };

  const setNoteStep = (measureId: string, noteId: string, stepIdx: number, commit = true) => {
    const base = soloRef.current;
    const measure = base.measures.find((m) => m.id === measureId);
    const note = measure && findNote(measure, noteId);
    if (!measure || !note || note.pitch === 'R') return;
    const cur = splitPitch(note.pitch);
    if (!cur) return;
    const next = pitchAtStep(stepIdx, base.keySig, cur.acc, cur.letter);
    if (next !== note.pitch) {
      patchMeasures(
        (ms) =>
          ms.map((mm) =>
            mm.id === measure.id
              ? { ...mm, notes: mm.notes.map((n) => (n.id === note.id ? { ...n, pitch: next } : n)) }
              : mm,
          ),
        commit,
      );
    }
  };

  const moveSelSteps = (delta: number) => {
    if (!selected || !selMeasure || !selNote || selNote.pitch === 'R') return;
    const cur = stepIndexOf(selNote.pitch);
    if (cur < 0) return;
    setNoteStep(selMeasure.id, selNote.id, cur + delta);
  };

  const stepSelDur = (delta: number) => {
    if (!selMeasure || !selNote) return;
    const i = DUR_ORDER.indexOf(selNote.dur);
    const next = DUR_ORDER[Math.max(0, Math.min(DUR_ORDER.length - 1, i + delta))];
    if (next !== selNote.dur) setSelDur(next);
  };

  const toggleSelDot = () => {
    if (!selMeasure || !selNote) return;
    const dotted = !selNote.dotted;
    if (dotted && !canFit(selMeasure, solo.timeSig, selNote.dur, selNote.id, true)) {
      flash(`Mesure pleine (${solo.timeSig})`);
      return;
    }
    patchMeasures((ms) =>
      ms.map((mm) =>
        mm.id === selMeasure.id
          ? { ...mm, notes: mm.notes.map((n) => (n.id === selNote.id ? { ...n, dotted: dotted || undefined } : n)) }
          : mm,
      ),
    );
  };

  const moveSelNote = (delta: number) => {
    if (!selMeasure || !selNote) return;
    const i = selMeasure.notes.findIndex((n) => n.id === selNote.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= selMeasure.notes.length) return;
    const notes = [...selMeasure.notes];
    const [n] = notes.splice(i, 1);
    notes.splice(j, 0, n);
    patchMeasures((ms) => clearDanglingTies(ms.map((mm) => (mm.id === selMeasure.id ? { ...mm, notes } : mm))));
  };

  // Clavier : note sélectionnée = ↑↓ hauteur, ←→ durée, . pointée, L lier, ⌫ supprimer, Échap fermer.
  // Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y = annuler / refaire (partout sauf champs de saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !inField) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !inField) {
        e.preventDefault();
        redo();
        return;
      }
      if (selected.length === 0 || inField) return;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveSelSteps(1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveSelSteps(-1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepSelDur(1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepSelDur(-1);
          break;
        case '.':
          e.preventDefault();
          toggleSelDot();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          tiePrimary();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelNote();
          break;
        case 'Escape':
          setSelected([]);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo, selected]);

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const py = e.clientY - rect.top;
    setNoteStep(drag.measureId, drag.noteId, posToStep(py), false);
  };

  const endDrag = () => {
    // Un drag = une seule action d'historique
    if (dragStartRef.current && dragStartRef.current !== soloRef.current) {
      pushHistory(dragStartRef.current);
    }
    dragStartRef.current = null;
    dragRef.current = null;
  };

  // ---------- panneau note sélectionnée ----------
  // Sélection multiple : la « primaire » (panneau) est la dernière sélectionnée.
  const primary = selected.length > 0 ? selected[selected.length - 1] : undefined;
  const selMeasure = solo.measures.find((m) => m.id === primary?.measureId);
  const selNote = selMeasure && primary ? findNote(selMeasure, primary.noteId) : undefined;

  /** Ordre global des notes (toutes mesures) : indispensable pour lier entre 2 mesures. */
  const flatNotes = () => soloRef.current.measures.flatMap((m) => m.notes.map((n) => ({ measureId: m.id, note: n })));
  const nextOf = (noteId: string) => {
    const flat = flatNotes();
    const i = flat.findIndex((f) => f.note.id === noteId);
    if (i < 0) return undefined;
    return { curr: flat[i], next: flat[i + 1] as (typeof flat)[number] | undefined };
  };
  /** Enlève les liaisons devenues invalides (successeur absent, silence ou hauteur différente). */
  const clearDanglingTies = (measures: SoloMeasure[]): SoloMeasure[] => {
    const flat = measures.flatMap((m) => m.notes);
    const ok = new Set(flat.filter((n, i) => n.tie && flat[i + 1] && flat[i + 1].pitch !== 'R' && flat[i + 1].pitch === n.pitch).map((n) => n.id));
    let changed = false;
    const out = measures.map((m) => ({
      ...m,
      notes: m.notes.map((n) => {
        if (n.tie && !ok.has(n.id)) {
          changed = true;
          const { tie: _drop, ...rest } = n;
          return rest;
        }
        return n;
      }),
    }));
    return changed ? out : measures;
  };

  /** Lie la note primaire à la note qui la suit (souvent dans la mesure suivante). */
  const tiePrimary = () => {
    if (!selMeasure || !selNote) return;
    const found = nextOf(selNote.id);
    if (!found?.next) {
      flash('Aucune note suivante à lier');
      return;
    }
    if (selNote.pitch === 'R' || found.next.note.pitch === 'R') {
      flash('On ne peut pas lier un silence');
      return;
    }
    if (found.next.note.pitch !== selNote.pitch) {
      flash(`Liaison impossible : ${selNote.pitch} → ${found.next.note.pitch} (même hauteur requise)`);
      return;
    }
    patchMeasures((ms) =>
      ms.map((mm) =>
        mm.id === selMeasure.id
          ? { ...mm, notes: mm.notes.map((n) => (n.id === selNote.id ? { ...n, tie: true as const } : n)) }
          : mm,
      ),
    );
  };

  /** Lie les notes sélectionnées entre elles (chaîne, dans l'ordre de la partition). */
  const tieSelection = () => {
    if (selected.length < 2) return;
    const flat = flatNotes();
    const pos = new Map(flat.map((f, i) => [f.note.id, i]));
    const ordered = [...selected].sort((a, b) => (pos.get(a.noteId) ?? 0) - (pos.get(b.noteId) ?? 0));
    for (let k = 0; k < ordered.length - 1; k++) {
      const a = flat[pos.get(ordered[k].noteId) ?? -1];
      const b = flat[pos.get(ordered[k + 1].noteId) ?? -1];
      if (!a || !b) continue;
      if (a.note.pitch === 'R' || b.note.pitch === 'R') {
        flash('On ne peut pas lier un silence');
        return;
      }
      if (a.note.pitch !== b.note.pitch) {
        flash(`Liaison impossible : ${a.note.pitch} → ${b.note.pitch} (même hauteur requise)`);
        return;
      }
      if ((pos.get(ordered[k + 1].noteId) ?? 0) - (pos.get(ordered[k].noteId) ?? 0) !== 1) {
        flash('Les notes liées doivent se suivre (sans note entre elles)');
        return;
      }
    }
    const ids = new Set(ordered.slice(0, -1).map((s) => s.noteId));
    patchMeasures((ms) =>
      ms.map((mm) => ({
        ...mm,
        notes: mm.notes.map((n) => (ids.has(n.id) ? { ...n, tie: true as const } : n)),
      })),
    );
  };

  /** Délie les notes sélectionnées (liaisons sortantes + celles qui pointent vers elles). */
  const untieSelection = () => {
    if (selected.length === 0) return;
    const ids = new Set(selected.map((s) => s.noteId));
    const flat = flatNotes();
    const incoming = new Set<string>();
    flat.forEach((f, i) => {
      if (f.note.tie && flat[i + 1] && ids.has(flat[i + 1].note.id)) incoming.add(f.note.id);
    });
    patchMeasures((ms) =>
      ms.map((mm) => ({
        ...mm,
        notes: mm.notes.map((n) => {
          if (ids.has(n.id) && n.tie) {
            const { tie: _drop, ...rest } = n;
            return rest;
          }
          if (incoming.has(n.id)) {
            const { tie: _drop, ...rest } = n;
            return rest;
          }
          return n;
        }),
      })),
    );
  };
  const selIds = new Set(selected.map((s) => s.noteId));
  const selHasTie = (() => {
    const flat = solo.measures.flatMap((m) => m.notes);
    return flat.some(
      (n, i) => (selIds.has(n.id) && n.tie) || (n.tie && flat[i + 1] !== undefined && selIds.has(flat[i + 1].id)),
    );
  })();

  const setSelDur = (dur: NoteDur) => {
    if (!selMeasure || !selNote || selected.length === 0) return;
    if (!canFit(selMeasure, solo.timeSig, dur, selNote.id)) {
      flash(`Mesure pleine (${solo.timeSig})`);
      return;
    }
    patchMeasures((ms) =>
      ms.map((mm) =>
        mm.id === selMeasure.id
          ? { ...mm, notes: mm.notes.map((n) => (n.id === selNote.id ? { ...n, dur } : n)) }
          : mm,
      ),
    );
  };

  const deleteSelNote = () => {
    if (selected.length === 0) return;
    const ids = new Set(selected.map((s) => s.noteId));
    patchMeasures((ms) =>
      clearDanglingTies(ms.map((mm) => ({ ...mm, notes: mm.notes.filter((n) => !ids.has(n.id)) }))),
    );
    setSelected([]);
  };

  const setSelChord = (chord: string) => {
    if (!selMeasure || !selNote) return;
    const trimmed = chord.trim();
    if (trimmed !== '' && !isChordToken(trimmed)) {
      flash(`« ${trimmed} » n'est pas un accord valide`);
      return;
    }
    patchMeasures((ms) =>
      ms.map((mm) =>
        mm.id === selMeasure.id
          ? {
              ...mm,
              notes: mm.notes.map((n) =>
                n.id === selNote.id ? { ...n, ...(trimmed ? { chord: trimmed } : { chord: undefined }) } : n,
              ),
            }
          : mm,
      ),
    );
  };

  const changeTimeSig = (time: TimeSig) => {
    const cap = TIME_CAPACITY[time];
    const bad = solo.measures.findIndex((m) => measureBeats(m) > cap + 1e-9);
    if (bad >= 0) {
      flash(`Mesure ${bad + 1} dépasse ${time} : retire des notes d'abord`);
      return;
    }
    update({ ...soloRef.current, timeSig: time });
  };

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return (
    <div className="solo">
      <div className="solo-head">
        <input
          className="solo-title"
          value={solo.title}
          onChange={(e) => onChange({ ...solo, title: e.target.value })}
          placeholder="Titre du solo"
          aria-label="Titre du solo"
        />
        <label className="solo-opt">
          Armature
          <select value={solo.keySig} onChange={(e) => update({ ...soloRef.current, keySig: e.target.value })}>
            {KEY_SIGS.map((k) => (
              <option key={k} value={k}>
                {k === 'C' ? 'Do (aucune)' : k}
              </option>
            ))}
          </select>
        </label>
        <label className="solo-opt">
          Mesure
          <select value={solo.timeSig} onChange={(e) => changeTimeSig(e.target.value as TimeSig)}>
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="2/4">2/4</option>
          </select>
        </label>
        <label className="solo-opt">
          Mes./ligne
          <select
            value={solo.measuresPerLine}
            onChange={(e) => update({ ...soloRef.current, measuresPerLine: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {confirmDel ? (
          <span className="delete-confirm">
            <button type="button" className="btn danger" onClick={onDelete}>
              Confirmer
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirmDel(false)}>
              Annuler
            </button>
          </span>
        ) : (
          <button type="button" className="btn ghost" onClick={() => setConfirmDel(true)} title="Supprimer ce solo">
            Supprimer
          </button>
        )}
      </div>

      <div className="solo-toolbar">
        <button type="button" onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
          ↩ Annuler
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Refaire (Ctrl+Shift+Z)">
          ↪ Refaire
        </button>
        <span className="sep" />
        <span className="solo-toolbar-label">Ajouter :</span>
        <button
          type="button"
          className={addMode === 'note' ? 'active' : ''}
          onClick={() => setAddMode('note')}
          title="Cliquer sur la portée ajoute une note"
        >
          ♪ Note
        </button>
        <button
          type="button"
          className={addMode === 'rest' ? 'active' : ''}
          onClick={() => setAddMode('rest')}
          title="Cliquer sur la portée ajoute un silence"
        >
          Silence
        </button>
        <span className="sep" />
        {DUR_ORDER.map((d) => (
          <button
            key={d}
            type="button"
            className={`dur-btn${addDur === d ? ' active' : ''}`}
            onClick={() => setAddDur(d)}
            title={DUR_LABELS[d]}
          >
            {DUR_SHORT[d]}
          </button>
        ))}
        <span className="solo-hint">Clic = insérer à l'endroit cliqué · Glisser = hauteur · Ctrl/Cmd+clic = multi-sélection · Clavier : ↑↓ hauteur · ←→ durée · . pointée · L lier · ⌫ supprimer · Ctrl+Z annuler</span>
      </div>
      {warn && <div className="solo-warn">{warn}</div>}

      <SoloPlayer
        solo={solo}
        startNoteId={primary?.noteId ?? null}
        startLabel={(() => {
          if (!primary) return null;
          const mi = solo.measures.findIndex((m) => m.id === primary.measureId);
          const ni = solo.measures[mi]?.notes.findIndex((n) => n.id === primary.noteId) ?? -1;
          return mi >= 0 && ni >= 0 ? `M${mi + 1} n${ni + 1}` : null;
        })()}
        onPlayingId={setPlayingId}
      />

      {systems.map((measures, si) => {
        const base = si * solo.measuresPerLine;
        return (
          <div key={si} className="system-wrap">
            <div
              className="system-overlay-zone"
              onPointerDown={(e) => handleDown(si, e)}
              onPointerMove={handleMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <div
                ref={(el) => {
                  svgRefs.current[si] = el;
                }}
              />
            </div>
            <div className="system-foot">
              {measures.map((m, i) => {
                const beats = measureBeats(m);
                const full = Math.abs(beats - capacity) < 1e-9;
                return (
                  <span key={m.id} className={`measure-chip${full ? ' full' : ''}`}>
                    M{base + i + 1} · {beats}/{capacity}
                    <button
                      type="button"
                      title={`Supprimer la mesure ${base + i + 1}`}
                      disabled={solo.measures.length <= 1}
                      onClick={() => {
                        patchMeasures((ms) => clearDanglingTies(ms.filter((mm) => mm.id !== m.id)));
                        setSelected((prev) => prev.filter((s) => s.measureId !== m.id));
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}

      {selected.length > 1 && (
        <div className="note-panel">
          <strong>{selected.length} notes sélectionnées</strong>
          <span className="sep" />
          <button type="button" className="btn" onClick={tieSelection} title="Lier les notes sélectionnées entre elles (même hauteur, sans note entre elles)">
            ⌒ Lier la sélection
          </button>
          <button type="button" className="btn ghost" onClick={untieSelection} disabled={!selHasTie} title="Enlever les liaisons des notes sélectionnées">
            Délier
          </button>
          <button type="button" className="btn ghost" onClick={deleteSelNote}>
            Supprimer ({selected.length})
          </button>
          <button type="button" className="btn ghost" onClick={() => setSelected([])}>
            Fermer
          </button>
        </div>
      )}

      {selected.length === 1 && selNote && selMeasure && (
        <div className="note-panel">
          <strong>{selNote.pitch === 'R' ? 'Silence' : `Note ${selNote.pitch}`}</strong>
          <span className="sep" />
          <button
            type="button"
            className={selNote.tie ? 'active' : ''}
            onClick={tiePrimary}
            title="Lier à la note suivante (touche L) — même hauteur, y compris vers la mesure suivante"
          >
            ⌒ Lier
          </button>
          {selHasTie && (
            <button type="button" className="btn ghost" onClick={untieSelection} title="Enlever la liaison">
              Délier
            </button>
          )}
          <span className="sep" />
          {DUR_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              className={selNote.dur === d ? 'active' : ''}
              onClick={() => setSelDur(d)}
              title={DUR_LABELS[d]}
              disabled={selNote.dur !== d && !canFit(selMeasure, solo.timeSig, d, selNote.id)}
            >
              {DUR_SHORT[d]}
            </button>
          ))}
          <button
            type="button"
            className={selNote.dotted ? 'active' : ''}
            onClick={toggleSelDot}
            title="Note pointée (touche .)"
            disabled={!selNote.dotted && !canFit(selMeasure, solo.timeSig, selNote.dur, selNote.id, true)}
          >
            Pointée
          </button>
          <span className="sep" />
          <label className="chord-field">
            Accord
            <ChordInput
              key={selNote.id}
              initial={selNote.chord ?? ''}
              onCommit={setSelChord}
            />
          </label>
          <button type="button" className="btn ghost" onClick={() => moveSelNote(-1)} title="Déplacer avant la note précédente">
            ◀
          </button>
          <button type="button" className="btn ghost" onClick={() => moveSelNote(1)} title="Déplacer après la note suivante">
            ▶
          </button>
          <button type="button" className="btn ghost" onClick={deleteSelNote}>
            Supprimer la note
          </button>
          <button type="button" className="btn ghost" onClick={() => setSelected([])}>
            Fermer
          </button>
        </div>
      )}

      <div className="solo-foot">
        <button
          type="button"
          className="btn"
          onClick={() => patchMeasures((ms) => [...ms, newMeasure()])}
        >
          + Mesure
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            patchMeasures((ms) => [...ms, ...Array.from({ length: solo.measuresPerLine }, () => newMeasure())])
          }
        >
          + Ligne ({solo.measuresPerLine} mesures)
        </button>
      </div>
    </div>
  );
}

function ChordInput({ initial, onCommit }: { initial: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  const valid = value.trim() === '' || isChordToken(value.trim());
  return (
    <span className="chord-input-wrap">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => valid && onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valid) (e.target as HTMLInputElement).blur();
        }}
        placeholder="Am"
        aria-label="Accord au-dessus de la note"
        className={valid ? '' : 'invalid'}
      />
    </span>
  );
}
