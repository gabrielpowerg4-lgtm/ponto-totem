import { createClient } from "@supabase/supabase-js";

// Endereco e chave publica do projeto Supabase (a chave publica pode ficar no navegador:
// o acesso aos dados e controlado pelas funcoes do banco, por usuario).
export const SUPABASE_URL = "https://mplacscrqtlgxmtkcrig.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KM7mdVybDLJYuboUVWYuJg_iMQuVCUn";

export const API_BASE = `${SUPABASE_URL}/functions/v1/rep`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Role = "admin" | "rh";

export type Me = {
  email: string;
  role: Role;
  cpf: string;
  cpf_source: "funcionario" | "manual" | "nenhum";
  employee_name: string | null;
  company: string;
  company_id: string;
  legal_name: string;
  employer_id: string;
  timezone: string;
  has_integration_key: boolean;
};

export type Summary = {
  employees: number;
  employees_without_pin: number;
  sites: number;
  terminals: { code: string; site: string; responsible: string; model: string; last_seen_at: string | null }[];
  punches_total: number;
  punches_today: number;
  last_punch_at: string | null;
  last_nsr: number;
};

export type Company = {
  name: string;
  id_type: 1 | 2;
  employer_id: string;
  legal_name: string;
  caepf: string;
  default_responsible_cpf: string;
  timezone: string;
  last_nsr: number;
  closing_day: number;
  hour_bank: boolean;
  tol_mark: number;
  tol_day: number;
  inpi_number: string;
  dev_id: string;
  dev_name: string;
};

export type Site = { id: string; name: string; cno: string; address: string; employees: number; terminals: number };

export type Employee = {
  cpf: string;
  name: string;
  email: string;
  active: boolean;
  has_pin: boolean;
  external_id: string;
  updated_at: string;
  sites: string[];
  schedule: { id: string; code: string; valid_from: string } | null;
  portal_role?: "" | "admin" | "rh";
  tablet_responsible?: boolean;
  last_punch_at: string | null;
};

export type Terminal = {
  id: string;
  code: string;
  site: string;
  responsible: string;
  model: string;
  os: string;
  app_version: string;
  active: boolean;
  created_at: string;
  last_seen_at: string | null;
  deactivated_at: string | null;
  punches: number;
  last_punch_at: string | null;
};

export type Punch = {
  nsr: number;
  cpf: string;
  name: string;
  marked_at: string;
  recorded_at: string;
  online: boolean;
  face_status: string;
  terminal: string;
  site: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  hash: string;
};

export type PunchFilter = {
  from: string;
  to: string;
  cpf?: string;
  terminal_id?: string;
  site_id?: string;
  online?: string;
  face?: string;
  limit?: number;
  offset?: number;
};

export type PortalUser = {
  user_id: string;
  email: string;
  role: Role;
  cpf: string;
  cpf_source: "funcionario" | "manual" | "nenhum";
  employee_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  is_me: boolean;
};

// ---------------------------------------------------------------------------
// Chamadas
// ---------------------------------------------------------------------------

const ERRORS: Record<string, string> = {
  not_allowed: "Somente o administrador pode fazer isso.",
  cpf_required: "Informe o seu CPF em Minha conta antes de alterar os dados da empresa.",
  invalid_cpf: "CPF inválido: informe os 11 números.",
  invalid_employer_id: "CNPJ (14 números) ou CPF (11 números) do empregador inválido.",
  invalid_caepf: "CAEPF inválido: informe os 14 números.",
  invalid_cno: "CNO inválido: informe os 12 números.",
  invalid_responsible_cpf: "CPF do responsável inválido: informe os 11 números.",
  invalid_period: "Período inválido (máximo de 400 dias).",
  missing_fields: "Preencha os campos obrigatórios.",
  duplicate_name: "Já existe uma obra com este nome.",
  not_found: "Registro não encontrado. Atualize a página.",
  invalid_email: "Informe um e-mail válido.",
  weak_password: "A senha precisa ter pelo menos 8 caracteres.",
  email_exists: "Já existe uma conta com este e-mail.",
  invalid_key: "Chave da empresa incorreta.",
  admin_exists: "Esta empresa já tem um administrador. Peça acesso a ele.",
  missing_reason: "Informe o motivo (pelo menos 3 letras).",
  period_closed: "Este período já está fechado. Para alterar, o administrador precisa reabri-lo.",
  period_not_finished: "O período ainda não terminou.",
  future_datetime: "Não é possível incluir marcação no futuro.",
  invalid_datetime: "Data ou hora inválida.",
  already_done: "Esta marcação já está desconsiderada.",
  invalid_code: "Código inválido: use letras, números, - ou _ (até 30).",
  duplicate_code: "Já existe uma jornada com este código.",
  invalid_schedule: "Horários inválidos: informe pares de entrada e saída em ordem (HH:MM).",
  not_latest: "Só é possível reabrir o último período fechado.",
  invalid_rules: "Regras inválidas.",
  not_recognized: "Não conferiu. Verifique e-mail, CPF e senha de ponto, e se a empresa liberou seu acesso ao portal.",
  too_many_attempts: "Muitas tentativas. Aguarde uma hora e tente de novo.",
  already_active: "Este acesso já foi criado. Use a tela Entrar.",
};

