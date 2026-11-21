import { useMemo, useState } from "react";
import {
  br, errorText, formatCpf, formatDateTime, rpc, todayIso, type Employee, type Me, type ScheduleRow, type Site,
  type Terminal,
} from "../api";
import { Badge, Banner, Empty, Loading, PageHead, useLoad } from "../ui";

// ---------------------------------------------------------------------------
// Funcionarios (cadastro principal no Bubble: aqui so consulta)
// ---------------------------------------------------------------------------

export function Employees() {
  const { data, error, reload } = useLoad(() => rpc<Employee[]>("portal_employees"));
  const { data: schedules } = useLoad(() => rpc<ScheduleRow[]>("portal_schedules"));
  const [editing, setEditing] = useState<{ cpf: string; schedule: string; from: string } | null>(null);
  const [saveError, setSaveError] = useState("");
  const [bulk, setBulk] = useState<{ schedule: string; from: string } | null>(null);
  const [dates, setDates] = useState<{ cpf: string; admitted_on: string; dismissed_on: string } | null>(null);

  const saveDates = async () => {
    if (!dates) return;
    setSaveError("");
    try {
      await rpc("portal_employee_dates", { p: dates });
      setDates(null);
      reload();
    } catch (e) {
      setSaveError(errorText(e));
    }
  };

  const saveSchedule = async () => {
    if (!editing) return;
    setSaveError("");
    try {
      await rpc("portal_employee_schedule", { p_cpf: editing.cpf, p_schedule: editing.schedule, p_from: editing.from });
      setEditing(null);
      reload();
    } catch (e) {
      setSaveError(errorText(e));
    }
  };

  const applyBulk = async (targets: Employee[]) => {
    if (!bulk || !bulk.schedule) return;
    if (!window.confirm(`Definir esta jornada para ${targets.length} funcionário(s) sem jornada, a partir de ${br(bulk.from)}?`)) return;
    setSaveError("");
    try {
      for (const e of targets) {
        await rpc("portal_employee_schedule", { p_cpf: e.cpf, p_schedule: bulk.schedule, p_from: bulk.from });
      }
      setBulk(null);
      reload();
    } catch (e) {
      setSaveError(errorText(e));
    }
  };
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return (data ?? []).filter((e) => {
      if (status === "active" && !e.active) return false;
      if (status === "inactive" && e.active) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || (digits !== "" && e.cpf.includes(digits)) ||
        e.sites.some((s) => s.toLowerCase().includes(q));
    });
  }, [data, query, status]);

  const counts = useMemo(() => {
    const all = data ?? [];
    return {
      active: all.filter((e) => e.active).length,
      noPin: all.filter((e) => e.active && !e.has_pin).length,
      noSchedule: all.filter((e) => e.active && !e.schedule),
    };
  }, [data]);
  const activeSchedules = (schedules ?? []).filter((s) => s.active);

  return (
    <>
      <PageHead
        title="Funcionários"
        lead="O cadastro é feito no Bubble e chega aqui pela integração. Aqui você define a jornada de cada um (o Bubble também pode enviá-la)."
      />
      {(error || saveError) && <Banner tone="error">{error || saveError}</Banner>}
      {counts.noSchedule.length > 0 && activeSchedules.length > 0 && (
        <div className="card soft">
          <div className="row">
            <span className="small"><span className="strong">{counts.noSchedule.length}</span> funcionários ativos sem jornada.</span>
            {!bulk ? (
              <button className="ghost small" onClick={() => setBulk({ schedule: "", from: todayIso().slice(0, 8) + "01" })}>
                Definir uma jornada para todos eles
              </button>
            ) : (
              <>
                <select className="compact" value={bulk.schedule} onChange={(e) => setBulk({ ...bulk, schedule: e.target.value })}>
                  <option value="">Escolha a jornada</option>
                  {activeSchedules.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                </select>
                <span className="small muted">a partir de</span>
                <input className="compact" type="date" value={bulk.from} onChange={(e) => setBulk({ ...bulk, from: e.target.value })} />
                <button className="primary small" disabled={!bulk.schedule} onClick={() => applyBulk(counts.noSchedule)}>Aplicar</button>
                <button className="ghost small" onClick={() => setBulk(null)}>Cancelar</button>
              </>
            )}
          </div>
        </div>
      )}
      <div className="toolbar">
        <input
          className="search"
          placeholder="Buscar por nome, CPF ou obra"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="segmented">
          {(["active", "inactive", "all"] as const).map((s) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
              {s === "active" ? "Ativos" : s === "inactive" ? "Desligados" : "Todos"}
            </button>
          ))}
        </div>
      </div>
      {data && (
        <p className="muted small">
          {counts.active} ativos{counts.noPin > 0 ? ` · ${counts.noPin} sem senha de ponto` : ""}
          {counts.noSchedule.length > 0 ? ` · ${counts.noSchedule.length} sem jornada` : ""} · mostrando {list.length}
        </p>
      )}
      <section className="card flush">
        {!data ? <Loading /> : list.length === 0 ? <Empty>Nenhum funcionário encontrado.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CPF</th>
                  <th>Obras</th>
                  <th>Jornada</th>
                  <th>Contrato</th>
                  <th>Senha de ponto</th>
                  <th>Última marcação</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.cpf}>
                    <td>
                      <div className="strong">{e.name}</div>
                      {e.email && <div className="muted small">{e.email}</div>}
                      {(e.portal_role || e.tablet_responsible) && (
                        <div className="chips tight">
                          {e.portal_role === "admin" && <Badge tone="ok">Administrador</Badge>}
                          {e.portal_role === "rh" && <Badge tone="neutral">RH</Badge>}
                          {e.tablet_responsible && <Badge tone="neutral">Responsável pelo tablet</Badge>}
                        </div>
                      )}
                    </td>
                    <td className="nowrap">{formatCpf(e.cpf)}</td>
                    <td>{e.sites.length ? e.sites.join(", ") : <span className="muted">Todas</span>}</td>
                    <td className="nowrap">
                      {editing?.cpf === e.cpf ? (
                        <div className="row">
                          <select className="compact" value={editing.schedule} onChange={(x) => setEditing({ ...editing, schedule: x.target.value })}>
                            <option value="">Escolha</option>
                            {activeSchedules.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                          </select>
                          <input className="compact" type="date" value={editing.from} title="Vale a partir de"
                            onChange={(x) => setEditing({ ...editing, from: x.target.value })} />
                          <button className="primary small" disabled={!editing.schedule} onClick={saveSchedule}>Salvar</button>
                          <button className="ghost small" onClick={() => setEditing(null)}>Cancelar</button>
                        </div>
                      ) : (
                        <button className="link" onClick={() => setEditing({ cpf: e.cpf, schedule: e.schedule?.id ?? "", from: todayIso() })}>
                          {e.schedule ? e.schedule.code : "Definir"}
                        </button>
                      )}
                    </td>
                    <td className="nowrap small">
                      {dates?.cpf === e.cpf ? (
                        <div className="row">
                          <input className="compact" type="date" value={dates.admitted_on} title="Admissão"
                            onChange={(x) => setDates({ ...dates, admitted_on: x.target.value })} />
                          <input className="compact" type="date" value={dates.dismissed_on} title="Desligamento"
                            onChange={(x) => setDates({ ...dates, dismissed_on: x.target.value })} />
                          <button className="primary small" onClick={saveDates}>Salvar</button>
                          <button className="ghost small" onClick={() => setDates(null)}>Cancelar</button>
                        </div>
                      ) : (
                        <button className="link" title="Dias fora do contrato não contam no ponto"
                          onClick={() => setDates({ cpf: e.cpf, admitted_on: e.admitted_on ?? "", dismissed_on: e.dismissed_on ?? "" })}>
                          {e.admitted_on ? `Desde ${br(e.admitted_on)}` : "Admissão"}
                          {e.dismissed_on ? ` · até ${br(e.dismissed_on)}` : ""}
                        </button>
                      )}
                    </td>
                    <td>{e.has_pin ? <Badge tone="ok">Cadastrada</Badge> : <Badge tone="warn">Sem senha</Badge>}</td>
                    <td className="nowrap">{e.last_punch_at ? formatDateTime(e.last_punch_at) : <span className="muted">Nenhuma</span>}</td>
                    <td>{e.active ? <Badge tone="ok">Ativo</Badge> : <Badge tone="neutral">Desligado</Badge>}</td>
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
// Obras
// ---------------------------------------------------------------------------

type SiteForm = { id?: string; name: string; cno: string; address: string };

export function Sites({ me }: { me: Me }) {
  const { data, error, setData } = useLoad(() => rpc<Site[]>("portal_sites"));
  const [form, setForm] = useState<SiteForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const admin = me.role === "admin";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setFormError("");
    try {
      setData(await rpc<Site[]>("portal_site_save", { p_data: form }));
      setForm(null);
    } catch (err) {
      setFormError(errorText(err));
    }
    setBusy(false);
  };

  return (
    <>
      <PageHead
        title="Obras"
        lead="A obra é opcional: serve para organizar tablets e funcionários e aparece nos relatórios."
        actions={admin && !form && (
          <button className="primary" onClick={() => setForm({ name: "", cno: "", address: "" })}>Nova obra</button>
        )}
      />
      {error && <Banner tone="error">{error}</Banner>}

      {form && (
        <form className="card form" onSubmit={save}>
          <h2>{form.id ? "Editar obra" : "Nova obra"}</h2>
          <div className="grid-2">
            <label>
              Nome
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} />
            </label>
            <label>
              CNO (opcional)
              <input
                value={form.cno}
                inputMode="numeric"
                placeholder="12 números"
                onChange={(e) => setForm({ ...form, cno: e.target.value.replace(/\D/g, "").slice(0, 12) })}
              />
            </label>
          </div>
          <label>
            Endereço (opcional)
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={100} />
          </label>
          {formError && <Banner tone="error">{formError}</Banner>}
          <div className="row">
            <button className="primary" disabled={busy} type="submit">{busy ? "Salvando" : "Salvar"}</button>
            <button className="ghost" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="card flush">
        {!data ? <Loading /> : data.length === 0 ? <Empty>Nenhuma obra cadastrada.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Obra</th>
                  <th>CNO</th>
                  <th>Endereço</th>
                  <th className="num">Funcionários</th>
                  <th className="num">Tablets</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td className="strong">{s.name}</td>
                    <td>{s.cno || <span className="muted">Não informado</span>}</td>
                    <td>{s.address || <span className="muted">Não informado</span>}</td>
                    <td className="num">{s.employees}</td>
                    <td className="num">{s.terminals}</td>
                    {admin && (
                      <td className="right">
                        <button
                          className="ghost small"
                          onClick={() => setForm({ id: s.id, name: s.name, cno: s.cno, address: s.address })}
                        >
                          Editar
                        </button>
                      </td>
                    )}
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
// Tablets
// ---------------------------------------------------------------------------

export function Terminals({ me }: { me: Me }) {
  const { data, error, setData } = useLoad(() => rpc<Terminal[]>("portal_terminals"));
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const admin = me.role === "admin";

  const deactivate = async (t: Terminal) => {
    const ok = window.confirm(
      `Desativar o tablet ${t.code}? Ele deixa de registrar e enviar marcações. ` +
        "Marcações que ainda estiverem só no tablet não serão recebidas. Para voltar a usar, " +
        "será preciso vinculá-lo de novo com a chave da empresa.",
    );
    if (!ok) return;
    setBusy(t.id);
    setActionError("");
    try {
      setData(await rpc<Terminal[]>("portal_terminal_deactivate", { p_id: t.id }));
    } catch (e) {
      setActionError(errorText(e));
    }
    setBusy("");
  };

  return (
    <>
      <PageHead
        title="Tablets"
        lead="Tablets vinculados à empresa. Desative um tablet perdido, roubado ou substituído."
      />
      {(error || actionError) && <Banner tone="error">{error || actionError}</Banner>}
      <section className="card flush">
        {!data ? <Loading /> : data.length === 0 ? <Empty>Nenhum tablet vinculado.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Terminal</th>
                  <th>Obra</th>
                  <th>Responsável</th>
                  <th>Aparelho</th>
                  <th className="num">Marcações</th>
                  <th>Última comunicação</th>
                  <th>Situação</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id} className={t.active ? "" : "dim"}>
                    <td className="strong">{t.code}</td>
                    <td>{t.site || <span className="muted">Sem obra</span>}</td>
                    <td>{t.responsible || <span className="muted">Não informado</span>}</td>
                    <td>
                      <div>{t.model || <span className="muted">Não informado</span>}</div>
                      <div className="muted small">{[t.os, t.app_version && `app ${t.app_version}`].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="num">{t.punches}</td>
                    <td className="nowrap">{formatDateTime(t.last_seen_at)}</td>
                    <td>
                      {t.active ? <Badge tone="ok">Ativo</Badge> : (
                        <span title={`Desativado em ${formatDateTime(t.deactivated_at)}`}>
                          <Badge tone="neutral">Desativado</Badge>
                        </span>
                      )}
                    </td>
                    {admin && (
                      <td className="right">
                        {t.active && (
                          <button className="ghost small danger" disabled={busy === t.id} onClick={() => deactivate(t)}>
                            Desativar
                          </button>
                        )}
                      </td>
                    )}
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
