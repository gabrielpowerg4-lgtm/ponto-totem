import { useMemo, useState } from "react";
import { br, download, errorText, formatCpf, rpc, todayIso, type Employee, type Me } from "../api";
import { fmtMin } from "../jornada";
import { askText, Badge, Banner, Empty, Loading, PageHead, useLoad } from "../ui";
import { hashParams, Hours } from "./Treatment";

// Banco de horas por lotes: cada dia fechado gera um lote com data, vencimento e percentual.
// Compensacoes, pagamentos e descontos abatem sempre os lotes mais antigos (FIFO).

type BankRow = {
  cpf: string;
  name: string;
  active: boolean;
  balance: number;
  credits: number;
  debits: number;
  expired_credits: number;
  expired_debits: number;
  expiring: number;
  next_expiry: string | null;
  last_day: string | null;
};

type LotRef = { id: number; date: string; origin: string; minutes: number };
type Lot = {
  id: number;
  date: string;
  origin: string;
  minutes: number;
  pct: number | null;
  expires_on: string | null;
  remaining: number;
  note: string | null;
  expired: boolean;
  settlement_id: string | null;
  consumed: LotRef[];
  consumed_by: LotRef[];
};
type Preview = {
  kind: string;
  minutes: number;
  available: number;
  items: { lot_id: number; date: string; origin: string; pct: number | null; expires_on: string | null; minutes: number }[];
  by_pct: { pct: number | null; minutes: number }[];
};
type Settlement = {
  id: string;
  kind: "pagamento" | "desconto";
  minutes: number;
  competence: string;
  date: string;
  reason: string;
  detail: Preview;
  by: string;
  at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
};
type Statement = { today: string; lots: Lot[]; settlements: Settlement[] };

export const ORIGIN_LABEL: Record<string, string> = {
  dia: "Dia",
  bonus: "Bônus",
  abertura: "Saldo de abertura",
  pagamento: "Pagamento",
  desconto: "Desconto",
};

const pctText = (p: number | null) => (p === null || p === undefined ? "–" : `${p}%`);
const byPctText = (list: { pct: number | null; minutes: number }[]) =>
  list.map((x) => `${fmtMin(x.minutes)} a ${pctText(x.pct)}`).join(" · ");

