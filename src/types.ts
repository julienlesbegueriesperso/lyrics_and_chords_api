import type { Solo } from './lib/solo';

export interface Song {
  id: string;
  title: string;
  artist: string;
  /** Corps Markdown + accords inline [Am] */
  content: string;
  solos: Solo[];
  transpose: number;
  useSharps: boolean;
  createdAt: number;
  updatedAt: number;
}

export function newSong(title = 'Nouvelle chanson'): Song {
  const now = Date.now();
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2)}`,
    title,
    artist: '',
    content: `# Couplet 1\n[C]Au clair de la lune, [F]mon ami Pierrot,\n[C]Prête-moi ta plume [G]pour é[C]crire un mot.\n\n# Refrain\n[F]Ma chandelle est morte, [C]je n'ai plus de feu,\n[G]Ouvre-moi ta porte [C]pour l'amour de Dieu.\n`,
    solos: [],
    transpose: 0,
    useSharps: true,
    createdAt: now,
    updatedAt: now,
  };
}
