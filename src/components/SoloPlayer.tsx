import { useEffect, useRef, useState } from 'react';
import {
  beatOfNote,
  buildAttacks,
  buildSegments,
  formatTime,
  midiToFreq,
  totalBeats,
  type PlaySeg,
} from '../lib/playback';
import type { Solo } from '../lib/solo';

type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';

interface Props {
  solo: Solo;
  /** Id de la note primaire sélectionnée (départ de lecture), ou null. */
  startNoteId: string | null;
  /** Libellé du point de départ (ex. "M3 n2"), ou null. */
  startLabel: string | null;
  onPlayingId: (id: string | null) => void;
  /** Appelé par ⏮ : le retour au début désélectionne (sinon ▶ repartirait de la note). */
  onClearSelection: () => void;
}

/** Petit lecteur MIDI (Web Audio, sans dépendance) pour un solo. */
export function SoloPlayer({ solo, startNoteId, startLabel, onPlayingId, onClearSelection }: Props) {
  const [playing, setPlaying] = useState(false);
  const [posBeats, setPosBeats] = useState(0);
  const [bpm, setBpm] = useState(100);
  const [wave, setWave] = useState<Wave>('triangle');
  const [volume, setVolume] = useState(0.7);

  const soloRef = useRef(solo);
  soloRef.current = solo;
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const waveRef = useRef(wave);
  waveRef.current = wave;
  const volRef = useRef(volume);
  volRef.current = volume;
  const onPlayingRef = useRef(onPlayingId);
  onPlayingRef.current = onPlayingId;

  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const nodesRef = useRef<OscillatorNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playRef = useRef<{ startCtx: number; startBeat: number; total: number; segs: PlaySeg[] } | null>(null);
  const lastIdRef = useRef<string | null>(null);

  const total = totalBeats(buildSegments(soloRef.current));
  const spb = 60 / bpm; // secondes par battement

  // ---------- bas niveau ----------
  const ensureCtx = (): AudioContext => {
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = volRef.current;
      // Simple limiteur anti-saturation
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      ctxRef.current = ctx;
      masterRef.current = master;
    }
    void ctx.resume();
    if (masterRef.current) masterRef.current.gain.setTargetAtTime(volRef.current, ctx.currentTime, 0.02);
    return ctx;
  };

  const killNodes = () => {
    const nodes = nodesRef.current;
    nodesRef.current = [];
    for (const o of nodes) {
      try {
        o.stop();
      } catch {
        /* déjà arrêté */
      }
      try {
        o.disconnect();
      } catch {
        /* déjà déconnecté */
      }
    }
  };

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const emitPlaying = (id: string | null) => {
    if (id !== lastIdRef.current) {
      lastIdRef.current = id;
      onPlayingRef.current(id);
    }
  };

  const hardStop = () => {
    killNodes();
    clearTimer();
    playRef.current = null;
    emitPlaying(null);
    setPlaying(false);
  };

  const schedule = (ctx: AudioContext, t0: number, fromBeat: number) => {
    const secPerBeat = 60 / bpmRef.current;
    const master = masterRef.current;
    if (!master) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 4200;
    filter.connect(master);
    for (const a of buildAttacks(buildSegments(soloRef.current))) {
      const end = a.start + a.dur;
      if (end <= fromBeat + 1e-9) continue;
      const s = Math.max(a.start, fromBeat);
      const tStart = t0 + (s - fromBeat) * secPerBeat;
      const dur = Math.max(0.05, (end - s) * secPerBeat);
      const osc = ctx.createOscillator();
      osc.type = waveRef.current;
      osc.frequency.value = midiToFreq(a.midi);
      const g = ctx.createGain();
      const peak = 0.5;
      g.gain.setValueAtTime(0.0001, tStart);
      g.gain.linearRampToValueAtTime(peak, tStart + 0.015);
      if (dur > 0.12) g.gain.exponentialRampToValueAtTime(peak * 0.7, tStart + Math.min(dur - 0.05, 0.4));
      g.gain.setValueAtTime(peak * 0.7, tStart + Math.max(0.015, dur - 0.05));
      g.gain.linearRampToValueAtTime(0.0001, tStart + dur);
      osc.connect(g);
      g.connect(filter);
      osc.start(tStart);
      osc.stop(tStart + dur + 0.03);
      nodesRef.current.push(osc);
    }
  };

  const tick = () => {
    const p = playRef.current;
    const ctx = ctxRef.current;
    if (!p || !ctx) return;
    const now = p.startBeat + ((ctx.currentTime - p.startCtx) * bpmRef.current) / 60;
    if (now >= p.total - 1e-6) {
      setPosBeats(0);
      hardStop(); // fin : retour au début
      return;
    }
    setPosBeats(now);
    const seg = p.segs.find((s) => now >= s.start && now < s.start + s.dur);
    emitPlaying(seg ? seg.id : null);
  };

  // ---------- commandes ----------
  const play = (fromBeat: number) => {
    const ctx = ensureCtx();
    killNodes();
    clearTimer();
    const segs = buildSegments(soloRef.current);
    const tot = totalBeats(segs);
    if (tot <= 0) return;
    const from = Math.max(0, Math.min(fromBeat, tot - 1e-6));
    const t0 = ctx.currentTime + 0.08;
    schedule(ctx, t0, from);
    playRef.current = { startCtx: t0, startBeat: from, total: tot, segs };
    lastIdRef.current = 'sentinel'; // force le 1er surlignage
    emitPlaying(null);
    setPosBeats(from);
    setPlaying(true);
    timerRef.current = setInterval(tick, 100);
  };

  const pause = () => {
    const p = playRef.current;
    const ctx = ctxRef.current;
    if (p && ctx) {
      const now = p.startBeat + ((ctx.currentTime - p.startCtx) * bpmRef.current) / 60;
      setPosBeats(Math.max(0, Math.min(now, p.total)));
    }
    hardStop();
  };

  const rewind = () => {
    hardStop();
    setPosBeats(0);
    onClearSelection();
  };

  const toggle = () => {
    if (playing) {
      pause();
      return;
    }
    if (startNoteId) {
      const b = beatOfNote(soloRef.current, startNoteId);
      play(b ?? posBeats);
    } else if (posBeats >= total - 1e-6) {
      play(0);
    } else {
      play(posBeats);
    }
  };

  const seek = (ratio: number) => {
    const b = Math.max(0, Math.min(ratio, 1)) * total;
    if (playing) play(b);
    else {
      setPosBeats(b);
      emitPlaying(null);
    }
  };

  const changeTempo = (v: number) => {
    const next = Math.max(40, Math.min(208, Math.round(v) || 100));
    // Position courante avec l'ANCIEN tempo, puis replanification
    const p = playRef.current;
    const ctx = ctxRef.current;
    const now =
      p && ctx ? p.startBeat + ((ctx.currentTime - p.startCtx) * bpmRef.current) / 60 : null;
    setBpm(next);
    bpmRef.current = next;
    if (now !== null && p) play(Math.max(0, Math.min(now, p.total - 1e-6)));
  };

  // L'édition du solo stoppe la lecture (planning obsolète) ; nettoyage au démontage.
  useEffect(() => {
    return () => {
      killNodes();
      clearTimer();
      playRef.current = null;
      lastIdRef.current = null;
      onPlayingRef.current(null);
      setPlaying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo]);
  useEffect(() => {
    return () => {
      killNodes();
      clearTimer();
      if (ctxRef.current) void ctxRef.current.close().catch(() => undefined);
    };
  }, []);

  const nowSec = posBeats * spb;
  const totalSec = total * spb;
  const ratio = total > 0 ? Math.min(1, posBeats / total) : 0;

  return (
    <div className="player" role="group" aria-label="Lecteur du solo">
      <button type="button" className="btn ghost" onClick={rewind} title="Retour au début">
        ⏮
      </button>
      <button
        type="button"
        className="btn"
        onClick={toggle}
        title={playing ? 'Pause' : startNoteId ? `Lecture depuis ${startLabel ?? 'la note sélectionnée'}` : 'Lecture'}
      >
        {playing ? '⏸ Pause' : '▶ Lecture'}
      </button>
      <div
        className="player-progress"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (r.width > 0) seek((e.clientX - r.left) / r.width);
        }}
        title="Cliquer pour naviguer dans le solo"
      >
        <div className="player-progress-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="player-time">
        {formatTime(nowSec)} / {formatTime(totalSec)}
      </span>
      <label className="player-opt">
        Tempo
        <input
          type="range"
          min={40}
          max={208}
          value={bpm}
          onChange={(e) => changeTempo(Number(e.target.value))}
          aria-label="Tempo en battements par minute"
        />
        <span className="player-bpm">{bpm}</span>
      </label>
      <label className="player-opt">
        Son
        <select value={wave} onChange={(e) => setWave(e.target.value as Wave)} aria-label="Timbre">
          <option value="triangle">Doux</option>
          <option value="sine">Flûte</option>
          <option value="square">Carré</option>
          <option value="sawtooth">Scie</option>
        </select>
      </label>
      <label className="player-opt">
        Vol.
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setVolume(v);
            volRef.current = v;
            const ctx = ctxRef.current;
            if (ctx && masterRef.current) masterRef.current.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
          }}
          aria-label="Volume"
        />
      </label>
      <span className="player-hint">
        {startNoteId
          ? `▶ démarre à ${startLabel ?? 'la note sélectionnée'}`
          : 'Sélectionne une note pour démarrer d’ici · clic sur la barre = naviguer'}
      </span>
    </div>
  );
}
