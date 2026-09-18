# Banco de dados — Sistema de Auditoria DRE

Schema PostgreSQL desenhado para Supabase (Postgres gerenciado + Auth + API REST
instantânea). Validado localmente contra um Postgres 16 real e **já aplicado ao
projeto Supabase de produção da QAVI** ("Auditoria - Qavi", projeto
`cxgwnnkcznswvpdophio`) — veja "Status atual" abaixo.

## Arquivos

- **`schema.sql`** — a estrutura: tabelas, tipos, índices, a view de dashboard, o
  gatilho de trilha de auditoria e as políticas de RLS (Row Level Security).
- **`seed.sql`** — os dados reais já extraídos da aba DRE (as mesmas ~441 linhas
  auditáveis que estão no protótipo), gerado automaticamente a partir de
  `prototype/data.js`. Aplique depois do `schema.sql` pra não começar do zero.

## Status atual: já aplicado em produção

`schema.sql` e `seed.sql` já foram aplicados diretamente no projeto Supabase real
via MCP. Contagens conferidas em produção (batem exatamente com a validação local):

| Tabela | Linhas |
|---|---|
| sections | 3 |
| states | 20 |
| properties | 27 |
| cost_centers | 96 |
| audit_fields | 441 |
| audit_status | 1074 |

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

## Limitação herdada do protótipo

O parser que reconstruiu Propriedade/Centro de custo a partir da planilha original tem
uma taxa de acerto boa mas não perfeita a partir de um certo ponto de "Building
management" (por volta da linha 550) — ali a estrutura da planilha muda de padrão
(passa a listar regiões e contas bancárias). Um item malclassificado real: a linha 534
("1. Salário limpeza - José Aldo") entrou como se fosse uma Propriedade, quando
provavelmente é um campo. Vale uma revisão manual dessa faixa antes de considerar os
dados 100% confiáveis — é rápido de corrigir com `UPDATE`s diretos no banco depois de
identificar os casos errados.

## Próximo passo

Com o banco no ar, o `prototype/app.js` precisa trocar `localStorage` por chamadas ao
Supabase JS client (`@supabase/supabase-js`) — é a próxima peça, ainda não feita.
