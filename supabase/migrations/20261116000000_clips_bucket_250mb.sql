-- Phone videos run well past 50 MiB. Raise the clips bucket to 250 MiB.
-- Hosted projects also cap uploads globally (Dashboard → Storage → Settings);
-- that must be raised too, which needs the Pro plan above 50 MB.
update storage.buckets set file_size_limit = 262144000 where id = 'clips';
