# Paroles & accords

Webapp React (Vite + pnpm) : paroles avec accords au-dessus du texte (`[Am]` inline),
éditeur de solos en notation (VexFlow, clé de sol), transposition globale,
export/import `.md` + backup `.json`, impression / PDF, authentification Supabase.

## Dev local

```sh
pnpm install
cp .env.example .env   # renseigne VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
pnpm dev
```

Sans `.env`, l'app affiche l'aide de configuration au lieu du formulaire de connexion.

## Authentification (Supabase Auth, email + mot de passe)

1. Crée un projet sur https://supabase.com → **Project Settings → Data API** : récupère
   `Project URL` et la clé publishable `sb_publishable_...`.
2. **Authentication → Users → Add user** : crée ton compte (email + mot de passe).
   L'inscription publique depuis l'app est désactivée par défaut
   (`VITE_ALLOW_SIGNUP=true` pour l'activer).
3. **SQL Editor → New query** : exécute le contenu de `supabase/songs.sql`
   (table `songs` + RLS : chaque utilisateur ne voit que ses chansons).
4. Renseigne `.env` (local) et les variables d'environnement sur Vercel (prod).

Notes de sécurité :
- Les mots de passe sont hashés côté Supabase, jamais dans le bundle ; la clé
  publishable est publique par conception. HTTPS fourni par Vercel.
- L'authentification verrouille l'accès à l'outil ; les chansons sont
  stockées dans Supabase (table `songs`, RLS par utilisateur), plus
  dans le `localStorage` (sauf la chanson ouverte, simple état d'UI).
  Au premier chargement, les chansons du `localStorage` sont migrées
  automatiquement vers Supabase.

## Déploiement Vercel

1. Push le repo sur GitHub, importe-le dans Vercel (preset Vite détecté : `pnpm build`, `dist`).
2. **Settings → Environment Variables** : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (+ `VITE_ALLOW_SIGNUP` si besoin), puis **Redeploy**.
3. `vercel.json` inclus : fallback SPA + en-têtes de sécurité de base.

## Format `.md`

Frontmatter `title` / `artist`, corps Markdown + accords `[C]`, solos en blocs
````md
```solo "Intro" key=G time=4/4 mpl=4
q:G4 q:A4 | h:B4 q:R
```
````
