import { isChordToken } from './chords';

export interface LyricSegment {
  chord: string | null;
  text: string;
}

const CHORD_SPLIT_RE = /\[([^\]\n]+)\]/g;

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}']/u.test(ch);
}

/**
 * Parse une ligne en segments { chord, text }.
 * Convention milieu de mot (option 1) : "écr-[G]-it" -> "écrit" avec G sur "it".
 * Les "-" coupe de mot entourant l'accord sont retirés quand ils relient deux
 * caractères de mot, sinon ils sont conservés ("C - [G] refrain" garde son tiret).
 */
export function parseLine(line: string): LyricSegment[] {
  const segments: LyricSegment[] = [];
  let lastIndex = 0;
  let pendingChord: string | null = null;

  const pushText = (text: string, chord: string | null) => {
    if (text === '' && chord === null) return;
    if (text === '' && chord !== null) {
      segments.push({ chord, text: '' });
      return;
    }
    segments.push({ chord, text });
  };

  let m: RegExpExecArray | null;
  while ((m = CHORD_SPLIT_RE.exec(line)) !== null) {
    const inner = m[1];
    const idx = m.index;
    const before = line.slice(lastIndex, idx);
    if (isChordToken(inner)) {
      // Texte avant l'accord, rattaché à l'accord précédent (ou sans accord)
      if (before !== '') {
        if (segments.length === 0 && pendingChord === null) {
          pushText(before, null);
        } else if (pendingChord !== null) {
          pushText(before, pendingChord);
          pendingChord = null;
        } else {
          // prolonge le dernier segment sans accord
          const last = segments[segments.length - 1];
          if (last && last.chord === null) last.text += before;
          else pushText(before, null);
        }
      } else if (pendingChord !== null) {
        // deux accords d'affilée : le précédent porte sur un texte vide
        pushText('', pendingChord);
        pendingChord = null;
      }
      pendingChord = pendingChord === null ? inner : `${pendingChord} ${inner}`;
      // hmm: "[C][G]mot" -> on garde les deux ? on les fusionne en "C G"
      lastIndex = idx + m[0].length;
    } else {
      // Pas un accord ([mon ami], lien...) : texte littéral
      const literal = line.slice(lastIndex, idx + m[0].length);
      if (pendingChord !== null) {
        pushText(literal, pendingChord);
        pendingChord = null;
      } else {
        const last = segments[segments.length - 1];
        if (last && last.chord === null) last.text += literal;
        else pushText(literal, null);
      }
      lastIndex = idx + m[0].length;
    }
  }
  const rest = line.slice(lastIndex);
  if (rest !== '' || pendingChord !== null) {
    pushText(rest, pendingChord);
  } else if (segments.length === 0) {
    pushText('', null);
  }

  // Post-traitement : retire les "-" marqueurs de césure autour d'un accord
  // "écr-" + [G] + "-it" -> "écr" + [G] + "it" ; "écr-" + [G] + "it" -> idem
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.chord === null || seg.text === '') continue;
    const prev = segments[i - 1];
    if (!prev || prev.text === '') continue;
    const prevEndsHyphen = prev.text.endsWith('-');
    const segStartsHyphen = seg.text.startsWith('-');
    const prevChar = prev.text.charAt(prev.text.length - (prevEndsHyphen ? 2 : 1));
    const nextChar = seg.text.charAt(segStartsHyphen ? 1 : 0);
    if (prevEndsHyphen && segStartsHyphen && isWordChar(prevChar) && isWordChar(nextChar)) {
      prev.text = prev.text.slice(0, -1);
      seg.text = seg.text.slice(1);
    } else if (prevEndsHyphen && !segStartsHyphen && isWordChar(prevChar) && isWordChar(nextChar)) {
      prev.text = prev.text.slice(0, -1);
    } else if (!prevEndsHyphen && segStartsHyphen && isWordChar(prevChar) && isWordChar(nextChar)) {
      seg.text = seg.text.slice(1);
    }
  }

  return segments;
}

export function countChords(content: string): number {
  let n = 0;
  content.replace(/\[([^\]\n]+)\]/g, (_f, inner: string) => {
    if (isChordToken(inner)) n++;
    return _f;
  });
  return n;
}
