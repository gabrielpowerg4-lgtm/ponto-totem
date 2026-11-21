import { useMemo, useState } from "react";
import {
  errorText, formatCpf, formatDateTime, rpc, type Employee, type Me, type Site, type Terminal,
} from "../api";
import { Badge, Banner, Empty, Loading, PageHead, useLoad } from "../ui";

// ---------------------------------------------------------------------------
// Funcionarios (cadastro principal no Bubble: aqui so consulta)
// ---------------------------------------------------------------------------

export function Employees() {
  const { data, error } = useLoad(() => rpc<Employee[]>("portal_employees"));
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
    return { active: all.filter((e) => e.active).length, noPin: all.filter((e) => e.active && !e.has_pin).length };
  }, [data]);

  return (
    <>
      <PageHead
        title="Funcionários"
        lead="O cadastro é feito no Bubble e chega aqui pela integração. Esta tela é só para consulta."
      />
      {error && <Banner tone="error">{error}</Banner>}
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
          {counts.active} ativos{counts.noPin > 0 ? ` · ${counts.noPin} sem senha de ponto` : ""} · mostrando {list.length}
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
                    </td>
                    <td className="nowrap">{formatCpf(e.cpf)}</td>
                    <td>{e.sites.length ? e.sites.join(", ") : <span className="muted">Todas</span>}</td>
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
