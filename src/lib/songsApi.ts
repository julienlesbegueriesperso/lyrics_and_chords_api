import { songFromRow, songToRow } from './songRow';
import { supabase } from './supabase';
import type { Song } from '../types';

/** Couche d'accès à la table `public.songs` (voir supabase/songs.sql). */

export async function fetchSongs(userId: string): Promise<Song[]> {
  if (!supabase) throw new Error('Supabase non configuré');
  const { data, error } = await supabase
    .from('songs')
    .select('id,data')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out: Song[] = [];
  for (const row of data ?? []) {
    const s = songFromRow(row.id as string, row.data);
    if (s) out.push(s);
  }
  return out;
}

export async function upsertSongs(userId: string, songs: Song[]): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré');
  if (songs.length === 0) return;
  const { error } = await supabase.from('songs').upsert(songs.map((s) => songToRow(userId, s)), { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteSongRows(ids: string[]): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré');
  if (ids.length === 0) return;
  const { error } = await supabase.from('songs').delete().in('id', ids);
  if (error) throw error;
}
