-- Perfis enviados pelo Bubble: acesso ao portal (admin | rh) e responsavel pelo tablet.
alter table public.employees
  add column portal_role text not null default '' check (portal_role in ('', 'admin', 'rh')),
  add column tablet_responsible boolean not null default false;

-- Tentativas de primeiro acesso ao portal (limite contra adivinhacao da senha de ponto).
create table public.portal_access_attempts (
  id bigserial primary key,
  cpf text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index portal_access_attempts_cpf on public.portal_access_attempts (cpf, at);
alter table public.portal_access_attempts enable row level security;

-- Avisos de campo enviados pelo responsavel do tablet ao RH.
create table public.field_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  terminal_id uuid references public.terminals(id),
  responsible_cpf text not null,
  employee_cpf text not null default '',
  day date,
  text text not null,
  created_at timestamptz not null default now(),
  client_id text,
  done_at timestamptz,
  done_by uuid,
  done_note text,
  unique (company_id, client_id)
);
alter table public.field_notices enable row level security;

-- Remove o acesso ao portal de um e-mail (nunca o ultimo administrador).
create function public.rep_portal_revoke(p_company uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_role text;
begin
  select p.user_id, p.role into v_user, v_role from public.portal_users p join auth.users u on u.id = p.user_id
    where p.company_id = p_company and lower(u.email) = lower(p_email);
  if v_user is null then return 'sem_acesso'; end if;
  if v_role = 'admin' and (select count(*) from public.portal_users where company_id = p_company and role = 'admin') <= 1 then
    return 'ultimo_admin_mantido';
  end if;
  delete from public.portal_users where user_id = v_user;
  insert into public.audit_log (actor, action, detail)
    values ('integracao', 'acesso_portal_removido', jsonb_build_object('email', p_email));
  return 'removido';
end $$;

-- Aplica os perfis vindos da integracao. Campo ausente = nao muda.
create function public.rep_int_set_roles(p_key_hash text, p_cpf text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.rep_int_company(p_key_hash);
  e public.employees%rowtype;
  v_role text;
  v_access text;
  v_user uuid;
begin
  select * into e from public.employees where company_id = v_company
    and cpf = regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  if e.id is null then return jsonb_build_object('erro', 'funcionario_nao_encontrado'); end if;

  if p_item ? 'perfil_portal' then
    v_role := lower(btrim(coalesce(p_item->>'perfil_portal', '')));
    if v_role not in ('', 'admin', 'rh') then return jsonb_build_object('erro', 'perfil_portal_invalido'); end if;
    if v_role <> e.portal_role then
      update public.employees set portal_role = v_role where id = e.id;
      insert into public.audit_log (actor, action, detail) values ('integracao', 'perfil_portal',
        jsonb_build_object('cpf', e.cpf, 'de', e.portal_role, 'para', v_role));
    end if;
  end if;
  if p_item ? 'responsavel_tablet' then
    if (p_item->>'responsavel_tablet')::boolean is distinct from e.tablet_responsible then
      update public.employees set tablet_responsible = coalesce((p_item->>'responsavel_tablet')::boolean, false)
        where id = e.id;
      insert into public.audit_log (actor, action, detail) values ('integracao', 'responsavel_tablet',
        jsonb_build_object('cpf', e.cpf, 'para', (p_item->>'responsavel_tablet')::boolean));
    end if;
  end if;

  select * into e from public.employees where id = e.id;
  -- Acesso ao portal de quem ja entrou: acompanha o perfil (e o desligamento).
  select p.user_id into v_user from public.portal_users p join auth.users u on u.id = p.user_id
    where p.company_id = v_company and e.email <> '' and lower(u.email) = lower(e.email);
  if e.portal_role = '' or not e.active then
    v_access := case when v_user is null then 'sem_acesso' else public.rep_portal_revoke(v_company, e.email) end;
  elsif v_user is not null then
    update public.portal_users set role = e.portal_role where user_id = v_user and role <> e.portal_role;
    v_access := 'ativo';
  elsif e.email = '' then
    v_access := 'sem_email';
  else
    v_access := 'aguardando_primeiro_acesso';
  end if;

  return jsonb_build_object('perfil_portal', e.portal_role, 'responsavel_tablet', e.tablet_responsible,
                            'acesso_portal', v_access);
end $$;

-- Desligou: perde o acesso ao portal na hora (a area do responsavel ja depende de estar ativo).
create function public.rep_employee_off() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.active and not new.active and new.email <> '' then
    perform public.rep_portal_revoke(new.company_id, new.email);
  end if;
  return new;
end $$;
create trigger employees_off after update of active on public.employees
  for each row execute function public.rep_employee_off();

-- Tablet: funcionarios autorizados, com quem e responsavel ou administrador.
create or replace function public.rep_list_employees(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_terminal public.terminals%rowtype;
  v_out jsonb;
begin
  select * into v_terminal from public.terminals t where t.token_hash = p_token_hash and t.active;
  if not found then raise exception 'invalid_token'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'cpf', e.cpf, 'name', e.name, 'email', e.email, 'pin_hash', e.pin_hash,
      'active', e.active,
      'responsible', e.active and e.tablet_responsible,
      'admin', e.active and e.portal_role = 'admin',
      'updated_at_ms', (extract(epoch from e.updated_at) * 1000)::bigint
    ) order by e.name), '[]'::jsonb)
    into v_out
    from public.employees e
    where e.company_id = v_terminal.company_id
      and (v_terminal.site_id is null
           or e.portal_role = 'admin'
           or not exists (select 1 from public.employee_sites es where es.employee_id = e.id)
           or exists (select 1 from public.employee_sites es
                      where es.employee_id = e.id and es.site_id = v_terminal.site_id));
  return v_out;
