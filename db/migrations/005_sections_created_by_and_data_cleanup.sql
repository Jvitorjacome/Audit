-- ============================================================================
-- Migração 005 — QAVI Auditoria
-- Duas coisas:
--
-- 1) `sections.created_by`, pra ficar igual às outras 4 tabelas da hierarquia
--    (states/properties/cost_centers/audit_fields já tinham). Necessária
--    porque agora dá pra criar Seção pela interface (painel "+ Adicionar
--    item"), e cada criação grava quem criou, igual nos outros níveis.
--
-- 2) Registro (idempotente, via `source_row`) da limpeza de dados que já foi
--    aplicada direto em produção antes desta migração existir: a
--    reconstrução original da planilha promoveu por engano um campo de
--    auditoria a "propriedade", e a cauda de "Building management" (a partir
--    da linha ~552) tinha uma estrutura diferente (regiões/contas bancárias,
--    não propriedades reais) que o importador forçou no mesmo molde
--    Propriedade > Centro de custo > Campo, gerando 14 propriedades e 13
--    estados vazios que não existem de verdade. Confirmado item a item pelo
--    administrador (dono do processo de auditoria) antes de apagar.
--    Resultado final verificado: sections=3, states=6, properties=12,
--    cost_centers=74, audit_fields=180 — as 12 propriedades reais: Ma Plage,
--    Gaudium, Almarina, Nalu, Marvin, Interatlântico, Cond. Residencial Vip
--    Flat, Cond. Île de Pipa, Cond. Gaudium, Cond. Mares de Cabo Branco,
--    Cond. Pýsa, Cond. Naluri.
-- ============================================================================

alter table sections add column if not exists created_by uuid references profiles(id);

-- --- 2a) campo mal classificado como propriedade: "1. Salário limpeza -
-- José Aldo" (linha 534) era na verdade um campo do centro de custo
-- "Limpeza" do Cond. Pýsa, não uma propriedade própria. Recria como campo
-- (se ainda não existir) e remove a propriedade bogus + a reparenta o
-- centro de custo "Administrativo" (que tinha 2 campos reais) pra dentro do
-- Cond. Pýsa de verdade.
do $$
declare
  limpeza_cc_id uuid;
  pysa_id uuid;
  bogus_property_id uuid;
  administrativo_cc_id uuid;
begin
  select id into pysa_id from properties where name = 'Cond. Pýsa' limit 1;
  select id into bogus_property_id from properties where name = '1. Salário limpeza - José Aldo';

  if pysa_id is not null then
    select id into limpeza_cc_id from cost_centers where property_id = pysa_id and name = 'Limpeza' limit 1;

    if limpeza_cc_id is not null and not exists (
      select 1 from audit_fields where cost_center_id = limpeza_cc_id and source_row = 534
    ) then
      insert into audit_fields (cost_center_id, name, sort_order, source_row)
      values (limpeza_cc_id, '1. Salário limpeza - José Aldo', 0, 534);
    end if;

    if bogus_property_id is not null then
      select id into administrativo_cc_id from cost_centers where property_id = bogus_property_id and name = 'Administrativo' limit 1;
      if administrativo_cc_id is not null then
        update cost_centers set property_id = pysa_id, sort_order = 1 where id = administrativo_cc_id;
      end if;
      delete from properties where id = bogus_property_id;
    end if;
  end if;
end $$;

-- --- 2b) cauda bogus de "Building management" a partir da linha 552
-- (Cotovelo (Litoral Sul), João Pessoa ×3, Milagres ×3, Natal e Litoral Sul
-- ×2, Barra Grande, Banco Inter ×2, "Others (CAV)") — remove em cascata
-- (cost_centers/audit_fields/audit_status junto, via on delete cascade).
delete from properties where source_row >= 552;

-- --- 2c) estados que ficaram sem nenhuma propriedade depois da limpeza
-- acima (inclui o estado "AL" sob "Bed&Breakfast Manager", órfão desde o
-- import original, sem relação com esta limpeza específica mas zero-risco
-- de remover por não ter nenhum dado).
delete from states st where not exists (select 1 from properties p where p.state_id = st.id);
