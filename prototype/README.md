# DRE — Sistema de Auditoria QAVI

## Status: conectado ao Supabase de produção

Este app **não usa mais `localStorage` como fonte de dados**. Ele fala direto com o
projeto Supabase real da QAVI ("Auditoria - Qavi") — login, árvore de auditoria e os
5 status mensais de cada campo vêm e voltam do banco (`db/schema.sql`), em tempo real,
para qualquer pessoa que abrir a página com uma conta válida. `localStorage` guarda só
preferências de tela (meses visíveis, o que está recolhido/expandido) — nunca dados de
auditoria.

## Rodando localmente

Abra `index.html` diretamente no navegador, ou sirva a pasta com qualquer servidor estático:

```
cd prototype
python3 -m http.server 8080
```

Você precisa de um usuário criado no Supabase Auth do projeto (Authentication → Users no
painel) para logar — peça ao administrador para te cadastrar (ver `db/README.md`).

## Identidade visual

Redesenhado para soar institucional em vez de "produto colorido": uma única cor de marca
(`--brand: #1479d6`) usada com moderação (links, barra de progresso, estado ativo dos filtros),
tipografia Inter, e hierarquia por peso de fonte + indentação + um trilho monocromático à
esquerda (mesma cor, opacidade decrescente por nível) em vez de 4 fundos coloridos diferentes.
Status virou selo de texto (`Conforme`/`Não conforme`/`Pendente`) em vez de bolinhas — vermelho
só aparece quando há de fato uma divergência a sinalizar.

## Arquivos

- **`index.html` / `styles.css`** — layout, tela de login e a grade de auditoria.
- **`supabaseClient.js`** — URL e chave pública do projeto Supabase; cria o cliente `sb`
  usado no resto do app.
- **`config.js`** — configuração estática (meses, os 5 indicadores, opções de status) e os
  mapas de tradução UI (português) ↔ banco (enum em `snake_case`).
- **`app.js`** — autenticação, carregamento da árvore + status a partir do Supabase,
  renderização da tabela/resumo/painel lateral, e todas as escritas (status, adicionar/remover
  itens da hierarquia).
- **`data.js`** — **não é mais carregado pelo app.** É o artefato histórico gerado a partir da
  exportação real da aba DRE, usado uma única vez para popular `db/seed.sql` (ver
  `db/README.md`). Mantido no repositório só como registro de proveniência dos dados.

## Login e permissões

- Qualquer usuário autenticado (papel `auditor` ou `admin`) pode **ler tudo** e **editar os
  status mensais** dos campos — é o trabalho do dia a dia do auditor.
- Só usuários com papel `admin` (tabela `profiles`) veem os botões **+** e **×** e conseguem
  criar/remover Estado, Propriedade, Centro de custo ou Campo. Isso é reforçado tanto na
  interface (botões escondidos) quanto no banco (políticas de RLS) — um auditor sem esse papel
  não consegue alterar a estrutura mesmo manipulando a página diretamente.
- Cada escrita de status grava `updated_by` e alimenta `audit_status_history` automaticamente
  (trilha de auditoria — quem mudou o quê e quando), sem o frontend precisar fazer nada extra.

## A hierarquia

**Seção → Estado → Propriedade → Centro de custo → Campo auditado**, espelhando
`sections → states → properties → cost_centers → audit_fields` no banco.

- **Seção**: as 3 linhas de negócio auditadas hoje — Bed&Breakfast Manager, Bed&Breakfast
  Leasing, Building management (fixas, sem botão de adicionar/remover pela UI).
- **Estado**: RN, PB, AL, PI — os estados onde a QAVI opera.
- **Propriedade**: Ma Plage, Gaudium, Cond. Residencial Vip Flat...
- **Centro de custo**: Administrativo, Limpeza, Lavanderia, Amenities, Vallet, Café da Manhã,
  Manutenção Diluída, OTA, Marketing, Compras, Manutenção, Experiência, Fumo QAVI, Taxa de
  cartão...
- **Campo auditado**: o item que de fato recebe `Conforme` / `Não Conforme` / `Não se aplica`
  todo mês (ex.: "Ominbees", "0. Salário - João Pedro").

Só o **campo auditado** tem os 5 status. Estado, Propriedade e Centro de custo mostram, no
lugar disso, uma barra de progresso somando os campos abaixo deles (% verificado em azul,
aviso em vermelho só quando há algum "Não Conforme" nos descendentes).

