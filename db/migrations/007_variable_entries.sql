-- ============================================================================
-- Migração 007 — QAVI Auditoria
-- Contas variáveis: despesas que não aparecem todo mês (diferente dos
-- campos de auditoria fixos, que são esperados em todo mês). Cada linha já
-- é um lançamento de um mês específico — não tem uma tabela de "estrutura"
-- separada dos "dados" como audit_fields/audit_status, porque não faz
-- sentido o item persistir pros meses em que ele não existiu. Mesmos
-- indicadores e rastreio de ocorrência de audit_status, pra auditar do
-- mesmo jeito e entrar nos mesmos indicadores.
-- ============================================================================

create table if not exists variable_entries (
  id uuid primary key default gen_random_uuid(),
  cost_center_id uuid not null references cost_centers(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  name text not null,
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

create index if not exists variable_entries_cost_center_id_idx on variable_entries (cost_center_id);
create index if not exists variable_entries_year_month_idx on variable_entries (year, month);

create table if not exists variable_entries_history (
  id uuid primary key default gen_random_uuid(),
  variable_entry_id uuid not null references variable_entries(id) on delete cascade,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now(),
  old_values jsonb not null,
  new_values jsonb not null
);

create index if not exists variable_entries_history_entry_id_idx on variable_entries_history (variable_entry_id);

create or replace function log_variable_entry_change()
returns trigger as $$
begin
  if (tg_op = 'UPDATE') then
    insert into variable_entries_history (variable_entry_id, changed_by, old_values, new_values)
    values (new.id, new.updated_by, to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  end if;
  return new;
end;
$$ language plpgsql
security definer
set search_path = public, pg_temp;

drop trigger if exists trg_variable_entries_history on variable_entries;
create trigger trg_variable_entries_history
  after update on variable_entries
  for each row
  execute function log_variable_entry_change();

alter table variable_entries enable row level security;
alter table variable_entries_history enable row level security;

create policy "authenticated read" on variable_entries for select using (auth.role() = 'authenticated');
create policy "authenticated write variable_entries" on variable_entries for insert with check (auth.role() = 'authenticated');
create policy "authenticated update variable_entries" on variable_entries for update using (auth.role() = 'authenticated');
create policy "authenticated delete variable_entries" on variable_entries for delete using (auth.role() = 'authenticated');
create policy "authenticated read" on variable_entries_history for select using (auth.role() = 'authenticated');
