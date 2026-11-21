-- Onda 1: regras do SGI com opcao CLT por data, bonus, percentual de pagamento, justificativas novas,
-- admissao/desligamento, banco de horas por lotes (FIFO), quitacao, anexos.

-- ---------------------------------------------------------------------------
-- Regras da empresa
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists calc_clt_from date,
  add column if not exists tol_sgi smallint not null default 5,
  add column if not exists bonus_every smallint not null default 60,
  add column if not exists bonus_minutes smallint not null default 30,
  add column if not exists pct_weekday smallint[] not null default '{100,60,60,60,60,60,100}',
  add column if not exists pct_holiday smallint not null default 100,
  add column if not exists comp_holiday_minutes smallint not null default 60,
  add column if not exists bank_expiry_months smallint not null default 12,
  add column if not exists bank_alert_days smallint not null default 30;

alter table public.companies
  add constraint companies_wave1_check check (
    tol_sgi between 0 and 30 and bonus_every between 1 and 600 and bonus_minutes between 0 and 600
    and array_length(pct_weekday, 1) = 7 and pct_holiday between 0 and 300
    and comp_holiday_minutes between 0 and 600 and bank_expiry_months between 1 and 60
    and bank_alert_days between 0 and 180);

alter table public.employees
  add column if not exists admitted_on date,
  add column if not exists dismissed_on date;
alter table public.employees
  add constraint employees_contract_dates_check
  check (dismissed_on is null or admitted_on is null or dismissed_on >= admitted_on);

alter table public.occurrences drop constraint occurrences_type_check;
alter table public.occurrences add constraint occurrences_type_check check (type = any (array[
  'feriado', 'dsr', 'folga', 'ferias', 'atestado', 'afastamento', 'falta_justificada', 'abono', 'falta',
  'folga_compensatoria', 'comp_feriado', 'desconto_folha', 'troca_feriado']));

-- ---------------------------------------------------------------------------
-- Retirada de bonus e anexos do dia (so revogam, nunca apagam)
-- ---------------------------------------------------------------------------
create table public.bonus_removals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  cpf text not null,
  day date not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_cpf text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_cpf text,
  revoke_reason text);
create unique index bonus_removals_active on public.bonus_removals (company_id, cpf, day) where revoked_at is null;
create trigger bonus_removals_revoke_only before update or delete on public.bonus_removals
  for each row execute function public.rep_only_revoke();

create table public.day_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  cpf text not null,
  day date not null,
  path text not null,
  name text not null,
  size int not null,
  mime text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_cpf text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_cpf text,
  revoke_reason text);
create index day_attachments_day on public.day_attachments (company_id, cpf, day);
create trigger day_attachments_revoke_only before update or delete on public.day_attachments
  for each row execute function public.rep_only_revoke();

-- ---------------------------------------------------------------------------
-- Banco de horas por lotes
-- ---------------------------------------------------------------------------
create table public.bank_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  cpf text not null,
  kind text not null check (kind in ('pagamento', 'desconto')),
  minutes int not null check (minutes > 0),
  competence text not null check (competence ~ '^[0-9]{4}-[0-9]{2}$'),
  settle_date date not null,
  reason text not null,
  detail jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_cpf text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_cpf text,
  revoke_reason text);
create index bank_settlements_cpf on public.bank_settlements (company_id, cpf, created_at);
create trigger bank_settlements_revoke_only before update or delete on public.bank_settlements
  for each row execute function public.rep_only_revoke();

create table public.bank_lots (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  cpf text not null,
  lot_date date not null,
  origin text not null check (origin in ('dia', 'bonus', 'abertura', 'pagamento', 'desconto')),
  minutes int not null check (minutes <> 0),
  pct smallint,
  expires_on date,
  period_start date,
  settlement_id uuid references public.bank_settlements(id),
  note text,
  created_at timestamptz not null default now(),
  created_by text);
create index bank_lots_cpf on public.bank_lots (company_id, cpf, id);
create index bank_lots_period on public.bank_lots (company_id, period_start);

-- Lotes nao mudam. So a reabertura do periodo (funcao propria) pode apagar os lotes dele.
create or replace function public.rep_bank_lots_guard() returns trigger
language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' and current_setting('rep.lot_delete', true) = 'on' then return old; end if;
  raise exception 'immutable';
