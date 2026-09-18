-- ============================================================================
-- Migração 006 — QAVI Auditoria
-- Ações no campo auditado (apagar, editar, ocultar) passam a valer por MÊS,
-- não pro campo inteiro de uma vez:
--
--   - Apagar: o × na linha do campo, na árvore, não apaga mais o campo pra
--     sempre (levando junto o histórico de todos os meses). Agora limpa só os
--     dados dos meses que estão visíveis na tela no momento.
--   - Editar: clicar numa célula de um mês específico abre o painel lateral
--     já naquele mês (antes sempre abria no primeiro mês visível, mesmo
--     clicando numa célula de outro mês).
--   - Ocultar: além de ocultar o campo inteiro (audit_fields.is_active, já
--     existia), agora dá pra ocultar só um mês específico desse campo
--     (audit_status.is_hidden) — pra quando ele simplesmente não se aplica
--     naquele mês, mas continua valendo nos outros.
--
-- Só a última precisa de mudança no banco.
-- ============================================================================

alter table audit_status add column if not exists is_hidden boolean not null default false;
