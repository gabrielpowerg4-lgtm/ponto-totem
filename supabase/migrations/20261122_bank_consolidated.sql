-- Consolidado do banco de horas: uma linha por funcionario por periodo fechado.
-- before + extras + bonus - debits + opening - paid + discounted = after (compensated e informativo).
CREATE OR REPLACE FUNCTION public.portal_bank_consolidated(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid := public.portal_company();
  v_cpf text := nullif(regexp_replace(coalesce(p->>'cpf', ''), '[^0-9]', '', 'g'), '');
  v_year int := nullif(p->>'year', '')::int;
  v_month int := nullif(p->>'month', '')::int;
begin
  return coalesce((select jsonb_agg(r order by r->>'period_end', r->>'name') from (
    select jsonb_build_object(
      'cpf', f.cpf, 'name', e.name, 'active', e.active, 'period_start', f.period_start, 'period_end', f.period_end,
      'expected', f.expected, 'worked', f.worked,
      'before', public.rep_bank_balance_before(v_company, f.cpf, f.period_start),
      'extras', coalesce(sum(l.minutes) filter (where l.origin = 'dia' and l.minutes > 0), 0),
      'bonus', coalesce(sum(l.minutes) filter (where l.origin = 'bonus'), 0),
      'debits', coalesce(-sum(l.minutes) filter (where l.origin = 'dia' and l.minutes < 0), 0),
      'opening', coalesce(sum(l.minutes) filter (where l.origin = 'abertura'), 0),
      'paid', coalesce(-sum(l.minutes) filter (where l.origin = 'pagamento'), 0),
      'discounted', coalesce(sum(l.minutes) filter (where l.origin = 'desconto'), 0),
      'compensated', coalesce((select sum(a.minutes) from public.bank_allocations a
          join public.bank_lots lc on lc.id = a.lot_id join public.bank_lots lt on lt.id = a.target_id
          where a.company_id = v_company and a.cpf = f.cpf
            and lc.lot_date between f.period_start and f.period_end
            and lc.origin in ('dia', 'bonus', 'abertura') and lt.origin in ('dia', 'bonus', 'abertura')), 0),
      'after', public.rep_bank_balance_before(v_company, f.cpf, f.period_end + 1)) as r
    from (select t.cpf, t.period_start, max(t.day) as period_end, sum(t.expected) as expected, sum(t.worked) as worked
          from public.timesheet_days t
          where t.company_id = v_company and (v_cpf is null or t.cpf = v_cpf)
          group by t.cpf, t.period_start) f
    join public.employees e on e.company_id = v_company and e.cpf = f.cpf
    left join lateral (select * from public.rep_bank_active(v_company, f.cpf) x
                       where x.lot_date between f.period_start and f.period_end) l on true
    where (v_year is null or extract(year from f.period_end) = v_year)
      and (v_month is null or extract(month from f.period_end) = v_month)
    group by f.cpf, e.name, e.active, f.period_start, f.period_end, f.expected, f.worked) q), '[]'::jsonb);
end $function$;

revoke all on function public.portal_bank_consolidated(jsonb) from public, anon;
grant execute on function public.portal_bank_consolidated(jsonb) to authenticated;
