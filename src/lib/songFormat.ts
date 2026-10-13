import type { Song } from '../types';
import { parseSoloBlock, serializeSolo, type Solo } from './solo';

/**
 * Format chanson v2 (.md) :
 *
 * ---
 * title: Au clair de la lune
 * artist: Traditionnel
 * ---
 *
 * # Couplet 1
 * [C]Au clair de la lune...
 *
 * ```solo "Intro" key=G time=4/4 mpl=4
 * q:G4 q:A4 | h:B4 q:R
 * ```
 *
 * - Frontmatter minimal : title, artist (optionnels).
 * - Corps : Markdown de base + accords inline [C], [F#m7/B].
 * - Un [...] avec espace n'est jamais un accord (texte normal / lien markdown).
 * - Milieu de mot : écrire écr-[G]-it, rendu "écrit" avec G sur "it".
 * - Solos : blocs ```solo "Titre" key=C time=4/4 mpl=4, mesures séparées par |,
 *   notes "dur:Hauteur" (q:G4), silences "q:R", accord préfixé "[Am]q:C5".
 */

function escapeFrontmatterValue(v: string): string {
  // guillemets si caractères spéciaux
  if (/[:#\n"']/.test(v)) return JSON.stringify(v);
  return v;
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

export function serializeSongMd(song: Pick<Song, 'title' | 'artist' | 'content' | 'solos'>): string {
  const head = ['---', `title: ${escapeFrontmatterValue(song.title)}`, `artist: ${escapeFrontmatterValue(song.artist)}`, '---', ''].join('\n');
  const body = song.content.replace(/\s+$/, '');
  const solos = (song.solos ?? []).map(serializeSolo).join('\n\n');
  return `${head}\n${body}\n${solos ? `\n${solos}\n` : ''}`;
}

const SOLO_BLOCK_RE = /```solo\s+"([^"]*)"\s+key=([^\s]+)\s+time=([^\s]+)\s+mpl=(\d+)\s*\n([\s\S]*?)```/g;

export function parseSongMd(
  text: string,
  fallbackName = 'Chanson importée',
): { title: string; artist: string; content: string; solos: Solo[] } {
  const normalized = text.replace(/\r\n/g, '\n');
  const fmMatch = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const noFm = { title: fallbackName, artist: '', content: normalized.trim() + '\n', solos: [] as Solo[] };
  let body: string;
  let title = fallbackName;
  let artist = '';
  if (!fmMatch) {
    body = noFm.content;
  } else {
    const [, fm, rest] = fmMatch;
    for (const line of fm.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = unquote(line.slice(idx + 1));
      if (key === 'title' && value) title = value;
      if (key === 'artist') artist = value;
    }
    body = rest;
  }
  const solos: Solo[] = [];
  const content = body
    .replace(SOLO_BLOCK_RE, (_full, t: string, k: string, time: string, mpl: string, b: string) => {
      solos.push(parseSoloBlock(t || 'Solo', k, time, mpl, b));
      return '';
    })
    .replace(/^\n+/, '')
    .replace(/\s+$/, '') + '\n';
  return { title, artist, content, solos };
}

export interface SongBackup {
  version: 1;
  exportedAt: string;
  songs: Song[];
}

export function serializeBackup(songs: Song[]): string {
  const backup: SongBackup = { version: 1, exportedAt: new Date().toISOString(), songs };
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(text: string): Song[] {
  const data = JSON.parse(text);
  const list: Song[] = Array.isArray(data) ? data : data.songs;
  if (!Array.isArray(list)) throw new Error('Fichier JSON invalide : "songs" introuvable.');
  return list
    .filter((s) => s && typeof s.content === 'string')
    .map((s, i) => ({
      id: typeof s.id === 'string' ? s.id : `import-${Date.now()}-${i}`,
      title: typeof s.title === 'string' && s.title ? s.title : `Chanson ${i + 1}`,
      artist: typeof s.artist === 'string' ? s.artist : '',
      content: s.content,
      solos: Array.isArray(s.solos) ? s.solos : [],
      transpose: typeof s.transpose === 'number' ? s.transpose : 0,
      useSharps: s.useSharps !== false,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      updatedAt: Date.now(),
    }));
}

export function downloadFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'chanson'
  );
}
