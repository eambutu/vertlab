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

1. **Frontend + local store (done).** All UI is built against a `ClipStore`
   interface (`src/app/lib/store/types.ts`). An IndexedDB implementation
   (`local-store.ts`) is used when Supabase isn't configured. Share links then
   only open in the same browser.
2. **Supabase store (done).** `supabase-store.ts` implements the same
   interface. The schema, RLS, bucket and RPCs are in
   `supabase/migrations/`, and the public lookup is `supabase/functions/share-view`.
   The app uses Supabase whenever `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` are set.
3. **Later:** cross-device sign-in, link previews (OG tags), resumable (TUS)
   uploads, transcoding.

## Identity

- **Email + password accounts** (Supabase Auth). The library, clip and
  settings screens require sign-in; share links (`/j`, `/d`) stay public.
- New accounts must **confirm their email** before signing in. The link
  returns to the app's origin, and supabase-js picks the session out of the URL.
- Passwords need at least 8 characters. There's no password reset screen yet.
- **Email delivery:** Supabase's built-in sender only delivers to members of
  the Supabase organization, and only a few emails per hour. Before other
  people sign up, set up custom SMTP (e.g. Resend) under Authentication → SMTP
  Settings.
- Anonymous sign-ins (used by an earlier build) are off. Any leftover
  anonymous session is signed out on load.

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
  summary      jsonb,                         -- cached result: { value, kind, sub, stats[] }
  starred      boolean not null default false,
  poster       text,                          -- ~10-20 KB JPEG data URL (240 px wide)
  video_path   text,                          -- storage path, null until upload finishes
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

- One **private** bucket, `clips`. Path: `{user_id}/{clip_id}/video.{ext}`.
  Posters are small enough to live in the `clips` row, so the library needs
  no signed URLs to draw thumbnails.
- Storage RLS: `(storage.foldername(name))[1] = auth.uid()::text` for all ops.
- Upload with **resumable (TUS) uploads** for videos. Phone slow-mo clips run to
  hundreds of MB. The free plan caps files at 50 MB, so this needs the Pro plan
  with a higher per-file limit, or client-side downscaling later.
- Save order: insert the clip row right away and open the analyzer on the
  local file. Upload the video in the background and set `video_path` when it
  finishes. The library shows "Uploading video…" until then. v1 uses a
  standard upload; switch to TUS for big files.

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
| `shareClip(id)` | `rpc('share_clip')`: reuse the live link or create one |
| `shareDay(day, clipIds)` | `rpc('share_day')`: upsert the live day link and replace its clips |
| `stopSharing(shareId)` | `update shares set revoked_at = now()` |
| `listShares()` | active shares joined with their clips |
| `openShare(token)` | `fetch(share-view)` |

Subscriptions: the local store emits change events. The Supabase store can do
the same after each mutation. Realtime isn't needed for one user on one device.

## Hosting & URLs

Live at **https://vertlab.vercel.app** (Vercel project `vertlab`, deployed
from this folder with `npx vercel@latest deploy --prod`). `vercel.json` builds
with Vite and rewrites every path to `index.html`. Production and preview
both have `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the anon key is
public by design. Supabase's site URL and redirect list include the live URL
and localhost.


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

## Running it

### Local stack (needs Docker)

```bash
npx supabase@2.20.12 start          # Postgres, auth, storage, edge runtime
cp supabase/functions/.env.example supabase/functions/.env
npx supabase@2.20.12 functions serve # serves share-view with hot reload
```

Put the printed `API URL` and `anon key` in `.env.local` as
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, then `npm run dev`. Studio
at http://127.0.0.1:54323 shows the tables and bucket.

### Cloud project

The current dev project is `vertlab` (ref `hetzjohsbssvkyqkvgxi`, us-east-1,
free plan, so uploads are capped at 50 MB per file). Its email + password
settings, site URL and redirect URLs are already configured from `supabase/config.toml`;
the database password is in `.env.local`. To set up another project:

```bash
npx supabase@2.20.12 login
npx supabase@2.20.12 link --project-ref <ref>
npx supabase@2.20.12 db push
npx supabase@2.20.12 functions deploy share-view --no-verify-jwt
```

In the dashboard: Authentication → Sign In / Providers → make sure
**Email** is on with "Confirm email" enabled (or run `config push`), and raise Storage's global file size limit if clips
can exceed 50 MB. Set the project URL and anon key in the hosting
environment's `VITE_SUPABASE_*` variables, and add the site's URL under
Authentication → URL Configuration. `PUBLIC_SUPABASE_URL` is only needed
locally.
