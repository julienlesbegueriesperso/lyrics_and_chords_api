import type { Song } from '../types';

/** Mapping pur entre une ligne `public.songs` et un `Song` (sans dépendance réseau). */

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function songFromRow(id: string, data: unknown): Song | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<Song>;
  if (typeof d.content !== 'string') return null;
  return {
    id,
    title: typeof d.title === 'string' ? d.title : '',
    artist: typeof d.artist === 'string' ? d.artist : '',
    content: d.content,
    solos: Array.isArray(d.solos) ? d.solos : [],
    transpose: num(d.transpose, 0),
    useSharps: d.useSharps !== false,
    createdAt: num(d.createdAt, Date.now()),
    updatedAt: num(d.updatedAt, Date.now()),
  };
}

export interface SongRow {
  id: string;
  user_id: string;
  data: Song;
  created_at: string;
  updated_at: string;
}

function iso(ms: number): string {
  const t = new Date(ms).getTime();
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString();
}

export function songToRow(userId: string, s: Song): SongRow {
  return {
    id: s.id,
    user_id: userId,
    data: s,
    created_at: iso(s.createdAt),
    updated_at: iso(s.updatedAt),
  };
}
