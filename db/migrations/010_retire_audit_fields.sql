-- ============================================================================
-- Migração 010 — QAVI Auditoria
-- Estende "retirado a partir de um mês" (migração 009, já em states/
-- properties/cost_centers) pro Campo auditado (audit_fields). Antes, campo
-- só tinha is_active (ocultar em TODOS os meses, sem noção de data) — sem
-- jeito de dizer "esse funcionário saiu em agosto, o campo dele some da
-- árvore a partir dali, mas o histórico de antes continua intacto".
-- ============================================================================

alter table audit_fields
  add column if not exists retired_year int,
  add column if not exists retired_month int check (retired_month between 1 and 12);