end $$;
create trigger bank_lots_guard before update or delete on public.bank_lots
  for each row execute function public.rep_bank_lots_guard();

-- Abatimentos: derivados dos lotes (refeitos por rep_bank_rebuild). lot_id consumiu target_id.
create table public.bank_allocations (
  company_id uuid not null,
  cpf text not null,
  lot_id bigint not null references public.bank_lots(id) on delete cascade,
  target_id bigint not null references public.bank_lots(id) on delete cascade,
  minutes int not null check (minutes > 0));
create index bank_allocations_cpf on public.bank_allocations (company_id, cpf);
create index bank_allocations_lot on public.bank_allocations (lot_id);
create index bank_allocations_target on public.bank_allocations (target_id);

alter table public.bonus_removals enable row level security;
alter table public.day_attachments enable row level security;
alter table public.bank_settlements enable row level security;
alter table public.bank_lots enable row level security;
alter table public.bank_allocations enable row level security;

-- Lotes ativos: os de quitacao estornada ficam de fora.
create or replace function public.rep_bank_active(p_company uuid, p_cpf text)
returns setof public.bank_lots language sql stable security definer set search_path to '' as $$
  select l.* from public.bank_lots l
  left join public.bank_settlements s on s.id = l.settlement_id
  where l.company_id = p_company and l.cpf = p_cpf and (l.settlement_id is null or s.revoked_at is null)
$$;

