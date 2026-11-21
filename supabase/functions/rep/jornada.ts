// Calculo da jornada: o mesmo codigo roda no portal (tela de tratamento) e no servidor
// (fechamento do periodo e API para o Bubble). Funcoes puras, sem fuso: o banco ja entrega
// cada marcacao como data local e minuto do dia.
//
// Regras:
// - Marcacoes efetivas = originais nao desconsideradas + incluidas no tratamento.
// - Jornada que passa da meia-noite: a primeira marcacao da madrugada (antes das 6h) vai para o
//   dia anterior quando esse dia ficou com numero impar de marcacoes.
// - Hora noturna das 22h as 5h, reduzida (52min30s): cada 7 min noturnos valem 8.
// - Tolerancia (CLT art. 58, par. 1): variacoes de ate 5 min por marcacao, no maximo 10 min no dia,
//   nao contam; passando disso, conta a diferenca inteira.
// - Ocorrencias: feriado, DSR, folga, ferias, atestado, afastamento e falta justificada abonam o dia;
//   abono (ou atestado) com minutos abona parte; falta mantem a falta; folga compensatoria abona o
//   dia e desconta o banco de horas.

export type Settings = { hour_bank: boolean; tol_mark: number; tol_day: number; closing_day: number };
export type Schedule = { id: string; code: string; name: string; days: string[][] };
export type Assignment = { schedule_id: string; valid_from: string };
export type EmployeeData = {
  cpf: string;
  name: string;
  active: boolean;
  assignments: Assignment[];
  bank_before: number;
};
export type MarkData = {
  cpf: string;
  nsr: number | null;
  adj_id: string | null;
  kind: "O" | "I";
  date: string;
  min: number;
  face: string | null;
  online: boolean | null;
  reason: string | null;
  by?: string;
  at?: string;
  disregard: { id: string; reason: string; by: string; at: string } | null;
};
export type Occurrence = {
  id: string;
  cpf: string | null;
  type: string;
  date_from: string;
  date_to: string;
  minutes: number | null;
  reason: string;
  by: string;
  at: string;
};
export type TimesheetData = {
  from: string;
  to: string;
  settings: Settings;
  schedules: Schedule[];
  employees: EmployeeData[];
  marks: MarkData[];
  occurrences: Occurrence[];
  closed: { start: string; end: string; closed_at: string }[];
};

export type DayMark = MarkData & { effective: boolean; at_min: number; next_day: boolean };

export type Day = {
  cpf: string;
  date: string;
  weekday: number;
  schedule_code: string;
  schedule_times: string[];
  expected_base: number;
  expected: number;
  marks: DayMark[];
  worked_real: number;
  night: number;
  worked: number;
  balance: number;
  bank_delta: number;
  extra: number;
  missing: number;
  tolerance: boolean;
  occurrences: Occurrence[];
  flags: string[];
  closed: boolean;
};

export type Totals = {
  expected: number;
  worked: number;
  night: number;
  extra: number;
  missing: number;
  bank_delta: number;
  bank_before: number;
  bank_after: number;
  pending_days: number;
};

export type Sheet = { cpf: string; name: string; active: boolean; days: Day[]; totals: Totals; schedule_missing: boolean };

/** Alertas que pedem tratamento antes do fechamento. */
export const ALERTS = ["impar", "sem_marcacao", "rosto", "sem_jornada"];

export const FLAG_LABEL: Record<string, string> = {
  impar: "Marcações ímpares",
  sem_marcacao: "Sem marcação",
  rosto: "Rosto não conferiu",
  sem_jornada: "Sem jornada",
  offline: "Off-line",
  descanso_trabalhado: "Trabalho em dia de descanso",
  falta: "Falta",
  ajustado: "Tratado",
};

export const OCCURRENCE_LABEL: Record<string, string> = {
  feriado: "Feriado",
  dsr: "DSR",
  folga: "Folga",
  ferias: "Férias",
  atestado: "Atestado",
  afastamento: "Afastamento",
  falta_justificada: "Falta justificada",
  abono: "Abono de horas",
  falta: "Falta não justificada",
  folga_compensatoria: "Folga compensatória (banco)",
};

const FULL_DAY = new Set(["feriado", "dsr", "folga", "ferias", "atestado", "afastamento", "falta_justificada"]);
const FACE_OK = new Set(["ROSTO_CONFERE", "VIVACIDADE_OK"]);

