// Avisos de vencimento de documentos: monta um e-mail por destinatario (RH ou funcionario).

export type AlertItem = {
  id: string;
  type_id: string;
  type_code: string;
  type_name: string;
  frequency: "diario" | "semanal";
  emails: string[];
  notify_employee: boolean;
  cpf: string;
  name: string;
  job_title: string;
  employee_email: string | null;
  site_name: string | null;
  issued_on: string;
  expires_on: string;
  days_left: number;
  status: "alerta" | "vencido";
  event: "alerta" | "vencido";
};

export type AlertMessage = {
  kind: "rh" | "funcionario";
  to: string;
  subject: string;
  text: string;
  html: string;
  items: AlertItem[];
};

const okEmail = (v: string | null | undefined) =>
  !!v && /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(v) && v.length <= 254;

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function when(i: AlertItem) {
  if (i.days_left < 0) return `venceu há ${-i.days_left} dia(s)`;
  if (i.days_left === 0) return "vence hoje";
  return `vence em ${i.days_left} dia(s)`;
}

function counts(items: AlertItem[]) {
  const v = items.filter((i) => i.status === "vencido").length;
  const a = items.length - v;
  return { v, a };
}

function table(items: AlertItem[], withName: boolean) {
  const rows = items.map((i) => {
    const color = i.status === "vencido" ? "#c62828" : "#b26a00";
    return `<tr>
      ${withName ? `<td style="padding:6px 8px;border-bottom:1px solid #e3e6ea">${esc(i.name)}<br><span style="color:#667;font-size:12px">${esc(i.job_title || "")}${i.site_name ? " · " + esc(i.site_name) : ""}</span></td>` : ""}
      <td style="padding:6px 8px;border-bottom:1px solid #e3e6ea"><b>${esc(i.type_code)}</b><br><span style="color:#667;font-size:12px">${esc(i.type_name)}</span></td>
      <td style="padding:6px 8px;border-bottom:1px solid #e3e6ea;white-space:nowrap">${br(i.expires_on)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e3e6ea;color:${color};white-space:nowrap">${i.status === "vencido" ? "Vencido" : "Alerta"} · ${esc(when(i))}</td>
    </tr>`;
  }).join("");
  return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;font-size:14px">
    <thead><tr style="background:#002d62;color:#fff;text-align:left">
      ${withName ? '<th style="padding:8px">Funcionário</th>' : ""}
      <th style="padding:8px">Documento</th><th style="padding:8px">Vencimento</th><th style="padding:8px">Situação</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function wrap(title: string, intro: string, body: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
  <div style="max-width:680px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e3e6ea">
      <h2 style="margin:0 0 8px;color:#002d62;font-size:20px">${esc(title)}</h2>
      <p style="margin:0 0 16px">${intro}</p>
      ${body}
      <p style="margin:16px 0 0;color:#667;font-size:12px">${footer}</p>
    </div>
  </div></body></html>`;
}

function sortItems(items: AlertItem[]) {
  return [...items].sort((a, b) => a.days_left - b.days_left || a.name.localeCompare(b.name));
}

/** Mensagens do RH (por destinatario configurado nos tipos) e dos funcionarios (se o tipo permitir). */
export function buildAlertMessages(items: AlertItem[], portalUrl: string, onlyRh = false): AlertMessage[] {
  const rh = new Map<string, AlertItem[]>();
  const emp = new Map<string, AlertItem[]>();
  for (const i of items) {
    for (const e of i.emails ?? []) {
      const to = e.toLowerCase();
      if (!okEmail(to)) continue;
      rh.set(to, [...(rh.get(to) ?? []), i]);
    }
    const ee = (i.employee_email ?? "").trim().toLowerCase();
    if (!onlyRh && i.notify_employee && okEmail(ee)) emp.set(ee, [...(emp.get(ee) ?? []), i]);
  }

  const out: AlertMessage[] = [];
  const link = `${portalUrl.replace(/\/+$/, "")}/#documents`;
  for (const [to, list0] of rh) {
    const list = sortItems(list0);
    const { v, a } = counts(list);
    const parts = [v ? `${v} vencido(s)` : "", a ? `${a} em alerta` : ""].filter(Boolean).join(", ");
    const subject = `Documentos: ${parts}`;
    const text = [
      `Documentos de funcionários que precisam de atenção (${parts}):`, "",
      ...list.map((i) => `- ${i.name}: ${i.type_code} vence ${br(i.expires_on)} (${i.status === "vencido" ? "vencido" : "alerta"}, ${when(i)})`),
      "", `Ver no portal: ${link}`, "", "Mensagem automática do Ponto Totem, não responda.",
    ].join("\n");
    const html = wrap("Vencimento de documentos",
      `Documentos de funcionários que precisam de atenção: <b>${esc(parts)}</b>.`,
      table(list, true) +
        `<p style="margin:16px 0 0"><a href="${esc(link)}" style="background:#002d62;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none">Abrir Vencimentos no portal</a></p>`,
      "Mensagem automática do Ponto Totem, não responda. Você recebe este aviso porque está cadastrado nos tipos de documento.");
    out.push({ kind: "rh", to, subject, text, html, items: list });
  }
  for (const [to, list0] of emp) {
    const list = sortItems(list0);
    const first = list[0];
    const subject = list.length === 1
      ? `Seu documento ${first.type_code} ${first.status === "vencido" ? "está vencido" : when(first)}`
      : `Seus documentos: ${list.length} precisam de renovação`;
    const text = [
      `Olá, ${first.name.split(" ")[0]}.`, "",
      list.length === 1 ? "Este documento seu precisa de renovação:" : "Estes documentos seus precisam de renovação:",
      ...list.map((i) => `- ${i.type_code} (${i.type_name}): vencimento ${br(i.expires_on)}, ${when(i)}`),
      "", "Procure o RH para agendar a renovação.", "", "Mensagem automática do Ponto Totem, não responda.",
    ].join("\n");
    const html = wrap(`Olá, ${first.name.split(" ")[0]}`,
      list.length === 1 ? "Este documento seu precisa de renovação:" : "Estes documentos seus precisam de renovação:",
      table(list, false) + '<p style="margin:16px 0 0">Procure o RH para agendar a renovação.</p>',
      "Mensagem automática do Ponto Totem, não responda.");
    out.push({ kind: "funcionario", to, subject, text, html, items: list });
  }
  return out;
}
