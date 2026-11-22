-- Cadastro de funcionarios e perfis feito no portal: dados pessoais, contrato, obras, foto e perfis.
-- A inclusao, alteracao de nome e desligamento continuam gerando o registro tipo 5 do AFD, com o CPF de
-- quem fez no portal como responsavel.

alter table public.employees
  add column if not exists birth_date date,
  add column if not exists sex text not null default '',
  add column if not exists job_title text not null default '',
  add column if not exists contract_type text not null default '',
  add column if not exists photo_path text not null default '';
alter table public.employees
  add constraint employees_sex_check check (sex in ('', 'M', 'F')),
  add constraint employees_contract_type_check check (contract_type in ('', 'CLT', 'PJ', 'ESTAGIO', 'TEMPORARIO'));

-- CPF com digitos verificadores validos.
create or replace function public.rep_cpf_valid(p text)
returns boolean language plpgsql immutable set search_path to '' as $$
declare
  d int[];
  s int;
  i int;
  r int;
begin
  if p !~ '^[0-9]{11}$' or p ~ '^(\d)\1{10}$' then return false; end if;
  d := array(select substr(p, k, 1)::int from generate_series(1, 11) k);
  s := 0;
  for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> d[10] then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = d[11];
end $$;

-- Acesso ao portal acompanha o perfil e a situacao do funcionario (mesma regra da integracao).
create or replace function public.rep_sync_portal_access(p_company uuid, p_employee uuid)
returns text language plpgsql security definer set search_path to '' as $$
declare
  e public.employees%rowtype;
  v_user uuid;
begin
  select * into e from public.employees where id = p_employee and company_id = p_company;
  select p.user_id into v_user from public.portal_users p join auth.users u on u.id = p.user_id
    where p.company_id = p_company and e.email <> '' and lower(u.email) = lower(e.email);
  if e.portal_role = '' or not e.active then
    return case when v_user is null then 'sem_acesso' else public.rep_portal_revoke(p_company, e.email) end;
  elsif v_user is not null then
    update public.portal_users set role = e.portal_role where user_id = v_user and role <> e.portal_role;
    return 'ativo';
  elsif e.email = '' then
    return 'sem_email';
  end if;
  return 'aguardando_primeiro_acesso';
end $$;

create or replace function public.portal_employee_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_admin boolean := exists (select 1 from public.portal_users where user_id = auth.uid() and role = 'admin');
  v_cpf text := regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g');
  v_new boolean := coalesce((p->>'new')::boolean, false);
  v_name text := btrim(coalesce(p->>'name', ''));
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_cur public.employees%rowtype;
  v_op text;
  v_role text;
  v_adm date := nullif(p->>'admitted_on', '')::date;
  v_dis date := nullif(p->>'dismissed_on', '')::date;
  v_birth date := nullif(p->>'birth_date', '')::date;
  v_access text;
