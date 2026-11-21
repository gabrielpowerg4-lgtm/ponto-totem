import { createClient } from "@supabase/supabase-js";

// Endereco e chave publica do projeto Supabase (a chave publica pode ficar no navegador:
// o acesso aos dados e controlado pelas funcoes do banco, por usuario).
export const SUPABASE_URL = "https://mplacscrqtlgxmtkcrig.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KM7mdVybDLJYuboUVWYuJg_iMQuVCUn";

export const API_BASE = `${SUPABASE_URL}/functions/v1/rep`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type Me = {
  email: string;
  role: "admin" | "rh";
  company: string;
  company_id: string;
  legal_name: string;
  employer_id: string;
  has_integration_key: boolean;
};

export type Terminal = {
  code: string;
  site: string;
  responsible: string;
  model: string;
  last_seen_at: string | null;
};

export type Summary = {
  employees: number;
  employees_without_pin: number;
  sites: number;
  terminals: Terminal[];
  punches_total: number;
  punches_today: number;
  last_punch_at: string | null;
  last_nsr: number;
};

export async function rpc<T>(name: string): Promise<T> {
  const { data, error } = await supabase.rpc(name);
  if (error) throw new Error(error.message);
  return data as T;
}

const SIGNUP_ERRORS: Record<string, string> = {
  invalid_email: "Informe um e-mail válido.",
  weak_password: "A senha precisa ter pelo menos 8 caracteres.",
  invalid_key: "Chave da empresa incorreta.",
  admin_exists: "Esta empresa já tem um administrador. Peça acesso a ele.",
  email_exists: "Já existe uma conta com este e-mail. Use a tela de entrada.",
};

/** Primeiro acesso: cria o administrador da empresa, identificado pela chave da empresa. */
export async function signupAdmin(email: string, password: string, companyKey: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/portal/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, company_key: companyKey }),
    });
  } catch {
    throw new Error("Não foi possível falar com o servidor.");
  }
  if (res.ok) return;
  const body = await res.json().catch(() => ({}));
  throw new Error(SIGNUP_ERRORS[body.error] ?? "Não foi possível criar a conta.");
}

export function formatDateTime(value: string | null): string {
  if (!value) return "Nunca";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
