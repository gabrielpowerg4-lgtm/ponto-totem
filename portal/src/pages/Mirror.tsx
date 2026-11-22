import { useEffect, useMemo, useState } from "react";
import { br, download, errorText, formatCpf, rpc, SUPABASE_URL, todayIso, type Employee, type Me, type Site } from "../api";
import { computeAll, type Sheet, type TimesheetData } from "../jornada";
import type { MirrorPerson } from "../mirrorPdf";
import { Banner, Empty, Loading, PageHead } from "../ui";
import { photoUrl } from "./EmployeeForm";
import { Hours, PeriodSelect, usePeriods } from "./Treatment";

// Espelho de Ponto Eletronico (Portaria 671, art. 84): so de periodos fechados.

const LOGO = `${SUPABASE_URL}/storage/v1/object/public/publico/marca/logo-semax.jpg`;
const plain = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Mirror({ me }: { me: Me }) {
  const { periods, error: periodError } = usePeriods();
  const closedPeriods = useMemo(() => (periods ?? []).filter((p) => p.closed || (p.employees_closed ?? 0) > 0), [periods]);
  const [start, setStart] = useState("");
  const [data, setData] = useState<TimesheetData | null>(null);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [site, setSite] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    rpc<Employee[]>("portal_employees").then(setEmployees).catch(() => undefined);
    rpc<Site[]>("portal_sites").then(setSites).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!start && closedPeriods.length) setStart(closedPeriods[0].start);
  }, [closedPeriods, start]);

  const period = closedPeriods.find((p) => p.start === start) ?? null;
  useEffect(() => {
    if (!period) return;
    setData(null);
    setError("");
    rpc<TimesheetData>("portal_timesheet", { p_from: period.start, p_to: period.end, p_cpf: "" })
      .then((d) => setData({ ...d, today: todayIso() }))
      .catch((e) => setError(errorText(e, "Não foi possível carregar o período.")));
  }, [period?.start]);

  // Fichas fechadas: o periodo da empresa fechado vale para todos; senao, so os fechados individualmente.
  const { closed, open } = useMemo(() => {
    if (!data || !period) return { closed: [] as Sheet[], open: 0 };
    const company = data.closed.some((c) => !c.cpf && c.start <= period.start && c.end >= period.end);
    const single = new Set(data.closed.filter((c) => c.cpf && c.start === period.start).map((c) => c.cpf!));
    const sheets = computeAll(data).filter((s) => s.days.some((d) => !d.outside_contract));
    const ok = sheets.filter((s) => company || single.has(s.cpf));
    return { closed: ok, open: sheets.length - ok.length };
  }, [data, period?.start]);

  const byCpf = useMemo(() => new Map(employees.map((e) => [e.cpf, e])), [employees]);
  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);
  const list = closed.filter((s) => {
    const e = byCpf.get(s.cpf);
    if (site && !(e?.site_ids ?? []).includes(site)) return false;
    const q = plain(query.trim());
    return !q || plain(s.name).includes(q) || s.cpf.includes(q.replace(/\D/g, "") || "#");
  });

  const generate = async (sheets: Sheet[]) => {
    if (!period || sheets.length === 0) return;
    setBusy(sheets.length === 1 ? sheets[0].cpf : "all");
    setError("");
    try {
      const { buildMirrorPdf, imageData } = await import("../mirrorPdf");
      const paths = sheets.map((s) => byCpf.get(s.cpf)?.photo_path ?? "").filter(Boolean);
      const urls = await photoUrl(paths);
      const [logo, ...photos] = await Promise.all([
        imageData(LOGO),
        ...sheets.map((s) => {
          const path = byCpf.get(s.cpf)?.photo_path ?? "";
          return path && urls[path] ? imageData(urls[path], true) : Promise.resolve(null);
        }),
      ]);
      const people: MirrorPerson[] = sheets.map((s, i) => {
        const e = byCpf.get(s.cpf);
        return {
          sheet: s,
          job_title: e?.job_title ?? "",
          admitted_on: e?.admitted_on ?? null,
          photo: photos[i],
          sites: (e?.site_ids ?? []).map((id) => siteName.get(id) ?? "").filter(Boolean).join(", "),
        };
      });
      const pdf = buildMirrorPdf({
        legal_name: me.legal_name || me.company,
        employer_id: me.employer_id,
        logo,
        period: { start: period.start, end: period.end },
        generated_at: new Date(),
      }, people);
      const who = sheets.length === 1 ? sheets[0].name.split(" ")[0] + "_" + sheets[0].cpf : "todos";
      download(`espelho_${period.start}_${period.end}_${who}.pdf`, pdf);
    } catch (e) {
      setError(errorText(e, "Não foi possível gerar o PDF."));
    }
    setBusy("");
  };

  return (
    <>
      <PageHead
        title="Espelho de Ponto"
        lead="Espelho de ponto eletrônico (Portaria 671, art. 84) dos períodos fechados: marcações, tratamento, totais e banco de horas."
        actions={list.length > 0 && (
          <button className="primary" disabled={!!busy} onClick={() => generate(list)}>
            {busy === "all" ? "Gerando PDF" : `Gerar PDF de ${list.length === closed.length ? "todos" : "filtrados"} (${list.length})`}
          </button>
        )}
      />
      {(periodError || error) && <Banner tone="error">{periodError || error}</Banner>}
      {!periods ? <Loading /> : closedPeriods.length === 0 ? (
        <Empty>Nenhum período fechado ainda. O espelho fica disponível depois do fechamento.</Empty>
      ) : (
        <>
          <div className="card">
            <PeriodSelect periods={closedPeriods} value={start} onChange={setStart} />
            <div className="filters" style={{ marginTop: 12 }}>
              <label>
                Obra
                <select value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">Todas</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="wide">
                Funcionário
                <input value={query} placeholder="Nome ou CPF" onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
          </div>
          {open > 0 && (
            <p className="muted small">
              {open} funcionário(s) ainda com o período aberto não aparecem aqui. Feche-os no Fechamento para gerar o espelho.
            </p>
          )}
          {!data ? <Loading /> : list.length === 0 ? <Empty>Nenhum funcionário fechado com estes filtros.</Empty> : (
            <section className="card flush">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Funcionário</th>
                      <th>Cargo</th>
                      <th className="num">Trabalhadas</th>
                      <th className="num">Banco final</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => {
                      const e = byCpf.get(s.cpf);
                      return (
                        <tr key={s.cpf}>
                          <td>
                            <div className="strong">{s.name}</div>
                            <div className="muted small">{formatCpf(s.cpf)}{e?.admitted_on ? ` · admissão ${br(e.admitted_on)}` : ""}</div>
                          </td>
                          <td>{e?.job_title || <span className="muted">–</span>}</td>
                          <td className="num"><Hours value={s.totals.worked} /></td>
                          <td className="num"><Hours value={s.totals.bank_after} signed /></td>
                          <td className="right">
                            <button className="ghost small" disabled={!!busy} onClick={() => generate([s])}>
                              {busy === s.cpf ? "Gerando" : "PDF"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