begin
  if v_cpf !~ '^[0-9]{11}$' or (v_new and not public.rep_cpf_valid(v_cpf)) then raise exception 'invalid_cpf'; end if;
  if length(v_name) < 3 then raise exception 'missing_fields'; end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email'; end if;
  if v_adm is not null and v_dis is not null and v_dis < v_adm then raise exception 'invalid_period'; end if;
  if v_birth is not null and (v_birth > current_date or v_birth < date '1900-01-01') then
    raise exception 'invalid_birth_date';
  end if;
  if coalesce(p->>'sex', '') not in ('', 'M', 'F') then raise exception 'missing_fields'; end if;
  if coalesce(p->>'contract_type', '') not in ('', 'CLT', 'PJ', 'ESTAGIO', 'TEMPORARIO') then
    raise exception 'missing_fields';
  end if;

  perform 1 from public.companies where id = t.company_id for update;
  select * into v_cur from public.employees where company_id = t.company_id and cpf = v_cpf;
  if v_new and found then raise exception 'cpf_exists'; end if;
  if not v_new and not found then raise exception 'not_found'; end if;
  if v_email <> '' and exists (select 1 from public.employees where company_id = t.company_id
                               and lower(email) = v_email and cpf <> v_cpf) then
    raise exception 'email_in_use';
  end if;

  -- Nome, e-mail e situacao: pelo mesmo caminho do tablet e da integracao (registro tipo 5 do AFD).
  v_op := public.rep_employee_apply(t.company_id, jsonb_build_object(
      'cpf', v_cpf, 'name', v_name, 'email', v_email,
      'active', coalesce((p->>'active')::boolean, true),
      'external_id', coalesce(p->>'external_id', coalesce(v_cur.external_id, ''))),
    t.cpf, null, clock_timestamp());

  update public.employees set
    birth_date = v_birth,
    sex = coalesce(p->>'sex', ''),
    job_title = left(btrim(coalesce(p->>'job_title', '')), 80),
    contract_type = coalesce(p->>'contract_type', ''),
    admitted_on = v_adm,
    dismissed_on = v_dis,
    tablet_responsible = coalesce((p->>'tablet_responsible')::boolean, false)
  where company_id = t.company_id and cpf = v_cpf
  returning * into v_cur;

  -- Obras: lista completa enviada pelo portal (vazia = todas).
  if p ? 'sites' then
    delete from public.employee_sites es where es.employee_id = v_cur.id
      and es.site_id not in (select x::uuid from jsonb_array_elements_text(p->'sites') x);
    insert into public.employee_sites (employee_id, site_id)
      select v_cur.id, s.id from public.sites s
      where s.company_id = t.company_id and s.id in (select x::uuid from jsonb_array_elements_text(p->'sites') x)
      on conflict do nothing;
  end if;

  -- Perfil do portal: so o administrador muda.
  if p ? 'portal_role' then
    v_role := coalesce(p->>'portal_role', '');
    if v_role not in ('', 'admin', 'rh') then raise exception 'missing_fields'; end if;
    if v_role <> v_cur.portal_role then
      if not v_admin then raise exception 'not_allowed'; end if;
      update public.employees set portal_role = v_role where id = v_cur.id;
      perform public.portal_audit('perfil_portal', jsonb_build_object('cpf', v_cpf, 'de', v_cur.portal_role, 'para', v_role));
    end if;
  end if;
  v_access := public.rep_sync_portal_access(t.company_id, v_cur.id);

  perform public.portal_audit(case when v_new then 'funcionario_incluido' else 'funcionario_alterado' end,
    jsonb_build_object('cpf', v_cpf, 'nome', v_name, 'afd', coalesce(v_op, '-')));
  return jsonb_build_object('cpf', v_cpf, 'afd', v_op, 'acesso_portal', v_access);
end $$;

-- Foto de perfil: arquivo no bucket privado 'fotos', pasta da empresa.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] =
              (select pu.company_id::text from public.portal_users pu where pu.user_id = auth.uid()));
create policy fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] =
         (select pu.company_id::text from public.portal_users pu where pu.user_id = auth.uid()));

create or replace function public.portal_employee_photo(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  t record := public.portal_treater();
  v_cpf text := regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g');
  v_path text := coalesce(p->>'path', '');
begin
  if not exists (select 1 from public.employees where company_id = t.company_id and cpf = v_cpf) then
    raise exception 'not_found';
  end if;
  if v_path <> '' and (split_part(v_path, '/', 1) <> t.company_id::text
     or not exists (select 1 from storage.objects where bucket_id = 'fotos' and name = v_path)) then
    raise exception 'invalid_file';
  end if;
  update public.employees set photo_path = v_path, updated_at = now() where company_id = t.company_id and cpf = v_cpf;
  perform public.portal_audit('foto_funcionario', jsonb_build_object('cpf', v_cpf, 'removida', v_path = ''));
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
      'birth_date', e.birth_date, 'sex', e.sex, 'job_title', e.job_title, 'contract_type', e.contract_type,
      'photo_path', e.photo_path,
      'portal_access', exists (select 1 from public.portal_users pu join auth.users u on u.id = pu.user_id
                               where pu.company_id = v_company and e.email <> '' and lower(u.email) = lower(e.email)),
      'site_ids', coalesce((select jsonb_agg(es.site_id) from public.employee_sites es where es.employee_id = e.id), '[]'::jsonb),
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

revoke execute on function public.rep_sync_portal_access(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.portal_employee_save(jsonb), public.portal_employee_photo(jsonb) from public, anon;
grant execute on function public.portal_employee_save(jsonb), public.portal_employee_photo(jsonb),
  public.rep_cpf_valid(text) to authenticated;
