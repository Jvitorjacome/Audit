# DRE Independente — protótipo

Aplicativo estático (HTML/CSS/JS puro, sem build) que demonstra as duas mudanças avaliadas para a aba "DRE" fora da planilha original: menus suspensos de status por conta/mês e um filtro de meses visíveis.

## Rodando localmente

Abra `index.html` diretamente no navegador, ou sirva a pasta com qualquer servidor estático:

```
cd prototype
python3 -m http.server 8080
```

## O que já funciona

- Árvore de contas replicada a partir da aba DRE (linhas 7–43 da planilha original).
- Filtro de meses: chips para mostrar/ocultar cada mês; meses marcados com "novo" (julho, setembro–dezembro) não existiam na estrutura original e aqui já estão disponíveis desde o início.
- Cada célula conta×mês abre um painel com os 5 campos de status (`Valores do banco`, `Coerência numérica`, `Coerência Contábil`, `Composição de Débito`, `Coerência Patrimonial`), todos com a lista `OK / Divergente / Não verificado`, mais um campo de valor (R$) e observações livres.
- Persistência local via `localStorage` — os dados ficam só no seu navegador, não são compartilhados entre pessoas nem enviados a nenhum servidor.

## Limitações conhecidas (é um protótipo)

- **Sem sincronização com o Google Sheets.** Os dados são locais a cada navegador; duas pessoas abrindo o protótipo não veem as mesmas edições.
- A hierarquia de contas foi reconstruída a partir dos rótulos de texto da planilha (a exportação usada no diagnóstico não preserva indentação/agrupamento exatos) — vale revisar com quem monta a DRE antes de tratar como definitiva.
- Não inclui a tabela de achados (linhas 47–277 da aba original) nem o ledger de transações (linhas 299+) — o escopo aqui é só a grade de indicadores.

## Próximo passo: sincronizar com o Google Sheets

Para ligar isso à planilha real:

1. Criar um projeto no Google Cloud Console e ativar a **Google Sheets API**.
2. Criar uma **conta de serviço** (ou OAuth client, se cada auditor for logar com a própria conta Google) e compartilhar a planilha com o e-mail da conta de serviço como editor.
3. Substituir as funções `getCell`/`setCell` em `app.js` por chamadas a um backend leve (ex.: uma função serverless) que lê/escreve na planilha via `spreadsheets.values.get`/`update`, usando os intervalos exatos (não colunas inteiras — a aba DRE reaproveita as mesmas colunas para tabelas diferentes em linhas mais abaixo, então o range tem que ser preciso).
4. Decidir a política de concorrência (dois auditores editando a mesma célula ao mesmo tempo) — a API do Sheets não resolve isso sozinha.

Essa etapa exige credenciais e hospedagem (não pode rodar só no navegador, porque a chave da conta de serviço não pode ficar exposta no cliente).