function parseHours(v: string): number {
  const m = v.trim().match(/^(\d{1,4})(?::(\d{1,2}))?$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}

// ---------------------------------------------------------------------------
// Saldos
// ---------------------------------------------------------------------------

export function HourBank() {
  const params = hashParams();
  const cpf = params.get("cpf");
  if (cpf) return <BankStatement cpf={cpf} />;
  return <BankList />;
}

function BankList() {
  const { data, error } = useLoad(() => rpc<BankRow[]>("portal_hour_bank"));
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "pos" | "neg" | "expired" | "expiring">("all");
  const list = useMemo(() => (data ?? []).filter((r) => {
    if (only === "pos" && r.balance <= 0) return false;
    if (only === "neg" && r.balance >= 0) return false;
    if (only === "expired" && !r.expired_credits && !r.expired_debits) return false;
    if (only === "expiring" && !r.expiring) return false;
    const q = query.trim().toLowerCase();
    return !q || r.name.toLowerCase().includes(q) || r.cpf.includes(q.replace(/\D/g, "") || "#");
  }), [data, query, only]);
  const total = (data ?? []).reduce((x, r) => x + r.balance, 0);
  const expiredCount = (data ?? []).filter((r) => r.expired_credits || r.expired_debits).length;

  const exportCsv = () => {
    const head = "CPF;Nome;Créditos em aberto;Débitos em aberto;Saldo;Vencido positivo;Vencido negativo;A vencer;Próximo vencimento";
    const rows = list.map((r) => [formatCpf(r.cpf), r.name, fmtMin(r.credits), fmtMin(r.debits), fmtMin(r.balance),
      fmtMin(r.expired_credits), fmtMin(r.expired_debits), fmtMin(r.expiring), r.next_expiry ? br(r.next_expiry) : ""].join(";"));
    download(`banco-de-horas-${todayIso()}.csv`, "﻿" + [head, ...rows].join("\n"));
  };

  return (
    <>
      <PageHead
        title="Banco de horas"
        lead="Saldo dos períodos fechados, por lotes com data e vencimento. Abra um funcionário para ver o extrato."
        actions={<button className="ghost" onClick={exportCsv} disabled={!data}>Exportar planilha</button>}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {expiredCount > 0 && (
        <Banner tone="warn">
          {expiredCount} funcionário(s) com saldo vencido. Lotes vencidos continuam compensando, mas precisam de
          decisão do RH em Quitação.
        </Banner>
      )}
      <div className="toolbar">
        <input className="search" placeholder="Buscar por nome ou CPF" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="segmented">
          <button className={only === "all" ? "on" : ""} onClick={() => setOnly("all")}>Todos</button>
          <button className={only === "pos" ? "on" : ""} onClick={() => setOnly("pos")}>Positivo</button>
          <button className={only === "neg" ? "on" : ""} onClick={() => setOnly("neg")}>Negativo</button>
          <button className={only === "expired" ? "on" : ""} onClick={() => setOnly("expired")}>Vencidos</button>
          <button className={only === "expiring" ? "on" : ""} onClick={() => setOnly("expiring")}>A vencer</button>
        </div>
      </div>
      {data && <p className="muted small">Saldo total da empresa: {fmtMin(total, true)} · mostrando {list.length}</p>}
      <section className="card flush">
        {!data ? <Loading /> : list.length === 0 ? <Empty>Nenhum saldo. O banco começa a contar no primeiro período fechado.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th className="num">Créditos</th>
                  <th className="num">Débitos</th>
                  <th className="num">Saldo</th>
                  <th className="num">Vencido</th>
                  <th>Próximo vencimento</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.cpf} className={r.active ? "" : "dim"}>
                    <td>
                      <div className="strong">{r.name}</div>
                      <div className="muted small">{formatCpf(r.cpf)}{r.active ? "" : " · desligado"}</div>
                    </td>
                    <td className="num">{fmtMin(r.credits)}</td>
                    <td className="num">{fmtMin(-r.debits)}</td>
                    <td className="num"><Hours value={r.balance} signed /></td>
                    <td className="num">
                      {r.expired_credits || r.expired_debits
                        ? <Badge tone="warn">{fmtMin(r.expired_credits + r.expired_debits, true)}</Badge>
                        : <span className="muted">–</span>}
                    </td>
                    <td className="nowrap">
                      {r.next_expiry ? br(r.next_expiry) : <span className="muted">–</span>}
                      {r.expiring ? <div className="muted small">{fmtMin(r.expiring, true)} a vencer</div> : null}
                    </td>
                    <td className="right">
                      <a className="ghost small button" href={`#bank?cpf=${r.cpf}`}>Extrato</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Extrato do funcionario
// ---------------------------------------------------------------------------

function BankStatement({ cpf }: { cpf: string }) {
  const { data, error } = useLoad(() => rpc<Statement>("portal_bank_statement", { p_cpf: cpf }), [cpf]);
  const { data: employees } = useLoad(() => rpc<Employee[]>("portal_employees"));
  const emp = employees?.find((e) => e.cpf === cpf);
  const [open, setOpen] = useState<number | null>(null);
  const lots = data?.lots ?? [];
  const balance = lots.reduce((x, l) => x + l.remaining, 0);

  const exportCsv = () => {
    const head = "Data;Origem;Horas;Percentual;Vence em;Em aberto;Situação";
    const rows = lots.map((l) => [br(l.date), ORIGIN_LABEL[l.origin] ?? l.origin, fmtMin(l.minutes, true), pctText(l.pct),
      l.expires_on ? br(l.expires_on) : "", fmtMin(l.remaining, true), l.remaining === 0 ? "Quitado" : l.expired ? "Vencido" : "Em aberto"].join(";"));
    download(`extrato-banco-${cpf}.csv`, "﻿" + [head, ...rows].join("\n"));
  };

  return (
    <>
      <PageHead
        title={emp ? `Extrato · ${emp.name}` : "Extrato do banco de horas"}
        lead="Cada lote mostra o que ainda está em aberto e quais lotes o abateram. Os mais antigos são sempre abatidos primeiro."
        actions={<>
          <a className="ghost button" href="#bank">Voltar</a>
          <a className="ghost button" href={`#settlements?cpf=${cpf}`}>Quitar</a>
          <button className="ghost" onClick={exportCsv} disabled={!data}>Exportar</button>
        </>}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {!data ? <Loading /> : (
        <>
          <div className="stats">
            <div className="stat"><div className="muted small">Saldo</div><div className="stat-value small-value"><Hours value={balance} signed /></div></div>
            <div className="stat"><div className="muted small">Em aberto positivo</div><div className="stat-value small-value">{fmtMin(lots.reduce((x, l) => x + Math.max(0, l.remaining), 0))}</div></div>
            <div className="stat"><div className="muted small">Em aberto negativo</div><div className="stat-value small-value">{fmtMin(lots.reduce((x, l) => x + Math.max(0, -l.remaining), 0))}</div></div>
            <div className="stat"><div className="muted small">Vencido</div><div className="stat-value small-value">{fmtMin(lots.filter((l) => l.expired).reduce((x, l) => x + l.remaining, 0), true)}</div></div>
          </div>
          <section className="card flush">
            {lots.length === 0 ? <Empty>Sem lançamentos no banco.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Origem</th>
                      <th className="num">Horas</th>
                      <th className="num">%</th>
                      <th>Vence em</th>
                      <th className="num">Em aberto</th>
                      <th>Situação</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((l) => (
                      <LotRows key={l.id} lot={l} open={open === l.id} toggle={() => setOpen(open === l.id ? null : l.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {data.settlements.length > 0 && (
            <section className="card flush">
              <div className="card-head pad"><h2>Pagamentos e descontos</h2></div>
              <SettlementTable rows={data.settlements.map((s) => ({ ...s, cpf, name: emp?.name ?? "", by_pct: s.detail?.by_pct ?? [] }))} />
            </section>
          )}
        </>
      )}
    </>
  );
}

function LotRows({ lot, open, toggle }: { lot: Lot; open: boolean; toggle: () => void }) {
  const status = lot.remaining === 0
    ? <Badge tone="ok">Quitado</Badge>
    : lot.expired ? <Badge tone="warn">Vencido</Badge> : <Badge tone="neutral">Em aberto</Badge>;
  const links = [...lot.consumed.map((c) => ({ ...c, verb: "abateu" })), ...lot.consumed_by.map((c) => ({ ...c, verb: "abatido por" }))];
  return (
    <>
      <tr className={lot.remaining === 0 ? "dim" : ""}>
        <td className="nowrap">{br(lot.date)}</td>
        <td>{ORIGIN_LABEL[lot.origin] ?? lot.origin}{lot.note ? <div className="muted small">{lot.note}</div> : null}</td>
        <td className="num"><Hours value={lot.minutes} signed /></td>
        <td className="num">{pctText(lot.pct)}</td>
        <td className="nowrap">{lot.expires_on ? br(lot.expires_on) : <span className="muted">–</span>}</td>
        <td className="num"><Hours value={lot.remaining} signed /></td>
        <td>{status}</td>
        <td className="right">
          {links.length > 0 && <button className={open ? "ghost small on" : "ghost small"} onClick={toggle}>Abatimentos</button>}
        </td>
      </tr>
      {open && (
        <tr className="panel-row">
          <td colSpan={8}>
            <ul className="mark-list">
              {links.map((c, i) => (
                <li key={i} className="small">
                  {c.verb === "abateu" ? "Abateu" : "Abatido por"} {fmtMin(c.minutes)} do lote {ORIGIN_LABEL[c.origin]?.toLowerCase() ?? c.origin} de {br(c.date)}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Quitacao: pagamento de horas positivas, desconto de horas negativas
// ---------------------------------------------------------------------------

type SettlementRow = {
  id: string; cpf: string; name: string; kind: "pagamento" | "desconto"; minutes: number; competence: string; date: string;
  reason: string; by: string; at: string; by_pct: { pct: number | null; minutes: number }[]; revoked_at: string | null;
};

function SettlementTable({ rows, onRevoke }: { rows: SettlementRow[]; onRevoke?: (r: SettlementRow) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Lançado em</th>
            <th>Funcionário</th>
            <th>Tipo</th>
            <th className="num">Horas</th>
            <th>Por percentual</th>
            <th>Competência</th>
            <th>Motivo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className={s.revoked_at ? "dim" : ""}>
              <td className="nowrap small">{br(s.date)}<div className="muted small">CPF {formatCpf(s.by)}</div></td>
              <td>{s.name}<div className="muted small">{formatCpf(s.cpf)}</div></td>
              <td>{s.kind === "pagamento" ? "Pagamento" : "Desconto"}{s.revoked_at && <div><Badge tone="neutral">Estornado</Badge></div>}</td>
              <td className="num">{fmtMin(s.minutes)}</td>
              <td className="small">{byPctText(s.by_pct ?? [])}</td>
              <td className="nowrap">{s.competence.slice(5)}/{s.competence.slice(0, 4)}</td>
              <td className="small">{s.reason}</td>
              <td className="right">
                {onRevoke && !s.revoked_at && <button className="link small" onClick={() => onRevoke(s)}>Estornar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Settlements({ me, goAccount }: { me: Me; goAccount: () => void }) {
  const params = hashParams();
  const { data: employees } = useLoad(() => rpc<Employee[]>("portal_employees"));
  const { data: bank, reload: reloadBank } = useLoad(() => rpc<BankRow[]>("portal_hour_bank"));
  const thisMonth = todayIso().slice(0, 7);
  const [competence, setCompetence] = useState("");
  const { data: rows, error, reload } = useLoad(
    () => rpc<SettlementRow[]>("portal_bank_settlements", { p: { competence } }), [competence]);
  const [form, setForm] = useState({ cpf: params.get("cpf") ?? "", kind: "pagamento", hours: "", competence: thisMonth, reason: "" });
  const [person, setPerson] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const needsCpf = me.cpf.length !== 11;

  const label = (e: Employee) => `${e.name} · ${formatCpf(e.cpf)}`;
  const emp = employees?.find((e) => e.cpf === form.cpf);
  const row = bank?.find((r) => r.cpf === form.cpf);
  if (emp && !person) setPerson(label(emp));

  const pick = (text: string) => {
    setPerson(text);
    const found = employees?.find((e) => label(e) === text);
    setForm({ ...form, cpf: found?.cpf ?? "" });
    setPreview(null);
  };

  const doPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setPreview(null);
    const minutes = parseHours(form.hours);
    if (!form.cpf || minutes <= 0) return setMsg({ tone: "error", text: "Escolha o funcionário e informe as horas (ex.: 12:30)." });
    try {
      setPreview(await rpc<Preview>("portal_bank_preview", { p: { cpf: form.cpf, kind: form.kind, minutes } }));
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
  };

  const confirm = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await rpc("portal_bank_settle", {
        p: { cpf: form.cpf, kind: form.kind, minutes: parseHours(form.hours), competence: form.competence, reason: form.reason },
      });
      setMsg({ tone: "ok", text: `${form.kind === "pagamento" ? "Pagamento" : "Desconto"} registrado.` });
      setPreview(null);
      setForm({ ...form, hours: "", reason: "" });
      reload();
      reloadBank();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
    setBusy(false);
  };

  const revoke = async (s: SettlementRow) => {
    const reason = await askText(`Motivo para estornar o ${s.kind} de ${fmtMin(s.minutes)} de ${s.name}:`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await rpc("portal_bank_settlement_revoke", { p: { id: s.id, reason } });
      reload();
      reloadBank();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
  };

  const available = row ? (form.kind === "pagamento" ? row.credits : -row.debits) : 0;

  return (
    <>
      <PageHead
        title="Quitação do banco de horas"
        lead="Pagamento de horas positivas ou desconto de horas negativas. O sistema abate os lotes mais antigos primeiro e registra quais foram quitados."
      />
      {needsCpf && (
        <Banner tone="warn">
          Para quitar horas é preciso o seu CPF (fica registrado em cada lançamento).{" "}
          <button className="link inline" onClick={goAccount}>Ir para Meus dados</button>
        </Banner>
      )}
      <form className="card form" onSubmit={doPreview}>
        <div className="grid-2">
          <label>
            Funcionário
            <input list="settle-employees" value={person} placeholder="Nome ou CPF" onChange={(e) => pick(e.target.value)} />
            <datalist id="settle-employees">
              {(employees ?? []).map((e) => <option key={e.cpf} value={label(e)} />)}
            </datalist>
            {row && (
              <span className="hint">
                Saldo {fmtMin(row.balance, true)} · positivo em aberto {fmtMin(row.credits)} · negativo em aberto {fmtMin(-row.debits)}
                {row.expired_credits || row.expired_debits ? ` · vencido ${fmtMin(row.expired_credits + row.expired_debits, true)}` : ""}
              </span>
            )}
          </label>
          <label>
            Tipo
            <select value={form.kind} onChange={(e) => { setForm({ ...form, kind: e.target.value }); setPreview(null); }}>
              <option value="pagamento">Pagamento de horas positivas</option>
              <option value="desconto">Desconto de horas negativas</option>
            </select>
          </label>
        </div>
        <div className="grid-2">
          <label>
            Horas (HH:MM)
            <input value={form.hours} placeholder="12:30" onChange={(e) => { setForm({ ...form, hours: e.target.value }); setPreview(null); }} />
            {row && <span className="hint">Disponível: {fmtMin(available)}{" "}
              {available > 0 && <button type="button" className="link inline" onClick={() => setForm({ ...form, hours: fmtMin(available) })}>usar tudo</button>}
            </span>}
          </label>
          <label>
            Competência da folha
            <input type="month" value={form.competence} onChange={(e) => setForm({ ...form, competence: e.target.value })} required />
          </label>
        </div>
        <label>
          Motivo
          <input value={form.reason} placeholder="Ex.: pagamento das horas vencidas na folha de novembro" minLength={3}
            onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
        </label>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <button className="ghost" type="submit" disabled={needsCpf}>Ver prévia</button>
        {preview && (
          <div className="preview">
            <h3>Lotes que serão abatidos</h3>
            <ul className="mark-list">
              {preview.items.map((i) => (
                <li key={i.lot_id} className="small">
                  {fmtMin(i.minutes)} do lote {ORIGIN_LABEL[i.origin]?.toLowerCase() ?? i.origin} de {br(i.date)} ({pctText(i.pct)})
                  {i.expires_on && i.expires_on <= todayIso() ? <> <Badge tone="warn">vencido</Badge></> : null}
                </li>
              ))}
            </ul>
            <p className="strong">Para a folha: {byPctText(preview.by_pct)}</p>
            <button className="primary" type="button" disabled={busy || form.reason.trim().length < 3} onClick={confirm}>
              {busy ? "Registrando" : `Confirmar ${form.kind === "pagamento" ? "pagamento" : "desconto"} de ${fmtMin(preview.minutes)}`}
            </button>
          </div>
        )}
      </form>

      <section className="card flush">
        <div className="card-head pad">
          <h2>Lançamentos</h2>
          <label className="inline">
            Competência
            <input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} />
            {competence && <button className="link small" onClick={() => setCompetence("")}>todas</button>}
          </label>
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nenhum pagamento ou desconto.</Empty> : (
          <SettlementTable rows={rows} onRevoke={needsCpf ? undefined : revoke} />
        )}
        <p className="muted small pad">Só o lançamento mais recente de cada funcionário pode ser estornado.</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Consolidado mensal
// ---------------------------------------------------------------------------

type MonthRow = {
  cpf: string; name: string; period_start: string; period_end: string; expected: number; worked: number;
  extra: number; missing: number; bonus: number; bank_delta: number; bank_after: number;
};

export function Monthly() {
  const { data, error } = useLoad(() => rpc<MonthRow[]>("portal_bank_monthly", { p: {} }));
  const periods = useMemo(() => Array.from(new Set((data ?? []).map((r) => r.period_start))).sort().reverse(), [data]);
  const [period, setPeriod] = useState("");
  const [query, setQuery] = useState("");
  const sel = period || periods[0] || "";
  const list = (data ?? []).filter((r) => (!sel || r.period_start === sel) &&
    (!query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()) || r.cpf.includes(query.replace(/\D/g, "") || "#")));

  const exportCsv = () => {
    const head = "Período;CPF;Nome;Previsto;Trabalhado;Extras;Atrasos e faltas;Bônus;Movimento do banco;Saldo do banco";
    const rows = (data ?? []).map((r) => [`${br(r.period_start)} a ${br(r.period_end)}`, formatCpf(r.cpf), r.name,
      fmtMin(r.expected), fmtMin(r.worked), fmtMin(r.extra), fmtMin(r.missing), fmtMin(r.bonus),
      fmtMin(r.bank_delta, true), fmtMin(r.bank_after, true)].join(";"));
    download(`consolidado-${todayIso()}.csv`, "﻿" + [head, ...rows].join("\n"));
  };

  return (
    <>
      <PageHead
        title="Consolidado mensal"
        lead="Totais de cada período fechado por funcionário. A exportação traz todos os períodos."
        actions={<button className="ghost" onClick={exportCsv} disabled={!data}>Exportar planilha</button>}
      />
      {error && <Banner tone="error">{error}</Banner>}
      <div className="toolbar">
        <select value={sel} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => <option key={p} value={p}>Período iniciado em {br(p)}</option>)}
        </select>
        <input className="search" placeholder="Buscar por nome ou CPF" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <section className="card flush">
        {!data ? <Loading /> : list.length === 0 ? <Empty>Nenhum período fechado ainda.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th className="num">Previsto</th>
                  <th className="num">Trabalhado</th>
                  <th className="num">Extras</th>
                  <th className="num">Atrasos e faltas</th>
                  <th className="num">Bônus</th>
                  <th className="num">Movimento</th>
                  <th className="num">Saldo do banco</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.cpf + r.period_start}>
                    <td><a href={`#bank?cpf=${r.cpf}`} className="strong">{r.name}</a><div className="muted small">{formatCpf(r.cpf)}</div></td>
                    <td className="num">{fmtMin(r.expected)}</td>
                    <td className="num">{fmtMin(r.worked)}</td>
                    <td className="num">{fmtMin(r.extra)}</td>
                    <td className="num">{fmtMin(r.missing)}</td>
                    <td className="num">{fmtMin(r.bonus)}</td>
                    <td className="num"><Hours value={r.bank_delta} signed /></td>
                    <td className="num"><Hours value={r.bank_after} signed /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Saldo de abertura (migracao do SGI)
// ---------------------------------------------------------------------------

type OpeningItem = { cpf: string; date: string; minutes: number; pct: number | null; note: string; line: number; error?: string };

export function Opening() {
  const { data: employees } = useLoad(() => rpc<Employee[]>("portal_employees"));
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const known = new Set((employees ?? []).map((e) => e.cpf));

  const items: OpeningItem[] = text.split(/\r?\n/).map((raw, i) => ({ raw: raw.trim(), i })).filter((x) => x.raw).map(({ raw, i }) => {
    const [cpfRaw = "", dateRaw = "", hoursRaw = "", pctRaw = "", note = ""] = raw.split(/[;\t]/).map((x) => x.trim());
    const cpf = cpfRaw.replace(/\D/g, "");
    const dm = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : "";
    const neg = hoursRaw.startsWith("-");
    const minutes = parseHours(hoursRaw.replace(/^[+-]/, "")) * (neg ? -1 : 1);
    const pct = pctRaw ? Number(pctRaw.replace("%", "")) : null;
    let error = "";
    if (cpf.length !== 11) error = "CPF inválido";
    else if (!known.has(cpf)) error = "CPF não cadastrado";
    else if (!date) error = "Data inválida";
    else if (!minutes) error = "Horas inválidas";
    else if (pct !== null && !Number.isFinite(pct)) error = "Percentual inválido";
    return { cpf, date, minutes, pct, note, line: i + 1, error };
  });
  const bad = items.filter((x) => x.error);

  const send = async () => {
    if (!window.confirm(`Gravar ${items.length} lote(s) de abertura? Lotes de abertura não podem ser alterados depois.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const n = await rpc<number>("portal_bank_opening", {
        p: { items: items.map(({ cpf, date, minutes, pct, note }) => ({ cpf, date, minutes, pct, note: note || "Saldo de abertura (SGI)" })) },
      });
      setMsg({ tone: "ok", text: `${n} lote(s) gravados.` });
      setText("");
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
    setBusy(false);
  };

  return (
    <>
      <PageHead
        title="Saldo de abertura"
        lead="Migração do SGI: cada linha vira um lote com a data de origem, para o FIFO e o vencimento continuarem certos."
      />
      <Banner tone="warn">
        Use uma vez, antes do primeiro fechamento no Ponto Totem. Os lotes gravados aqui não podem ser alterados; um erro
        se corrige com um pagamento ou desconto em Quitação.
      </Banner>
      <section className="card form">
        <label>
          Cole as linhas (CPF; data; horas; percentual; observação)
          <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={"123.456.789-09;20/09/2025;12:30;60;Consolidado set/2025\n123.456.789-09;20/10/2025;-3:15;60"} />
          <span className="hint">
            Uma linha por mês e funcionário, com a data do fim do período. Horas negativas com sinal de menos. Separador ponto e
            vírgula ou tabulação (dá para colar direto da planilha).
          </span>
        </label>
        {items.length > 0 && (
          <p className="small">
            {items.length} linha(s) · saldo {fmtMin(items.reduce((x, i) => x + i.minutes, 0), true)}
            {bad.length > 0 && <> · <span className="neg">{bad.length} com erro</span></>}
          </p>
        )}
        {bad.length > 0 && (
          <ul className="mark-list">
            {bad.slice(0, 20).map((b) => <li key={b.line} className="small">Linha {b.line}: {b.error}</li>)}
          </ul>
        )}
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <button className="primary" disabled={busy || items.length === 0 || bad.length > 0} onClick={send}>
          {busy ? "Gravando" : "Gravar lotes de abertura"}
        </button>
      </section>
    </>
  );
}
