# DRE Independente — protótipo

Aplicativo estático (HTML/CSS/JS puro, sem build) que demonstra as mudanças avaliadas para a aba "DRE" fora da planilha original: menus suspensos de status, filtro de meses, e uma árvore de auditoria dinâmica organizada por **Estado → Propriedade → Centro de custo → Campo**.

## Rodando localmente

Abra `index.html` diretamente no navegador, ou sirva a pasta com qualquer servidor estático:

```
cd prototype
python3 -m http.server 8080
```

## Escopo atual

Só as 3 seções que você pediu para auditar entram no sistema por enquanto:

- **Bed&Breakfast Manager**
- **Bed&Breakfast Leasing**
- **Building management**

(linhas 272–857 da aba DRE original — a parte de custos operacionais auditada item a item). O restante da DRE (receita bruta, deduções, impostos, resultado) não está incluído nesta versão.

## A hierarquia

**Seção → Estado → Propriedade → Centro de custo → Campo auditado.**

- **Seção**: as 3 linhas de negócio acima (fixas, não editáveis).
- **Estado**: RN, PB, AL, PI — os estados onde a QAVI opera.
- **Propriedade**: Ma Plage, Gaudium, Cond. Residencial Vip Flat...
- **Centro de custo**: Administrativo, Limpeza, Lavanderia, Amenities, Vallet, Café da Manhã, Manutenção Diluída, OTA, Marketing, Compras, Manutenção, Experiência, Fumo QAVI, Taxa de cartão...
- **Campo auditado**: o item que de fato recebe `Conforme` / `Não Conforme` / `Não se aplica` todo mês (ex.: "Ominbees", "0. Salário - João Pedro").

Cada nível tem uma cor própria na tabela (veja a legenda no topo da página) para não se confundir em telas com muita informação.

### Como a hierarquia original foi reconstruída

A planilha mostra os níveis por **indentação visual** (formatação, não conteúdo de célula), que não sobrevive a uma exportação de texto/CSV. O gerador (rodado uma vez sobre a exportação real da API do Sheets, resultado salvo em `data.js`) inferiu os níveis por padrões que já existem nos dados: uma propriedade é sempre seguida do centro de custo "Administrativo"; um centro de custo é reconhecido por nome (com ou sem o prefixo numérico de código que a planilha usa, tipo `6. Lavanderia`). A partir de um certo ponto de "Building management" (por volta da linha 550) a planilha muda de padrão (passa a listar regiões e contas bancárias), então essas partes podem ter ficado agrupadas de forma menos precisa — vale conferir contra a planilha original antes de confiar cegamente nelas.

## O sistema é dinâmico: adicionar e remover em qualquer nível

Em **qualquer linha** da árvore:

- **+** adiciona um item novo dentro dela — num Estado, adiciona uma Propriedade; numa Propriedade, um Centro de custo; num Centro de custo, um Campo. Na própria Seção, adiciona um Estado novo.
- **×** remove o item (com confirmação; se ele tiver itens dentro, o aviso mostra quantos serão removidos junto).

Isso cobre o caso de auditoria real: uma propriedade nova entra na empresa → adiciona o Estado (se ainda não existir) → adiciona a Propriedade → adiciona os Centros de custo → adiciona os Campos. Tudo fica salvo no navegador (`localStorage`), incluindo tudo que for adicionado ou removido.

Clicar em qualquer linha (não só nos campos-folha — todo nível tem dados reais de auditoria próprios vindos da planilha) abre o painel com os 5 status (`Conforme / Não Conforme / Não se aplica / Não verificado`), campo `Valor base/target` e observações, com seletor de mês dentro do painel.

## Limitações conhecidas (é um protótipo)

- **Sem sincronização com o Google Sheets.** Tudo é local ao navegador de quem abrir a página — itens adicionados por uma pessoa não aparecem para outra.
- A reconstrução da hierarquia original é uma inferência de padrões de texto, não uma leitura de formatação — ver seção acima.
- Não inclui a DFC (Demonstração de Fluxo de Caixa), as outras abas da planilha, nem o restante da DRE fora das 3 seções.

## Próximo passo: sincronizar com o Google Sheets

1. Criar um projeto no Google Cloud Console e ativar a **Google Sheets API**.
2. Criar uma **conta de serviço** (ou OAuth client, se cada auditor for logar com a própria conta Google) e compartilhar a planilha com o e-mail da conta de serviço como editor.
3. Substituir a leitura/escrita de `getCell`/`setCellField` e as mutações de `state.tree` em `app.js` por chamadas a um backend leve que fale com `spreadsheets.values.get`/`update` (status) e `spreadsheets.batchUpdate` (inserir/remover linhas quando um item for adicionado/removido em qualquer nível) — usando os intervalos exatos, já que a planilha reaproveita as mesmas colunas para conteúdo diferente em outras partes.
4. Decidir a política de concorrência (duas pessoas editando/adicionando/removendo o mesmo item ao mesmo tempo).

Essa etapa exige credenciais e hospedagem — não pode rodar só no navegador, porque a chave da conta de serviço não pode ficar exposta no cliente.