-- Refaz os abatimentos FIFO de um colaborador: os lotes entram na ordem em que foram gravados; cada um
-- abate primeiro o lote de sinal contrario mais antigo (pela data) ainda em aberto.
create or replace function public.rep_bank_rebuild(p_company uuid, p_cpf text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  l record;
  o record;
  v_rem int;
  v_x int;
begin
  delete from public.bank_allocations where company_id = p_company and cpf = p_cpf;
  create temp table if not exists _bank_open (id bigint, lot_date date, rem int) on commit drop;
  truncate pg_temp._bank_open;
  for l in select * from public.rep_bank_active(p_company, p_cpf) order by id loop
    v_rem := abs(l.minutes);
    loop
      exit when v_rem = 0;
      select * into o from pg_temp._bank_open
        where (l.minutes > 0 and rem < 0) or (l.minutes < 0 and rem > 0)
        order by lot_date, id limit 1;
      exit when not found;
      v_x := least(v_rem, abs(o.rem));
      insert into public.bank_allocations (company_id, cpf, lot_id, target_id, minutes)
        values (p_company, p_cpf, l.id, o.id, v_x);
      v_rem := v_rem - v_x;
      if abs(o.rem) = v_x then
        delete from pg_temp._bank_open where id = o.id;
      else
        update pg_temp._bank_open set rem = rem - sign(rem)::int * v_x where id = o.id;
      end if;
    end loop;
    if v_rem > 0 then
      insert into pg_temp._bank_open values (l.id, l.lot_date, sign(l.minutes)::int * v_rem);
    end if;
  end loop;
end $$;

-- Situacao de cada lote ativo: quanto ainda resta em aberto (com sinal).
create or replace function public.rep_bank_lots_state(p_company uuid, p_cpf text)
returns table (id bigint, lot_date date, origin text, minutes int, pct smallint, expires_on date,
               period_start date, settlement_id uuid, note text, remaining int)
language sql stable security definer set search_path to '' as $$
  select l.id, l.lot_date, l.origin, l.minutes, l.pct, l.expires_on, l.period_start, l.settlement_id, l.note,
         (sign(l.minutes)::int * (abs(l.minutes)
           - coalesce((select sum(a.minutes) from public.bank_allocations a where a.lot_id = l.id), 0)
           - coalesce((select sum(a.minutes) from public.bank_allocations a where a.target_id = l.id), 0)))::int
  from public.rep_bank_active(p_company, p_cpf) l
$$;

-- Lotes do periodo fechado, a partir das linhas gravadas em timesheet_days.
create or replace function public.rep_bank_lots_from_period(p_company uuid, p_start date, p_actor text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_months int := (select bank_expiry_months from public.companies where id = p_company);
  r record;
begin
  for r in select t.cpf, t.day, t.bank_delta, coalesce((t.data->>'bonus')::int, 0) as bonus,
                  nullif(t.data->>'pct', '')::smallint as pct
           from public.timesheet_days t
           where t.company_id = p_company and t.period_start = p_start
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
  for r in select distinct cpf from public.bank_lots where company_id = p_company and period_start = p_start loop
    perform public.rep_bank_rebuild(p_company, r.cpf);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Fechamento e reabertura
-- ---------------------------------------------------------------------------
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
  if exists (select 1 from public.closed_periods where company_id = v_company and start_date > p_end) then
    raise exception 'period_closed';
  end if;

  insert into public.timesheet_days (company_id, cpf, day, period_start, schedule_code, expected, worked,
                                     night, balance, bank_delta, flags, data)
  select v_company, d->>'cpf', (d->>'date')::date, p_start, coalesce(d->>'schedule_code', ''),
         (d->>'expected')::int, (d->>'worked')::int, (d->>'night')::int, (d->>'balance')::int,
         (d->>'bank_delta')::int,
         coalesce(array(select jsonb_array_elements_text(d->'flags')), '{}'), d
  from jsonb_array_elements(p_days) d
  where (d->>'date')::date between p_start and p_end;

  insert into public.closed_periods (company_id, start_date, end_date, closed_by, closed_cpf)
    values (v_company, p_start, p_end, p_user, v_cpf);
  perform public.rep_bank_lots_from_period(v_company, p_start, v_cpf);
  insert into public.audit_log (actor, action, detail)
    values ('portal:' || coalesce((select email from auth.users where id = p_user), p_user::text),
            'periodo_fechado', jsonb_build_object('start', p_start, 'end', p_end,
                                                  'days', jsonb_array_length(p_days)));
end $$;

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
  if exists (select 1 from public.closed_periods where company_id = v_company and start_date > p_start) then
    raise exception 'not_latest';
  end if;
  if exists (select 1 from public.bank_settlements s
             where s.company_id = v_company and s.revoked_at is null and s.created_at > v_closed
               and s.cpf in (select cpf from public.bank_lots where company_id = v_company and period_start = p_start)) then
    raise exception 'settled_after_close';
  end if;
  perform set_config('rep.lot_delete', 'on', true);
  delete from public.bank_lots where company_id = v_company and period_start = p_start;
  perform set_config('rep.lot_delete', 'off', true);
  for r in select distinct cpf from public.timesheet_days where company_id = v_company and period_start = p_start loop
    perform public.rep_bank_rebuild(v_company, r.cpf);
  end loop;
  delete from public.timesheet_days where company_id = v_company and period_start = p_start;
  delete from public.closed_periods where company_id = v_company and start_date = p_start;
  perform public.portal_audit('periodo_reaberto', jsonb_build_object('start', p_start, 'end', v_end,
                                                                     'motivo', v_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Dados do tratamento
-- ---------------------------------------------------------------------------
create or replace function public.rep_bank_balance_before(p_company uuid, p_cpf text, p_from date)
returns int language sql stable security definer set search_path to '' as $$
  select coalesce(sum(minutes), 0)::int from public.rep_bank_active(p_company, p_cpf) where lot_date < p_from
$$;

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
                          and a.punch_nsr = p.nsr and a.revoked_at is null limit 1)) as m
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

-- ---------------------------------------------------------------------------
-- Justificativas, bonus e anexos no tratamento
-- ---------------------------------------------------------------------------
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
  perform public.rep_assert_open(t.company_id, v_from, v_to);
  insert into public.occurrences (company_id, cpf, type, date_from, date_to, minutes, reason, created_by, created_cpf)
    values (t.company_id, v_cpf, v_type, v_from, v_to, v_min, v_reason, t.user_id, t.cpf) returning id into v_id;
  perform public.portal_audit('ocorrencia_lancada', p);
  return v_id;
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
  perform public.rep_assert_open(t.company_id, v_day, v_day);
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
  perform public.rep_assert_open(t.company_id, b.day, b.day);
  update public.bonus_removals set revoked_at = now(), revoked_by = t.user_id, revoked_cpf = t.cpf,
    revoke_reason = v_reason where id = b.id;
  perform public.portal_audit('bonus_devolvido', jsonb_build_object('cpf', b.cpf, 'date', b.day, 'motivo', v_reason));
end $$;

create or replace function public.portal_attachment_add(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_cpf text := regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g');
  v_day date := (p->>'date')::date;
  v_path text := coalesce(p->>'path', '');
  v_id uuid;
begin
  if v_day is null or not exists (select 1 from public.employees where company_id = t.company_id and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  if split_part(v_path, '/', 1) <> t.company_id::text
     or not exists (select 1 from storage.objects where bucket_id = 'anexos' and name = v_path) then
    raise exception 'invalid_file';
  end if;
  if (select count(*) from public.day_attachments where company_id = t.company_id and cpf = v_cpf
      and day = v_day and revoked_at is null) >= 3 then
    raise exception 'attachment_limit';
  end if;
  insert into public.day_attachments (company_id, cpf, day, path, name, size, mime, created_by, created_cpf)
    values (t.company_id, v_cpf, v_day, v_path, left(coalesce(p->>'name', 'arquivo'), 120),
            coalesce((p->>'size')::int, 0), coalesce(p->>'mime', ''), t.user_id, t.cpf)
    returning id into v_id;
  perform public.portal_audit('anexo_incluido', jsonb_build_object('cpf', v_cpf, 'date', v_day, 'name', p->>'name'));
  return v_id;
end $$;

create or replace function public.portal_attachment_revoke(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_reason text := public.rep_check_reason(p->>'reason');
  a public.day_attachments%rowtype;
begin
  select * into a from public.day_attachments where id = (p->>'id')::uuid and company_id = t.company_id
    and revoked_at is null;
  if not found then raise exception 'not_found'; end if;
  update public.day_attachments set revoked_at = now(), revoked_by = t.user_id, revoked_cpf = t.cpf,
    revoke_reason = v_reason where id = a.id;
  perform public.portal_audit('anexo_retirado', jsonb_build_object('cpf', a.cpf, 'date', a.day, 'motivo', v_reason));
end $$;

-- Arquivos: bucket privado, pasta = empresa. Sem apagar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy anexos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] =
              (select pu.company_id::text from public.portal_users pu where pu.user_id = auth.uid()));
create policy anexos_select on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] =
         (select pu.company_id::text from public.portal_users pu where pu.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Admissao e desligamento
-- ---------------------------------------------------------------------------
create or replace function public.portal_employee_dates(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_cpf text := regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g');
  v_adm date := nullif(p->>'admitted_on', '')::date;
  v_dis date := nullif(p->>'dismissed_on', '')::date;
begin
  if not exists (select 1 from public.employees where company_id = t.company_id and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  if v_adm is not null and v_dis is not null and v_dis < v_adm then raise exception 'invalid_period'; end if;
  update public.employees set admitted_on = v_adm, dismissed_on = v_dis, updated_at = now()
    where company_id = t.company_id and cpf = v_cpf;
  perform public.portal_audit('contrato_datas', jsonb_build_object('cpf', v_cpf, 'admissao', v_adm,
                                                                   'desligamento', v_dis));
end $$;

create or replace function public.rep_int_set_dates(p_key_hash text, p_cpf text, p_item jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.rep_int_company(p_key_hash);
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
begin
  if p_item ? 'admissao' then
    update public.employees set admitted_on = nullif(p_item->>'admissao', '')::date
      where company_id = v_company and cpf = v_cpf;
  end if;
  if p_item ? 'desligamento' then
    update public.employees set dismissed_on = nullif(p_item->>'desligamento', '')::date
      where company_id = v_company and cpf = v_cpf;
  end if;
end $$;

create or replace function public.portal_employees()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'cpf', e.cpf, 'name', e.name, 'email', e.email, 'active', e.active,
      'has_pin', e.pin_hash <> '', 'external_id', e.external_id, 'updated_at', e.updated_at,
      'portal_role', e.portal_role, 'tablet_responsible', e.tablet_responsible,
      'admitted_on', e.admitted_on, 'dismissed_on', e.dismissed_on,
      'sites', coalesce((select jsonb_agg(s.name order by s.name) from public.employee_sites es
                          join public.sites s on s.id = es.site_id where es.employee_id = e.id), '[]'::jsonb),
      'schedule', (select jsonb_build_object('id', sc.id, 'code', sc.code, 'valid_from', es.valid_from)
                   from public.employee_schedules es join public.schedules sc on sc.id = es.schedule_id
                   where es.employee_id = e.id and es.valid_from <= current_date
                   order by es.valid_from desc limit 1),
      'last_punch_at', (select max(p.marked_at) from public.punches p
                        where p.company_id = v_company and p.cpf = e.cpf)
    ) order by e.name) from public.employees e where e.company_id = v_company), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Regras
-- ---------------------------------------------------------------------------
create or replace function public.portal_company_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return (select jsonb_build_object(
      'name', c.name, 'id_type', c.id_type, 'employer_id', coalesce(c.cnpj, ''),
      'legal_name', c.legal_name, 'caepf', c.caepf,
      'default_responsible_cpf', c.default_responsible_cpf, 'timezone', c.timezone,
      'last_nsr', c.last_nsr, 'closing_day', c.closing_day, 'hour_bank', c.hour_bank,
      'tol_mark', c.tol_mark, 'tol_day', c.tol_day,
      'clt_from', c.calc_clt_from, 'tol_sgi', c.tol_sgi, 'bonus_every', c.bonus_every,
      'bonus_minutes', c.bonus_minutes, 'pct_weekday', to_jsonb(c.pct_weekday), 'pct_holiday', c.pct_holiday,
      'comp_holiday_minutes', c.comp_holiday_minutes, 'bank_expiry_months', c.bank_expiry_months,
      'bank_alert_days', c.bank_alert_days,
      'inpi_number', r.inpi_number, 'dev_id', r.dev_id, 'dev_name', r.dev_name)
    from public.companies c cross join public.rep_settings r where c.id = v_company);
end $$;

create or replace function public.portal_rules_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
  c public.companies%rowtype;
  v_cut int := coalesce((p->>'closing_day')::int, 20);
  v_mark int := coalesce((p->>'tol_mark')::int, 5);
  v_day int := coalesce((p->>'tol_day')::int, 10);
  v_clt date;
  v_pct smallint[];
begin
  select * into c from public.companies where id = v_company;
  v_clt := case when p ? 'clt_from' then nullif(p->>'clt_from', '')::date else c.calc_clt_from end;
  if v_cut not between 0 and 28 or v_mark not between 0 and 5 or v_day not between 0 and 10 then
    raise exception 'invalid_rules';
  end if;
  v_pct := coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'pct_weekday') x),
                    c.pct_weekday);
  -- A data das regras da CLT nao pode cair (nem sair) de dentro de um periodo ja fechado.
  if v_clt is distinct from c.calc_clt_from then
    if exists (select 1 from public.closed_periods where company_id = v_company
               and end_date >= least(coalesce(v_clt, 'infinity'::date), coalesce(c.calc_clt_from, 'infinity'::date))) then
      raise exception 'clt_date_closed';
    end if;
  end if;
  update public.companies set closing_day = v_cut, hour_bank = coalesce((p->>'hour_bank')::boolean, true),
    tol_mark = v_mark, tol_day = v_day, calc_clt_from = v_clt,
    tol_sgi = coalesce((p->>'tol_sgi')::int, c.tol_sgi),
    bonus_every = coalesce((p->>'bonus_every')::int, c.bonus_every),
    bonus_minutes = coalesce((p->>'bonus_minutes')::int, c.bonus_minutes),
    pct_weekday = v_pct,
    pct_holiday = coalesce((p->>'pct_holiday')::int, c.pct_holiday),
    comp_holiday_minutes = coalesce((p->>'comp_holiday_minutes')::int, c.comp_holiday_minutes),
    bank_expiry_months = coalesce((p->>'bank_expiry_months')::int, c.bank_expiry_months),
    bank_alert_days = coalesce((p->>'bank_alert_days')::int, c.bank_alert_days)
  where id = v_company;
  perform public.portal_audit('regras_alteradas', p);
  return public.portal_company_get();
