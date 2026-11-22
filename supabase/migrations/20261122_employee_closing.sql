-- Fechamento por funcionario: um funcionario pode ter o periodo fechado antes (ou independente) do
-- fechamento da empresa. O fechamento da empresa fecha os que faltam; a reabertura da empresa so desfaz
-- os que ela fechou. Lotes do banco de horas sao gerados no fechamento de cada funcionario.

create table public.employee_closures (
  company_id uuid not null references public.companies(id),
  cpf text not null,
  start_date date not null,
  end_date date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid,
  closed_cpf text,
  primary key (company_id, cpf, start_date));
alter table public.employee_closures enable row level security;
revoke all on public.employee_closures from anon, authenticated;

-- Periodo aberto para um funcionario (p_cpf) ou, sem CPF, para a empresa inteira (nenhum fechado).
create or replace function public.rep_assert_open(p_company uuid, p_from date, p_to date, p_cpf text)
returns void language plpgsql stable security definer set search_path to '' as $$
begin
  if exists (select 1 from public.closed_periods c where c.company_id = p_company
             and c.start_date <= p_to and c.end_date >= p_from) then
    raise exception 'period_closed';
  end if;
  if exists (select 1 from public.employee_closures e where e.company_id = p_company
             and (p_cpf is null or e.cpf = p_cpf) and e.start_date <= p_to and e.end_date >= p_from) then
    raise exception 'period_closed';
  end if;
end $$;

create or replace function public.rep_assert_open(p_company uuid, p_from date, p_to date)
returns void language sql stable security definer set search_path to '' as $$
  select public.rep_assert_open(p_company, p_from, p_to, null::text)
$$;

