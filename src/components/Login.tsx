import { useState } from 'react';
import { allowSignup, supabase } from '../lib/supabase';

function friendlyError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Email ou mot de passe incorrect.';
  if (/email not confirmed/i.test(message)) return 'Email non confirmé : clique sur le lien reçu par mail.';
  if (/user already registered/i.test(message)) return 'Un compte existe déjà avec cet email.';
  if (/password.*short|weak/i.test(message)) return 'Mot de passe trop faible (8 caractères minimum conseillés).';
  return message;
}

/** Écran de connexion. Rendu uniquement si une session est absente. */
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const client = supabase;

  if (!client) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Paroles &amp; accords</h1>
          <p>Authentification non configurée. En local, crée un fichier <code>.env</code> :</p>
          <pre>{`VITE_SUPABASE_URL=https://xxx.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}</pre>
          <p>Puis redémarre avec <code>pnpm dev</code>. Vois le README (section Déploiement).</p>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await client.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setSent(true);
      }
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>Paroles &amp; accords</h1>
        <p className="auth-sub">{mode === 'login' ? 'Connecte-toi pour accéder à tes chansons.' : 'Crée ton compte.'}</p>
        {sent && mode === 'signup' && (
          <p className="auth-ok">Compte créé ! Vérifie ta boîte mail pour confirmer, puis connecte-toi.</p>
        )}
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="toi@exemple.fr"
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8 caractères minimum"
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" className="btn primary auth-submit" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
        </button>
        {allowSignup && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
              setSent(false);
            }}
          >
            {mode === 'login' ? "Pas de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
          </button>
        )}
      </form>
    </div>
  );
}
