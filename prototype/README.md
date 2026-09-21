# Sistema de Auditoria - QAVI

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

Ultraminimalista, inspirado em Claude.ai/Stripe — dois temas, claro e escuro, com o mesmo botão
☀️/🌙 fixo no canto superior direito (visível na tela de login e no app) pra trocar a qualquer
momento; a escolha fica em `localStorage` e é reaplicada antes do primeiro paint da próxima visita
(sem "piscar" o tema errado). **Escuro é o padrão** — o navy fosco (`--bg: #0a1526`,
`--surface: #10233d`) que veio de uma rodada anterior do projeto era o preferido, então continua
sendo o que abre por padrão pra quem ainda não trocou nesse navegador; claro (`--bg: #f9f9fb`,
branco-sujo) fica disponível a um clique. Em ambos, texto e estrutura em azul-marinho
(`--text`, ajustado por tema) e ciano elétrico (`--accent: #00e5ff`, **fixo — mesmo hex nos dois
temas**) só pra detalhe: trilho de 2px à esquerda da árvore, preenchimento das barras de
progresso, sublinhado da aba ativa, anel de foco. Ciano nunca vira cor de texto corrido (ciano
claro sobre fundo claro, ou claro demais sobre fundo escuro, não tem contraste pra isso) — pra
link/ícone/rótulo que precisa ser lido, usa `--brand`, um passo da mesma família calibrado por
tema (mais escuro no claro, mais claro no escuro). O cabeçalho é claro/escuro como o resto do
app (não uma faixa navy cheia fixa) — o navy vira só o selo do ícone; é menos uma camada visual
competindo por atenção, e o "ultraminimalista" pedido é sobretudo isso:
poucas cores, pouca sombra, pouca borda, bastante espaço em branco.

**Declutter da árvore de Auditoria** (era a maior fonte de "poluição" visual): os botões de ação
por linha (✎ renomear, 🗕 ocultar, × remover, + adicionar) e o × de apagar em cada célula de mês
ficavam sempre visíveis, em toda linha, o tempo todo. Agora ficam em opacidade baixa por padrão e
só "acendem" no hover da linha/célula (ou no foco, pra quem navega por teclado) — continuam
descobríveis (nunca em opacidade zero, funciona em touch), mas não competem visualmente com os
dados enquanto você só está lendo a tabela. As faixas de fundo coloridas atrás das linhas de Seção/
Estado (que existiam antes) saíram — hierarquia agora é só peso de fonte + indentação + o trilho
fino de 2px, sem fundo tingido atrás de cada nível.

Cor de marca usada com moderação, tipografia Inter, hierarquia por peso de fonte + indentação.
Status continua como selo de texto (`Conforme`/`Não conforme`/`Pendente`) — vermelho só aparece
quando há de fato uma divergência a sinalizar.

Os cards do dashboard **Indicadores** têm ícone (num selo colorido, sempre acompanhado do
rótulo — nunca só a cor, pra quem não distingue cor sozinha), sombra bem sutil (quase
imperceptível, ao estilo Stripe) e entram na tela com uma animação de "aparecer ao rolar"
(`IntersectionObserver`, respeita `prefers-reduced-motion`) — escopo só nessa aba: a árvore de
Auditoria é uma grade de trabalho densa, reanimar linha de tabela a cada rolagem atrapalharia mais
do que ajudaria ali.

**Duas diferenças deliberadas** em relação às referências usadas:
- **Cor dos gráficos**: o ciano elétrico da marca não entra nas cores de dado do dashboard
  (Chart.js, em `dashboard.js`) — ele não é um hex validado pela régua de dataviz do projeto pra
  ser cor categórica de gráfico (só validado pra interface). Os gráficos continuam no azul do
  slot categórico 1, documentado e testado contra daltonismo/contraste — com um passo pra cada
  tema (`DASH_COLOR_LIGHT`/`DASH_COLOR_DARK`), já que o Chart.js desenha com cor fixa e não lê
  variável CSS; o dashboard redesenha os gráficos ao trocar de tema (ou de aba) pra pegar o passo
  certo.
- **Barras de ranking com uma cor só**: no dashboard Lovable usado como referência antes, cada
  barra de "erros por setor/funcionário" tem uma cor diferente. Aqui todas ficam na mesma cor —
  é uma única série (contagem por categoria), e a régua de dataviz trata "colorir cada barra de
  uma métrica só, sem legenda" como anti-padrão (gasta o canal de identidade sem dizer o que cada
  cor significa).

## Arquivos

- **`index.html` / `styles.css`** — layout, tela de login, as duas abas (Auditoria/Indicadores)
  e a grade de auditoria.
