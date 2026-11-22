-- Confirmacao de identidade pelo RH quando o rosto nao conferiu: a marcacao original continua valida
-- e sem alteracao; o alerta sai das pendencias e fica registrado quem confirmou e como.
create table public.face_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  nsr bigint not null,
  cpf text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_cpf text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_cpf text,
  revoke_reason text);
create unique index face_confirmations_active on public.face_confirmations (company_id, nsr) where revoked_at is null;
create trigger face_confirmations_revoke_only before update or delete on public.face_confirmations
  for each row execute function public.rep_only_revoke();
alter table public.face_confirmations enable row level security;
revoke all on public.face_confirmations from anon, authenticated;

create or replace function public.portal_face_confirm(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_reason text := public.rep_check_reason(p->>'reason');
  v_punch public.punches%rowtype;
  v_day date;
  v_id uuid;
begin
  select * into v_punch from public.punches where company_id = t.company_id and nsr = (p->>'nsr')::bigint;
  if v_punch.id is null then raise exception 'not_found'; end if;
  if v_punch.face_status in ('ROSTO_CONFERE', 'VIVACIDADE_OK') then raise exception 'already_done'; end if;
  v_day := (v_punch.marked_at at time zone t.tz)::date;
  perform public.rep_assert_open(t.company_id, v_day - 1, v_day, v_punch.cpf);
  if exists (select 1 from public.face_confirmations where company_id = t.company_id and nsr = v_punch.nsr
             and revoked_at is null) then
    raise exception 'already_done';
  end if;
  insert into public.face_confirmations (company_id, nsr, cpf, reason, created_by, created_cpf)
    values (t.company_id, v_punch.nsr, v_punch.cpf, v_reason, t.user_id, t.cpf) returning id into v_id;
  perform public.portal_audit('rosto_confirmado', jsonb_build_object('nsr', v_punch.nsr, 'cpf', v_punch.cpf,
                                                                     'motivo', v_reason));
  return v_id;
end $$;

create or replace function public.portal_face_confirm_revoke(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_reason text := public.rep_check_reason(p->>'reason');
  f public.face_confirmations%rowtype;
  v_day date;
begin
  select * into f from public.face_confirmations where id = (p->>'id')::uuid and company_id = t.company_id
    and revoked_at is null;
  if not found then raise exception 'not_found'; end if;
  v_day := ((select marked_at from public.punches where company_id = t.company_id and nsr = f.nsr) at time zone t.tz)::date;
  perform public.rep_assert_open(t.company_id, v_day - 1, v_day, f.cpf);
  update public.face_confirmations set revoked_at = now(), revoked_by = t.user_id, revoked_cpf = t.cpf,
    revoke_reason = v_reason where id = f.id;
  perform public.portal_audit('rosto_confirmacao_desfeita', jsonb_build_object('nsr', f.nsr, 'cpf', f.cpf,
                                                                               'motivo', v_reason));
end $$;

revoke execute on function public.portal_face_confirm(jsonb), public.portal_face_confirm_revoke(jsonb) from public, anon;
grant execute on function public.portal_face_confirm(jsonb), public.portal_face_confirm_revoke(jsonb) to authenticated;

create or replace function public.rep_timesheet_data(p_company uuid, p_from date, p_to date, p_cpf text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  c public.companies%rowtype;
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_lo timestamptz;
  v_hi timestamptz;
begin
  select * into c from public.companies where id = p_company;
  v_lo := ((p_from - 1)::timestamp) at time zone c.timezone;
  v_hi := ((p_to + 2)::timestamp) at time zone c.timezone;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'settings', jsonb_build_object('hour_bank', c.hour_bank, 'tol_mark', c.tol_mark, 'tol_day', c.tol_day,
                                   'closing_day', c.closing_day, 'clt_from', c.calc_clt_from,
                                   'tol_sgi', c.tol_sgi, 'bonus_every', c.bonus_every,
                                   'bonus_minutes', c.bonus_minutes, 'pct_weekday', to_jsonb(c.pct_weekday),
                                   'pct_holiday', c.pct_holiday, 'comp_holiday_minutes', c.comp_holiday_minutes),
    'schedules', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name,
                                                               'days', s.days))
                           from public.schedules s where s.company_id = p_company), '[]'::jsonb),
    'employees', coalesce((select jsonb_agg(jsonb_build_object(
        'cpf', e.cpf, 'name', e.name, 'active', e.active,
        'admitted_on', e.admitted_on, 'dismissed_on', e.dismissed_on,
        'assignments', coalesce((select jsonb_agg(jsonb_build_object('schedule_id', es.schedule_id,
                                                                     'valid_from', es.valid_from)
                                                  order by es.valid_from)
                                 from public.employee_schedules es where es.employee_id = e.id), '[]'::jsonb),
        'bank_before', public.rep_bank_balance_before(p_company, e.cpf, p_from)
      ) order by e.name)
      from public.employees e
      where e.company_id = p_company and (v_cpf = '' or e.cpf = v_cpf)
        and (e.active or exists (select 1 from public.punches p where p.company_id = p_company
                                 and p.cpf = e.cpf and p.marked_at >= v_lo and p.marked_at < v_hi))),
      '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(m order by m->>'cpf', m->>'date', (m->>'min')::int) from (
        select jsonb_build_object(
          'cpf', p.cpf, 'nsr', p.nsr, 'adj_id', null, 'kind', 'O',
          'date', to_char(p.marked_at at time zone c.timezone, 'YYYY-MM-DD'),
          'min', (extract(hour from p.marked_at at time zone c.timezone) * 60
                  + extract(minute from p.marked_at at time zone c.timezone))::int,
          'face', p.face_status, 'online', p.online, 'reason', null,
          'disregard', (select jsonb_build_object('id', a.id, 'reason', a.reason, 'by', a.created_cpf,
                                                  'at', a.created_at)
                        from public.mark_adjustments a where a.company_id = p_company and a.kind = 'D'
                          and a.punch_nsr = p.nsr and a.revoked_at is null limit 1),
          'face_confirm', (select jsonb_build_object('id', f.id, 'reason', f.reason, 'by', f.created_cpf,
                                                     'at', f.created_at)
                           from public.face_confirmations f where f.company_id = p_company
                             and f.nsr = p.nsr and f.revoked_at is null limit 1)) as m
        from public.punches p
        where p.company_id = p_company and (v_cpf = '' or p.cpf = v_cpf)
          and p.marked_at >= v_lo and p.marked_at < v_hi
        union all
        select jsonb_build_object(
          'cpf', a.cpf, 'nsr', null, 'adj_id', a.id, 'kind', 'I',
          'date', to_char(a.marked_at at time zone c.timezone, 'YYYY-MM-DD'),
          'min', (extract(hour from a.marked_at at time zone c.timezone) * 60
                  + extract(minute from a.marked_at at time zone c.timezone))::int,
          'face', null, 'online', null, 'reason', a.reason, 'by', a.created_cpf, 'at', a.created_at,
          'disregard', null)
        from public.mark_adjustments a
        where a.company_id = p_company and a.kind = 'I' and a.revoked_at is null
          and (v_cpf = '' or a.cpf = v_cpf) and a.marked_at >= v_lo and a.marked_at < v_hi) x), '[]'::jsonb),
    'occurrences', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'cpf', o.cpf, 'type', o.type, 'date_from', o.date_from, 'date_to', o.date_to,
        'minutes', o.minutes, 'reason', o.reason, 'by', o.created_cpf, 'at', o.created_at) order by o.date_from)
      from public.occurrences o
      where o.company_id = p_company and o.revoked_at is null and o.date_from <= p_to and o.date_to >= p_from
        and (o.cpf is null or v_cpf = '' or o.cpf = v_cpf)), '[]'::jsonb),
    'bonus_removals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'cpf', b.cpf, 'date', b.day, 'reason', b.reason, 'by', b.created_cpf, 'at', b.created_at))
      from public.bonus_removals b
      where b.company_id = p_company and b.revoked_at is null and b.day between p_from and p_to
        and (v_cpf = '' or b.cpf = v_cpf)), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'cpf', a.cpf, 'date', a.day, 'path', a.path, 'name', a.name, 'size', a.size,
        'mime', a.mime, 'by', a.created_cpf, 'at', a.created_at) order by a.created_at)
      from public.day_attachments a
      where a.company_id = p_company and a.revoked_at is null and a.day between p_from and p_to
        and (v_cpf = '' or a.cpf = v_cpf)), '[]'::jsonb),
    'closed', coalesce((select jsonb_agg(jsonb_build_object('start', cp.start_date, 'end', cp.end_date,
                                                            'closed_at', cp.closed_at))
      from public.closed_periods cp where cp.company_id = p_company
        and cp.start_date <= p_to and cp.end_date >= p_from), '[]'::jsonb)
  );
end $$;
