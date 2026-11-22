-- rep_timesheet_data passa a incluir os fechamentos individuais em "closed" (com cpf),
-- para o servidor (AEJ) saber quem esta fechado. portal_timesheet so repassa.
alter function public.rep_timesheet_data(uuid, date, date, text) rename to rep_timesheet_base;

create or replace function public.rep_timesheet_data(p_company uuid, p_from date, p_to date, p_cpf text)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v jsonb := public.rep_timesheet_base(p_company, p_from, p_to, p_cpf);
begin
  return jsonb_set(v, '{closed}', coalesce(v->'closed', '[]'::jsonb) || coalesce((select jsonb_agg(jsonb_build_object(
      'start', e.start_date, 'end', e.end_date, 'closed_at', e.closed_at, 'cpf', e.cpf))
    from public.employee_closures e where e.company_id = p_company and e.start_date <= p_to and e.end_date >= p_from
      and (v_cpf = '' or e.cpf = v_cpf)), '[]'::jsonb));
end $$;

revoke all on function public.rep_timesheet_data(uuid, date, date, text) from public, anon, authenticated;
revoke all on function public.rep_timesheet_base(uuid, date, date, text) from public, anon, authenticated;
grant execute on function public.rep_timesheet_data(uuid, date, date, text) to service_role;
grant execute on function public.rep_timesheet_base(uuid, date, date, text) to service_role;

create or replace function public.portal_timesheet(p_from date, p_to date, p_cpf text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  v_company uuid := public.portal_company();
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid_period';
  end if;
  return public.rep_timesheet_data(v_company, p_from, p_to, v_cpf);
end $$;
