-- ============================================================================
-- Migração 008 — QAVI Auditoria
-- Novo papel 'leitor': só lê, nunca escreve em nenhuma tabela (nem status,
-- nem contas variáveis, nem estrutura — estrutura já era admin-only). Até
-- aqui, 'auditor' (o único papel não-admin) sempre pôde editar status e
-- contas variáveis; agora isso fica restrito a admin/auditor, excluindo
-- leitor.
-- ============================================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'auditor', 'leitor'));

drop policy if exists "authenticated write status" on audit_status;
drop policy if exists "authenticated update status" on audit_status;
create policy "editors write status" on audit_status for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);
create policy "editors update status" on audit_status for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);

drop policy if exists "authenticated write variable_entries" on variable_entries;
drop policy if exists "authenticated update variable_entries" on variable_entries;
drop policy if exists "authenticated delete variable_entries" on variable_entries;
create policy "editors write variable_entries" on variable_entries for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);
create policy "editors update variable_entries" on variable_entries for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);
create policy "editors delete variable_entries" on variable_entries for delete using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);
