import { useEffect, useState } from "react";
import {
  createPortalUser, errorText, formatCpf, formatDateTime, formatEmployerId, rpc, supabase,
  type Company, type Employee, type Me, type PortalUser, type Role,
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
          Para alterar estes dados é preciso o seu CPF (a Portaria 671 exige o CPF de quem altera a identificação
          do empregador) e não achamos um funcionário com o seu e-mail de acesso.{" "}
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

      <Rules company={data} admin={admin} onSaved={setData} />

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

function Rules({ company, admin, onSaved }: { company: Company; admin: boolean; onSaved: (c: Company) => void }) {
  const [form, setForm] = useState({
    closing_day: company.closing_day, hour_bank: company.hour_bank, tol_mark: company.tol_mark, tol_day: company.tol_day,
  });
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onSaved(await rpc<Company>("portal_rules_set", { p: form }));
      setMsg({ tone: "ok", text: "Regras salvas." });
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
    setBusy(false);
  };

  const cut = form.closing_day;
  return (
    <form className="card form" onSubmit={save}>
      <h2>Regras de apuração</h2>
      <div className="grid-2">
        <label>
          Período de apuração
          <select disabled={!admin} value={cut} onChange={(e) => setForm({ ...form, closing_day: Number(e.target.value) })}>
            <option value={0}>Mês calendário (dia 1 ao último dia)</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>Dia {d + 1} a dia {d} do mês seguinte</option>
            ))}
          </select>
          <span className="hint">Mude antes de fechar o primeiro período.</span>
        </label>
        <label>
          Banco de horas
          <select disabled={!admin} value={form.hour_bank ? "1" : "0"} onChange={(e) => setForm({ ...form, hour_bank: e.target.value === "1" })}>
            <option value="1">Sim: saldo do dia vai para o banco</option>
            <option value="0">Não: extras e faltas apurados no período</option>
          </select>
        </label>
      </div>
      <div className="grid-2">
        <label>
          Tolerância por marcação (minutos)
          <input disabled={!admin} type="number" min={0} max={5} value={form.tol_mark}
            onChange={(e) => setForm({ ...form, tol_mark: Number(e.target.value) })} />
        </label>
        <label>
          Tolerância por dia (minutos)
          <input disabled={!admin} type="number" min={0} max={10} value={form.tol_day}
            onChange={(e) => setForm({ ...form, tol_day: Number(e.target.value) })} />
          <span className="hint">CLT art. 58: até 5 por marcação e 10 por dia.</span>
        </label>
      </div>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {admin && <button className="primary" disabled={busy} type="submit">{busy ? "Salvando" : "Salvar regras"}</button>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Usuarios do portal
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", rh: "RH" };

export function Users() {
  const { data, error, reload, setData } = useLoad(() => rpc<PortalUser[]>("portal_users_list"));
  const { data: employees } = useLoad(() => rpc<Employee[]>("portal_employees"));
  const withEmail = (employees ?? []).filter((e) => e.active && e.email);
  const matched = (email: string) => withEmail.find((e) => e.email.toLowerCase() === email.trim().toLowerCase());
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
              Funcionário ou e-mail
              <input
                type="text"
                list="user-employees"
                value={form.email}
                placeholder="Busque pelo nome ou digite o e-mail"
                onChange={(e) => {
                  const v = e.target.value;
                  const pick = withEmail.find((x) => `${x.name} · ${x.email}` === v);
                  setForm({ ...form, email: pick ? pick.email : v });
                }}
                required
              />
              <datalist id="user-employees">
                {withEmail.map((x) => <option key={x.cpf} value={`${x.name} · ${x.email}`} />)}
              </datalist>
              <span className="hint">
                {matched(form.email)
                  ? `${matched(form.email)!.name} · CPF ${formatCpf(matched(form.email)!.cpf)} (vem do cadastro)`
                  : "Use o e-mail do cadastro do funcionário para o CPF vir automaticamente."}
              </span>
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
            {!matched(form.email) && (
              <label>
                CPF (se não for funcionário)
                <input
                  inputMode="numeric"
                  value={form.cpf}
                  placeholder="11 números"
                  onChange={(e) => setForm({ ...form, cpf: onlyDigits(e.target.value, 11) })}
                />
              </label>
            )}
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
                    <td>
                      {u.cpf ? formatCpf(u.cpf) : <span className="muted">Não informado</span>}
                      {u.employee_name && <div className="muted small">{u.employee_name}</div>}
                    </td>
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
      {me.cpf_source === "funcionario" ? (
        <section className="card form narrow">
          <h2>CPF</h2>
          <p className="strong">{formatCpf(me.cpf)}</p>
          <p className="muted small">
            Vem do seu cadastro de funcionário ({me.employee_name}), ligado pelo e-mail de acesso. Fica registrado
            nos tratamentos, no fechamento e nas alterações da empresa.
          </p>
        </section>
      ) : (
        <form className="card form narrow" onSubmit={saveCpf}>
          <h2>CPF</h2>
          <p className="muted small">
            Não achamos um funcionário ativo com o e-mail {me.email}. Se você é funcionário, cadastre este e-mail
            no Bubble e o CPF passa a vir de lá. Se não é, informe o CPF aqui.
          </p>
          <label>
            CPF
            <input inputMode="numeric" value={cpf} placeholder="11 números" onChange={(e) => setCpf(onlyDigits(e.target.value, 11))} required />
          </label>
          {cpfMsg && <Banner tone={cpfMsg.tone}>{cpfMsg.text}</Banner>}
          <button className="primary" disabled={busy === "cpf"} type="submit">Salvar CPF</button>
        </form>
      )}

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