end $$;

-- ---------------------------------------------------------------------------
-- Banco de horas: saldos, extrato, quitacao, abertura, consolidado
-- ---------------------------------------------------------------------------
create or replace function public.portal_hour_bank()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  c public.companies%rowtype;
  v_today date;
begin
  select * into c from public.companies where id = v_company;
  v_today := (now() at time zone c.timezone)::date;
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object('cpf', e.cpf, 'name', e.name, 'active', e.active,
      'balance', coalesce(sum(s.remaining), 0),
      'credits', coalesce(sum(s.remaining) filter (where s.remaining > 0), 0),
      'debits', coalesce(sum(s.remaining) filter (where s.remaining < 0), 0),
      'expired_credits', coalesce(sum(s.remaining) filter (where s.remaining > 0 and s.expires_on <= v_today), 0),
      'expired_debits', coalesce(sum(s.remaining) filter (where s.remaining < 0 and s.expires_on <= v_today), 0),
      'expiring', coalesce(sum(s.remaining) filter (where s.remaining <> 0 and s.expires_on > v_today
                                                     and s.expires_on <= v_today + c.bank_alert_days), 0),
      'next_expiry', min(s.expires_on) filter (where s.remaining <> 0 and s.expires_on > v_today),
      'last_day', (select max(t.day) from public.timesheet_days t where t.company_id = v_company and t.cpf = e.cpf)
    ) as x
    from public.employees e
    left join lateral public.rep_bank_lots_state(v_company, e.cpf) s on true
    where e.company_id = v_company
      and (e.active or exists (select 1 from public.bank_lots l where l.company_id = v_company and l.cpf = e.cpf))
    group by e.cpf, e.name, e.active) q), '[]'::jsonb);
