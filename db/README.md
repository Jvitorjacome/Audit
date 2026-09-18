# Banco de dados — Sistema de Auditoria DRE

Schema PostgreSQL desenhado para Supabase (Postgres gerenciado + Auth + API REST
instantânea). Validado localmente contra um Postgres 16 real e **já aplicado ao
projeto Supabase de produção da QAVI** ("Auditoria - Qavi", projeto
`cxgwnnkcznswvpdophio`) — veja "Status atual" abaixo.

## Arquivos

- **`schema.sql`** — a estrutura completa e atual: tabelas, tipos, índices, a view
  de dashboard, o gatilho de trilha de auditoria e as políticas de RLS (Row Level
  Security). Reflete o estado mais recente do banco (já incorpora as migrações
  abaixo) — use este arquivo pra um projeto novo do zero.
- **`seed.sql`** — os dados reais já extraídos da aba DRE (as mesmas ~441 linhas
  auditáveis que estão no protótipo), gerado automaticamente a partir de
  `prototype/data.js`. Aplique depois do `schema.sql` pra não começar do zero.
- **`migrations/`** — mudanças incrementais aplicadas ao banco de produção depois
  do `schema.sql` inicial, uma por arquivo, em ordem numérica. `schema.sql` já
  contém o resultado de todas elas — só use a pasta `migrations/` se estiver
  aplicando em um projeto que já rodava uma versão anterior do schema.

### `migrations/006_per_month_hide_and_scoped_actions.sql`

Já aplicada. Adiciona `audit_status.is_hidden`, pra dar suporte a ocultar um campo auditado só
num mês específico (diferente de `audit_fields.is_active`, que oculta o campo inteiro em todos os
meses). As outras duas mudanças dessa rodada — o **×** de apagar um campo passar a limpar só os
meses visíveis na tela (nunca mais o campo inteiro pra sempre) e clicar numa célula de mês
específico abrir o painel já naquele mês — são só frontend, não mexem no banco.

### `migrations/005_sections_created_by_and_data_cleanup.sql`

Já aplicada. Duas coisas: (1) adiciona `created_by` em `sections`, pra ficar igual
às outras 4 tabelas da hierarquia — necessária porque agora dá pra criar Seção pela
interface (painel "+ Adicionar item", ver `prototype/README.md`); (2) registra a
limpeza de dados que corrigiu a "Limitação herdada do protótipo" descrita mais
abaixo: um campo mal promovido a propriedade ("1. Salário limpeza - José Aldo") e
14 propriedades + 13 estados bogus na cauda de "Building management" (a partir da
linha ~552 da planilha, que listava regiões/contas bancárias, não propriedades reais)
— confirmados item a item pelo administrador antes de remover. Contagem final: 12
propriedades reais (ver lista no arquivo da migração).

### `migrations/004_ocorrencia_options_table.sql`

Já aplicada. Cria a tabela `ocorrencia_options`, que torna as listas de
"Ocorrências por tipo", "Setor responsável" e "Funcionário responsável" editáveis
por um admin direto no app (botão "+ Adicionar novo..." no dropdown), em vez de
fixas no código.

### `migrations/003_fix_audit_history_trigger_rls.sql`

Já aplicada. Corrigiu um bug real do schema original: `audit_status_history` tinha
RLS ativado sem nenhuma política de INSERT, então o gatilho de trilha de auditoria
falhava e derrubava a atualização inteira sempre que alguém editava (não criava pela
1ª vez) um status — inclusive um admin.

### `migrations/002_hide_fields_and_ocorrencia_tracking.sql`

Já aplicada em produção (colada manualmente no SQL Editor). Adicionou ocultar/mostrar
campo, renomear campo, e os 4 campos de ocorrência (tipo, corrigido, setor e
funcionário responsáveis).

## Status atual: já aplicado em produção

`schema.sql` e `seed.sql` já foram aplicados diretamente no projeto Supabase real
via MCP. Contagens atuais em produção, já depois de `005_sections_created_by_and_data_cleanup.sql`
(números originais do import eram maiores — ver "Limitação herdada do protótipo" abaixo):

| Tabela | Linhas |
|---|---|
| sections | 3 |
| states | 6 |
| properties | 12 |
| cost_centers | 74 |
| audit_fields | 180 |
| audit_status | 1080 |

