import { useCallback, useEffect, useState } from 'react';
import { newSong, type Song } from '../types';

const STORAGE_KEY = 'lyrics-chords:songs:v1';
const ACTIVE_KEY = 'lyrics-chords:active:v1';

function loadSongs(): Song[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [newSong('Au clair de la lune')];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((s) => s && typeof s.id === 'string' && typeof s.content === 'string')
      .map((s) => ({ ...s, solos: Array.isArray(s.solos) ? s.solos : [] }));
  } catch {
    return [];
  }
}

export function useSongs() {
  const [songs, setSongs] = useState<Song[]>(loadSongs);
  const [activeId, setActiveId] = useState<string | null>(() => {
    const saved = localStorage.getItem(ACTIVE_KEY);
    return saved;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  }, [songs]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  const active = songs.find((s) => s.id === activeId) ?? songs[0] ?? null;

  const createSong = useCallback((title?: string) => {
    const song = newSong(title ?? 'Nouvelle chanson');
    setSongs((prev) => [song, ...prev]);
    setActiveId(song.id);
    return song;
  }, []);

  const deleteSong = useCallback(
    (id: string) => {
      setSongs((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeId],
  );

  const updateSong = useCallback((id: string, patch: Partial<Song>) => {
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)));
  }, []);

  const importSongs = useCallback(
    (incoming: Song[]) => {
      setSongs((prev) => {
        const ids = new Set(prev.map((s) => s.id));
        const fresh = incoming.map((s) => {
          let id = s.id;
          while (ids.has(id)) {
            id = `${s.id}-bis-${Math.random().toString(36).slice(2, 6)}`;
          }
          ids.add(id);
          return { ...s, id };
        });
        return [...fresh, ...prev];
      });
      if (incoming[0]) setActiveId(incoming[0].id);
    },
    [],
  );

  return { songs, active, activeId, setActiveId, createSong, deleteSong, updateSong, importSongs };
}
