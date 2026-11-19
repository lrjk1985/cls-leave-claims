begin;
alter table public.cls_leave_requests add column if not exists cancellation_review jsonb;

-- Check again when the row is written, including after waiting for a concurrent reviewer.
create or replace function public.cls_guard_cancellation_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.cancellation_review is distinct from old.cancellation_review then
    if old.status <> 'approved' or new.start_date <= (clock_timestamp() at time zone 'Asia/Singapore')::date then
      raise exception 'Cancellation must be requested and reviewed before the booking starts in Singapore.';
    end if;
    if not coalesce(case new.cancellation_review->>'state'
      when 'pending' then (old.cancellation_review is null or old.cancellation_review->>'state' = 'declined') and new.status = 'approved'
      when 'declined' then old.cancellation_review->>'state' = 'pending' and new.status = 'approved'
      when 'accepted' then old.cancellation_review->>'state' = 'pending' and new.status = 'cancelled'
      else false end, false) then
      raise exception 'Invalid cancellation transition.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists cls_guard_cancellation_review on public.cls_leave_requests;
create trigger cls_guard_cancellation_review before update on public.cls_leave_requests
for each row execute function public.cls_guard_cancellation_review();
commit;
