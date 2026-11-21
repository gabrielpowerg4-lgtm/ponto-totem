import { useEffect, useMemo, useState } from "react";
import {
  download, errorText, FACE_LABEL, faceOk, formatCpf, formatDate, formatDateTime, formatTime, rpc, todayIso,
  type Employee, type Punch, type PunchFilter, type Site, type Terminal,
} from "../api";
import { Badge, Banner, Empty, Loading, PageHead } from "../ui";

const PAGE = 100;

function firstOfMonth(today: string) {
  return today.slice(0, 8) + "01";
}

export default function Punches() {
  const today = todayIso();
  const [filter, setFilter] = useState<PunchFilter>({ from: firstOfMonth(today), to: today });
  const [applied, setApplied] = useState<PunchFilter>(filter);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Punch[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [person, setPerson] = useState("");

  useEffect(() => {
    rpc<Employee[]>("portal_employees").then(setEmployees).catch(() => undefined);
    rpc<Terminal[]>("portal_terminals").then(setTerminals).catch(() => undefined);
    rpc<Site[]>("portal_sites").then(setSites).catch(() => undefined);
  }, []);

  useEffect(() => {
    setRows(null);
    setError("");
    rpc<{ total: number; rows: Punch[] }>("portal_punches", { p: { ...applied, limit: PAGE, offset: page * PAGE } })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch((e) => setError(errorText(e, "Não foi possível carregar as marcações.")));
  }, [applied, page]);

  // Funcionario: aceita nome ou CPF digitado; resolve para o CPF.
  const options = useMemo(
    () => employees.map((e) => ({ label: `${e.name} · ${formatCpf(e.cpf)}`, cpf: e.cpf })),
    [employees],
  );
  const resolveCpf = (text: string) => {
    const match = options.find((o) => o.label === text);
    if (match) return match.cpf;
    return text.replace(/\D/g, "");
  };

  const set = (k: keyof PunchFilter, v: string) => setFilter((f) => ({ ...f, [k]: v }));

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    const cpf = resolveCpf(person);
    if (cpf !== "" && cpf.length !== 11) {
      setError("Escolha um funcionário da lista ou informe o CPF completo.");
      return;
    }
    setPage(0);
    setApplied({ ...filter, cpf });
  };

  const clear = () => {
    const f = { from: firstOfMonth(today), to: today };
    setFilter(f);
    setPerson("");
    setPage(0);
    setApplied(f);
  };

  const exportCsv = async () => {
    setExporting(true);
    setError("");
    try {
      const all: Punch[] = [];
      for (let offset = 0; ; offset += 5000) {
        const r = await rpc<{ total: number; rows: Punch[] }>("portal_punches", {
          p: { ...applied, limit: 5000, offset },
        });
        all.push(...r.rows);
        if (all.length >= r.total || r.rows.length === 0) break;
      }
      const esc = (v: unknown) => {
        const s = String(v ?? "");
        return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = [
        "NSR", "Data", "Hora", "CPF", "Nome", "Tablet", "Obra", "Origem", "Validação facial",
        "Recebida pelo servidor", "Latitude", "Longitude", "Precisão (m)", "Hash",
      ];
      const lines = all.map((p) => [
        p.nsr, formatDate(p.marked_at), formatTime(p.marked_at), formatCpf(p.cpf), p.name, p.terminal,
        p.site, p.online ? "On-line" : "Off-line", FACE_LABEL[p.face_status] ?? p.face_status,
        formatDateTime(p.recorded_at), p.lat ?? "", p.lng ?? "", p.accuracy_m ?? "", p.hash,
      ].map(esc).join(";"));
      download(`marcacoes_${applied.from}_${applied.to}.csv`, "﻿" + [head.join(";"), ...lines].join("\r\n"));
    } catch (e) {
      setError(errorText(e, "Não foi possível exportar."));
    }
    setExporting(false);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <PageHead
        title="Marcações"
        lead="Marcações originais gravadas pelos tablets. Elas não podem ser alteradas nem excluídas; ajustes serão feitos no tratamento."
        actions={
          <button className="ghost" onClick={exportCsv} disabled={exporting || total === 0}>
            {exporting ? "Exportando" : "Exportar CSV"}
          </button>
        }
      />

      <form className="card filters" onSubmit={apply}>
        <label>
          De
          <input type="date" value={filter.from} max={filter.to} onChange={(e) => set("from", e.target.value)} required />
        </label>
        <label>
          Até
          <input type="date" value={filter.to} min={filter.from} onChange={(e) => set("to", e.target.value)} required />
        </label>
        <label className="wide">
          Funcionário
          <input
            list="employees-list"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="Nome ou CPF"
          />
          <datalist id="employees-list">
            {options.map((o) => <option key={o.cpf} value={o.label} />)}
          </datalist>
        </label>
        <label>
          Tablet
          <select value={filter.terminal_id ?? ""} onChange={(e) => set("terminal_id", e.target.value)}>
            <option value="">Todos</option>
            {terminals.map((t) => <option key={t.id} value={t.id}>{t.code}{t.active ? "" : " (desativado)"}</option>)}
          </select>
        </label>
        <label>
          Obra
          <select value={filter.site_id ?? ""} onChange={(e) => set("site_id", e.target.value)}>
            <option value="">Todas</option>
            <option value="none">Sem obra</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>
          Origem
          <select value={filter.online ?? ""} onChange={(e) => set("online", e.target.value)}>
            <option value="">Todas</option>
            <option value="online">On-line</option>
            <option value="offline">Off-line</option>
          </select>
        </label>
        <label>
          Validação facial
          <select value={filter.face ?? ""} onChange={(e) => set("face", e.target.value)}>
            <option value="">Todas</option>
            <option value="ok">Conferida</option>
            <option value="flagged">Com alerta</option>
          </select>
        </label>
        <div className="filter-actions">
          <button className="primary" type="submit">Filtrar</button>
          <button className="ghost" type="button" onClick={clear}>Limpar</button>
        </div>
      </form>

      {error && <Banner tone="error">{error}</Banner>}

      <section className="card">
        <div className="card-head">
          <h2>{total.toLocaleString("pt-BR")} marcaç{total === 1 ? "ão" : "ões"}</h2>
          <span className="muted small">
            {formatDate(applied.from + "T12:00:00Z")} a {formatDate(applied.to + "T12:00:00Z")}
          </span>
        </div>
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>Nenhuma marcação com estes filtros.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">NSR</th>
                  <th>Data e hora</th>
                  <th>Funcionário</th>
                  <th>Tablet</th>
                  <th>Obra</th>
                  <th>Origem</th>
                  <th>Validação facial</th>
                  <th>Local</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.nsr}>
                    <td className="num muted">{p.nsr}</td>
                    <td className="nowrap">
                      <span className="strong">{formatTime(p.marked_at)}</span>{" "}
                      <span className="muted">{formatDate(p.marked_at)}</span>
                    </td>
                    <td>
                      <div className="strong">{p.name || "Não cadastrado"}</div>
                      <div className="muted small">{formatCpf(p.cpf)}</div>
                    </td>
                    <td>{p.terminal}</td>
                    <td>{p.site || <span className="muted">Sem obra</span>}</td>
                    <td>
                      {p.online ? <Badge tone="neutral">On-line</Badge> : (
                        <span title={`Recebida em ${formatDateTime(p.recorded_at)}`}>
                          <Badge tone="warn">Off-line</Badge>
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge tone={faceOk(p.face_status) ? "ok" : "error"}>
                        {FACE_LABEL[p.face_status] ?? p.face_status}
                      </Badge>
                    </td>
                    <td className="nowrap">
                      {p.lat != null && p.lng != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver no mapa
                        </a>
                      ) : (
                        <span className="muted">Sem localização</span>
                      )}
                      {p.accuracy_m != null && <div className="muted small">± {Math.round(p.accuracy_m)} m</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="pager">
            <button className="ghost small" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <span className="muted small">Página {page + 1} de {pages}</span>
            <button className="ghost small" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Próxima</button>
          </div>
        )}
      </section>
    </>
  );
}
