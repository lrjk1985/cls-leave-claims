-- Staging only. Run after the prepared migration within BEGIN ... ROLLBACK.
-- Every fixture and setting change must be rolled back, never committed.
insert into public.cls_leave_policy_settings (leave_type, enforcement_enabled)
values ('Medical Leave', true), ('Hospitalization Leave', true)
on conflict (leave_type) do update set enforcement_enabled = excluded.enforcement_enabled;

insert into public.cls_users
  (id, name, email, role, service_start_date, leave_policy_year,
   medical_leave_entitlement_override, medical_leave_balance_adjustment,
   medical_leave_balance_adjustment_year, password_salt, password_hash)
values ('test_fixed_medical_20261117', 'Medical policy test', 'fixed-medical-20261117@example.test',
  'employee', '2026-11-17', 2026, 8, -3, 2026, 'test', 'test');

do $$
declare
  u text := 'test_fixed_medical_20261117';
begin
  -- New joiner, obsolete override ignored, 14 - 3 = 11 usable days.
  insert into public.cls_leave_requests
    (id, employee_id, manager_id, type, start_date, end_date, days, leave_year, status)
  values ('test_fixed_medical_used', u, u, 'Medical Leave', '2026-11-17', '2026-11-30', 10.5, 2026, 'approved');
  insert into public.cls_leave_requests
    (id, employee_id, manager_id, type, start_date, end_date, days, day_portion, leave_year, status)
  values ('test_fixed_medical_half', u, u, 'Medical Leave', '2026-12-01', '2026-12-01', 0.5, 'morning', 2026, 'pending');
  begin
    insert into public.cls_leave_requests
      (id, employee_id, manager_id, type, start_date, end_date, days, leave_year, status)
    values ('test_fixed_medical_excess', u, u, 'Medical Leave', '2026-12-02', '2026-12-02', 1, 2026, 'pending');
    raise exception 'Expected outpatient rejection';
  exception when raise_exception then
    if sqlerrm not like 'CLS_LEAVE_CAP: outpatient%' then raise; end if;
  end;

  -- Approval replaces the pending reservation rather than counting it twice.
  update public.cls_leave_requests set status = 'approved' where id = 'test_fixed_medical_half';
  -- Outpatient corrections also belong to the combined pool: 60 - 3 - 11 = 46.
  insert into public.cls_leave_requests
    (id, employee_id, manager_id, type, start_date, end_date, days, leave_year, status)
  values ('test_fixed_medical_hospital', u, u, 'Hospitalization Leave', '2026-12-02', '2026-12-31', 46, 2026, 'pending');
  begin
    insert into public.cls_leave_requests
      (id, employee_id, manager_id, type, start_date, end_date, days, leave_year, status)
    values ('test_fixed_medical_hospital_excess', u, u, 'Hospitalization Leave', '2026-12-02', '2026-12-02', 1, 2026, 'pending');
    raise exception 'Expected combined rejection';
  exception when raise_exception then
    if sqlerrm not like 'CLS_LEAVE_CAP: combined%' then raise; end if;
  end;

  -- Pending cancellation restores capacity.
  update public.cls_leave_requests set status = 'cancelled' where id = 'test_fixed_medical_hospital';
  insert into public.cls_leave_requests
    (id, employee_id, manager_id, type, start_date, end_date, days, leave_year, status)
  values ('test_fixed_medical_hospital_again', u, u, 'Hospitalization Leave', '2026-12-02', '2026-12-31', 46, 2026, 'pending');

  -- An admin deduction after submission must also be checked at approval.
  update public.cls_users set medical_leave_balance_adjustment = -4 where id = u;
  begin
    update public.cls_leave_requests set status = 'approved' where id = 'test_fixed_medical_hospital_again';
    raise exception 'Expected approval rejection after deduction';
  exception when raise_exception then
    if sqlerrm not like 'CLS_LEAVE_CAP: combined%' then raise; end if;
  end;
  update public.cls_users set medical_leave_balance_adjustment = -3 where id = u;

  -- Year isolation: 2026 usage/deductions must not consume 2027 capacity.
  insert into public.cls_leave_requests
    (id, employee_id, manager_id, type, start_date, end_date, days, leave_year, status)
  values ('test_fixed_medical_next_year', u, u, 'Medical Leave', '2027-01-04', '2027-01-22', 14, 2027, 'pending');
  begin
    insert into public.cls_leave_requests
      (id, employee_id, manager_id, type, start_date, end_date, days, leave_year, status)
    values ('test_fixed_medical_next_excess', u, u, 'Medical Leave', '2027-01-25', '2027-01-25', 1, 2027, 'pending');
    raise exception 'Expected next-year outpatient rejection';
  exception when raise_exception then
    if sqlerrm not like 'CLS_LEAVE_CAP: outpatient%' then raise; end if;
  end;

  -- Existing signed admin credits are preserved too.
  update public.cls_users set medical_leave_balance_adjustment = 1 where id = u;
  insert into public.cls_leave_requests
    (id, employee_id, manager_id, type, start_date, end_date, days, leave_year, status)
  values ('test_fixed_medical_credit', u, u, 'Medical Leave', '2026-12-02', '2026-12-07', 4, 2026, 'pending');
end $$;

select 'fixed medical guard checks passed' as result;
