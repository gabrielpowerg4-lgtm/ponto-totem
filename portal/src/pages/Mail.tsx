import { useState } from "react";
import { mailStatus, mailTest } from "../api";
import { Badge, Banner, Loading, PageHead, useLoad } from "../ui";

// Configuracao do envio de e-mail (SMTP). A senha fica so no servidor, como secret da Edge Function.

const VARS: [string, string][] = [
  ["SMTP_HOST", "smtp.hostinger.com"],
  ["SMTP_PORT", "465 (ou 587)"],
  ["SMTP_SECURE", "true para 465, false para 587"],
  ["SMTP_USER", "no-reply@semax-sgi-ponto.eng.br"],
  ["SMTP_PASSWORD", "senha da caixa (secret, nunca no código)"],
  ["MAIL_FROM", "no-reply@semax-sgi-ponto.eng.br"],
];

export default function MailPage() {
  const { data, error, reload } = useLoad(mailStatus);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await mailTest(to.trim());
      setMsg({ tone: "ok", text: `E-mail de teste enviado para ${to.trim()}. Confira a caixa de entrada (e o spam).` });
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Falha no envio." });
    }
    setBusy(false);
  };

  return (
    <>
      <PageHead title="E-mail (SMTP)" lead="Envio de e-mails do sistema pela caixa no-reply da Hostinger. A senha fica guardada só no servidor." />
      {error && <Banner tone="error">{error}</Banner>}
      {!data ? <Loading /> : (
        <section className="card">
          <div className="toolbar">
            {data.configured ? <Badge tone="ok">Configurado</Badge> : <Badge tone="warn">Incompleto</Badge>}
            <span className="muted small">
              {data.host || "sem host"} · porta {data.port} · {data.secure ? "SSL/TLS" : "STARTTLS"} · remetente {data.from || "não definido"}
            </span>
            <button className="ghost small" onClick={reload}>Atualizar</button>
          </div>
          <table>
            <tbody>
              {VARS.map(([k, hint]) => {
                const set = k === "SMTP_PASSWORD" ? data.password_set
                  : k === "SMTP_HOST" ? !!data.host : k === "SMTP_USER" ? !!data.user : k === "MAIL_FROM" ? !!data.from : true;
                return (
                  <tr key={k}>
                    <td className="strong nowrap">{k}</td>
                    <td className="muted small">{hint}</td>
                    <td>{set ? <Badge tone="ok">definida</Badge> : <Badge tone="warn">faltando</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <form onSubmit={send} className="filters" style={{ marginTop: 14 }}>
            <label className="wide">
              Enviar teste para
              <input type="email" required value={to} placeholder="endereco@exemplo.com" onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="filter-actions">
              <button className="primary" disabled={busy || !data.configured || !to.trim()}>
                {busy ? "Enviando" : "Enviar e-mail de teste"}
              </button>
            </div>
          </form>
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
          <p className="muted small">No máximo 5 testes por hora. Cada teste fica na auditoria, com o destinatário mascarado.</p>
        </section>
      )}
    </>
  );
}
