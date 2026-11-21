// Servico REP-P: API usada pelos tablets (coletores).
// Autenticacao propria: cada terminal tem um token, guardado no banco so como hash.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAej, buildAfd, FiscalError } from "./fiscal.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

// Senha de ponto no mesmo formato do tablet: PBKDF2-SHA256, 120.000 iteracoes,
// "sal:hash" em hexadecimal. A senha em texto nunca e guardada.
async function hashPin(pin: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 120_000 },
    key,
    256,
  );
  const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  return hex(salt) + ":" + hex(new Uint8Array(bits));
}

// Aceita os nomes de campo em portugues; "senha" vira hash antes de ir ao banco.
async function employeeFromBody(item: Record<string, unknown>): Promise<Record<string, unknown> | string> {
  const out: Record<string, unknown> = {
    cpf: String(item.cpf ?? ""),
    nome: String(item.nome ?? ""),
  };
  if (item.email !== undefined && item.email !== null) out.email = String(item.email);
  if (item.ativo !== undefined && item.ativo !== null && item.ativo !== "") {
    const v = String(item.ativo).toLowerCase();
    out.ativo = !(v === "false" || v === "nao" || v === "não" || v === "0" || v === "no");
  }
  if (item.obra !== undefined && item.obra !== null) out.obra = String(item.obra);
  if (item.id_externo !== undefined && item.id_externo !== null) out.id_externo = String(item.id_externo);
  if (item.responsavel_cpf !== undefined && item.responsavel_cpf !== null) {
    out.responsavel_cpf = String(item.responsavel_cpf);
  }
  const senha = item.senha === undefined || item.senha === null ? "" : String(item.senha);
  if (senha !== "") {
    if (!/^\d{4,8}$/.test(senha)) return "A senha de ponto deve ter de 4 a 8 números.";
    out.pin_hash = await hashPin(senha);
  }
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bearerHash(req: Request): Promise<string | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length < 20) return null;
  return await sha256Hex(token);
}

// Dados do aparelho (modelo, sistema, versao do app, identificador da instalacao).
function deviceOf(body: Record<string, unknown>): Record<string, unknown> | null {
  const device = body.device;
  return device && typeof device === "object" && !Array.isArray(device)
    ? (device as Record<string, unknown>)
    : null;
}

function failure(error: { message?: string } | null): Response {
  const message = error?.message ?? "";
  if (message.includes("invalid_token")) return json(401, { error: "invalid_token" });
  if (message.includes("invalid_key")) return json(403, { error: "invalid_key" });
  for (const code of [
    "missing_fields", "invalid_employer_id", "invalid_cno", "invalid_caepf",
    "invalid_responsible_cpf", "invalid_schedule", "invalid_period", "not_allowed",
  ]) {
    if (message.includes(code)) return json(400, { error: code });
  }
  console.error("rep error:", message);
  return json(500, { error: "server_error" });
}