Rodei também o linter de segurança do Supabase (`get_advisors`) depois de aplicar
tudo. Corrigi os dois achados que eram meus: a view `v_audit_overview` estava
`SECURITY DEFINER` (bypassava RLS do usuário que consulta — corrigido pra
`security_invoker = true`) e a função `log_audit_status_change` estava com
`search_path` mutável (corrigido fixando `search_path = public, pg_temp`). O único
aviso restante (`rls_auto_enable`) é uma função de proteção que já vem instalada
pela própria Supabase em todo projeto novo — não é código deste schema.

**Dados de conexão do frontend** (para configurar `@supabase/supabase-js`):
- Project URL: `https://cxgwnnkcznswvpdophio.supabase.co`
- Publishable key: `sb_publishable_f4zfokt0ApU-Etg2P6mwdA_nYMEAJ2N`
  (ou a legacy anon key equivalente, disponível em Project Settings → API)

Nunca use a **Secret key** no frontend — só a publishable/anon key, que já respeita
as políticas de RLS.

## Como aplicar num projeto Supabase novo (do zero)

1. Crie um projeto em [supabase.com](https://supabase.com) (tier gratuito serve
   pra começar).
2. No painel do projeto, vá em **SQL Editor** → cole o conteúdo de `schema.sql` →
   Run.
3. Repita o passo 2 com `seed.sql`.
4. Em **Authentication → Users**, crie o primeiro usuário (você) e depois rode:
   ```sql
   insert into profiles (id, full_name, role)
   values ('<uuid do usuário criado>', 'Seu nome', 'admin');
   ```
   (sem isso, as políticas de RLS não deixam ninguém mexer na estrutura da árvore —
   só ler e editar status.)
5. Pegue a **URL do projeto** e a **anon key** em Project Settings → API — é o que
   o frontend vai usar pra falar com o banco.

## Como eu testei (antes de te entregar)

Este ambiente já tinha PostgreSQL 16 instalado. Criei um banco descartável, apliquei
`schema.sql` linha por linha (com stubs locais de `auth.role()`/`auth.uid()`, que na
Supabase de verdade já vêm prontos), rodei `seed.sql` e conferi:

- As contagens batem com o protótipo: 3 seções, 20 estados, 27 propriedades, 96
  centros de custo, 441 campos auditados, 1074 linhas de status mensal.
- A `v_audit_overview` (a view pronta pra dashboard) retorna os dados certos — testei
  puxando o histórico de "Ominbees" em Ma Plage e bateu com o que o protótipo mostra.
- O gatilho de trilha de auditoria funciona: mudei um status de `conforme` para
  `nao_conforme` e a mudança apareceu em `audit_status_history` com o valor antigo e o novo.

Ou seja: o schema não é só teórico, já rodou de verdade com os dados reais antes de
chegar até você.

## Limitação herdada do protótipo (já corrigida)

O parser que reconstruiu Propriedade/Centro de custo a partir da planilha original tinha
uma taxa de acerto boa mas não perfeita a partir de um certo ponto de "Building
management" (por volta da linha 550) — ali a estrutura da planilha muda de padrão
(passa a listar regiões e contas bancárias). Isso gerou 14 "propriedades" bogus (com até
125 campos cada) e 13 "estados" vazios, além de um campo real malclassificado como
propriedade ("1. Salário limpeza - José Aldo", linha 534). Confirmado pelo administrador
(dono do processo de auditoria, que sabe de cor as 12 propriedades reais) e corrigido via
`migrations/005_sections_created_by_and_data_cleanup.sql` — ver esse arquivo pro SQL
exato e a lista das 12 propriedades reais.

## Frontend já conectado

`prototype/app.js` já fala com este banco de verdade via `@supabase/supabase-js`
(login por e-mail/senha, leitura da árvore inteira, escrita de status e das
mudanças de estrutura) — não usa mais `localStorage` como fonte de dados. Ver
`prototype/README.md` para os detalhes de como isso funciona e como logar.

O primeiro usuário admin já está cadastrado: `joaogalvao@quartoavista.com.br`
(perfil `profiles` com `role='admin'`, id `081f9cc8-19f8-4fcf-94e3-c45b342ac614`).
Para dar acesso a mais auditores, crie o usuário em **Authentication → Users** no
painel Supabase e rode o `insert into profiles (...)` acima com `role='auditor'`
(ou `'admin'` se a pessoa também for mexer na estrutura da árvore).

## Próximos passos possíveis

- Hospedar `prototype/` publicamente (Vercel, Netlify...) em vez de só rodar local.
- Dashboards agregados em cima de `v_audit_overview`.
- Atualização em tempo real entre auditores via Supabase Realtime.
