import { Fragment } from 'react';
import { parseLine } from '../lib/parse';

/** Petit gras **texte** dans les paroles (le reste est littéral). */
function RichText({ text }: { text: string }) {
  const parts = text.split('**');
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

export function SongView({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return (
    <div className="song-sheet">
      {lines.map((line, li) => {
        const trimmed = line.trim();
        if (trimmed === '') return <div key={li} className="song-blank" />;
        const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
          return (
            <div key={li} className="song-heading">
              <RichText text={heading[2]} />
            </div>
          );
        }
        const segments = parseLine(line);
        return (
          <div key={li} className="song-line">
            {segments.map((seg, si) => (
              <span key={si} className="seg">
                <span className="chord">{seg.chord ?? ''}</span>
                <span className="lyric">
                  <RichText text={seg.text === '' ? ' ' : seg.text} />
                </span>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
