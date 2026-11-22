// Comprovante de Registro de Ponto do Trabalhador enviado por e-mail (REP-P, Portaria 671).

export type ReceiptData = {
  punch_id: string;
  company_id: string;
  nsr: number;
  hash: string;
  online: boolean;
  marked_at: string;
  timezone: string;
  marked_local: string;
  legal_name: string;
  employer_id: string;
  id_type: number;
  site: string;
  site_address: string;
  terminal: string;
  name: string;
  cpf: string;
  email: string;
  inpi: string | null;
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function doc(id: string) {
  const d = id.replace(/\D/g, "");
  if (d.length === 14) return "CNPJ " + d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return "CPF " + d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
}

const cpf = (v: string) => v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export function buildReceipt(r: ReceiptData, offset: string) {
  const nsr = String(r.nsr).padStart(9, "0");
  const when = `${r.marked_local} (UTC${offset.slice(0, 3)}:${offset.slice(3)})`;
  const local = [r.site, r.site_address].filter(Boolean).join(" · ") || "Não informado";
  const inpi = (r.inpi ?? "").replace(/\D/g, "") || "pendente de registro";
  const rows: [string, string][] = [
    ["Empregador", `${r.legal_name} · ${doc(r.employer_id)}`],
    ["Local da prestação do serviço", local],
    ["Trabalhador", `${r.name} · CPF ${cpf(r.cpf)}`],
    ["Data e hora da marcação", when],
    ["NSR", nsr],
    ["Origem", `${r.online ? "on-line" : "off-line"}${r.terminal ? ` · terminal ${r.terminal}` : ""}`],
    ["REP-P (registro INPI)", inpi],
    ["Código hash (SHA-256)", r.hash],
  ];
  const subject = `Comprovante de ponto · ${r.marked_local} · NSR ${nsr}`;
  const text = [
    "COMPROVANTE DE REGISTRO DE PONTO DO TRABALHADOR", "",
    ...rows.map(([k, v]) => `${k}: ${v}`), "",
    "Guarde este e-mail: ele é o seu comprovante da marcação.",
    "Assinatura digital do comprovante: pendente do certificado ICP-Brasil da empresa.", "",
    "Mensagem automática do Ponto Totem, não responda.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e3e6ea">
      <h2 style="margin:0 0 16px;color:#002d62;font-size:18px">Comprovante de Registro de Ponto do Trabalhador</h2>
      <table cellspacing="0" cellpadding="0" style="width:100%;font-size:14px;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr><td style="padding:7px 8px 7px 0;color:#667;vertical-align:top;white-space:nowrap;border-bottom:1px solid #eef0f3">${esc(k)}</td>
        <td style="padding:7px 0;border-bottom:1px solid #eef0f3;${k.startsWith("Código") ? "font-family:monospace;font-size:12px;word-break:break-all" : ""}"><b>${esc(v)}</b></td></tr>`).join("")}
      </table>
      <p style="margin:16px 0 0;font-size:13px">Guarde este e-mail: ele é o seu comprovante da marcação.</p>
      <p style="margin:8px 0 0;color:#667;font-size:12px">Assinatura digital do comprovante: pendente do certificado ICP-Brasil da empresa.
      Mensagem automática do Ponto Totem, não responda.</p>
    </div>
  </div></body></html>`;
  return { subject, text, html };
}
