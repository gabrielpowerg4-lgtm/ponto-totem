import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { API_BASE, firstAccess, formatDateTime, rpc, setTimezone, signupAdmin, supabase, type Me, type Summary } from "./api";
import { PageHead, Stat } from "./ui";
import Punches from "./pages/Punches";
import { Employees, Sites, Terminals } from "./pages/Registers";
import { Account, CompanyPage, RulesPage, Users } from "./pages/Admin";
import Schedules, { Holidays } from "./pages/Schedules";
import { Audit, HourBank } from "./pages/Reports";
import Treatment from "./pages/Treatment";
import Closing from "./pages/Closing";

type Theme = "light" | "dark";

function useTheme(): [Theme, () => void] {
  const initial = (): Theme => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Sem armazenamento: o tema volta ao padrao na proxima visita.
    }
  }, [theme]);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")];
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="white" strokeWidth="2.5" />
      <path d="M16 11v5l3.5 2.5" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="center muted">Carregando</div>;
  return session ? (
    <Portal theme={theme} toggleTheme={toggleTheme} />
  ) : (
    <Auth theme={theme} toggleTheme={toggleTheme} />
  );
}

// ---------------------------------------------------------------------------
// Entrada e primeiro acesso
// ---------------------------------------------------------------------------

function Auth({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const [mode, setMode] = useState<"login" | "employee" | "company">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [companyKey, setCompanyKey] = useState("");
  const [cpf, setCpf] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode !== "login" && password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "company") await signupAdmin(email.trim(), password, companyKey.trim());
      if (mode === "employee") await firstAccess({ email: email.trim(), cpf, pin, password });
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw new Error("E-mail ou senha incorretos.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    }
    setBusy(false);
  };

  const switchTo = (m: typeof mode) => {
    setMode(m);
    setError("");
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">Ponto Totem</div>
            <div className="muted small">Portal de tratamento do ponto</div>
          </div>
          <button className="ghost small" onClick={toggleTheme} type="button">
            {theme === "dark" ? "Tema claro" : "Tema escuro"}
          </button>
        </div>
        <h1>{mode === "login" ? "Entrar" : mode === "employee" ? "Primeiro acesso" : "Primeiro administrador"}</h1>
        {mode === "employee" && (
          <p className="muted">
            Para quem a empresa liberou o acesso ao portal. Confirme seus dados com a senha que você usa para marcar o
            ponto no tablet e crie a senha do portal.
          </p>
        )}
        {mode === "company" && (
          <p className="muted">
            Só para a primeira conta da empresa. Use a chave da empresa, a mesma que vincula os tablets.
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            E-mail
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {mode === "employee" && (
            <div className="grid-2">
              <label>
                CPF
                <input inputMode="numeric" value={cpf} placeholder="11 números"
                  onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))} required minLength={11} />
              </label>
              <label>
                Senha de ponto
                <input type="password" inputMode="numeric" autoComplete="off" value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} required minLength={4} />
              </label>
            </div>
          )}
          <label>
            {mode === "login" ? "Senha" : "Nova senha do portal"}
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "login" ? undefined : 8}
            />
          </label>
          {mode !== "login" && (
            <label>
              Confirme a senha
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
          )}
          {mode === "company" && (
            <label>
              Chave da empresa
              <input value={companyKey} onChange={(e) => setCompanyKey(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX" autoComplete="off" required />
            </label>
          )}
          {error && <div className="banner error">{error}</div>}
          <button className="primary" disabled={busy} type="submit">
            {busy ? "Aguarde" : mode === "login" ? "Entrar" : "Criar senha e entrar"}
          </button>
        </form>
        <div className="auth-links">
          {mode !== "login" && <button className="link" type="button" onClick={() => switchTo("login")}>Já tenho senha do portal</button>}
          {mode !== "employee" && <button className="link" type="button" onClick={() => switchTo("employee")}>Primeiro acesso de funcionário</button>}
          {mode !== "company" && <button className="link small muted-link" type="button" onClick={() => switchTo("company")}>Primeira conta da empresa</button>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------

type Page = "home" | "punches" | "treatment" | "pending" | "closing" | "bank" | "mirror" | "afd" | "aej" |
  "report" | "audit" | "employees" | "schedules" | "holidays" | "sites" | "terminals" | "company" | "rules" |
  "users" | "integration" | "account";

type Item = { page: Page; label: string; admin?: boolean; soon?: boolean };
type Group = { id: string; label: string; admin?: boolean; items: Item[] };

const GROUPS: Group[] = [
  { id: "ponto", label: "Ponto", items: [
    { page: "punches", label: "Marcações" },
    { page: "treatment", label: "Tratamento" },
    { page: "pending", label: "Pendências" },
    { page: "closing", label: "Fechamento" },
    { page: "bank", label: "Banco de horas" },
  ] },
  { id: "relatorios", label: "Relatórios e arquivos", items: [
    { page: "mirror", label: "Espelho de Ponto", soon: true },
    { page: "afd", label: "AFD", soon: true },
    { page: "aej", label: "AEJ", soon: true },
    { page: "report", label: "Apuração do período" },
    { page: "audit", label: "Auditoria", admin: true },
  ] },
  { id: "cadastros", label: "Cadastros", items: [
    { page: "employees", label: "Funcionários" },
    { page: "schedules", label: "Jornadas" },
    { page: "holidays", label: "Feriados" },
    { page: "sites", label: "Obras" },
    { page: "terminals", label: "Tablets" },
  ] },
  { id: "config", label: "Configurações", admin: true, items: [
    { page: "company", label: "Empresa" },
    { page: "rules", label: "Regras de apuração" },
    { page: "users", label: "Usuários e perfis" },
    { page: "integration", label: "Integração (API)" },
  ] },
];

const ALL_PAGES: Page[] = ["home", "account", ...GROUPS.flatMap((g) => g.items.map((i) => i.page))];

function pageFromHash(): Page {
  const h = window.location.hash.replace("#", "").split("?")[0] as Page;
  return ALL_PAGES.includes(h) ? h : "home";
}

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem("menu-open") ?? "{}");
  } catch {
    return {};
  }
}

