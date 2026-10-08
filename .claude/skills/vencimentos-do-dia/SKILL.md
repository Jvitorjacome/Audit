---
name: vencimentos-do-dia
description: Avisa no Slack (#financeiroqavi, marcando o João Victor) e no chat todos os boletos, guias e faturas da QAVI que vencem HOJE. Uma única mensagem por dia, só no próprio dia do vencimento. Use quando for pedido o "aviso de vencimentos do dia" ou quando a rotina diária disparar.
---

# Vencimentos do dia

Objetivo: no dia em que um boleto, guia, DARF, DAS, fatura ou cobrança vence, mandar **uma única mensagem** no Slack com todos os vencimentos daquele dia. Nada antes, nada depois, nada repetido.

## Dados fixos

- Fuso: America/Fortaleza (Natal). "Hoje" é a data local.
- Slack: canal `#financeiroqavi` (ID `C04TWNYAWFM`, privado). Marcar o João Victor com `<@U08ATKTAKR7>`.
- App Caixa do Dia: `https://claude.ai/artifact/NR9yoPKGCFn3XkvDg5SqHT`, coleção `digests` (um documento por dia, `doc_id` = AAAA-MM-DD). Cada item pode ter `due` ("DD/MM"), `amount`, `title`, `from`, `subject`, `fromEmail`, `msgDate`.
- Controle de envio: mesmo app, coleção `alerts`, `doc_id` = data de hoje (AAAA-MM-DD).

## Passos

1. **Já avisou hoje?** `ArtifactData` → `get` em `alerts/<hoje>`. Se existir com `sent: true`, pare e diga em uma linha que o aviso de hoje já foi enviado.
2. **Coletar vencimentos de hoje** (DD/MM de hoje):
   - `ArtifactData` → `list` da coleção `digests` (últimos ~60 dias). Pegue todo item com `due` igual a DD/MM de hoje.
   - Gmail (`search_threads`), para pegar o que não entrou na Caixa do Dia: `("DD/MM/AAAA" OR "vencimento DD/MM" OR "vence em DD/MM" OR "vencimento em DD/MM") newer_than:60d -in:sent`. Abra com `get_thread` (PLAIN_TEXT) só o necessário para confirmar que é um vencimento de hoje e ler valor e beneficiário.
   - Regras recorrentes: guias com "vencimento no dia 20 de cada mês" (DAS, DARF de retidos, DCTFWeb/FGTS) vencem no dia 20 do mês seguinte à competência. Se o dia 20 cair em fim de semana ou feriado, o email da contabilidade costuma dizer como fica. Siga o que o email disser.
3. **Filtrar**:
   - Entram: boletos, guias de imposto, faturas e cobranças a pagar pela QAVI e empresas do grupo (DF Serviços, Ma Plage etc.).
   - Não entram: recibos de algo já pago, NFs sem cobrança, prazos que não são pagamento (ex.: fim de teste de sistema).
   - Junte duplicatas (o mesmo boleto citado em mais de um email) numa linha só.
4. **Se não houver nenhum vencimento hoje**: não mande nada no Slack. Diga no chat, em uma linha, que hoje não há vencimentos.
5. **Se houver**, mande **uma** mensagem com `slack_send_message` (channel_id `C04TWNYAWFM`), neste formato:

   ```
   <@U08ATKTAKR7> **Vencimentos de hoje (DD/MM)**
   • Beneficiário — descrição curta — R$ 0.000,00 [Abrir no Gmail](link)
   • ...
   **Total: R$ 0.000,00** (sem contar os itens com valor só no anexo)
   ```

   - Valor desconhecido: escreva "valor no anexo".
   - Link: busca do Gmail que abre na caixa de quem clica:
     `https://mail.google.com/mail/u/0/#search/` + URL-encode de `subject:"<assunto>" from:<email> after:<msgDate-1> before:<msgDate+2> in:anywhere` (omita `from:` quando o remetente for financeiro@quartoavista.com.br).
   - Máximo de ~4.800 caracteres. Se passar, resuma as guias da contabilidade numa linha por empresa.
6. **Registrar o envio**: `ArtifactData` → `set` em `alerts/<hoje>` com `{date, sent: true, sentAt (ISO), channel: "C04TWNYAWFM", count, items: [títulos], slackLink}`. Isso impede repetir a mensagem nas rodadas seguintes do mesmo dia.
7. **No chat**: responda com a mesma lista (curta) e o link da mensagem no Slack.

## Não fazer

- Não mandar lembrete antecipado nem cobrança atrasada. Só o dia exato.
- Não mandar mais de uma mensagem por dia, nem quando chegar um boleto novo à tarde.
- Não responder, encaminhar nem alterar emails. A leitura do Gmail é somente leitura.
