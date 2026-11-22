import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { errorText } from "./api";

/** Carrega dados e devolve [dados, erro, recarregar, definir]. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setError("");
    load().then(setData).catch((e) => setError(errorText(e, "Não foi possível carregar.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload, setData };
}

export function PageHead({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-bar">
        <span className="page-grid" aria-hidden="true"><i /><i /><i /><i /></span>
        <h1>{title}</h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {lead && <p className="muted page-lead">{lead}</p>}
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value.toLocaleString("pt-BR")}</div>
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "ok" | "warn" | "error" | "neutral"; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Banner({ tone, children }: { tone: "ok" | "warn" | "error"; children: ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>;
}

export function Loading() {
  return <p className="muted">Carregando</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted empty">{children}</p>;
}

// ---------------------------------------------------------------------------
// Caixa para pedir um texto (motivo). Substitui window.prompt, que nao funciona em todos os navegadores
// (o navegador do aplicativo desktop, por exemplo, nao exibe prompt).
// ---------------------------------------------------------------------------

type AskOptions = { optional?: boolean; min?: number; placeholder?: string; confirmLabel?: string; title?: string };

function AskDialog({ message, opts, done }: { message: string; opts: AskOptions; done: (v: string | null) => void }) {
  const [value, setValue] = useState("");
  const min = opts.optional ? 0 : opts.min ?? 3;
  const ok = value.trim().length >= min;
  return (
    <div className="ask-scrim" onClick={() => done(null)}>
      <form className="ask-box" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (ok) done(value.trim()); }}>
        <h2>{opts.title ?? "Informe o motivo"}</h2>
        <p>{message}</p>
        <textarea autoFocus rows={3} value={value} placeholder={opts.placeholder ?? "Escreva aqui"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (ok) done(value.trim()); } if (e.key === "Escape") done(null); }} />
        {!opts.optional && <span className="hint">Pelo menos {min} letras. Fica registrado na auditoria.</span>}
        <div className="ask-actions">
          <button type="button" className="ghost" onClick={() => done(null)}>Cancelar</button>
          <button type="submit" className="primary" disabled={!ok}>{opts.confirmLabel ?? "Confirmar"}</button>
        </div>
      </form>
    </div>
  );
}

/** Pede um texto ao usuario. Devolve null se cancelar. */
export function askText(message: string, opts: AskOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<AskDialog message={message} opts={opts} done={done} />);
  });
}

function ConfirmDialog({ message, title, confirmLabel, done }: {
  message: string; title: string; confirmLabel: string; done: (v: boolean) => void;
}) {
  return (
    <div className="ask-scrim" onClick={() => done(false)}>
      <form className="ask-box" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); done(true); }}
        onKeyDown={(e) => { if (e.key === "Escape") done(false); }}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="ask-actions">
          <button type="button" className="ghost" onClick={() => done(false)}>Cancelar</button>
          <button type="submit" className="primary" autoFocus>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

/** Confirmacao dentro do portal (o navegador do app desktop nao mostra window.confirm). */
export function askConfirm(message: string, opts: { title?: string; confirmLabel?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: boolean) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<ConfirmDialog message={message} title={opts.title ?? "Confirmar"} confirmLabel={opts.confirmLabel ?? "Confirmar"} done={done} />);
  });
}
