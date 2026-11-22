import { useEffect, useMemo, useState } from "react";
import {
  br, docAlertPreview as callPreview, download, errorText, formatCpf, rpc, supabase, todayIso, type Employee, type Me, type Site,
} from "../api";
import { askConfirm, askText, Badge, Banner, Empty, Loading, PageHead, useLoad } from "../ui";
import { Avatar, CONTRACT_LABEL, photoUrl } from "./EmployeeForm";
import { hashParams } from "./Treatment";

// Controle de documentos e vencimentos.

export type DocType = {
  id: string;
  code: string;
  name: string;
  validity_days: number | null;
  alert_days: number;
  active: boolean;
  documents: number;
  notify_enabled: boolean;
  notify_emails: string[];
  notify_frequency: "diario" | "semanal";
  notify_weekday: number;
  notify_employee: boolean;
};

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

type Notice = { run_date: string; kind: "rh" | "funcionario" | "teste"; recipient: string; documents: number; ok: boolean; error: string | null; created_at: string };

export type Doc = {
  id: string;
  cpf: string;
  name: string;
  job_title: string;
  contract_type: string;
  active_employee: boolean;
  photo_path: string;
  type_id: string;
  type_code: string;
  type_name: string;
  alert_days: number;
  issued_on: string;
  expires_on: string | null;
  days_left: number | null;
  site_id: string | null;
  site_name: string | null;
  notes: string;
  file_path: string | null;
  file_name: string | null;
  state: "ativo" | "substituido";
  status: "vencido" | "alerta" | "valido" | "substituido";
  replaced_by: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
};

const STATUS: Record<Doc["status"], { label: string; tone: "error" | "warn" | "ok" | "neutral" }> = {
  vencido: { label: "Vencido", tone: "error" },
  alerta: { label: "Alerta", tone: "warn" },
  valido: { label: "Válido", tone: "ok" },
  substituido: { label: "Substituído", tone: "neutral" },
};

const plain = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysText(d: Doc) {
  if (d.days_left === null) return "sem vencimento";
  if (d.days_left < 0) return `venceu há ${-d.days_left} dia(s)`;
  if (d.days_left === 0) return "vence hoje";
  return `vence em ${d.days_left} dia(s)`;
}

export async function openDocFile(path: string) {
  const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
  if (error || !data) throw new Error("Não foi possível abrir o arquivo.");
  window.open(data.signedUrl, "_blank", "noopener");
}

// ---------------------------------------------------------------------------
// Vencimentos
// ---------------------------------------------------------------------------

