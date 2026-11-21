import { useEffect, useState } from "react";
import {
  createPortalUser, errorText, formatCpf, formatDateTime, formatEmployerId, rpc, supabase,
  type Company, type Me, type PortalUser, type Role,
} from "../api";
import { Badge, Banner, Empty, Loading, PageHead, useLoad } from "../ui";

const onlyDigits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

// ---------------------------------------------------------------------------
// Empresa
// ---------------------------------------------------------------------------

export function CompanyPage({ me, goAccount }: { me: Me; goAccount: () => void }) {
  const { data, error, setData } = useLoad(() => rpc<Company>("portal_company_get"));
  const [form, setForm] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const admin = me.role === "admin";

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (error) return <Banner tone="error">{error}</Banner>;
  if (!form || !data) return <Loading />;

  const changedIdentity = form.id_type !== data.id_type || form.employer_id !== data.employer_id ||
    form.legal_name !== data.legal_name || form.caepf !== data.caepf;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changedIdentity && data.employer_id &&
        !window.confirm("A alteração dos dados do empregador fica registrada no AFD. Confirmar?")) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      setData(await rpc<Company>("portal_company_set", { p_data: form }));
      setMsg({ tone: "ok", text: "Dados salvos." });
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
    setBusy(false);
  };

  const needsCpf = admin && me.cpf.length !== 11;
  const disabled = !admin || needsCpf;

  return (
    <>
      <PageHead
        title="Empresa"
        lead="Identificação do empregador usada no AFD, no AEJ e no Espelho de Ponto."
      />
      {needsCpf && (
        <Banner tone="warn">
          Para alterar estes dados, informe antes o seu CPF: a Portaria 671 exige o CPF de quem altera a
          identificação do empregador.{" "}
          <button className="link inline" onClick={goAccount}>Ir para Minha conta</button>
        </Banner>
      )}
      {!admin && <Banner tone="warn">Somente o administrador pode alterar estes dados.</Banner>}

      <form className="card form" onSubmit={save}>
        <h2>Empregador</h2>
        <div className="grid-2">
          <label>
            Tipo de identificação
            <select
              value={form.id_type}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, id_type: Number(e.target.value) as 1 | 2, employer_id: "" })}
            >
              <option value={1}>CNPJ</option>
              <option value={2}>CPF</option>
            </select>
          </label>
          <label>
            {form.id_type === 1 ? "CNPJ" : "CPF"}
            <input
              inputMode="numeric"
              disabled={disabled}
              value={disabled ? formatEmployerId(form.employer_id) : form.employer_id}
              placeholder={form.id_type === 1 ? "14 números" : "11 números"}
              onChange={(e) => setForm({ ...form, employer_id: onlyDigits(e.target.value, form.id_type === 1 ? 14 : 11) })}
              required
            />
          </label>
        </div>
        <label>
          Razão social ou nome
          <input
            disabled={disabled}
            value={form.legal_name}
            maxLength={150}
            onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
            required
          />
        </label>
        <div className="grid-2">
          <label>
            CAEPF (opcional)
            <input
              inputMode="numeric"
              disabled={disabled}
              value={form.caepf}
              placeholder="14 números"
              onChange={(e) => setForm({ ...form, caepf: onlyDigits(e.target.value, 14) })}
            />
          </label>
          <label>
            CPF do responsável padrão pelos cadastros
            <input
              inputMode="numeric"
              disabled={disabled}
              value={disabled ? formatCpf(form.default_responsible_cpf) : form.default_responsible_cpf}
              placeholder="11 números"
              onChange={(e) => setForm({ ...form, default_responsible_cpf: onlyDigits(e.target.value, 11) })}
            />
            <span className="hint">
              Vai no AFD quando o Bubble envia um funcionário sem o campo responsavel_cpf.
            </span>
          </label>
        </div>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        {!disabled && (
          <button className="primary" disabled={busy} type="submit">{busy ? "Salvando" : "Salvar"}</button>
        )}
      </form>

      <section className="card soft">
        <h2>Dados do REP-P</h2>
        <dl className="facts">
          <dt>Último NSR</dt>
          <dd>{data.last_nsr}</dd>
          <dt>Fuso horário</dt>
          <dd>{data.timezone}</dd>
          <dt>Registro no INPI</dt>
          <dd>{data.inpi_number || <span className="muted">Ainda não informado</span>}</dd>
          <dt>Desenvolvedor</dt>
          <dd>{data.dev_name || <span className="muted">Ainda não informado</span>}</dd>
        </dl>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Usuarios do portal
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", rh: "RH" };

