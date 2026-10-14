import { useCallback, useEffect, useRef, useState } from 'react';
import { newSong, type Song } from '../types';
import { deleteSongRows, fetchSongs, upsertSongs } from '../lib/songsApi';

const ACTIVE_KEY = 'lyrics-chords:active:v1';
const LEGACY_KEY = 'lyrics-chords:songs:v1';
const INIT_FLAG = 'lyrics-chords:supabase-init:v1';
const SAVE_DELAY = 700;

export type LoadStatus = 'loading' | 'ready' | 'idle' | 'error';
export type SyncState = 'saved' | 'saving' | 'error';

function loadLegacy(): Song[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((s) => s && typeof s.id === 'string' && typeof s.content === 'string')
      .map((s) => ({ ...s, solos: Array.isArray(s.solos) ? s.solos : [] }));
  } catch {
    return [];
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Chansons stockées dans Supabase (table `songs`), avec état local optimiste.
 * - les modifications de contenu sont persistées en différé (anti-frappe au clavier) ;
 * - créations / suppressions / imports sont persistés immédiatement ;
 * - au 1er chargement : migration unique depuis le localStorage, sinon chanson d'exemple.
 * `activeId` (chanson ouverte) reste un simple état d'UI en localStorage.
 */
export function useSongs(userId: string | null) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [sync, setSync] = useState<SyncState>('saved');
  const [error, setError] = useState<string | null>(null);

  const songsRef = useRef(songs);
  const userRef = useRef(userId);
  const dirtyRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Miroirs pour les callbacks async (lus hors rendu uniquement).
  useEffect(() => {
    songsRef.current = songs;
    userRef.current = userId;
  });

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const flush = useCallback(async () => {
    const uid = userRef.current;
    if (!uid || dirtyRef.current.size === 0) return;
    setSync('saving');
    let ids: string[] = [];
    try {
      // Boucle : les chansons salies pendant l'envoi repartent au tour suivant.
      while (dirtyRef.current.size > 0) {
        ids = [...dirtyRef.current];
        dirtyRef.current.clear();
        const snap = songsRef.current.filter((s) => ids.includes(s.id));
        await upsertSongs(uid, snap);
      }
      setError(null);
      setSync('saved');
    } catch (e) {
      for (const id of ids) dirtyRef.current.add(id);
      setError(errMsg(e));
      setSync('error');
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => void flush(), SAVE_DELAY);
  }, [flush]);

  const markDirty = useCallback(
    (ids: string[]) => {
      for (const id of ids) dirtyRef.current.add(id);
      setSync('saving');
      schedule();
    },
    [schedule],
  );

  /** Persistance immédiate (opérations structurelles), avec repli en différé si échec. */
  const persistNow = useCallback(
    async (list: Song[]) => {
      const uid = userRef.current;
      if (!uid) return;
      clearTimer();
      for (const s of list) dirtyRef.current.delete(s.id);
      setSync('saving');
      try {
        await upsertSongs(uid, list);
        setError(null);
        setSync(dirtyRef.current.size > 0 ? 'saving' : 'saved');
        if (dirtyRef.current.size > 0) schedule();
      } catch (e) {
        for (const s of list) dirtyRef.current.add(s.id);
        setError(errMsg(e));
        setSync('error');
      }
    },
    [schedule],
  );

  // ---------- chargement initial + migration ----------
  useEffect(() => {
    if (!userId) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);
    (async () => {
      try {
        let list = await fetchSongs(userId);
        const initialized = localStorage.getItem(INIT_FLAG) === '1';
        if (list.length === 0 && !initialized) {
          const legacy = loadLegacy();
          if (legacy.length > 0) {
            await upsertSongs(userId, legacy);
            list = legacy;
            try {
              localStorage.removeItem(LEGACY_KEY);
            } catch {
              /* stockage indisponible : on garde le legacy, re-migré au prochain chargement */
            }
          } else {
            const seed = newSong('Au clair de la lune');
            await upsertSongs(userId, [seed]);
            list = [seed];
          }
          try {
            localStorage.setItem(INIT_FLAG, '1');
          } catch {
            /* ignore */
          }
        }
        if (cancelled) return;
        setSongs(list);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError(errMsg(e));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // L'activeId ne concerne que l'UI locale.
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  // Sauvegarde best-effort à la fermeture / au démontage (lit les refs : valeurs au moment du démontage).
  useEffect(() => {
    return () => {
      clearTimer();
      const uid = userRef.current;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const ids = [...dirtyRef.current];
      if (uid && ids.length > 0) {
        const snap = songsRef.current.filter((s) => ids.includes(s.id));
        void upsertSongs(uid, snap).catch(() => undefined);
      }
    };
  }, []);

  const active = songs.find((s) => s.id === activeId) ?? songs[0] ?? null;

  const createSong = useCallback(
    (title?: string) => {
      const song = newSong(title ?? 'Nouvelle chanson');
      setSongs((prev) => [song, ...prev]);
      setActiveId(song.id);
      void persistNow([song]);
      return song;
    },
    [persistNow],
  );

  const deleteSong = useCallback((id: string) => {
    const next = songsRef.current.filter((s) => s.id !== id);
    setSongs(next);
    setActiveId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
    dirtyRef.current.delete(id);
    const uid = userRef.current;
    if (uid) {
      setSync('saving');
      deleteSongRows([id])
        .then(() => {
          setError(null);
          setSync(dirtyRef.current.size > 0 ? 'saving' : 'saved');
        })
        .catch((e: unknown) => {
          setError(errMsg(e));
          setSync('error');
        });
    }
  }, []);

  const updateSong = useCallback(
    (id: string, patch: Partial<Song>) => {
      setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)));
      markDirty([id]);
    },
    [markDirty],
  );

  const importSongs = useCallback(
    (incoming: Song[]) => {
      const prev = songsRef.current;
      const ids = new Set(prev.map((s) => s.id));
      const fresh = incoming.map((s) => {
        let id = s.id;
        while (ids.has(id)) {
          id = `${s.id}-bis-${Math.random().toString(36).slice(2, 6)}`;
        }
        ids.add(id);
        return { ...s, id };
      });
      setSongs([...fresh, ...prev]);
      if (fresh[0]) setActiveId(fresh[0].id);
      void persistNow(fresh);
    },
    [persistNow],
  );

  const reload = useCallback(async () => {
    const uid = userRef.current;
    if (!uid) return;
    setStatus('loading');
    setError(null);
    try {
      await flush();
      setSongs(await fetchSongs(uid));
      setStatus('ready');
    } catch (e) {
      setError(errMsg(e));
      setStatus('error');
    }
  }, [flush]);

  const retry = useCallback(() => {
    setError(null);
    void flush();
  }, [flush]);

  return { songs, active, activeId, setActiveId, createSong, deleteSong, updateSong, importSongs, status, sync, error, reload, retry };
}
