import { lazy, Suspense, useRef, useState } from 'react';
import { useSongs } from './hooks/useSongs';
import { useSession } from './hooks/useSession';
import { supabase } from './lib/supabase';
import { Login } from './components/Login';
import { transposeContent, respellContent } from './lib/chords';
import { countChords } from './lib/parse';
import { newSolo, respellSolo, transposeSolo } from './lib/solo';
import {
  downloadFile,
  parseBackup,
  parseSongMd,
  serializeBackup,
  serializeSongMd,
  slugify,
} from './lib/songFormat';
import { SongView } from './components/SongView';
import { TransposeBar } from './components/TransposeBar';
import './App.css';

const SoloEditor = lazy(() => import('./components/SoloEditor').then((m) => ({ default: m.SoloEditor })));
const PrintDoc = lazy(() => import('./components/PrintDoc').then((m) => ({ default: m.PrintDoc })));

export default function App() {
  const session = useSession();
  const { songs, active, setActiveId, createSong, deleteSong, updateSong, importSongs } = useSongs();
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [printReady, setPrintReady] = useState(false);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const shiftTranspose = (delta: number) => {
    if (!active) return;
    updateSong(active.id, {
      content: transposeContent(active.content, delta, active.useSharps),
      solos: (active.solos ?? []).map((s) => transposeSolo(s, delta, active.useSharps)),
      transpose: active.transpose + delta,
    });
  };

  const resetTranspose = () => {
    if (!active || active.transpose === 0) return;
    updateSong(active.id, {
      content: transposeContent(active.content, -active.transpose, active.useSharps),
      solos: (active.solos ?? []).map((s) => transposeSolo(s, -active.transpose, active.useSharps)),
      transpose: 0,
    });
  };

  const toggleSpelling = () => {
    if (!active) return;
    const useSharps = !active.useSharps;
    updateSong(active.id, {
      content: respellContent(active.content, useSharps),
      solos: (active.solos ?? []).map((s) => respellSolo(s, useSharps)),
      useSharps,
    });
  };

  // --- export / import ---
  const exportActiveMd = () => {
    if (!active) return;
    downloadFile(`${slugify(active.title)}.md`, serializeSongMd(active), 'text/markdown');
  };

  const exportAllJson = () => {
    downloadFile(`paroles-accords-backup.json`, serializeBackup(songs), 'application/json');
  };

  const handleMdFiles = async (files: FileList | null) => {
    if (!files) return;
    const imported = [];
    for (const f of Array.from(files)) {
      try {
        const text = await f.text();
        const parsed = parseSongMd(text, f.name.replace(/\.md$/i, ''));
        const now = Date.now();
        imported.push({
          id: `import-${now}-${Math.random().toString(36).slice(2, 8)}`,
          title: parsed.title,
          artist: parsed.artist,
          content: parsed.content,
          solos: parsed.solos,
          transpose: 0,
          useSharps: true,
          createdAt: now,
          updatedAt: now,
        });
      } catch (e) {
        alert(`${f.name} : import impossible (${e instanceof Error ? e.message : e})`);
      }
    }
    if (imported.length) importSongs(imported);
  };

  const handleJsonFile = async (files: FileList | null) => {
    if (!files?.[0]) return;
    try {
      const text = await files[0].text();
      const list = parseBackup(text);
      importSongs(list);
    } catch (e) {
      alert(`Import impossible : ${e instanceof Error ? e.message : e}`);
    }
  };

  if (!supabase || session === null) return <Login />;
  if (session === undefined) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Paroles &amp; accords</h1>
          <p>Chargement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1>Paroles &amp; accords</h1>
          <p className="hint">Markdown + <code>[Am]</code></p>
        </div>

        <form
          className="new-song"
          onSubmit={(e) => {
            e.preventDefault();
            createSong(newTitle.trim() || undefined);
            setNewTitle('');
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nouvelle chanson…"
            aria-label="Titre de la nouvelle chanson"
          />
          <button type="submit" className="btn primary">+</button>
        </form>

        <ul className="song-list">
          {songs.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`song-item${active?.id === s.id ? ' active' : ''}`}
                onClick={() => {
                  setActiveId(s.id);
                  setConfirmDelete(null);
                }}
              >
                <span className="song-item-title">{s.title || 'Sans titre'}</span>
                {s.artist && <span className="song-item-artist">{s.artist}</span>}
              </button>
              {confirmDelete === s.id ? (
                <span className="delete-confirm">
                  <button type="button" className="btn danger" onClick={() => deleteSong(s.id)}>
                    Confirmer
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmDelete(null)}>
                    Annuler
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="icon-btn"
                  title={`Supprimer ${s.title}`}
                  onClick={() => setConfirmDelete(s.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
          {songs.length === 0 && <li className="empty">Aucune chanson. Créez-en une !</li>}
        </ul>

        <div className="sidebar-foot">
          <div className="io-row">
            <button type="button" className="btn" onClick={() => mdInputRef.current?.click()}>
              Import .md
            </button>
            <button type="button" className="btn" onClick={exportActiveMd} disabled={!active}>
              Export .md
            </button>
          </div>
          <div className="io-row">
            <button type="button" className="btn" onClick={() => jsonInputRef.current?.click()}>
              Import backup
            </button>
            <button type="button" className="btn" onClick={exportAllJson} disabled={songs.length === 0}>
              Export backup
            </button>
          </div>
          <div className="user-row">
            <span className="user-email" title={session.user.email ?? ''}>
              {session.user.email}
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={() => supabase?.auth.signOut()}
              title="Se déconnecter"
            >
              Déconnexion
            </button>
          </div>
          <input
            ref={mdInputRef}
            type="file"
            accept=".md,.txt"
            multiple
            hidden
            onChange={(e) => {
              void handleMdFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={jsonInputRef}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              void handleJsonFile(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </aside>

      <main className="main">
        {!active ? (
          <div className="no-song">
            <p>Aucune chanson sélectionnée.</p>
            <button type="button" className="btn primary" onClick={() => createSong()}>
              Créer une chanson
            </button>
          </div>
        ) : (
          <>
            <header className="song-head">
              <input
                className="title-input"
                value={active.title}
                onChange={(e) => updateSong(active.id, { title: e.target.value })}
                placeholder="Titre"
                aria-label="Titre"
              />
              <input
                className="artist-input"
                value={active.artist}
                onChange={(e) => updateSong(active.id, { artist: e.target.value })}
                placeholder="Artiste (optionnel)"
                aria-label="Artiste"
              />
            </header>

            <TransposeBar
              transpose={active.transpose}
              useSharps={active.useSharps}
              onShift={shiftTranspose}
              onReset={resetTranspose}
              onToggleSpelling={toggleSpelling}
            />

            <div className="mode-tabs">
              <button
                type="button"
                className={mode === 'edit' ? 'active' : ''}
                onClick={() => setMode('edit')}
              >
                Éditer
              </button>
              <button
                type="button"
                className={mode === 'view' ? 'active' : ''}
                onClick={() => setMode('view')}
              >
                Aperçu
              </button>
              <span className="chord-count">{countChords(active.content)} accords</span>
              <button
                type="button"
                className="btn"
                title="Imprimer ou exporter en PDF (via la boîte de dialogue)"
                onClick={() => {
                  if (!printReady) {
                    alert('Partition en cours de chargement, réessaie dans un instant.');
                    return;
                  }
                  window.print();
                }}
              >
                🖨 Imprimer / PDF
              </button>
            </div>

            {mode === 'edit' ? (
              <div className="edit-grid">
                <textarea
                  className="editor"
                  value={active.content}
                  onChange={(e) => updateSong(active.id, { content: e.target.value })}
                  spellCheck={false}
                  placeholder="[C]Écris tes paroles avec les [G]accords entre crochets…"
                />
                <div className="preview">
                  <SongView content={active.content} />
                </div>
              </div>
            ) : (
              <div className="preview full">
                <SongView content={active.content} />
              </div>
            )}

            <section className="solos-section">
              <div className="solos-head">
                <h2>Solos ({(active.solos ?? []).length})</h2>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    updateSong(active.id, { solos: [...(active.solos ?? []), newSolo(`Solo ${(active.solos ?? []).length + 1}`)] })
                  }
                >
                  + Solo
                </button>
              </div>
              {(active.solos ?? []).map((solo) => (
                <Suspense key={solo.id} fallback={<div className="solo">Chargement de la portée…</div>}>
                  <SoloEditor
                    solo={solo}
                  onChange={(s) =>
                    updateSong(active.id, {
                      solos: (active.solos ?? []).map((x) => (x.id === s.id ? s : x)),
                    })
                  }
                  onDelete={() =>
                    updateSong(active.id, { solos: (active.solos ?? []).filter((x) => x.id !== solo.id) })
                  }
                  />
                </Suspense>
              ))}
            </section>

            <footer className="help">
              <details>
                <summary>Format : comment écrire les accords ?</summary>
                <p>
                  Écris l'accord entre crochets à l'endroit du changement :{' '}
                  <code>[C]Au clair de la [G]lune</code>. Au milieu d'un mot, coupe avec des tirets :{' '}
                  <code>écr-[G]-it</code> s'affiche <em>écrit</em> avec <em>G</em> au-dessus de <em>it</em>.
                  Les <code>[...]</code> avec espace restent du texte normal.
                </p>
              </details>
            </footer>
            <Suspense fallback={null}>
              <PrintDoc song={active} onReady={() => setPrintReady(true)} />
            </Suspense>
          </>
        )}
      </main>
    </div>
  );
}