function Portal({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState(false);
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen);

  const loadMe = () =>
    rpc<Me | null>("portal_me")
      .then((m) => {
        if (!m) return setDenied(true);
        setTimezone(m.timezone);
        setMe(m);
      })
      .catch(() => setDenied(true));

  useEffect(() => {
    loadMe();
    const onHash = () => setPageState(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (p: Page, query = "") => {
    window.location.hash = p + (query ? `?${query}` : "");
    setPageState(p);
    setMenuOpen(false);
  };
  const signOut = () => supabase.auth.signOut();

  const toggleGroup = (id: string) => {
    const next = { ...open, [id]: !isOpen(id) };
    setOpen(next);
    try {
      localStorage.setItem("menu-open", JSON.stringify(next));
    } catch {
      // Sem armazenamento: o menu volta ao padrao na proxima visita.
    }
  };

  if (denied) {
    return (
      <div className="center column">
        <p>Esta conta não tem acesso a nenhuma empresa.</p>
        <button className="ghost" onClick={signOut}>Sair</button>
      </div>
    );
  }
  if (!me) return <div className="center muted">Carregando</div>;

  const admin = me.role === "admin";
  const groups = GROUPS.filter((g) => !g.admin || admin).map((g) => ({
    ...g, items: g.items.filter((i) => !i.admin || admin),
  }));
  const allowed = ["home", "account", ...groups.flatMap((g) => g.items.filter((i) => !i.soon).map((i) => i.page))];
  const current: Page = allowed.includes(page) ? page : "home";
  const currentGroup = groups.find((g) => g.items.some((i) => i.page === current))?.id;
  // Aberto por padrao: o grupo da pagina atual; os demais conforme o usuario deixou.
  function isOpen(id: string) {
    return open[id] ?? (id === currentGroup || id === "ponto");
  }
  const title = current === "home" ? "Início" : current === "account" ? "Minha conta"
    : groups.flatMap((g) => g.items).find((i) => i.page === current)?.label;

  return (
    <div className="layout">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">{me.company}</div>
            <div className="muted small">Ponto Totem</div>
          </div>
        </div>
        <nav>
          <button className={current === "home" ? "nav-item top active" : "nav-item top"} onClick={() => go("home")}>
            Início
          </button>
          {groups.map((g) => (
            <div key={g.id} className="nav-group">
              <button className={currentGroup === g.id ? "nav-head current" : "nav-head"} onClick={() => toggleGroup(g.id)}
                aria-expanded={isOpen(g.id)}>
                <span>{g.label}</span>
                <span className={isOpen(g.id) ? "chev open" : "chev"} aria-hidden="true">›</span>
              </button>
              {isOpen(g.id) && (
                <div className="nav-items">
                  {g.items.map((m) => (
                    <button key={m.page} disabled={m.soon}
                      className={current === m.page ? "nav-item active" : "nav-item"} onClick={() => go(m.page)}>
                      {m.label}{m.soon && <span className="soon">em breve</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className={current === "account" ? "nav-item active" : "nav-item"} onClick={() => go("account")}>
            Minha conta
          </button>
          <div className="muted small ellipsis">{me.email}</div>
          <div className="row">
            <button className="ghost small" onClick={toggleTheme}>{theme === "dark" ? "Tema claro" : "Tema escuro"}</button>
            <button className="ghost small" onClick={signOut}>Sair</button>
          </div>
        </div>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <div className="content">
        <header className="mobilebar">
          <button className="ghost small" onClick={() => setMenuOpen(true)}>Menu</button>
          <span className="strong">{title}</span>
        </header>
        <main>
          {current === "home" && <Home go={go} />}
          {current === "punches" && <Punches />}
          {current === "treatment" && <Treatment me={me} goAccount={() => go("account")} />}
          {current === "pending" && (
            <Closing mode="pending" me={me} openTreatment={(cpf, start) => go("treatment", `cpf=${cpf}&start=${start}`)} />
          )}
          {current === "closing" && (
            <Closing mode="close" me={me} openTreatment={(cpf, start) => go("treatment", `cpf=${cpf}&start=${start}`)} />
          )}
          {current === "report" && (
            <Closing mode="report" me={me} openTreatment={(cpf, start) => go("treatment", `cpf=${cpf}&start=${start}`)} />
          )}
          {current === "bank" && <HourBank />}
          {current === "audit" && <Audit />}
          {current === "employees" && <Employees />}
          {current === "schedules" && <Schedules me={me} />}
          {current === "holidays" && <Holidays />}
          {current === "sites" && <Sites me={me} />}
          {current === "terminals" && <Terminals me={me} />}
          {current === "company" && <CompanyPage me={me} goAccount={() => go("account")} />}
          {current === "rules" && <RulesPage me={me} />}
          {current === "users" && <Users />}
          {current === "integration" && <Integration me={me} onChanged={loadMe} />}
          {current === "account" && <Account me={me} onChanged={loadMe} />}
        </main>
      </div>
    </div>
  );
}

function Home({ go }: { go: (p: Page) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    rpc<Summary>("portal_summary").then(setSummary).catch(() => setError("Não foi possível carregar o resumo."));
  }, []);

  if (error) return <div className="banner error">{error}</div>;
  if (!summary) return <p className="muted">Carregando</p>;

  return (
    <>
      <PageHead title="Início" lead="Visão geral dos tablets, funcionários e marcações da empresa." />
      <div className="stats">
        <Stat label="Marcações hoje" value={summary.punches_today} />
        <Stat label="Marcações no total" value={summary.punches_total} note={`Último NSR: ${summary.last_nsr}`} />
        <Stat
          label="Funcionários ativos"
          value={summary.employees}
          note={summary.employees_without_pin > 0 ? `${summary.employees_without_pin} sem senha de ponto` : undefined}
        />
        <Stat label="Tablets ativos" value={summary.terminals.length} note={`Obras: ${summary.sites}`} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Tablets</h2>
          <button className="link" onClick={() => go("terminals")}>Ver todos</button>
        </div>
        {summary.terminals.length === 0 ? (
          <p className="muted">Nenhum tablet vinculado.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Terminal</th>
                  <th>Obra</th>
                  <th>Responsável</th>
                  <th>Última comunicação</th>
                </tr>
              </thead>
              <tbody>
                {summary.terminals.map((t) => (
                  <tr key={t.code}>
                    <td className="strong">{t.code}</td>
                    <td>{t.site || <span className="muted">Sem obra</span>}</td>
                    <td>{t.responsible || <span className="muted">Não informado</span>}</td>
                    <td>{formatDateTime(t.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Última marcação: {formatDateTime(summary.last_punch_at)}</p>
      </section>

      <section className="card soft">
        <h2>Próximas etapas</h2>
        <p className="muted">
          Espelho de Ponto, AFD e AEJ gerados no portal a partir do período fechado, e a API para o Bubble e o
          n8n buscarem a jornada tratada.
        </p>
      </section>
    </>
  );
}

function Integration({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const generate = async () => {
    const replacing = me.has_integration_key;
    if (replacing && !window.confirm("A chave atual deixará de funcionar no Bubble e no n8n. Gerar uma nova chave?")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const k = await rpc<string>("portal_new_integration_key");
      setKey(k);
      onChanged();
    } catch {
      setError("Não foi possível gerar a chave.");
    }
    setBusy(false);
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  };

  const example = `curl -X POST "${API_BASE}/v1/integration/funcionarios" \\
  -H "Authorization: Bearer SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"cpf":"11144477735","nome":"Ana Souza","email":"ana@empresa.com","obra":"Obra Centro","id_externo":"ID_DO_BUBBLE"}'`;

  return (
    <>
      <PageHead
        title="Integração"
        lead="Chave usada pelo Bubble ou pelo n8n para cadastrar funcionários e, nas próximas etapas, buscar a jornada tratada."
      />

      <section className="card">
        <h2>Chave de integração</h2>
        <p className="muted">
          {me.has_integration_key
            ? "Há uma chave ativa. Por segurança, ela não pode ser exibida de novo: gere outra se precisar."
            : "Nenhuma chave gerada ainda."}
        </p>
        {key && (
          <div className="secret">
            <div className="banner warn">Copie agora: esta chave não será exibida novamente.</div>
            <code>{key}</code>
            <button className="ghost small" onClick={() => copy(key, "key")}>
              {copied === "key" ? "Copiada" : "Copiar chave"}
            </button>
          </div>
        )}
        {error && <div className="banner error">{error}</div>}
        <button className="primary" disabled={busy} onClick={generate}>
          {busy ? "Gerando" : me.has_integration_key ? "Gerar nova chave" : "Gerar chave"}
        </button>
      </section>

      <section className="card">
        <h2>Endereço da API</h2>
        <div className="secret">
          <code>{API_BASE}</code>
          <button className="ghost small" onClick={() => copy(API_BASE, "url")}>
            {copied === "url" ? "Copiado" : "Copiar"}
          </button>
        </div>
        <p className="muted small">Envie a chave no cabeçalho Authorization: Bearer SUA_CHAVE.</p>
        <h3>Exemplo: cadastrar ou atualizar um funcionário</h3>
        <pre>{example}</pre>
      </section>
    </>
  );
}
