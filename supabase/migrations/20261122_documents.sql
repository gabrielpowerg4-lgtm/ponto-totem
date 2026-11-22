-- Controle de documentos e vencimentos (ASO, NRs, contratos...). Administrador e RH cadastram
-- documentos; so o administrador mexe nos tipos. Renovar cria um documento novo e o antigo fica como
-- "substituido" no historico. Excluir pede motivo e fica na auditoria (o registro nao e apagado).

create table if not exists public.doc_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  validity_days int check (validity_days is null or validity_days between 1 and 3650),
  alert_days int not null default 30 check (alert_days between 0 and 365),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists doc_types_code on public.doc_types (company_id, lower(code));
alter table public.doc_types enable row level security;
revoke all on public.doc_types from anon, authenticated;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cpf text not null,
  type_id uuid not null references public.doc_types(id),
  issued_on date not null,
  expires_on date,
  site_id uuid references public.sites(id),
  notes text not null default '',
  file_path text,
  file_name text,
  file_mime text,
  file_size int,
  state text not null default 'ativo' check (state in ('ativo', 'substituido', 'excluido')),
  replaced_by uuid references public.documents(id),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  removed_reason text,
  check (expires_on is null or expires_on >= issued_on)
);
create index if not exists documents_company on public.documents (company_id, state, expires_on);
create index if not exists documents_cpf on public.documents (company_id, cpf);
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;

-- Arquivos dos documentos: bucket privado, pasta da empresa.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists documentos_insert on storage.objects;
create policy documentos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] =
    (select pu.company_id::text from public.portal_users pu where pu.user_id = auth.uid()));
drop policy if exists documentos_select on storage.objects;
create policy documentos_select on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] =
    (select pu.company_id::text from public.portal_users pu where pu.user_id = auth.uid()));

-- Tipos -------------------------------------------------------------------------------------------

create or replace function public.portal_doc_types()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'name', t.name, 'validity_days', t.validity_days, 'alert_days', t.alert_days,
      'active', t.active,
      'documents', (select count(*) from public.documents d where d.type_id = t.id and d.state = 'ativo'))
    order by lower(t.code))
    from public.doc_types t where t.company_id = v_company), '[]'::jsonb);
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
begin
  if v_code = '' or length(v_code) > 20 or v_name = '' or length(v_name) > 120 then
    raise exception 'missing_fields';
  end if;
  if (v_valid is not null and v_valid not between 1 and 3650) or v_alert not between 0 and 365 then
    raise exception 'invalid_doc_type';
  end if;
  if exists (select 1 from public.doc_types where company_id = v_company and lower(code) = lower(v_code)
             and id is distinct from v_id) then
    raise exception 'duplicate_code';
  end if;
  if v_id is null then
    insert into public.doc_types (company_id, code, name, validity_days, alert_days, active)
      values (v_company, v_code, v_name, v_valid, v_alert, v_active) returning id into v_id;
  else
    update public.doc_types set code = v_code, name = v_name, validity_days = v_valid, alert_days = v_alert,
      active = v_active, updated_at = now()
    where id = v_id and company_id = v_company;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform public.portal_audit('tipo_documento_salvo', jsonb_build_object('code', v_code, 'validity_days', v_valid,
    'alert_days', v_alert, 'active', v_active));
  return v_id;
end $$;

-- Documentos --------------------------------------------------------------------------------------

/** Situacao na data de hoje (fuso da empresa). */
create or replace function public.rep_doc_status(p_expires date, p_alert int, p_state text, p_today date)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_state <> 'ativo' then p_state
    when p_expires is null then 'valido'
    when p_expires < p_today then 'vencido'
    when p_expires - p_today <= p_alert then 'alerta'
    else 'valido' end
$$;

