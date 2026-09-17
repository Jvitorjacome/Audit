// Dados-semente extraídos da aba "DRE" (linhas 7-43, blocos de mês jan-jun e ago).
// A hierarquia exata de indentação não é preservada na exportação de texto usada
// para o diagnóstico; a árvore abaixo foi reconstruída a partir dos rótulos e do
// agrupamento visível (RN / PB / AL como categorias de canal, propriedades como folhas).

const ACCOUNT_TREE = [
  {
    id: "receita-bruta", name: "RECEITA BRUTA", children: [
      {
        id: "qavi-host-revenue", name: "QAVI Host Revenue", children: [
          {
            id: "qh-hotels", name: "Q.H - Hotels", children: [
              { id: "qhh-rn", name: "RN", children: [
                { id: "qhh-rn-maplage", name: "Ma Plage" },
              ]},
              { id: "qhh-pb", name: "PB", children: [
                { id: "qhh-pb-gaudium", name: "Gaudium" },
              ]},
            ],
          },
          {
            id: "qh-leasing", name: "Q. H - Leasing", children: [
              { id: "qhl-rn", name: "RN", children: [
                { id: "qhl-rn-villa", name: "Villa di Milos" },
                { id: "qhl-rn-nalu", name: "Nalu" },
                { id: "qhl-rn-inter", name: "Interatlântico" },
                { id: "qhl-rn-marvin", name: "Marvin" },
              ]},
              { id: "qhl-pb", name: "PB", children: [
                { id: "qhl-pb-emp1", name: "EMP1" },
              ]},
              { id: "qhl-al", name: "AL", children: [
                { id: "qhl-al-emp2", name: "EMP2" },
              ]},
            ],
          },
          {
            id: "qh-others", name: "Q. H - Others (Luxury Homes)", children: [
              { id: "qho-rn", name: "RN", children: [
                { id: "qho-rn-uxua", name: "Uxua" },
              ]},
              { id: "qho-pb", name: "PB", children: [
                { id: "qho-pb-y", name: "Y" },
              ]},
              { id: "qho-al", name: "AL", children: [
                { id: "qho-al-believe", name: "Believe" },
                { id: "qho-al-anaya", name: "Anaya" },
                { id: "qho-al-kamara", name: "Kamará" },
              ]},
            ],
          },
          {
            id: "qh-shortstay", name: "Q. H - ShortStay", children: [
              { id: "qhs-rn", name: "RN" },
              { id: "qhs-pb", name: "PB" },
              { id: "qhs-al", name: "AL" },
            ],
          },
        ],
      },
      {
        id: "bnb-manager", name: "Bed&Breakfast Manager", children: [
          { id: "bnb-rn", name: "RN", children: [
            { id: "bnb-rn-maplage", name: "Ma Plage" },
          ]},
          { id: "bnb-comissao", name: "Comissão QAVI 13%", children: [
            { id: "bnb-comissao-mardepipa", name: "Mar de Pipa" },
            { id: "bnb-comissao-rafael", name: "Rafael Souza" },
          ]},
        ],
      },
    ],
  },
];

// inOriginal=false marca meses que não existem hoje na estrutura da planilha
// (julho está ausente como um bloco em branco; setembro-dezembro nunca foram criados).
const MONTHS = [
  { key: "jan", label: "Janeiro", inOriginal: true },
  { key: "fev", label: "Fevereiro", inOriginal: true },
  { key: "mar", label: "Março", inOriginal: true },
  { key: "abr", label: "Abril", inOriginal: true },
  { key: "mai", label: "Maio", inOriginal: true },
  { key: "jun", label: "Junho", inOriginal: true },
  { key: "jul", label: "Julho", inOriginal: false },
  { key: "ago", label: "Agosto", inOriginal: true },
  { key: "set", label: "Setembro", inOriginal: false },
  { key: "out", label: "Outubro", inOriginal: false },
  { key: "nov", label: "Novembro", inOriginal: false },
  { key: "dez", label: "Dezembro", inOriginal: false },
];

const STATUS_FIELDS = [
  { key: "valoresBanco", label: "Valores do banco" },
  { key: "coerenciaNumerica", label: "Coerência numérica (target)" },
  { key: "coerenciaContabil", label: "Coerência Contábil (competência)" },
  { key: "composicaoDebito", label: "Composição de Débito (código)" },
  { key: "coerenciaPatrimonial", label: "Coerência Patrimonial" },
];

const STATUS_OPTIONS = ["Não verificado", "OK", "Divergente"];
