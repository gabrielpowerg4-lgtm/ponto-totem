import { useEffect, useMemo, useState } from "react";
import { br, closePeriod, download, errorText, formatCpf, rpc, todayIso, type Me } from "../api";
import { ALERTS, computeAll, FLAG_LABEL, fmtMin, type Sheet, type TimesheetData } from "../jornada";
import { Badge, Banner, Empty, Loading, PageHead } from "../ui";
import { Hours, PeriodSelect, usePeriods } from "./Treatment";

type Mode = "pending" | "close" | "report";

const TEXT: Record<Mode, { title: string; lead: string }> = {
  pending: {
    title: "Pendências",
    lead: "Dias com alerta de todos os funcionários no período e avisos enviados pelos responsáveis dos tablets.",
  },
  close: {
    title: "Fechamento",
    lead: "Feche o período depois de tratar as pendências. O período fechado é o que vai para o Espelho de Ponto, o AEJ e o Bubble.",
  },
  report: {
    title: "Apuração do período",
    lead: "Totais de cada funcionário no período: previsto, trabalhado, noturnas, extras, faltas e banco de horas.",
  },
};

export default function Closing({ mode, me, openTreatment }: {
  mode: Mode;
  me: Me;
  openTreatment: (cpf: string, start: string) => void;
}) {
  const { periods, error: periodError, reload: reloadPeriods } = usePeriods();
  const [start, setStart] = useState("");
  const [data, setData] = useState<TimesheetData | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<"pending" | "all">(mode === "report" ? "all" : "pending");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);

  useEffect(() => {
    if (periods && !start) {
      // Padrao: o periodo anterior ainda aberto; se nao houver, o atual.
      const prev = periods.find((p) => !p.current && !p.closed);
      setStart((prev ?? periods[0]).start);
    }
  }, [periods, start]);

  const period = periods?.find((p) => p.start === start) ?? null;

  const load = () => {
    if (!period) return;
    setData(null);
    setError("");
    rpc<TimesheetData>("portal_timesheet", { p_from: period.start, p_to: period.end, p_cpf: "" })
      .then((d) => setData({ ...d, today: todayIso() }))
      .catch((e) => setError(errorText(e, "Não foi possível calcular o período.")));
  };

  useEffect(load, [period?.start, period?.end, period?.closed?.closed_at]);

  const sheets = useMemo(() => (data ? computeAll(data) : []), [data]);

  const summary = useMemo(() => {
    const count = (flag: string) => sheets.reduce((x, s) => x + s.days.filter((d) => d.flags.includes(flag)).length, 0);
    return {
      employees: sheets.length,
      pendingEmployees: sheets.filter((s) => s.totals.pending_days > 0).length,
      pendingDays: sheets.reduce((x, s) => x + s.totals.pending_days, 0),
      noSchedule: sheets.filter((s) => s.schedule_missing).length,
      byFlag: Object.fromEntries(ALERTS.map((f) => [f, count(f)])) as Record<string, number>,
    };
  }, [sheets]);

  const list = show === "pending" ? sheets.filter((s) => s.totals.pending_days > 0) : sheets;
  const finished = period ? period.end <= todayIso() : false;
  const latestClosed = periods?.find((p) => p.closed);

  const close = async () => {
    if (!period) return;
    const warn = summary.pendingDays > 0
      ? `Ainda há ${summary.pendingDays} dia(s) com alerta em ${summary.pendingEmployees} funcionário(s). `
      : "";
    if (!window.confirm(`${warn}Fechar o período de ${br(period.start)} a ${br(period.end)}? Depois de fechado, nada pode ser tratado nele.`)) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await closePeriod(period.start, period.end);
      setMsg({ tone: "ok", text: `Período fechado: ${r.employees} funcionários, ${r.days} dias gravados.` });
      reloadPeriods();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Não foi possível fechar." });
    }
    setBusy(false);
  };

  const reopen = async () => {
    if (!period) return;
    const reason = window.prompt(`Motivo para reabrir o período de ${br(period.start)} a ${br(period.end)}:`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    setMsg(null);
    try {
      await rpc("portal_period_reopen", { p_start: period.start, p_reason: reason });
      setMsg({ tone: "ok", text: "Período reaberto." });
      reloadPeriods();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    }
    setBusy(false);
  };

  const exportCsv = () => {
    if (!period) return;
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Nome", "CPF", "Previsto", "Trabalhado", "Noturnas", "Extras", "Atrasos e faltas",
      "Banco anterior", "Movimento do banco", "Banco final", "Dias com alerta"];
    const lines = sheets.map((s) => [
      s.name, formatCpf(s.cpf), fmtMin(s.totals.expected), fmtMin(s.totals.worked), fmtMin(s.totals.night),
      fmtMin(s.totals.extra), fmtMin(s.totals.missing), fmtMin(s.totals.bank_before, true),
      fmtMin(s.totals.bank_delta, true), fmtMin(s.totals.bank_after, true), s.totals.pending_days,
    ].map(esc).join(";"));
    download(`apuracao_${period.start}_${period.end}.csv`, "﻿" + [head.join(";"), ...lines].join("\r\n"));
  };

  return (
    <>
      <PageHead
        title={TEXT[mode].title}
        lead={TEXT[mode].lead}
        actions={mode === "report" && sheets.length > 0 && <button className="ghost" onClick={exportCsv}>Exportar CSV</button>}
      />
      {(periodError || error) && <Banner tone="error">{periodError || error}</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      <div className="card closing-head">
        <label>
          Período
          {periods ? <PeriodSelect periods={periods} value={start} onChange={setStart} /> : <select disabled />}
        </label>
        {mode === "close" && <div className="closing-status">
          {period?.closed ? (
            <>
              <Badge tone="ok">Fechado</Badge>
              <span className="muted small">
                em {new Date(period.closed.closed_at).toLocaleString("pt-BR")} por {period.closed.closed_by}
              </span>
              {me.role === "admin" && latestClosed?.start === period.start && (
                <button className="ghost small" disabled={busy} onClick={reopen}>Reabrir</button>
              )}
            </>
          ) : (
            <>
              <Badge tone="warn">Aberto</Badge>
              {finished ? (
                <button className="primary" disabled={busy || !data || me.cpf.length !== 11} onClick={close}>
                  {busy ? "Fechando" : "Fechar período"}
                </button>
              ) : (
                <span className="muted small">Pode ser fechado a partir de {br(period?.end ?? todayIso())}.</span>
              )}
            </>
          )}
        </div>}
        {mode !== "close" && period?.closed && <Badge tone="ok">Período fechado</Badge>}
      </div>
      {mode === "close" && me.cpf.length !== 11 && !period?.closed && (
        <Banner tone="warn">Para fechar o período é preciso o seu CPF: não achamos um funcionário com o seu e-mail de acesso. Veja em Minha conta.</Banner>
      )}

      {!data ? (error ? null : <Loading />) : (
        <>
          <div className="stats">
            <div className="stat">
              <div className="muted small">Funcionários com alerta</div>
              <div className="stat-value">{summary.pendingEmployees}</div>
              <div className="muted small">de {summary.employees}</div>
            </div>
            <div className="stat">
              <div className="muted small">Dias com alerta</div>
              <div className="stat-value">{summary.pendingDays}</div>
            </div>
            <div className="stat">
              <div className="muted small">Sem jornada definida</div>
              <div className="stat-value">{summary.noSchedule}</div>
              <div className="muted small">funcionários</div>
            </div>
            <div className="stat">
              <div className="muted small">Alertas por tipo</div>
              <div className="flag-counts">
                {ALERTS.filter((f) => f !== "sem_jornada").map((f) => (
                  <div key={f} className="small"><span className="muted">{FLAG_LABEL[f]}</span> <span className="strong">{summary.byFlag[f]}</span></div>
                ))}
              </div>
            </div>
          </div>

          {mode === "close" && (
            <p className="muted">
              {summary.pendingDays > 0
                ? `Ainda há ${summary.pendingDays} dia(s) com alerta. Trate em Ponto, Pendências, antes de fechar.`
                : "Nenhuma pendência no período."}
            </p>
          )}
          {mode === "pending" && <Notices />}
          {mode !== "close" && <>
          {mode === "pending" && <div className="toolbar">
            <div className="segmented">
              <button className={show === "pending" ? "on" : ""} onClick={() => setShow("pending")}>Com alerta</button>
              <button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>Todos</button>
            </div>
          </div>}

          <section className="card flush">
            {list.length === 0 ? (
              <Empty>{show === "pending" ? "Nenhuma pendência no período." : "Nenhum funcionário."}</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Funcionário</th>
                      <th>Alertas</th>
                      <th className="num">Previsto</th>
                      <th className="num">Trabalhado</th>
                      {mode === "report" && <th className="num">Noturnas</th>}
                      {mode === "report" && <th className="num">Extras</th>}
                      {mode === "report" && <th className="num">Faltas</th>}
                      <th className="num">Saldo</th>
                      <th className="num">Banco final</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.cpf}>
                        <td>
                          <div className="strong">{s.name}</div>
                          <div className="muted small">{formatCpf(s.cpf)}</div>
                        </td>
                        <td><Alerts sheet={s} /></td>
                        <td className="num">{fmtMin(s.totals.expected)}</td>
                        <td className="num">{fmtMin(s.totals.worked)}</td>
                        {mode === "report" && <td className="num">{fmtMin(s.totals.night)}</td>}
                        {mode === "report" && <td className="num">{fmtMin(s.totals.extra)}</td>}
                        {mode === "report" && <td className="num">{fmtMin(s.totals.missing)}</td>}
                        <td className="num"><Hours value={s.totals.extra - s.totals.missing} signed /></td>
                        <td className="num"><Hours value={s.totals.bank_after} signed /></td>
                        <td className="right">
                          <button className="ghost small" onClick={() => openTreatment(s.cpf, period!.start)}>
                            {period?.closed ? "Ver" : "Tratar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          </>}
        </>
      )}
    </>
  );
}

function Alerts({ sheet }: { sheet: Sheet }) {
  if (sheet.schedule_missing) return <Badge tone="error">Sem jornada</Badge>;
  const counts: Record<string, number> = {};
  for (const d of sheet.days) for (const f of d.flags) if (ALERTS.includes(f)) counts[f] = (counts[f] ?? 0) + 1;
  const keys = Object.keys(counts);
  if (keys.length === 0) return <span className="muted small">Nenhum</span>;
  return (
    <div className="chips">
      {keys.map((f) => <Badge key={f} tone="error">{FLAG_LABEL[f]} {counts[f]}</Badge>)}
    </div>
  );
}

type Notice = {
  id: string;
  terminal: string;
  responsible: string | null;
  responsible_cpf: string;
  employee: string | null;
  employee_cpf: string;
  day: string | null;
  text: string;
  created_at: string;
};

/** Avisos de campo enviados pelos responsaveis dos tablets. */
function Notices() {
  const [list, setList] = useState<Notice[] | null>(null);
  const [error, setError] = useState("");
  const load = () => rpc<Notice[]>("portal_notices", { p_open: true }).then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);

  const done = async (n: Notice) => {
    const note = window.prompt("O que foi feito? (opcional)") ?? null;
    if (note === null) return;
    setError("");
    try {
      await rpc("portal_notice_done", { p_id: n.id, p_note: note });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!list || list.length === 0) return null;
  return (
    <section className="card">
      <h2>Avisos da obra ({list.length})</h2>
      {error && <Banner tone="error">{error}</Banner>}
      <table>
        <tbody>
          {list.map((n) => (
            <tr key={n.id}>
              <td className="nowrap small">
                {new Date(n.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                <div className="muted">{n.terminal}</div>
              </td>
              <td>
                <div>{n.text}</div>
                <div className="muted small">
                  {n.responsible ?? formatCpf(n.responsible_cpf)}
                  {n.employee_cpf ? ` · sobre ${n.employee ?? formatCpf(n.employee_cpf)}` : ""}
                  {n.day ? ` · dia ${br(n.day)}` : ""}
                </div>
              </td>
              <td className="right"><button className="ghost small" onClick={() => done(n)}>Resolvido</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
