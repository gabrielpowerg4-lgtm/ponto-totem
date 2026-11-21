import { useState } from "react";
import { br, errorText, rpc, WEEKDAY_FULL, type Holiday, type Me, type ScheduleRow } from "../api";
import { fmtClock, fmtMin, unwrap } from "../jornada";
import { Banner, Empty, Loading, PageHead, useLoad } from "../ui";

type Form = { id?: string; code: string; name: string; days: string[]; active: boolean };

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // segunda a domingo

/** "07:00 12:00 13:00 17:00" -> ["0700","1200","1300","1700"] (ou null se invalido). */
function parseTimes(text: string): string[] | null {
  const parts = text.trim().split(/[\s,;-]+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d{1,2}):?(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    out.push(m[1].padStart(2, "0") + m[2]);
  }
  return out.length % 2 === 0 ? out : null;
}

const showTimes = (t: string[]) => t.map((x) => `${x.slice(0, 2)}:${x.slice(2)}`).join(" ");

export function dayMinutes(times: string[]): number {
  const u = unwrap(times);
  let total = 0;
  for (let i = 0; i + 1 < u.length; i += 2) total += u[i + 1] - u[i];
  return total;
}

export function scheduleSummary(days: string[][]): string {
  return ORDER.filter((d) => days[d]?.length)
    .map((d) => `${WEEKDAY_FULL[d].slice(0, 3)} ${days[d].map((t) => fmtClock(Number(t.slice(0, 2)) * 60 + Number(t.slice(2)))).join("-")}`)
    .join(" · ");
}