end $$;

create or replace function public.portal_bank_statement(p_cpf text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_today date := (now() at time zone (select timezone from public.companies where id = v_company))::date;
begin
  if not exists (select 1 from public.employees where company_id = v_company and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  return jsonb_build_object(
    'today', v_today,
    'lots', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'date', s.lot_date, 'origin', s.origin, 'minutes', s.minutes, 'pct', s.pct,
        'expires_on', s.expires_on, 'remaining', s.remaining, 'note', s.note,
        'expired', s.expires_on is not null and s.expires_on <= v_today and s.remaining <> 0,
        'settlement_id', s.settlement_id,
        'consumed', coalesce((select jsonb_agg(jsonb_build_object('id', l2.id, 'date', l2.lot_date,
                                                                  'origin', l2.origin, 'minutes', a.minutes)
                                              order by l2.lot_date, l2.id)
                              from public.bank_allocations a join public.bank_lots l2 on l2.id = a.target_id
                              where a.lot_id = s.id), '[]'::jsonb),
        'consumed_by', coalesce((select jsonb_agg(jsonb_build_object('id', l2.id, 'date', l2.lot_date,
                                                                     'origin', l2.origin, 'minutes', a.minutes)
                                                 order by l2.id)
                                 from public.bank_allocations a join public.bank_lots l2 on l2.id = a.lot_id
                                 where a.target_id = s.id), '[]'::jsonb)
      ) order by s.lot_date, s.id) from public.rep_bank_lots_state(v_company, v_cpf) s), '[]'::jsonb),
    'settlements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'minutes', b.minutes, 'competence', b.competence, 'date', b.settle_date,
        'reason', b.reason, 'detail', b.detail, 'by', b.created_cpf, 'at', b.created_at,
        'revoked_at', b.revoked_at, 'revoke_reason', b.revoke_reason) order by b.created_at desc)
      from public.bank_settlements b where b.company_id = v_company and b.cpf = v_cpf), '[]'::jsonb));
