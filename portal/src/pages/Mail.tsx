import { useEffect, useState } from "react";
import { errorText, mailStatus, mailTest, rpc, type MailSettings, type MailStatus } from "../api";
import { Badge, Banner, Loading, PageHead } from "../ui";

// Configuracao do envio de e-mail (SMTP). A senha vai para o Supabase Vault e nunca volta para a tela.

type Form = Omit<MailSettings, "password_set" | "password_set_at" | "updated_at" | "updated_by" | "saved">;

const DEFAULTS: Form = {
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  smtp_user: "no-reply@semax-sgi-ponto.eng.br",
  mail_from: "no-reply@semax-sgi-ponto.eng.br",
  from_name: "Ponto Totem",
};

export default function MailPage() {
  const [saved, setSaved] = useState<MailSettings | null>(null);
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [form, setForm] = useState<Form>(DEFAULTS);
  const [password, setPassword] = useState("");
  const [changePass, setChangePass] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    rpc<MailSettings>("portal_mail_get").then((m) => {
      setSaved(m);
      if (m.saved) setForm({ host: m.host, port: m.port, secure: m.secure, smtp_user: m.smtp_user, mail_from: m.mail_from, from_name: m.from_name });
    }).catch((e) => setError(errorText(e, "Não foi possível ler a configuração.")));
    mailStatus().then(setStatus).catch(() => setStatus(null));
  };
  useEffect(load, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setPort = (port: 465 | 587) => setForm((f) => ({ ...f, port, secure: port === 465 }));
  const needsPassword = !saved?.password_set || changePass;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    setMsg(null);
    try {
      const m = await rpc<MailSettings>("portal_mail_save", { p: { ...form, password: needsPassword ? password : "" } });
      setSaved(m);
      setPassword("");
      setChangePass(false);
      setMsg({ tone: "ok", text: "Configuração salva." });
      mailStatus().then(setStatus).catch(() => undefined);
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err, "Não foi possível salvar.") });
    }
    setBusy("");
  };

  const test = async () => {
    setBusy("test");
    setMsg(null);
    try {
      await mailTest(to.trim());
      setMsg({ tone: "ok", text: `E-mail de teste enviado para ${to.trim()}. Confira a caixa de entrada (e o spam).` });
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Falha no envio." });
    }
    setBusy("");
  };

  return (
    <>
      <PageHead title="E-mail (SMTP)" lead="Servidor usado pelo sistema para enviar e-mails. A senha fica guardada criptografada no cofre do servidor e não pode ser lida pelo portal." />
      {error && <Banner tone="error">{error}</Banner>}
      {status?.source === "env" && (
        <Banner tone="warn">
          O servidor está usando os secrets da função (SMTP_HOST e SMTP_PASSWORD), que têm prioridade sobre esta tela.
        </Banner>
      )}
      {!saved ? <Loading /> : (
        <>
          <form className="card" onSubmit={save}>
            <div className="toolbar">
              {status?.configured ? <Badge tone="ok">Pronto para enviar</Badge> : <Badge tone="warn">Incompleto</Badge>}
              {saved.updated_at && (
                <span className="muted small">
                  Alterado em {new Date(saved.updated_at).toLocaleString("pt-BR")} por {saved.updated_by}
                </span>
              )}
            </div>
            <div className="filters">
              <label className="wide">
                Servidor SMTP
                <input value={form.host} required onChange={(e) => set("host", e.target.value)} />
              </label>
              <label>
                Porta e segurança
                <select value={form.port} onChange={(e) => setPort(Number(e.target.value) as 465 | 587)}>
                  <option value={465}>465 · SSL/TLS</option>
                  <option value={587}>587 · STARTTLS</option>
                </select>
              </label>
              <label>
                Nome do remetente
                <input value={form.from_name} maxLength={80} required onChange={(e) => set("from_name", e.target.value)} />
              </label>
              <label className="wide">
                Usuário (login da caixa)
                <input type="email" value={form.smtp_user} required onChange={(e) => set("smtp_user", e.target.value)} />
              </label>
              <label className="wide">
                Remetente (From)
                <input type="email" value={form.mail_from} required onChange={(e) => set("mail_from", e.target.value)} />
              </label>
              <label className="wide">
                Senha da caixa
                {needsPassword ? (
                  <input type="password" autoComplete="new-password" value={password} maxLength={200}
                    required={!saved.password_set} placeholder={saved.password_set ? "Nova senha" : "Senha"}
                    onChange={(e) => setPassword(e.target.value)} />
                ) : (
                  <div className="toolbar" style={{ margin: 0 }}>
                    <Badge tone="ok">Cadastrada</Badge>
                    <span className="muted small">
                      {saved.password_set_at ? `em ${new Date(saved.password_set_at).toLocaleString("pt-BR")}` : ""}
                    </span>
                    <button type="button" className="ghost small" onClick={() => setChangePass(true)}>Trocar senha</button>
                  </div>
                )}
              </label>
            </div>
            <div className="toolbar">
              <button className="primary" disabled={!!busy}>{busy === "save" ? "Salvando" : "Salvar"}</button>
              {changePass && (
                <button type="button" className="ghost" onClick={() => { setChangePass(false); setPassword(""); }}>
                  Manter a senha atual
                </button>
              )}
            </div>
          </form>

          <section className="card">
            <h2>Teste de envio</h2>
            <div className="filters">
              <label className="wide">
                Enviar para
                <input type="email" value={to} placeholder="endereco@exemplo.com" onChange={(e) => setTo(e.target.value)} />
              </label>
              <div className="filter-actions">
                <button className="primary" disabled={!!busy || !status?.configured || !to.trim()} onClick={test}>
                  {busy === "test" ? "Enviando" : "Enviar e-mail de teste"}
                </button>
              </div>
            </div>
            <p className="muted small">Salve a configuração antes de testar. No máximo 5 testes por hora; cada um fica na auditoria.</p>
          </section>
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        </>
      )}
    </>
  );
}
