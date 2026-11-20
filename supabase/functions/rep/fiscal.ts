// Geracao do AFD (Portaria 671, Anexo V, leiaute 003) e do AEJ (leiaute 002).
// Funcoes puras: recebem os dados do banco e devolvem o texto e os avisos.

export type Head = {
  id_type: number;
  employer_id: string;
  legal_name: string;
  caepf: string;
  cno: string;
  address: string;
  schedule_code: string;
  schedule_times: string[];
  inpi_number: string;
  dev_id_type: number;
  dev_id: string;
  dev_name: string;
  dev_email: string;
  program_name: string;
  program_version: string;
  generated_dh: string;
};

export type AfdRecord = {
  nsr: number;
  type: number;
  recorded_dh: string;
  // tipo 2
  responsible_cpf?: string;
  id_type?: number;
  employer_id?: string;
  cno_caepf?: string;
  legal_name?: string;
  address?: string;
  // tipo 5
  op?: string;
  name?: string;
  // tipo 7
  cpf?: string;
  marked_dh?: string;
  collector?: number;
  online?: boolean;
  hash?: string;
  prev_hash?: string;
};

export type Mark = { cpf: string; marked_dh: string; local_date: string };

export type FiscalFile = {
  filename: string;
  bytes: Uint8Array;
  records: number;
  warnings: string[];
};

export class FiscalError extends Error {}

const CRLF = "\r\n";
const SIGNATURE = "ASSINATURA_DIGITAL_EM_ARQUIVO_P7S";

// ---------------------------------------------------------------------------
// Texto em ISO 8859-1
// ---------------------------------------------------------------------------

/** Troca caracteres fora do ISO 8859-1, e os de controle, por equivalentes seguros. */
export function latin1Safe(text: string): string {
  let out = "";
  for (const ch of text.replace(/[\r\n\t]/g, " ")) {
    const code = ch.codePointAt(0) ?? 63;
    if (code >= 32 && code <= 255 && !(code >= 127 && code < 160)) {
      out += ch;
    } else {
      const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const c = plain.codePointAt(0) ?? 63;
      out += plain.length === 1 && c >= 32 && c < 127 ? plain : "?";
    }
  }
  return out;
}

export function toLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[i] = code <= 255 ? code : 63;
  }
  return bytes;
}

