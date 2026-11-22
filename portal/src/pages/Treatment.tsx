import { useEffect, useMemo, useState } from "react";
import {
  br, closeEmployee, errorText, FACE_LABEL, formatCpf, rpc, supabase, todayIso, WEEKDAY, type Employee, type Me,
  type Period,
} from "../api";
import {
  ALERTS, computeEmployee, FLAG_LABEL, fmtClock, fmtMin, OCCURRENCE_LABEL, type Day, type DayMark,
  type TimesheetData,
} from "../jornada";
import { askConfirm, askText, Badge, Banner, Empty, Loading, PageHead } from "../ui";

// ---------------------------------------------------------------------------
// Periodos (compartilhado com a tela de fechamento)
// ---------------------------------------------------------------------------

export function hashParams(): URLSearchParams {
  const h = window.location.hash;
  const i = h.indexOf("?");
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : "");
}

export function usePeriods() {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [error, setError] = useState("");
  const reload = () =>
    rpc<Period[]>("portal_periods", { p_count: 24 })
      .then(setPeriods)
      .catch((e) => setError(errorText(e, "Não foi possível carregar os períodos.")));
  useEffect(() => {
    reload();
  }, []);
  return { periods, error, reload };
}

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro",
  "Novembro", "Dezembro"];

/** Mes de referencia do periodo: o mes em que ele termina (21/10 a 20/11 = novembro). */
function refOf(p: Period) {
  return { year: Number(p.end.slice(0, 4)), month: Number(p.end.slice(5, 7)) };
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) + 1;
}

