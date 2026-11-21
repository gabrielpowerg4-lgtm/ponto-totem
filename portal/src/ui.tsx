import { useCallback, useEffect, useState, type ReactNode } from "react";
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
      <div>
        <h1>{title}</h1>
        {lead && <p className="muted">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
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
