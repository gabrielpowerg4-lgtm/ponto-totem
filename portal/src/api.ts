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
  clt_from: string | null;
  tol_sgi: number;
  bonus_every: number;
  bonus_minutes: number;
  pct_weekday: number[];
  pct_holiday: number;
  comp_holiday_minutes: number;
  bank_expiry_months: number;
  bank_alert_days: number;
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
  admitted_on?: string | null;
  dismissed_on?: string | null;
  birth_date?: string | null;
  sex?: "" | "M" | "F";
  job_title?: string;
  contract_type?: "" | "CLT" | "PJ" | "ESTAGIO" | "TEMPORARIO";
  photo_path?: string;
  portal_access?: boolean;
  site_ids?: string[];
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
  cpf_required: "Informe o seu CPF em Meus dados antes de alterar os dados da empresa.",
  invalid_cpf: "CPF inválido: informe os 11 números.",
  invalid_employer_id: "CNPJ (14 números) ou CPF (11 números) do empregador inválido.",
  invalid_caepf: "CAEPF inválido: informe os 14 números.",
  invalid_cno: "CNO inválido: informe os 12 números.",
  invalid_responsible_cpf: "CPF do responsável inválido: informe os 11 números.",
  invalid_period: "Período inválido (máximo de 400 dias).",
  notify_without_recipient: "Para ativar o aviso, informe ao menos um destinatário ou marque o envio ao funcionário.",
  too_many: "Muitos itens de uma vez. Reduza a lista.",
  invalid_smtp: "Servidor, porta ou nome do remetente inválido.",
  smtp_not_configured: "Envio de e-mail não configurado: preencha os dados e a senha nesta tela.",
  smtp_auth: "O servidor de e-mail recusou o usuário ou a senha (SMTP_USER / SMTP_PASSWORD).",
  smtp_connect: "Não foi possível conectar ao servidor de e-mail (host ou porta).",
  smtp_timeout: "O servidor de e-mail não respondeu a tempo.",
  smtp_tls: "Falha na conexão segura (TLS) com o servidor de e-mail.",
  smtp_rejected: "O servidor de e-mail recusou o destinatário ou a mensagem.",
  smtp_failed: "O envio do e-mail falhou. Veja o registro do servidor.",
  period_open: "Nenhum funcionário com este período fechado. O AEJ só é gerado depois do fechamento.",
  forbidden: "Somente o administrador pode gerar este arquivo.",
  employer_missing: "Cadastre o CNPJ e a razão social da empresa em Configurações antes de gerar o arquivo.",
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
  already_done: "Isto já foi feito. Atualize a página.",
  exceeds_balance: "As horas informadas passam do saldo em aberto do funcionário.",
  invalid_kind: "Escolha pagamento ou desconto.",
  attachment_limit: "O dia já tem 3 anexos.",
  invalid_file: "Não foi possível enviar o arquivo (PDF, JPG ou PNG, até 5 MB).",
  settled_after_close: "Houve pagamento ou desconto depois deste fechamento. Estorne-o antes de reabrir.",
  cpf_exists: "Já existe um funcionário com este CPF.",
  email_in_use: "Este e-mail já está em outro funcionário.",
  invalid_birth_date: "Data de nascimento inválida.",
  previous_open: "O período anterior ainda está aberto. Feche os períodos em ordem, do mais antigo para o mais recente.",
  company_closed: "O período da empresa está fechado. Reabra o período antes de reabrir o funcionário.",
  clt_date_closed: "A data das regras da CLT não pode ficar dentro de um período já fechado.",
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

/** Fecha o periodo de um funcionario: o servidor recalcula e grava os dias dele. */
export async function closeEmployee(start: string, end: string, cpf: string) {
  try {
    return (await post("/v1/portal/periods/close-employee", { start, end, cpf }, true)) as { days: number; pending_days: number };
  } catch (e) {
    throw new Error(errorText(e, "Não foi possível fechar o funcionário."));
  }
}

export type MailSettings = {
  host: string;
  port: 465 | 587;
  secure: boolean;
  smtp_user: string;
  mail_from: string;
  from_name: string;
  password_set: boolean;
  password_set_at: string | null;
  updated_at?: string;
  updated_by?: string;
  saved: boolean;
};

export type MailStatus = {
  configured: boolean;
  source: "env" | "portal" | "none";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  password_set: boolean;
};

async function authed(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
  if (method === "POST") return post(path, body ?? {}, true);
  const { data } = await supabase.auth.getSession();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  } catch {
    throw new Error("Não foi possível falar com o servidor.");
  }
  const out = await res.json().catch(() => ({}));
  if (res.ok) return out;
  throw new Error(String(out.error ?? "failed"));
}

/** Previa do aviso de vencimento de um tipo, ou envio de teste para o proprio usuario. */
export async function docAlertPreview(typeId: string, send: boolean): Promise<{ documents: number; subject?: string; html?: string }> {
  return (await authed("POST", "/v1/portal/doc-alerts/preview", { type_id: typeId, send })) as unknown as {
    documents: number; subject?: string; html?: string;
  };
}

/** Situacao do envio de e-mail (a senha nunca vem do servidor). Somente administrador. */
export async function mailStatus(): Promise<MailStatus> {
  try {
    return (await authed("GET", "/v1/portal/mail/status")) as unknown as MailStatus;
  } catch (e) {
    throw new Error(errorText(e, "Não foi possível ler a configuração de e-mail."));
  }
}

/** Envia o e-mail de teste para um endereco informado pelo administrador. */
export async function mailTest(to: string): Promise<void> {
  try {
    await authed("POST", "/v1/portal/mail/test", { to });
  } catch (e) {
    throw new Error(errorText(e, "Não foi possível enviar o e-mail de teste."));
  }
}

export type FiscalResult = {
  filename: string;
  content_base64: string;
  records: number;
  warnings: string[];
  employees?: number;
  employees_open?: number;
};

/** AFD (qualquer intervalo) ou AEJ (periodo fechado), gerados no servidor. Somente administrador. */
export async function fiscalFile(kind: "afd" | "aej", from: string, to: string): Promise<FiscalResult> {
  try {
    return (await post("/v1/portal/fiscal", { kind, from, to }, true)) as unknown as FiscalResult;
  } catch (e) {
    throw new Error(errorText(e, "Não foi possível gerar o arquivo."));
  }
}

export type Period = {
  start: string;
  end: string;
  current: boolean;
  employees_closed?: number;
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
export function download(filename: string, content: string | Blob, type = "text/csv;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
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