end $$;

-- Tablet envia senha/rosto: o CPF do responsavel identificado vai para o AFD e o motivo para a auditoria.
create or replace function public.rep_upsert_employees(p_token_hash text, p_employees jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_terminal public.terminals%rowtype;
  v_resp text;
  v_item jsonb;
  v_item_resp text;
  v_count integer := 0;
begin
  select * into v_terminal from public.terminals t where t.token_hash = p_token_hash and t.active;
  if not found then raise exception 'invalid_token'; end if;
  select coalesce(nullif(v_terminal.responsible_cpf, ''), c.default_responsible_cpf) into v_resp
    from public.companies c where c.id = v_terminal.company_id for update;

  for v_item in select value from jsonb_array_elements(coalesce(p_employees, '[]'::jsonb))
  loop
    v_item_resp := regexp_replace(coalesce(v_item->>'responsible_cpf', ''), '[^0-9]', '', 'g');
    begin
      perform public.rep_employee_apply(
        v_terminal.company_id, v_item, case when length(v_item_resp) = 11 then v_item_resp else v_resp end,
        v_terminal.site_id, to_timestamp(coalesce((v_item->>'updated_at_ms')::bigint, 0) / 1000.0));
      v_count := v_count + 1;
      if coalesce(v_item->>'action', '') <> '' then
        insert into public.audit_log (actor, action, detail)
          values ('terminal:' || v_terminal.code, 'tablet_' || left(v_item->>'action', 40),
                  jsonb_build_object('cpf', v_item->>'cpf', 'responsavel', v_item_resp,
                                     'motivo', left(coalesce(v_item->>'reason', ''), 200)));
      end if;
    exception when others then
      if sqlerrm not like '%invalid_employee%' then raise; end if;
    end;
  end loop;

  if v_count > 0 then
    insert into public.audit_log (actor, action, detail)
      values ('terminal:' || v_terminal.code, 'funcionarios_enviados', jsonb_build_object('count', v_count));
  end if;
  update public.terminals set last_seen_at = now() where id = v_terminal.id;
  return v_count;
end $$;

-- Tablet: aviso de campo para o RH (idempotente pelo client_id).
create function public.rep_notice_add(p_token_hash text, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_terminal public.terminals%rowtype;
  v_resp text := regexp_replace(coalesce(p->>'responsible_cpf', ''), '[^0-9]', '', 'g');
  v_text text := left(btrim(coalesce(p->>'text', '')), 500);
  v_id uuid;
begin
  select * into v_terminal from public.terminals t where t.token_hash = p_token_hash and t.active;
  if not found then raise exception 'invalid_token'; end if;
  if length(v_resp) <> 11 or length(v_text) < 3 then raise exception 'missing_fields'; end if;
  insert into public.field_notices (company_id, terminal_id, responsible_cpf, employee_cpf, day, text, client_id)
    values (v_terminal.company_id, v_terminal.id, v_resp,
            regexp_replace(coalesce(p->>'employee_cpf', ''), '[^0-9]', '', 'g'),
            nullif(p->>'day', '')::date, v_text, nullif(p->>'client_id', ''))
    on conflict (company_id, client_id) do update set text = public.field_notices.text
    returning id into v_id;
  return v_id;
end $$;

-- Integracao: listagem traz os perfis.
create or replace function public.rep_int_list_employees(p_key_hash text, p_cpf text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.rep_int_company(p_key_hash);
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'cpf', e.cpf, 'nome', e.name, 'email', e.email, 'ativo', e.active,
      'tem_senha', e.pin_hash <> '', 'id_externo', e.external_id,
      'perfil_portal', e.portal_role, 'responsavel_tablet', e.tablet_responsible,
      'obras', coalesce((select jsonb_agg(s.name order by s.name) from public.employee_sites es
                          join public.sites s on s.id = es.site_id where es.employee_id = e.id), '[]'::jsonb),
      'atualizado_em', e.updated_at
    ) order by e.name), '[]'::jsonb)
    into v_out
    from public.employees e
    where e.company_id = v_company and (v_cpf = '' or e.cpf = v_cpf);
  return v_out;