end $$;

-- Previa FIFO: quais lotes em aberto seriam abatidos e o total por percentual.
create or replace function public.rep_bank_preview(p_company uuid, p_cpf text, p_kind text, p_minutes int)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_sign int := case p_kind when 'pagamento' then 1 when 'desconto' then -1 end;
  v_left int := p_minutes;
  v_take int;
  v_items jsonb := '[]'::jsonb;
  v_avail int;
  r record;
begin
  if v_sign is null then raise exception 'invalid_kind'; end if;
  if p_minutes is null or p_minutes <= 0 then raise exception 'missing_fields'; end if;
  select coalesce(sum(abs(remaining)), 0) into v_avail from public.rep_bank_lots_state(p_company, p_cpf)
    where sign(remaining) = v_sign;
  if p_minutes > v_avail then raise exception 'exceeds_balance'; end if;
  for r in select * from public.rep_bank_lots_state(p_company, p_cpf)
           where sign(remaining) = v_sign order by lot_date, id loop
    exit when v_left = 0;
    v_take := least(v_left, abs(r.remaining));
    v_items := v_items || jsonb_build_array(jsonb_build_object('lot_id', r.id, 'date', r.lot_date,
      'origin', r.origin, 'pct', r.pct, 'expires_on', r.expires_on, 'minutes', v_take));
    v_left := v_left - v_take;
  end loop;
  return jsonb_build_object('kind', p_kind, 'minutes', p_minutes, 'available', v_avail, 'items', v_items,
    'by_pct', (select coalesce(jsonb_agg(jsonb_build_object('pct', pct, 'minutes', m) order by pct), '[]'::jsonb)
               from (select (i->>'pct')::int as pct, sum((i->>'minutes')::int) as m
                     from jsonb_array_elements(v_items) i group by 1) g));