/** Escolha do periodo por ano e mes; o periodo aparece em seguida (inicio, fim e dias). */
export function PeriodSelect({ periods, value, onChange, status = true }: {
  periods: Period[];
  value: string;
  onChange: (start: string) => void;
  status?: boolean;
}) {
  const current = periods.find((p) => p.start === value) ?? periods[0];
  const ref = current ? refOf(current) : { year: 0, month: 0 };
  const years = Array.from(new Set(periods.map((p) => refOf(p).year))).sort((a, b) => b - a);
  const months = periods.filter((p) => refOf(p).year === ref.year).sort((a, b) => a.end.localeCompare(b.end));

  const pickYear = (year: number) => {
    const inYear = periods.filter((p) => refOf(p).year === year);
    const same = inYear.find((p) => refOf(p).month === ref.month);
    const next = same ?? inYear.sort((a, b) => b.end.localeCompare(a.end))[0];
    if (next) onChange(next.start);
  };

  return (
    <div className="period-picker">
      <label>
        Ano
        <select value={ref.year} onChange={(e) => pickYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label>
        Mês
        <select value={current?.start ?? ""} onChange={(e) => onChange(e.target.value)}>
          {months.map((p) => (
            <option key={p.start} value={p.start}>
              {MONTHS[refOf(p).month - 1]}{p.current ? " (atual)" : ""}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <div className="period-info" aria-label="Período de apuração">
          <span className="pinfo strong" title="Início">{br(current.start)}</span>
          <span className="pinfo" title="Fim">{br(current.end)}</span>
          <span className="pinfo" title="Dias no período">{daysBetween(current.start, current.end)} dias</span>
          {!status ? null : current.closed ? <Badge tone="ok">Fechado</Badge> : current.current ? <Badge tone="neutral">Atual</Badge> : null}
        </div>
      )}
    </div>
  );
}

export function Hours({ value, signed = false }: { value: number; signed?: boolean }) {
  const cls = signed && value > 0 ? "pos" : signed && value < 0 ? "neg" : "";
  return <span className={`hours ${cls}`}>{value === 0 && signed ? "0:00" : fmtMin(value, signed)}</span>;
}

// ---------------------------------------------------------------------------
// Tratamento de um funcionario
// ---------------------------------------------------------------------------

export default function Treatment({ me, goAccount }: { me: Me; goAccount: () => void }) {
  const params = hashParams();
  const { periods, error: periodError, reload: reloadPeriods } = usePeriods();
  const [closing, setClosing] = useState(false);
  const [closeMsg, setCloseMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [start, setStart] = useState(params.get("start") ?? "");
  const [cpf, setCpf] = useState(params.get("cpf") ?? "");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [person, setPerson] = useState("");
  const [data, setData] = useState<TimesheetData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string>("");
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  useEffect(() => {
    rpc<Employee[]>("portal_employees").then(setEmployees).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (periods && !start) setStart((periods.find((p) => p.current) ?? periods[0]).start);
  }, [periods, start]);

  const period = periods?.find((p) => p.start === start) ?? null;
  const emp = employees.find((e) => e.cpf === cpf) ?? null;
  const active = useMemo(() => employees.filter((e) => e.active), [employees]);

  useEffect(() => {
    if (emp) setPerson(`${emp.name} · ${formatCpf(emp.cpf)}`);
  }, [emp?.cpf]);

  const load = () => {
    if (!period || !cpf) return;
    setError("");
    rpc<TimesheetData>("portal_timesheet", { p_from: period.start, p_to: period.end, p_cpf: cpf })
      .then((d) => setData({ ...d, today: todayIso() }))
      .catch((e) => setError(errorText(e, "Não foi possível carregar o ponto.")));
  };

  useEffect(() => {
    setData(null);
    setOpen("");
    load();
    if (cpf && start) window.history.replaceState(null, "", `#treatment?cpf=${cpf}&start=${start}`);
  }, [cpf, start, period?.end]);

  const sheet = useMemo(() => {
    if (!data || !data.employees[0]) return null;
    return computeEmployee(data, data.employees[0]);
  }, [data]);

  const pick = (text: string) => {
    setPerson(text);
    const found = employees.find((e) => `${e.name} · ${formatCpf(e.cpf)}` === text);
    if (found) setCpf(found.cpf);
  };

  const step = (dir: number) => {
    const i = active.findIndex((e) => e.cpf === cpf);
    const next = active[(i + dir + active.length) % active.length];
    if (next) setCpf(next.cpf);
  };

  const needsCpf = me.cpf.length !== 11;
  const empClosure = data && period ? data.closed.find((c) => c.cpf === cpf && c.start === period.start) ?? null : null;
  const closed = !!period?.closed || !!empClosure;
  const today = todayIso();
  const canCloseEmployee = !!period && !period.closed && !empClosure && !needsCpf &&
    (period.end <= today || (!!emp?.dismissed_on && emp.dismissed_on <= today));

  const closeOne = async () => {
    if (!period || !sheet) return;
    const warn = sheet.totals.pending_days > 0 ? `Ainda há ${sheet.totals.pending_days} dia(s) com alerta. ` : "";
    if (!await askConfirm(`${warn}Fechar o período de ${br(period.start)} a ${br(period.end)} de ${sheet.name}? Os dias dele ficam travados e o saldo vai para o banco de horas.`)) return;
    setClosing(true);
    setCloseMsg(null);
    try {
      await closeEmployee(period.start, period.end, cpf);
      setCloseMsg({ tone: "ok", text: `Período de ${sheet.name} fechado.` });
      reloadPeriods();
      load();
    } catch (e) {
      setCloseMsg({ tone: "error", text: e instanceof Error ? e.message : "Não foi possível fechar." });
    }
    setClosing(false);
  };

  const reopenOne = async () => {
    if (!period || !sheet) return;
    const reason = await askText(`Motivo para reabrir o período de ${sheet.name}:`);
    if (!reason || reason.trim().length < 3) return;
    setClosing(true);
    setCloseMsg(null);
    try {
      await rpc("portal_employee_reopen", { p: { cpf, start: period.start, reason } });
      setCloseMsg({ tone: "ok", text: `Período de ${sheet.name} reaberto.` });
      reloadPeriods();
      load();
    } catch (e) {
      setCloseMsg({ tone: "error", text: errorText(e) });
    }
    setClosing(false);
  };
  const days = sheet ? sheet.days.filter((d) => !onlyAlerts || d.flags.some((f) => ALERTS.includes(f))) : [];

  return (
    <>
      <PageHead
        title="Tratamento"
        lead="Ajuste o ponto dia a dia. A marcação original nunca é apagada: cada ajuste fica registrado com motivo, CPF e horário."
      />
      {needsCpf && (
        <Banner tone="warn">
          Para tratar o ponto é preciso o seu CPF (fica registrado em cada ajuste) e não achamos um funcionário
          com o seu e-mail de acesso.{" "}
          <button className="link inline" onClick={goAccount}>Ir para Meus dados</button>
        </Banner>
      )}
      {(periodError || error) && <Banner tone="error">{periodError || error}</Banner>}

      <div className="card filters treat-filters">
        <div className="period-row">
          {periods ? <PeriodSelect periods={periods} value={start} onChange={setStart} /> : <Loading />}
        </div>
        <label className="wide">
          Funcionário
          <input list="treat-employees" value={person} placeholder="Nome ou CPF" onChange={(e) => pick(e.target.value)} />
          <datalist id="treat-employees">
            {active.map((e) => <option key={e.cpf} value={`${e.name} · ${formatCpf(e.cpf)}`} />)}
          </datalist>
        </label>
        <div className="filter-actions">
          <button className="ghost" type="button" onClick={() => step(-1)} disabled={!cpf}>Anterior</button>
          <button className="ghost" type="button" onClick={() => step(1)} disabled={!cpf}>Próximo</button>
        </div>
      </div>

      {!cpf ? (
        <Empty>Escolha um funcionário para ver o ponto do período.</Empty>
      ) : !sheet ? (
        error ? null : <Loading />
      ) : (
        <>
          {closeMsg && <Banner tone={closeMsg.tone}>{closeMsg.text}</Banner>}
          <div className="card close-bar">
            {period?.closed ? (
              <>
                <Badge tone="ok">Período fechado</Badge>
                <span className="muted small">
                  Fechado para a empresa em {new Date(period.closed.closed_at).toLocaleDateString("pt-BR")}. Somente consulta.
                </span>
              </>
            ) : empClosure ? (
              <>
                <Badge tone="ok">Fechado para este funcionário</Badge>
                <span className="muted small">em {new Date(empClosure.closed_at).toLocaleString("pt-BR")}. Somente consulta.</span>
                {me.role === "admin" && (
                  <button className="ghost small" disabled={closing} onClick={reopenOne}>Reabrir funcionário</button>
                )}
              </>
            ) : (
              <>
                <Badge tone="warn">Aberto</Badge>
                <span className="muted small">
                  {canCloseEmployee
                    ? "Feche só este funcionário, sem esperar o fechamento da empresa."
                    : period && period.end > today
                    ? `O fechamento libera em ${br(period.end)} (ou antes, para funcionário desligado).`
                    : "Informe o seu CPF em Meus dados para fechar."}
                </span>
                {canCloseEmployee && (
                  <button className="primary small" disabled={closing} onClick={closeOne}>
                    {closing ? "Fechando" : "Fechar este funcionário"}
                  </button>
                )}
              </>
            )}
          </div>
          {sheet.schedule_missing && (
            <Banner tone="warn">
              Funcionário sem jornada em parte do período: defina a jornada na tela Funcionários para calcular as horas.
            </Banner>
          )}
          <div className="stats six">
            <Total label="Previsto" value={sheet.totals.expected} />
            <Total label="Trabalhado" value={sheet.totals.worked} note={sheet.totals.night ? `${fmtMin(sheet.totals.night)} noturnas` : undefined} />
            <Total label="Extras" value={sheet.totals.extra} note={sheet.totals.bonus ? `+ ${fmtMin(sheet.totals.bonus)} de bônus` : undefined} />
            <Total label="Atrasos e faltas" value={sheet.totals.missing} />
            <Total label="Banco anterior" value={sheet.totals.bank_before} signed />
            <Total label="Banco final" value={sheet.totals.bank_after} signed note={`Movimento ${fmtMin(sheet.totals.bank_delta, true)}`} />
          </div>

          <section className="card flush">
            <div className="card-head pad">
              <h2>{sheet.name}</h2>
              <label className="check">
                <input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />
                Só dias com alerta ({sheet.totals.pending_days})
              </label>
            </div>
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Jornada</th>
                    <th>Marcações</th>
                    <th className="num">Previsto</th>
                    <th className="num">Trabalhado</th>
                    <th className="num">Saldo</th>
                    <th className="num">Bônus</th>
                    <th>Alertas</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {days.length === 0 && (
                    <tr><td colSpan={9}><Empty>Nenhum dia com alerta.</Empty></td></tr>
                  )}
                  {days.map((d) => (
                    <DayRows
                      key={d.date}
                      day={d}
                      open={open === d.date}
                      toggle={() => setOpen(open === d.date ? "" : d.date)}
                      readOnly={closed || d.closed || needsCpf}
                      companyId={me.company_id}
                      onChanged={load}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Total({ label, value, signed, note }: { label: string; value: number; signed?: boolean; note?: string }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="stat-value small-value"><Hours value={value} signed={signed} /></div>
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

function MarkChip({ m }: { m: DayMark }) {
  const cls = m.kind === "I" ? "chip incl" : m.disregard ? "chip off" : "chip";
  const title = m.kind === "I"
    ? `Incluída: ${m.reason}`
    : m.disregard
    ? `Desconsiderada: ${m.disregard.reason}`
    : `NSR ${m.nsr} · ${FACE_LABEL[m.face ?? ""] ?? ""}${m.online === false ? " · off-line" : ""}`;
  const alert = m.kind === "O" && !m.disregard && !m.face_confirm && m.face && m.face !== "ROSTO_CONFERE" &&
    m.face !== "VIVACIDADE_OK";
  return (
    <span className={cls + (alert ? " alert" : "")} title={title}>
      {fmtClock(m.at_min)}{m.next_day ? "⁺¹" : ""}{m.kind === "I" ? " I" : ""}
    </span>
  );
}

function DayRows({ day, open, toggle, readOnly, companyId, onChanged }: {
  day: Day;
  open: boolean;
  toggle: () => void;
  readOnly: boolean;
  companyId: string;
  onChanged: () => void;
}) {
  const alerts = day.flags.filter((f) => f !== "ajustado");
  const rest = day.expected_base === 0;
  return (
    <>
      <tr className={(rest ? "rest " : "") + (open ? "open " : "") + (day.future ? "future" : "")}>
        <td className="nowrap">
          <span className="strong">{br(day.date).slice(0, 5)}</span> <span className="muted">{WEEKDAY[day.weekday]}</span>
        </td>
        <td className="small nowrap">
          {day.schedule_times.length
            ? day.schedule_times.map((t) => `${t.slice(0, 2)}:${t.slice(2)}`).join(" ")
            : <span className="muted">{day.schedule_code ? "Descanso" : "Sem jornada"}</span>}
        </td>
        <td>
          <div className="chips">
            {day.marks.map((m, i) => <MarkChip key={i} m={m} />)}
            {day.attachments.length > 0 && <span className="chip" title="Anexos">📎 {day.attachments.length}</span>}
            {day.occurrences.map((o) => (
              <span key={o.id} className="chip occ" title={o.reason}>
                {OCCURRENCE_LABEL[o.type] ?? o.type}{o.minutes ? ` ${fmtMin(o.minutes)}` : ""}
              </span>
            ))}
          </div>
        </td>
        <td className="num">{day.expected && !day.future ? fmtMin(day.expected) : <span className="muted">–</span>}</td>
        <td className="num">{day.worked ? fmtMin(day.worked) : <span className="muted">–</span>}</td>
        <td className="num">
          <Hours value={day.balance} signed />
          {day.tolerance && <div className="muted small">tolerância</div>}
        </td>
        <td className="num">
          {day.bonus_removed && day.bonus_gross
            ? <span className="muted strike" title={`Retirado: ${day.bonus_removed.reason}`}>{fmtMin(day.bonus_gross)}</span>
            : day.bonus ? <Hours value={day.bonus} signed /> : <span className="muted">–</span>}
        </td>
        <td>
          <div className="chips">
            {alerts.map((f) => (
              <Badge key={f} tone={ALERTS.includes(f) ? "error" : "neutral"}>{FLAG_LABEL[f] ?? f}</Badge>
            ))}
          </div>
        </td>
        <td className="right">
          <button className={open ? "ghost small on" : "ghost small"} onClick={toggle}>
            {readOnly ? "Detalhes" : "Tratar"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="panel-row">
          <td colSpan={9}>
            <DayPanel day={day} readOnly={readOnly} companyId={companyId} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

const PARTIAL = new Set(["abono", "atestado"]);

function DayPanel({ day, readOnly, companyId, onChanged }: {
  day: Day;
  readOnly: boolean;
  companyId: string;
  onChanged: () => void;
}) {
  const [include, setInclude] = useState({ time: "", nextDay: false, reason: "" });
  const [occ, setOcc] = useState({ type: "atestado", to: day.date, minutes: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"mark" | "occ">(day.marks.length === 0 && day.expected > 0 ? "occ" : "mark");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setMsg(errorText(e));
    }
    setBusy(false);
  };

  const ask = (question: string) => askText(question);

  const markAction = (m: DayMark) => {
    if (m.kind === "I") {
      void ask(`Motivo para remover a marcação incluída às ${fmtClock(m.at_min)}:`).then((reason) => {
        if (reason) run(() => rpc("portal_adjust_revoke", { p_id: m.adj_id, p_reason: reason }));
      });
    } else if (m.disregard) {
      void ask(`Motivo para voltar a considerar a marcação das ${fmtClock(m.at_min)}:`).then((reason) => {
        if (reason) run(() => rpc("portal_adjust_revoke", { p_id: m.disregard!.id, p_reason: reason }));
      });
    } else {
      void ask(`Motivo para desconsiderar a marcação das ${fmtClock(m.at_min)} (NSR ${m.nsr}):`).then((reason) => {
        if (reason) run(() => rpc("portal_mark_disregard", { p_nsr: m.nsr, p_reason: reason }));
      });
    }
  };

  const faceAction = (m: DayMark) => {
    if (m.face_confirm) {
      void ask(`Motivo para desfazer a confirmação do rosto na marcação das ${fmtClock(m.at_min)}:`).then((reason) => {
        if (reason) run(() => rpc("portal_face_confirm_revoke", { p: { id: m.face_confirm!.id, reason } }));
      });
    } else {
      void ask(`Como a identidade foi confirmada na marcação das ${fmtClock(m.at_min)}? (ex.: confirmado com o responsável da obra)`).then((reason) => {
        if (reason) run(() => rpc("portal_face_confirm", { p: { nsr: m.nsr, reason } }));
      });
    }
  };

  const addMark = (e: React.FormEvent) => {
    e.preventDefault();
    const date = include.nextDay ? nextDate(day.date) : day.date;
    run(async () => {
      await rpc("portal_mark_include", { p_cpf: day.cpf, p_local: `${date}T${include.time}`, p_reason: include.reason });
      setInclude({ time: "", nextDay: false, reason: "" });
    });
  };

  const toggleBonus = () => {
    if (day.bonus_removed) {
      void ask("Motivo para devolver o bônus do dia:").then((reason) => {
        if (reason) run(() => rpc("portal_bonus_restore", { p: { id: day.bonus_removed!.id, reason } }));
      });
    } else {
      void ask(`Motivo para retirar o bônus de ${fmtMin(day.bonus_gross)} do dia:`).then((reason) => {
        if (reason) run(() => rpc("portal_bonus_remove", { p: { cpf: day.cpf, date: day.date, reason } }));
      });
    }
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setMsg("Arquivo maior que 5 MB.");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return setMsg("Envie PDF, JPG ou PNG.");
    run(async () => {
      const safe = file.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${companyId}/${day.cpf}/${day.date}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from("anexos").upload(path, file, { contentType: file.type });
      if (up.error) throw new Error("invalid_file");
      await rpc("portal_attachment_add", {
        p: { cpf: day.cpf, date: day.date, path, name: file.name, size: file.size, mime: file.type },
      });
    });
  };

  const openFile = async (path: string) => {
    const { data, error } = await supabase.storage.from("anexos").createSignedUrl(path, 120);
    if (error || !data) return setMsg("Não foi possível abrir o arquivo.");
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const addOcc = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await rpc("portal_occurrence_add", {
        p: {
          cpf: day.cpf, type: occ.type, date_from: day.date, date_to: occ.to || day.date,
          minutes: PARTIAL.has(occ.type) && occ.minutes ? hhmmToMin(occ.minutes) : null, reason: occ.reason,
        },
      });
      setOcc({ type: "atestado", to: day.date, minutes: "", reason: "" });
    });
  };

  const eff = day.marks.filter((m) => m.effective);
  const role = (m: DayMark) => {
    const i = eff.indexOf(m);
    if (i < 0) return "–";
    return `${i % 2 === 0 ? "Entrada" : "Saída"} ${Math.floor(i / 2) + 1}`;
  };
  const faceTone = (f: string | null) => (!f ? "neutral" : f === "ROSTO_CONFERE" || f === "VIVACIDADE_OK" ? "ok" : "error");

  return (
    <div className={readOnly ? "day-panel read-only" : "day-panel"}>
      {msg && <Banner tone="error">{msg}</Banner>}

      <div className="dp-summary">
        <Metric label="Previsto" value={day.expected && !day.future ? fmtMin(day.expected) : "–"} />
        <Metric label="Trabalhado" value={day.worked ? fmtMin(day.worked) : "–"}
          note={day.mode === "clt" && day.night ? `${fmtMin(day.night)} noturnas` : undefined} />
        <Metric label="Saldo" value={<Hours value={day.balance} signed />} note={day.tolerance ? "tolerância" : undefined} />
        <Metric label="Bônus" value={day.bonus ? <Hours value={day.bonus} signed /> : "–"}
          note={day.bonus_removed && day.bonus_gross ? "retirado" : undefined} />
        <Metric label="Banco de horas" value={<Hours value={day.bank_delta} signed />}
          note={day.bank_delta ? `${day.pct}% se pago` : undefined} />
        <div className="dp-rule">
          <Badge tone="neutral">Regra {day.mode === "clt" ? "da CLT" : "do SGI"}</Badge>
        </div>
      </div>

      <div className="panel-grid">
        <div className="dp-col">
          <section className="dp-card">
            <div className="dp-card-head">
              <h3>Marcações</h3>
              <span className="muted small">{eff.length} válida{eff.length === 1 ? "" : "s"}</span>
            </div>
            {day.marks.length === 0 ? <p className="muted small">Nenhuma marcação neste dia.</p> : (
              <ul className="dp-marks">
                {day.marks.map((m, i) => (
                  <li key={i} className={m.effective ? "" : "off"}>
                    <span className="dp-role">{role(m)}</span>
                    <MarkChip m={m} />
                    <span className="dp-info">
                      {m.kind === "I" ? (
                        <><Badge tone="neutral">Incluída</Badge> <span className="small">{m.reason}</span></>
                      ) : m.disregard ? (
                        <><Badge tone="neutral">Desconsiderada</Badge> <span className="small">{m.disregard.reason}</span></>
                      ) : (
                        <>
                          <span className="muted small">NSR {m.nsr}</span>
                          {m.face_confirm ? (
                            <span title={`${m.face_confirm.reason} · CPF ${formatCpf(m.face_confirm.by)}`}>
                              <Badge tone="ok">Rosto confirmado pelo RH</Badge>
                            </span>
                          ) : (
                            <Badge tone={faceTone(m.face)}>{FACE_LABEL[m.face ?? ""] ?? "Sem validação"}</Badge>
                          )}
                          {m.online === false && <Badge tone="warn">Off-line</Badge>}
                          {m.face_confirm && <span className="muted small">{m.face_confirm.reason}</span>}
                        </>
                      )}
                    </span>
                    {!readOnly && (
                      <span className="dp-btns">
                        {m.kind === "O" && !m.disregard && faceTone(m.face) === "error" && (
                          <button className="ghost small" disabled={busy} onClick={() => faceAction(m)}>
                            {m.face_confirm ? "Desfazer confirmação" : "Confirmar rosto"}
                          </button>
                        )}
                        <button className="ghost small" disabled={busy} onClick={() => markAction(m)}>
                          {m.kind === "I" ? "Remover" : m.disregard ? "Voltar a considerar" : "Desconsiderar"}
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {day.occurrences.length > 0 && (
            <section className="dp-card">
              <div className="dp-card-head"><h3>Ocorrências</h3></div>
              <ul className="dp-marks">
                {day.occurrences.map((o) => (
                  <li key={o.id}>
                    <span className="chip occ">{OCCURRENCE_LABEL[o.type] ?? o.type}{o.minutes ? ` ${fmtMin(o.minutes)}` : ""}</span>
                    <span className="dp-info small">
                      {o.reason}{o.date_from !== o.date_to ? ` · ${br(o.date_from)} a ${br(o.date_to)}` : ""}
                      {!o.cpf && <span className="muted"> · da empresa, em Feriados</span>}
                    </span>
                    {!readOnly && o.cpf && (
                      <button className="ghost small" disabled={busy} onClick={() => {
                        void ask("Motivo para cancelar a ocorrência:").then((reason) => {
                          if (reason) run(() => rpc("portal_occurrence_revoke", { p_id: o.id, p_reason: reason }));
                        });
                      }}>
                        Cancelar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(day.bonus_gross > 0 || day.bonus_removed) && (
            <section className="dp-card">
              <div className="dp-card-head"><h3>Bônus</h3></div>
              <ul className="dp-marks">
                <li>
                  <span className={day.bonus_removed ? "chip off" : "chip incl"}>{fmtMin(day.bonus_gross)}</span>
                  <span className="dp-info small">
                    {day.bonus_removed ? <>Retirado · {day.bonus_removed.reason}</> : "30 min a cada hora cheia de extra"}
                  </span>
                  {!readOnly && (
                    <button className="ghost small" disabled={busy} onClick={toggleBonus}>
                      {day.bonus_removed ? "Devolver bônus" : "Retirar bônus"}
                    </button>
                  )}
                </li>
              </ul>
            </section>
          )}

          <section className="dp-card">
            <div className="dp-card-head">
              <h3>Anexos</h3>
              <span className="muted small">{day.attachments.length} de 3</span>
            </div>
            {day.attachments.length > 0 && (
              <ul className="dp-marks">
                {day.attachments.map((a) => (
                  <li key={a.id}>
                    <button className="link small dp-file" onClick={() => openFile(a.path)}>📎 {a.name}</button>
                    <span className="dp-info muted small">{Math.ceil(a.size / 1024)} KB</span>
                    {!readOnly && (
                      <button className="ghost small" disabled={busy} onClick={() => {
                        void ask(`Motivo para retirar o anexo ${a.name}:`).then((reason) => {
                          if (reason) run(() => rpc("portal_attachment_revoke", { p: { id: a.id, reason } }));
                        });
                      }}>
                        Retirar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!readOnly && day.attachments.length < 3 ? (
              <label className={busy ? "dp-upload disabled" : "dp-upload"}>
                <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy}
                  onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
                <span className="dp-upload-btn">Anexar arquivo</span>
                <span className="muted small">PDF, JPG ou PNG, até 5 MB</span>
              </label>
            ) : day.attachments.length === 0 ? <p className="muted small">Nenhum anexo.</p> : null}
          </section>
        </div>

        {!readOnly && (
          <div className="dp-col">
            <section className="dp-card">
              <div className="segmented dp-tabs">
                <button type="button" className={tab === "mark" ? "on" : ""} onClick={() => setTab("mark")}>Incluir marcação</button>
                <button type="button" className={tab === "occ" ? "on" : ""} onClick={() => setTab("occ")}>Lançar ocorrência</button>
              </div>

              {tab === "mark" ? (
                <form className="dp-form" onSubmit={addMark}>
                  <div className="dp-fields mark">
                    <label>
                      Horário
                      <input type="time" value={include.time} onChange={(e) => setInclude({ ...include, time: e.target.value })} required />
                    </label>
                    <label className="check dp-next">
                      <input type="checkbox" checked={include.nextDay} onChange={(e) => setInclude({ ...include, nextDay: e.target.checked })} />
                      Dia seguinte
                    </label>
                  </div>
                  <label>
                    Motivo
                    <input placeholder="Ex.: esqueceu de marcar a saída" value={include.reason}
                      onChange={(e) => setInclude({ ...include, reason: e.target.value })} required minLength={3} />
                  </label>
                  <div className="dp-actions">
                    <button className="primary small" disabled={busy} type="submit">Incluir marcação</button>
                  </div>
                </form>
              ) : (
                <form className="dp-form" onSubmit={addOcc}>
                  <div className={PARTIAL.has(occ.type) ? "dp-fields occ partial" : "dp-fields occ"}>
                    <label>
                      Tipo
                      <select value={occ.type} onChange={(e) => setOcc({ ...occ, type: e.target.value })}>
                        {Object.entries(OCCURRENCE_LABEL).filter(([k]) => k !== "feriado").map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </label>
                    {PARTIAL.has(occ.type) && (
                      <label>
                        Horas
                        <input type="time" value={occ.minutes} onChange={(e) => setOcc({ ...occ, minutes: e.target.value })}
                          required={occ.type === "abono"} />
                      </label>
                    )}
                    <label>
                      Até
                      <input type="date" value={occ.to} min={day.date} onChange={(e) => setOcc({ ...occ, to: e.target.value })} />
                    </label>
                  </div>
                  {PARTIAL.has(occ.type) && (
                    <p className="muted small dp-hint">
                      {occ.type === "abono" ? "Informe as horas abonadas (ex.: 02:00)." : "Horas do atestado; deixe vazio para o dia inteiro."}
                    </p>
                  )}
                  <label>
                    Motivo ou documento
                    <input placeholder="Ex.: atestado médico entregue ao RH" value={occ.reason}
                      onChange={(e) => setOcc({ ...occ, reason: e.target.value })} required minLength={3} />
                  </label>
                  <div className="dp-actions">
                    <button className="primary small" disabled={busy} type="submit">Lançar ocorrência</button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="dp-metric">
      <span className="muted small">{label}</span>
      <span className="dp-metric-value">{value}</span>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

function nextDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function hhmmToMin(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
}
