# VertLab

Vite + React app, deployed on Vercel, backed by Supabase (project ref
`hetzjohsbssvkyqkvgxi`).

## Shipping: merge and deploy freely

The owner wants changes shipped, not parked. Agents working in this repo are
authorized, without asking first, to:

- Open a pull request for finished work and **merge it into `main`** once
  `npm run build` passes.
- **Deploy `main` to Vercel production** after merging (see below).
- Apply new migrations in `supabase/migrations/` to the Supabase project as
  part of the same release, before deploying the app that depends on them.

Still ask first for anything destructive or hard to undo: dropping tables or
columns, deleting data or storage objects, force-pushing `main`, rewriting
history, or changing Vercel or Supabase project settings, domains, or secrets.

## Commands

```bash
npm ci            # install
npm run dev       # dev server (copies MediaPipe WASM into public/ first)
npm run build     # production build into dist/
```

There is no test suite; `npm run build` is the check.

## Deploying

The Vercel project (`vertlab`, team `team_mICgV5YK9UUgIqSx5Bg8iMPs`, project
`prj_VaA7ssqrqCmcWiv91QnbWF5idMz0`) is **not** linked to GitHub, so merging
does not deploy. Deploy from an up-to-date `main` checkout with the CLI:

```bash
VERCEL_ORG_ID=team_mICgV5YK9UUgIqSx5Bg8iMPs \
VERCEL_PROJECT_ID=prj_VaA7ssqrqCmcWiv91QnbWF5idMz0 \
npx -y vercel@68.0.0 deploy --prod --yes --token "$VERCEL_TOKEN"
```

In Claude cloud sessions the token is injected by the network proxy for
`api.vercel.com`; pass a placeholder such as `--token proxyinjected` (no
hyphens). Production env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
live in the Vercel project, and the build runs on Vercel. Production is served
at https://vertlab.vercel.app. After deploying, confirm the deployment reached
`READY`.

## Supabase migrations

Check what is applied, then run any new migration file's SQL, through the
Management API (`api.supabase.com`, personal access token injected by the
proxy in cloud sessions):

```bash
curl -sS -X POST https://api.supabase.com/v1/projects/hetzjohsbssvkyqkvgxi/database/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"select version, name from supabase_migrations.schema_migrations order by version"}'
```

After applying a migration, record it in `supabase_migrations.schema_migrations`
(version and name from the filename) so the list stays accurate.