export function Users() {
  const { data, error, reload, setData } = useLoad(() => rpc<PortalUser[]>("portal_users_list"));
  const [form, setForm] = useState<{ email: string; password: string; role: Role; cpf: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setMsg(null);
    try {
      await createPortalUser(form);
      setMsg({ tone: "ok", text: `Usuário ${form.email} criado. Passe a senha temporária a ele por um canal seguro.` });
      setForm(null);
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Não foi possível criar o usuário." });
    }
    setBusy(false);
  };

  const remove = async (u: PortalUser) => {
    if (!window.confirm(`Remover o acesso de ${u.email} ao portal?`)) return;
    setMsg(null);
    try {
      setData(await rpc<PortalUser[]>("portal_user_remove", { p_user: u.user_id }));
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
  };

  return (
    <>
      <PageHead
        title="Usuários"
        lead="Quem acessa o portal. O RH consulta e trata as marcações; o administrador também altera cadastros, tablets e usuários."
        actions={!form && (
          <button className="primary" onClick={() => setForm({ email: "", password: "", role: "rh", cpf: "" })}>
            Novo usuário
          </button>
        )}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      {form && (
        <form className="card form" onSubmit={create}>
          <h2>Novo usuário</h2>
          <div className="grid-2">
            <label>
              E-mail
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </label>
            <label>
              Senha temporária
              <input
                type="text"
                autoComplete="off"
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
              <span className="hint">Pelo menos 8 caracteres. A pessoa pode trocar em Minha conta.</span>
            </label>
          </div>
          <div className="grid-2">
            <label>
              Perfil
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="rh">RH</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <label>
              CPF (opcional)
              <input
                inputMode="numeric"
                value={form.cpf}
                placeholder="11 números"
                onChange={(e) => setForm({ ...form, cpf: onlyDigits(e.target.value, 11) })}
              />
            </label>
          </div>
          <div className="row">
            <button className="primary" disabled={busy} type="submit">{busy ? "Criando" : "Criar usuário"}</button>
            <button className="ghost" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="card flush">
        {!data ? <Loading /> : data.length === 0 ? <Empty>Nenhum usuário.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>CPF</th>
                  <th>Último acesso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.user_id}>
                    <td className="strong">{u.email}{u.is_me && <span className="muted"> (você)</span>}</td>
                    <td><Badge tone={u.role === "admin" ? "ok" : "neutral"}>{ROLE_LABEL[u.role]}</Badge></td>
                    <td>{u.cpf ? formatCpf(u.cpf) : <span className="muted">Não informado</span>}</td>
                    <td>{formatDateTime(u.last_sign_in_at)}</td>
                    <td className="right">
                      {!u.is_me && <button className="ghost small danger" onClick={() => remove(u)}>Remover</button>}
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
// Minha conta
// ---------------------------------------------------------------------------

export function Account({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [cpf, setCpf] = useState(me.cpf);
  const [cpfMsg, setCpfMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState("");

  const saveCpf = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("cpf");
    setCpfMsg(null);
    try {
      await rpc("portal_set_my_cpf", { p_cpf: cpf });
      setCpfMsg({ tone: "ok", text: "CPF salvo." });
      onChanged();
    } catch (err) {
      setCpfMsg({ tone: "error", text: errorText(err) });
    }
    setBusy("");
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 8) return setPwMsg({ tone: "error", text: "A senha precisa ter pelo menos 8 caracteres." });
    if (pw.next !== pw.confirm) return setPwMsg({ tone: "error", text: "As senhas não conferem." });
    setBusy("pw");
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setPwMsg(error ? { tone: "error", text: "Não foi possível trocar a senha." } : { tone: "ok", text: "Senha alterada." });
    if (!error) setPw({ next: "", confirm: "" });
    setBusy("");
  };

  return (
    <>
      <PageHead title="Minha conta" lead={`${me.email} · ${ROLE_LABEL[me.role]}`} />
      <form className="card form narrow" onSubmit={saveCpf}>
        <h2>CPF</h2>
        <p className="muted small">Fica registrado quando você altera os dados do empregador e, nas próximas etapas, nos tratamentos.</p>
        <label>
          CPF
          <input inputMode="numeric" value={cpf} placeholder="11 números" onChange={(e) => setCpf(onlyDigits(e.target.value, 11))} required />
        </label>
        {cpfMsg && <Banner tone={cpfMsg.tone}>{cpfMsg.text}</Banner>}
        <button className="primary" disabled={busy === "cpf"} type="submit">Salvar CPF</button>
      </form>

      <form className="card form narrow" onSubmit={savePassword}>
        <h2>Trocar senha</h2>
        <label>
          Nova senha
          <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        </label>
        <label>
          Confirme a nova senha
          <input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
        </label>
        {pwMsg && <Banner tone={pwMsg.tone}>{pwMsg.text}</Banner>}
        <button className="primary" disabled={busy === "pw"} type="submit">Trocar senha</button>
      </form>
    </>
  );
}