// ---------------------------------------------------------------------------
// Datas (sempre AAAA-MM-DD, sem fuso)
// ---------------------------------------------------------------------------

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));

/** Horarios da jornada em minutos crescentes (a virada de meia-noite soma 1440). */
export function unwrap(times: string[]): number[] {
  const out: number[] = [];
  for (const t of times) {
    let m = toMin(t);
    while (out.length && m <= out[out.length - 1]) m += 1440;
    out.push(m);
  }
  return out;
}

export function fmtMin(total: number, signed = false): string {
  const sign = total < 0 ? "-" : signed && total > 0 ? "+" : "";
  const abs = Math.abs(Math.round(total));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

export function fmtClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function nightOverlap(a: number, b: number): number {
  let total = 0;
  // Janelas noturnas: 00:00-05:00 do dia, 22:00-05:00 da virada e 22:00-05:00 da noite seguinte.
  for (const [s, e] of [[0, 300], [1320, 1740], [2760, 3180]]) {
    total += Math.max(0, Math.min(b, e) - Math.max(a, s));
  }
  return total;
}

// ---------------------------------------------------------------------------
// Calculo
// ---------------------------------------------------------------------------

function scheduleFor(emp: EmployeeData, schedules: Map<string, Schedule>, date: string): Schedule | null {
  let found: Schedule | null = null;
  for (const a of emp.assignments) {
    if (a.valid_from <= date) found = schedules.get(a.schedule_id) ?? found;
  }
  return found;
}

export function computeEmployee(data: TimesheetData, emp: EmployeeData): Sheet {
  const schedules = new Map(data.schedules.map((s) => [s.id, s]));
  const s = data.settings;
  const first = addDays(data.from, -1);
  const last = addDays(data.to, 1);

  // Marcacoes por dia, ordenadas.
  const byDate = new Map<string, DayMark[]>();
  for (const m of data.marks) {
    if (m.cpf !== emp.cpf || m.date < first || m.date > last) continue;
    const dm: DayMark = { ...m, effective: m.kind === "I" || !m.disregard, at_min: m.min, next_day: false };
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date)!.push(dm);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.at_min - b.at_min);

  // Jornada que passa da meia-noite.
  for (let d = first; d < last; d = addDays(d, 1)) {
    const today = byDate.get(d) ?? [];
    const next = byDate.get(addDays(d, 1)) ?? [];
    const eff = today.filter((m) => m.effective);
    const nextEff = next.filter((m) => m.effective);
    if (eff.length % 2 === 1 && nextEff.length > 0) {
      const lastMark = eff[eff.length - 1];
      const candidate = nextEff[0];
      if (candidate.min < 360 && 1440 - lastMark.at_min + candidate.min <= 960) {
        next.splice(next.indexOf(candidate), 1);
        today.push({ ...candidate, at_min: candidate.min + 1440, next_day: true });
        byDate.set(d, today);
      }
    }
  }

  const days: Day[] = [];
  for (const date of dateRange(data.from, data.to)) {
    const wd = weekday(date);
    const sch = scheduleFor(emp, schedules, date);
    const times = sch ? (sch.days[wd] ?? []) : [];
    const exp = unwrap(times);
    let expectedBase = 0;
    for (let i = 0; i + 1 < exp.length; i += 2) {
      expectedBase += exp[i + 1] - exp[i] + Math.round(nightOverlap(exp[i], exp[i + 1]) / 7);
    }

    const occ = data.occurrences.filter((o) =>
      (o.cpf === null || o.cpf === emp.cpf) && o.date_from <= date && o.date_to >= date
    );
    let expected = expectedBase;
    let bankExtra = 0;
    let fullDay = false;
    let falta = false;
    for (const o of occ) {
      if (o.type === "folga_compensatoria") {
        bankExtra -= expectedBase;
        expected = 0;
        fullDay = true;
      } else if ((o.type === "abono" || o.type === "atestado") && o.minutes) {
        expected = Math.max(0, expected - o.minutes);
      } else if (FULL_DAY.has(o.type)) {
        expected = 0;
        fullDay = true;
      } else if (o.type === "falta") {
        falta = true;
      }
    }

    const marks = (byDate.get(date) ?? []).slice().sort((a, b) => a.at_min - b.at_min);
    const eff = marks.filter((m) => m.effective);
    let workedReal = 0;
    let night = 0;
    for (let i = 0; i + 1 < eff.length; i += 2) {
      const a = eff[i].at_min;
      const b = eff[i + 1].at_min;
      workedReal += b - a;
      night += nightOverlap(a, b);
    }
    const worked = workedReal + Math.round(night / 7);

    const flags: string[] = [];
    if (!sch) flags.push("sem_jornada");
    if (eff.length % 2 === 1) flags.push("impar");
    if (expected > 0 && eff.length === 0 && !falta) flags.push("sem_marcacao");
    if (falta) flags.push("falta");
    if (eff.some((m) => m.kind === "O" && m.face && !FACE_OK.has(m.face))) flags.push("rosto");
    if (eff.some((m) => m.kind === "O" && m.online === false)) flags.push("offline");
    if (expectedBase === 0 || fullDay) {
      if (worked > 0) flags.push("descanso_trabalhado");
    }
    if (marks.some((m) => m.kind === "I" || m.disregard) || occ.some((o) => o.cpf !== null)) flags.push("ajustado");

    // Tolerancia: mesmo numero de marcacoes que a jornada, cada uma ate tol_mark e no total ate tol_day.
    let tolerance = false;
    let balance = worked - expected;
    if (!fullDay && expected === expectedBase && exp.length > 0 && eff.length === exp.length) {
      const dev = eff.map((m, i) => Math.abs(m.at_min - exp[i]));
      const total = dev.reduce((x, y) => x + y, 0);
      if (dev.every((x) => x <= s.tol_mark) && total <= s.tol_day && night === 0) {
        tolerance = true;
        balance = 0;
      }
    }

    const bankDelta = s.hour_bank ? balance + bankExtra : 0;
    days.push({
      cpf: emp.cpf,
      date,
      weekday: wd,
      schedule_code: sch?.code ?? "",
      schedule_times: times,
      expected_base: expectedBase,
      expected,
      marks,
      worked_real: workedReal,
      night,
      worked,
      balance,
      bank_delta: bankDelta,
      extra: Math.max(0, balance),
      missing: Math.max(0, -balance),
      tolerance,
      occurrences: occ,
      flags,
      closed: data.closed.some((c) => c.start <= date && c.end >= date),
    });
  }

  const sum = (f: (d: Day) => number) => days.reduce((x, d) => x + f(d), 0);
  const bankDelta = sum((d) => d.bank_delta);
  return {
    cpf: emp.cpf,
    name: emp.name,
    active: emp.active,
    days,
    schedule_missing: days.some((d) => d.flags.includes("sem_jornada")),
    totals: {
      expected: sum((d) => d.expected),
      worked: sum((d) => d.worked),
      night: sum((d) => d.night),
      extra: sum((d) => d.extra),
      missing: sum((d) => d.missing),
      bank_delta: bankDelta,
      bank_before: emp.bank_before,
      bank_after: emp.bank_before + bankDelta,
      pending_days: days.filter((d) => d.flags.some((f) => ALERTS.includes(f))).length,
    },
  };
}

export function computeAll(data: TimesheetData): Sheet[] {
  return data.employees.map((e) => computeEmployee(data, e));
}

/** Linha gravada no fechamento (e entregue ao Bubble). */
export function closingRow(d: Day) {
  return {
    cpf: d.cpf,
    date: d.date,
    schedule_code: d.schedule_code,
    schedule_times: d.schedule_times,
    expected: d.expected,
    worked: d.worked,
    worked_real: d.worked_real,
    night: d.night,
    balance: d.balance,
    extra: d.extra,
    missing: d.missing,
    bank_delta: d.bank_delta,
    tolerance: d.tolerance,
    flags: d.flags,
    marks: d.marks.map((m) => ({
      time: fmtClock(m.at_min),
      next_day: m.next_day,
      source: m.kind === "I" ? "incluida" : m.disregard ? "desconsiderada" : "original",
      nsr: m.nsr,
      reason: m.kind === "I" ? m.reason : m.disregard?.reason ?? null,
    })),
    occurrences: d.occurrences.map((o) => ({ type: o.type, minutes: o.minutes, reason: o.reason })),
  };
}