end $$;

create or replace function public.portal_bank_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return public.rep_bank_preview(v_company, regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g'),
                                 p->>'kind', (p->>'minutes')::int);
end $$;

create or replace function public.portal_bank_settle(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_cpf text := regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g');
  v_kind text := p->>'kind';
  v_min int := (p->>'minutes')::int;
  v_comp text := coalesce(p->>'competence', '');
  v_reason text := public.rep_check_reason(p->>'reason');
  v_today date := (now() at time zone t.tz)::date;
  v_detail jsonb;
  v_id uuid;
begin
  if not exists (select 1 from public.employees where company_id = t.company_id and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  if v_comp !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'missing_fields'; end if;
  perform 1 from public.employees where company_id = t.company_id and cpf = v_cpf for update;
  v_detail := public.rep_bank_preview(t.company_id, v_cpf, v_kind, v_min);
  insert into public.bank_settlements (company_id, cpf, kind, minutes, competence, settle_date, reason, detail,
                                       created_by, created_cpf)
    values (t.company_id, v_cpf, v_kind, v_min, v_comp, v_today, v_reason, v_detail, t.user_id, t.cpf)
    returning id into v_id;
  insert into public.bank_lots (company_id, cpf, lot_date, origin, minutes, settlement_id, note, created_by)
    values (t.company_id, v_cpf, v_today, v_kind,
            case v_kind when 'pagamento' then -v_min else v_min end, v_id, v_reason, t.cpf);
  perform public.rep_bank_rebuild(t.company_id, v_cpf);
  perform public.portal_audit('banco_' || v_kind, jsonb_build_object('cpf', v_cpf, 'minutos', v_min,
                                                                    'competencia', v_comp, 'motivo', v_reason));
  return v_id;
end $$;

-- So a quitacao mais recente do colaborador pode ser estornada (para o FIFO voltar ao que era).
create or replace function public.portal_bank_settlement_revoke(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_reason text := public.rep_check_reason(p->>'reason');
  b public.bank_settlements%rowtype;
begin
  select * into b from public.bank_settlements where id = (p->>'id')::uuid and company_id = t.company_id
    and revoked_at is null;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.bank_settlements where company_id = t.company_id and cpf = b.cpf
             and revoked_at is null and created_at > b.created_at) then
    raise exception 'not_latest';
  end if;
  update public.bank_settlements set revoked_at = now(), revoked_by = t.user_id, revoked_cpf = t.cpf,
    revoke_reason = v_reason where id = b.id;
  perform public.rep_bank_rebuild(t.company_id, b.cpf);
  perform public.portal_audit('banco_estorno', jsonb_build_object('cpf', b.cpf, 'tipo', b.kind,
                                                                 'minutos', b.minutes, 'motivo', v_reason));
end $$;

create or replace function public.portal_bank_settlements(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_comp text := nullif(p->>'competence', '');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'cpf', b.cpf, 'name', e.name, 'kind', b.kind, 'minutes', b.minutes,
      'competence', b.competence, 'date', b.settle_date, 'reason', b.reason, 'by', b.created_cpf,
      'at', b.created_at, 'by_pct', b.detail->'by_pct', 'revoked_at', b.revoked_at) order by b.created_at desc)
    from public.bank_settlements b join public.employees e on e.company_id = b.company_id and e.cpf = b.cpf
    where b.company_id = v_company and (v_comp is null or b.competence = v_comp)), '[]'::jsonb);
end $$;

