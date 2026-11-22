// Servico REP-P: API usada pelos tablets (coletores).
// Autenticacao propria: cada terminal tem um token, guardado no banco so como hash.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAej, buildAfd, FiscalError } from "./fiscal.ts";
import { closingRow, computeAll, type TimesheetData } from "./jornada.ts";

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

const hexToBytes = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

/** Confere a senha de ponto contra o "sal:hash" guardado (mesmo formato do tablet). */
async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = (stored ?? "").split(":");
  if (!saltHex || !hashHex) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: 120_000 },
    key,
    256,
  ));
  const expected = hexToBytes(hashHex);
  if (expected.length !== bits.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

function parseBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return !(s === "" || s === "false" || s === "nao" || s === "não" || s === "0" || s === "no");
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
    "cpf_required", "period_closed", "period_not_finished", "previous_open", "not_found",
  ]) {
    if (message.includes(code)) return json(400, { error: code });
  }
  console.error("rep error:", message);
  return json(500, { error: "server_error" });
}

// Usuario do portal identificado pelo token de sessao.
async function portalCaller(req: Request): Promise<{ id: string; company: string; role: string } | null> {
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: pu } = await db.from("portal_users").select("company_id, role").eq("user_id", data.user.id)
    .maybeSingle();
  return pu ? { id: data.user.id, company: pu.company_id, role: pu.role } : null;
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

    // Portal: primeiro acesso de um funcionario que o Bubble liberou (perfil_portal).
    // Sem servidor de e-mail, a identidade e confirmada com e-mail + CPF + senha de ponto.
    if (req.method === "POST" && path.endsWith("/v1/portal/first-access")) {
      const body = await req.json();
      const email = String(body.email ?? "").trim().toLowerCase();
      const cpf = String(body.cpf ?? "").replace(/\D/g, "");
      const pin = String(body.pin ?? "");
      const password = String(body.password ?? "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "invalid_email" });
      if (cpf.length !== 11) return json(400, { error: "invalid_cpf" });
      if (password.length < 8) return json(400, { error: "weak_password" });
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count: fails } = await db.from("portal_access_attempts").select("id", { count: "exact", head: true })
        .eq("cpf", cpf).eq("ok", false).gte("at", since);
      if ((fails ?? 0) >= 5) return json(429, { error: "too_many_attempts" });
      const { data: rows } = await db.from("employees")
        .select("company_id, cpf, name, email, pin_hash, portal_role, active").eq("cpf", cpf);
      const emp = (rows ?? []).find((e) => e.active && e.portal_role !== "" && (e.email ?? "").toLowerCase() === email);
      const ok = !!emp && emp.pin_hash !== "" && /^\d{4,8}$/.test(pin) && await verifyPin(pin, emp.pin_hash);
      await db.from("portal_access_attempts").insert({ cpf, ok });
      if (!ok || !emp) return json(403, { error: "not_recognized" });
      const { data: existing } = await db.from("portal_users").select("user_id").eq("company_id", emp.company_id)
        .eq("cpf", cpf).maybeSingle();
      let userId = (await db.rpc("rep_auth_user_by_email", { p_email: email })).data as string | null;
      if (userId) {
        const { data: linked } = await db.from("portal_users").select("user_id").eq("user_id", userId).maybeSingle();
        if (linked) return json(409, { error: "already_active" });
        const up = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
        if (up.error) return json(400, { error: "signup_failed" });
      } else {
        const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error || !created.data.user) return json(400, { error: "signup_failed" });
        userId = created.data.user.id;
      }
      if (existing && existing.user_id !== userId) return json(409, { error: "already_active" });
      const { error } = await db.from("portal_users").insert({
        user_id: userId, company_id: emp.company_id, role: emp.portal_role, cpf,
      });
      if (error) return json(400, { error: "signup_failed" });
      await db.from("audit_log").insert({
        actor: "portal:" + email, action: "primeiro_acesso_portal", detail: { cpf, role: emp.portal_role },
      });
      return json(200, { ok: true });
    }

    // Portal: administrador cria um usuario (RH ou administrador) da mesma empresa.
    // Quem chama se identifica com o token de sessao do portal.
    if (req.method === "POST" && path.endsWith("/v1/portal/users")) {
      const header = req.headers.get("Authorization") ?? "";
      const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const { data: caller } = await db.auth.getUser(jwt);
      if (!caller?.user) return json(401, { error: "invalid_token" });
      const body = await req.json();
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "rh");
      const cpf = String(body.cpf ?? "").replace(/\D/g, "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "invalid_email" });
      if (password.length < 8) return json(400, { error: "weak_password" });
      if (role !== "admin" && role !== "rh") return json(400, { error: "missing_fields" });
      if (cpf !== "" && cpf.length !== 11) return json(400, { error: "invalid_cpf" });
      const { data: me } = await db.from("portal_users").select("role").eq("user_id", caller.user.id).maybeSingle();
      if (me?.role !== "admin") return json(403, { error: "not_allowed" });
      const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) {
        const msg = created.error?.message ?? "";
        return json(400, { error: /already|registered|exists/i.test(msg) ? "email_exists" : "signup_failed" });
      }
      const { error } = await db.rpc("portal_user_attach", {
        p_admin: caller.user.id, p_user: created.data.user.id, p_role: role, p_cpf: cpf,
      });
      if (error) {
        await db.auth.admin.deleteUser(created.data.user.id);
        return failure(error);
      }
      return json(200, { ok: true });
    }

    // Portal: fechamento do periodo. O calculo e refeito aqui, com as mesmas regras da tela,
    // e o resultado de cada dia fica gravado (Espelho, AEJ e Bubble usam este resultado).
    if (req.method === "POST" && path.endsWith("/v1/portal/periods/close")) {
      const caller = await portalCaller(req);
      if (!caller) return json(401, { error: "invalid_token" });
      const body = await req.json();
      const start = String(body.start ?? "");
      const end = String(body.end ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return json(400, { error: "invalid_period" });
      }
      const { data, error } = await db.rpc("rep_timesheet_data", {
        p_company: caller.company, p_from: start, p_to: end, p_cpf: "",
      });
      if (error) return failure(error);
      const sheets = computeAll(data as TimesheetData);
      const days = sheets.flatMap((sh) => sh.days.map(closingRow));
      const { error: closeError } = await db.rpc("rep_period_close", {
        p_user: caller.id, p_start: start, p_end: end, p_days: days,
      });
      if (closeError) return failure(closeError);
      return json(200, {
        ok: true,
        employees: sheets.length,
        days: days.length,
        pending_days: sheets.reduce((x, sh) => x + sh.totals.pending_days, 0),
      });
    }

    // Portal: fechamento de um funcionario no periodo (antes ou sem o fechamento da empresa).
    if (req.method === "POST" && path.endsWith("/v1/portal/periods/close-employee")) {
      const caller = await portalCaller(req);
      if (!caller) return json(401, { error: "invalid_token" });
      const body = await req.json();
      const start = String(body.start ?? "");
      const end = String(body.end ?? "");
      const cpf = String(body.cpf ?? "").replace(/\D/g, "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || cpf.length !== 11) {
        return json(400, { error: "invalid_period" });
      }
      const { data, error } = await db.rpc("rep_timesheet_data", {
        p_company: caller.company, p_from: start, p_to: end, p_cpf: cpf,
      });
      if (error) return failure(error);
      const sheets = computeAll(data as TimesheetData).filter((sh) => sh.cpf === cpf);
      if (sheets.length === 0) return json(400, { error: "not_found" });
      const days = sheets[0].days.map(closingRow);
      const { error: closeError } = await db.rpc("rep_employee_close", {
        p_user: caller.id, p_cpf: cpf, p_start: start, p_end: end, p_days: days,
      });
      if (closeError) return failure(closeError);
      return json(200, { ok: true, days: days.length, pending_days: sheets[0].totals.pending_days });
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
          // Jornada opcional: codigo cadastrado no portal, valendo a partir de jornada_inicio (ou hoje).
          const code = item?.jornada === undefined || item?.jornada === null ? "" : String(item.jornada).trim();
          if (code !== "" && data?.operacao !== "erro") {
            const from = /^\d{4}-\d{2}-\d{2}$/.test(String(item?.jornada_inicio ?? ""))
              ? String(item.jornada_inicio)
              : null;
            const r = await db.rpc("rep_int_set_schedule", {
              p_key_hash: tokenHash, p_cpf: String(item?.cpf ?? ""), p_code: code, p_from: from,
            });
            results.push({ ...data, jornada: r.error ? "erro" : r.data });
          } else {
            results.push(data);
          }
          // Perfis: acesso ao portal (admin | rh) e responsavel pelo tablet.
          const roles: Record<string, unknown> = {};
          if (item && "perfil_portal" in item) roles.perfil_portal = String(item.perfil_portal ?? "").trim().toLowerCase();
          if (item && "responsavel_tablet" in item) roles.responsavel_tablet = parseBool(item.responsavel_tablet);
          if (Object.keys(roles).length > 0 && data?.operacao !== "erro") {
            const r = await db.rpc("rep_int_set_roles", { p_key_hash: tokenHash, p_cpf: String(item?.cpf ?? ""), p_item: roles });
            const last = results[results.length - 1] as Record<string, unknown>;
            results[results.length - 1] = { ...last, perfis: r.error ? { erro: "erro" } : r.data };
          }
          // Contrato: admissao e desligamento (AAAA-MM-DD ou vazio para limpar).
          const dates: Record<string, string> = {};
          for (const k of ["admissao", "desligamento"]) {
            if (item && k in item) {
              const v = String(item[k] ?? "").trim();
              if (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
              dates[k] = v;
            }
          }
          if (Object.keys(dates).length > 0 && data?.operacao !== "erro") {
            const r = await db.rpc("rep_int_set_dates", { p_key_hash: tokenHash, p_cpf: String(item?.cpf ?? ""), p_item: dates });
            const last = results[results.length - 1] as Record<string, unknown>;
            results[results.length - 1] = { ...last, contrato: r.error ? "erro" : "ok" };
          }
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

    // Aviso de campo do responsavel do tablet para o RH.
    if (req.method === "POST" && path.endsWith("/v1/notices")) {
      const body = await req.json();
      const notices = Array.isArray(body.notices) ? body.notices : [body];
      const ids: string[] = [];
      for (const n of notices.slice(0, 100)) {
        const { data, error } = await db.rpc("rep_notice_add", { p_token_hash: tokenHash, p: n ?? {} });
        if (error) return failure(error);
        ids.push(String(n?.client_id ?? data));
      }
      return json(200, { accepted: ids, server_time_ms: now() });
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
