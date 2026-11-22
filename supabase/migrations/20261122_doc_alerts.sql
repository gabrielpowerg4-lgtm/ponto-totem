-- Avisos de vencimento de documentos por e-mail, configurados por tipo de documento.
-- Diario: cada documento e avisado uma vez quando entra em alerta e uma vez quando vence.
-- Semanal: no dia escolhido, resumo de tudo que esta em alerta ou vencido.
-- Um e-mail por destinatario por execucao; o funcionario (opcional) recebe so os documentos dele.
-- Um agendador no banco (pg_cron) chama a funcao rep uma vez por dia as 07:00 de Brasilia.

alter table public.doc_types
  add column if not exists notify_enabled boolean not null default false,
  add column if not exists notify_emails text[] not null default '{}',
  add column if not exists notify_frequency text not null default 'semanal'
    check (notify_frequency in ('diario', 'semanal')),
  add column if not exists notify_weekday int not null default 1 check (notify_weekday between 0 and 6),
  add column if not exists notify_employee boolean not null default false;

-- Avisos diarios ja enviados (um por documento e evento).
create table if not exists public.doc_notice_sent (
  document_id uuid not null references public.documents(id) on delete cascade,
  event text not null check (event in ('alerta', 'vencido')),
  sent_on date not null,
  primary key (document_id, event)
);
alter table public.doc_notice_sent enable row level security;
revoke all on public.doc_notice_sent from anon, authenticated;

-- Historico de envios.
create table if not exists public.doc_notifications (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  run_date date not null,
  kind text not null check (kind in ('rh', 'funcionario', 'teste')),
  recipient text not null,           -- mascarado: a***@dominio
  documents int not null default 0,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists doc_notifications_company on public.doc_notifications (company_id, created_at desc);
alter table public.doc_notifications enable row level security;
revoke all on public.doc_notifications from anon, authenticated;

-- Uma execucao por empresa por dia (evita duplicar se o agendador disparar de novo).
create table if not exists public.doc_notice_runs (
  company_id uuid not null references public.companies(id) on delete cascade,
  run_date date not null,
  started_at timestamptz not null default now(),
  primary key (company_id, run_date)
);
alter table public.doc_notice_runs enable row level security;
revoke all on public.doc_notice_runs from anon, authenticated;

-- Tipos: leitura e gravacao passam a incluir o aviso ------------------------------------------------

create or replace function public.portal_doc_types()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'name', t.name, 'validity_days', t.validity_days, 'alert_days', t.alert_days,
      'active', t.active,
      'documents', (select count(*) from public.documents d where d.type_id = t.id and d.state = 'ativo'),
      'notify_enabled', t.notify_enabled, 'notify_emails', to_jsonb(t.notify_emails),
      'notify_frequency', t.notify_frequency, 'notify_weekday', t.notify_weekday,
      'notify_employee', t.notify_employee)
    order by lower(t.code))
    from public.doc_types t where t.company_id = v_company), '[]'::jsonb);
end $$;

create or replace function public.rep_clean_emails(p jsonb)
returns text[] language plpgsql immutable set search_path to '' as $$
declare
  v text[];
begin
  select coalesce(array_agg(distinct lower(trim(x))), '{}') into v
    from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) x where trim(x) <> '';
  if exists (select 1 from unnest(v) e where e !~ '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$') then
    raise exception 'invalid_email';
  end if;
  if coalesce(array_length(v, 1), 0) > 20 then raise exception 'too_many'; end if;
  return v;
end $$;

