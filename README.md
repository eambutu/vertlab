
  # VertLab

  This is a code bundle for VertLab. The original project is available at https://www.figma.com/design/ldooHI8AiZcFwbPkxqJ1Tc/VertLab.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.
  
  ## Clip library and share links

  Clips are saved to Supabase when `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` are set in `.env.local` (see `.env.example`).
  Without them, everything stays in this browser and share links only open here.

  The schema, storage rules and the public `share-view` function live in
  `supabase/`. Setup, deploy steps and design notes are in
  `plans/2-clip-library-and-sharing.md`.

  ## Upload and playback diagnostics

  Reproduce the issue, then choose **Send error report** on the video error
  screen or under **Settings → Diagnostics**. When signed in, the app saves
  the latest 300 upload, playback, and app events to Supabase and shows a report ID.
  Give that ID to the person or agent helping you. The diagnostics include
  timestamps, browser information, clip and attempt IDs, analysis mode changes,
  and the compiled file and position of a screen-rendering error. They exclude
  videos, filenames, account details, and share or signed URLs.

  To retrieve a report, use an authorized connection to the VertLab Supabase
  project and query `public.error_reports` by its UUID, selecting
  `id`, `created_at`, and `diagnostics`. Signed-in users can read their own
  reports through Supabase Auth. For agents, a database administrator can
  grant the `vertlab_report_reader` role to a dedicated database login and
  configure that connection securely in the agent environment. The role
  can read report IDs, timestamps, and diagnostics. Apply the database
  migrations before releasing the app.
