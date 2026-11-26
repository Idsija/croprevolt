-- Crop Revolt online leaderboard. Run once in the Supabase SQL editor.
-- Players can read the board and add a score; nobody can change or delete rows from the game.

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  run_id      text        not null unique,
  player_name text        not null check (char_length(player_name) between 1 and 16),
  score       integer     not null check (score between 0 and 200000),
  mode        text        not null check (mode in ('standard', 'daily')),
  daily_key   text        check (daily_key ~ '^\d{4}-\d{2}-\d{2}$'),
  heat        smallint    not null default 0 check (heat between 0 and 5),
  victory     boolean     not null default false,
  act         smallint    not null check (act between 1 and 3),
  battles_won smallint    not null check (battles_won between 0 and 200),
  seed        bigint      not null,
  created_at  timestamptz not null default now(),
  -- A daily score must name its day; a standard one must not.
  check ((mode = 'daily') = (daily_key is not null))
);

create index if not exists scores_daily_idx on public.scores (daily_key, score desc) where mode = 'daily';
create index if not exists scores_standard_idx on public.scores (score desc) where mode = 'standard';

alter table public.scores enable row level security;

drop policy if exists "Anyone can read scores" on public.scores;
create policy "Anyone can read scores" on public.scores
  for select to anon using (true);

-- Daily scores can only be posted for today or yesterday (UTC).
drop policy if exists "Anyone can add a score" on public.scores;
create policy "Anyone can add a score" on public.scores
  for insert to anon
  with check (
    mode = 'standard'
    or daily_key::date between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date
  );