-- Saldo de abertura (migracao do SGI): um lote por item, com a data de origem.
create or replace function public.portal_bank_opening(p jsonb)
returns int language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
  v_actor text := (public.rep_portal_user_cpf(auth.uid())).cpf;
  v_months int := (select bank_expiry_months from public.companies where id = v_company);
  i jsonb;
  v_cpf text;
  v_n int := 0;
  r record;
begin
  for i in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    v_cpf := regexp_replace(coalesce(i->>'cpf', ''), '[^0-9]', '', 'g');
    if not exists (select 1 from public.employees where company_id = v_company and cpf = v_cpf) then
      raise exception 'not_found';
    end if;
    if coalesce((i->>'minutes')::int, 0) = 0 or (i->>'date') is null then raise exception 'missing_fields'; end if;
    insert into public.bank_lots (company_id, cpf, lot_date, origin, minutes, pct, expires_on, note, created_by)
      values (v_company, v_cpf, (i->>'date')::date, 'abertura', (i->>'minutes')::int,
              nullif(i->>'pct', '')::smallint,
              ((i->>'date')::date + make_interval(months => v_months))::date,
              left(coalesce(i->>'note', 'Saldo de abertura'), 200), v_actor);
    v_n := v_n + 1;
  end loop;
  for r in select distinct regexp_replace(coalesce(x->>'cpf', ''), '[^0-9]', '', 'g') as cpf
           from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x loop
    perform public.rep_bank_rebuild(v_company, r.cpf);
  end loop;
  perform public.portal_audit('banco_abertura', jsonb_build_object('lotes', v_n));
  return v_n;
end $$;

-- Consolidado mensal por colaborador: periodos fechados.
create or replace function public.portal_bank_monthly(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_cpf text := nullif(regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g'), '');
begin
  return coalesce((select jsonb_agg(x order by x->>'name', x->>'period_start') from (
    select jsonb_build_object('cpf', t.cpf, 'name', e.name, 'period_start', t.period_start,
      'period_end', max(t.day), 'expected', sum(t.expected), 'worked', sum(t.worked),
      'extra', sum(greatest(t.balance, 0)), 'missing', sum(greatest(-t.balance, 0)),
      'bonus', sum(coalesce((t.data->>'bonus')::int, 0)), 'bank_delta', sum(t.bank_delta),
      'bank_after', public.rep_bank_balance_before(v_company, t.cpf, max(t.day) + 1)) as x
    from public.timesheet_days t join public.employees e on e.company_id = t.company_id and e.cpf = t.cpf
    where t.company_id = v_company and (v_cpf is null or t.cpf = v_cpf)
    group by t.cpf, e.name, t.period_start) q), '[]'::jsonb);
end $$;

-- Permissoes: so pelas funcoes.
revoke all on public.bonus_removals, public.day_attachments, public.bank_settlements, public.bank_lots,
  public.bank_allocations from anon, authenticated;
revoke execute on function public.rep_bank_rebuild(uuid, text), public.rep_bank_lots_from_period(uuid, date, text),
  public.rep_bank_active(uuid, text), public.rep_bank_lots_state(uuid, text),
  public.rep_bank_preview(uuid, text, text, int), public.rep_bank_balance_before(uuid, text, date),
  public.rep_int_set_dates(text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.portal_bonus_remove(jsonb), public.portal_bonus_restore(jsonb),
  public.portal_attachment_add(jsonb), public.portal_attachment_revoke(jsonb), public.portal_employee_dates(jsonb),
  public.portal_bank_statement(text), public.portal_bank_preview(jsonb), public.portal_bank_settle(jsonb),
  public.portal_bank_settlement_revoke(jsonb), public.portal_bank_settlements(jsonb),
  public.portal_bank_opening(jsonb), public.portal_bank_monthly(jsonb)
  from public, anon;
grant execute on function public.portal_bonus_remove(jsonb), public.portal_bonus_restore(jsonb),
  public.portal_attachment_add(jsonb), public.portal_attachment_revoke(jsonb), public.portal_employee_dates(jsonb),
  public.portal_bank_statement(text), public.portal_bank_preview(jsonb), public.portal_bank_settle(jsonb),
  public.portal_bank_settlement_revoke(jsonb), public.portal_bank_settlements(jsonb),
  public.portal_bank_opening(jsonb), public.portal_bank_monthly(jsonb)
  to authenticated;
