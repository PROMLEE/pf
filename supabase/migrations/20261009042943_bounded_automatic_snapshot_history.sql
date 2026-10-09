alter table portfolio.snapshots add column archive_capture boolean not null default true;
create index snapshot_events_user_day_bucket_idx on portfolio.snapshot_events(user_id,snapshot_date,bucket_key);
create or replace function portfolio.capture_snapshot_event() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.archive_capture or not exists(
    select 1 from portfolio.snapshot_events e where e.user_id = new.user_id and e.snapshot_date = new.snapshot_date and e.bucket_key = new.bucket_key
  ) then
    insert into portfolio.snapshot_events(user_id,snapshot_date,bucket_key,bucket_name,value_krw,target_percent,position_signature,captured_at)
    values (new.user_id,new.snapshot_date,new.bucket_key,new.bucket_name,new.value_krw,new.target_percent,new.position_signature,new.captured_at)
    on conflict (user_id,bucket_key,captured_at) do update set
      bucket_name=excluded.bucket_name,value_krw=excluded.value_krw,
      target_percent=excluded.target_percent,position_signature=excluded.position_signature;
  end if;
  return new;
end;
$$;
revoke all on function portfolio.capture_snapshot_event() from public, anon, authenticated;