-- Lotes do periodo: opcionalmente de um so funcionario.
create or replace function public.rep_bank_lots_from_period(p_company uuid, p_start date, p_actor text, p_cpf text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_months int := (select bank_expiry_months from public.companies where id = p_company);
  r record;
begin
  for r in select t.cpf, t.day, t.bank_delta, coalesce((t.data->>'bonus')::int, 0) as bonus,
                  nullif(t.data->>'pct', '')::smallint as pct
           from public.timesheet_days t
           where t.company_id = p_company and t.period_start = p_start and (p_cpf is null or t.cpf = p_cpf)
             and not exists (select 1 from public.bank_lots l where l.company_id = p_company
                             and l.cpf = t.cpf and l.period_start = p_start)
           order by t.cpf, t.day loop
    if r.bank_delta - r.bonus <> 0 then
      insert into public.bank_lots (company_id, cpf, lot_date, origin, minutes, pct, expires_on, period_start, created_by)
        values (p_company, r.cpf, r.day, 'dia', r.bank_delta - r.bonus, r.pct,
                (r.day + make_interval(months => v_months))::date, p_start, p_actor);
    end if;
    if r.bonus > 0 then
      insert into public.bank_lots (company_id, cpf, lot_date, origin, minutes, pct, expires_on, period_start, created_by)
        values (p_company, r.cpf, r.day, 'bonus', r.bonus, r.pct,
                (r.day + make_interval(months => v_months))::date, p_start, p_actor);
    end if;
  end loop;
  for r in select distinct cpf from public.bank_lots
           where company_id = p_company and period_start = p_start and (p_cpf is null or cpf = p_cpf) loop
    perform public.rep_bank_rebuild(p_company, r.cpf);
  end loop;
end $$;

create or replace function public.rep_bank_lots_from_period(p_company uuid, p_start date, p_actor text)
returns void language sql security definer set search_path to '' as $$
  select public.rep_bank_lots_from_period(p_company, p_start, p_actor, null::text)
$$;

-- Fechamento da empresa: grava so os funcionarios ainda nao fechados individualmente.
create or replace function public.rep_period_close(p_user uuid, p_start date, p_end date, p_days jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid;
  v_cpf text := (public.rep_portal_user_cpf(p_user)).cpf;
  v_tz text;
  r record;
begin
  select company_id into v_company from public.portal_users where user_id = p_user;
  if v_company is null then raise exception 'not_allowed'; end if;
  if length(coalesce(v_cpf, '')) <> 11 then raise exception 'cpf_required'; end if;
  select * into r from public.rep_period_of(v_company, p_start);
  if r.start_date <> p_start or r.end_date <> p_end then raise exception 'invalid_period'; end if;
  v_tz := (select timezone from public.companies where id = v_company);
  if p_end > (now() at time zone v_tz)::date then raise exception 'period_not_finished'; end if;
  if exists (select 1 from public.closed_periods where company_id = v_company
             and start_date <= p_end and end_date >= p_start) then
    raise exception 'period_closed';
  end if;
  if exists (select 1 from public.closed_periods where company_id = v_company and start_date > p_end)
     or exists (select 1 from public.employee_closures where company_id = v_company and start_date > p_end) then
    raise exception 'period_closed';
  end if;

  insert into public.timesheet_days (company_id, cpf, day, period_start, schedule_code, expected, worked,
                                     night, balance, bank_delta, flags, data)
  select v_company, d->>'cpf', (d->>'date')::date, p_start, coalesce(d->>'schedule_code', ''),
         (d->>'expected')::int, (d->>'worked')::int, (d->>'night')::int, (d->>'balance')::int,
         (d->>'bank_delta')::int,
         coalesce(array(select jsonb_array_elements_text(d->'flags')), '{}'), d
  from jsonb_array_elements(p_days) d
  where (d->>'date')::date between p_start and p_end
    and not exists (select 1 from public.employee_closures e where e.company_id = v_company
                    and e.cpf = d->>'cpf' and e.start_date = p_start);

  insert into public.closed_periods (company_id, start_date, end_date, closed_by, closed_cpf)
    values (v_company, p_start, p_end, p_user, v_cpf);
  perform public.rep_bank_lots_from_period(v_company, p_start, v_cpf, null::text);
  insert into public.audit_log (actor, action, detail)
    values ('portal:' || coalesce((select email from auth.users where id = p_user), p_user::text),
            'periodo_fechado', jsonb_build_object('start', p_start, 'end', p_end,
                                                  'days', jsonb_array_length(p_days)));
end $$;

-- Fechamento de um funcionario. O periodo precisa ter terminado, ou o funcionario ja ter sido desligado.
create or replace function public.rep_employee_close(p_user uuid, p_cpf text, p_start date, p_end date, p_days jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid;
  v_actor text := (public.rep_portal_user_cpf(p_user)).cpf;
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_today date;
  v_dismissed date;
  r record;
  prev record;
begin
  select company_id into v_company from public.portal_users where user_id = p_user;
  if v_company is null then raise exception 'not_allowed'; end if;
  if length(coalesce(v_actor, '')) <> 11 then raise exception 'cpf_required'; end if;
  select dismissed_on into v_dismissed from public.employees where company_id = v_company and cpf = v_cpf;
  if not found then raise exception 'not_found'; end if;
  select * into r from public.rep_period_of(v_company, p_start);
  if r.start_date <> p_start or r.end_date <> p_end then raise exception 'invalid_period'; end if;
  v_today := (now() at time zone (select timezone from public.companies where id = v_company))::date;
  if p_end > v_today and (v_dismissed is null or v_dismissed > v_today) then
    raise exception 'period_not_finished';
  end if;
  perform 1 from public.companies where id = v_company for update;
  if exists (select 1 from public.closed_periods where company_id = v_company
             and start_date <= p_end and end_date >= p_start)
     or exists (select 1 from public.employee_closures where company_id = v_company and cpf = v_cpf
                and start_date = p_start) then
    raise exception 'period_closed';
  end if;
  if exists (select 1 from public.closed_periods where company_id = v_company and start_date > p_end)
     or exists (select 1 from public.employee_closures where company_id = v_company and cpf = v_cpf
                and start_date > p_end) then
    raise exception 'period_closed';
  end if;
  -- O periodo anterior precisa estar fechado, se ja houve algum fechamento antes deste.
  if exists (select 1 from public.closed_periods where company_id = v_company and start_date < p_start)
     or exists (select 1 from public.employee_closures where company_id = v_company and cpf = v_cpf
                and start_date < p_start) then
    select * into prev from public.rep_period_of(v_company, p_start - 1);
    if not exists (select 1 from public.closed_periods where company_id = v_company and start_date = prev.start_date)
       and not exists (select 1 from public.employee_closures where company_id = v_company and cpf = v_cpf
                       and start_date = prev.start_date) then
      raise exception 'previous_open';
    end if;
  end if;

  insert into public.timesheet_days (company_id, cpf, day, period_start, schedule_code, expected, worked,
                                     night, balance, bank_delta, flags, data)
  select v_company, v_cpf, (d->>'date')::date, p_start, coalesce(d->>'schedule_code', ''),
         (d->>'expected')::int, (d->>'worked')::int, (d->>'night')::int, (d->>'balance')::int,
         (d->>'bank_delta')::int,
         coalesce(array(select jsonb_array_elements_text(d->'flags')), '{}'), d
  from jsonb_array_elements(p_days) d
  where d->>'cpf' = v_cpf and (d->>'date')::date between p_start and p_end;

  insert into public.employee_closures (company_id, cpf, start_date, end_date, closed_by, closed_cpf)
    values (v_company, v_cpf, p_start, p_end, p_user, v_actor);
  perform public.rep_bank_lots_from_period(v_company, p_start, v_actor, v_cpf);
  insert into public.audit_log (actor, action, detail)
    values ('portal:' || coalesce((select email from auth.users where id = p_user), p_user::text),
            'funcionario_fechado', jsonb_build_object('cpf', v_cpf, 'start', p_start, 'end', p_end));
end $$;

create or replace function public.portal_employee_reopen(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
  v_cpf text := regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g');
  v_start date := (p->>'start')::date;
  v_reason text := public.rep_check_reason(p->>'reason');
  e public.employee_closures%rowtype;
begin
  select * into e from public.employee_closures where company_id = v_company and cpf = v_cpf and start_date = v_start;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.closed_periods where company_id = v_company and start_date = v_start) then
    raise exception 'company_closed';
  end if;
  if exists (select 1 from public.employee_closures where company_id = v_company and cpf = v_cpf
             and start_date > v_start)
     or exists (select 1 from public.closed_periods where company_id = v_company and start_date > v_start) then
    raise exception 'not_latest';
  end if;
  if exists (select 1 from public.bank_settlements s where s.company_id = v_company and s.cpf = v_cpf
             and s.revoked_at is null and s.created_at > e.closed_at) then
    raise exception 'settled_after_close';
  end if;
  perform set_config('rep.lot_delete', 'on', true);
  delete from public.bank_lots where company_id = v_company and cpf = v_cpf and period_start = v_start;
  perform set_config('rep.lot_delete', 'off', true);
  perform public.rep_bank_rebuild(v_company, v_cpf);
  delete from public.timesheet_days where company_id = v_company and cpf = v_cpf and period_start = v_start;
  delete from public.employee_closures where company_id = v_company and cpf = v_cpf and start_date = v_start;
  perform public.portal_audit('funcionario_reaberto', jsonb_build_object('cpf', v_cpf, 'start', v_start,
                                                                         'motivo', v_reason));
end $$;

-- Reabertura da empresa: desfaz so quem foi fechado pela empresa; os fechados individualmente continuam.
create or replace function public.portal_period_reopen(p_start date, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
  v_reason text := public.rep_check_reason(p_reason);
  v_end date;
  v_closed timestamptz;
  r record;
begin
  select end_date, closed_at into v_end, v_closed from public.closed_periods
    where company_id = v_company and start_date = p_start;
  if v_end is null then raise exception 'not_found'; end if;
  if exists (select 1 from public.closed_periods where company_id = v_company and start_date > p_start)
     or exists (select 1 from public.employee_closures where company_id = v_company and start_date > p_start) then
    raise exception 'not_latest';
  end if;
  if exists (select 1 from public.bank_settlements s
             where s.company_id = v_company and s.revoked_at is null and s.created_at > v_closed
               and s.cpf in (select l.cpf from public.bank_lots l where l.company_id = v_company
                             and l.period_start = p_start
                             and not exists (select 1 from public.employee_closures e where e.company_id = v_company
                                             and e.cpf = l.cpf and e.start_date = p_start))) then
    raise exception 'settled_after_close';
  end if;
  perform set_config('rep.lot_delete', 'on', true);
  delete from public.bank_lots l where l.company_id = v_company and l.period_start = p_start
    and not exists (select 1 from public.employee_closures e where e.company_id = v_company
                    and e.cpf = l.cpf and e.start_date = p_start);
  perform set_config('rep.lot_delete', 'off', true);
  for r in select distinct t.cpf from public.timesheet_days t where t.company_id = v_company and t.period_start = p_start
             and not exists (select 1 from public.employee_closures e where e.company_id = v_company
                             and e.cpf = t.cpf and e.start_date = p_start) loop
    perform public.rep_bank_rebuild(v_company, r.cpf);
  end loop;
  delete from public.timesheet_days t where t.company_id = v_company and t.period_start = p_start
    and not exists (select 1 from public.employee_closures e where e.company_id = v_company
                    and e.cpf = t.cpf and e.start_date = p_start);
  delete from public.closed_periods where company_id = v_company and start_date = p_start;
  perform public.portal_audit('periodo_reaberto', jsonb_build_object('start', p_start, 'end', v_end,
                                                                     'motivo', v_reason));
end $$;

-- Lista dos fechamentos individuais de um periodo.
create or replace function public.portal_employee_closures(p_start date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('cpf', e.cpf, 'closed_at', e.closed_at,
      'closed_cpf', e.closed_cpf, 'closed_by', (select email from auth.users where id = e.closed_by)))
    from public.employee_closures e where e.company_id = v_company and e.start_date = p_start), '[]'::jsonb);
end $$;

-- Tratamento: ajustes passam a conferir o fechamento do funcionario.
create or replace function public.portal_mark_include(p_cpf text, p_local text, p_reason text)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_reason text := public.rep_check_reason(p_reason);
  v_local timestamp;
  v_at timestamptz;
  v_id uuid;
begin
  if not exists (select 1 from public.employees where company_id = t.company_id and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  begin
    v_local := date_trunc('minute', p_local::timestamp);
  exception when others then
    raise exception 'invalid_datetime';
  end;
  v_at := v_local at time zone t.tz;
  if v_at > now() then raise exception 'future_datetime'; end if;
  perform public.rep_assert_open(t.company_id, v_local::date, v_local::date, v_cpf);
  insert into public.mark_adjustments (company_id, cpf, kind, marked_at, reason, created_by, created_cpf)
    values (t.company_id, v_cpf, 'I', v_at, v_reason, t.user_id, t.cpf) returning id into v_id;
  perform public.portal_audit('marcacao_incluida', jsonb_build_object('cpf', v_cpf, 'local', v_local, 'motivo', v_reason));
  return v_id;
end $$;

create or replace function public.portal_mark_disregard(p_nsr bigint, p_reason text)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_reason text := public.rep_check_reason(p_reason);
  v_punch public.punches%rowtype;
  v_day date;
  v_id uuid;
begin
  select * into v_punch from public.punches where company_id = t.company_id and nsr = p_nsr;
  if v_punch.id is null then raise exception 'not_found'; end if;
  if exists (select 1 from public.mark_adjustments where company_id = t.company_id and kind = 'D'
             and punch_nsr = p_nsr and revoked_at is null) then
    raise exception 'already_done';
  end if;
  v_day := (v_punch.marked_at at time zone t.tz)::date;
  perform public.rep_assert_open(t.company_id, v_day - 1, v_day, v_punch.cpf);
  insert into public.mark_adjustments (company_id, cpf, kind, punch_nsr, reason, created_by, created_cpf)
    values (t.company_id, v_punch.cpf, 'D', p_nsr, v_reason, t.user_id, t.cpf) returning id into v_id;
  perform public.portal_audit('marcacao_desconsiderada', jsonb_build_object('nsr', p_nsr, 'motivo', v_reason));
  return v_id;
end $$;

create or replace function public.portal_adjust_revoke(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_reason text := public.rep_check_reason(p_reason);
  a public.mark_adjustments%rowtype;
  v_day date;
begin
  select * into a from public.mark_adjustments where id = p_id and company_id = t.company_id and revoked_at is null;
  if a.id is null then raise exception 'not_found'; end if;
  v_day := coalesce(a.marked_at, (select marked_at from public.punches where company_id = t.company_id
                                  and nsr = a.punch_nsr)) at time zone t.tz;
  perform public.rep_assert_open(t.company_id, v_day - 1, v_day, a.cpf);
  update public.mark_adjustments set revoked_at = now(), revoked_by = t.user_id, revoked_cpf = t.cpf,
    revoke_reason = v_reason where id = p_id;
  perform public.portal_audit('ajuste_revogado', jsonb_build_object('id', p_id, 'motivo', v_reason));
end $$;

create or replace function public.portal_occurrence_add(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_cpf text := nullif(regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g'), '');
  v_type text := coalesce(p->>'type', '');
  v_from date := (p->>'date_from')::date;
  v_to date := coalesce((p->>'date_to')::date, (p->>'date_from')::date);
  v_min int := nullif(p->>'minutes', '')::int;
  v_reason text := public.rep_check_reason(p->>'reason');
  v_id uuid;
begin
  if v_from is null or v_to < v_from or v_to - v_from > 366 then raise exception 'invalid_period'; end if;
  if v_cpf is null and v_type not in ('feriado', 'dsr') then raise exception 'missing_fields'; end if;
  if v_cpf is not null and not exists (select 1 from public.employees
                                       where company_id = t.company_id and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  if v_type = 'abono' and (v_min is null or v_min <= 0) then raise exception 'missing_fields'; end if;
  if v_type <> 'abono' and v_type <> 'atestado' then v_min := null; end if;
  perform public.rep_assert_open(t.company_id, v_from, v_to, v_cpf);
  insert into public.occurrences (company_id, cpf, type, date_from, date_to, minutes, reason, created_by, created_cpf)
    values (t.company_id, v_cpf, v_type, v_from, v_to, v_min, v_reason, t.user_id, t.cpf) returning id into v_id;
  perform public.portal_audit('ocorrencia_lancada', p);
  return v_id;
end $$;

create or replace function public.portal_occurrence_revoke(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_reason text := public.rep_check_reason(p_reason);
  o public.occurrences%rowtype;
begin
  select * into o from public.occurrences where id = p_id and company_id = t.company_id and revoked_at is null;
  if o.id is null then raise exception 'not_found'; end if;
  perform public.rep_assert_open(t.company_id, o.date_from, o.date_to, o.cpf);
  update public.occurrences set revoked_at = now(), revoked_by = t.user_id, revoked_cpf = t.cpf,
    revoke_reason = v_reason where id = p_id;
  perform public.portal_audit('ocorrencia_revogada', jsonb_build_object('id', p_id, 'motivo', v_reason));
end $$;

create or replace function public.portal_bonus_remove(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_cpf text := regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g');
  v_day date := (p->>'date')::date;
  v_reason text := public.rep_check_reason(p->>'reason');
  v_id uuid;
begin
  if v_day is null or not exists (select 1 from public.employees where company_id = t.company_id and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  perform public.rep_assert_open(t.company_id, v_day, v_day, v_cpf);
  if exists (select 1 from public.bonus_removals where company_id = t.company_id and cpf = v_cpf
             and day = v_day and revoked_at is null) then
    raise exception 'already_done';
  end if;
  insert into public.bonus_removals (company_id, cpf, day, reason, created_by, created_cpf)
    values (t.company_id, v_cpf, v_day, v_reason, t.user_id, t.cpf) returning id into v_id;
  perform public.portal_audit('bonus_retirado', jsonb_build_object('cpf', v_cpf, 'date', v_day, 'motivo', v_reason));
  return v_id;
end $$;

create or replace function public.portal_bonus_restore(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_reason text := public.rep_check_reason(p->>'reason');
  b public.bonus_removals%rowtype;
begin
  select * into b from public.bonus_removals where id = (p->>'id')::uuid and company_id = t.company_id
    and revoked_at is null;
  if not found then raise exception 'not_found'; end if;
  perform public.rep_assert_open(t.company_id, b.day, b.day, b.cpf);
  update public.bonus_removals set revoked_at = now(), revoked_by = t.user_id, revoked_cpf = t.cpf,
    revoke_reason = v_reason where id = b.id;
  perform public.portal_audit('bonus_devolvido', jsonb_build_object('cpf', b.cpf, 'date', b.day, 'motivo', v_reason));
end $$;

revoke execute on function public.rep_employee_close(uuid, text, date, date, jsonb),
  public.rep_bank_lots_from_period(uuid, date, text, text), public.rep_assert_open(uuid, date, date, text)
  from public, anon, authenticated;
revoke execute on function public.portal_employee_reopen(jsonb), public.portal_employee_closures(date) from public, anon;
grant execute on function public.portal_employee_reopen(jsonb), public.portal_employee_closures(date) to authenticated;

-- O tratamento mostra como fechados tambem os periodos fechados do funcionario.
create or replace function public.portal_timesheet(p_from date, p_to date, p_cpf text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid_period';
  end if;
  v := public.rep_timesheet_data(v_company, p_from, p_to, v_cpf);
  return jsonb_set(v, '{closed}', coalesce(v->'closed', '[]'::jsonb) || coalesce((select jsonb_agg(jsonb_build_object(
      'start', e.start_date, 'end', e.end_date, 'closed_at', e.closed_at, 'cpf', e.cpf))
    from public.employee_closures e where e.company_id = v_company and e.start_date <= p_to and e.end_date >= p_from
      and (v_cpf = '' or e.cpf = v_cpf)), '[]'::jsonb));
end $$;

create or replace function public.portal_periods(p_count integer)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_tz text := (select timezone from public.companies where id = v_company);
  v_today date := (now() at time zone v_tz)::date;
  v_out jsonb := '[]'::jsonb;
  v_day date := v_today;
  r record;
  i int;
begin
  for i in 1 .. least(greatest(coalesce(p_count, 6), 1), 24) loop
    select * into r from public.rep_period_of(v_company, v_day);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'start', r.start_date, 'end', r.end_date, 'current', v_today between r.start_date and r.end_date,
      'employees_closed', (select count(*) from public.employee_closures e where e.company_id = v_company
                           and e.start_date = r.start_date),
      'closed', (select jsonb_build_object('closed_at', cp.closed_at, 'closed_cpf', cp.closed_cpf,
                                           'closed_by', (select email from auth.users where id = cp.closed_by))
                 from public.closed_periods cp where cp.company_id = v_company and cp.start_date = r.start_date)));
    v_day := r.start_date - 1;
  end loop;
  return v_out;
end $$;

create or replace function public.rep_set_employee_schedule(p_company uuid, p_cpf text, p_schedule uuid, p_from date, p_actor text)
returns text language plpgsql security definer set search_path to '' as $$
declare
  v_emp uuid;
  v_current uuid;
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
begin
  select id into v_emp from public.employees where company_id = p_company and cpf = v_cpf;
  if v_emp is null then return 'funcionario_nao_encontrado'; end if;
  if not exists (select 1 from public.schedules where id = p_schedule and company_id = p_company) then
    return 'jornada_nao_encontrada';
  end if;
  select schedule_id into v_current from public.employee_schedules
    where employee_id = v_emp and valid_from <= p_from order by valid_from desc limit 1;
  if v_current = p_schedule then return 'sem_alteracao'; end if;
  if exists (select 1 from public.closed_periods c where c.company_id = p_company and c.end_date >= p_from)
     or exists (select 1 from public.employee_closures e where e.company_id = p_company and e.cpf = v_cpf
                and e.end_date >= p_from) then
    return 'periodo_fechado';
  end if;
  insert into public.employee_schedules (company_id, employee_id, schedule_id, valid_from, created_by)
    values (p_company, v_emp, p_schedule, p_from, p_actor)
    on conflict (employee_id, valid_from) do update set schedule_id = excluded.schedule_id,
      created_by = excluded.created_by, created_at = now();
  insert into public.audit_log (actor, action, detail) values (p_actor, 'jornada_do_funcionario',
    jsonb_build_object('cpf', p_cpf, 'schedule_id', p_schedule, 'valid_from', p_from));
  return 'ok';
end $$;
