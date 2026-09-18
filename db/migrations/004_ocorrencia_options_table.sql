-- ============================================================================
-- Migração 004 — QAVI Auditoria
-- Torna as listas de opções de "Ocorrências por tipo", "Setor responsável" e
-- "Funcionário responsável" editáveis (podem aparecer novos funcionários,
-- novos tipos de ocorrência, etc. com o tempo) em vez de fixas no código.
-- "Corrigido?" continua fixo (Sim/Não), não precisa crescer.
-- ============================================================================

create table if not exists ocorrencia_options (
  id uuid primary key default gen_random_uuid(),
  field_key text not null check (field_key in ('ocorrenciaTipo', 'setorResponsavel', 'funcionarioResponsavel')),
  value text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (field_key, value)
);

alter table ocorrencia_options enable row level security;

create policy "authenticated read" on ocorrencia_options for select using (auth.role() = 'authenticated');
create policy "admin write ocorrencia_options" on ocorrencia_options for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- opções atuais (lidas da aba "Observações" da planilha "Setor Auditoria"),
-- pra não perder o que já existia ao trocar de estático pra dinâmico
insert into ocorrencia_options (field_key, value, sort_order) values
  ('ocorrenciaTipo', 'Centro de custo', 0),
  ('ocorrenciaTipo', 'Competência', 1),
  ('ocorrenciaTipo', 'Competência Errada', 2),
  ('ocorrenciaTipo', 'Débito duplicado', 3),
  ('ocorrenciaTipo', 'Descrição', 4),
  ('ocorrenciaTipo', 'Não lançado', 5),
  ('ocorrenciaTipo', 'Pontuação Inválida', 6),
  ('ocorrenciaTipo', 'Propriedade', 7),
  ('ocorrenciaTipo', 'Valor', 8),
  ('ocorrenciaTipo', 'Sem código', 9),
  ('ocorrenciaTipo', 'Não pago', 10),
  ('ocorrenciaTipo', 'Não lançado e nem Pago', 11),
  ('ocorrenciaTipo', 'Pagamento duplicado', 12),
  ('ocorrenciaTipo', 'Valor menor que o target', 13),
  ('ocorrenciaTipo', 'Valor maior que o target', 14),
  ('ocorrenciaTipo', 'Pago, mas não lançado', 15),
  ('setorResponsavel', 'Compras', 0),
  ('setorResponsavel', 'Diretoria, Financeiro', 1),
  ('setorResponsavel', 'Financeiro', 2),
  ('setorResponsavel', 'Host', 3),
  ('setorResponsavel', 'RH', 4),
  ('funcionarioResponsavel', 'Cinthia Melo', 0),
  ('funcionarioResponsavel', 'Gabriel', 1),
  ('funcionarioResponsavel', 'João Victor Raimundo', 2),
  ('funcionarioResponsavel', 'Rafaela Silva', 3),
  ('funcionarioResponsavel', 'Sergio Roberto', 4),
  ('funcionarioResponsavel', 'João Jácome', 5),
  ('funcionarioResponsavel', 'Ernandes', 6)
on conflict (field_key, value) do nothing;
