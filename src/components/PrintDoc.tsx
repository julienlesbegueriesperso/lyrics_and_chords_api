import { useEffect, useRef } from 'react';
import type { Song } from '../types';
import { renderSystem } from '../lib/renderScore';
import type { Solo, SoloMeasure } from '../lib/solo';
import { SongView } from './SongView';

function chunk(measures: SoloMeasure[], perLine: number): SoloMeasure[][] {
  const out: SoloMeasure[][] = [];
  for (let i = 0; i < measures.length; i += perLine) out.push(measures.slice(i, i + perLine));
  return out;
}

function PrintSolo({ solo }: { solo: Solo }) {
  const systems = chunk(solo.measures, solo.measuresPerLine);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    systems.forEach((measures, si) => {
      const host = refs.current[si];
      if (host) {
        renderSystem(host, {
          solo,
          measures,
          systemIndex: si,
          totalSystems: systems.length,
          measureW: 150,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo]);
  return (
    <section className="print-solo">
      <h2>
        {solo.title}
        <span className="print-solo-meta">
          {' '}
          · Clé de sol · Armature {solo.keySig} · {solo.timeSig}
        </span>
      </h2>
      {systems.map((_, si) => (
        <div
          key={si}
          className="system-print"
          ref={(el) => {
            refs.current[si] = el;
          }}
        />
      ))}
    </section>
  );
}

/** Document propre pour impression / PDF. Caché à l'écran, visible dans @media print. */
export function PrintDoc({ song, onReady }: { song: Song; onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return (
    <div className="print-doc" aria-hidden="true">
      <h1 className="print-title">{song.title || 'Sans titre'}</h1>
      {song.artist && <p className="print-artist">{song.artist}</p>}
      <SongView content={song.content} />
      {(song.solos ?? []).map((s) => (
        <PrintSolo key={s.id} solo={s} />
      ))}
    </div>
  );
}