- **`supabaseClient.js`** — URL e chave pública do projeto Supabase; cria o cliente `sb`
  usado no resto do app.
- **`config.js`** — configuração estática (meses, os 5 indicadores, opções de status) e os
  mapas de tradução UI (português) ↔ banco (enum em `snake_case`).
- **`app.js`** — autenticação, carregamento da árvore + status a partir do Supabase,
  renderização da tabela/resumo/painel lateral, e todas as escritas (status, adicionar/remover
  itens da hierarquia).
- **`dashboard.js`** — a aba **Indicadores**: agrega os dados já carregados pelo `app.js` em
  KPIs e gráficos (ver seção própria abaixo).
- **`data.js`** — **não é mais carregado pelo app.** É o artefato histórico gerado a partir da
  exportação real da aba DRE, usado uma única vez para popular `db/seed.sql` (ver
  `db/README.md`). Mantido no repositório só como registro de proveniência dos dados.

## Login e permissões

Três papéis (`profiles.role`), cada um mais restrito que o anterior:

- **`admin`** — acesso total: lê tudo, edita status/contas variáveis e mexe na estrutura da
  árvore (cria/renomeia/oculta/remove Estado, Propriedade, Centro de custo ou Campo). Só quem
  tem esse papel vê os botões **+** e **×** de estrutura.
- **`auditor`** — lê tudo e **edita os status mensais** e as contas variáveis (o trabalho de
  auditoria do dia a dia), mas não vê os botões de estrutura — não cria/remove Estado,
  Propriedade, Centro de custo ou Campo.
- **`leitor`** — só leitura, em tudo (árvore, status, contas variáveis, dashboard de
  Indicadores). Não edita nada: o badge de papel mostra "Leitor", os campos do painel lateral
  aparecem desabilitados (dá pra ver o valor, não pra mudar), e os botões de ação (limpar
  célula, "+ Variável", renomear/apagar conta variável, "Limpar tudo", ocultar mês) somem da
  interface. Pensado pra quem só acompanha o andamento da auditoria sem participar dela.

Cada regra é reforçada tanto na interface (botões escondidos, campos desabilitados) quanto no
banco (políticas de RLS) — ninguém consegue alterar o que o papel não permite mesmo manipulando
a página diretamente. Cada escrita de status grava `updated_by` e alimenta
`audit_status_history` automaticamente (trilha de auditoria — quem mudou o quê e quando), sem o
frontend precisar fazer nada extra.

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
  serão removidos junto — o banco também aplica isso via `on delete cascade`). **Exceção: o
  campo auditado não tem esse × na linha** — ele nunca é apagado (nem o campo, nem seu
  histórico) por uma ação de linha; apagar dados de um campo é sempre uma ação de **um mês só**
  (ver "Ações por mês" abaixo).

Isso cobre o caso de auditoria real: uma propriedade nova entra na empresa → adiciona o Estado
(se ainda não existir) → adiciona a Propriedade → adiciona os Centros de custo → adiciona os
Campos. Tudo fica salvo no banco imediatamente e já aparece para qualquer outro auditor que
atualizar a página (ou clicar em "Atualizar dados").

### Painel "+ Adicionar item" (criação explícita, qualquer nível)

Além dos botões **+** contextuais de cada linha (que exigem descobrir qual linha cria o quê),
a barra de ferramentas tem um botão **"+ Adicionar item"** (só pra `admin`) que abre um painel
onde você escolhe **explicitamente o tipo** do que vai criar — Seção, Estado, Propriedade,
Centro de custo ou Campo auditado — e depois escolhe cada nível pai em cascata (ex.: pra criar
uma Propriedade, escolhe primeiro a Seção, depois o Estado dentro dela; pra criar um Campo,
escolhe Seção → Estado → Propriedade → Centro de custo). É o único jeito de criar uma **Seção**
nova — as linhas da árvore não têm **+** pra isso, porque Seção é o topo da hierarquia e não
tem um "pai" pra clicar. Se a lista de um nível pai estiver vazia (ex.: nenhum Centro de custo
ainda na Propriedade escolhida), o painel avisa e pede pra criar esse nível primeiro. Qualquer
item criado por aqui é gravado no banco na hora, do mesmo jeito que os botões **+** de linha.

## Ocultar e renomear campos (admin)

Além de adicionar/remover, cada **campo auditado** tem dois botões extras (visíveis só pra
`admin`):

- **✎ (renomear)** — pede o novo nome e atualiza na hora. Útil quando o nome real do item mudou.
  Isso é uma propriedade do campo em si, então vale pra todos os meses (não faz sentido um campo
  ter nomes diferentes mês a mês).
