import { useEffect, useMemo, useState } from "react";
import { br, download, fiscalFile, todayIso, type FiscalResult } from "../api";
import { Banner, Empty, Loading, PageHead } from "../ui";
import { PeriodSelect, usePeriods } from "./Treatment";

// Arquivos fiscais da Portaria 671: AFD (registro bruto do REP-P) e AEJ (jornada tratada, so periodo fechado).

const TEXT = {
  afd: {
    title: "AFD · Arquivo Fonte de Dados",
    lead: "Registro integral do REP-P: marcações originais, cadastro do empregador e dos funcionários, com o NSR. " +
      "Não muda com o tratamento. Entregue à fiscalização quando solicitado.",
  },
  aej: {
    title: "AEJ · Arquivo Eletrônico de Jornada",
    lead: "Jornada tratada do período fechado: horários contratuais, marcações (originais, incluídas e desconsideradas), " +
      "ausências e movimentos do banco de horas.",
  },
};

function bytesOf(base64: string) {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default function Fiscal({ kind }: { kind: "afd" | "aej" }) {
  const { periods, error: periodError } = usePeriods();
  const closed = useMemo(() => (periods ?? []).filter((p) => p.closed || (p.employees_closed ?? 0) > 0), [periods]);
  const [start, setStart] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FiscalResult | null>(null);

  useEffect(() => {
    if (!periods) return;
    if (kind === "aej" && !start && closed.length) setStart(closed[0].start);
    if (kind === "afd" && !from) setFrom((periods.find((p) => p.current) ?? periods[0])?.start ?? todayIso());
  }, [periods, closed, kind]);
  useEffect(() => { setResult(null); setError(""); }, [kind, start, from, to]);

  const period = closed.find((p) => p.start === start) ?? null;
  const range = kind === "aej" ? (period ? { from: period.start, to: period.end } : null) : (from && to ? { from, to } : null);

  const generate = async () => {
    if (!range) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await fiscalFile(kind, range.from, range.to);
      download(r.filename, new Blob([bytesOf(r.content_base64)], { type: "text/plain;charset=iso-8859-1" }));
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar o arquivo.");
    }
    setBusy(false);
  };

  return (
    <>
      <PageHead title={TEXT[kind].title} lead={TEXT[kind].lead} />
      {(periodError || error) && <Banner tone="error">{periodError || error}</Banner>}
      {!periods ? <Loading /> : kind === "aej" && closed.length === 0 ? (
        <Empty>Nenhum período fechado ainda. O AEJ fica disponível depois do fechamento.</Empty>
      ) : (
        <section className="card">
          {kind === "aej" ? (
            <PeriodSelect periods={closed} value={start} onChange={setStart} />
          ) : (
            <div className="filters">
              <label>
                De
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                Até
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="primary" disabled={busy || !range} onClick={generate}>
              {busy ? "Gerando" : `Gerar e baixar ${kind.toUpperCase()}`}
            </button>
            {range && <span className="muted small">{br(range.from)} a {br(range.to)}</span>}
          </div>
          {kind === "aej" && period && !period.closed && (
            <p className="muted small">
              O período da empresa ainda está aberto: entram só os funcionários fechados individualmente.
            </p>
          )}
        </section>
      )}
      {result && (
        <>
          <Banner tone="ok">
            {result.filename} baixado: {result.records} {kind === "afd" ? "registro(s)" : "marcação(ões)"}
            {result.employees !== undefined ? ` de ${result.employees} funcionário(s)` : ""}.
          </Banner>
          {result.warnings.length > 0 && (
            <section className="card">
              <h2>Avisos</h2>
              <ul className="small">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
