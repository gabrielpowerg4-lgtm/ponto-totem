// Espelho de Ponto Eletronico em PDF (Portaria 671, art. 84), no layout da folha de ponto do SGI.
// Recebe as fichas ja calculadas (mesmo calculo do tratamento e do fechamento) e monta uma pagina
// por funcionario.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { br, formatCpf } from "./api";
import { fmtClock, fmtMin, OCCURRENCE_LABEL, type Day, type Sheet } from "./jornada";

export type MirrorPerson = {
  sheet: Sheet;
  job_title: string;
  admitted_on: string | null;
  photo: string | null; // data URL
  sites: string;
};

export type MirrorHead = {
  legal_name: string;
  employer_id: string;
  logo: string | null; // data URL
  period: { start: string; end: string };
  generated_at: Date;
};

const NAVY: [number, number, number] = [0, 45, 98];
const GRAY: [number, number, number] = [214, 218, 222];
const GREEN: [number, number, number] = [30, 140, 60];
const RED: [number, number, number] = [210, 30, 30];
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro",
  "Novembro", "Dezembro"];
/** Ocorrencias que abonam horas (entram na coluna Abonadas). */
const ABONO = new Set(["abono", "atestado", "falta_justificada", "ferias", "afastamento"]);

function employerDoc(id: string) {
  const d = id.replace(/\D/g, "");
  if (d.length === 14) return `CNPJ ${d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`;
  if (d.length === 11) return `CPF ${formatCpf(d)}`;
  return d;
}