Deno.serve(async (req: Request) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const now = () => Date.now();

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Hora do servidor, para ancorar o relogio do tablet.
    if (req.method === "GET" && path.endsWith("/v1/time")) {
      return json(200, { server_time_ms: now() });
    }

    // Vinculacao do terminal a empresa e a obra.
    if (req.method === "POST" && path.endsWith("/v1/enroll")) {
      const body = await req.json();
      const key = String(body.company_key ?? "").trim().toUpperCase();
      if (key.length < 8) return json(403, { error: "invalid_key" });
      const token = randomToken();
      const { data, error } = await db.rpc("rep_enroll", {
        p_key_hash: await sha256Hex(key),
        p_site: String(body.site ?? ""),
        p_code: String(body.terminal_code ?? ""),
        p_responsible: String(body.responsible ?? ""),
        p_token_hash: await sha256Hex(token),
        p_device: deviceOf(body),
      });
      if (error) return failure(error);
      return json(200, { ...data, terminal_token: token, server_time_ms: now() });
    }

    // Portal: primeiro acesso do administrador, identificado pela chave da empresa.
    if (req.method === "POST" && path.endsWith("/v1/portal/signup")) {
      const body = await req.json();
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const key = String(body.company_key ?? "").trim().toUpperCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "invalid_email" });
      if (password.length < 8) return json(400, { error: "weak_password" });
      const keyHash = await sha256Hex(key);
      const { data: company } = await db.from("companies").select("id").eq("enroll_key_hash", keyHash).maybeSingle();
      if (!company) return json(403, { error: "invalid_key" });
      const { count } = await db.from("portal_users").select("user_id", { count: "exact", head: true })
        .eq("company_id", company.id).eq("role", "admin");
      if ((count ?? 0) > 0) return json(409, { error: "admin_exists" });
      const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) {
        const msg = created.error?.message ?? "";
        return json(400, { error: /already|registered|exists/i.test(msg) ? "email_exists" : "signup_failed" });
      }
      const { error } = await db.rpc("portal_claim_admin", { p_user: created.data.user.id, p_key_hash: keyHash });
      if (error) {
        await db.auth.admin.deleteUser(created.data.user.id);
        return failure(error);
      }
      return json(200, { ok: true });
    }

    const tokenHash = await bearerHash(req);
    if (!tokenHash) return json(401, { error: "invalid_token" });

    // ---- Integracao (Bubble ou n8n), autenticada pela chave de integracao ----

    if (path.includes("/v1/integration/funcionarios")) {
      if (req.method === "GET") {
        const cpf = new URL(req.url).searchParams.get("cpf") ?? "";
        const { data, error } = await db.rpc("rep_int_list_employees", { p_key_hash: tokenHash, p_cpf: cpf });
        if (error) return failure(error);
        return json(200, { funcionarios: data });
      }
      if (req.method === "POST") {
        const body = await req.json();
        const many = Array.isArray(body.funcionarios);
        const items: Record<string, unknown>[] = many ? body.funcionarios : [body];
        if (items.length > 500) return json(413, { error: "too_many" });
        const results: unknown[] = [];
        for (const item of items) {
          const parsed = await employeeFromBody(item ?? {});
          if (typeof parsed === "string") {
            results.push({ cpf: String(item?.cpf ?? ""), operacao: "erro", erro: parsed });
            continue;
          }
          const { data, error } = await db.rpc("rep_int_upsert_employee", { p_key_hash: tokenHash, p_item: parsed });
          if (error) return failure(error);
          results.push(data);
        }
        return json(200, many ? { resultados: results } : results[0]);
      }
    }

    if (path.includes("/v1/integration/obras")) {
      if (req.method === "GET") {
        const { data, error } = await db.rpc("rep_int_list_sites", { p_key_hash: tokenHash });
        if (error) return failure(error);
        return json(200, { obras: data });
      }
      if (req.method === "POST") {
        const body = await req.json();
        const { data, error } = await db.rpc("rep_int_upsert_site", { p_key_hash: tokenHash, p_item: body ?? {} });
        if (error) return failure(error);
        return json(200, data);
      }
    }

    // Marcacoes: grava com NSR e hash encadeado; reenvios nao duplicam.
    if (req.method === "POST" && path.endsWith("/v1/punches")) {
      const body = await req.json();
      const punches = Array.isArray(body.punches) ? body.punches : [];
      if (punches.length > 500) return json(413, { error: "too_many" });
      const { data, error } = await db.rpc("rep_register_punches", {
        p_token_hash: tokenHash,
        p_punches: punches,
        p_device: deviceOf(body),
      });
      if (error) return failure(error);
      const receipts = data.accepted as Array<{ id: string; nsr: number; hash: string }>;
      return json(200, {
        accepted: receipts.map((r) => r.id),
        receipts,
        rejected: data.rejected,
        server_time_ms: now(),
      });
    }

    // Funcionarios autorizados na obra deste terminal.
    if (req.method === "GET" && path.endsWith("/v1/employees")) {
      const { data, error } = await db.rpc("rep_list_employees", { p_token_hash: tokenHash });
      if (error) return failure(error);
      return json(200, { employees: data, server_time_ms: now() });
    }

    if (req.method === "POST" && path.endsWith("/v1/employees")) {
      const body = await req.json();
      const employees = Array.isArray(body.employees) ? body.employees : [];
      if (employees.length > 1000) return json(413, { error: "too_many" });
      const { data, error } = await db.rpc("rep_upsert_employees", {
        p_token_hash: tokenHash,
        p_employees: employees,
      });
      if (error) return failure(error);
      return json(200, { saved: data, server_time_ms: now() });
    }

    // Dados do empregador, da obra e do responsavel (usados no AFD e no AEJ).
    if (req.method === "GET" && path.endsWith("/v1/employer")) {
      const { data, error } = await db.rpc("rep_get_employer", { p_token_hash: tokenHash });
      if (error) return failure(error);
      return json(200, { employer: data, server_time_ms: now() });
    }

    if (req.method === "POST" && path.endsWith("/v1/employer")) {
      const body = await req.json();
      const { data, error } = await db.rpc("rep_set_employer", {
        p_token_hash: tokenHash,
        p_data: body.employer ?? {},
      });
      if (error) return failure(error);
      return json(200, { employer: data, server_time_ms: now() });
    }

    // Arquivos fiscais da obra do terminal: AFD ou AEJ, no periodo informado.
    if (req.method === "POST" && path.endsWith("/v1/fiscal")) {
      const body = await req.json();
      const kind = String(body.kind ?? "");
      const from = String(body.from ?? "");
      const to = String(body.to ?? "");
      if (!["afd", "aej"].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return json(400, { error: "invalid_period" });
      }
      const { data, error } = await db.rpc("rep_fiscal_data", {
        p_token_hash: tokenHash,
        p_from: from,
        p_to: to,
      });
      if (error) return failure(error);
      try {
        const file = kind === "afd"
          ? await buildAfd(data.head, data.afd, from, to)
          : buildAej(data.head, data.marks, data.employees, from, to);
        let binary = "";
        for (const b of file.bytes) binary += String.fromCharCode(b);
        return json(200, {
          filename: file.filename,
          content_base64: btoa(binary),
          records: file.records,
          warnings: file.warnings,
          server_time_ms: now(),
        });
      } catch (e) {
        if (e instanceof FiscalError) return json(400, { error: e.message });
        throw e;
      }
    }

    return json(404, { error: "not_found" });
  } catch (e) {
    console.error("rep exception:", e instanceof Error ? e.message : String(e));
    return json(400, { error: "bad_request" });
  }
});