create or replace function public.portal_documents(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_cpf text := nullif(regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g'), '');
  v_history boolean := coalesce((p->>'history')::boolean, false);
  v_today date := (now() at time zone coalesce((select timezone from public.companies where id = v_company),
                   'America/Sao_Paulo'))::date;
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'cpf', d.cpf, 'name', e.name, 'job_title', e.job_title, 'contract_type', e.contract_type,
      'active_employee', e.active, 'photo_path', e.photo_path,
      'type_id', t.id, 'type_code', t.code, 'type_name', t.name, 'alert_days', t.alert_days,
      'issued_on', d.issued_on, 'expires_on', d.expires_on, 'days_left', d.expires_on - v_today,
      'site_id', d.site_id, 'site_name', s.name, 'notes', d.notes,
      'file_path', d.file_path, 'file_name', d.file_name,
      'state', d.state, 'status', public.rep_doc_status(d.expires_on, t.alert_days, d.state, v_today),
      'replaced_by', d.replaced_by, 'created_by', d.created_by, 'created_at', d.created_at,
      'updated_by', d.updated_by, 'updated_at', d.updated_at, 'removed_reason', d.removed_reason)
    order by d.expires_on nulls last, e.name)
    from public.documents d
    join public.doc_types t on t.id = d.type_id
    join public.employees e on e.company_id = d.company_id and e.cpf = d.cpf
    left join public.sites s on s.id = d.site_id
    where d.company_id = v_company and (v_cpf is null or d.cpf = v_cpf)
      and (d.state = 'ativo' or (v_history and d.state = 'substituido'))), '[]'::jsonb);
end $$;

create or replace function public.portal_documents_summary()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_today date := (now() at time zone coalesce((select timezone from public.companies where id = v_company),
                   'America/Sao_Paulo'))::date;
begin
  return (select jsonb_build_object(
      'vencido', count(*) filter (where x.st = 'vencido'),
      'alerta', count(*) filter (where x.st = 'alerta'),
      'valido', count(*) filter (where x.st = 'valido'))
    from (select public.rep_doc_status(d.expires_on, t.alert_days, d.state, v_today) st
          from public.documents d join public.doc_types t on t.id = d.type_id
          join public.employees e on e.company_id = d.company_id and e.cpf = d.cpf and e.active
          where d.company_id = v_company and d.state = 'ativo') x);
end $$;

