import { useEffect, useMemo, useState } from "react";
import { br, download, formatCpf, rpc, todayIso, type Employee, type Period } from "../api";
import { computeAll, computeEmployee, fmtMin, type Sheet, type TimesheetData } from "../jornada";
import { Badge, Banner, Empty, Loading, PageHead, useLoad } from "../ui";
import { hashParams, Hours, usePeriods } from "./Treatment";

// Consolidado do banco de horas: por periodo, por funcionario ou os dois juntos.
// Meses fechados vem dos lotes gravados; o periodo em aberto entra como previa (calculo do Tratamento).

type Row = {
  cpf: string;
  name: string;
  active?: boolean;
  period_start: string;
  period_end: string;
  before: number;
  extras: number;
  bonus: number;
  debits: number;
  opening: number;
  paid: number;
  discounted: number;
  compensated: number | null;
  after: number;
  preview?: boolean;
};

type BankRow = { cpf: string; expired_credits: number; expired_debits: number };
type LotRef = { id: number; date: string; origin: string; minutes: number };
type Lot = { id: number; date: string; origin: string; minutes: number; remaining: number; consumed: LotRef[] };

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro",
  "Novembro", "Dezembro"];
const SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ym = (date: string) => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) });
const label = (date: string) => `${SHORT[ym(date).m - 1]}/${ym(date).y}`;
const credits = (r: Row) => r.extras + r.bonus + Math.max(r.opening, 0);
const debitsOf = (r: Row) => r.debits + Math.max(-r.opening, 0);
const variation = (r: Row) => r.after - r.before;
const plain = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Linha de previa de um periodo aberto, a partir do calculo do tratamento. */
function previewRow(s: Sheet, p: Period): Row {
  let extras = 0;
  let debits = 0;
  for (const d of s.days) {
    const delta = d.bank_delta - d.bonus;
    if (delta > 0) extras += delta;
    else debits += -delta;
  }
  return {
    cpf: s.cpf, name: s.name, active: s.active, period_start: p.start, period_end: p.end,
    before: s.totals.bank_before, extras, bonus: s.totals.bonus, debits, opening: 0, paid: 0, discounted: 0,
    compensated: null, after: s.totals.bank_after, preview: true,
  };
}

function sumRows(rows: Row[], key: string, p: { start: string; end: string }): Row {
  const sum = (f: (r: Row) => number) => rows.reduce((x, r) => x + f(r), 0);
  return {
    cpf: key, name: "", period_start: p.start, period_end: p.end,
    before: sum((r) => r.before), extras: sum((r) => r.extras), bonus: sum((r) => r.bonus),
    debits: sum((r) => r.debits), opening: sum((r) => r.opening), paid: sum((r) => r.paid),
    discounted: sum((r) => r.discounted),
    compensated: rows.some((r) => r.compensated === null) ? null : sum((r) => r.compensated ?? 0),
    after: sum((r) => r.after), preview: rows.some((r) => r.preview),
  };
}

function setHash(q: Record<string, string>) {
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== ""));
  window.history.replaceState(null, "", `#monthly${s.toString() ? "?" + s.toString() : ""}`);
}

