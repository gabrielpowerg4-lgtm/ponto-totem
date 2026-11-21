import { useEffect, useState } from "react";
import {
  br, createPortalUser, errorText, formatCpf, formatDateTime, formatEmployerId, rpc, supabase, todayIso, WEEKDAY_FULL,
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

export function RulesPage({ me }: { me: Me }) {
  const { data, error, setData } = useLoad(() => rpc<Company>("portal_company_get"));
  return (
    <>
      <PageHead title="Regras de apuração" lead="Período de fechamento, banco de horas e tolerâncias usados no cálculo do ponto." />
      {error && <Banner tone="error">{error}</Banner>}
      {!data ? <Loading /> : <Rules company={data} admin={me.role === "admin"} onSaved={setData} />}
    </>
  );
}

function Rules({ company, admin, onSaved }: { company: Company; admin: boolean; onSaved: (c: Company) => void }) {
  const [form, setForm] = useState({
    closing_day: company.closing_day, hour_bank: company.hour_bank, tol_mark: company.tol_mark, tol_day: company.tol_day,
    clt_from: company.clt_from ?? "", tol_sgi: company.tol_sgi, bonus_every: company.bonus_every,
    bonus_minutes: company.bonus_minutes, pct_weekday: company.pct_weekday, pct_holiday: company.pct_holiday,
    comp_holiday_minutes: company.comp_holiday_minutes, bank_expiry_months: company.bank_expiry_months,
    bank_alert_days: company.bank_alert_days,
  });
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const clt = form.clt_from !== "";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.clt_from !== (company.clt_from ?? "")) {
      const text = form.clt_from
        ? `Os dias a partir de ${br(form.clt_from)} passam a ser calculados pelas regras da CLT (hora noturna reduzida e tolerância por marcação). Confirmar?`
        : "Voltar a calcular pelas regras do SGI? Só é possível se nenhum período com as regras da CLT foi fechado.";
      if (!window.confirm(text)) return;
    }
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

  const num = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Number(e.target.value) });
  const cut = form.closing_day;
  return (
    <form className="card form" onSubmit={save}>
      <h2>Período e banco</h2>
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
          Vencimento do banco (meses)
          <input disabled={!admin} type="number" min={1} max={60} value={form.bank_expiry_months} onChange={num("bank_expiry_months")} />
          <span className="hint">Cada lote vence na sua data mais este prazo. Acima de 6 meses exige acordo ou convenção coletiva (CLT art. 59).</span>
        </label>
        <label>
          Alerta antes do vencimento (dias)
          <input disabled={!admin} type="number" min={0} max={180} value={form.bank_alert_days} onChange={num("bank_alert_days")} />
        </label>
      </div>

      <h2>Regras de cálculo</h2>
      <label className="check">
        <input disabled={!admin} type="checkbox" checked={clt}
          onChange={(e) => setForm({ ...form, clt_from: e.target.checked ? (company.clt_from ?? todayIso()) : "" })} />
        Adotar as regras previstas na CLT
      </label>
      {clt ? (
        <div className="grid-2">
          <label>
            A partir de
            <input disabled={!admin} type="date" value={form.clt_from} onChange={(e) => setForm({ ...form, clt_from: e.target.value })} required />
            <span className="hint">Os dias antes desta data continuam pela regra do SGI. Não pode cair num período já fechado.</span>
          </label>
          <p className="muted small">
            CLT: hora noturna reduzida das 22h às 5h (art. 73) e tolerância por marcação, sem contar variações até o limite
            por marcação e por dia (art. 58, § 1º).
          </p>
        </div>
      ) : (
        <p className="muted small">
          Regra do SGI: sem hora noturna reduzida; o saldo do dia entre −{form.tol_sgi} e +{form.tol_sgi} min vira zero,
          exceto com abono de horas ou compensação não aplicável.
        </p>
      )}
      <div className="grid-3">
        <label>
          Tolerância do dia, regra SGI (min)
          <input disabled={!admin} type="number" min={0} max={30} value={form.tol_sgi} onChange={num("tol_sgi")} />
        </label>
        <label>
          Por marcação, regra CLT (min)
          <input disabled={!admin} type="number" min={0} max={5} value={form.tol_mark} onChange={num("tol_mark")} />
        </label>
        <label>
          Por dia, regra CLT (min)
          <input disabled={!admin} type="number" min={0} max={10} value={form.tol_day} onChange={num("tol_day")} />
        </label>
      </div>

      <h2>Bônus e compensação</h2>
      <div className="grid-3">
        <label>
          Bônus de (min)
          <input disabled={!admin} type="number" min={0} max={600} value={form.bonus_minutes} onChange={num("bonus_minutes")} />
        </label>
        <label>
          A cada (min de extra no dia)
          <input disabled={!admin} type="number" min={1} max={600} value={form.bonus_every} onChange={num("bonus_every")} />
          <span className="hint">Fração descartada; sem bônus em sábado, domingo e feriado.</span>
        </label>
        <label>
          Compensação não aplicável (min)
          <input disabled={!admin} type="number" min={0} max={600} value={form.comp_holiday_minutes} onChange={num("comp_holiday_minutes")} />
          <span className="hint">Somados ao dia com essa justificativa.</span>
        </label>
      </div>

      <h2>Percentual de pagamento</h2>
      <p className="muted small">Indica quanto se paga pela hora se ela vencer ou for quitada. Não muda o saldo do banco.</p>
      <div className="grid-pct">
        {WEEKDAY_FULL.map((d, i) => (
          <label key={d}>
            {d}
            <input disabled={!admin} type="number" min={0} max={300} value={form.pct_weekday[i]}
              onChange={(e) => {
                const next = [...form.pct_weekday];
                next[i] = Number(e.target.value);
                setForm({ ...form, pct_weekday: next });
              }} />
          </label>
        ))}
        <label>
          Feriado
          <input disabled={!admin} type="number" min={0} max={300} value={form.pct_holiday} onChange={num("pct_holiday")} />
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

  const { data: pending } = useLoad(() =>
    rpc<{ cpf: string; name: string; email: string; role: Role }[]>("portal_access_pending").catch(() => []));

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
        lead="Quem acessa o portal. O perfil pode vir do Bubble (campo perfil_portal) ou ser criado aqui. O RH trata e fecha o ponto; o administrador também configura o sistema."
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

      {pending && pending.length > 0 && (
        <section className="card soft">
          <h2>Liberados pelo Bubble, aguardando o primeiro acesso</h2>
          <p className="muted small">
            Cada um entra no portal em "Primeiro acesso de funcionário" com o e-mail, o CPF e a senha de ponto. Quem
            ainda não tem senha de ponto precisa criá-la antes no tablet.
          </p>
          <table>
            <tbody>
              {pending.map((p) => (
                <tr key={p.cpf}>
                  <td className="strong">{p.name}</td>
                  <td>{p.email || <span className="muted">Sem e-mail no cadastro</span>}</td>
                  <td><Badge tone={p.role === "admin" ? "ok" : "neutral"}>{ROLE_LABEL[p.role]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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
