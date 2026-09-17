# DRE Independente — protótipo

Aplicativo estático (HTML/CSS/JS puro, sem build) que demonstra as mudanças avaliadas para a aba "DRE" fora da planilha original: menus suspensos de status, filtro de meses, e uma visão de auditoria organizada por **Propriedade → Centro de custo → Campo**.

## Rodando localmente

Abra `index.html` diretamente no navegador, ou sirva a pasta com qualquer servidor estático:

```
cd prototype
python3 -m http.server 8080
```

## As duas abas

- **Auditoria por propriedade**: reconstrói a hierarquia real de auditoria — Canal (RN/PB/AL/PI) → Propriedade (Ma Plage, Gaudium, Cond. Gaudium...) → Centro de custo (Administrativo, Limpeza, Lavanderia...) → Campo auditado (o item que de fato recebe `Conforme`/`Não Conforme`/`Não se aplica`) — para as seções **Bed&Breakfast Manager**, **Bed&Breakfast Leasing** e **Building management** (linhas 272–857 da aba DRE, a parte de custos operacionais que é auditada item a item).
- **Lista completa**: as demais 382 linhas da DRE (receita bruta, deduções, impostos, resultado) em lista plana, sem essa hierarquia — porque, ao contrário da seção de custos, elas não repetem o padrão Propriedade/Centro de custo.

## Como a hierarquia foi reconstruída

A planilha mostra essa hierarquia por **indentação visual** (formatação, não conteúdo de célula), que não sobrevive a uma exportação de texto/CSV. Em vez de inventar níveis, o gerador (rodado uma vez sobre a exportação real, resultado salvo em `data.js`) usou padrões que já existem nos dados:

- Uma propriedade é sempre seguida do seu primeiro centro de custo chamado **Administrativo** (ou variantes como `0. Administrativo`, `Admnistrativo`) — esse é o sinal confiável usado para saber onde uma propriedade começa.
- Um centro de custo é reconhecido por nome (`Limpeza`, `Lavanderia`, `Amenities`, `Vallet`, `Café da Manhã`, `Manutenção Diluída`, `OTA`, `Marketing`, `Compras`, `Manutenção`, `Experiência`, `Fumo QAVI`, `Taxa de cartão`), com ou sem o prefixo numérico de código que a planilha usa (`1. Limpeza`, `6. Lavanderia`...).
- Tudo que não é canal, propriedade nem centro de custo reconhecido é um **campo auditado** (a unidade que carrega o status real).

Isso cobre a maior parte das ~586 linhas dessas 3 seções com boa confiança, mas **não é 100% garantido em cada canto** — a partir de um certo ponto de "Building management" (por volta da linha 550 em diante) a planilha muda de padrão (passa a listar regiões e contas bancárias em vez de propriedades com Administrativo/Limpeza), e esses trechos podem ter ficado agrupados de forma menos precisa (aparecem como "Outros" quando nenhum centro de custo foi reconhecido). Vale conferir essas partes contra a planilha original antes de confiar cegamente nelas.

## O que já funciona

- Árvore completa e navegável (recolher/expandir por nó) das 3 seções auditadas, com contagem de campos por nó.
- Filtro de meses: chips para mostrar/ocultar cada mês; meses marcados com "novo" (julho, setembro–dezembro) não existiam na estrutura original.
- Clicar em qualquer linha (canal, propriedade, centro de custo ou campo — todos têm dados reais de auditoria na planilha) abre o painel com os 5 status (`Conforme / Não Conforme / Não se aplica / Não verificado`), campo `Valor base/target` e observações, com um seletor de mês dentro do próprio painel.
- **Adicionar campo**: botão "+" em cada linha de centro de custo, cria um novo campo auditável ali dentro.
- **Remover campo**: "×" em cada campo (com confirmação).
- Na aba Lista completa, os mesmos recursos de adicionar/remover indicador da versão anterior continuam disponíveis.
- Persistência local via `localStorage` (estrutura da árvore, indicadores adicionados/removidos e todos os status).

## Limitações conhecidas (é um protótipo)

- **Sem sincronização com o Google Sheets.** Tudo é local ao navegador de quem abrir a página.
- A reconstrução da hierarquia é uma inferência de padrões de texto, não uma leitura de formatação — ver seção acima.
- Não inclui a DFC (Demonstração de Fluxo de Caixa, a partir da linha 988) nem as outras abas da planilha.

## Próximo passo: sincronizar com o Google Sheets

1. Criar um projeto no Google Cloud Console e ativar a **Google Sheets API**.
2. Criar uma **conta de serviço** (ou OAuth client, se cada auditor for logar com a própria conta Google) e compartilhar a planilha com o e-mail da conta de serviço como editor.
3. Substituir a leitura/escrita de `getCell`/`setCellField` e as mutações de `state.tree`/`state.accounts` em `app.js` por chamadas a um backend leve que fale com `spreadsheets.values.get`/`update` (status) e `spreadsheets.batchUpdate` (inserir/remover linhas quando um campo for adicionado/removido) — usando os intervalos exatos, já que a planilha reaproveita as mesmas colunas para conteúdo diferente em outras partes.
4. Decidir a política de concorrência (duas pessoas editando o mesmo campo, ou removendo um campo que outra pessoa está editando).

Essa etapa exige credenciais e hospedagem — não pode rodar só no navegador, porque a chave da conta de serviço não pode ficar exposta no cliente.
