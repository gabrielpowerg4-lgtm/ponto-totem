import { useMemo, useState } from "react";
import { br, formatCpf, rpc } from "../api";
import { fmtMin } from "../jornada";
import { Banner, Empty, Loading, PageHead, useLoad } from "../ui";
import { Hours } from "./Treatment";

type BankRow = { cpf: string; name: string; active: boolean; balance: number; credits: number; debits: number; last_day: string | null };

/** Banco de horas: saldo dos periodos fechados de cada funcionario. */
export function HourBank() {
  const { data, error } = useLoad(() => rpc<BankRow[]>("portal_hour_bank"));
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "pos" | "neg">("all");
  const list = useMemo(() => (data ?? []).filter((r) => {
    if (only === "pos" && r.balance <= 0) return false;
    if (only === "neg" && r.balance >= 0) return false;
    const q = query.trim().toLowerCase();
    return !q || r.name.toLowerCase().includes(q) || r.cpf.includes(q.replace(/\D/g, "") || "#");
  }), [data, query, only]);
  const total = (data ?? []).reduce((x, r) => x + r.balance, 0);

  return (
    <>
      <PageHead
        title="Banco de horas"
        lead="Saldo acumulado dos períodos fechados. O período em aberto aparece no Tratamento de cada funcionário."
      />
      {error && <Banner tone="error">{error}</Banner>}
      <div className="toolbar">
        <input className="search" placeholder="Buscar por nome ou CPF" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="segmented">
          <button className={only === "all" ? "on" : ""} onClick={() => setOnly("all")}>Todos</button>
          <button className={only === "pos" ? "on" : ""} onClick={() => setOnly("pos")}>Saldo positivo</button>
          <button className={only === "neg" ? "on" : ""} onClick={() => setOnly("neg")}>Saldo negativo</button>
        </div>
      </div>
      {data && <p className="muted small">Saldo total da empresa: {fmtMin(total, true)} · mostrando {list.length}</p>}
      <section className="card flush">
        {!data ? <Loading /> : list.length === 0 ? <Empty>Nenhum saldo. O banco começa a contar no primeiro período fechado.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th className="num">Créditos</th>
                  <th className="num">Débitos</th>
                  <th className="num">Saldo</th>
                  <th>Até</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.cpf} className={r.active ? "" : "dim"}>
                    <td>
                      <div className="strong">{r.name}</div>
                      <div className="muted small">{formatCpf(r.cpf)}{r.active ? "" : " · desligado"}</div>
                    </td>
                    <td className="num">{fmtMin(r.credits)}</td>
                    <td className="num">{fmtMin(-r.debits)}</td>
                    <td className="num"><Hours value={r.balance} signed /></td>
                    <td className="nowrap">{r.last_day ? br(r.last_day) : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

type AuditRow = { id: number; at: string; actor: string; action: string; detail: Record<string, unknown> };

const ACTION_LABEL: Record<string, string> = {
  marcacao_incluida: "Marcação incluída",
  marcacao_desconsiderada: "Marcação desconsiderada",
  ajuste_revogado: "Ajuste desfeito",
  ocorrencia_lancada: "Ocorrência lançada",
  ocorrencia_revogada: "Ocorrência cancelada",
  periodo_fechado: "Período fechado",
  periodo_reaberto: "Período reaberto",
  rosto_confirmado: "Rosto confirmado pelo RH",
  rosto_confirmacao_desfeita: "Confirmação de rosto desfeita",
  funcionario_incluido: "Funcionário cadastrado",
  funcionario_alterado: "Funcionário alterado",
  foto_funcionario: "Foto do funcionário",
  funcionario_fechado: "Período do funcionário fechado",
  email_configurado: "Configuração de e-mail alterada",
  documento_incluido: "Documento cadastrado",
  documento_editado: "Documento editado",
  documento_renovado: "Documento renovado",
  documento_excluido: "Documento excluído",
  tipo_documento_salvo: "Tipo de documento salvo",
  destinatarios_copiados: "Destinatários de aviso copiados",
  email_teste: "E-mail de teste enviado",
  afd_gerado: "AFD gerado",
  aej_gerado: "AEJ gerado",
  funcionario_reaberto: "Período do funcionário reaberto",
  empresa_alterada: "Empresa alterada",
  regras_alteradas: "Regras alteradas",
  jornada_salva: "Jornada salva",
  jornada_do_funcionario: "Jornada do funcionário",
  obra_salva: "Obra salva",
  tablet_desativado: "Tablet desativado",
  usuario_criado: "Usuário criado",
  usuario_removido: "Usuário removido",
  perfil_portal: "Perfil do portal (Bubble)",
  responsavel_tablet: "Responsável pelo tablet (Bubble)",
  acesso_portal_removido: "Acesso ao portal removido",
  primeiro_acesso_portal: "Primeiro acesso ao portal",
  aviso_resolvido: "Aviso da obra resolvido",
  funcionarios_enviados: "Tablet enviou funcionários",
  tablet_senha_definida: "Senha de ponto criada no tablet",
  tablet_senha_redefinida: "Senha de ponto redefinida no tablet",
  tablet_rosto_cadastrado: "Rosto cadastrado no tablet",
  tablet_rosto_refeito: "Rosto refeito no tablet",
  bonus_retirado: "Bônus retirado",
  bonus_devolvido: "Bônus devolvido",
  anexo_incluido: "Anexo incluído",
  anexo_retirado: "Anexo retirado",
  contrato_datas: "Admissão e desligamento",
  banco_pagamento: "Pagamento de horas",
  banco_desconto: "Desconto de horas",
  banco_estorno: "Quitação estornada",
  banco_abertura: "Saldo de abertura",
};

/** Trilha de auditoria: quem fez o que, quando. */
export function Audit() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(0);
  const { data, error } = useLoad(() => rpc<AuditRow[]>("portal_audit_list", { p: { q: applied, limit: 100, offset: page * 100 } }), [applied, page]);

  return (
    <>
      <PageHead title="Auditoria" lead="Tudo o que foi feito no portal, nos tablets e pela integração. Nada aqui pode ser alterado ou apagado." />
      {error && <Banner tone="error">{error}</Banner>}
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setPage(0); setApplied(q); }}>
        <input className="search" placeholder="Buscar por ação, usuário, CPF ou motivo" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="ghost" type="submit">Buscar</button>
      </form>
      <section className="card flush">
        {!data ? <Loading /> : data.length === 0 ? <Empty>Nada encontrado.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>O quê</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap small">{new Date(a.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="small">{a.actor.replace(/^portal:/, "").replace(/^terminal:/, "Tablet ")}</td>
                    <td className="small strong">{ACTION_LABEL[a.action] ?? a.action.replace(/_/g, " ")}</td>
                    <td className="small muted detail">{describe(a.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pager">
          <button className="ghost small" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
          <span className="muted small">Página {page + 1}</span>
          <button className="ghost small" disabled={!data || data.length < 100} onClick={() => setPage(page + 1)}>Próxima</button>
        </div>
      </section>
    </>
  );
}

function describe(d: Record<string, unknown>): string {
  return Object.entries(d ?? {})
    .filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}
