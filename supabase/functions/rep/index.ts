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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
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
    "invalid_responsible_cpf", "invalid_schedule", "invalid_period",
  ]) {
    if (message.includes(code)) return json(400, { error: code });
  }
  console.error("rep error:", message);
  return json(500, { error: "server_error" });
}

Deno.serve(async (req: Request) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const now = () => Date.now();

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

    const tokenHash = await bearerHash(req);
    if (!tokenHash) return json(401, { error: "invalid_token" });

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
