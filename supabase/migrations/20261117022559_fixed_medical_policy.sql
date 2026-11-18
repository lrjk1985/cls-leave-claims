-- Preparation only: apply to production only with separate approval.
-- Replaces the guard; does not change any settings or employee/request data.
create or replace function public.cls_assert_leave_entitlement()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_enforcement_enabled boolean := false;
  v_balance_adjustment numeric(7, 2);
  v_outpatient_cap numeric(7, 2);
  v_combined_cap numeric(7, 2);
  v_grant_cap numeric(7, 2);
  v_outpatient_reserved numeric(9, 2) := 0;
  v_combined_reserved numeric(9, 2) := 0;
  v_entitlement_employee text;
  v_entitlement_type text;
  v_entitlement_active boolean;
  v_entitlement_verified boolean;
  v_entitlement_from date;
  v_entitlement_until date;
  v_entitlement_cap numeric(9, 2);
  v_entitlement_reserved numeric(9, 2) := 0;
begin
  select enforcement_enabled
  into v_enforcement_enabled
  from public.cls_leave_policy_settings
  where leave_type = new.type;

  if not coalesce(v_enforcement_enabled, false)
    or new.status not in ('pending', 'approved') then
    return new;
  end if;

  if new.type in ('Medical Leave', 'Hospitalization Leave') then
    select case
      when coalesce(medical_leave_balance_adjustment_year, leave_policy_year) = new.leave_year
      then coalesce(medical_leave_balance_adjustment, 0)
      else 0
    end
    into v_balance_adjustment
    from public.cls_users
    where id = new.employee_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'CLS_LEAVE_CAP: employee was not found';
    end if;

    -- Full company allowance from day one; obsolete outpatient overrides are ignored.
    v_outpatient_cap := 14;
    v_combined_cap := 60;

    select coalesce(override_days, base_days)
    into v_grant_cap
    from public.cls_leave_entitlements
    where employee_id = new.employee_id
      and leave_type = 'Hospitalization Leave'
      and period_kind = 'annual'
      and period_year = new.leave_year
      and active
      and valid_from <= new.start_date
      and (valid_until is null or valid_until >= new.end_date)
    for update;

    if found then
      v_combined_cap := v_grant_cap;
    end if;

    -- A medical balance correction affects both pools, once and in its own year.
    v_outpatient_cap := v_outpatient_cap + v_balance_adjustment;
    v_combined_cap := v_combined_cap + v_balance_adjustment;

    select
      coalesce(sum(days) filter (where type = 'Medical Leave'), 0),
      coalesce(sum(days) filter (where type in ('Medical Leave', 'Hospitalization Leave')), 0)
    into v_outpatient_reserved, v_combined_reserved
    from public.cls_leave_requests
    where employee_id = new.employee_id
      and leave_year = new.leave_year
      and status in ('pending', 'approved')
      and id is distinct from new.id;

    if new.type = 'Medical Leave' then
      v_outpatient_reserved := v_outpatient_reserved + new.days;
    end if;
    v_combined_reserved := v_combined_reserved + new.days;

    if new.type = 'Medical Leave' and v_outpatient_reserved > v_outpatient_cap then
      raise exception using
        errcode = 'P0001',
        message = format(
          'CLS_LEAVE_CAP: outpatient Medical Leave cap exceeded (%s of %s days)',
          v_outpatient_reserved,
          v_outpatient_cap
        );
    end if;

    if v_combined_reserved > v_combined_cap then
      raise exception using
        errcode = 'P0001',
        message = format(
          'CLS_LEAVE_CAP: combined Medical and Hospitalization cap exceeded (%s of %s days)',
          v_combined_reserved,
          v_combined_cap
        );
    end if;

    return new;
  end if;

  if new.type = 'National Service Leave' then
    return new;
  end if;

  if new.entitlement_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'CLS_LEAVE_CAP: an active leave entitlement is required';
  end if;

  select
    employee_id,
    leave_type,
    active,
    eligibility_verified,
    valid_from,
    valid_until,
    coalesce(override_days, base_days)
  into
    v_entitlement_employee,
    v_entitlement_type,
    v_entitlement_active,
    v_entitlement_verified,
    v_entitlement_from,
    v_entitlement_until,
    v_entitlement_cap
  from public.cls_leave_entitlements
  where id = new.entitlement_id
  for update;

  if not found
    or v_entitlement_employee <> new.employee_id
    or v_entitlement_type <> new.type
    or not v_entitlement_active
    or new.start_date < v_entitlement_from
    or (v_entitlement_until is not null and new.end_date > v_entitlement_until) then
    raise exception using
      errcode = 'P0001',
      message = 'CLS_LEAVE_CAP: linked leave entitlement is invalid or inactive';
  end if;

  if new.type in ('Paternity Leave', 'Maternity Leave', 'Childcare Leave')
    and not v_entitlement_verified then
    raise exception using
      errcode = 'P0001',
      message = 'CLS_LEAVE_CAP: linked leave entitlement eligibility is not verified';
  end if;

  if new.type = 'Maternity Leave' then
    if new.start_date <> v_entitlement_from
      or v_entitlement_until is null
      or new.end_date <> v_entitlement_until then
      raise exception using
        errcode = 'P0001',
        message = 'CLS_LEAVE_CAP: Maternity Leave request must match the approved grant period';
    end if;

    select count(*)
    into v_entitlement_reserved
    from public.cls_leave_requests
    where entitlement_id = new.entitlement_id
      and status in ('pending', 'approved')
      and id is distinct from new.id;

    if v_entitlement_reserved > 0 then
      raise exception using
        errcode = 'P0001',
        message = 'CLS_LEAVE_CAP: Maternity Leave entitlement already has an active request';
    end if;
  end if;

  select
    v_entitlement_cap
      + coalesce((
        select sum(days)
        from public.cls_leave_entitlement_adjustments
        where entitlement_id = new.entitlement_id
      ), 0),
    coalesce(sum(days), 0)
  into v_entitlement_cap, v_entitlement_reserved
  from public.cls_leave_requests
  where entitlement_id = new.entitlement_id
    and status in ('pending', 'approved')
    and id is distinct from new.id;

  v_entitlement_reserved := v_entitlement_reserved + new.days;
  if v_entitlement_reserved > v_entitlement_cap then
    raise exception using
      errcode = 'P0001',
      message = format(
        'CLS_LEAVE_CAP: %s entitlement exceeded (%s of %s days)',
        new.type,
        v_entitlement_reserved,
        v_entitlement_cap
      );
  end if;

  return new;
end;
$$;

revoke all on function public.cls_assert_leave_entitlement() from public, anon, authenticated;
grant execute on function public.cls_assert_leave_entitlement() to service_role;