export function Documents({ me }: { me: Me }) {
  const params = hashParams();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState("");
  const { data: types } = useLoad(() => rpc<DocType[]>("portal_doc_types"));
  const { data: employees } = useLoad(() => rpc<Employee[]>("portal_employees"));
  const { data: sites } = useLoad(() => rpc<Site[]>("portal_sites"));
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [typeSel, setTypeSel] = useState<string[]>([]);
  const [statusSel, setStatusSel] = useState<string[]>(params.get("status") ? [params.get("status")!] : []);
  const [site, setSite] = useState("");
  const [contract, setContract] = useState("");
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<{ mode: "new" | "edit" | "renew"; doc?: Doc } | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const load = () => {
    rpc<Doc[]>("portal_documents", { p: {} }).then(setDocs).catch((e) => setError(errorText(e, "Não foi possível carregar.")));
  };
  useEffect(load, []);
  useEffect(() => {
    const paths = Array.from(new Set((docs ?? []).map((d) => d.photo_path).filter(Boolean)));
    if (paths.length) photoUrl(paths).then(setPhotos).catch(() => undefined);
  }, [docs]);

  const base = (docs ?? []).filter((d) => inactive || d.active_employee);
  const count = (s: string) => base.filter((d) => d.status === s).length;
  const toggle = (list: string[], v: string, set: (l: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const list = base.filter((d) => {
    if (typeSel.length && !typeSel.includes(d.type_id)) return false;
    if (statusSel.length && !statusSel.includes(d.status)) return false;
    if (site && (site === "_empresa" ? d.site_id !== null : d.site_id !== site)) return false;
    if (contract && d.contract_type !== contract) return false;
    const q = plain(query.trim());
    return !q || plain(d.name).includes(q) || d.cpf.includes(q.replace(/\D/g, "") || "#") || plain(d.type_code).includes(q);
  });

  const remove = async (d: Doc) => {
    const reason = await askText(`Motivo para excluir o ${d.type_code} de ${d.name}:`, { title: "Excluir documento", confirmLabel: "Excluir" });
    if (!reason) return;
    try {
      await rpc("portal_document_remove", { p: { id: d.id, reason } });
      setMsg({ tone: "ok", text: "Documento excluído. O registro fica na auditoria." });
      load();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e, "Não foi possível excluir.") });
    }
  };

  const exportCsv = () => {
    const head = "Funcionário;CPF;Cargo;Contrato;Documento;Escopo;Emissão;Vencimento;Situação;Dias";
    const lines = list.map((d) => [d.name, formatCpf(d.cpf), d.job_title, CONTRACT_LABEL[d.contract_type] ?? d.contract_type,
      d.type_code, d.site_name ?? "Empresa", br(d.issued_on), d.expires_on ? br(d.expires_on) : "", STATUS[d.status].label,
      d.days_left ?? ""].join(";"));
    download(`vencimentos-${todayIso()}.csv`, "﻿" + [head, ...lines].join("\n"));
  };

  return (
    <>
      <PageHead
        title="Vencimentos"
        lead="Documentos dos funcionários (ASO, NRs, contratos) com emissão, vencimento e situação calculada pela data de hoje."
        actions={<>
          <button className="ghost" onClick={exportCsv} disabled={!docs?.length}>Exportar planilha</button>
          <button className="primary" onClick={() => setEditing({ mode: "new" })}>Novo documento</button>
        </>}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <div className="stats">
        {(["vencido", "alerta", "valido"] as const).map((s) => (
          <button key={s} className={`stat stat-button ${statusSel.length === 1 && statusSel[0] === s ? "on" : ""}`}
            onClick={() => setStatusSel(statusSel.length === 1 && statusSel[0] === s ? [] : [s])}>
            <div className="muted small">{s === "vencido" ? "Vencidos" : s === "alerta" ? "Em alerta" : "Válidos"}</div>
            <div className={`stat-value doc-${s}`}>{docs ? count(s) : "–"}</div>
          </button>
        ))}
        <div className="stat">
          <div className="muted small">Funcionários com documento</div>
          <div className="stat-value">{new Set(base.map((d) => d.cpf)).size}</div>
        </div>
      </div>
      <div className="card">
        <div className="filters">
          <label className="wide">
            Buscar
            <input value={query} placeholder="Nome, CPF ou documento" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label>
            Obra
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">Todas</option>
              <option value="_empresa">Empresa (sem obra)</option>
              {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>
            Contrato
            <select value={contract} onChange={(e) => setContract(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(CONTRACT_LABEL).filter(([k]) => k).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="chips">
          {(types ?? []).filter((t) => t.active || t.documents).map((t) => (
            <button key={t.id} type="button" className={`chip ${typeSel.includes(t.id) ? "on" : ""}`}
              title={t.name} onClick={() => toggle(typeSel, t.id, setTypeSel)}>{t.code}</button>
          ))}
        </div>
        <div className="chips">
          {(["vencido", "alerta", "valido"] as const).map((s) => (
            <button key={s} type="button" className={`chip chip-${s} ${statusSel.includes(s) ? "on" : ""}`}
              onClick={() => toggle(statusSel, s, setStatusSel)}>{STATUS[s].label}</button>
          ))}
          <label className="check small">
            <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Incluir desligados
          </label>
        </div>
      </div>

      {!docs ? <Loading /> : list.length === 0 ? (
        <Empty>{docs.length === 0 ? "Nenhum documento cadastrado ainda." : "Nenhum documento com estes filtros."}</Empty>
      ) : (
        <section className="card flush">
          <div className="table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th>Documento</th>
                  <th>Escopo</th>
                  <th>Emissão</th>
                  <th>Vencimento</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div className="emp-cell">
                        <Avatar name={d.name} url={photos[d.photo_path]} size={32} />
                        <div>
                          <div className="strong">{d.name}{!d.active_employee && <span className="muted small"> · desligado</span>}</div>
                          <div className="muted small">{d.job_title || "–"} · {CONTRACT_LABEL[d.contract_type] ?? (d.contract_type || "–")}</div>
                        </div>
                      </div>
                    </td>
                    <td title={d.type_name}><span className="strong">{d.type_code}</span></td>
                    <td>{d.site_name ?? <span className="muted">Empresa</span>}</td>
                    <td className="nowrap">{br(d.issued_on)}</td>
                    <td className="nowrap">
                      {d.expires_on ? br(d.expires_on) : "–"}
                      <div className="muted small">{daysText(d)}</div>
                    </td>
                    <td><Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge></td>
                    <td className="right nowrap">
                      {d.file_path && (
                        <button className="ghost small" title={d.file_name ?? "Arquivo"}
                          onClick={() => openDocFile(d.file_path!).catch((e) => setMsg({ tone: "error", text: e.message }))}>
                          Arquivo
                        </button>
                      )}
                      <button className="ghost small" onClick={() => setEditing({ mode: "renew", doc: d })}>Renovar</button>
                      <button className="ghost small" onClick={() => setEditing({ mode: "edit", doc: d })}>Editar</button>
                      <button className="ghost small danger" onClick={() => remove(d)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {editing && types && employees && (
        <DocumentForm
          me={me}
          mode={editing.mode}
          doc={editing.doc}
          types={types}
          employees={employees}
          sites={sites ?? []}
          onClose={() => setEditing(null)}
          onSaved={(text) => { setEditing(null); setMsg({ tone: "ok", text }); load(); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Formulario (novo, editar, renovar)
// ---------------------------------------------------------------------------

export function DocumentForm({ me, mode, doc, types, employees, sites, cpf, onClose, onSaved }: {
  me: Me;
  mode: "new" | "edit" | "renew";
  doc?: Doc;
  types: DocType[];
  employees: Employee[];
  sites: Site[];
  cpf?: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [person, setPerson] = useState(doc?.cpf ?? cpf ?? "");
  const [search, setSearch] = useState(() => {
    const e = employees.find((x) => x.cpf === (doc?.cpf ?? cpf));
    return e ? `${e.name} · ${formatCpf(e.cpf)}` : "";
  });
  const [typeId, setTypeId] = useState(doc?.type_id ?? "");
  const [issued, setIssued] = useState(mode === "edit" && doc ? doc.issued_on : todayIso());
  const [expires, setExpires] = useState(mode === "edit" && doc ? doc.expires_on ?? "" : "");
  const [expiresTouched, setExpiresTouched] = useState(mode === "edit");
  const [site, setSite] = useState(doc?.site_id ?? "");
  const [notes, setNotes] = useState(mode === "edit" ? doc?.notes ?? "" : "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const type = types.find((t) => t.id === typeId);
  // Vencimento sugerido pela validade do tipo, ate a pessoa ajustar.
  useEffect(() => {
    if (expiresTouched) return;
    setExpires(type?.validity_days && issued ? addDays(issued, type.validity_days) : "");
  }, [typeId, issued, expiresTouched]);

  const pick = (text: string) => {
    setSearch(text);
    const e = employees.find((x) => `${x.name} · ${formatCpf(x.cpf)}` === text);
    setPerson(e?.cpf ?? "");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    if (!person) return setMsg("Escolha o funcionário na lista.");
    if (file && file.size > 10 * 1024 * 1024) return setMsg("Arquivo maior que 10 MB.");
    if (file && !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return setMsg("Envie PDF, JPG ou PNG.");
    if (mode === "renew" && !(await askConfirm(`O ${doc!.type_code} atual (vencimento ${doc!.expires_on ? br(doc!.expires_on) : "–"}) vai para o histórico como substituído. Confirmar?`, { title: "Renovar documento", confirmLabel: "Renovar" }))) return;
    setBusy(true);
    try {
      let upload: Record<string, unknown> = {};
      if (file) {
        const safe = file.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
        const path = `${me.company_id}/${person}/${crypto.randomUUID()}-${safe}`;
        const up = await supabase.storage.from("documentos").upload(path, file, { contentType: file.type });
        if (up.error) throw new Error("invalid_file");
        upload = { file_path: path, file_name: file.name, file_mime: file.type, file_size: file.size };
      }
      await rpc("portal_document_save", {
        p: {
          ...(mode === "edit" ? { id: doc!.id } : mode === "renew" ? { renew_of: doc!.id } : { cpf: person }),
          type_id: typeId, issued_on: issued, expires_on: expires, site_id: site, notes, ...upload,
        },
      });
      onSaved(mode === "renew" ? "Documento renovado; o anterior foi para o histórico." : mode === "edit" ? "Documento atualizado." : "Documento cadastrado.");
    } catch (err) {
      setMsg(errorText(err, "Não foi possível salvar."));
    }
    setBusy(false);
  };

  const title = mode === "new" ? "Novo documento" : mode === "renew" ? `Renovar ${doc?.type_code}` : `Editar ${doc?.type_code}`;
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="ghost small" onClick={onClose}>Fechar</button>
        </div>
        <div className="drawer-body">
          {msg && <Banner tone="error">{msg}</Banner>}
          <label>
            Funcionário
            {mode === "new" && !cpf ? (
              <>
                <input list="doc-employees" value={search} required placeholder="Digite o nome ou CPF" onChange={(e) => pick(e.target.value)} />
                <datalist id="doc-employees">
                  {employees.filter((x) => x.active).map((x) => <option key={x.cpf} value={`${x.name} · ${formatCpf(x.cpf)}`} />)}
                </datalist>
              </>
            ) : <input value={search} disabled />}
          </label>
          <label>
            Documento
            <select value={typeId} required disabled={mode === "renew"} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Escolha o tipo</option>
              {types.filter((t) => t.active || t.id === typeId).map((t) => (
                <option key={t.id} value={t.id}>{t.code} · {t.name}</option>
              ))}
            </select>
          </label>
          {type && (
            <p className="muted small">
              Validade {type.validity_days ? `${type.validity_days} dias` : "indeterminada"} · alerta {type.alert_days} dias antes
            </p>
          )}
          <div className="grid-2">
            <label>
              Data do documento
              <input type="date" value={issued} required max={todayIso()} onChange={(e) => setIssued(e.target.value)} />
            </label>
            <label>
              Vencimento
              <input type="date" value={expires} min={issued}
                onChange={(e) => { setExpires(e.target.value); setExpiresTouched(true); }} />
            </label>
          </div>
          {expiresTouched && type?.validity_days && (
            <button type="button" className="link small" onClick={() => setExpiresTouched(false)}>Recalcular pela validade do tipo</button>
          )}
          <label>
            Escopo
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">Empresa (todas as obras)</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>
            Notas
            <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label>
            Arquivo (PDF, JPG ou PNG, até 10 MB){mode === "edit" && doc?.file_name ? ` · atual: ${doc.file_name}` : ""}
            <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="drawer-foot">
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy}>{busy ? "Salvando" : mode === "renew" ? "Renovar" : "Salvar"}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tipos de documento (administrador)
// ---------------------------------------------------------------------------

export function DocTypes() {
  const { data, error, reload } = useLoad(() => rpc<DocType[]>("portal_doc_types"));
  const { data: notices, reload: reloadNotices } = useLoad(() => rpc<Notice[]>("portal_doc_notifications"));
  const [editing, setEditing] = useState<(Partial<DocType> & { emailsText?: string }) | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<{ subject?: string; html?: string; documents: number } | null>(null);
  const [busy, setBusy] = useState("");

  const open = (t: Partial<DocType>) => {
    setPreview(null);
    setMsg(null);
    setEditing({ ...t, emailsText: (t.notify_emails ?? []).join(", ") });
  };
  const emailsOf = (text: string) => text.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const payload = () => ({
    id: editing?.id ?? "", code: editing?.code ?? "", name: editing?.name ?? "",
    validity_days: editing?.validity_days ?? "", alert_days: editing?.alert_days ?? 30, active: editing?.active ?? true,
    notify_enabled: editing?.notify_enabled ?? false, notify_emails: emailsOf(editing?.emailsText ?? ""),
    notify_frequency: editing?.notify_frequency ?? "semanal", notify_weekday: editing?.notify_weekday ?? 1,
    notify_employee: editing?.notify_employee ?? false,
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy("save");
    try {
      await rpc("portal_doc_type_save", { p: payload() });
      setEditing(null);
      setMsg({ tone: "ok", text: "Tipo salvo." });
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err, "Não foi possível salvar.") });
    }
    setBusy("");
  };

  const copyEmails = async () => {
    if (!editing?.id) return;
    if (!(await askConfirm(`Salvar este tipo e copiar os destinatários (${emailsOf(editing.emailsText ?? "").length}) para todos os outros tipos? A ativação e a frequência de cada tipo não mudam.`, { title: "Copiar destinatários", confirmLabel: "Copiar" }))) return;
    setBusy("copy");
    try {
      await rpc("portal_doc_type_save", { p: payload() });
      const n = await rpc<number>("portal_doc_type_copy_emails", { p: { id: editing.id } });
      setMsg({ tone: "ok", text: `Destinatários copiados para ${n} tipo(s).` });
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err, "Não foi possível copiar.") });
    }
    setBusy("");
  };

  const runPreview = async (send: boolean) => {
    if (!editing?.id) return;
    setBusy(send ? "send" : "preview");
    setMsg(null);
    try {
      const r = await callPreview(editing.id, send);
      if (send) {
        setMsg({ tone: "ok", text: r.documents ? `Aviso de teste enviado para o seu e-mail (${r.documents} documento(s)).` : "Nenhum documento deste tipo em alerta ou vencido: nada a enviar." });
        reloadNotices();
      } else setPreview(r);
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err, "Não foi possível gerar o aviso.") });
    }
    setBusy("");
  };

  return (
    <>
      <PageHead
        title="Tipos de documento"
        lead="Validade, dias de alerta e aviso por e-mail de cada tipo. O vencimento do documento é sugerido pela validade e pode ser ajustado no cadastro."
        actions={<button className="primary" onClick={() => open({ active: true, alert_days: 30, validity_days: 365, notify_frequency: "semanal", notify_weekday: 1 })}>Novo tipo</button>}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {msg && !editing && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {!data ? <Loading /> : (
        <section className="card flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Nome</th>
                  <th className="num">Validade</th>
                  <th className="num">Alerta</th>
                  <th className="num">Documentos</th>
                  <th>Aviso por e-mail</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td className="strong">{t.code}</td>
                    <td>{t.name}</td>
                    <td className="num nowrap">{t.validity_days ? `${t.validity_days} dias` : "sem vencimento"}</td>
                    <td className="num nowrap">{t.alert_days} dias</td>
                    <td className="num">{t.documents}</td>
                    <td className="small">
                      {t.notify_enabled ? (
                        <>
                          <Badge tone="ok">{t.notify_frequency === "diario" ? "Diário" : `Semanal · ${WEEKDAYS[t.notify_weekday].split("-")[0]}`}</Badge>
                          <div className="muted">{t.notify_emails.length} destinatário(s){t.notify_employee ? " + funcionário" : ""}</div>
                        </>
                      ) : <span className="muted">desativado</span>}
                    </td>
                    <td>{t.active ? <Badge tone="ok">Habilitado</Badge> : <Badge tone="neutral">Desabilitado</Badge>}</td>
                    <td className="right"><button className="ghost small" onClick={() => open(t)}>Editar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Histórico de avisos</h2><span className="muted small">Envio automático todo dia às 07:00</span></div>
        {!notices ? <Loading /> : notices.length === 0 ? <p className="muted small">Nenhum aviso enviado ainda.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Quando</th><th>Para</th><th>Tipo</th><th className="num">Documentos</th><th>Resultado</th></tr></thead>
              <tbody>
                {notices.map((n, i) => (
                  <tr key={i}>
                    <td className="nowrap">{new Date(n.created_at).toLocaleString("pt-BR")}</td>
                    <td>{n.recipient}</td>
                    <td>{n.kind === "rh" ? "RH" : n.kind === "funcionario" ? "Funcionário" : "Teste"}</td>
                    <td className="num">{n.documents}</td>
                    <td>{n.ok ? <Badge tone="ok">Enviado</Badge> : <Badge tone="error">{errorText(new Error(n.error ?? "smtp_failed"), "Falhou")}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <div className="drawer-scrim" onClick={() => setEditing(null)}>
          <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div className="drawer-head">
              <h2>{editing.id ? `Editar ${editing.code}` : "Novo tipo"}</h2>
              <button type="button" className="ghost small" onClick={() => setEditing(null)}>Fechar</button>
            </div>
            <div className="drawer-body">
              {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
              <label>
                Referência (código curto)
                <input value={editing.code ?? ""} maxLength={20} required onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
              </label>
              <label>
                Nome
                <input value={editing.name ?? ""} maxLength={120} required onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              <div className="grid-2">
                <label>
                  Validade (dias)
                  <input type="number" min={1} max={3650} value={editing.validity_days ?? ""} placeholder="sem vencimento"
                    onChange={(e) => setEditing({ ...editing, validity_days: e.target.value ? Number(e.target.value) : null })} />
                </label>
                <label>
                  Alerta (dias antes)
                  <input type="number" min={0} max={365} required value={editing.alert_days ?? 30}
                    onChange={(e) => setEditing({ ...editing, alert_days: Number(e.target.value) })} />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={editing.active ?? true} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                Habilitado (aparece no cadastro de documentos)
              </label>
              {editing.id && <p className="muted small">Mudar a validade não altera documentos já cadastrados; vale para os próximos.</p>}

              <h3>Aviso por e-mail</h3>
              <label className="check">
                <input type="checkbox" checked={editing.notify_enabled ?? false} onChange={(e) => setEditing({ ...editing, notify_enabled: e.target.checked })} />
                Enviar aviso de vencimento deste tipo
              </label>
              <label>
                Destinatários (separados por vírgula)
                <textarea rows={2} value={editing.emailsText ?? ""} placeholder="rh@empresa.com.br, seguranca@empresa.com.br"
                  onChange={(e) => setEditing({ ...editing, emailsText: e.target.value })} />
              </label>
              <div className="grid-2">
                <label>
                  Frequência
                  <select value={editing.notify_frequency ?? "semanal"}
                    onChange={(e) => setEditing({ ...editing, notify_frequency: e.target.value as "diario" | "semanal" })}>
                    <option value="diario">Diário (só novidades)</option>
                    <option value="semanal">Semanal (resumo)</option>
                  </select>
                </label>
                {editing.notify_frequency !== "diario" && (
                  <label>
                    Dia da semana
                    <select value={editing.notify_weekday ?? 1} onChange={(e) => setEditing({ ...editing, notify_weekday: Number(e.target.value) })}>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <label className="check">
                <input type="checkbox" checked={editing.notify_employee ?? false} onChange={(e) => setEditing({ ...editing, notify_employee: e.target.checked })} />
                Enviar também para o funcionário (só os documentos dele, se tiver e-mail no cadastro)
              </label>
              <p className="muted small">
                {editing.notify_frequency === "diario"
                  ? "Diário: cada documento é avisado uma vez quando entra em alerta e uma vez quando vence."
                  : "Semanal: no dia escolhido, resumo de tudo que está em alerta ou vencido deste tipo."}
                {" "}Envio às 07:00. Quem recebe vários tipos ganha um único e-mail com tudo.
              </p>
              {editing.id && (
                <div className="toolbar">
                  <button type="button" className="ghost small" disabled={!!busy} onClick={() => runPreview(false)}>Ver prévia</button>
                  <button type="button" className="ghost small" disabled={!!busy} onClick={() => runPreview(true)}>
                    {busy === "send" ? "Enviando" : "Enviar teste para mim"}
                  </button>
                  <button type="button" className="ghost small" disabled={!!busy} onClick={copyEmails}>Copiar destinatários para todos os tipos</button>
                </div>
              )}
              {preview && (
                preview.documents === 0
                  ? <p className="muted small">Nenhum documento deste tipo em alerta ou vencido agora.</p>
                  : (
                    <div className="mail-preview">
                      <div className="small"><b>Assunto:</b> {preview.subject}</div>
                      <iframe title="Prévia do aviso" sandbox="" srcDoc={preview.html} />
                    </div>
                  )
              )}
            </div>
            <div className="drawer-foot">
              <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="primary" disabled={!!busy}>Salvar</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Documentos de um funcionario (no cadastro)
// ---------------------------------------------------------------------------

export function EmployeeDocs({ cpf }: { cpf: string }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    rpc<Doc[]>("portal_documents", { p: { cpf, history: true } }).then(setDocs).catch((e) => setError(errorText(e)));
  }, [cpf]);
  const sorted = useMemo(() => [...(docs ?? [])].sort((a, b) =>
    a.state.localeCompare(b.state) || a.type_code.localeCompare(b.type_code) || b.issued_on.localeCompare(a.issued_on)), [docs]);
  if (error) return <p className="muted small">{error}</p>;
  if (!docs) return <p className="muted small">Carregando documentos</p>;
  return (
    <div className="emp-docs">
      {sorted.length === 0 ? <p className="muted small">Nenhum documento cadastrado.</p> : (
        <ul>
          {sorted.map((d) => (
            <li key={d.id} className={d.state === "substituido" ? "muted" : ""}>
              <span className="strong">{d.type_code}</span> · {br(d.issued_on)} a {d.expires_on ? br(d.expires_on) : "–"}{" "}
              <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
              {d.file_path && <button type="button" className="link small" onClick={() => openDocFile(d.file_path!).catch(() => undefined)}> arquivo</button>}
            </li>
          ))}
        </ul>
      )}
      <a className="link small" href={`#documents?q=${cpf}`}>Gerenciar documentos</a>
    </div>
  );
}
