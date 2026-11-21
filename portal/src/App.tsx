import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { API_BASE, formatDateTime, rpc, signupAdmin, supabase, type Me, type Summary } from "./api";

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

type Page = "home" | "integration";

function Portal({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState(false);
  const [page, setPage] = useState<Page>("home");

  const loadMe = () =>
    rpc<Me | null>("portal_me")
      .then((m) => (m ? setMe(m) : setDenied(true)))
      .catch(() => setDenied(true));

  useEffect(() => {
    loadMe();
  }, []);

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

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">{me.company}</div>
            <div className="muted small">Ponto Totem · Portal</div>
          </div>
        </div>
        <nav>
          <button className={page === "home" ? "tab active" : "tab"} onClick={() => setPage("home")}>Início</button>
          {me.role === "admin" && (
            <button className={page === "integration" ? "tab active" : "tab"} onClick={() => setPage("integration")}>
              Integração
            </button>
          )}
        </nav>
        <div className="topbar-right">
          <span className="muted small">{me.email}</span>
          <button className="ghost small" onClick={toggleTheme}>{theme === "dark" ? "Tema claro" : "Tema escuro"}</button>
          <button className="ghost small" onClick={signOut}>Sair</button>
        </div>
      </header>
      <main>
        {page === "home" ? <Home /> : <Integration me={me} onChanged={loadMe} />}
      </main>
    </div>
  );
}

function Home() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    rpc<Summary>("portal_summary").then(setSummary).catch(() => setError("Não foi possível carregar o resumo."));
  }, []);

  if (error) return <div className="banner error">{error}</div>;
  if (!summary) return <p className="muted">Carregando</p>;

  return (
    <>
      <h1>Início</h1>
      <p className="muted lead">Visão geral dos tablets, funcionários e marcações da empresa.</p>
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
          <span className="muted small">Última marcação: {formatDateTime(summary.last_punch_at)}</span>
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
                  <th>Aparelho</th>
                  <th>Última comunicação</th>
                </tr>
              </thead>
              <tbody>
                {summary.terminals.map((t) => (
                  <tr key={t.code}>
                    <td className="strong">{t.code}</td>
                    <td>{t.site || <span className="muted">Sem obra</span>}</td>
                    <td>{t.responsible || <span className="muted">Não informado</span>}</td>
                    <td>{t.model || <span className="muted">Não informado</span>}</td>
                    <td>{formatDateTime(t.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card soft">
        <h2>Próximas etapas</h2>
        <p className="muted">
          Consulta de marcações, tratamento, fechamento de período, Espelho de Ponto, AFD e AEJ chegam nas
          próximas versões do portal.
        </p>
      </section>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value.toLocaleString("pt-BR")}</div>
      {note && <div className="muted small">{note}</div>}
    </div>
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
      <h1>Integração</h1>
      <p className="muted lead">
        Chave usada pelo Bubble ou pelo n8n para cadastrar funcionários e, nas próximas etapas, buscar a jornada
        tratada.
      </p>

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
