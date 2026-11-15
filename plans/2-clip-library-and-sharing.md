# Plan: Clip library + shareable links (Supabase backend)

Design: "Final" section of the VertLab Library canvas (Library, Settings,
Share a jump, Share a day, Shared links, and the three viewer screens).

## Goals

- Every video you analyze is **saved by default**, with its keyframes, mode and
  result. No separate save step. The library groups clips by day.
- Any clip, or a whole day (with some clips left out), can be **shared by link**.
  Anyone with the link can watch without signing in. Links can be stopped at
  any time, and stopping takes effect immediately.

## Phasing

1. **Frontend + local store (this branch).** All UI is built against a
   `ClipStore` interface (`src/app/lib/store/types.ts`). An IndexedDB
   implementation (`local-store.ts`) makes the whole flow work today. Share
   links only resolve in the same browser, which is enough to build and test
   the UI.
2. **Supabase store.** A `supabase-store.ts` that implements the same
   interface, plus the schema, storage bucket and one edge function below. Pick
   the implementation at startup based on whether `VITE_SUPABASE_URL` is set.
3. **Later:** cross-device sign-in, link previews (OG tags), transcoding.

## Identity

- On first launch, call **`supabase.auth.signInAnonymously()`**. Every device
  gets a real `auth.users` row and JWT, so RLS works from the first clip with
  no sign-up screen.
- Later, add "Back up / use on another device". It upgrades the anonymous user
  in place with `updateUser({ email })` (magic link), so `user_id` doesn't change.
- Turn on anonymous sign-ins and CAPTCHA (Turnstile) in Auth settings to limit
  abuse. Run a cron to delete anonymous users that have no clips after 30 days.

## Schema

```sql
create table clips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  created_at   timestamptz not null default now(),
  day          date not null,                 -- local calendar day, computed client-side
  title        text,                          -- original file name
  mode         text not null,                 -- 'compare' | 'approach-jump' | 'depth-jump' | 'ten-five-rsi'
  keyframes    jsonb not null default '[]',   -- [{ "time": 1.2345 }, …] seconds, sorted
  fps          real,
  duration     real,
  width        int,
  height       int,
  summary      jsonb,                         -- cached result: { value, unit, sub, stats[] }
  starred      boolean not null default false,
  video_path   text,                          -- storage path, null until upload finishes
  poster_path  text,
  updated_at   timestamptz not null default now()
);
create index on clips (user_id, day desc, created_at desc);

create table shares (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  token       text not null unique,           -- 10 chars base62, generated server-side
  kind        text not null check (kind in ('clip','day')),
  day         date,                           -- for kind = 'day'
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz                     -- "Stop sharing" sets this
);

create table share_clips (
  share_id  uuid references shares on delete cascade,
  clip_id   uuid references clips  on delete cascade,
  position  int not null,
  primary key (share_id, clip_id)
);
```

- `summary` is computed on the client from `mode` and `keyframes`, using the same
  functions as the analyzer (`src/app/lib/metrics.ts`). It's stored so the
  library and viewer don't need the video to show numbers. The source of truth
  is still the keyframes.
- A day share stores its **explicit list** of clips. A clip recorded later on
  that day is not added to an existing link automatically. That keeps it
  private by default and matches "untick anything you'd rather leave out".
- Deleting a clip cascades out of `share_clips`. A share that ends up with no
  clips shows as "no longer available".

### RLS

All three tables: `using (user_id = auth.uid())` for select/insert/update/delete
(`share_clips` checks through its share). **Anon users get no table access.**
Public viewing goes only through the edge function below.

Token generation is a `before insert` trigger on `shares`
(`encode(gen_random_bytes(8), 'base64')` → base62-ish, retried on conflict), so
clients can't choose tokens.

## Storage

- One **private** bucket, `clips`. Paths: `{user_id}/{clip_id}/video.{ext}` and
  `{user_id}/{clip_id}/poster.jpg`.
- Storage RLS: `(storage.foldername(name))[1] = auth.uid()::text` for all ops.
- Upload with **resumable (TUS) uploads** for videos. Phone slow-mo clips run to
  hundreds of MB. The free plan caps files at 50 MB, so this needs the Pro plan
  with a higher per-file limit, or client-side downscaling later.
- Save order: insert the clip row with keyframes and summary right away. Upload
  the poster (small), then stream the video in the background and set
  `video_path` when it finishes. The library shows the clip immediately, with
  an "Uploading" state until `video_path` is set.

## Public viewing: `share-view` edge function

`GET /functions/v1/share-view?token=…` (no auth, `verify_jwt = false`):

1. Look up the share by token using the service role. Return **404** if it's
   missing or `revoked_at` is set.
2. Load the share's clips in `position` order.
3. Mint **signed URLs** (1 h) for each clip's video and poster.
4. For a single-clip share, also return the newest active **day share** from
   the same owner that includes the clip, for the "Part of Sun, Nov 15" link.
5. Respond with `{ kind, day, clips: [{ id, mode, summary, keyframes, fps,
   duration, width, height, videoUrl, posterUrl, createdAt }], partOf? }`.
   Never return `user_id`, file names or other owner data.

Cache headers: `private, max-age=60`, so a stopped link breaks within a minute
even through caches. Signed URLs expire on their own.

## Client mapping (`ClipStore` → Supabase)

| Method | Supabase |
|---|---|
| `listClips()` | `select … from clips order by day desc, created_at desc` |
| `createClip(file, meta)` | insert row → TUS upload → update `video_path` |
| `updateClip(id, patch)` | update (debounced from the analyzer) |
| `deleteClip(id)` | delete row + `storage.remove([video, poster])` |
| `getVideo(id)` | `createSignedUrl(video_path)`, cached in memory |
| `shareClip(id)` | reuse an active clip share, else insert share + share_clip |
| `shareDay(day, clipIds)` | upsert the active day share, then replace its `share_clips` |
| `stopSharing(shareId)` | `update shares set revoked_at = now()` |
| `listShares()` | active shares joined with their clips |
| `openShare(token)` | `fetch(share-view)` |

Subscriptions: the local store emits change events. The Supabase store can do
the same after each mutation. Realtime isn't needed for one user on one device.

## Hosting & URLs

- Share URLs: `/j/:token` (one jump), `/d/:token` (a day), `/d/:token/:n` (a
  jump inside a shared day). The SPA host needs a catch-all rewrite to
  `index.html`.
- Link previews in iMessage and Slack need OG tags served per token. That
  takes an edge-rendered page (Vercel/Netlify function that calls `share-view`
  and returns the poster as `og:image`). Out of scope for v1.

## Open questions

- Should the analyzer upload the video **before** you start capturing
  keyframes (it's saved even if you leave immediately), or only once a
  keyframe exists? The plan saves on open, since the goal is "store by default".
- Is there a size or length cap per clip? This affects the storage plan and cost.