function hhmm(total: number) {
  const abs = Math.abs(Math.round(total));
  const s = `${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return total < 0 ? `-${s}` : s;
}

function signed(total: number) {
  return total > 0 ? `+${hhmm(total)}` : hhmm(total);
}

function scheduleText(times: string[]) {
  const t = times.filter((x) => /^\d{4}$/.test(x)).map((x) => `${x.slice(0, 2)}:${x.slice(2)}`);
  const pairs: string[] = [];
  for (let i = 0; i + 1 < t.length; i += 2) pairs.push(`${t[i]}-${t[i + 1]}`);
  return pairs.join(" ");
}

/** Linha da tabela de dias. */
function dayRow(d: Day) {
  const effective = d.marks.filter((m) => m.effective).sort((a, b) => a.at_min - b.at_min);
  const label = (m: (typeof effective)[number]) =>
    `${fmtClock(m.min)}${m.kind === "I" ? "*" : ""}${m.next_day ? "'" : ""}`;
  const cols = [0, 1, 2, 3].map((i) => (effective[i] ? label(effective[i]) : ""));
  const obs: string[] = [];
  if (effective.length > 4) obs.push(`Marcações: ${effective.slice(4).map(label).join(" ")}`);
  for (const m of d.marks.filter((x) => x.disregard)) obs.push(`Desconsiderada ${fmtClock(m.min)}`);
  for (const o of d.occurrences) {
    const name = OCCURRENCE_LABEL[o.type] ?? o.type;
    obs.push(o.minutes ? `${name} ${fmtMin(o.minutes)}` : name);
  }
  if (d.holiday && !d.occurrences.some((o) => o.type === "feriado")) obs.push("Feriado");
  if (d.outside_contract) obs.push("Fora do contrato");
  if (d.bonus_removed) obs.push("Bônus retirado");
  const worked = d.worked > 0 || effective.length > 0 ? hhmm(d.worked) : "";
  const bal = d.balance !== 0 ? signed(d.balance) : "";
  const pct = d.balance > 0 && d.pct ? ` ${d.pct}%` : "";
  return {
    cells: [
      `${br(d.date)} ${WEEK[d.weekday]}`,
      d.outside_contract ? "" : scheduleText(d.schedule_times),
      ...cols,
      worked,
      bal ? bal + pct : "",
      d.bonus ? hhmm(d.bonus) : "",
      obs.join("; "),
    ],
    rest: d.expected_base === 0 && effective.length === 0,
    balance: d.balance,
  };
}

function totalsOf(s: Sheet) {
  let abonadas = 0;
  for (const d of s.days) {
    if (d.occurrences.some((o) => ABONO.has(o.type))) abonadas += Math.max(d.expected_base - d.expected, 0);
  }
  return { abonadas };
}

function page(doc: jsPDF, head: MirrorHead, p: MirrorPerson) {
  const W = doc.internal.pageSize.getWidth();
  const M = 10;
  const s = p.sheet;
  const ref = MONTHS[Number(head.period.end.slice(5, 7)) - 1] + "/" + head.period.end.slice(0, 4);

  // Cabecalho
  if (head.logo) {
    const ip = doc.getImageProperties(head.logo);
    const h = Math.min(18, (44 * ip.height) / ip.width);
    doc.addImage(head.logo, "JPEG", M, 8, (h * ip.width) / ip.height, h);
  }
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...NAVY);
  doc.text(head.legal_name.toUpperCase(), 58, 13);
  doc.text(employerDoc(head.employer_id), 58, 18);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(60);
  if (p.sites) doc.text(`Local: ${p.sites}`, 58, 23, { maxWidth: 70 });

  const right = p.photo ? W - M - 24 : W - M;
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...NAVY);
  doc.text(s.name.toUpperCase(), right, 11, { align: "right", maxWidth: 85 });
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(40);
  const lines = [
    p.job_title ? p.job_title.toUpperCase() : "",
    `CPF ${formatCpf(s.cpf)}`,
    p.admitted_on ? `Admissão ${br(p.admitted_on)}` : "",
    `Gerado em ${head.generated_at.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`,
  ].filter(Boolean);
  lines.forEach((l, i) => doc.text(l, right, 16 + i * 4, { align: "right" }));
  if (p.photo) {
    try { doc.addImage(p.photo, "JPEG", W - M - 21, 7, 21, 21); } catch { /* foto em formato nao suportado */ }
  }

  // Titulo
  const top = 32;
  doc.setFillColor(...NAVY).rect(M, top, W - 2 * M, 7, "F");
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(255);
  doc.text(`Espelho de Ponto ${ref}  ·  ${br(head.period.start)} a ${br(head.period.end)}`, W / 2, top + 4.8, { align: "center" });

  const rows = s.days.map(dayRow);
  autoTable(doc, {
    startY: top + 7,
    margin: { left: M, right: M },
    head: [["Data", "Jornada", "Entrada", "Saída", "Entrada", "Saída", "Trabalhado", "Extras", "Bônus", "Obs."]],
    body: rows.map((r) => r.cells),
    theme: "plain",
    styles: { font: "helvetica", fontSize: 7, cellPadding: { top: 0.9, bottom: 0.9, left: 1, right: 1 }, textColor: 30, valign: "middle" },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 30, fontSize: 6, textColor: 90 },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 12, halign: "center" },
      5: { cellWidth: 12, halign: "center" },
      6: { cellWidth: 16, halign: "center" },
      7: { cellWidth: 19, halign: "center" },
      8: { cellWidth: 11, halign: "center" },
      9: { cellWidth: "auto", fontSize: 6.3 },
    },
    didParseCell: (h) => {
      if (h.section !== "body") return;
      const r = rows[h.row.index];
      if (r.rest) h.cell.styles.fillColor = GRAY;
      else if (h.row.index % 2 === 1) h.cell.styles.fillColor = [246, 247, 249];
      if (h.column.index === 7 && r.balance) h.cell.styles.textColor = r.balance > 0 ? GREEN : RED;
    },
    didDrawCell: (h) => {
      if (h.section === "body") {
        doc.setDrawColor(225).setLineWidth(0.1);
        doc.line(h.cell.x, h.cell.y + h.cell.height, h.cell.x + h.cell.width, h.cell.y + h.cell.height);
      }
    },
  });

  // Totais
  const t = s.totals;
  const extra = totalsOf(s);
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["Previsto", "Trabalhadas", "Extras", "Bônus", "Faltantes", "Abonadas", "Acumulado anterior", "Total mês", "Acumulado atual"]],
    body: [[hhmm(t.expected), hhmm(t.worked), hhmm(t.extra), hhmm(t.bonus), t.missing ? `-${hhmm(t.missing)}` : "00:00",
      extra.abonadas ? hhmm(extra.abonadas) : "", signed(t.bank_before), signed(t.bank_delta), signed(t.bank_after)]],
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8, halign: "center", cellPadding: 1.4 },
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 7, fontStyle: "bold" },
    didParseCell: (h) => {
      if (h.section !== "body") return;
      const v = String(h.cell.raw ?? "");
      if (h.column.index === 2 && t.extra) h.cell.styles.textColor = GREEN;
      if (h.column.index === 4 && t.missing) h.cell.styles.textColor = RED;
      if (h.column.index >= 6) h.cell.styles.textColor = v.startsWith("-") ? RED : v.startsWith("+") ? GREEN : 30;
    },
  });

  let y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(90);
  doc.text("* marcação incluída no tratamento   ' marcação do dia seguinte (jornada após a meia-noite)   " +
    "Desconsiderada: marcação original mantida no registro e não usada no cálculo.", M, y2);
  doc.text(`Horas em hh:mm. Extras com percentual indicativo de pagamento. Marcações originais registradas no REP-P; ` +
    `o arquivo AFD contém o registro integral.`, M, y2 + 3.5);

  // Ciencia e assinatura
  const H = doc.internal.pageSize.getHeight();
  y2 = Math.max(y2 + 10, H - 38);
  if (y2 > H - 30) { doc.addPage(); y2 = 20; }
  doc.setFillColor(...GRAY).rect(M + 25, y2, W - 2 * M - 50, 6, "F");
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...NAVY);
  doc.text("Estou ciente deste banco de horas, regido por um sistema de débito e crédito.", W / 2, y2 + 4.1, { align: "center" });
  doc.setDrawColor(150).setLineWidth(0.2);
  doc.line(M + 15, y2 + 22, W / 2 + 5, y2 + 22);
  doc.line(W / 2 + 20, y2 + 22, W - M - 15, y2 + 22);
  doc.setFontSize(9);
  doc.text("Assinatura", (M + 15 + W / 2 + 5) / 2, y2 + 27, { align: "center" });
  doc.text("Data", (W / 2 + 20 + W - M - 15) / 2, y2 + 27, { align: "center" });
}

export function buildMirrorPdf(head: MirrorHead, people: MirrorPerson[]): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  doc.setProperties({ title: `Espelho de Ponto ${br(head.period.start)} a ${br(head.period.end)}`, creator: "Ponto Totem" });
  people.forEach((p, i) => {
    if (i > 0) doc.addPage();
    page(doc, head, p);
  });
  // Numeracao
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120);
    doc.text(`Ponto Totem · REP-P · página ${i} de ${n}`, doc.internal.pageSize.getWidth() - 10, doc.internal.pageSize.getHeight() - 6, { align: "right" });
  }
  return doc.output("blob");
}

/** Converte uma imagem (URL) em data URL JPEG, para o PDF. */
export async function imageData(url: string, square = false): Promise<string | null> {
  try {
    const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject()));
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    // Foto: recorte quadrado no centro. Logo: proporcao original.
    const sw = square ? Math.min(bmp.width, bmp.height) : bmp.width;
    const sh = square ? sw : bmp.height;
    const sx = (bmp.width - sw) / 2;
    const sy = (bmp.height - sh) / 2;
    const scale = Math.min(1, 600 / sw);
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}
