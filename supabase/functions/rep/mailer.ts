// Envio de e-mail por SMTP (Hostinger). Configuracao so por variaveis de ambiente (secrets da
// Edge Function no Supabase); a senha nunca aparece no codigo, nas respostas nem nos logs.
//
// Variaveis:
//   SMTP_HOST      smtp.hostinger.com
//   SMTP_PORT      465 (SSL/TLS implicito) ou 587 (STARTTLS)
//   SMTP_SECURE    true para 465, false para 587
//   SMTP_USER      no-reply@semax-sgi-ponto.eng.br
//   SMTP_PASSWORD  senha da caixa (secret)
//   MAIL_FROM      no-reply@semax-sgi-ponto.eng.br
//   MAIL_FROM_NAME nome exibido (opcional, padrao "Ponto Totem")
import nodemailer from "npm:nodemailer@6.9.16";

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  fromName: string;
  hasPassword: boolean;
};

export type MailMessage = { to: string; subject: string; text: string; html?: string };

export class MailError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const env = (k: string) => (Deno.env.get(k) ?? "").trim();

/** Configuracao sem a senha (pode ser mostrada no portal). */
export function mailConfig(): MailConfig {
  const port = Number(env("SMTP_PORT") || "465");
  const secureRaw = env("SMTP_SECURE").toLowerCase();
  return {
    host: env("SMTP_HOST"),
    port,
    secure: secureRaw === "" ? port === 465 : secureRaw === "true",
    user: env("SMTP_USER"),
    from: env("MAIL_FROM"),
    fromName: env("MAIL_FROM_NAME") || "Ponto Totem",
    hasPassword: env("SMTP_PASSWORD") !== "",
  };
}

export function mailReady(c = mailConfig()): boolean {
  return !!c.host && !!c.port && !!c.user && !!c.from && c.hasPassword;
}

export const isEmail = (v: string) => /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(v) && v.length <= 254;

/** a***@dominio: endereco para log sem expor o destinatario inteiro. */
export function maskEmail(v: string): string {
  const [user, domain] = v.split("@");
  return `${(user ?? "").slice(0, 1)}***@${domain ?? ""}`;
}

/** Traduz o erro da biblioteca num codigo curto, sem repassar mensagens que possam conter dados. */
function codeOf(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; command?: string };
  if (err?.code === "EAUTH" || err?.responseCode === 535) return "smtp_auth";
  const timeout = /timeout/i.test(String((e as Error)?.message ?? ""));
  if (err?.code === "ETIMEDOUT" || (err?.code === "ESOCKET" && timeout)) return "smtp_timeout";
  if (err?.code === "ECONNECTION" || err?.code === "ECONNREFUSED" || err?.code === "ESOCKET" || err?.code === "EDNS") {
    return "smtp_connect";
  }
  if (err?.code === "EENVELOPE" || (err?.responseCode ?? 0) >= 550) return "smtp_rejected";
  if (err?.code === "ETLS") return "smtp_tls";
  return "smtp_failed";
}

/** Envia uma mensagem. Retorna o id da mensagem no servidor SMTP. */
export async function sendMail(msg: MailMessage): Promise<{ messageId: string }> {
  const c = mailConfig();
  if (!mailReady(c)) throw new MailError("smtp_not_configured");
  if (!isEmail(msg.to)) throw new MailError("invalid_email");

  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure, // 465: TLS desde o inicio; 587: STARTTLS obrigatorio (requireTLS)
    requireTLS: !c.secure,
    auth: { user: c.user, pass: env("SMTP_PASSWORD") },
    tls: { minVersion: "TLSv1.2", servername: c.host, rejectUnauthorized: true },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
  });

  const started = Date.now();
  try {
    const info = await transport.sendMail({
      from: { name: c.fromName, address: c.from },
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    console.log(JSON.stringify({
      event: "mail_sent", to: maskEmail(msg.to), port: c.port, ms: Date.now() - started,
    }));
    return { messageId: String(info.messageId ?? "") };
  } catch (e) {
    const code = codeOf(e);
    console.error(JSON.stringify({
      event: "mail_failed", code, to: maskEmail(msg.to), port: c.port, ms: Date.now() - started,
      smtp_code: (e as { responseCode?: number })?.responseCode ?? null,
    }));
    throw new MailError(code);
  } finally {
    transport.close();
  }
}
