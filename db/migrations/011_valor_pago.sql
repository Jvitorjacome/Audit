-- ============================================================================
-- Migração 011 — QAVI Auditoria
-- Novo campo "Valor pago" em audit_status e variable_entries, ao lado de
-- valor_base_target (o "target"/base de referência). Antes só existia o
-- target; agora também guarda quanto foi de fato pago, e os indicadores
-- (Indicadores → impacto financeiro) passam a somar o valor PAGO, não mais
-- o target — pedido explícito do usuário: o target é só a base de
-- comparação, o pago é o que realmente saiu/entrou.
-- ============================================================================

alter table audit_status
  add column if not exists valor_pago text; -- mesmo padrão de valor_base_target: texto livre, planilha original mistura número e texto

alter table variable_entries
  add column if not exists valor_pago text;