export function Monthly() {
  const params = hashParams();
  const [year, setYear] = useState(params.get("year") ?? "");
  const [month, setMonth] = useState(params.get("month") ?? "");
  const [cpf, setCpf] = useState(params.get("cpf") ?? "");
  const [sit, setSit] = useState(params.get("sit") ?? "");
  const [person, setPerson] = useState("");
  const [sort, setSort] = useState<"name" | "after" | "credits" | "debits">("name");

  const { data: closedRows, error } = useLoad(() => rpc<Row[]>("portal_bank_consolidated", { p: {} }));
  const { data: employees } = useLoad(() => rpc<Employee[]>("portal_employees"));
  const { data: bank } = useLoad(() => rpc<BankRow[]>("portal_hour_bank"));
  const { periods } = usePeriods();
  const [preview, setPreview] = useState<Row[]>([]);

  useEffect(() => setHash({ year, month, cpf, sit }), [year, month, cpf, sit]);
  // Links internos (#monthly?cpf=...) trocam o filtro sem recarregar.
  useEffect(() => {
    const sync = () => {
      const q = hashParams();
      setYear(q.get("year") ?? ""); setMonth(q.get("month") ?? ""); setSit(q.get("sit") ?? "");
      const c = q.get("cpf") ?? "";
      setCpf(c);
      if (!c) setPerson("");
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const emp = employees?.find((e) => e.cpf === cpf) ?? null;
  useEffect(() => { if (emp) setPerson(`${emp.name} · ${formatCpf(emp.cpf)}`); }, [emp?.cpf]);

  // Periodo escolhido (ano + mes).
  const selected = useMemo(() => periods?.find((p) => year && month && ym(p.end).y === Number(year) &&
    ym(p.end).m === Number(month)) ?? null, [periods, year, month]);

  // Previa dos periodos abertos que interessam a consulta.
  useEffect(() => {
    setPreview([]);
    if (!periods || !closedRows) return;
    const today = todayIso();
    const closedKey = new Set(closedRows.map((r) => `${r.cpf}|${r.period_start}`));
    let wanted: Period[] = [];
    if (selected) wanted = selected.closed ? [] : [selected];
    else if (cpf) {
      const last = closedRows.filter((r) => r.cpf === cpf).map((r) => r.period_start).sort().pop() ?? "";
      wanted = periods.filter((p) => !p.closed && p.start > last && p.start <= today).slice(0, 3);
    } else if (!month) wanted = periods.filter((p) => p.current && (!year || ym(p.end).y === Number(year)));
    if (wanted.length === 0) return;
    let alive = true;
    Promise.all(wanted.map((p) => rpc<TimesheetData>("portal_timesheet", { p_from: p.start, p_to: p.end, p_cpf: cpf })
      .then((d) => ({ p, d: { ...d, today } }))))
      .then((list) => {
        if (!alive) return;
        const out: Row[] = [];
        for (const { p, d } of list) {
          for (const s of cpf ? d.employees.filter((e) => e.cpf === cpf).map((e) => computeEmployee(d, e)) : computeAll(d)) {
            if (!closedKey.has(`${s.cpf}|${p.start}`)) out.push(previewRow(s, p));
          }
        }
        setPreview(out);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [periods, closedRows, selected?.start, cpf, year, month]);

  const all = useMemo(() => [...(closedRows ?? []), ...preview], [closedRows, preview]);
  const years = useMemo(() => Array.from(new Set([...(closedRows ?? []).map((r) => ym(r.period_end).y),
    ...(periods ?? []).map((p) => ym(p.end).y)])).sort((a, b) => b - a), [closedRows, periods]);
  const expired = useMemo(() => new Set((bank ?? []).filter((b) => b.expired_credits || b.expired_debits).map((b) => b.cpf)), [bank]);

  const rows = all.filter((r) => (!year || ym(r.period_end).y === Number(year)) &&
    (!month || ym(r.period_end).m === Number(month)) && (!cpf || r.cpf === cpf) &&
    (sit === "" || (sit === "pos" && r.after > 0) || (sit === "neg" && r.after < 0) || (sit === "exp" && expired.has(r.cpf))));

  const pick = (text: string) => {
    setPerson(text);
    if (text.trim() === "") return setCpf("");
    const found = employees?.find((e) => `${e.name} · ${formatCpf(e.cpf)}` === text);
    if (found) setCpf(found.cpf);
  };
  const clear = () => { setYear(""); setMonth(""); setCpf(""); setSit(""); setPerson(""); };

  const mode = cpf && month ? "detail" : cpf ? "history" : month ? "month" : "company";

  const exportCsv = () => {
    const head = "Período;CPF;Nome;Anterior;Extras;Bônus;Débitos;Abertura;Compensado;Pago;Descontado;Variação;Saldo;Situação";
    const lines = rows.map((r) => [`${br(r.period_start)} a ${br(r.period_end)}`, formatCpf(r.cpf), r.name, fmtMin(r.before, true),
      fmtMin(r.extras), fmtMin(r.bonus), fmtMin(r.debits), fmtMin(r.opening, true),
      r.compensated === null ? "" : fmtMin(r.compensated), fmtMin(r.paid), fmtMin(r.discounted),
      fmtMin(variation(r), true), fmtMin(r.after, true), r.preview ? "prévia" : "fechado"].join(";"));
    download(`consolidado-${todayIso()}.csv`, "﻿" + [head, ...lines].join("\n"));
  };

  return (
    <>
      <PageHead
        title="Consolidado mensal"
        lead="Evolução do banco de horas: créditos, débitos, compensações e saldo mês a mês. Mês em aberto aparece como prévia."
        actions={<button className="ghost" onClick={exportCsv} disabled={!closedRows}>Exportar planilha</button>}
      />
      {error && <Banner tone="error">{error}</Banner>}
      <div className="card filters cons-filters">
        <label>
          Ano
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Todos</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Mês
          <select value={month} onChange={(e) => { setMonth(e.target.value); if (e.target.value && !year) setYear(String(years[0] ?? "")); }}>
            <option value="">Todos</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="wide">
          Funcionário
          <input list="cons-employees" value={person} placeholder="Todos (digite nome ou CPF)" onChange={(e) => pick(e.target.value)} />
          <datalist id="cons-employees">
            {(employees ?? []).map((e) => <option key={e.cpf} value={`${e.name} · ${formatCpf(e.cpf)}`} />)}
          </datalist>
        </label>
        <label>
          Situação
          <select value={sit} onChange={(e) => setSit(e.target.value)}>
            <option value="">Todas</option>
            <option value="pos">Saldo positivo</option>
            <option value="neg">Saldo negativo</option>
            <option value="exp">Com saldo vencido</option>
          </select>
        </label>
        <div className="filter-actions"><button className="ghost" onClick={clear}>Limpar</button></div>
      </div>
      <p className="muted small">
        {mode === "detail" && `Situação de ${emp?.name ?? "funcionário"} em ${MONTHS[Number(month) - 1]}/${year}.`}
        {mode === "history" && `Histórico de ${emp?.name ?? "funcionário"}: ${rows.length} período(s).`}
        {mode === "month" && `Todos os funcionários em ${MONTHS[Number(month) - 1]}/${year}: ${rows.length} funcionário(s).`}
        {mode === "company" && `Evolução da empresa${year ? ` em ${year}` : ""}, mês a mês.`}
      </p>

      {!closedRows ? <Loading /> : rows.length === 0 ? (
        <Empty>Nada para mostrar com estes filtros. Só entram períodos fechados e o período em aberto como prévia.</Empty>
      ) : mode === "history" ? (
        <History rows={rows} />
      ) : mode === "detail" ? (
        <Detail row={rows[0]} />
      ) : mode === "month" ? (
        <MonthView rows={rows} sort={sort} setSort={setSort} expired={expired}
          open={(c) => { setCpf(c); }} />
      ) : (
        <CompanyView rows={rows} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pecas
// ---------------------------------------------------------------------------

function Kpis({ rows, current }: { rows: Row[]; current: number }) {
  const sum = (f: (r: Row) => number) => rows.reduce((x, r) => x + f(r), 0);
  const comp = rows.some((r) => r.compensated === null) ? null : sum((r) => r.compensated ?? 0);
  return (
    <div className="stats five">
      <div className="stat"><div className="muted small">Saldo</div><div className="stat-value small-value"><Hours value={current} signed /></div></div>
      <div className="stat">
        <div className="muted small">Créditos</div>
        <div className="stat-value small-value"><Hours value={sum(credits)} signed /></div>
        <div className="muted small">extras {fmtMin(sum((r) => r.extras))} · bônus {fmtMin(sum((r) => r.bonus))}</div>
      </div>
      <div className="stat">
        <div className="muted small">Débitos</div>
        <div className="stat-value small-value"><Hours value={-sum(debitsOf)} signed /></div>
      </div>
      <div className="stat">
        <div className="muted small">Compensado</div>
        <div className="stat-value small-value">{comp === null ? "–" : fmtMin(comp)}</div>
        <div className="muted small">crédito e débito que se anularam</div>
      </div>
      <div className="stat">
        <div className="muted small">Pago / descontado</div>
        <div className="stat-value small-value">{fmtMin(sum((r) => r.paid))} / {fmtMin(sum((r) => r.discounted))}</div>
      </div>
    </div>
  );
}

function Chart({ rows }: { rows: Row[] }) {
  const data = rows.slice(-12);
  if (data.length === 0) return null;
  const W = 760;
  const H = 210;
  const left = 48;
  const top = 14;
  const bottom = 30;
  const max = Math.max(60, ...data.map((r) => Math.max(credits(r), debitsOf(r), Math.abs(r.after))));
  const mid = top + (H - top - bottom) / 2;
  const scale = (H - top - bottom) / 2 / max;
  const step = (W - left - 10) / data.length;
  const bw = Math.min(28, step / 3);
  const line = data.map((r, i) => `${left + step * i + step / 2},${mid - r.after * scale}`).join(" ");
  return (
    <section className="card chart-card">
      <div className="chart-legend">
        <span><i className="lg cred" />Créditos</span><span><i className="lg deb" />Débitos</span>
        <span><i className="lg bal" />Saldo no fim do mês</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Evolução do banco de horas">
        <line x1={left} x2={W - 10} y1={mid} y2={mid} className="axis" />
        <text x={left - 6} y={top + 8} className="tick" textAnchor="end">+{fmtMin(max)}</text>
        <text x={left - 6} y={mid + 4} className="tick" textAnchor="end">0</text>
        <text x={left - 6} y={H - bottom} className="tick" textAnchor="end">-{fmtMin(max)}</text>
        {data.map((r, i) => {
          const x = left + step * i + step / 2;
          return (
            <g key={r.period_start + r.cpf}>
              <rect x={x - bw - 1} y={mid - credits(r) * scale} width={bw} height={credits(r) * scale} className="bar cred" rx="2">
                <title>Créditos {fmtMin(credits(r))}</title>
              </rect>
              <rect x={x + 1} y={mid} width={bw} height={debitsOf(r) * scale} className="bar deb" rx="2">
                <title>Débitos {fmtMin(debitsOf(r))}</title>
              </rect>
              <text x={x} y={H - 8} className="tick" textAnchor="middle">{label(r.period_end)}{r.preview ? "*" : ""}</text>
            </g>
          );
        })}
        <polyline points={line} className="bal-line" />
        {data.map((r, i) => (
          <circle key={i} cx={left + step * i + step / 2} cy={mid - r.after * scale} r="4" className="bal-dot">
            <title>Saldo {fmtMin(r.after, true)}</title>
          </circle>
        ))}
      </svg>
      {data.some((r) => r.preview) && <p className="muted small">* Mês em aberto (prévia).</p>}
    </section>
  );
}

function PeriodTable({ rows, first }: { rows: Row[]; first: "period" | "employee" }) {
  return (
    <section className="card flush">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{first === "period" ? "Mês" : "Funcionário"}</th>
              <th className="num">Anterior</th>
              <th className="num">Créditos</th>
              <th className="num">Débitos</th>
              <th className="num">Compensado</th>
              <th className="num">Pago / desc.</th>
              <th className="num">Variação</th>
              <th className="num">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cpf + r.period_start} className={r.preview ? "preview-row" : ""}>
                <td>
                  {first === "period" ? (
                    <>
                      <div className="strong">{MONTHS[ym(r.period_end).m - 1]}/{ym(r.period_end).y}</div>
                      <div className="muted small">{br(r.period_start)} a {br(r.period_end)}</div>
                    </>
                  ) : (
                    <>
                      <a className="strong" href={`#monthly?cpf=${r.cpf}`}>{r.name}</a>
                      <div className="muted small">{formatCpf(r.cpf)}</div>
                    </>
                  )}
                  {r.preview ? <Badge tone="warn">Em aberto (prévia)</Badge> : null}
                </td>
                <td className="num"><Hours value={r.before} signed /></td>
                <td className="num"><Hours value={credits(r)} signed /></td>
                <td className="num"><Hours value={-debitsOf(r)} signed /></td>
                <td className="num">{r.compensated === null ? <span className="muted">–</span> : fmtMin(r.compensated)}</td>
                <td className="num">{r.paid || r.discounted ? `${fmtMin(r.paid)} / ${fmtMin(r.discounted)}` : <span className="muted">–</span>}</td>
                <td className="num">
                  <Hours value={variation(r)} signed /> <span className={variation(r) < 0 ? "trend neg" : variation(r) > 0 ? "trend pos" : "trend"}>
                    {variation(r) < 0 ? "▼" : variation(r) > 0 ? "▲" : "="}
                  </span>
                </td>
                <td className="num strong"><Hours value={r.after} signed /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function History({ rows }: { rows: Row[] }) {
  const ordered = [...rows].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const last = ordered[ordered.length - 1];
  const tail = ordered.slice(-3);
  const falling = tail.length === 3 && tail.every((r) => variation(r) < 0);
  return (
    <>
      {falling && (
        <Banner tone="warn">Saldo em queda há 3 meses seguidos ({tail.map((r) => label(r.period_end)).join(", ")}).</Banner>
      )}
      <Kpis rows={ordered} current={last?.after ?? 0} />
      <Chart rows={ordered} />
      <PeriodTable rows={[...ordered].reverse()} first="period" />
      {last && <p className="muted small"><a href={`#bank?cpf=${last.cpf}`}>Ver extrato do banco de horas (lotes e abatimentos)</a></p>}
    </>
  );
}

function Detail({ row }: { row: Row }) {
  const [days, setDays] = useState<Sheet | null>(null);
  const [lots, setLots] = useState<Lot[] | null>(null);
  useEffect(() => {
    rpc<TimesheetData>("portal_timesheet", { p_from: row.period_start, p_to: row.period_end, p_cpf: row.cpf })
      .then((d) => { const e = d.employees.find((x) => x.cpf === row.cpf); if (e) setDays(computeEmployee({ ...d, today: todayIso() }, e)); })
      .catch(() => undefined);
    rpc<{ lots: Lot[] }>("portal_bank_statement", { p_cpf: row.cpf })
      .then((s) => setLots(s.lots.filter((l) => l.date >= row.period_start && l.date <= row.period_end)))
      .catch(() => setLots([]));
  }, [row.cpf, row.period_start]);
  const list = days?.days.filter((d) => d.bank_delta !== 0) ?? [];
  const comps = (lots ?? []).flatMap((l) => l.consumed.map((c) => ({ l, c })));
  return (
    <>
      {row.preview && <Banner tone="warn">Período em aberto: valores de prévia, calculados como no Tratamento.</Banner>}
      <Kpis rows={[row]} current={row.after} />
      <div className="detail-grid">
        <section className="card flush">
          <div className="card-head pad"><h2>Dias que movimentaram o banco</h2>
            <a className="ghost button small" href={`#treatment?cpf=${row.cpf}&start=${row.period_start}`}>Abrir no Tratamento</a>
          </div>
          {!days ? <Loading /> : list.length === 0 ? <Empty>Nenhum dia com saldo.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Dia</th><th className="num">Saldo</th><th className="num">Bônus</th><th className="num">Banco</th></tr></thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.date}>
                      <td className="nowrap">{br(d.date)}</td>
                      <td className="num"><Hours value={d.balance} signed /></td>
                      <td className="num">{d.bonus ? fmtMin(d.bonus) : <span className="muted">–</span>}</td>
                      <td className="num"><Hours value={d.bank_delta} signed /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card flush">
          <div className="card-head pad"><h2>Compensações do mês</h2></div>
          {row.preview ? <Empty>As compensações são calculadas no fechamento.</Empty> : !lots ? <Loading /> : comps.length === 0 ? (
            <Empty>Nenhuma compensação neste mês.</Empty>
          ) : (
            <ul className="mark-list pad">
              {comps.map(({ l, c }, i) => (
                <li key={i} className="small">
                  {br(l.date)} ({fmtMin(l.minutes, true)}) abateu {fmtMin(c.minutes)} do lote de {br(c.date)}
                  {c.origin === "bonus" ? " (bônus)" : c.origin === "abertura" ? " (abertura)" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function MonthView({ rows, sort, setSort, expired, open }: {
  rows: Row[];
  sort: "name" | "after" | "credits" | "debits";
  setSort: (s: "name" | "after" | "credits" | "debits") => void;
  expired: Set<string>;
  open: (cpf: string) => void;
}) {
  const sorted = [...rows].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name)
    : sort === "after" ? b.after - a.after : sort === "credits" ? credits(b) - credits(a) : debitsOf(b) - debitsOf(a));
  const top = [...rows].sort((a, b) => b.after - a.after);
  const pos = top.filter((r) => r.after > 0).slice(0, 5);
  const neg = [...top].reverse().filter((r) => r.after < 0).slice(0, 5);
  const total = rows.reduce((x, r) => x + r.after, 0);
  return (
    <>
      <Kpis rows={rows} current={total} />
      <div className="detail-grid">
        <section className="card">
          <h2>Maiores saldos positivos</h2>
          {pos.length === 0 ? <p className="muted small">Nenhum.</p> : <ol className="rank">{pos.map((r) => (
            <li key={r.cpf}><button className="link" onClick={() => open(r.cpf)}>{r.name}</button><Hours value={r.after} signed /></li>
          ))}</ol>}
        </section>
        <section className="card">
          <h2>Maiores saldos negativos</h2>
          {neg.length === 0 ? <p className="muted small">Nenhum.</p> : <ol className="rank">{neg.map((r) => (
            <li key={r.cpf}><button className="link" onClick={() => open(r.cpf)}>{r.name}</button><Hours value={r.after} signed /></li>
          ))}</ol>}
        </section>
      </div>
      <div className="toolbar">
        <span className="muted small">Ordenar por</span>
        <div className="segmented">
          {([["name", "Nome"], ["after", "Saldo"], ["credits", "Créditos"], ["debits", "Débitos"]] as const).map(([k, v]) => (
            <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{v}</button>
          ))}
        </div>
        {rows.some((r) => expired.has(r.cpf)) && <span className="muted small">{rows.filter((r) => expired.has(r.cpf)).length} com saldo vencido</span>}
      </div>
      <PeriodTable rows={sorted} first="employee" />
    </>
  );
}

function CompanyView({ rows }: { rows: Row[] }) {
  const byPeriod = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.period_end.slice(0, 7);
    byPeriod.set(k, [...(byPeriod.get(k) ?? []), r]);
  }
  const months = Array.from(byPeriod.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, list]) =>
    sumRows(list, k, { start: list.map((r) => r.period_start).sort()[0], end: list.map((r) => r.period_end).sort().pop()! }));
  const last = months[months.length - 1];
  return (
    <>
      <Kpis rows={months} current={last?.after ?? 0} />
      <Chart rows={months} />
      <PeriodTable rows={[...months].reverse()} first="period" />
      <p className="muted small">Escolha um mês para ver cada funcionário, ou um funcionário para ver o histórico dele.</p>
    </>
  );
}
