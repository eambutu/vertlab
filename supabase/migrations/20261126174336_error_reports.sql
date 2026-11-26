create table public.error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  diagnostics jsonb not null,
  constraint error_report_size check (octet_length(diagnostics::text) <= 262144),
  constraint error_report_shape check (
    jsonb_typeof(diagnostics) = 'object'
    and coalesce(diagnostics->'version' = '1'::jsonb, false)
    and coalesce(jsonb_typeof(diagnostics->'browser') = 'string', false)
    and case when jsonb_typeof(diagnostics->'events') = 'array'
      then jsonb_array_length(diagnostics->'events') <= 300
      else false
    end
  )
);

alter table public.error_reports enable row level security;
revoke all on public.error_reports from anon, authenticated, service_role;
grant insert (diagnostics), select on public.error_reports to authenticated;
grant select on public.error_reports to service_role;

create policy "Submit own error reports" on public.error_reports
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "Read own error reports" on public.error_reports
  for select to authenticated using (user_id = (select auth.uid()));

-- A database administrator can grant this role to a dedicated support login.
do $$
begin
  if not exists (select from pg_roles where rolname = 'vertlab_report_reader') then
    create role vertlab_report_reader nologin;
  end if;
end
$$;
grant usage on schema public to vertlab_report_reader;
grant select (id, created_at, diagnostics) on public.error_reports to vertlab_report_reader;

create policy "Read reports for support" on public.error_reports
  for select to vertlab_report_reader using (true);