create or replace function public.portal_doc_type_save(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_code text := trim(coalesce(p->>'code', ''));
  v_name text := trim(coalesce(p->>'name', ''));
  v_valid int := nullif(p->>'validity_days', '')::int;
  v_alert int := coalesce(nullif(p->>'alert_days', '')::int, 30);
  v_active boolean := coalesce((p->>'active')::boolean, true);
  v_notify boolean := coalesce((p->>'notify_enabled')::boolean, false);
  v_emails text[] := public.rep_clean_emails(p->'notify_emails');
  v_freq text := coalesce(nullif(p->>'notify_frequency', ''), 'semanal');
  v_wd int := coalesce(nullif(p->>'notify_weekday', '')::int, 1);
  v_emp boolean := coalesce((p->>'notify_employee')::boolean, false);
begin
  if v_code = '' or length(v_code) > 20 or v_name = '' or length(v_name) > 120 then
    raise exception 'missing_fields';
  end if;
  if (v_valid is not null and v_valid not between 1 and 3650) or v_alert not between 0 and 365
     or v_freq not in ('diario', 'semanal') or v_wd not between 0 and 6 then
    raise exception 'invalid_doc_type';
  end if;
  if v_notify and coalesce(array_length(v_emails, 1), 0) = 0 and not v_emp then
    raise exception 'notify_without_recipient';
  end if;
  if exists (select 1 from public.doc_types where company_id = v_company and lower(code) = lower(v_code)
             and id is distinct from v_id) then
    raise exception 'duplicate_code';
  end if;
  if v_id is null then
    insert into public.doc_types (company_id, code, name, validity_days, alert_days, active, notify_enabled,
        notify_emails, notify_frequency, notify_weekday, notify_employee)
      values (v_company, v_code, v_name, v_valid, v_alert, v_active, v_notify, v_emails, v_freq, v_wd, v_emp)
      returning id into v_id;
  else
    update public.doc_types set code = v_code, name = v_name, validity_days = v_valid, alert_days = v_alert,
      active = v_active, notify_enabled = v_notify, notify_emails = v_emails, notify_frequency = v_freq,
      notify_weekday = v_wd, notify_employee = v_emp, updated_at = now()
    where id = v_id and company_id = v_company;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform public.portal_audit('tipo_documento_salvo', jsonb_build_object('code', v_code, 'validity_days', v_valid,
    'alert_days', v_alert, 'active', v_active, 'aviso', v_notify, 'frequencia', v_freq,
    'destinatarios', coalesce(array_length(v_emails, 1), 0), 'funcionario', v_emp));
  return v_id;
end $$;

-- Copia os destinatarios de um tipo para todos os outros (nao muda flag nem frequencia).
create or replace function public.portal_doc_type_copy_emails(p jsonb)
returns int language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
  v_emails text[];
  n int;
begin
  select notify_emails into v_emails from public.doc_types
    where id = nullif(p->>'id', '')::uuid and company_id = v_company;
  if v_emails is null then raise exception 'not_found'; end if;
  update public.doc_types set notify_emails = v_emails, updated_at = now()
    where company_id = v_company and id <> nullif(p->>'id', '')::uuid;
  get diagnostics n = row_count;
  perform public.portal_audit('destinatarios_copiados', jsonb_build_object('tipos', n,
    'destinatarios', coalesce(array_length(v_emails, 1), 0)));
  return n;
end $$;

create or replace function public.portal_doc_notifications()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('run_date', n.run_date, 'kind', n.kind,
      'recipient', n.recipient, 'documents', n.documents, 'ok', n.ok, 'error', n.error, 'created_at', n.created_at)
      order by n.created_at desc)
    from (select * from public.doc_notifications where company_id = v_company
          order by created_at desc limit 100) n), '[]'::jsonb);
end $$;

-- Servidor ---------------------------------------------------------------------------------------

