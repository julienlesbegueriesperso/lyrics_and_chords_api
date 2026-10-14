-- Stockage des chansons / projets (remplace le localStorage).
-- À exécuter une fois dans le dashboard Supabase : SQL Editor → New query → Run.
--
-- Modèle : une ligne = une chanson, payload JSON complet dans `data`
-- (titre, artiste, contenu markdown, solos, transposition...).
-- L'accès est cloisonné par utilisateur via RLS (user_id = auth.uid()).

create table if not exists public.songs (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists songs_user_created_idx
  on public.songs (user_id, created_at desc);

alter table public.songs enable row level security;

drop policy if exists "songs_select_own" on public.songs;
create policy "songs_select_own"
  on public.songs for select
  using (auth.uid() = user_id);

drop policy if exists "songs_insert_own" on public.songs;
create policy "songs_insert_own"
  on public.songs for insert
  with check (auth.uid() = user_id);

drop policy if exists "songs_update_own" on public.songs;
create policy "songs_update_own"
  on public.songs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "songs_delete_own" on public.songs;
create policy "songs_delete_own"
  on public.songs for delete
  using (auth.uid() = user_id);

-- Maintient updated_at à jour à chaque modification.
create or replace function public.songs_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists songs_touch_updated_at on public.songs;
create trigger songs_touch_updated_at
  before update on public.songs
  for each row execute function public.songs_touch_updated_at();