export function errorText(e: unknown, fallback = "Não foi possível concluir. Tente de novo."): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  for (const [code, text] of Object.entries(ERRORS)) {
    if (msg.includes(code)) return text;
  }
  return fallback;
}

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

async function post(path: string, body: unknown, auth: boolean): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const { data } = await supabase.auth.getSession();
    headers.Authorization = `Bearer ${data.session?.access_token ?? ""}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new Error("Não foi possível falar com o servidor.");
  }
  const out = await res.json().catch(() => ({}));
  if (res.ok) return out;
  throw new Error(String(out.error ?? "failed"));
}

/** Primeiro acesso: cria o administrador da empresa, identificado pela chave da empresa. */
export async function signupAdmin(email: string, password: string, companyKey: string): Promise<void> {
  try {
    await post("/v1/portal/signup", { email, password, company_key: companyKey }, false);
  } catch (e) {
    throw new Error(errorText(e, "Não foi possível criar a conta."));
  }
}

/** Primeiro acesso de funcionario liberado pelo Bubble: confirma com CPF e senha de ponto. */
export async function firstAccess(u: { email: string; cpf: string; pin: string; password: string }) {
  try {
    await post("/v1/portal/first-access", u, false);
  } catch (e) {
    throw new Error(errorText(e, "Não foi possível criar o acesso."));
  }
}

/** Administrador cria um usuario do portal (RH ou administrador). */
export async function createPortalUser(u: { email: string; password: string; role: Role; cpf: string }) {
  try {
    await post("/v1/portal/users", u, true);
  } catch (e) {
    throw new Error(errorText(e, "Não foi possível criar o usuário."));
  }
}

/** Fecha o periodo: o servidor recalcula e grava o resultado de cada dia. */
export async function closePeriod(start: string, end: string) {
  try {
    return (await post("/v1/portal/periods/close", { start, end }, true)) as {
      employees: number;
      days: number;
      pending_days: number;
    };
  } catch (e) {
    throw new Error(errorText(e, "Não foi possível fechar o período."));
  }
}

export type Period = {
  start: string;
  end: string;
  current: boolean;
  closed: { closed_at: string; closed_cpf: string; closed_by: string } | null;
};

export type ScheduleRow = {
  id: string;
  code: string;
  name: string;
  days: string[][];
  active: boolean;
  employees: number;
};

export type Holiday = { id: string; type: string; date_from: string; date_to: string; reason: string };

// ---------------------------------------------------------------------------
// Formatos (no fuso da empresa)
// ---------------------------------------------------------------------------

let zone = "America/Sao_Paulo";
export function setTimezone(tz: string) {
  if (tz) zone = tz;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "Nunca";
  return new Date(value).toLocaleString("pt-BR", { timeZone: zone, dateStyle: "short", timeStyle: "short" });
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: zone });
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("pt-BR", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
}

/** Data de hoje no fuso da empresa, no formato AAAA-MM-DD. */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: zone });
}

export function formatCpf(cpf: string): string {
  const d = (cpf ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
}

export function formatEmployerId(id: string): string {
  const d = (id ?? "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return formatCpf(d);
}

export const FACE_LABEL: Record<string, string> = {
  ROSTO_CONFERE: "Rosto conferiu",
  VIVACIDADE_OK: "Pessoa real, sem foto de referência",
  ROSTO_NAO_CONFERE: "Rosto não conferiu",
  SEM_REFERENCIA: "Sem foto de referência",
  SEM_VALIDACAO: "Sem validação facial",
  CAMERA_INDISPONIVEL: "Câmera indisponível",
};

export const faceOk = (status: string) => status === "ROSTO_CONFERE" || status === "VIVACIDADE_OK";

/** Baixa um texto como arquivo. */
export function download(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Data AAAA-MM-DD como dd/mm/aaaa (sem fuso). */
export function br(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export const WEEKDAY = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const WEEKDAY_FULL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
