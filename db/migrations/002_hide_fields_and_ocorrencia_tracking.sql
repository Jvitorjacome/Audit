-- ============================================================================
-- Migração 002 — QAVI Auditoria
-- 1) Permite ocultar um campo auditado sem apagar o histórico (audit_fields.is_active)
-- 2) Adiciona o rastreio de ocorrência (colunas E-H da aba "Observações" da
--    planilha "Setor Auditoria"): tipo de ocorrência, se foi corrigido, setor
--    e funcionário responsáveis. Tudo opcional (nullable) — só se preenche
--    quando há de fato uma ocorrência a registrar.
-- Aplique colando este arquivo inteiro no SQL Editor do painel Supabase e
-- clicando em Run. Idempotente (pode rodar de novo sem erro).
-- ============================================================================

alter table audit_fields
  add column if not exists is_active boolean not null default true;

alter table audit_status
  add column if not exists ocorrencia_tipo text,
  add column if not exists corrigido text check (corrigido in ('Sim', 'Não')),
  add column if not exists setor_responsavel text,
  add column if not exists funcionario_responsavel text;

-- a view de dashboard precisa ser recriada para expor as colunas novas
drop view if exists v_audit_overview;
create view v_audit_overview as
select
  s.id as section_id, s.name as section_name,
  st.id as state_id, st.name as state_name,
  p.id as property_id, p.name as property_name,
  cc.id as cost_center_id, cc.name as cost_center_name,
  af.id as audit_field_id, af.name as audit_field_name, af.is_active as audit_field_is_active,
  ast.year, ast.month,
  ast.valores_banco, ast.coerencia_numerica, ast.coerencia_contabil,
  ast.composicao_debito, ast.coerencia_patrimonial,
  ast.valor_base_target, ast.observacoes,
  ast.ocorrencia_tipo, ast.corrigido, ast.setor_responsavel, ast.funcionario_responsavel,
  (
    (ast.valores_banco = 'nao_conforme') or
    (ast.coerencia_numerica = 'nao_conforme') or
    (ast.coerencia_contabil = 'nao_conforme') or
    (ast.composicao_debito = 'nao_conforme') or
    (ast.coerencia_patrimonial = 'nao_conforme')
  ) as has_nao_conforme
from sections s
join states st on st.section_id = s.id
join properties p on p.state_id = st.id
join cost_centers cc on cc.property_id = p.id
join audit_fields af on af.cost_center_id = cc.id
left join audit_status ast on ast.audit_field_id = af.id;

alter view v_audit_overview set (security_invoker = true);