end $$;

-- Portal: funcionarios com perfis; acessos pendentes; avisos de campo; auditoria; banco de horas.
create or replace function public.portal_employees() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'cpf', e.cpf, 'name', e.name, 'email', e.email, 'active', e.active,
      'has_pin', e.pin_hash <> '', 'external_id', e.external_id, 'updated_at', e.updated_at,
      'portal_role', e.portal_role, 'tablet_responsible', e.tablet_responsible,
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

create function public.portal_access_pending() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.portal_require_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('cpf', e.cpf, 'name', e.name, 'email', e.email,
                                                       'role', e.portal_role) order by e.name)
    from public.employees e
    where e.company_id = v_company and e.active and e.portal_role <> ''
      and not exists (select 1 from public.portal_users p join auth.users u on u.id = p.user_id
                      where p.company_id = v_company and e.email <> '' and lower(u.email) = lower(e.email))),
    '[]'::jsonb);
end $$;

create function public.portal_notices(p_open boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', n.id, 'terminal', t.code, 'responsible_cpf', n.responsible_cpf,
      'responsible', (select name from public.employees where company_id = v_company and cpf = n.responsible_cpf),
      'employee_cpf', n.employee_cpf,
      'employee', (select name from public.employees where company_id = v_company and cpf = n.employee_cpf),
      'day', n.day, 'text', n.text, 'created_at', n.created_at, 'done_at', n.done_at, 'done_note', n.done_note
    ) order by n.created_at desc)
    from public.field_notices n left join public.terminals t on t.id = n.terminal_id
    where n.company_id = v_company and (not coalesce(p_open, true) or n.done_at is null)
      and n.created_at > now() - interval '120 days'), '[]'::jsonb);
end $$;

create function public.portal_notice_done(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t record := public.portal_treater();
begin
  update public.field_notices set done_at = now(), done_by = t.user_id, done_note = left(coalesce(p_note, ''), 200)
    where id = p_id and company_id = t.company_id and done_at is null;
  if not found then raise exception 'not_found'; end if;
  perform public.portal_audit('aviso_resolvido', jsonb_build_object('id', p_id, 'nota', p_note));
end $$;

create function public.portal_audit_list(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.portal_require_admin();
  v_q text := lower(coalesce(p->>'q', ''));
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 100), 1), 500);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
begin
  -- A trilha nao tem empresa em todas as linhas antigas: filtra pelos atores da empresa.
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'actor', a.actor,
                                                       'action', a.action, 'detail', a.detail) order by a.id desc)
    from (select * from public.audit_log a
          where (a.actor = 'integracao'
                 or a.actor like 'portal:%' and exists (select 1 from public.portal_users pu join auth.users u
                     on u.id = pu.user_id where pu.company_id = v_company and a.actor = 'portal:' || u.email)
                 or a.actor like 'terminal:%' and exists (select 1 from public.terminals t
                     where t.company_id = v_company and a.actor = 'terminal:' || t.code))
            and (v_q = '' or lower(a.action) like '%' || v_q || '%' or lower(a.actor) like '%' || v_q || '%'
                 or lower(a.detail::text) like '%' || v_q || '%')
          order by a.id desc limit v_limit offset v_offset) a), '[]'::jsonb);
end $$;

create function public.portal_hour_bank() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object('cpf', e.cpf, 'name', e.name, 'active', e.active,
      'balance', coalesce(sum(t.bank_delta), 0),
      'credits', coalesce(sum(t.bank_delta) filter (where t.bank_delta > 0), 0),
      'debits', coalesce(sum(t.bank_delta) filter (where t.bank_delta < 0), 0),
      'last_day', max(t.day)) as x
    from public.employees e
    left join public.timesheet_days t on t.company_id = v_company and t.cpf = e.cpf
    where e.company_id = v_company and (e.active or t.cpf is not null)
    group by e.cpf, e.name, e.active) s), '[]'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['rep_portal_revoke(uuid, text)', 'rep_int_set_roles(text, text, jsonb)',
    'rep_employee_off()', 'rep_notice_add(text, jsonb)', 'portal_access_pending()', 'portal_notices(boolean)',
    'portal_notice_done(uuid, text)', 'portal_audit_list(jsonb)', 'portal_hour_bank()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['portal_access_pending()', 'portal_notices(boolean)', 'portal_notice_done(uuid, text)',
    'portal_audit_list(jsonb)', 'portal_hour_bank()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['rep_int_set_roles(text, text, jsonb)', 'rep_notice_add(text, jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Primeiro acesso ao portal: a API precisa achar uma conta existente pelo e-mail.
create function public.rep_auth_user_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1
$$;
revoke execute on function public.rep_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.rep_auth_user_by_email(text) to service_role;