## O sistema é dinâmico: adicionar e remover em qualquer nível (admin)

Em **qualquer linha** da árvore (para quem tem papel `admin`):

- **+** adiciona um item novo dentro dela — num Estado, adiciona uma Propriedade; numa
  Propriedade, um Centro de custo; num Centro de custo, um Campo.
- **×** remove o item (com confirmação; se ele tiver itens dentro, o aviso mostra quantos
  serão removidos junto — o banco também aplica isso via `on delete cascade`).

Isso cobre o caso de auditoria real: uma propriedade nova entra na empresa → adiciona o Estado
(se ainda não existir) → adiciona a Propriedade → adiciona os Centros de custo → adiciona os
Campos. Tudo fica salvo no banco imediatamente e já aparece para qualquer outro auditor que
atualizar a página (ou clicar em "Atualizar dados").

## Ocultar e renomear campos (admin)

Além de adicionar/remover, cada **campo auditado** tem dois botões extras (visíveis só pra
`admin`):

- **✎ (renomear)** — pede o novo nome e atualiza na hora. Útil quando o nome real do item mudou.
- **🗕/🗗 (ocultar/mostrar)** — tira o campo da visualização padrão sem apagar nada: o histórico
  de status continua no banco intacto, só some da lista do dia a dia. Serve pra quando algo não
  precisa mais ser auditado, mas você não quer perder o que já foi registrado.

Campos ocultos ficam de fora por padrão. Um botão **"Mostrar campos ocultos"** na barra de
ferramentas (só pra admin) revela todos de novo, esmaecidos e marcados com "(oculto)", pra você
conseguir achar e reativar algum se precisar.

## Ocorrência (colunas E-H da aba "Observações")

Além dos 5 indicadores fixos, cada campo tem um bloco opcional de **rastreio de ocorrência**,
espelhando as colunas E-H da aba "Observações" da planilha "Setor Auditoria":

1. **Ocorrências por tipo** — o que aconteceu (Não lançado, Débito duplicado, Valor menor que o
   target, etc.).
2. **Setor responsável** — Compras, Financeiro, Host, RH...
3. **Funcionário responsável** — quem é o responsável.
4. **Corrigido?** — Sim/Não (sempre por último, e sempre só essas duas opções).

Pra não poluir o painel à toa, eles aparecem **em cascata**: só depois de marcar o tipo de
ocorrência é que "Setor responsável" aparece, e assim por diante. Se nenhuma ocorrência houver
naquele mês, o campo simplesmente fica com só os 5 indicadores de sempre.

As opções de **Ocorrências por tipo**, **Setor responsável** e **Funcionário responsável** não
são mais fixas no código — vêm do banco (tabela `ocorrencia_options`) e qualquer `admin` pode
adicionar uma nova direto pelo dropdown: escolha **"+ Adicionar novo..."** no final da lista,
digite o valor novo, e ele já fica salvo e selecionado na hora — nenhuma outra pessoa que abrir o
sistema depois precisa reconfigurar nada. Serve pra quando entra funcionário novo, aparece um tipo
de ocorrência que ainda não existia, etc.

## Limitações conhecidas

- **Sem tempo real "ao vivo"**: se outra pessoa editar algo enquanto você está com a página
  aberta, você só vê a mudança clicando em "Atualizar dados" ou recarregando a página — não há
  websocket/subscription ainda (`supabase-js` suporta isso via Realtime, é um próximo passo
  natural quando fizer sentido).
- A reconstrução da hierarquia original a partir da planilha (feita uma única vez, antes deste
  app existir) foi uma inferência de padrões de texto — ver `db/README.md` para a limitação
  conhecida numa faixa específica de "Building management".
- Não inclui a DFC (Demonstração de Fluxo de Caixa), as outras abas da planilha, nem o
  restante da DRE fora das 3 seções auditadas.

## Próximos passos possíveis

- Hospedar publicamente (Vercel, Netlify ou similar) em vez de só rodar localmente.
- Dashboards agregados usando a view `v_audit_overview` do banco.
- Atualização em tempo real entre auditores via Supabase Realtime.
- Cadastro de novos usuários direto pela interface (hoje é feito manualmente pelo
  administrador no painel Supabase — ver `db/README.md`).
