-- Configuracao de envio de e-mail (SMTP) por empresa, editada no portal pelo administrador.
-- A senha nunca fica nesta tabela: vai para o Supabase Vault (criptografada) e so o servidor
-- (service_role) a le, na hora do envio. O portal so ve "senha cadastrada em".

create table if not exists public.mail_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  host text not null default 'smtp.hostinger.com',
  port int not null default 465 check (port in (465, 587)),
  secure boolean not null default true,
  smtp_user text not null default '',
  mail_from text not null default '',
  from_name text not null default 'Ponto Totem',
  secret_id uuid,
  password_set_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
alter table public.mail_settings enable row level security;
revoke all on public.mail_settings from anon, authenticated;

-- Portal: leitura sem a senha.
create or replace function public.portal_mail_get()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  v_company uuid := public.portal_require_admin();
  m public.mail_settings%rowtype;
begin
  select * into m from public.mail_settings where company_id = v_company;
  if not found then
    return jsonb_build_object('host', 'smtp.hostinger.com', 'port', 465, 'secure', true, 'smtp_user', '',
      'mail_from', '', 'from_name', 'Ponto Totem', 'password_set', false, 'password_set_at', null, 'saved', false);
  end if;
  return jsonb_build_object('host', m.host, 'port', m.port, 'secure', m.secure, 'smtp_user', m.smtp_user,
    'mail_from', m.mail_from, 'from_name', m.from_name, 'password_set', m.secret_id is not null,
    'password_set_at', m.password_set_at, 'updated_at', m.updated_at, 'updated_by', m.updated_by, 'saved', true);
end $$;

-- Portal: grava a configuracao; a senha (opcional) vai para o Vault e nao volta.
create or replace function public.portal_mail_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_company uuid := public.portal_require_admin();
  v_host text := lower(trim(coalesce(p->>'host', '')));
  v_port int := coalesce((p->>'port')::int, 465);
  v_secure boolean := coalesce((p->>'secure')::boolean, v_port = 465);
  v_user text := lower(trim(coalesce(p->>'smtp_user', '')));
  v_from text := lower(trim(coalesce(p->>'mail_from', '')));
  v_name text := trim(coalesce(p->>'from_name', 'Ponto Totem'));
  v_pass text := coalesce(p->>'password', '');
  v_secret uuid;
  v_actor text := coalesce((select u.email from auth.users u where u.id = auth.uid()), auth.uid()::text);
  v_changed text[] := '{}';
  old public.mail_settings%rowtype;
begin
  if v_host !~ '^[a-z0-9.-]+\.[a-z]{2,}$' or v_port not in (465, 587) or (v_port = 465) <> v_secure then
    raise exception 'invalid_smtp';
  end if;
  if v_user !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or v_from !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 or length(v_pass) > 200 then
    raise exception 'invalid_smtp';
  end if;

  select * into old from public.mail_settings where company_id = v_company;
  if not found then
    insert into public.mail_settings (company_id) values (v_company) returning * into old;
    v_changed := array['criada'];
  end if;
  if old.host is distinct from v_host then v_changed := array_append(v_changed, 'host'); end if;
  if old.port is distinct from v_port then v_changed := array_append(v_changed, 'porta'); end if;
  if old.smtp_user is distinct from v_user then v_changed := array_append(v_changed, 'usuario'); end if;
  if old.mail_from is distinct from v_from then v_changed := array_append(v_changed, 'remetente'); end if;
  if old.from_name is distinct from v_name then v_changed := array_append(v_changed, 'nome_remetente'); end if;

  v_secret := old.secret_id;
  if v_pass <> '' then
    if v_secret is null then
      v_secret := vault.create_secret(v_pass, 'smtp_password_' || v_company::text, 'Senha SMTP do Ponto Totem');
    else
      perform vault.update_secret(v_secret, v_pass);
    end if;
    v_changed := array_append(v_changed, 'senha');
  end if;

  update public.mail_settings set host = v_host, port = v_port, secure = v_secure, smtp_user = v_user,
    mail_from = v_from, from_name = v_name, secret_id = v_secret,
    password_set_at = case when v_pass <> '' then now() else password_set_at end,
    updated_at = now(), updated_by = v_actor
  where company_id = v_company;

  insert into public.audit_log (actor, action, detail)
    values ('portal:' || v_actor, 'email_configurado',
            jsonb_build_object('company_id', v_company, 'campos', to_jsonb(v_changed), 'porta', v_port));
  return public.portal_mail_get();
end $$;

-- Servidor (service_role): configuracao com a senha, so para o envio.
create or replace function public.rep_mail_config(p_company uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select jsonb_build_object('host', m.host, 'port', m.port, 'secure', m.secure, 'smtp_user', m.smtp_user,
    'mail_from', m.mail_from, 'from_name', m.from_name,
    'password', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = m.secret_id))
  from public.mail_settings m where m.company_id = p_company
$$;

revoke all on function public.portal_mail_get() from public, anon;
revoke all on function public.portal_mail_save(jsonb) from public, anon;
grant execute on function public.portal_mail_get() to authenticated;
grant execute on function public.portal_mail_save(jsonb) to authenticated;
revoke all on function public.rep_mail_config(uuid) from public, anon, authenticated;
grant execute on function public.rep_mail_config(uuid) to service_role;