export default function Schedules({ me }: { me: Me }) {
  const admin = me.role === "admin";
  const { data, error, setData } = useLoad(() => rpc<ScheduleRow[]>("portal_schedules"));
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const edit = (s?: ScheduleRow) =>
    setForm(s
      ? { id: s.id, code: s.code, name: s.name, days: s.days.map(showTimes), active: s.active }
      : { code: "", name: "", days: ["", "07:00 12:00 13:00 17:00", "07:00 12:00 13:00 17:00", "07:00 12:00 13:00 17:00", "07:00 12:00 13:00 17:00", "07:00 12:00 13:00 16:00", ""], active: true });

  const parsed = form ? form.days.map(parseTimes) : [];
  const weekly = parsed.reduce((x, t) => x + (t ? dayMinutes(t) : 0), 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (parsed.some((p) => p === null)) {
      setFormError("Confira os horários: use pares de entrada e saída, como 07:00 12:00 13:00 17:00.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      setData(await rpc<ScheduleRow[]>("portal_schedule_save", {
        p: { id: form.id, code: form.code, name: form.name, days: parsed, active: form.active },
      }));
      setForm(null);
    } catch (err) {
      setFormError(errorText(err));
    }
    setBusy(false);
  };

  return (
    <>
      <PageHead
        title="Jornadas"
        lead="Horário contratual de cada funcionário. Usado no cálculo das horas, no Espelho de Ponto e no AEJ."
        actions={admin && !form && <button className="primary" onClick={() => edit()}>Nova jornada</button>}
      />
      {error && <Banner tone="error">{error}</Banner>}

      {form && (
        <form className="card form" onSubmit={save}>
          <h2>{form.id ? "Editar jornada" : "Nova jornada"}</h2>
          <div className="grid-2">
            <label>
              Código
              <input value={form.code} maxLength={30} placeholder="Ex.: ADM44"
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required />
              <span className="hint">É o código que o Bubble envia no campo jornada.</span>
            </label>
            <label>
              Nome
              <input value={form.name} maxLength={80} placeholder="Ex.: Administrativo 44h"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          </div>
          <p className="muted small">
            Horários de entrada e saída de cada dia, em pares. Deixe vazio nos dias de descanso.
          </p>
          <div className="week">
            {ORDER.map((d) => (
              <label key={d} className="week-row">
                <span>{WEEKDAY_FULL[d]}</span>
                <input
                  value={form.days[d]}
                  className={parsed[d] === null ? "invalid" : ""}
                  placeholder="Descanso"
                  onChange={(e) => {
                    const days = [...form.days];
                    days[d] = e.target.value;
                    setForm({ ...form, days });
                  }}
                />
                <span className="muted small">{parsed[d] ? (parsed[d]!.length ? fmtMin(dayMinutes(parsed[d]!)) : "") : "inválido"}</span>
              </label>
            ))}
          </div>
          <div className="row">
            <button type="button" className="ghost small" onClick={() => {
              const days = [...form.days];
              for (const d of [2, 3, 4, 5]) days[d] = days[1];
              setForm({ ...form, days });
            }}>
              Copiar segunda para terça a sexta
            </button>
            <span className="muted small">Total semanal: {fmtMin(weekly)}</span>
          </div>
          {form.id && (
            <label className="check">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Jornada ativa
            </label>
          )}
          {formError && <Banner tone="error">{formError}</Banner>}
          <div className="row">
            <button className="primary" disabled={busy} type="submit">{busy ? "Salvando" : "Salvar"}</button>
            <button className="ghost" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="card flush">
        {!data ? <Loading /> : data.length === 0 ? (
          <Empty>Nenhuma jornada cadastrada. Cadastre as jornadas e depois defina a de cada funcionário.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Horários</th>
                  <th className="num">Semana</th>
                  <th className="num">Funcionários</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id} className={s.active ? "" : "dim"}>
                    <td>
                      <div className="strong">{s.code}</div>
                      <div className="muted small">{s.name}{s.active ? "" : " (inativa)"}</div>
                    </td>
                    <td className="small">{scheduleSummary(s.days)}</td>
                    <td className="num">{fmtMin(s.days.reduce((x, d) => x + dayMinutes(d), 0))}</td>
                    <td className="num">{s.employees}</td>
                    {admin && <td className="right"><button className="ghost small" onClick={() => edit(s)}>Editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Holidays />
    </>
  );
}

function Holidays() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, reload } = useLoad(() => rpc<Holiday[]>("portal_holidays", { p_year: year }), [year]);
  const [form, setForm] = useState({ date: "", reason: "" });
  const [msg, setMsg] = useState("");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    try {
      await rpc("portal_occurrence_add", { p: { type: "feriado", date_from: form.date, reason: form.reason } });
      setForm({ date: "", reason: "" });
      reload();
    } catch (err) {
      setMsg(errorText(err));
    }
  };

  const remove = async (h: Holiday) => {
    const reason = window.prompt(`Motivo para remover o feriado de ${br(h.date_from)}:`);
    if (!reason) return;
    setMsg("");
    try {
      await rpc("portal_occurrence_revoke", { p_id: h.id, p_reason: reason });
      reload();
    } catch (err) {
      setMsg(errorText(err));
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Feriados</h2>
        <div className="row">
          <button className="ghost small" onClick={() => setYear(year - 1)}>{year - 1}</button>
          <span className="strong">{year}</span>
          <button className="ghost small" onClick={() => setYear(year + 1)}>{year + 1}</button>
        </div>
      </div>
      <p className="muted small">Valem para todos os funcionários: o dia não conta como previsto e quem trabalhar ganha as horas.</p>
      {(error || msg) && <Banner tone="error">{error || msg}</Banner>}
      <form className="inline-form" onSubmit={add}>
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        <input placeholder="Nome do feriado" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={3} />
        <button className="primary small" type="submit">Adicionar</button>
      </form>
      {!data ? <Loading /> : data.length === 0 ? <Empty>Nenhum feriado em {year}.</Empty> : (
        <table>
          <tbody>
            {data.map((h) => (
              <tr key={h.id}>
                <td className="nowrap strong">{br(h.date_from)}{h.date_to !== h.date_from ? ` a ${br(h.date_to)}` : ""}</td>
                <td>{h.reason}{h.type === "dsr" ? " (DSR)" : ""}</td>
                <td className="right"><button className="ghost small danger" onClick={() => remove(h)}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
