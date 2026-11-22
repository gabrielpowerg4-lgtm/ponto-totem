import { useEffect, useState } from "react";
import { errorText, formatCpf, rpc, supabase, type Employee, type Me, type Site } from "../api";
import { askConfirm, Banner } from "../ui";
import { EmployeeDocs } from "./Documents";

// Cadastro do funcionario no portal: dados pessoais, contrato, obras e perfis.
// Inclusao, troca de nome e desligamento geram o registro tipo 5 do AFD, com o seu CPF como responsavel.

type Form = {
  new: boolean;
  cpf: string;
  name: string;
  email: string;
  birth_date: string;
  sex: "" | "M" | "F";
  job_title: string;
  contract_type: string;
  admitted_on: string;
  dismissed_on: string;
  active: boolean;
  sites: string[];
  portal_role: "" | "admin" | "rh";
  tablet_responsible: boolean;
};

const CONTRACT_LABEL: Record<string, string> = {
  CLT: "CLT",
  PJ: "PJ",
  ESTAGIO: "Estágio",
  TEMPORARIO: "Temporário",
};
export { CONTRACT_LABEL };

function cpfValid(cpf: string) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const d = cpf.split("").map(Number);
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === d[9] && dv(10) === d[10];
}

export function photoUrl(paths: string[]): Promise<Record<string, string>> {
  const list = paths.filter(Boolean);
  if (list.length === 0) return Promise.resolve({});
  return supabase.storage.from("fotos").createSignedUrls(list, 3600).then(({ data }) => {
    const out: Record<string, string> = {};
    for (const x of data ?? []) if (x.path && x.signedUrl) out[x.path] = x.signedUrl;
    return out;
  });
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string; size?: number }) {
  return url
    ? <img className="emp-photo" src={url} alt="" width={size} height={size} />
    : <span className="emp-photo empty" style={{ width: size, height: size }}>{name.trim().charAt(0).toUpperCase()}</span>;
}

