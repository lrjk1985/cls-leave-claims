begin;

-- Server-only: NULL is an invalid session, [] is a valid but empty month.
create function public.cls_team_calendar_month(p_token text, p_first date)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select case when exists (
    select 1 from public.cls_sessions s
    join public.cls_users viewer on viewer.id = s.user_id and viewer.active
    where s.token = p_token and s.expires_at >= extract(epoch from statement_timestamp()) * 1000
  ) then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', r.employee_id, 'name', employee.name,
      'start_date', r.start_date, 'end_date', r.end_date, 'day_portion', r.day_portion,
      'excluded_dates', r.excluded_dates, 'counting_method', r.counting_method,
      'work_schedule_snapshot', r.work_schedule_snapshot
    )), '[]'::jsonb)
    from public.cls_leave_requests r join public.cls_users employee on employee.id = r.employee_id
    where r.status = 'approved' and r.start_date < p_first + interval '1 month' and r.end_date >= p_first
  ) else 'null'::jsonb end
$$;
revoke all on function public.cls_team_calendar_month(text,date) from public, anon, authenticated;
grant execute on function public.cls_team_calendar_month(text,date) to service_role;

commit;