/** CRC-16/KERMIT (CCITT refletido, inicio 0): "123456789" -> "2189". */
export function crc16(text: string): string {
  let crc = 0;
  for (const b of toLatin1(text)) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toLatin1(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Campos de tamanho fixo (AFD)
// ---------------------------------------------------------------------------

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Numerico: zeros a esquerda. Vazio: espacos (campo opcional nao informado). */
function n(value: unknown, size: number): string {
  const d = digits(value);
  if (d === "") return " ".repeat(size);
  return d.slice(-size).padStart(size, "0");
}

/** Alfanumerico: alinhado a esquerda, completado com espacos. */
function a(value: unknown, size: number): string {
  return latin1Safe(String(value ?? "")).slice(0, size).padEnd(size, " ");
}

function withCrc(body: string): string {
  return body + crc16(body);
}

function requireEmployer(head: Head) {
  const id = digits(head.employer_id);
  const ok = (head.id_type === 1 && id.length === 14) || (head.id_type === 2 && id.length === 11);
  if (!ok || !String(head.legal_name ?? "").trim()) {
    throw new FiscalError("employer_missing");
  }
}

function commonWarnings(head: Head): string[] {
  const warnings: string[] = [];
  if (digits(head.inpi_number).length === 0) {
    warnings.push("Número de registro do REP-P no INPI não cadastrado: o campo foi preenchido com zeros.");
  }
  if (digits(head.dev_id).length === 0) {
    warnings.push("CNPJ ou CPF do desenvolvedor do REP-P não cadastrado: o campo foi preenchido com zeros.");
  }
  warnings.push(
    "Arquivo sem assinatura digital: falta o certificado ICP-Brasil para gerar o arquivo .p7s. " +
      "Sem ele, o arquivo não tem validade para a fiscalização.",
  );
  return warnings;
}

// ---------------------------------------------------------------------------
// AFD
// ---------------------------------------------------------------------------

export async function buildAfd(
  head: Head,
  records: AfdRecord[],
  from: string,
  to: string,
): Promise<FiscalFile> {
  requireEmployer(head);
  const warnings = commonWarnings(head);
  const lines: string[] = [];
  const inpi = digits(head.inpi_number).padStart(17, "0").slice(-17);
  const devId = digits(head.dev_id) || "0";

  // Tipo 1: cabecalho (302 posicoes).
  lines.push(withCrc(
    "000000000" + "1" + String(head.id_type) + n(head.employer_id, 14) +
      n(head.cno || head.caepf, 14) + a(head.legal_name, 150) + inpi +
      from + to + head.generated_dh + "003" + String(head.dev_id_type || 1) +
      n(devId, 14) + a("", 30),
  ));

  const counts: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  let brokenChain = 0;

  for (const r of records) {
    const nsr = n(r.nsr, 9);
    if (r.type === 2) {
      // Tipo 2: inclusao ou alteracao da identificacao da empresa (331 posicoes).
      lines.push(withCrc(
        nsr + "2" + r.recorded_dh + n(r.responsible_cpf, 14) + String(r.id_type ?? 1) +
          n(r.employer_id, 14) + n(r.cno_caepf, 14) + a(r.legal_name, 150) + a(r.address, 100),
      ));
    } else if (r.type === 5) {
      // Tipo 5: inclusao, alteracao ou exclusao de empregado (118 posicoes).
      lines.push(withCrc(
        nsr + "5" + r.recorded_dh + a(r.op, 1) + n(r.cpf, 12) + a(r.name, 52) + a("", 4) +
          n(r.responsible_cpf || "0", 11),
      ));
    } else if (r.type === 7) {
      // Tipo 7: marcacao de REP-P (137 posicoes).
      const fields = nsr + "7" + r.marked_dh + n(r.cpf, 12) + r.recorded_dh +
        n(r.collector ?? 1, 2) + (r.online ? "0" : "1");
      const expected = await sha256Hex(fields + (r.prev_hash ?? ""));
      if (expected !== r.hash) brokenChain += 1;
      lines.push(fields + a(r.hash, 64));
    } else {
      continue;
    }
    counts[r.type] += 1;
  }

  // Trailer (64 posicoes) e assinatura (100 posicoes).
  lines.push(
    "999999999" + n(counts[2], 9) + n(counts[3], 9) + n(counts[4], 9) + n(counts[5], 9) +
      n(counts[6], 9) + n(counts[7], 9) + "9",
  );
  lines.push(a(SIGNATURE, 100));

  if (brokenChain > 0) {
    warnings.unshift(
      `${brokenChain} marcação(ões) com hash diferente do recalculado. Em geral são registros ` +
        "de teste gravados antes da regra atual do hash.",
    );
  }
  if (records.length === 0) warnings.unshift("Nenhum registro gravado no período.");

  return {
    filename: "AFD" + inpi + digits(head.employer_id) + "REP_P.txt",
    bytes: toLatin1(lines.join(CRLF) + CRLF),
    records: records.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// AEJ
// ---------------------------------------------------------------------------

function clean(value: unknown): string {
  return latin1Safe(String(value ?? "")).replace(/\|/g, " ").trim();
}

function minutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

export function buildAej(
  head: Head,
  marks: Mark[],
  employees: Record<string, string>,
  from: string,
  to: string,
): FiscalFile {
  requireEmployer(head);
  const times = (head.schedule_times ?? []).filter((t) => /^\d{4}$/.test(t));
  if (times.length < 2 || times.length % 2 !== 0) {
    throw new FiscalError("schedule_missing");
  }
  const warnings = commonWarnings(head);
  const lines: string[] = [];
  const count: Record<string, number> = {};
  const push = (type: string, fields: unknown[]) => {
    lines.push([type, ...fields.map((f) => clean(f))].join("|"));
    count[type] = (count[type] ?? 0) + 1;
  };

  const code = clean(head.schedule_code) || "PADRAO";
  const inpi = digits(head.inpi_number).padStart(17, "0").slice(-17);

  push("01", [
    head.id_type, digits(head.employer_id), digits(head.caepf), digits(head.cno),
    head.legal_name, from, to, head.generated_dh, "002",
  ]);
  push("02", [1, 3, inpi]);

  // Vinculos: um por funcionario com marcacao no periodo.
  const link: Record<string, number> = {};
  for (const m of marks) {
    if (link[m.cpf] === undefined) {
      link[m.cpf] = Object.keys(link).length + 1;
      push("03", [link[m.cpf], m.cpf, employees[m.cpf] ?? "Nome não cadastrado"]);
    }
  }

  // Horario contratual da obra.
  let duration = 0;
  for (let i = 0; i < times.length; i += 2) {
    duration += (minutes(times[i + 1]) - minutes(times[i]) + 1440) % 1440;
  }
  push("04", [code, duration, ...times]);

  // Marcacoes: por funcionario e dia, alternando entrada e saida.
  let position = 0;
  let lastKey = "";
  let odd = 0;
  for (const m of marks) {
    const key = m.cpf + "|" + m.local_date;
    if (key !== lastKey) {
      if (lastKey !== "" && position % 2 === 1) odd += 1;
      lastKey = key;
      position = 0;
    }
    const entry = position % 2 === 0;
    const pair = Math.floor(position / 2) + 1;
    push("05", [
      link[m.cpf], m.marked_dh, 1, entry ? "E" : "S", String(pair).padStart(3, "0"), "O",
      entry && pair === 1 ? code : "", "",
    ]);
    position += 1;
  }
  if (lastKey !== "" && position % 2 === 1) odd += 1;

  push("08", [
    head.program_name || "Ponto Totem", head.program_version || "1", head.dev_id_type || 1,
    digits(head.dev_id) || "0", head.dev_name || "Não cadastrado", head.dev_email || "",
  ]);

  const totals = ["01", "02", "03", "04", "05", "06", "07", "08"].map((t) => count[t] ?? 0);
  lines.push(["99", ...totals].join("|"));
  lines.push(SIGNATURE.padEnd(100, " "));

  if (marks.length === 0) warnings.unshift("Nenhuma marcação no período.");
  if (odd > 0) {
    warnings.unshift(
      `${odd} dia(s) com número ímpar de marcações: a última ficou como entrada sem saída. ` +
        "Jornadas que passam da meia-noite também aparecem assim.",
    );
  }

  return {
    filename: `AEJ_${digits(head.employer_id)}_${from}_${to}.txt`,
    bytes: toLatin1(lines.join(CRLF) + CRLF),
    records: marks.length,
    warnings,
  };
}
