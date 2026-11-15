-- Clip library + share links. See plans/2-clip-library-and-sharing.md.

create schema if not exists private;

/* ---------------------------------------------------------------- clips */

create table public.clips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  day         date not null,                -- local calendar day, set by the client
  title       text not null default '',     -- original file name (never shown to viewers)
  mode        text not null default 'compare',
  keyframes   jsonb not null default '[]',  -- keyframe times in seconds, sorted
  fps         real,
  duration    real,
  width       int,
  height      int,
  summary     jsonb,                        -- cached result; keyframes are the source of truth
  starred     boolean not null default false,
  poster      text,                         -- small JPEG data URL for list thumbnails
  video_path  text                          -- storage path; null until the upload finishes
);

create index clips_user_day on public.clips (user_id, day desc, created_at desc);

create function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger clips_touch before update on public.clips
  for each row execute function private.touch_updated_at();

/* --------------------------------------------------------------- shares */

create table public.shares (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  token       text not null unique,
  kind        text not null check (kind in ('clip', 'day')),
  day         date,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  check ((kind = 'day') = (day is not null))
);

-- At most one live link per day.
create unique index shares_one_live_day on public.shares (user_id, day)
  where kind = 'day' and revoked_at is null;

create table public.share_clips (
  share_id  uuid not null references public.shares on delete cascade,
  clip_id   uuid not null references public.clips on delete cascade,
  position  int not null,
  primary key (share_id, clip_id)
);

create index share_clips_clip on public.share_clips (clip_id);

-- Tokens are always generated server-side: 10 characters of base62.
create function private.new_share_token() returns text
language plpgsql as $$
declare
  alphabet constant text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  bytes bytea := extensions.gen_random_bytes(10);
  result text := '';
begin
  for i in 0..9 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 62) + 1, 1);
  end loop;
  return result;
end $$;

create function private.set_share_token() returns trigger
language plpgsql as $$
begin
  new.token := private.new_share_token();
  return new;
end $$;

create trigger shares_token before insert on public.shares
  for each row execute function private.set_share_token();

/* ------------------------------------------------------------------ RLS */

alter table public.clips enable row level security;
alter table public.shares enable row level security;
alter table public.share_clips enable row level security;

create policy "own clips" on public.clips for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own shares" on public.shares for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own share clips" on public.share_clips for all to authenticated
  using (exists (
    select 1 from public.shares s
    where s.id = share_id and s.user_id = (select auth.uid())
  ))
  with check (
    exists (select 1 from public.shares s
            where s.id = share_id and s.user_id = (select auth.uid()))
    and exists (select 1 from public.clips c
                where c.id = clip_id and c.user_id = (select auth.uid()))
  );

-- Anonymous visitors never read tables directly; share-view serves them.
revoke all on public.clips, public.shares, public.share_clips from anon;

-- Only the stop-sharing column is writable on a share after it's created.
revoke update on public.shares from authenticated;
grant update (revoked_at) on public.shares to authenticated;

/* --------------------------------------------------- share RPCs (owner) */

-- Live link for one clip, created if needed.
create function public.share_clip(p_clip_id uuid) returns public.shares
language plpgsql security invoker as $$
declare
  s public.shares;
begin
  select sh.* into s
  from public.shares sh
  join public.share_clips sc on sc.share_id = sh.id
  where sh.kind = 'clip' and sh.revoked_at is null and sc.clip_id = p_clip_id
  limit 1;

  if not found then
    insert into public.shares (kind) values ('clip') returning * into s;
    insert into public.share_clips (share_id, clip_id, position) values (s.id, p_clip_id, 0);
  end if;
  return s;
end $$;

-- Live link for a day with exactly these clips, in this order.
create function public.share_day(p_day date, p_clip_ids uuid[]) returns public.shares
language plpgsql security invoker as $$
declare
  s public.shares;
begin
  if coalesce(array_length(p_clip_ids, 1), 0) = 0 then
    raise exception 'A day link needs at least one clip';
  end if;

  select * into s from public.shares
  where kind = 'day' and day = p_day and revoked_at is null
  limit 1;

  if not found then
    insert into public.shares (kind, day) values ('day', p_day) returning * into s;
  end if;

  delete from public.share_clips where share_id = s.id;
  insert into public.share_clips (share_id, clip_id, position)
  select s.id, c.id, c.ord - 1
  from unnest(p_clip_ids) with ordinality as c(id, ord);
  return s;
end $$;

revoke execute on function public.share_clip(uuid), public.share_day(date, uuid[]) from anon, public;
grant execute on function public.share_clip(uuid), public.share_day(date, uuid[]) to authenticated;

/* -------------------------------------------------------------- storage */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', false, 52428800, array['video/*']);

-- Files live under {user_id}/{clip_id}/…
create policy "own clip files: read" on storage.objects for select to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own clip files: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own clip files: replace" on storage.objects for update to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own clip files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
