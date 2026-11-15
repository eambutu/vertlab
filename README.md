
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