export default function EmployeeForm({ me, employee, sites, onClose, onSaved }: {
  me: Me;
  employee: Employee | null;
  sites: Site[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const admin = me.role === "admin";
  const [form, setForm] = useState<Form>(() => employee ? {
    new: false,
    cpf: employee.cpf,
    name: employee.name,
    email: employee.email ?? "",
    birth_date: employee.birth_date ?? "",
    sex: employee.sex ?? "",
    job_title: employee.job_title ?? "",
    contract_type: employee.contract_type ?? "",
    admitted_on: employee.admitted_on ?? "",
    dismissed_on: employee.dismissed_on ?? "",
    active: employee.active,
    sites: employee.site_ids ?? [],
    portal_role: employee.portal_role ?? "",
    tablet_responsible: !!employee.tablet_responsible,
  } : {
    new: true, cpf: "", name: "", email: "", birth_date: "", sex: "", job_title: "", contract_type: "CLT",
    admitted_on: "", dismissed_on: "", active: true, sites: [], portal_role: "", tablet_responsible: false,
  });
  const [photo, setPhoto] = useState<{ url?: string; file?: File; remove?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (employee?.photo_path) photoUrl([employee.photo_path]).then((m) => setPhoto({ url: m[employee.photo_path!] }));
  }, [employee?.photo_path]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const cpfDigits = form.cpf.replace(/\D/g, "").slice(0, 11);
  const cpfBad = form.new && cpfDigits.length === 11 && !cpfValid(cpfDigits);

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setMsg("A foto deve ser JPG, PNG ou WebP.");
    if (file.size > 2 * 1024 * 1024) return setMsg("A foto deve ter até 2 MB.");
    setMsg("");
    setPhoto({ file, url: URL.createObjectURL(file) });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.new && !cpfValid(cpfDigits)) return setMsg("CPF inválido: confira os números.");
    if (!form.active && !form.dismissed_on) {
      if (!await askConfirm("Desligar sem data de desligamento? Informe a data para que os dias seguintes não contem no ponto.")) return;
    }
    setBusy(true);
    setMsg("");
    try {
      const payload: Record<string, unknown> = { ...form, cpf: cpfDigits };
      if (!admin) delete payload.portal_role;
      await rpc("portal_employee_save", { p: payload });
      if (photo.file) {
        const ext = photo.file.type === "image/png" ? "png" : photo.file.type === "image/webp" ? "webp" : "jpg";
        const path = `${me.company_id}/${cpfDigits}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("fotos").upload(path, photo.file, { contentType: photo.file.type });
        if (up.error) throw new Error("invalid_file");
        await rpc("portal_employee_photo", { p: { cpf: cpfDigits, path } });
      } else if (photo.remove) {
        await rpc("portal_employee_photo", { p: { cpf: cpfDigits, path: "" } });
      }
      onSaved();
    } catch (err) {
      setMsg(errorText(err));
    }
    setBusy(false);
  };

  const toggleSite = (id: string) =>
    set("sites", form.sites.includes(id) ? form.sites.filter((x) => x !== id) : [...form.sites, id]);

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="drawer-head">
          <h2>{form.new ? "Novo funcionário" : "Editar funcionário"}</h2>
          <button type="button" className="ghost small" onClick={onClose}>Fechar</button>
        </div>

        <div className="drawer-body">
          <section className="emp-top">
            <div className="emp-photo-edit">
              {photo.url && !photo.remove
                ? <img className="emp-photo big" src={photo.url} alt="" />
                : <span className="emp-photo big empty">{(form.name || "?").trim().charAt(0).toUpperCase()}</span>}
              <label className="dp-upload">
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
                <span className="dp-upload-btn">{photo.url && !photo.remove ? "Trocar foto" : "Enviar foto"}</span>
              </label>
              {photo.url && !photo.remove && (
                <button type="button" className="link small" onClick={() => setPhoto({ remove: true })}>Remover foto</button>
              )}
              <span className="muted small">Foto de identificação no portal. Não é usada no reconhecimento facial.</span>
            </div>
            <div className="emp-main">
              <label>
                Nome completo
                <input value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={3} maxLength={150} />
              </label>
              <div className="grid-2">
                <label>
                  CPF
                  <input value={form.new ? form.cpf : formatCpf(form.cpf)} disabled={!form.new} inputMode="numeric"
                    onChange={(e) => set("cpf", e.target.value.replace(/\D/g, "").slice(0, 11))} required />
                  {cpfBad && <span className="hint neg">CPF inválido.</span>}
                  {!form.new && <span className="hint">O CPF identifica o funcionário no ponto e não pode ser alterado.</span>}
                </label>
                <label>
                  E-mail
                  <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                  <span className="hint">Usado no acesso ao portal.</span>
                </label>
              </div>
              <div className="grid-2">
                <label>
                  Data de nascimento
                  <input type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
                </label>
                <label>
                  Sexo
                  <select value={form.sex} onChange={(e) => set("sex", e.target.value as Form["sex"])}>
                    <option value="">Não informado</option>
                    <option value="F">Feminino</option>
                    <option value="M">Masculino</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <h3>Contrato</h3>
          <div className="grid-2">
            <label>
              Cargo
              <input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} maxLength={80} />
            </label>
            <label>
              Tipo de contrato
              <select value={form.contract_type} onChange={(e) => set("contract_type", e.target.value)}>
                <option value="">Não informado</option>
                {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="grid-3">
            <label>
              Admissão
              <input type="date" value={form.admitted_on} onChange={(e) => set("admitted_on", e.target.value)} />
            </label>
            <label>
              Desligamento
              <input type="date" value={form.dismissed_on} min={form.admitted_on || undefined}
                onChange={(e) => set("dismissed_on", e.target.value)} />
            </label>
            <label>
              Situação
              <select value={form.active ? "1" : "0"} onChange={(e) => set("active", e.target.value === "1")}>
                <option value="1">Ativo</option>
                <option value="0">Desligado</option>
              </select>
            </label>
          </div>
          <p className="muted small">
            Dias antes da admissão e depois do desligamento não contam no ponto. Desligado, o funcionário sai dos tablets
            e perde o acesso ao portal.
          </p>

          <h3>Obras</h3>
          {sites.length === 0 ? <p className="muted small">Nenhuma obra cadastrada.</p> : (
            <div className="site-picks">
              {sites.map((s) => (
                <label key={s.id} className="check">
                  <input type="checkbox" checked={form.sites.includes(s.id)} onChange={() => toggleSite(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          )}
          <p className="muted small">Sem obra marcada, o funcionário aparece em todos os tablets.</p>

          <h3>Perfis</h3>
          <div className="grid-2">
            <label>
              Acesso ao portal
              <select value={form.portal_role} disabled={!admin} onChange={(e) => set("portal_role", e.target.value as Form["portal_role"])}>
                <option value="">Sem acesso</option>
                <option value="rh">RH</option>
                <option value="admin">Administrador</option>
              </select>
              <span className="hint">
                {!admin ? "Só o administrador muda o perfil." : form.portal_role && !form.email
                  ? "Informe o e-mail para o primeiro acesso."
                  : form.portal_role ? "No primeiro acesso, ele confirma e-mail, CPF e senha de ponto." : ""}
              </span>
            </label>
            <label className="check perfil-check">
              <input type="checkbox" checked={form.tablet_responsible} onChange={(e) => set("tablet_responsible", e.target.checked)} />
              Responsável pelo tablet na obra
            </label>
          </div>
          {!form.new && (
            <>
              <h3>Documentos</h3>
              <EmployeeDocs cpf={form.cpf} />
            </>
          )}
        </div>

        {msg && <Banner tone="error">{msg}</Banner>}
        <div className="drawer-foot">
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy || me.cpf.length !== 11} type="submit">
            {busy ? "Salvando" : form.new ? "Cadastrar funcionário" : "Salvar alterações"}
          </button>
        </div>
        {me.cpf.length !== 11 && <p className="muted small pad">Para cadastrar é preciso o seu CPF (veja Meus dados).</p>}
      </form>
    </div>
  );
}