-- Documentos a avisar hoje, por empresa. p_type: so um tipo (previa), ignorando flag e frequencia.
create or replace function public.rep_doc_alerts(p_company uuid, p_type uuid default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_tz text := coalesce((select timezone from public.companies where id = p_company), 'America/Sao_Paulo');
  v_today date := (now() at time zone v_tz)::date;
  v_dow int := extract(dow from v_today)::int;
begin
  return jsonb_build_object('today', v_today, 'items', coalesce((select jsonb_agg(x order by x->>'expires_on') from (
    select jsonb_build_object(
      'id', d.id, 'type_id', t.id, 'type_code', t.code, 'type_name', t.name, 'frequency', t.notify_frequency,
      'emails', to_jsonb(t.notify_emails), 'notify_employee', t.notify_employee,
      'cpf', d.cpf, 'name', e.name, 'job_title', e.job_title, 'employee_email', e.email,
      'site_name', s.name, 'issued_on', d.issued_on, 'expires_on', d.expires_on,
      'days_left', d.expires_on - v_today, 'status', st.status,
      'event', case when st.status = 'vencido' then 'vencido' else 'alerta' end) x
    from public.documents d
    join public.doc_types t on t.id = d.type_id
    join public.employees e on e.company_id = d.company_id and e.cpf = d.cpf and e.active
    left join public.sites s on s.id = d.site_id
    cross join lateral (select public.rep_doc_status(d.expires_on, t.alert_days, d.state, v_today) status) st
    where d.company_id = p_company and d.state = 'ativo' and st.status in ('alerta', 'vencido')
      and (
        (p_type is not null and t.id = p_type)
        or (p_type is null and t.notify_enabled and (
          (t.notify_frequency = 'semanal' and t.notify_weekday = v_dow)
          or (t.notify_frequency = 'diario' and not exists (select 1 from public.doc_notice_sent n
               where n.document_id = d.id and n.event = case when st.status = 'vencido' then 'vencido' else 'alerta' end))
        ))
      )) y), '[]'::jsonb));
end $$;

-- Marca o inicio da execucao do dia; false se ja rodou hoje.
create or replace function public.rep_doc_alerts_begin(p_company uuid, p_date date)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  insert into public.doc_notice_runs (company_id, run_date) values (p_company, p_date);
  return true;
exception when unique_violation then
  return false;
end $$;

-- Registra o resultado: historico de envios e eventos diarios avisados.
create or replace function public.rep_doc_alerts_done(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_date date := (p->>'run_date')::date;
begin
  insert into public.doc_notifications (company_id, run_date, kind, recipient, documents, ok, error)
  select p_company, v_date, r->>'kind', r->>'recipient', coalesce((r->>'documents')::int, 0),
         coalesce((r->>'ok')::boolean, false), nullif(r->>'error', '')
    from jsonb_array_elements(coalesce(p->'sends', '[]'::jsonb)) r;
  insert into public.doc_notice_sent (document_id, event, sent_on)
  select (s->>'id')::uuid, s->>'event', v_date
    from jsonb_array_elements(coalesce(p->'sent', '[]'::jsonb)) s
    where exists (select 1 from public.documents d where d.id = (s->>'id')::uuid and d.company_id = p_company)
  on conflict (document_id, event) do nothing;
end $$;

-- Quando um documento e editado ou renovado, os avisos diarios dele recomecam.
create or replace function public.rep_doc_reset_notices()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.expires_on is distinct from old.expires_on or new.type_id is distinct from old.type_id then
    delete from public.doc_notice_sent where document_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists documents_reset_notices on public.documents;
create trigger documents_reset_notices after update on public.documents
  for each row execute function public.rep_doc_reset_notices();

-- Chave do agendador (no Vault) e conferencia pelo servidor.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_doc_alerts_key') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'cron_doc_alerts_key', 'Chave do agendador dos avisos de documentos');
  end if;
end $$;

create or replace function public.rep_cron_key_ok(p_key text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(p_key, '') <> '' and exists (select 1 from vault.decrypted_secrets
    where name = 'cron_doc_alerts_key' and decrypted_secret = p_key)
$$;

revoke all on function public.portal_doc_type_copy_emails(jsonb) from public, anon;
revoke all on function public.portal_doc_notifications() from public, anon;
grant execute on function public.portal_doc_type_copy_emails(jsonb) to authenticated;
grant execute on function public.portal_doc_notifications() to authenticated;
revoke all on function public.rep_doc_alerts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rep_doc_alerts_begin(uuid, date) from public, anon, authenticated;
revoke all on function public.rep_doc_alerts_done(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rep_cron_key_ok(text) from public, anon, authenticated;
revoke all on function public.rep_clean_emails(jsonb) from public, anon;
grant execute on function public.rep_doc_alerts(uuid, uuid) to service_role;
grant execute on function public.rep_doc_alerts_begin(uuid, date) to service_role;
grant execute on function public.rep_doc_alerts_done(uuid, jsonb) to service_role;
grant execute on function public.rep_cron_key_ok(text) to service_role;

create or replace function public.rep_doc_alert_companies()
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(distinct company_id), '[]'::jsonb) from public.doc_types where notify_enabled
$$;
revoke all on function public.rep_doc_alert_companies() from public, anon, authenticated;
grant execute on function public.rep_doc_alert_companies() to service_role;

-- Agendador: todo dia as 10:00 UTC (07:00 em Brasilia).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('doc-alerts') where exists (select 1 from cron.job where jobname = 'doc-alerts');
select cron.schedule('doc-alerts', '0 10 * * *', $job$
  select net.http_post(
    url := 'https://mplacscrqtlgxmtkcrig.supabase.co/functions/v1/rep/v1/cron/doc-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_doc_alerts_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);
