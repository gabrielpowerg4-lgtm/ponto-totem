import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { API_BASE, formatDateTime, rpc, setTimezone, signupAdmin, supabase, type Me, type Summary } from "./api";
import { PageHead, Stat } from "./ui";
import Punches from "./pages/Punches";
import { Employees, Sites, Terminals } from "./pages/Registers";
import { Account, CompanyPage, Users } from "./pages/Admin";

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
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [companyKey, setCompanyKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (mode === "signup" && password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await signupAdmin(email.trim(), password, companyKey.trim());
        setInfo("Conta criada. Entrando.");
      }
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw new Error("E-mail ou senha incorretos.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    }
    setBusy(false);
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
        <h1>{mode === "login" ? "Entrar" : "Primeiro acesso"}</h1>
        {mode === "signup" && (
          <p className="muted">
            Crie a conta do administrador da empresa. Use a chave da empresa, a mesma que vincula os
            tablets.
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            E-mail
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : undefined}
            />
          </label>
          {mode === "signup" && (
            <>
              <label>
                Confirme a senha
                <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </label>
              <label>
                Chave da empresa
                <input
                  value={companyKey}
                  onChange={(e) => setCompanyKey(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX"
                  autoComplete="off"
                  required
                />
              </label>
            </>
          )}
          {error && <div className="banner error">{error}</div>}
          {info && <div className="banner ok">{info}</div>}
          <button className="primary" disabled={busy} type="submit">
            {busy ? "Aguarde" : mode === "login" ? "Entrar" : "Criar conta e entrar"}
          </button>
        </form>
        <button
          className="link"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Primeiro acesso da empresa" : "Já tenho conta"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------

type Page = "home" | "punches" | "employees" | "sites" | "terminals" | "company" | "users" | "integration" | "account";

const MENU: { page: Page; label: string; admin?: boolean; group: string }[] = [
  { page: "home", label: "Início", group: "Ponto" },
  { page: "punches", label: "Marcações", group: "Ponto" },
  { page: "employees", label: "Funcionários", group: "Cadastros" },
  { page: "sites", label: "Obras", group: "Cadastros" },
  { page: "terminals", label: "Tablets", group: "Cadastros" },
  { page: "company", label: "Empresa", group: "Configurações" },
  { page: "users", label: "Usuários", admin: true, group: "Configurações" },
  { page: "integration", label: "Integração", admin: true, group: "Configurações" },
  { page: "account", label: "Minha conta", group: "Configurações" },
];

function pageFromHash(): Page {
  const h = window.location.hash.replace("#", "") as Page;
  return MENU.some((m) => m.page === h) ? h : "home";
}

function Portal({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState(false);
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const go = (p: Page) => {
    window.location.hash = p;
    setPageState(p);
    setMenuOpen(false);
  };
  const signOut = () => supabase.auth.signOut();

  if (denied) {
    return (
      <div className="center column">
        <p>Esta conta não tem acesso a nenhuma empresa.</p>
        <button className="ghost" onClick={signOut}>Sair</button>
      </div>
    );
  }
  if (!me) return <div className="center muted">Carregando</div>;

  const items = MENU.filter((m) => !m.admin || me.role === "admin");
  const current = items.some((m) => m.page === page) ? page : "home";
  const groups = [...new Set(items.map((m) => m.group))];

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
          {groups.map((g) => (
            <div key={g} className="nav-group">
              <div className="nav-title">{g}</div>
              {items.filter((m) => m.group === g).map((m) => (
                <button key={m.page} className={current === m.page ? "nav-item active" : "nav-item"} onClick={() => go(m.page)}>
                  {m.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
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
          <span className="strong">{items.find((m) => m.page === current)?.label}</span>
        </header>
        <main>
          {current === "home" && <Home go={go} />}
          {current === "punches" && <Punches />}
          {current === "employees" && <Employees />}
          {current === "sites" && <Sites me={me} />}
          {current === "terminals" && <Terminals me={me} />}
          {current === "company" && <CompanyPage me={me} goAccount={() => go("account")} />}
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
          Tratamento das marcações e fechamento do período, depois Espelho de Ponto, AFD e AEJ, e a API para o
          Bubble e o n8n buscarem a jornada tratada.
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