-- Inclui, edita ou renova (renew_of: o documento anterior vira "substituido").
create or replace function public.portal_document_save(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_actor text := coalesce((select u.email from auth.users u where u.id = auth.uid()), auth.uid()::text);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_renew uuid := nullif(p->>'renew_of', '')::uuid;
  v_cpf text := regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g');
  v_type uuid := nullif(p->>'type_id', '')::uuid;
  v_issued date := nullif(p->>'issued_on', '')::date;
  v_expires date := nullif(p->>'expires_on', '')::date;
  v_site uuid := nullif(p->>'site_id', '')::uuid;
  v_notes text := left(trim(coalesce(p->>'notes', '')), 500);
  v_path text := nullif(p->>'file_path', '');
  t public.doc_types%rowtype;
  old public.documents%rowtype;
begin
  if v_id is not null then
    select * into old from public.documents where id = v_id and company_id = v_company and state = 'ativo';
    if not found then raise exception 'not_found'; end if;
    v_cpf := old.cpf;
  elsif v_renew is not null then
    select * into old from public.documents where id = v_renew and company_id = v_company and state = 'ativo';
    if not found then raise exception 'not_found'; end if;
    v_cpf := old.cpf;
    v_type := coalesce(v_type, old.type_id);
  end if;

  select * into t from public.doc_types where id = v_type and company_id = v_company;
  if not found or v_issued is null then raise exception 'missing_fields'; end if;
  if not exists (select 1 from public.employees where company_id = v_company and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  if v_site is not null and not exists (select 1 from public.sites where id = v_site and company_id = v_company) then
    raise exception 'not_found';
  end if;
  if v_expires is null and t.validity_days is not null then v_expires := v_issued + t.validity_days; end if;
  if v_expires is not null and v_expires < v_issued then raise exception 'invalid_dates'; end if;
  if v_path is not null and (split_part(v_path, '/', 1) <> v_company::text
     or not exists (select 1 from storage.objects where bucket_id = 'documentos' and name = v_path)) then
    raise exception 'invalid_file';
  end if;

  if v_id is not null then
    update public.documents set type_id = v_type, issued_on = v_issued, expires_on = v_expires, site_id = v_site,
      notes = v_notes,
      file_path = coalesce(v_path, file_path),
      file_name = case when v_path is not null then left(coalesce(p->>'file_name', 'arquivo'), 120) else file_name end,
      file_mime = case when v_path is not null then coalesce(p->>'file_mime', '') else file_mime end,
      file_size = case when v_path is not null then coalesce((p->>'file_size')::int, 0) else file_size end,
      updated_by = v_actor, updated_at = now()
    where id = v_id;
    perform public.portal_audit('documento_editado', jsonb_build_object('cpf', v_cpf, 'tipo', t.code,
      'emissao', v_issued, 'vencimento', v_expires));
    return v_id;
  end if;

  insert into public.documents (company_id, cpf, type_id, issued_on, expires_on, site_id, notes,
      file_path, file_name, file_mime, file_size, created_by, updated_by)
    values (v_company, v_cpf, v_type, v_issued, v_expires, v_site, v_notes,
      v_path, case when v_path is not null then left(coalesce(p->>'file_name', 'arquivo'), 120) end,
      case when v_path is not null then coalesce(p->>'file_mime', '') end,
      case when v_path is not null then coalesce((p->>'file_size')::int, 0) end, v_actor, v_actor)
    returning id into v_id;
  if v_renew is not null then
    update public.documents set state = 'substituido', replaced_by = v_id, updated_by = v_actor, updated_at = now()
      where id = v_renew;
  end if;
  perform public.portal_audit(case when v_renew is null then 'documento_incluido' else 'documento_renovado' end,
    jsonb_build_object('cpf', v_cpf, 'tipo', t.code, 'emissao', v_issued, 'vencimento', v_expires));
  return v_id;
end $$;

create or replace function public.portal_document_remove(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_company();
  v_actor text := coalesce((select u.email from auth.users u where u.id = auth.uid()), auth.uid()::text);
  v_reason text := trim(coalesce(p->>'reason', ''));
  d public.documents%rowtype;
begin
  if length(v_reason) < 3 then raise exception 'missing_fields'; end if;
  update public.documents set state = 'excluido', removed_reason = left(v_reason, 300), updated_by = v_actor,
    updated_at = now()
  where id = nullif(p->>'id', '')::uuid and company_id = v_company and state = 'ativo'
  returning * into d;
  if not found then raise exception 'not_found'; end if;
  perform public.portal_audit('documento_excluido', jsonb_build_object('cpf', d.cpf,
    'tipo', (select code from public.doc_types where id = d.type_id), 'motivo', v_reason));
end $$;

revoke all on function public.portal_doc_types() from public, anon;
revoke all on function public.portal_doc_type_save(jsonb) from public, anon;
revoke all on function public.portal_documents(jsonb) from public, anon;
revoke all on function public.portal_documents_summary() from public, anon;
revoke all on function public.portal_document_save(jsonb) from public, anon;
revoke all on function public.portal_document_remove(jsonb) from public, anon;
grant execute on function public.portal_doc_types() to authenticated;
grant execute on function public.portal_doc_type_save(jsonb) to authenticated;
grant execute on function public.portal_documents(jsonb) to authenticated;
grant execute on function public.portal_documents_summary() to authenticated;
grant execute on function public.portal_document_save(jsonb) to authenticated;
grant execute on function public.portal_document_remove(jsonb) to authenticated;

-- Tipos do Semax-SGI (validade e alerta em dias). O tipo de teste TST2 do SGI nao foi trazido.
insert into public.doc_types (company_id, code, name, validity_days, alert_days)
select c.id, x.code, x.name, x.v, x.a
from public.companies c
cross join (values
  ('Alocacao', 'Data de alocação', 365, 30),
  ('ASO', 'Atestado de Saúde Ocupacional', 365, 31),
  ('contratoPJ', 'Controle de vencimento de contrato PJ', 365, 15),
  ('CSC', 'Carta de Subcontratação', 365, 31),
  ('NR10', 'Segurança em Instalações e Serviços em Eletricidade', 730, 31),
  ('NR11', 'Transporte, Movimentação, Armazenagem e Manuseio de Materiais', 365, 31),
  ('NR12', 'Segurança no Trabalho em Máquinas e Equipamentos', 365, 31),
  ('NR18', 'Construção Civil', 365, 31),
  ('NR34', 'Condições e Meio Ambiente de Trabalho na Indústria Naval', 365, 31),
  ('NR35', 'Trabalho em Altura', 730, 31),
  ('NR6', 'Equipamentos de Proteção Individual (EPI)', 700, 15),
  ('PTA', 'Plano de Treinamento e Aperfeiçoamento', 365, 31),
  ('RPAG', 'Registro de Pagamento', 365, 30),
  ('TST01', 'Contrato obra', 365, 31)
) as x(code, name, v, a)
on conflict do nothing;
