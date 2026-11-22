-- Comprovante de Registro de Ponto do Trabalhador por e-mail.
-- Cada marcacao nova entra numa fila (gatilho em punches) quando a empresa ativou o envio e o
-- funcionario tem e-mail. Um agendador (pg_cron, a cada minuto) chama a funcao rep, que envia e
-- registra o resultado; falhas sao tentadas de novo ate 5 vezes.

alter table public.companies add column if not exists receipt_email boolean not null default false;

create table if not exists public.punch_receipts (
  punch_id uuid primary key references public.punches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviado', 'falhou')),
  attempts int not null default 0,
  last_error text,
  next_try_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists punch_receipts_queue on public.punch_receipts (status, next_try_at);
create index if not exists punch_receipts_company on public.punch_receipts (company_id, created_at desc);
alter table public.punch_receipts enable row level security;
revoke all on public.punch_receipts from anon, authenticated;

create or replace function public.rep_receipt_enqueue()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.companies c where c.id = new.company_id and c.receipt_email)
     and exists (select 1 from public.employees e where e.company_id = new.company_id and e.cpf = new.cpf
                 and e.active and e.email ~ '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$') then
    insert into public.punch_receipts (punch_id, company_id) values (new.id, new.company_id)
      on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists punches_receipt_email on public.punches;
create trigger punches_receipt_email after insert on public.punches
  for each row execute function public.rep_receipt_enqueue();

-- Servidor: separa ate p_limit comprovantes para enviar (sem pegar o mesmo duas vezes).
create or replace function public.rep_receipts_claim(p_limit int default 40)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v jsonb;
begin
  with picked as (
    select r.punch_id from public.punch_receipts r
    where (r.status in ('pendente', 'falhou') and r.next_try_at <= now() and r.attempts < 5)
       or (r.status = 'enviando' and r.claimed_at < now() - interval '10 minutes')
    order by r.created_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  ), upd as (
    update public.punch_receipts r set status = 'enviando', claimed_at = now(), attempts = r.attempts + 1
    from picked where r.punch_id = picked.punch_id
    returning r.punch_id, r.company_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'punch_id', p.id, 'company_id', p.company_id, 'nsr', p.nsr, 'hash', p.hash, 'online', p.online,
      'marked_at', p.marked_at, 'timezone', c.timezone,
      'marked_local', to_char(p.marked_at at time zone c.timezone, 'DD/MM/YYYY HH24:MI'),
      'legal_name', c.legal_name, 'employer_id', coalesce(c.cnpj, ''), 'id_type', c.id_type,
      'site', coalesce(s.name, ''), 'site_address', coalesce(s.address, ''), 'terminal', coalesce(t.code, ''),
      'name', e.name, 'cpf', e.cpf, 'email', e.email,
      'inpi', (select r.inpi_number from public.rep_settings r limit 1))), '[]'::jsonb)
    into v
  from upd
  join public.punches p on p.id = upd.punch_id
  join public.companies c on c.id = p.company_id
  join public.employees e on e.company_id = p.company_id and e.cpf = p.cpf
  left join public.sites s on s.id = p.site_id
  left join public.terminals t on t.id = p.terminal_id;
  return v;
end $$;

-- Servidor: grava o resultado de cada envio.
create or replace function public.rep_receipts_done(p jsonb)
returns void language plpgsql security definer set search_path to '' as $$
begin
  update public.punch_receipts r set
    status = case when (x->>'ok')::boolean then 'enviado' else 'falhou' end,
    sent_at = case when (x->>'ok')::boolean then now() else r.sent_at end,
    last_error = case when (x->>'ok')::boolean then null else left(coalesce(x->>'error', 'smtp_failed'), 60) end,
    next_try_at = case when (x->>'ok')::boolean then r.next_try_at
                       else now() + (interval '5 minutes' * power(2, greatest(r.attempts - 1, 0))) end
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
  where r.punch_id = (x->>'punch_id')::uuid;
end $$;

-- Portal: ligar/desligar e acompanhar o envio.
create or replace function public.portal_receipt_email_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
begin
  return jsonb_build_object(
    'enabled', (select receipt_email from public.companies where id = v_company),
    'sent_today', (select count(*) from public.punch_receipts where company_id = v_company and status = 'enviado'
                   and sent_at >= date_trunc('day', now())),
    'pending', (select count(*) from public.punch_receipts where company_id = v_company and status in ('pendente', 'enviando')),
    'failed', (select count(*) from public.punch_receipts where company_id = v_company and status = 'falhou'),
    'without_email', (select count(*) from public.employees where company_id = v_company and active
                      and coalesce(email, '') !~ '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$'),
    'last_error', (select last_error from public.punch_receipts where company_id = v_company and status = 'falhou'
                   order by created_at desc limit 1));
end $$;

create or replace function public.portal_receipt_email_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := public.portal_require_admin();
  v_on boolean := coalesce((p->>'enabled')::boolean, false);
begin
  update public.companies set receipt_email = v_on where id = v_company;
  perform public.portal_audit('comprovante_email', jsonb_build_object('ativo', v_on));
  return public.portal_receipt_email_get();
end $$;

revoke all on function public.rep_receipts_claim(int) from public, anon, authenticated;
revoke all on function public.rep_receipts_done(jsonb) from public, anon, authenticated;
grant execute on function public.rep_receipts_claim(int) to service_role;
grant execute on function public.rep_receipts_done(jsonb) to service_role;
revoke all on function public.portal_receipt_email_get() from public, anon;
revoke all on function public.portal_receipt_email_set(jsonb) from public, anon;
grant execute on function public.portal_receipt_email_get() to authenticated;
grant execute on function public.portal_receipt_email_set(jsonb) to authenticated;

-- Agendador: a cada minuto (mesma chave do Vault usada pelos avisos de documentos).
select cron.unschedule('receipt-email') where exists (select 1 from cron.job where jobname = 'receipt-email');
select cron.schedule('receipt-email', '* * * * *', $job$
  select net.http_post(
    url := 'https://mplacscrqtlgxmtkcrig.supabase.co/functions/v1/rep/v1/cron/receipts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_doc_alerts_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)
  where exists (select 1 from public.punch_receipts r
                where (r.status in ('pendente', 'falhou') and r.next_try_at <= now() and r.attempts < 5)
                   or (r.status = 'enviando' and r.claimed_at < now() - interval '10 minutes'))
$job$);
