// Configuração estática do app: meses, os 5 indicadores de auditoria e as
// opções de status. Não vem mais do banco (são conceitos fixos do sistema),
// mas os dados da árvore (seções/estados/propriedades/centros/campos) e os
// status mensais em si agora vêm do Supabase — ver supabaseClient.js e app.js.

const YEAR = 2026;

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
// month number (1-12), na mesma ordem da coluna `month` em audit_status
MONTHS.forEach((m, i) => (m.number = i + 1));
const MONTH_BY_NUMBER = Object.fromEntries(MONTHS.map((m) => [m.number, m]));

const STATUS_FIELDS = [
  { key: "valoresBanco", label: "Valores do banco", column: "valores_banco" },
  { key: "coerenciaNumerica", label: "Coerência numérica (target)", column: "coerencia_numerica" },
  { key: "coerenciaContabil", label: "Coerência Contábil (competência)", column: "coerencia_contabil" },
  { key: "composicaoDebito", label: "Composição de Débito (código)", column: "composicao_debito" },
  { key: "coerenciaPatrimonial", label: "Coerência Patrimonial", column: "coerencia_patrimonial" },
];

const STATUS_OPTIONS = ["Não verificado", "Conforme", "Não Conforme", "Não se aplica"];

// UI (português, como o auditor vê) <-> banco (enum audit_status_value)
const STATUS_LABEL_TO_DB = {
  "Não verificado": "nao_verificado",
  "Conforme": "conforme",
  "Não Conforme": "nao_conforme",
  "Não se aplica": "nao_se_aplica",
};
const STATUS_DB_TO_LABEL = Object.fromEntries(
  Object.entries(STATUS_LABEL_TO_DB).map(([label, db]) => [db, label])
);

// hierarquia: kind -> {table, parentColumn} para inserir/apagar nós dinamicamente
const HIERARCHY = {
  channel: { table: "states", parentColumn: "section_id" },
  property: { table: "properties", parentColumn: "state_id" },
  centro: { table: "cost_centers", parentColumn: "property_id" },
  campo: { table: "audit_fields", parentColumn: "cost_center_id" },
};

// Rastreio de ocorrência (colunas E-H da aba "Observações" da planilha
// "Setor Auditoria"). Aparecem em cascata no painel: cada campo só é
// mostrado depois que o anterior da lista tem um valor marcado.
// `dynamic: true` significa que a lista de opções vem do banco (tabela
// ocorrencia_options), editável por um admin direto no painel — as opções
// abaixo em `options` são só o fallback estático pra "Corrigido?", que é
// sempre binário e não precisa crescer.
const OCORRENCIA_FIELDS = [
  { key: "ocorrenciaTipo", label: "Ocorrências por tipo", column: "ocorrencia_tipo", dynamic: true },
  { key: "setorResponsavel", label: "Setor responsável", column: "setor_responsavel", dynamic: true },
  { key: "funcionarioResponsavel", label: "Funcionário responsável", column: "funcionario_responsavel", dynamic: true },
  { key: "corrigido", label: "Corrigido?", column: "corrigido", options: ["Sim", "Não"] },
];

// valor especial usado no <select> pra representar "+ Adicionar novo..."
const ADD_NEW_OPTION = "__add_new__";
