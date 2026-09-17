# DRE Independente — protótipo

Aplicativo estático (HTML/CSS/JS puro, sem build) que demonstra as mudanças avaliadas para a aba "DRE" fora da planilha original: menus suspensos de status por indicador/mês, filtro de meses visíveis, e agora também a lista completa de indicadores com opção de adicionar/remover.

## Rodando localmente

Abra `index.html` diretamente no navegador, ou sirva a pasta com qualquer servidor estático:

```
cd prototype
python3 -m http.server 8080
```

## De onde vêm os dados

`data.js` é **gerado**, não escrito à mão — veio de uma exportação CSV real da aba DRE (linhas 5 a 982, que é a seção da Demonstração de Resultado propriamente dita; a partir da linha 988 começa a DFC — Demonstração de Fluxo de Caixa —, que é outro relatório e não entra aqui). Isso substitui uma primeira versão deste protótipo que só tinha 19 contas: a ferramenta de leitura usada antes retornava uma representação truncada/mesclada de várias abas da planilha, não só da DRE, e por isso a maior parte dos ~978 indicadores tinha ficado de fora. Com o CSV bruto foi possível confirmar:

- **978 linhas** no intervalo 5–982 (956 indicadores de fato, 22 linhas em branco no meio que viraram divisores visuais).
- O vocabulário **já usado de verdade** pelos auditores nessas colunas é `Conforme` / `Não Conforme` / `Não se aplica` (mais de 5.500 células preenchidas) — não `OK/Divergente/Não verificado`, que era um vocabulário genérico proposto antes de eu ver os dados reais. O protótipo foi corrigido para usar o vocabulário real.
- A coluna "Valor base/target" é predominantemente numérica (não é um status) — vira um campo de texto livre no painel, separado dos 5 dropdowns.
- 1.143 combinações indicador×mês já têm pelo menos um campo preenchido nos meses janeiro–junho e agosto.

## O que já funciona

- **Todos os 956 indicadores reais**, na ordem original da planilha, com o número da linha de origem guardado em cada item (útil para uma futura sincronização).
- Filtro de meses: chips para mostrar/ocultar cada mês; meses marcados com "novo" (julho, setembro–dezembro) não existiam na estrutura original e aqui já estão disponíveis desde o início.
- Cada célula indicador×mês abre um painel com os 5 campos de status (`Valores do banco`, `Coerência numérica`, `Coerência Contábil`, `Composição de Débito`, `Coerência Patrimonial`), usando o vocabulário real (`Conforme / Não Conforme / Não se aplica / Não verificado`), mais o campo `Valor base/target` e observações livres.
- **Adicionar indicador**: campo de texto acima da tabela, entra no fim da lista.
- **Remover indicador**: botão "×" em cada linha (com confirmação), apaga o item e os dados preenchidos dele neste protótipo.
- Persistência local via `localStorage` — os dados (incluindo indicadores adicionados/removidos) ficam só no seu navegador.

## Limitações conhecidas (é um protótipo)

- **Sem sincronização com o Google Sheets.** Os dados são locais a cada navegador; duas pessoas abrindo o protótipo não veem as mesmas edições, e indicadores adicionados/removidos por uma pessoa não aparecem para outra.
- **Hierarquia não é reconstruída.** A planilha original usa indentação visual (formatação, não conteúdo de célula) para mostrar que, por exemplo, "Ma Plage" está dentro de "RN", que está dentro de "Q.H - Hotels". Isso não é recuperável a partir de uma exportação de texto/CSV — só a ordem das linhas é preservada. A lista aqui é intencionalmente plana para não apresentar uma hierarquia inventada como se fosse real.
- Não inclui a seção de DFC (Demonstração de Fluxo de Caixa, a partir da linha 988) nem as outras abas da planilha (achados, ledger de transações) — o escopo aqui é só a DRE.

## Próximo passo: sincronizar com o Google Sheets

Para ligar isso à planilha real:

1. Criar um projeto no Google Cloud Console e ativar a **Google Sheets API**.
2. Criar uma **conta de serviço** (ou OAuth client, se cada auditor for logar com a própria conta Google) e compartilhar a planilha com o e-mail da conta de serviço como editor.
3. Substituir `getCell`/`setCellField` e o array `state.accounts` em `app.js` por chamadas a um backend leve que lê/escreve na planilha via `spreadsheets.values.get`/`update` (para status) e `spreadsheets.batchUpdate` (para inserir/remover linhas quando um indicador for adicionado/removido) — usando os intervalos exatos, já que a planilha inteira reaproveita as mesmas colunas para conteúdo diferente em outras abas.
4. Decidir a política de concorrência (dois auditores editando o mesmo indicador ao mesmo tempo, ou removendo um indicador que outra pessoa está editando).

Essa etapa exige credenciais e hospedagem (não pode rodar só no navegador, porque a chave da conta de serviço não pode ficar exposta no cliente).
