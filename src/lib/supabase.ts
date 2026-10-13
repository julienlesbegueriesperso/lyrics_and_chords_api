import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Nouvelle clé `sb_publishable_...` (prioritaire), repli sur l'ancien JWT `anon`.
const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

/**
 * Client Supabase Auth. La clé publishable/anon est publique par conception (les secrets
 * restent côté Supabase) ; les mots de passe sont hashés serveur, jamais dans le bundle.
 * `null` si les variables d'environnement sont absentes (l'UI affiche alors l'aide de config).
 */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** Inscription publique désactivée par défaut (usage perso) : VITE_ALLOW_SIGNUP=true pour l'activer. */
export const allowSignup = (import.meta.env.VITE_ALLOW_SIGNUP as string | undefined) === 'true';
