-- Total size and count of the signed-in user's clip videos, for Settings.
-- Security invoker: the storage.objects policies already limit rows to the
-- caller's own folder, and the folder filter below says so explicitly.
create or replace function public.storage_usage()
returns table (bytes bigint, videos bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
    count(*)::bigint
  from storage.objects o
  where o.bucket_id = 'clips'
    and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;

revoke execute on function public.storage_usage() from anon, public;
grant execute on function public.storage_usage() to authenticated;