- **🗕/🗗 (ocultar/mostrar)** — tira o campo **inteiro**, **em todos os meses**, da visualização
  padrão sem apagar nada: o histórico de status continua no banco intacto, só some da lista do
  dia a dia. Serve pra quando algo não precisa mais ser auditado *daqui pra frente*, mas você não
  quer perder o que já foi registrado.

Campos ocultos ficam de fora por padrão. Um botão **"Mostrar campos ocultos"** na barra de
ferramentas (só pra admin) revela todos de novo, esmaecidos e marcados com "(oculto)", pra você
conseguir achar e reativar algum se precisar.

## Ações por mês: apagar, editar e ocultar valem só pro mês, não pro campo inteiro

Isso vale só pro **campo auditado** (o nível dentro do centro de custo que de fato recebe
status mês a mês) — Estado, Propriedade e Centro de custo continuam com **+**/**×** normais na
linha, sem noção de mês. Um campo é uma linha só na árvore, mas cada mês é uma coluna com seus
próprios dados — então apagar, editar ou ocultar **um mês** nunca afeta os outros, nem depende
de quais meses estão marcados no filtro do topo. Cada célula de mês tem sua própria ação:

- **Editar** — clicar no selo de status de uma célula (ex.: a célula de Junho) abre o painel
  lateral já naquele mês, não sempre no primeiro mês visível da linha. O seletor "Mês" no topo do
  painel deixa trocar pra outro mês sem fechar e reabrir.
- **Apagar** — cada célula de mês tem seu próprio **×** pequeno, do lado do selo de status (só
  pra `admin`). Clicar limpa (volta pra "Não verificado"/vazio) só aquele campo, naquele mês —
  nunca outro mês, nunca o campo inteiro, nunca o histórico dele. Dentro do painel lateral,
  "Limpar tudo deste mês" faz a mesma coisa pro mês que estiver aberto ali.
- **Ocultar** — além do 🗕 que oculta o campo inteiro (todos os meses, ver seção acima), o painel
  lateral tem um checkbox **"Ocultar [campo] em [mês]"** que oculta só aquele mês específico: a
  célula daquele mês vira um selo tracejado "Oculto" (não conta pra % verificado, pra não
  conformidades nem pro dashboard de Indicadores), enquanto os outros meses do mesmo campo
  continuam normais. Serve pra quando um campo simplesmente não se aplica num mês específico
  (ex.: uma despesa sazonal), mas volta a fazer sentido nos meses seguintes.

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

### Limpar campos

No painel de um campo, cada um dos 5 indicadores e dos 4 campos de ocorrência tem um **×** ao
lado que limpa só aquele campo (volta pra "Não verificado" ou vazio). O botão **"Limpar tudo
deste mês"** no topo do painel zera de uma vez todos os indicadores, a ocorrência, o valor
base/target e as observações daquele campo naquele mês — pede confirmação antes, porque não dá
pra desfazer.

## Contas variáveis (despesas que não aparecem todo mês)

Além dos **campos de auditoria** fixos (esperados em todo mês), agora dá pra auditar **contas
variáveis** — despesas que só aparecem de vez em quando (reembolso, compra pontual, etc.) — do
mesmo jeito: os mesmos 5 indicadores, o mesmo rastreio de ocorrência (tipo, setor responsável,
funcionário responsável, corrigido), valor base/target e observações.

A diferença é que uma conta variável **já nasce presa a um mês específico** — ela não é um item
permanente da árvore com uma célula em cada mês como o campo fixo; é um lançamento avulso daquele
mês só. Por isso:

- `admin` e `auditor` podem criar, editar, renomear e apagar contas variáveis — é trabalho de
  auditoria do dia a dia, igual marcar status de um campo fixo, não uma mudança estrutural da
  árvore. `leitor` só lê (não vê o botão "+ Variável" nem ✎/× nas linhas existentes).
- Pra criar uma: no **Centro de custo** onde a despesa se encaixa, clique em **"+ Variável"**,
  digite o nome (livre — muda a cada lançamento, ex.: "Reembolso viagem João") e o mês. O painel
  de edição já abre na hora.
- Na árvore, a conta variável aparece como mais uma linha dentro do centro de custo, com o selo
  **Variável** e o mês entre parênteses no nome. Ela só mostra o selo de status real na coluna do
  mês em que existe — nos outros meses visíveis, um traço neutro ("—") no lugar, já que ela
  simplesmente não existiu ali.
- **✎** renomeia, **×** apaga o lançamento inteiro (sem a ressalva de "só este mês" que existe
  pro campo fixo — aqui não tem outro mês pra preservar, então apagar é sempre definitivo, com
  confirmação).
- Clicar na célula (ou em qualquer parte da linha) abre o mesmo painel lateral usado pelos campos
  fixos, só que sem o seletor de "Mês" (o mês já é fixo) e sem a opção de "ocultar este mês" (não
  existem outros meses pra distinguir).
- Entra nos **Indicadores** (aba abaixo) exatamente como um campo fixo — total analisado, taxa de
  erro, valores impactados/corrigidos, erros por setor/funcionário/propriedade, tudo somado
  junto.

## Aba Indicadores

O sistema agora tem duas abas: **Auditoria** (a árvore de sempre) e **Indicadores** — um
dashboard com KPIs e gráficos, inspirado no projeto "Audit Insights Hub" (Lovable) que o
administrador já usava, mas lendo os dados direto deste banco (não da planilha do Google Sheets).
Filtra por mês e propriedade — **os dois filtros afetam todos os indicadores**, inclusive
"Total analisado" e os cards de conformidade por mês (não só os gráficos de erro): filtrar por
uma propriedade mostra só o que foi analisado *daquela* propriedade, não o total do sistema
inteiro. Conta campos fixos e contas variáveis juntos. Mostra:

- **Total analisado** — quantos campos tiveram pelo menos um dos 5 indicadores marcado no mês
  (não conta célula tocada só por causa de valor/observações/ocorrência, nem mês oculto — ver
  "Ações por mês" acima), com **% de erro** em cima desse total.
- **Não conformidades** e **taxa de conformidade**.
- **Impacto financeiro (não corrigido)** — soma do valor dos campos não conformes com
  "Corrigido = Não".
- **Valores corrigidos** — soma do valor dos campos não conformes com "Corrigido = Sim". (A
  separação QAVI vs proprietário desses dois totais — que existia no Lovable original — fica
  pra uma próxima rodada, a pedido; o código já calcula essa classificação internamente, só não
  está exposta na tela ainda.)
- Erros por setor responsável, por funcionário responsável e por propriedade.
- Conformidade por mês (cards + gráfico).
- Ocorrências por tipo, com quantidade e valor total (tabela + gráfico).

**É em tempo real** no sentido que importa: os gráficos leem direto de `state.tree`/`state.cells`
(os mesmos dados já carregados pela aba Auditoria), então qualquer edição feita no painel lateral
já aparece assim que você troca pra aba Indicadores — sem precisar recarregar a página. Testado
de ponta a ponta com um caso real: marcar "Omnibees" (Gaudium) como não conforme em setembro,
com ocorrência "Descrição"/setor "Financeiro"/funcionário definido, aparece corretamente nos
KPIs, na lista de erros por propriedade e na tabela de tipos assim que se troca de aba — sem
mexer no banco diretamente.

Passar o mouse por cima de qualquer bloco (KPI, gráfico, mini-card de mês) dá um leve zoom nele e
esmaece os outros, pra guiar o foco — sem transição/delay, a troca é instantânea.

### Gerar relatório PDF

Botão **"Gerar relatório PDF"** na barra de filtros gera um PDF com exatamente o que está
filtrado na tela (mesmo filtro de mês/propriedade aplicado nos KPIs e gráficos). Não usa nenhuma
biblioteca externa — é `window.print()` com CSS `@media print` dedicado: a caixa "Imprimir" do
navegador abre e a pessoa escolhe "Salvar como PDF" (ou uma impressora de verdade, se quiser).
Isso gera um PDF de verdade, com texto selecionável, não uma captura de tela.

O que acontece por baixo:
- Esconde cabeçalho, abas, filtros, drawer e o botão de tema — só o conteúdo dos Indicadores vai
  pro papel.
- Insere um cabeçalho só-de-impressão no topo: título, o filtro aplicado (mês e propriedade) por
  extenso, e data/hora de geração.
- Se o tema atual for escuro, troca pra claro antes de imprimir (senão os gráficos saem com
  eixo/grade claros demais pra enxergar num fundo branco) e redesenha os gráficos nas cores
  claras. Assim que a caixa de diálogo fecha (`afterprint`), volta pro tema original e redesenha
  de novo — não mexe na preferência salva da pessoa.

Uma diferença de propósito em relação ao original: lá, o gráfico de "Ocorrências por tipo" era
um donut (pizza). Aqui virou barra — com até 16 tipos possíveis, uma pizza de tantas fatias fica
difícil de ler; a régua de design usada (skill de dataviz) recomenda no máximo ~6 fatias para
esse tipo de gráfico antes de trocar por barra.

Os gráficos usam [Chart.js](https://www.chartjs.org/) (carregado via CDN, sem precisar de build).

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
