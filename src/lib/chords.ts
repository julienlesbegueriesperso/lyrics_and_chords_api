/** Utilitaires d'accords : détection + transposition. */

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Suffixes autorisés après la fondamentale (sans espace) :
// m, M, maj, min, dim, aug, sus2/4, add.., 7/9/..., altérations, parenthèses, ° ø
const SUFFIX_RE =
  /^(?:m(?!aj)|M|maj|min|dim|aug|sus[24]?|add(?:2|4|6|7|9|11|13)?|[0-9]+(?:[#b][59])?|[()°ø+#b.\-])*$/;

const ROOT_RE = /^([A-G])([#b]?)([^/]*?)(?:\/([A-G])([#b]?))?$/;

export interface ParsedChord {
  root: string;
  accidental: string;
  suffix: string;
  bassRoot: string | null;
  bassAccidental: string;
}

export function isChordToken(inner: string): boolean {
  // Pas d'espace, pas de markdown : "[mon ami]" n'est pas un accord.
  if (!inner || inner.includes(' ') || inner.includes('\t') || inner.includes('\n')) return false;
  if (inner.includes('(') && inner.includes(')')) {
    // autorisé mais vérifié plus bas
  }
  // Rejette les liens markdown ou mots longs : limite raisonnable
  if (inner.length > 16) return false;
  const m = inner.match(ROOT_RE);
  if (!m) return false;
  const suffix = m[3] ?? '';
  const bassRoot = m[4] ?? null;
  const bassAcc = m[5] ?? '';
  if (bassRoot === null && suffix === '' ) return true; // C, D...
  if (!SUFFIX_RE.test(suffix)) return false;
  // "m" isolé ok, mais suffixe vide déjà traité ; refuse suffixe qui commence par un mot inconnu
  // ex: "on" dans "Mon" -> 'o' non autorisé seul... SUFFIX_RE le rejette déjà.
  if (suffix !== '' && /^[a-zA-Z]+$/.test(suffix) && !/^(m|M|maj|min|dim|aug|sus|sus2|sus4|add\d*)$/.test(suffix)) {
    return false;
  }
  void bassAcc;
  return true;
}

function noteToIndex(root: string, accidental: string): number {
  const name = root + accidental;
  let i = SHARPS.indexOf(name);
  if (i >= 0) return i;
  i = FLATS.indexOf(name);
  if (i >= 0) return i;
  // enharmonies rares
  const map: Record<string, number> = {
    'B#': 0, Cb: 11, 'E#': 5, Fb: 4,
  };
  return map[name] ?? -1;
}

export function transposeNote(root: string, accidental: string, delta: number, useSharps: boolean): string {
  const idx = noteToIndex(root, accidental);
  if (idx < 0) return root + accidental;
  const next = (((idx + delta) % 12) + 12) % 12;
  return (useSharps ? SHARPS : FLATS)[next];
}

export function transposeChord(token: string, delta: number, useSharps = true): string {
  const m = token.match(ROOT_RE);
  if (!m) return token;
  const [, root, acc, suffix, bassRoot, bassAcc] = m;
  const newRoot = transposeNote(root, acc ?? '', delta, useSharps);
  if (!bassRoot) return `${newRoot}${suffix ?? ''}`;
  const newBass = transposeNote(bassRoot, bassAcc ?? '', delta, useSharps);
  return `${newRoot}${suffix ?? ''}/${newBass}`;
}

/** Transpose tous les [Accord] valides dans le contenu. */
export function transposeContent(content: string, delta: number, useSharps = true): string {
  if (delta === 0) return content;
  return content.replace(/\[([^\]\n]+)\]/g, (full, inner: string) => {
    if (!isChordToken(inner)) return full;
    return `[${transposeChord(inner, delta, useSharps)}]`;
  });
}

/** Convertit juste la notation (dièses <-> bémols) sans changer de hauteur. */
export function respellContent(content: string, useSharps: boolean): string {
  return transposeContent(content, 0 + 12, useSharps); // +12 = même hauteur, nouvelle orthographe
  // NB: transposeContent(12) retombe sur les mêmes index, réécrits selon useSharps.
}
