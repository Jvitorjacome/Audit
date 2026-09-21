-- ============================================================================
-- QAVI — Sistema de Auditoria DRE
-- Schema PostgreSQL (desenhado para rodar em Supabase, mas é Postgres puro —
-- funciona em qualquer instância Postgres 14+, Supabase ou não).
--
-- Espelha a hierarquia validada no protótipo (prototype/data.js):
--   Seção > Estado > Propriedade > Centro de custo > Campo auditado
-- e o status mensal de cada campo (Conforme / Não Conforme / Não se aplica /
-- Não verificado) nos 5 indicadores auditados.
--
-- Este arquivo é a fonte da verdade da estrutura — aplique via
-- `supabase db push` ou colando no SQL Editor do painel Supabase.
-- ============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Enum de status: os mesmos 4 valores já usados no protótipo e já em uso real
-- na planilha original (achado do diagnóstico: "Conforme"/"Não Conforme"/
-- "Não se aplica" já são o vocabulário real dos auditores).
-- ----------------------------------------------------------------------------
create type audit_status_value as enum (
  'nao_verificado',
  'conforme',
  'nao_conforme',
  'nao_se_aplica'
);

-- ----------------------------------------------------------------------------
-- Quem audita: estende auth.users (gerenciado pelo Supabase Auth) com papel.
-- 'admin' pode reestruturar a árvore (criar/remover propriedade, estado...) E
-- editar status/contas variáveis; 'auditor' só edita status/contas variáveis
-- (sem mexer na estrutura); 'leitor' só lê — nunca escreve nada, em nenhuma
-- tabela. Ajuste os papéis conforme a equipe.
-- ----------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'auditor' check (role in ('admin', 'auditor', 'leitor')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Hierarquia: 4 tabelas, uma por nível, cada uma referenciando a de cima.
-- `sort_order` preserva a ordem em que os itens aparecem na tela (e permite
-- reordenar sem depender da ordem de criação). `source_row` é a linha
-- original na planilha DRE, mantida só para rastreabilidade do import.
-- ----------------------------------------------------------------------------

create table sections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  source_row int,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

-- `is_active` = ocultar/mostrar manual (reversível, sem relação com mês —
-- mesmo padrão de audit_fields.is_active). `retired_year`/`retired_month` =
-- "retirado a partir de" (ex.: propriedade que a QAVI parou de administrar):
-- NUNCA apaga a linha nem o que existe abaixo dela (states/properties/
-- cost_centers/audit_fields/audit_status inteiros continuam no banco, pro
-- histórico e os indicadores de meses anteriores não se perderem) — só marca
-- a partir de quando ela para de aparecer na árvore da aba Auditoria pra
-- frente. Ver prototype/app.js (retireNode) pra a regra de visibilidade.
create table states (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  name text not null, -- ex.: RN, PB, AL, PI
  sort_order int not null default 0,
  source_row int,
  is_active boolean not null default true,
  retired_year int,
  retired_month int check (retired_month between 1 and 12),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references states(id) on delete cascade,
  name text not null, -- ex.: Ma Plage, Gaudium
  sort_order int not null default 0,
  source_row int,
  is_active boolean not null default true,
  retired_year int,
  retired_month int check (retired_month between 1 and 12),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table cost_centers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name text not null, -- ex.: Administrativo, Limpeza, Lavanderia
  sort_order int not null default 0,
  source_row int,
  is_active boolean not null default true,
  retired_year int,
  retired_month int check (retired_month between 1 and 12),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table audit_fields (
  id uuid primary key default gen_random_uuid(),
  cost_center_id uuid not null references cost_centers(id) on delete cascade,
  name text not null, -- ex.: "0. Salário - João Pedro"
  sort_order int not null default 0,
  source_row int,
  is_active boolean not null default true, -- oculta o campo sem apagar o histórico de status
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create index on states (section_id);
create index on properties (state_id);
create index on cost_centers (property_id);
create index on audit_fields (cost_center_id);

-- ----------------------------------------------------------------------------
-- Opções editáveis dos campos de ocorrência (tipo, setor e funcionário
-- responsáveis) — um admin pode adicionar novos valores direto no painel
-- (ex.: funcionário novo, tipo de ocorrência novo) sem precisar de migração.
-- "Corrigido?" fica de fora por ser sempre binário (Sim/Não).
-- ----------------------------------------------------------------------------
create table ocorrencia_options (
  id uuid primary key default gen_random_uuid(),
  field_key text not null check (field_key in ('ocorrenciaTipo', 'setorResponsavel', 'funcionarioResponsavel')),
  value text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (field_key, value)
);

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
  ('funcionarioResponsavel', 'Ernandes', 6);

-- ----------------------------------------------------------------------------
-- Status mensal: uma linha por campo auditado × mês. Os 5 indicadores viram
-- colunas reais (não EAV) porque isso é o que faz dashboards e agregações
-- serem SQL simples em vez de pivô manual. `extra` (jsonb) existe justamente
-- para os "outros campos" que você mencionou: dá pra guardar um indicador
-- novo ali sem migração, e só promover pra coluna de verdade quando ele
-- se provar estável e frequente o bastante pra valer a pena indexar.
-- ----------------------------------------------------------------------------
create table audit_status (
  id uuid primary key default gen_random_uuid(),
  audit_field_id uuid not null references audit_fields(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),

  -- oculta só ESTE campo neste mês específico (ex.: não se aplica em agosto,
  -- mas continua valendo nos outros meses) — diferente de audit_fields.is_active,
  -- que oculta o campo inteiro, em todos os meses.
  is_hidden boolean not null default false,

  valores_banco audit_status_value not null default 'nao_verificado',
  coerencia_numerica audit_status_value not null default 'nao_verificado',
  coerencia_contabil audit_status_value not null default 'nao_verificado',
  composicao_debito audit_status_value not null default 'nao_verificado',
  coerencia_patrimonial audit_status_value not null default 'nao_verificado',

  valor_base_target text, -- mantido como texto: a planilha original mistura número e texto livre aqui
  observacoes text,

  -- Rastreio de ocorrência (colunas E-H da aba "Observações" da planilha
  -- "Setor Auditoria"). Tudo opcional: só se preenche quando há de fato uma
  -- ocorrência a registrar, em cascata (tipo -> corrigido -> setor -> pessoa).
  ocorrencia_tipo text,
  corrigido text check (corrigido in ('Sim', 'Não')),
  setor_responsavel text,
  funcionario_responsavel text,

  extra jsonb not null default '{}'::jsonb,

  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),

  unique (audit_field_id, year, month)
);

create index on audit_status (audit_field_id);
create index on audit_status (year, month);

-- ----------------------------------------------------------------------------
-- Contas variáveis: despesas/lançamentos que NÃO aparecem todo mês (ao
-- contrário de audit_fields, que é uma lista fixa de campos esperados em
-- todo mês). Cada linha aqui já É um lançamento de um mês específico — não
-- existe uma "estrutura" separada dos "dados" como em audit_fields/
-- audit_status, porque não faz sentido esse item persistir pros outros
-- meses (ele simplesmente não existiu neles). Mesmos indicadores e rastreio
-- de ocorrência que audit_status, pra auditar do mesmo jeito.
-- ----------------------------------------------------------------------------
create table variable_entries (
  id uuid primary key default gen_random_uuid(),
  cost_center_id uuid not null references cost_centers(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  name text not null, -- descrição livre (muda a cada lançamento, ex.: "Reembolso viagem João")
  sort_order int not null default 0,

  valores_banco audit_status_value not null default 'nao_verificado',
  coerencia_numerica audit_status_value not null default 'nao_verificado',
  coerencia_contabil audit_status_value not null default 'nao_verificado',
  composicao_debito audit_status_value not null default 'nao_verificado',
  coerencia_patrimonial audit_status_value not null default 'nao_verificado',

  valor_base_target text,
  observacoes text,

  ocorrencia_tipo text,
  corrigido text check (corrigido in ('Sim', 'Não')),
  setor_responsavel text,
  funcionario_responsavel text,

  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on variable_entries (cost_center_id);
create index on variable_entries (year, month);

create table variable_entries_history (
  id uuid primary key default gen_random_uuid(),
  variable_entry_id uuid not null references variable_entries(id) on delete cascade,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now(),
  old_values jsonb not null,
  new_values jsonb not null
);

create index on variable_entries_history (variable_entry_id);

create or replace function log_variable_entry_change()
returns trigger as $$
begin
  if (tg_op = 'UPDATE') then
    insert into variable_entries_history (variable_entry_id, changed_by, old_values, new_values)
    values (
      new.id,
      new.updated_by,
      to_jsonb(old) - 'updated_at',
      to_jsonb(new) - 'updated_at'
    );
  end if;
  return new;
end;
$$ language plpgsql
security definer
set search_path = public, pg_temp;

create trigger trg_variable_entries_history
  after update on variable_entries
  for each row
  execute function log_variable_entry_change();

-- ----------------------------------------------------------------------------
-- Trilha de auditoria (rastrear quem mudou o quê): fundamental pra um sistema
-- que audita dinheiro. Toda vez que audit_status muda, grava uma linha aqui
-- via trigger — não depende de o frontend lembrar de registrar.
-- ----------------------------------------------------------------------------
create table audit_status_history (
  id uuid primary key default gen_random_uuid(),
  audit_status_id uuid not null references audit_status(id) on delete cascade,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now(),
  old_values jsonb not null,
  new_values jsonb not null
);

create index on audit_status_history (audit_status_id);

create or replace function log_audit_status_change()
returns trigger as $$
begin
  if (tg_op = 'UPDATE') then
    insert into audit_status_history (audit_status_id, changed_by, old_values, new_values)
    values (
      new.id,
      new.updated_by,
      to_jsonb(old) - 'updated_at',
      to_jsonb(new) - 'updated_at'
    );
  end if;
  return new;
end;
$$ language plpgsql
security definer -- só o gatilho grava no histórico, independente da RLS de quem editou
set search_path = public, pg_temp; -- pinado por segurança (obrigatório com security definer)

create trigger trg_audit_status_history
  after update on audit_status
  for each row
  execute function log_audit_status_change();

-- ----------------------------------------------------------------------------
-- View de conveniência: achata a árvore inteira + o status mais recente de
-- cada campo, pronta pra alimentar dashboards sem repetir o JOIN de 5 tabelas
-- toda vez. Adicione filtros (WHERE year=... AND month=...) em cima dela.
-- ----------------------------------------------------------------------------
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

-- security_invoker: a view respeita o RLS de quem consulta, não de quem criou
-- (achado do linter de segurança do Supabase — corrigido também em produção)
alter view v_audit_overview set (security_invoker = true);

-- ============================================================================
-- Row Level Security — ponto de partida simples: qualquer usuário autenticado
-- lê e edita status; só 'admin' mexe na estrutura da árvore. Refine depois
-- conforme a equipe crescer (ex.: um auditor só ver as propriedades dele).
-- ============================================================================

alter table sections enable row level security;
alter table states enable row level security;
alter table properties enable row level security;
alter table cost_centers enable row level security;
alter table audit_fields enable row level security;
alter table audit_status enable row level security;
alter table audit_status_history enable row level security;
alter table profiles enable row level security;
alter table ocorrencia_options enable row level security;
alter table variable_entries enable row level security;
alter table variable_entries_history enable row level security;

create policy "authenticated read" on sections for select using (auth.role() = 'authenticated');
create policy "authenticated read" on states for select using (auth.role() = 'authenticated');
create policy "authenticated read" on properties for select using (auth.role() = 'authenticated');
create policy "authenticated read" on cost_centers for select using (auth.role() = 'authenticated');
create policy "authenticated read" on audit_fields for select using (auth.role() = 'authenticated');
create policy "authenticated read" on audit_status for select using (auth.role() = 'authenticated');
create policy "authenticated read" on audit_status_history for select using (auth.role() = 'authenticated');
create policy "own profile read" on profiles for select using (auth.role() = 'authenticated');
create policy "authenticated read" on ocorrencia_options for select using (auth.role() = 'authenticated');
create policy "authenticated read" on variable_entries for select using (auth.role() = 'authenticated');
create policy "authenticated read" on variable_entries_history for select using (auth.role() = 'authenticated');

-- Status: admin e auditor editam (é o trabalho deles) — leitor nunca, só lê
-- (a política de select acima já cobre leitura pra qualquer autenticado,
-- leitor incluso; aqui é só escrita).
create policy "editors write status" on audit_status for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);
create policy "editors update status" on audit_status for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);

-- Contas variáveis: mesma regra — admin/auditor editam, leitor só lê.
create policy "editors write variable_entries" on variable_entries for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);
create policy "editors update variable_entries" on variable_entries for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);
create policy "editors delete variable_entries" on variable_entries for delete using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);

-- Estrutura (adicionar/remover estado, propriedade, centro, campo): só admin
create policy "admin write sections" on sections for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "admin write states" on states for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "admin write properties" on properties for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "admin write cost_centers" on cost_centers for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "admin write audit_fields" on audit_fields for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "admin write ocorrencia_options" on ocorrencia_options for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
