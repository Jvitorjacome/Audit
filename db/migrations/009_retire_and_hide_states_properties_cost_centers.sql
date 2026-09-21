-- ============================================================================
-- Migração 009 — QAVI Auditoria
-- Antes: apagar um Estado, Propriedade ou Centro de custo era um DELETE de
-- verdade (cascata: leva junto tudo abaixo — audit_fields, audit_status,
-- audit_status_history), destruindo o histórico/indicadores de meses já
-- auditados. Agora: dois recursos novos, independentes, em states/
-- properties/cost_centers (mesma ideia que audit_fields.is_active já tinha):
--   - is_active: ocultar/mostrar manual, reversível, sem relação com mês.
--   - retired_year/retired_month: "retirado a partir de" -- a linha (e tudo
--     abaixo dela) continua intacta no banco, só marca a partir de quando
--     ela para de aparecer na árvore da aba Auditoria pra frente. O ×
--     (remover) na interface passa a gravar isso em vez de fazer DELETE.
-- ============================================================================

alter table states
  add column if not exists is_active boolean not null default true,
  add column if not exists retired_year int,
  add column if not exists retired_month int check (retired_month between 1 and 12);

alter table properties
  add column if not exists is_active boolean not null default true,
  add column if not exists retired_year int,
  add column if not exists retired_month int check (retired_month between 1 and 12);

alter table cost_centers
  add column if not exists is_active boolean not null default true,
  add column if not exists retired_year int,
  add column if not exists retired_month int check (retired_month between 1 and 12);
