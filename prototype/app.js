// ---------- tema claro/escuro ----------
// index.html já aplica o tema salvo (ou "dark", padrão) na tag <html> antes
// do primeiro paint, direto num <script> inline — aqui só cuida do botão:
// mostrar o ícone certo e trocar de tema ao clicar.

function applyThemeIcon(theme) {
  const sun = document.getElementById("themeIconSun");
  const moon = document.getElementById("themeIconMoon");
  if (!sun || !moon) return;
  // .hidden (propriedade IDL) não reflete de forma confiável em elementos
  // <svg> neste ambiente — mexe direto no atributo, que é o que o CSS
  // ([hidden] { display: none !important; }) de fato lê.
  const setHidden = (el, isHidden) => (isHidden ? el.setAttribute("hidden", "") : el.removeAttribute("hidden"));
  setHidden(sun, theme !== "dark");
  setHidden(moon, theme === "dark");
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("dre-theme", theme);
  } catch (e) {
    /* private window / storage bloqueado — só não persiste entre sessões */
  }
  applyThemeIcon(theme);
  // Os gráficos (Chart.js) são desenhados com cores fixas escolhidas na hora
  // — trocar só a variável CSS não redesenha o que já está no canvas.
  // Se a aba Indicadores estiver visível, renderiza de novo com as cores do
  // novo tema (dashboard.js, carregado antes deste clique ser possível).
  const indicadoresTab = document.getElementById("tabIndicadores");
  if (indicadoresTab && !indicadoresTab.hidden && typeof renderDashboard === "function") {
    renderDashboard();
  }
}

applyThemeIcon(document.documentElement.getAttribute("data-theme") || "dark");
document.getElementById("btnThemeToggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  setTheme(current === "dark" ? "light" : "dark");
});

// ---------- helpers ----------

function groupBy(rows, key) {
  const out = {};
  for (const r of rows) (out[r[key]] ||= []).push(r);
  return out;
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function describeError(err, context) {
  console.error("[erro]", context || "", err);
  const msg = (err && err.message) || String(err || "erro desconhecido");
  if (/row-level security|permission denied/i.test(msg)) {
    if (context === "structure") {
      return "Você não tem permissão de administrador para alterar a estrutura da árvore. (" + msg + ")";
    }
    return "Erro de permissão ao salvar (" + msg + "). Tente recarregar a página; se persistir, avise o administrador.";
  }
  return msg;
}

function childrenOf(node, kind) {
  if (kind === "section") return node.channels;
  if (kind === "channel") return node.properties;
  if (kind === "property") return node.centros;
  if (kind === "centro") return node.campos;
  return null;
}
function childKind(kind) {
  return { section: "channel", channel: "property", property: "centro", centro: "campo" }[kind] || null;
}

const KIND_LABEL = { section: "Seção", channel: "Estado", property: "Propriedade", centro: "Centro de custo", campo: "Campo auditado", variavel: "Conta variável" };
const KIND_ADD_LABEL = { section: "Estado", channel: "Propriedade", property: "Centro de custo", centro: "Campo" };

function makeNode(kind, name, id, row = null) {
  const base = { id, name, row, isActive: true, retiredYear: null, retiredMonth: null };
  if (kind === "section") return { ...base, channels: [] };
  if (kind === "channel") return { ...base, properties: [] };
  if (kind === "property") return { ...base, centros: [] };
  if (kind === "centro") return { ...base, campos: [] };
  return { id, name, row, isActive: true, retiredYear: null, retiredMonth: null }; // campo: leaf
}

function walkTree(nodes, kind, visit) {
  for (const node of nodes) {
    visit(node, kind);
    const kids = childrenOf(node, kind);
    if (kids) walkTree(kids, childKind(kind), visit);
  }
}

// ---------- view prefs (localStorage: só preferências de tela, não dados de auditoria) ----------

const VIEW_PREFS_KEY = "dre-view-prefs-v1";

function loadViewPrefs() {
  try {
    const raw = localStorage.getItem(VIEW_PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveViewPrefs() {
  try {
    localStorage.setItem(
      VIEW_PREFS_KEY,
      JSON.stringify({ visibleMonths: state.visibleMonths, collapsed: state.collapsed, showHidden: state.showHidden })
    );
  } catch (e) {
    /* private window / storage blocked - só afeta preferência de tela */
  }
}

const savedPrefs = loadViewPrefs();
let state = {
  tree: [],
  cells: {},
  visibleMonths: (savedPrefs && savedPrefs.visibleMonths) || MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
  collapsed: (savedPrefs && savedPrefs.collapsed) || {},
  showHidden: (savedPrefs && savedPrefs.showHidden) || false,
  ocorrenciaOptions: {},
  variableEntries: [],
};

let currentUser = null;
let currentProfile = null;
let isAdmin = false;
// Leitor lê tudo, mas nunca escreve nada (nem status, nem contas variáveis)
// — RLS já garante isso no banco; canEdit espelha a mesma regra na UI, pra
// nem mostrar os controles de edição pra quem não pode usá-los.
let canEdit = false;

// Reordenar campos por arrastar (só admin, só dentro do mesmo centro de
// custo — ver attachCampoDragHandlers). Guarda o campo/lista de irmãos que
// começou a ser arrastado, pra saber contra quem comparar no dragover/drop.
let dragCampo = null;

// ---------- cells (status mensal, agora vindos do Supabase) ----------

function cellKey(id, monthKey) {
  return `${id}::${monthKey}`;
}
function getCell(id, monthKey) {
  return state.cells[cellKey(id, monthKey)] || {};
}
function statusTone(value) {
  if (value === "Conforme") return "ok";
  if (value === "Não Conforme") return "div";
  if (value === "Não se aplica") return "na";
  return "unv";
}
// Um campo tem 5 indicadores por mês; para a tabela (visão densa) eles viram
// UM selo por célula, priorizando o pior caso, em vez de 5 pontos coloridos.
// Separado em *FromCell pra ser reaproveitado por contas variáveis também
// (que não têm um "id + monthKey" pra buscar em state.cells — já chegam
// prontas como uma linha do banco, convertida com rowToCell).
function cellAggregateToneFromCell(cell) {
  if (cell.isHidden) return { tone: "hidden", label: "Oculto" };
  let naoConforme = 0, naoVerificado = 0;
  for (const f of STATUS_FIELDS) {
    const v = cell[f.key] || "Não verificado";
    if (v === "Não Conforme") naoConforme++;
    else if (v === "Não verificado") naoVerificado++;
  }
  if (naoConforme > 0) return { tone: "div", label: "Não conforme" };
  if (naoVerificado > 0) return { tone: "unv", label: "Pendente" };
  return { tone: "ok", label: "Conforme" };
}
function cellDetailTitleFromCell(cell) {
  if (cell.isHidden) return "Oculto neste mês — clique pra editar ou reexibir.";
  return STATUS_FIELDS.map((f) => `${f.label}: ${cell[f.key] || "Não verificado"}`).join(" · ");
}
function cellAggregateTone(id, monthKey) {
  return cellAggregateToneFromCell(getCell(id, monthKey));
}
function cellDetailTitle(id, monthKey) {
  return cellDetailTitleFromCell(getCell(id, monthKey));
}

async function persistCellField(auditFieldId, monthKey, uiFieldKey, uiValue) {
  const month = MONTHS.find((m) => m.key === monthKey).number;
  const payload = { audit_field_id: auditFieldId, year: YEAR, month, updated_by: currentUser.id };
  const statusField = STATUS_FIELDS.find((f) => f.key === uiFieldKey);
  const ocorrenciaField = OCORRENCIA_FIELDS.find((f) => f.key === uiFieldKey);
  if (statusField) payload[statusField.column] = STATUS_LABEL_TO_DB[uiValue];
  else if (ocorrenciaField) payload[ocorrenciaField.column] = uiValue || null;
  else if (uiFieldKey === "valorBaseTarget") payload.valor_base_target = uiValue;
  else if (uiFieldKey === "observacoes") payload.observacoes = uiValue;

  const { error } = await sb.from("audit_status").upsert(payload, { onConflict: "audit_field_id,year,month" });
  if (error) throw error;

  const key = cellKey(auditFieldId, monthKey);
  state.cells[key] = { ...getCell(auditFieldId, monthKey), [uiFieldKey]: uiValue };
}

async function clearCell(auditFieldId, monthKey) {
  const month = MONTHS.find((m) => m.key === monthKey).number;
  const payload = { audit_field_id: auditFieldId, year: YEAR, month, updated_by: currentUser.id };
  for (const f of STATUS_FIELDS) payload[f.column] = "nao_verificado";
  for (const f of OCORRENCIA_FIELDS) payload[f.column] = null;
  payload.valor_base_target = null;
  payload.observacoes = null;

  const { error } = await sb.from("audit_status").upsert(payload, { onConflict: "audit_field_id,year,month" });
  if (error) throw error;

  const cell = { valorBaseTarget: "", observacoes: "", isHidden: getCell(auditFieldId, monthKey).isHidden || false };
  for (const f of STATUS_FIELDS) cell[f.key] = "Não verificado";
  for (const f of OCORRENCIA_FIELDS) cell[f.key] = "";
  state.cells[cellKey(auditFieldId, monthKey)] = cell;
}

// Oculta (ou reexibe) só ESTE campo, só NESTE mês — diferente de
// setCampoActive, que oculta o campo inteiro em todos os meses.
async function setCellHidden(auditFieldId, monthKey, hidden) {
  const month = MONTHS.find((m) => m.key === monthKey).number;
  const payload = { audit_field_id: auditFieldId, year: YEAR, month, is_hidden: hidden, updated_by: currentUser.id };
  const { error } = await sb.from("audit_status").upsert(payload, { onConflict: "audit_field_id,year,month" });
  if (error) throw error;
  state.cells[cellKey(auditFieldId, monthKey)] = { ...getCell(auditFieldId, monthKey), isHidden: hidden };
}

// ---------- contas variáveis (despesas que não aparecem todo mês) ----------
// Ao contrário de audit_fields/audit_status, uma conta variável não tem uma
// "estrutura" que persiste por todos os meses — cada linha JÁ é o lançamento
// de um mês específico. Por isso não existe upsert por (id, mês): a linha
// sempre já existe (foi criada explicitamente com createVariableEntry) e só
// atualiza direto por id.

function findVariableEntry(id) {
  return (state.variableEntries || []).find((e) => e.id === id);
}

async function createVariableEntry(costCenterId, monthNumber, rawName) {
  const siblingCount = (state.variableEntries || []).filter(
    (e) => e.cost_center_id === costCenterId && e.month === monthNumber
  ).length;
  const payload = {
    cost_center_id: costCenterId, year: YEAR, month: monthNumber, name: rawName.trim(),
    sort_order: siblingCount, created_by: currentUser.id, updated_by: currentUser.id,
  };
  const { data, error } = await sb.from("variable_entries").insert(payload).select().single();
  if (error) throw error;
  state.variableEntries.push(data);
  return data;
}

async function renameVariableEntry(id, newName) {
  const { error } = await sb.from("variable_entries").update({ name: newName, updated_by: currentUser.id }).eq("id", id);
  if (error) throw error;
  const entry = findVariableEntry(id);
  if (entry) entry.name = newName;
}

async function deleteVariableEntry(id) {
  const { error } = await sb.from("variable_entries").delete().eq("id", id);
  if (error) throw error;
  state.variableEntries = (state.variableEntries || []).filter((e) => e.id !== id);
}

async function persistVariableField(id, uiFieldKey, uiValue) {
  const payload = { updated_by: currentUser.id };
  const statusField = STATUS_FIELDS.find((f) => f.key === uiFieldKey);
  const ocorrenciaField = OCORRENCIA_FIELDS.find((f) => f.key === uiFieldKey);
  if (statusField) payload[statusField.column] = STATUS_LABEL_TO_DB[uiValue];
  else if (ocorrenciaField) payload[ocorrenciaField.column] = uiValue || null;
  else if (uiFieldKey === "valorBaseTarget") payload.valor_base_target = uiValue;
  else if (uiFieldKey === "observacoes") payload.observacoes = uiValue;

  const { error } = await sb.from("variable_entries").update(payload).eq("id", id);
  if (error) throw error;
  const entry = findVariableEntry(id);
  if (entry) Object.assign(entry, payload);
}

async function clearVariableEntry(id) {
  const payload = { updated_by: currentUser.id };
  for (const f of STATUS_FIELDS) payload[f.column] = "nao_verificado";
  for (const f of OCORRENCIA_FIELDS) payload[f.column] = null;
  payload.valor_base_target = null;
  payload.observacoes = null;

  const { error } = await sb.from("variable_entries").update(payload).eq("id", id);
  if (error) throw error;
  const entry = findVariableEntry(id);
  if (entry) Object.assign(entry, payload);
}

function countLeaves(node, kind) {
  if (kind === "campo") return 1;
  const kids = childrenOf(node, kind);
  const nextKind = childKind(kind);
  return kids.reduce((sum, k) => sum + countLeaves(k, nextKind), 0);
}

// Audit status only ever belongs to a campo (the thing actually being audited).
// Everything above it (centro de custo, propriedade, estado, seção) is a grouping,
// so instead of its own status it shows a rolled-up bar over its descendant campos.
function aggregateAudit(node, kind, months) {
  let conforme = 0, naoConforme = 0, resolved = 0, total = 0;
  function visitCampo(campo) {
    for (const m of months) {
      const cell = getCell(campo.id, m.key);
      if (cell.isHidden) continue;
      for (const f of STATUS_FIELDS) {
        total++;
        const v = cell[f.key] || "Não verificado";
        if (v === "Conforme") { conforme++; resolved++; }
        else if (v === "Não Conforme") { naoConforme++; resolved++; }
        else if (v === "Não se aplica") { resolved++; }
      }
    }
  }
  function walk(n, k) {
    if (k === "campo") { visitCampo(n); return; }
    for (const child of childrenOf(n, k)) walk(child, childKind(k));
  }
  walk(node, kind);
  return { conforme, naoConforme, resolved, total };
}
function countDescendantNodes(node, kind) {
  const kids = childrenOf(node, kind);
  if (!kids) return 0;
  const nextKind = childKind(kind);
  return kids.length + kids.reduce((sum, k) => sum + countDescendantNodes(k, nextKind), 0);
}

// Estado/Propriedade/Centro de custo "retirado a partir de" um mês (ver
// retireNode) fica escondido da árvore só quando NENHUM dos meses
// selecionados no filtro atual é anterior ao corte — se pelo menos um mês
// visível ainda é de antes da retirada, continua aparecendo (pra revisar o
// histórico daquele período). `months` é a lista já filtrada por
// state.visibleMonths (visibleMonthList()).
function isRetiredForVisibleMonths(node, months) {
  if (node.retiredMonth == null) return false;
  const retiredYear = node.retiredYear == null ? YEAR : node.retiredYear;
  return months.every((m) => (YEAR === retiredYear ? m.number >= node.retiredMonth : YEAR > retiredYear));
}

// ---------- Supabase: carregar árvore + status ----------

function buildTree(sections, states, properties, costCenters, auditFields, showHidden) {
  const statesBySection = groupBy(states, "section_id");
  const propertiesByState = groupBy(properties, "state_id");
  const costCentersByProperty = groupBy(costCenters, "property_id");
  const auditFieldsByCostCenter = groupBy(auditFields, "cost_center_id");

  function buildCampos(costCenterId) {
    return (auditFieldsByCostCenter[costCenterId] || [])
      .filter((af) => showHidden || af.is_active !== false)
      .map((af) => ({
        id: af.id, name: af.name, row: af.source_row, isActive: af.is_active !== false,
        retiredYear: af.retired_year, retiredMonth: af.retired_month,
      }));
  }

  function buildCentros(propertyId) {
    return (costCentersByProperty[propertyId] || [])
      .filter((cc) => showHidden || cc.is_active !== false)
      .map((cc) => ({
        id: cc.id, name: cc.name, row: cc.source_row,
        isActive: cc.is_active !== false, retiredYear: cc.retired_year, retiredMonth: cc.retired_month,
        campos: buildCampos(cc.id),
      }));
  }

  function buildProperties(stateId) {
    return (propertiesByState[stateId] || [])
      .filter((p) => showHidden || p.is_active !== false)
      .map((p) => ({
        id: p.id, name: p.name, row: p.source_row,
        isActive: p.is_active !== false, retiredYear: p.retired_year, retiredMonth: p.retired_month,
        centros: buildCentros(p.id),
      }));
  }

  function buildChannels(sectionId) {
    return (statesBySection[sectionId] || [])
      .filter((st) => showHidden || st.is_active !== false)
      .map((st) => ({
        id: st.id, name: st.name, row: st.source_row,
        isActive: st.is_active !== false, retiredYear: st.retired_year, retiredMonth: st.retired_month,
        properties: buildProperties(st.id),
      }));
  }

  // Oculto (is_active=false) some daqui — igual ao campo já fazia. Retirado
  // (retired_month) NÃO é filtrado aqui: continua em state.tree sempre
  // (nunca sai dos indicadores/histórico), só é escondido na hora de
  // renderizar a árvore da aba Auditoria (ver isRetiredForVisibleMonths).
  return sections.map((s) => ({
    id: s.id, name: s.name, row: s.source_row,
    channels: buildChannels(s.id),
  }));
}

// Converte uma linha crua do banco (audit_status OU variable_entries — as
// duas têm exatamente as mesmas colunas de indicador/ocorrência) pro formato
// "cell" que o resto da UI usa (chaves em camelCase). Reaproveitado pelas
// contas variáveis, que não passam por buildCells (não têm cellKey — já
// chegam como uma linha só, sem mês variável).
function rowToCell(row) {
  const cell = { valorBaseTarget: row.valor_base_target || "", observacoes: row.observacoes || "", isHidden: !!row.is_hidden };
  for (const f of STATUS_FIELDS) cell[f.key] = STATUS_DB_TO_LABEL[row[f.column]] || "Não verificado";
  for (const f of OCORRENCIA_FIELDS) cell[f.key] = row[f.column] || "";
  return cell;
}

function buildCells(statusRows) {
  const cells = {};
  for (const row of statusRows) {
    const m = MONTH_BY_NUMBER[row.month];
    if (!m) continue;
    cells[cellKey(row.audit_field_id, m.key)] = rowToCell(row);
  }
  return cells;
}

let rawHierarchy = null; // cache cru da última carga, pra reconstruir a árvore sem rede ao alternar "mostrar ocultos"

function rebuildTreeFromCache() {
  if (!rawHierarchy) return;
  state.tree = buildTree(
    rawHierarchy.sections, rawHierarchy.states, rawHierarchy.properties,
    rawHierarchy.costCenters, rawHierarchy.auditFields, state.showHidden
  );
}

// O Supabase/PostgREST limita cada resposta a 1000 linhas por padrão. A
// tabela audit_status já passou disso (cresce a cada mês/campo preenchido) —
// uma busca sem paginação simplesmente descarta o resto em silêncio, sem
// erro nenhum, só "sumindo" dados recém-editados da tela. Isso pagina até
// trazer tudo, em qualquer tabela, não só nessa.
async function fetchAllRows(table, orderColumn, applyFilters) {
  const pageSize = 1000;
  let allRows = [];
  let from = 0;
  for (;;) {
    let q = sb.from(table).select("*").order(orderColumn).order("id").range(from, from + pageSize - 1);
    if (applyFilters) q = applyFilters(q);
    const { data, error } = await q;
    if (error) throw error;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function loadAll() {
  const [sections, states, properties, costCenters, auditFields, ocorrenciaOptionsRows, variableEntries] = await Promise.all([
    fetchAllRows("sections", "sort_order"),
    fetchAllRows("states", "sort_order"),
    fetchAllRows("properties", "sort_order"),
    fetchAllRows("cost_centers", "sort_order"),
    fetchAllRows("audit_fields", "sort_order"),
    fetchAllRows("ocorrencia_options", "sort_order"),
    fetchAllRows("variable_entries", "sort_order", (q) => q.eq("year", YEAR)),
  ]);

  rawHierarchy = { sections, states, properties, costCenters, auditFields };
  rebuildTreeFromCache();

  state.ocorrenciaOptions = {};
  for (const row of ocorrenciaOptionsRows) {
    (state.ocorrenciaOptions[row.field_key] ||= []).push(row.value);
  }

  state.variableEntries = variableEntries;
  state.cells = buildCells(await fetchAllRows("audit_status", "id", (q) => q.eq("year", YEAR)));
}

async function addOcorrenciaOption(fieldKey, value) {
  const sortOrder = (state.ocorrenciaOptions[fieldKey] || []).length;
  const { error } = await sb.from("ocorrencia_options").insert({
    field_key: fieldKey, value, sort_order: sortOrder, created_by: currentUser.id,
  });
  if (error) throw error;
  (state.ocorrenciaOptions[fieldKey] ||= []).push(value);
}

async function addNode(kind, parentId, siblingCount, rawName) {
  const finalName = kind === "channel" ? rawName.trim().toUpperCase() : rawName.trim();
  const payload = { name: finalName, sort_order: siblingCount, created_by: currentUser.id };
  let table;
  if (kind === "section") {
    table = "sections"; // seção não tem coluna de pai — é o topo da hierarquia
  } else {
    const cfg = HIERARCHY[kind];
    table = cfg.table;
    payload[cfg.parentColumn] = parentId;
  }
  const { data, error } = await sb.from(table).insert(payload).select().single();
  if (error) throw error;
  return makeNode(kind, data.name, data.id, data.source_row);
}

async function renameCampo(id, newName) {
  const { error } = await sb.from("audit_fields").update({ name: newName }).eq("id", id);
  if (error) throw error;
}

async function setCampoActive(id, isActive) {
  const { error } = await sb.from("audit_fields").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

// Grava a ordem de novo (sort_order = índice na lista) pra todos os campos
// de um centro de custo — chamado depois de um arrastar-e-soltar. Regrava
// todo mundo, não só quem mudou de posição: mais simples e robusto do que
// calcular exatamente quais linhas o reorder afetou.
async function reorderCampos(campos) {
  const results = await Promise.all(
    campos.map((c, i) => sb.from("audit_fields").update({ sort_order: i }).eq("id", c.id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

// Arrastar-e-soltar pra reordenar campos dentro do MESMO centro de custo
// (não move entre centros — dragCampo.parentArray precisa ser exatamente o
// mesmo array de irmãos da linha em que soltou). API nativa de drag do
// navegador, sem biblioteca nenhuma.
function attachCampoDragHandlers(tr, node, parentArray) {
  tr.addEventListener("dragover", (e) => {
    if (!dragCampo || dragCampo.parentArray !== parentArray || dragCampo.node === node) return;
    e.preventDefault();
    const before = e.clientY - tr.getBoundingClientRect().top < tr.getBoundingClientRect().height / 2;
    tr.classList.toggle("drag-over-top", before);
    tr.classList.toggle("drag-over-bottom", !before);
  });
  tr.addEventListener("dragleave", () => {
    tr.classList.remove("drag-over-top", "drag-over-bottom");
  });
  tr.addEventListener("drop", async (e) => {
    e.preventDefault();
    tr.classList.remove("drag-over-top", "drag-over-bottom");
    if (!dragCampo || dragCampo.parentArray !== parentArray || dragCampo.node === node) return;
    const before = e.clientY - tr.getBoundingClientRect().top < tr.getBoundingClientRect().height / 2;
    const fromIdx = parentArray.indexOf(dragCampo.node);
    if (fromIdx < 0) return;
    const [moved] = parentArray.splice(fromIdx, 1);
    let toIdx = parentArray.indexOf(node) + (before ? 0 : 1);
    parentArray.splice(toIdx, 0, moved);
    dragCampo = null;
    renderTreeTable();
    try {
      await reorderCampos(parentArray);
    } catch (err) {
      alert("Não foi possível salvar a nova ordem: " + describeError(err, "structure"));
    }
  });
}

// Ocultar/mostrar Estado, Propriedade ou Centro de custo (reversível, sem
// relação com mês) — mesma ideia de setCampoActive, generalizada pros 3
// níveis de estrutura que agora também têm is_active (migração 009).
async function setNodeActive(kind, id, isActive) {
  const cfg = HIERARCHY[kind];
  const { error } = await sb.from(cfg.table).update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

// Substitui o antigo deleteNode (DELETE de verdade, que levava junto todo o
// histórico/indicadores de tudo abaixo). Grava só a partir de qual mês o
// item para de existir — a linha e tudo abaixo dela continuam intactas no
// banco pra sempre, só somem da árvore da aba Auditoria dali pra frente (ver
// isRetiredForVisibleMonths em app.js).
async function retireNode(kind, id, year, month) {
  const cfg = HIERARCHY[kind];
  const { error } = await sb.from(cfg.table).update({ retired_year: year, retired_month: month }).eq("id", id);
  if (error) throw error;
}

async function reactivateNode(kind, id) {
  const cfg = HIERARCHY[kind];
  const { error } = await sb.from(cfg.table).update({ retired_year: null, retired_month: null }).eq("id", id);
  if (error) throw error;
}

// × não apaga mais de verdade (isso destruía o histórico/indicadores de
// tudo que existia embaixo, ou o histórico do próprio campo). Em vez disso
// grava "retirado a partir do mês X": a linha continua no banco intacta, só
// some da árvore quando NENHUM dos meses selecionados no filtro é anterior
// a esse mês (ver isRetiredForVisibleMonths, chamado antes de renderizar
// cada linha). Enquanto estiver "retirado", o botão vira ↺ (reativar).
// Compartilhado entre Estado/Propriedade/Centro de custo e Campo — mesma
// regra nos 4 níveis (ex.: funcionário que saiu no meio do ano).
function buildRetireButton(kind, node) {
  const nested = childrenOf(node, kind) ? countDescendantNodes(node, kind) : 0;
  const isRetired = node.retiredMonth != null;
  const retireBtn = document.createElement("button");
  retireBtn.type = "button";
  retireBtn.className = "row-delete";
  retireBtn.textContent = isRetired ? "↺" : "×";
  retireBtn.title = isRetired
    ? `Reativar ${KIND_LABEL[kind].toLowerCase()} (remove a data de retirada)`
    : nested > 0
    ? `Retirar a partir de um mês (leva junto ${nested} item(ns) abaixo)`
    : `Retirar ${KIND_LABEL[kind].toLowerCase()} a partir de um mês`;
  retireBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    retireBtn.disabled = true;
    try {
      if (isRetired) {
        if (!confirm(`Reativar "${node.name}"? Ela volta a aparecer normalmente em todos os meses.`)) {
          retireBtn.disabled = false;
          return;
        }
        await reactivateNode(kind, node.id);
        node.retiredYear = null;
        node.retiredMonth = null;
      } else {
        const monthsHint = MONTHS.map((m) => `${m.number}-${m.label}`).join(", ");
        const monthRaw = prompt(
          `A partir de qual mês "${node.name}" deixa de existir (não aparece mais a partir dele)?\n` +
            `O histórico e os indicadores dos meses anteriores continuam intactos — nada é apagado.\n${monthsHint}`
        );
        if (!monthRaw || !monthRaw.trim()) {
          retireBtn.disabled = false;
          return;
        }
        const monthDef = MONTH_BY_NUMBER[parseInt(monthRaw.trim(), 10)];
        if (!monthDef) {
          alert("Mês inválido — digite um número de 1 a 12.");
          retireBtn.disabled = false;
          return;
        }
        const warn = nested > 0 ? ` Some junto da árvore com os ${nested} item(ns) dentro dele/dela.` : "";
        if (!confirm(`Retirar "${node.name}" a partir de ${monthDef.label}?${warn}`)) {
          retireBtn.disabled = false;
          return;
        }
        await retireNode(kind, node.id, YEAR, monthDef.number);
        node.retiredYear = YEAR;
        node.retiredMonth = monthDef.number;
      }
      renderTreeTable();
      renderSummary();
    } catch (err) {
      alert("Não foi possível salvar: " + describeError(err, "structure"));
    } finally {
      retireBtn.disabled = false;
    }
  });
  return retireBtn;
}

// ---------- DOM refs ----------

const monthFilterEl = document.getElementById("monthFilter");
const summaryEl = document.getElementById("summary");
const drawerEl = document.getElementById("drawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const treeWrap = document.getElementById("treeWrap");
const authScreenEl = document.getElementById("authScreen");
const appScreenEl = document.getElementById("appScreen");
const loadErrorEl = document.getElementById("loadError");

function visibleMonthList() {
  return MONTHS.filter((m) => state.visibleMonths.includes(m.key));
}

function renderMonthFilter() {
  monthFilterEl.innerHTML = "";
  for (const m of MONTHS) {
    const active = state.visibleMonths.includes(m.key);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (active ? " chip-active" : "");
    chip.setAttribute("aria-pressed", String(active));
    chip.innerHTML = `<span>${m.label}</span>` + (!m.inOriginal ? '<span class="chip-badge">novo</span>' : "");
    chip.addEventListener("click", () => {
      state.visibleMonths = active
        ? state.visibleMonths.filter((k) => k !== m.key)
        : [...state.visibleMonths, m.key].sort((a, b) => MONTHS.findIndex((mm) => mm.key === a) - MONTHS.findIndex((mm) => mm.key === b));
      saveViewPrefs();
      render();
    });
    monthFilterEl.appendChild(chip);
  }
}

function monthCellsFragment(node, months) {
  const frag = document.createDocumentFragment();
  for (const m of months) {
    const td = document.createElement("td");
    td.className = "cell-month";
    const { tone, label } = cellAggregateTone(node.id, m.key);

    const inner = document.createElement("span");
    inner.className = "cell-month-inner";
    const badge = document.createElement("span");
    badge.className = `status-badge status-badge-${tone}`;
    badge.textContent = label;
    inner.appendChild(badge);

    if (canEdit) {
      // Apagar é sempre uma ação de UM mês só: cada célula tem seu próprio
      // ×, que limpa só aquele campo naquele mês — nunca a linha inteira.
      // canEdit (não isAdmin): auditor também edita status, só leitor não.
      const cellClearBtn = document.createElement("button");
      cellClearBtn.type = "button";
      cellClearBtn.className = "cell-clear";
      cellClearBtn.title = `Apagar dados de "${node.name}" em ${m.label}`;
      cellClearBtn.textContent = "×";
      cellClearBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Apagar os dados de "${node.name}" em ${m.label}? Isso não afeta outros meses. Essa ação não pode ser desfeita.`)) return;
        cellClearBtn.disabled = true;
        try {
          await clearCell(node.id, m.key);
          renderTreeTable();
          renderSummary();
        } catch (err) {
          alert("Não foi possível apagar: " + describeError(err));
          cellClearBtn.disabled = false;
        }
      });
      inner.appendChild(cellClearBtn);
    }

    td.appendChild(inner);
    td.title = cellDetailTitle(node.id, m.key);
    if (tone === "div") td.classList.add("cell-tone-div");
    if (tone === "hidden") td.classList.add("cell-month-hidden");
    // clicar numa célula de mês específico abre o painel já naquele mês
    // (em vez de sempre abrir no primeiro mês visível da linha).
    td.addEventListener("click", (e) => {
      e.stopPropagation();
      openDrawer(node, m, KIND_LABEL.campo);
    });
    frag.appendChild(td);
  }
  return frag;
}

function auditBarCell(node, kind, months) {
  const td = document.createElement("td");
  td.className = "cell-auditbar";
  td.colSpan = Math.max(months.length, 1);
  const { conforme, naoConforme, resolved, total } = aggregateAudit(node, kind, months);
  const pct = total ? (resolved / total) * 100 : 0;

  const bar = document.createElement("div");
  bar.className = "auditbar";
  const fill = document.createElement("span");
  fill.className = "auditbar-fill";
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);

  const label = document.createElement("span");
  label.className = "auditbar-label";
  label.textContent = total ? `${Math.round(pct)}% verificado` : "sem campos";
  if (naoConforme > 0) {
    const alert = document.createElement("span");
    alert.className = "auditbar-alert";
    alert.textContent = ` · ${naoConforme} não conforme`;
    label.appendChild(alert);
  }

  td.appendChild(bar);
  td.appendChild(label);
  td.title = `${conforme} conforme, ${naoConforme} não conforme, ${resolved} de ${total} avaliações verificadas (campos × meses × indicadores) nesta ramificação`;
  return td;
}

// ---------- tree rendering ----------

function renderTreeTable() {
  const months = visibleMonthList();
  const table = document.createElement("table");
  table.className = "dre-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.className = "col-account";
  th0.textContent = "Estado / Propriedade / Centro de custo / Campo";
  headRow.appendChild(th0);
  for (const m of months) {
    const th = document.createElement("th");
    th.textContent = m.label;
    if (!m.inOriginal) th.classList.add("th-new");
    headRow.appendChild(th);
  }
  const thActions = document.createElement("th");
  thActions.className = "col-actions";
  headRow.appendChild(thActions);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  function renderNode(node, kind, depth, parentArray) {
    // Retirado a partir de um mês que já cobre TODO o filtro de mês atual
    // (nenhum mês selecionado é anterior ao corte) → some da árvore, mas
    // continua em state.tree pra sempre (nunca some dos indicadores nem do
    // histórico — só não é mais renderizado aqui). "Mostrar campos ocultos"
    // revela de novo, igual ao oculto manual. Ver retireNode/reactivateNode.
    if (kind !== "section" && !state.showHidden && isRetiredForVisibleMonths(node, months)) {
      return;
    }
    const kids = childrenOf(node, kind);
    const nextKind = childKind(kind);
    const hasKids = Array.isArray(kids);
    const collapsed = !!state.collapsed[node.id];

    const tr = document.createElement("tr");
    tr.className =
      `row-tree row-depth-${Math.min(depth, 5)} row-kind-${kind}` +
      (node.isActive === false || node.retiredMonth != null ? " row-inactive" : "");
    const tdName = document.createElement("td");
    tdName.className = "col-account";
    tdName.style.paddingLeft = `${10 + depth * 20}px`;

    if (kind === "campo" && isAdmin && parentArray) {
      // Só admin arrasta, e só entre campos do mesmo centro de custo — o
      // "handle" é um alvo pequeno de propósito, pra não disparar drag sem
      // querer ao clicar no resto da linha (que abre o painel do campo).
      const dragHandle = document.createElement("span");
      dragHandle.className = "row-drag-handle";
      dragHandle.title = "Arrastar pra reordenar";
      dragHandle.textContent = "⠿";
      dragHandle.draggable = true;
      dragHandle.addEventListener("click", (e) => e.stopPropagation());
      dragHandle.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        dragCampo = { node, parentArray };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", node.id); // Firefox exige setData pra permitir o drag
      });
      dragHandle.addEventListener("dragend", () => {
        dragCampo = null;
        document
          .querySelectorAll(".drag-over-top, .drag-over-bottom")
          .forEach((el) => el.classList.remove("drag-over-top", "drag-over-bottom"));
      });
      tdName.appendChild(dragHandle);
      attachCampoDragHandlers(tr, node, parentArray);
    }

    if (hasKids) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "toggle";
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.title = collapsed ? "Expandir" : "Recolher";
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        state.collapsed[node.id] = !collapsed;
        saveViewPrefs();
        renderTreeTable();
      });
      tdName.appendChild(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "toggle-spacer";
      tdName.appendChild(spacer);
    }

    if (kind !== "campo") {
      const badge = document.createElement("span");
      badge.className = `kind-badge kind-badge-${kind}`;
      badge.textContent = KIND_LABEL[kind];
      tdName.appendChild(badge);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "node-name";
    nameSpan.textContent = node.name || "(sem nome)";
    nameSpan.title = `${KIND_LABEL[kind]}${node.row ? " · linha " + node.row + " na planilha original" : " · adicionado neste sistema"}`;
    tdName.appendChild(nameSpan);

    if (node.isActive === false) {
      const hiddenBadge = document.createElement("span");
      hiddenBadge.className = "node-count";
      hiddenBadge.textContent = " (oculto)";
      tdName.appendChild(hiddenBadge);
    }
    if (node.retiredMonth != null) {
      const retiredBadge = document.createElement("span");
      retiredBadge.className = "node-count";
      const monthLabel = (MONTH_BY_NUMBER[node.retiredMonth] || {}).label || node.retiredMonth;
      retiredBadge.textContent = ` (retirado a partir de ${monthLabel}/${node.retiredYear || YEAR})`;
      tdName.appendChild(retiredBadge);
    }

    if (hasKids) {
      const count = document.createElement("span");
      count.className = "node-count";
      count.textContent = ` (${countLeaves(node, kind)})`;
      tdName.appendChild(count);
    }
    tr.appendChild(tdName);

    if (kind === "campo") {
      tr.appendChild(monthCellsFragment(node, months));
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        openDrawer(node, months[0], KIND_LABEL[kind]);
      });
    } else {
      tr.appendChild(auditBarCell(node, kind, months));
    }

    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    if (hasKids && isAdmin) {
      const addLabel = KIND_ADD_LABEL[kind];
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "row-add";
      addBtn.title = `Adicionar ${addLabel.toLowerCase()} aqui dentro`;
      addBtn.textContent = "+";
      addBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const name = prompt(`Nome do novo ${addLabel.toLowerCase()}:`);
        if (!name || !name.trim()) return;
        addBtn.disabled = true;
        try {
          const child = await addNode(nextKind, node.id, kids.length, name);
          kids.push(child);
          state.collapsed[node.id] = false;
          saveViewPrefs();
          renderTreeTable();
          renderSummary();
        } catch (err) {
          alert("Não foi possível adicionar: " + describeError(err, "structure"));
        } finally {
          addBtn.disabled = false;
        }
      });
      tdActions.appendChild(addBtn);
    }
    if (kind === "centro" && canEdit) {
      // Conta variável (despesa que não aparece todo mês): não é
      // "estrutura" da árvore (não é admin-only) — é trabalho de auditoria
      // do dia a dia, igual marcar status, então admin/auditor podem (não
      // isAdmin — só leitor fica de fora, igual ao resto da edição).
      const addVarBtn = document.createElement("button");
      addVarBtn.type = "button";
      addVarBtn.className = "row-add row-add-variavel";
      addVarBtn.title = "Adicionar conta variável (despesa que não aparece todo mês) neste centro de custo";
      addVarBtn.textContent = "+ Variável";
      addVarBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const name = prompt('Nome da conta variável (ex.: "Reembolso viagem João"):');
        if (!name || !name.trim()) return;
        const monthsHint = MONTHS.map((m) => `${m.number}-${m.label}`).join(", ");
        const monthRaw = prompt(`Em qual mês?\n${monthsHint}`);
        if (!monthRaw || !monthRaw.trim()) return;
        const monthDef = MONTH_BY_NUMBER[parseInt(monthRaw.trim(), 10)];
        if (!monthDef) {
          alert("Mês inválido — digite um número de 1 a 12.");
          return;
        }
        addVarBtn.disabled = true;
        try {
          const entry = await createVariableEntry(node.id, monthDef.number, name);
          if (!state.visibleMonths.includes(monthDef.key)) {
            state.visibleMonths = [...state.visibleMonths, monthDef.key].sort(
              (a, b) => MONTHS.findIndex((mm) => mm.key === a) - MONTHS.findIndex((mm) => mm.key === b)
            );
          }
          state.collapsed[node.id] = false;
          saveViewPrefs();
          renderTreeTable();
          renderSummary();
          openVariableDrawer(entry);
        } catch (err) {
          alert("Não foi possível criar: " + describeError(err));
        } finally {
          addVarBtn.disabled = false;
        }
      });
      tdActions.appendChild(addVarBtn);
    }
    if (kind === "campo" && isAdmin) {
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "row-rename";
      renameBtn.title = "Renomear campo";
      renameBtn.textContent = "✎";
      renameBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newName = prompt("Novo nome do campo:", node.name);
        if (!newName || !newName.trim() || newName.trim() === node.name) return;
        renameBtn.disabled = true;
        try {
          await renameCampo(node.id, newName.trim());
          node.name = newName.trim();
          renderTreeTable();
        } catch (err) {
          alert("Não foi possível renomear: " + describeError(err, "structure"));
        } finally {
          renameBtn.disabled = false;
        }
      });
      tdActions.appendChild(renameBtn);

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "row-toggle-active";
      const wasActive = node.isActive !== false;
      toggleBtn.title = wasActive ? "Ocultar campo (não precisa mais auditar)" : "Mostrar campo de novo";
      toggleBtn.textContent = wasActive ? "🗕" : "🗗";
      toggleBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        toggleBtn.disabled = true;
        try {
          await setCampoActive(node.id, !wasActive);
          node.isActive = !wasActive;
          if (!state.showHidden && wasActive) {
            const idx = parentArray.indexOf(node);
            if (idx >= 0) parentArray.splice(idx, 1);
          }
          renderTreeTable();
          renderSummary();
        } catch (err) {
          alert("Não foi possível " + (wasActive ? "ocultar" : "mostrar") + " o campo: " + describeError(err, "structure"));
        } finally {
          toggleBtn.disabled = false;
        }
      });
      tdActions.appendChild(toggleBtn);
      // Retirar/reativar a partir de um mês (funcionário que saiu, item que
      // parou de existir) — mesmo recurso de Estado/Propriedade/Centro de
      // custo, ver buildRetireButton. Antes campo não tinha essa opção, só
      // ocultar (que esconde em TODOS os meses, sem noção de data).
      tdActions.appendChild(buildRetireButton(kind, node));
    }
    if (kind !== "campo" && kind !== "section" && parentArray && isAdmin) {
      // Ocultar/mostrar (reversível, sem relação com mês) — mesmo padrão do
      // campo, agora também em Estado/Propriedade/Centro de custo.
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "row-toggle-active";
      const wasActive = node.isActive !== false;
      toggleBtn.title = wasActive
        ? `Ocultar ${KIND_LABEL[kind].toLowerCase()} (some da árvore, sem apagar nada)`
        : `Mostrar ${KIND_LABEL[kind].toLowerCase()} de novo`;
      toggleBtn.textContent = wasActive ? "🗕" : "🗗";
      toggleBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        toggleBtn.disabled = true;
        try {
          await setNodeActive(kind, node.id, !wasActive);
          node.isActive = !wasActive;
          if (!state.showHidden && wasActive) {
            const idx = parentArray.indexOf(node);
            if (idx >= 0) parentArray.splice(idx, 1);
          }
          renderTreeTable();
          renderSummary();
        } catch (err) {
          alert("Não foi possível " + (wasActive ? "ocultar" : "mostrar") + ": " + describeError(err, "structure"));
        } finally {
          toggleBtn.disabled = false;
        }
      });
      tdActions.appendChild(toggleBtn);
      tdActions.appendChild(buildRetireButton(kind, node));
    }
    tr.appendChild(tdActions);
    tbody.appendChild(tr);

    if (hasKids && !collapsed) {
      for (const child of kids) renderNode(child, nextKind, depth + 1, kids);
      if (kind === "centro") {
        const entries = (state.variableEntries || []).filter((e) => e.cost_center_id === node.id);
        for (const entry of entries) renderVariableEntryRow(entry, depth + 1);
      }
    }
  }

  // Uma conta variável não faz parte de state.tree (ver ---- contas
  // variáveis ---- em app.js) — renderiza como mais uma linha "folha",
  // visualmente parecida com um campo, mas só tem selo de status na coluna
  // do mês em que ela de fato existe; nos outros meses visíveis mostra um
  // traço neutro, não clicável.
  function renderVariableEntryRow(entry, depth) {
    const monthDef = MONTH_BY_NUMBER[entry.month];
    const monthLabel = monthDef ? monthDef.label : `mês ${entry.month}`;

    const tr = document.createElement("tr");
    tr.className = `row-tree row-depth-${Math.min(depth, 5)} row-kind-variavel`;
    const tdName = document.createElement("td");
    tdName.className = "col-account";
    tdName.style.paddingLeft = `${10 + depth * 20}px`;

    const spacer = document.createElement("span");
    spacer.className = "toggle-spacer";
    tdName.appendChild(spacer);

    const badge = document.createElement("span");
    badge.className = "kind-badge kind-badge-variavel";
    badge.textContent = "Variável";
    tdName.appendChild(badge);

    const nameSpan = document.createElement("span");
    nameSpan.className = "node-name";
    nameSpan.textContent = entry.name || "(sem nome)";
    nameSpan.title = `${KIND_LABEL.variavel} · ${monthLabel} de ${entry.year}`;
    tdName.appendChild(nameSpan);

    const monthBadge = document.createElement("span");
    monthBadge.className = "node-count";
    monthBadge.textContent = ` (${monthLabel})`;
    tdName.appendChild(monthBadge);
    tr.appendChild(tdName);

    tr.appendChild(variableEntryCellsFragment(entry, months));
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openVariableDrawer(entry);
    });

    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";

    if (canEdit) {
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "row-rename";
      renameBtn.title = "Renomear conta variável";
      renameBtn.textContent = "✎";
      renameBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newName = prompt("Novo nome do lançamento:", entry.name);
        if (!newName || !newName.trim() || newName.trim() === entry.name) return;
        renameBtn.disabled = true;
        try {
          await renameVariableEntry(entry.id, newName.trim());
          renderTreeTable();
        } catch (err) {
          alert("Não foi possível renomear: " + describeError(err));
        } finally {
          renameBtn.disabled = false;
        }
      });
      tdActions.appendChild(renameBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "row-delete";
      delBtn.title = "Apagar este lançamento variável";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Apagar o lançamento "${entry.name}" (${monthLabel} de ${entry.year})? Essa ação não pode ser desfeita.`)) return;
        delBtn.disabled = true;
        try {
          await deleteVariableEntry(entry.id);
          renderTreeTable();
          renderSummary();
        } catch (err) {
          alert("Não foi possível apagar: " + describeError(err));
          delBtn.disabled = false;
        }
      });
      tdActions.appendChild(delBtn);
    }

    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }

  function variableEntryCellsFragment(entry, monthsToRender) {
    const frag = document.createDocumentFragment();
    const entryMonth = MONTH_BY_NUMBER[entry.month];
    for (const m of monthsToRender) {
      const td = document.createElement("td");
      if (!entryMonth || m.key !== entryMonth.key) {
        td.className = "cell-month cell-month-na";
        const dash = document.createElement("span");
        dash.className = "cell-month-placeholder";
        dash.textContent = "—";
        td.appendChild(dash);
        frag.appendChild(td);
        continue;
      }
      td.className = "cell-month";
      const cell = rowToCell(entry);
      const { tone, label } = cellAggregateToneFromCell(cell);
      const inner = document.createElement("span");
      inner.className = "cell-month-inner";
      const badge = document.createElement("span");
      badge.className = `status-badge status-badge-${tone}`;
      badge.textContent = label;
      inner.appendChild(badge);
      td.appendChild(inner);
      td.title = cellDetailTitleFromCell(cell);
      if (tone === "div") td.classList.add("cell-tone-div");
      td.addEventListener("click", (e) => {
        e.stopPropagation();
        openVariableDrawer(entry);
      });
      frag.appendChild(td);
    }
    return frag;
  }

  for (const section of state.tree) renderNode(section, "section", 0, null);

  table.appendChild(tbody);
  treeWrap.innerHTML = "";
  treeWrap.appendChild(table);
}

// ---------- summary ----------

function renderSummary() {
  const months = visibleMonthList();
  const ids = [];
  walkTree(state.tree, "section", (node, kind) => {
    if (kind === "campo") ids.push(node.id);
  });
  let filled = 0, div = 0, total = 0;
  for (const id of ids) {
    for (const m of months) {
      const cell = getCell(id, m.key);
      if (cell.isHidden) continue;
      for (const f of STATUS_FIELDS) {
        total++;
        const v = cell[f.key];
        if (v) filled++;
        if (v === "Não Conforme") div++;
      }
    }
  }
  // Contas variáveis entram na mesma contagem — só as que caem num mês
  // atualmente visível (já que elas só existem num mês fixo, ao contrário
  // do campo, que existe em todos e só mostra o que estiver visível).
  const monthKeysVisible = new Set(months.map((m) => m.key));
  let variableCount = 0;
  for (const entry of state.variableEntries || []) {
    const m = MONTH_BY_NUMBER[entry.month];
    if (!m || !monthKeysVisible.has(m.key)) continue;
    variableCount++;
    const cell = rowToCell(entry);
    for (const f of STATUS_FIELDS) {
      total++;
      const v = cell[f.key];
      if (v) filled++;
      if (v === "Não Conforme") div++;
    }
  }
  const pct = total ? Math.round((filled / total) * 100) : 0;
  summaryEl.innerHTML = `
    <div class="stat"><span class="stat-value">${ids.length + variableCount}</span><span class="stat-label">campos auditados</span></div>
    <div class="stat"><span class="stat-value">${months.length}</span><span class="stat-label">meses visíveis</span></div>
    <div class="stat"><span class="stat-value">${pct}%</span><span class="stat-label">campos verificados</span></div>
    <div class="stat stat-danger"><span class="stat-value">${div}</span><span class="stat-label">não conformes</span></div>
  `;
}

function render() {
  renderMonthFilter();
  renderTreeTable();
  renderSummary();
}

// ---------- drawer ----------

let drawerCtx = null;

function setSaving(kind) {
  const el = document.getElementById("drawerSaveStatus");
  if (!el) return;
  el.hidden = false;
  if (kind === "saving") {
    el.textContent = "Salvando…";
    el.className = "save-status save-status-pending";
  } else if (kind === "saved") {
    el.textContent = "Salvo";
    el.className = "save-status save-status-ok";
    setTimeout(() => { if (el.textContent === "Salvo") el.hidden = true; }, 1500);
  } else {
    el.textContent = "Erro ao salvar";
    el.className = "save-status save-status-error";
  }
}

function makeTextPersister(uiFieldKey) {
  return debounce(async (value) => {
    setSaving("saving");
    try {
      await drawerCtx.persistField(uiFieldKey, value);
      setSaving("saved");
    } catch (err) {
      setSaving("error");
    }
  }, 600);
}
const persistValor = makeTextPersister("valorBaseTarget");
const persistObs = makeTextPersister("observacoes");

// Abre o painel lateral pra um campo auditado (fixo), num mês específico —
// permite trocar de mês, e tem a opção "ocultar só este mês" (além do 🗕 da
// linha, que oculta em todos os meses). Ver openVariableDrawer pro mesmo
// painel aplicado a uma conta variável (sem seletor de mês nem ocultar,
// já que uma conta variável só existe num mês só).
function openDrawer(node, month, kindLabel) {
  const months = visibleMonthList();
  const useMonth = month || months[0];
  if (!useMonth) return;
  renderDrawerBody({
    title: node.name || "(sem nome)",
    kindLabel: kindLabel || "",
    subtitle: node.row ? `linha ${node.row} na planilha original` : "adicionado neste sistema",
    monthPicker: { months, selected: useMonth, onChange: (m) => openDrawer(node, m, kindLabel) },
    getCell: () => getCell(node.id, useMonth.key),
    persistField: (key, value) => persistCellField(node.id, useMonth.key, key, value),
    clearAll: () => clearCell(node.id, useMonth.key),
    clearConfirmText: `Limpar todos os campos de auditoria de "${node.name}" em ${useMonth.label}? Essa ação não pode ser desfeita.`,
    setHidden: (hidden) => setCellHidden(node.id, useMonth.key, hidden),
    hideLabel: `Ocultar "${node.name}" em ${useMonth.label}`,
    onReopen: () => openDrawer(node, useMonth, kindLabel),
  });
}

// Mesmo painel, pra uma conta variável (ver ---- contas variáveis ---- mais
// acima): sem seletor de mês (o mês já é fixo naquela linha) e sem "ocultar
// este mês" (não existem "outros meses" pra distinguir).
function openVariableDrawer(entry) {
  const m = MONTH_BY_NUMBER[entry.month];
  const centro = (rawHierarchy && rawHierarchy.costCenters || []).find((c) => c.id === entry.cost_center_id);
  renderDrawerBody({
    title: entry.name || "(sem nome)",
    kindLabel: KIND_LABEL.variavel,
    subtitle: `${m ? m.label : "mês " + entry.month} de ${entry.year}` + (centro ? ` · ${centro.name}` : ""),
    monthPicker: null,
    getCell: () => rowToCell(findVariableEntry(entry.id) || entry),
    persistField: (key, value) => persistVariableField(entry.id, key, value),
    clearAll: () => clearVariableEntry(entry.id),
    clearConfirmText: `Limpar todos os indicadores de "${entry.name}"? Essa ação não pode ser desfeita.`,
    setHidden: null,
    hideLabel: null,
    onReopen: () => openVariableDrawer(entry),
  });
}

function renderDrawerBody(ctx) {
  drawerCtx = ctx;
  const cell = ctx.getCell();

  document.getElementById("drawerTitle").textContent = ctx.title;
  document.getElementById("drawerKind").textContent = ctx.kindLabel || "";
  const saveStatusEl = document.getElementById("drawerSaveStatus");
  if (saveStatusEl) saveStatusEl.hidden = true;

  const monthFieldEl = document.getElementById("drawerMonthField");
  const monthSelectEl = document.getElementById("drawerMonth");
  monthFieldEl.hidden = !ctx.monthPicker;
  if (ctx.monthPicker) {
    monthSelectEl.innerHTML = "";
    for (const m of ctx.monthPicker.months) {
      const o = document.createElement("option");
      o.value = m.key;
      o.textContent = m.label;
      if (m.key === ctx.monthPicker.selected.key) o.selected = true;
      monthSelectEl.appendChild(o);
    }
    monthSelectEl.onchange = () => ctx.monthPicker.onChange(MONTHS.find((m) => m.key === monthSelectEl.value));
  }

  document.getElementById("drawerSubtitle").textContent = ctx.subtitle;

  const fieldsEl = document.getElementById("drawerFields");
  fieldsEl.innerHTML = "";

  if (canEdit) {
    const clearAllBtn = document.createElement("button");
    clearAllBtn.type = "button";
    clearAllBtn.className = "btn btn-clear-all";
    clearAllBtn.textContent = ctx.monthPicker ? "Limpar tudo deste mês" : "Limpar tudo";
    clearAllBtn.addEventListener("click", async () => {
      if (!confirm(ctx.clearConfirmText)) return;
      clearAllBtn.disabled = true;
      setSaving("saving");
      try {
        await ctx.clearAll();
        setSaving("saved");
        ctx.onReopen();
        renderTreeTable();
        renderSummary();
      } catch (err) {
        setSaving("error");
        alert("Não foi possível limpar: " + describeError(err));
        clearAllBtn.disabled = false;
      }
    });
    fieldsEl.appendChild(clearAllBtn);
  }

  // Oculta só este campo, só neste mês (diferente do 🗕 da linha, que oculta
  // o campo inteiro em todos os meses) — pra quando ele não se aplica num
  // mês específico, mas continua valendo nos outros. Não existe pra contas
  // variáveis (ctx.setHidden é null): elas já só existem num mês. Leitor
  // não vê esse controle (não edita nada).
  if (ctx.setHidden && canEdit) {
    const hideMonthLabel = document.createElement("label");
    hideMonthLabel.className = "month-hide-toggle";
    const hideMonthCheckbox = document.createElement("input");
    hideMonthCheckbox.type = "checkbox";
    hideMonthCheckbox.checked = !!cell.isHidden;
    const hideMonthText = document.createElement("span");
    hideMonthText.textContent = ctx.hideLabel;
    hideMonthLabel.appendChild(hideMonthCheckbox);
    hideMonthLabel.appendChild(hideMonthText);
    hideMonthCheckbox.addEventListener("change", async () => {
      const hidden = hideMonthCheckbox.checked;
      hideMonthCheckbox.disabled = true;
      setSaving("saving");
      try {
        await ctx.setHidden(hidden);
        setSaving("saved");
        renderTreeTable();
        renderSummary();
      } catch (err) {
        setSaving("error");
        hideMonthCheckbox.checked = !hidden;
        alert("Não foi possível " + (hidden ? "ocultar" : "reexibir") + ": " + describeError(err));
      } finally {
        hideMonthCheckbox.disabled = false;
      }
    });
    fieldsEl.appendChild(hideMonthLabel);
  }

  for (const f of STATUS_FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const value = cell[f.key] || "Não verificado";
    wrap.innerHTML = `<span class="field-label">${f.label}</span>`;
    const row = document.createElement("span");
    row.className = "field-row";
    const select = document.createElement("select");
    select.className = `select select-${statusTone(value)}`;
    select.disabled = !canEdit;
    for (const opt of STATUS_OPTIONS) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener("change", async () => {
      select.className = `select select-${statusTone(select.value)}`;
      setSaving("saving");
      try {
        await drawerCtx.persistField(f.key, select.value);
        setSaving("saved");
        renderTreeTable();
        renderSummary();
      } catch (err) {
        setSaving("error");
        alert("Não foi possível salvar: " + describeError(err));
      }
    });
    row.appendChild(select);
    if (canEdit) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "field-clear";
      clearBtn.title = `Limpar "${f.label}" (volta pra Não verificado)`;
      clearBtn.textContent = "×";
      clearBtn.addEventListener("click", async () => {
        setSaving("saving");
        try {
          await drawerCtx.persistField(f.key, "Não verificado");
          select.value = "Não verificado";
          select.className = "select select-unv";
          setSaving("saved");
          renderTreeTable();
          renderSummary();
        } catch (err) {
          setSaving("error");
          alert("Não foi possível limpar: " + describeError(err));
        }
      });
      row.appendChild(clearBtn);
    }
    wrap.appendChild(row);
    fieldsEl.appendChild(wrap);
  }

  // Ocorrência: aparece em cascata — cada campo só é oferecido depois que o
  // anterior já tem um valor marcado, pra não poluir o painel à toa.
  const ocorrenciaHeading = document.createElement("div");
  ocorrenciaHeading.className = "field-group-label";
  ocorrenciaHeading.textContent = "Ocorrência (opcional)";
  fieldsEl.appendChild(ocorrenciaHeading);

  for (const f of OCORRENCIA_FIELDS) {
    const priorField = OCORRENCIA_FIELDS[OCORRENCIA_FIELDS.indexOf(f) - 1];
    if (priorField && !cell[priorField.key]) break;

    const wrap = document.createElement("label");
    wrap.className = "field";
    const value = cell[f.key] || "";
    wrap.innerHTML = `<span class="field-label">${f.label}</span>`;
    const row = document.createElement("span");
    row.className = "field-row";
    const select = document.createElement("select");
    select.className = "select";
    select.disabled = !canEdit;
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "— selecionar —";
    if (!value) blankOpt.selected = true;
    select.appendChild(blankOpt);
    const opts = f.dynamic ? (state.ocorrenciaOptions[f.key] || []) : f.options;
    for (const opt of opts) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      select.appendChild(o);
    }
    if (f.dynamic && isAdmin) {
      const addOpt = document.createElement("option");
      addOpt.value = ADD_NEW_OPTION;
      addOpt.textContent = "+ Adicionar novo...";
      select.appendChild(addOpt);
    }
    select.addEventListener("change", async () => {
      if (select.value === ADD_NEW_OPTION) {
        const newValue = prompt(`Novo valor para "${f.label}":`);
        if (!newValue || !newValue.trim()) {
          select.value = value;
          return;
        }
        setSaving("saving");
        try {
          await addOcorrenciaOption(f.key, newValue.trim());
          await drawerCtx.persistField(f.key, newValue.trim());
          setSaving("saved");
          ctx.onReopen();
        } catch (err) {
          setSaving("error");
          alert("Não foi possível adicionar a opção: " + describeError(err, "structure"));
          select.value = value;
        }
        return;
      }
      setSaving("saving");
      try {
        await drawerCtx.persistField(f.key, select.value);
        setSaving("saved");
        ctx.onReopen();
      } catch (err) {
        setSaving("error");
        alert("Não foi possível salvar: " + describeError(err));
      }
    });
    row.appendChild(select);
    if (canEdit) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "field-clear";
      clearBtn.title = `Limpar "${f.label}"`;
      clearBtn.textContent = "×";
      clearBtn.addEventListener("click", async () => {
        if (!value) return;
        setSaving("saving");
        try {
          await drawerCtx.persistField(f.key, "");
          setSaving("saved");
          ctx.onReopen();
        } catch (err) {
          setSaving("error");
          alert("Não foi possível limpar: " + describeError(err));
        }
      });
      row.appendChild(clearBtn);
    }
    wrap.appendChild(row);
    fieldsEl.appendChild(wrap);
  }

  const valorInput = document.getElementById("drawerValor");
  valorInput.value = cell.valorBaseTarget || "";
  valorInput.disabled = !canEdit;
  valorInput.oninput = () => persistValor(valorInput.value);

  const obsInput = document.getElementById("drawerObservacoes");
  obsInput.value = cell.observacoes || "";
  obsInput.disabled = !canEdit;
  obsInput.oninput = () => persistObs(obsInput.value);

  drawerEl.classList.add("drawer-open");
  drawerBackdrop.classList.add("backdrop-visible");
}

function closeDrawer() {
  drawerEl.classList.remove("drawer-open");
  drawerBackdrop.classList.remove("backdrop-visible");
  drawerCtx = null;
}

document.getElementById("drawerClose").addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDrawer();
    closeCreatePanel();
  }
});

// ---------- toolbar ----------

document.getElementById("btnAllMonths").addEventListener("click", () => {
  state.visibleMonths = MONTHS.map((m) => m.key);
  saveViewPrefs();
  render();
});
document.getElementById("btnOriginalMonths").addEventListener("click", () => {
  state.visibleMonths = MONTHS.filter((m) => m.inOriginal).map((m) => m.key);
  saveViewPrefs();
  render();
});
document.getElementById("btnRefresh").addEventListener("click", async () => {
  treeWrap.innerHTML = '<p class="loading-note">Atualizando dados do banco…</p>';
  try {
    clearLoadError();
    await loadAll();
    render();
  } catch (err) {
    showLoadError(err);
  }
});
document.getElementById("btnToggleHidden").addEventListener("click", () => {
  state.showHidden = !state.showHidden;
  saveViewPrefs();
  rebuildTreeFromCache();
  render();
  renderAuthBar();
});

// ---------- painel "adicionar item" (admin: cria qualquer nível da hierarquia,
// escolhendo explicitamente o tipo e cada nível pai em cascata) ----------

const createBackdrop = document.getElementById("createBackdrop");
const createPanel = document.getElementById("createPanel");
const createKindEl = document.getElementById("createKind");
const createParentsEl = document.getElementById("createParents");
const createNameEl = document.getElementById("createName");
const createErrorEl = document.getElementById("createError");
const createSubmitBtn = document.getElementById("createSubmit");

// kind -> cadeia de níveis pai que precisam ser escolhidos em cascata antes dele
const CREATE_PARENT_CHAIN = {
  section: [],
  channel: ["section"],
  property: ["section", "channel"],
  centro: ["section", "channel", "property"],
  campo: ["section", "channel", "property", "centro"],
};

let createParentSelects = [];

function createNodesAtLevel(levelIndex, chain) {
  let nodes = state.tree;
  for (let i = 0; i < levelIndex; i++) {
    const levelKind = chain[i];
    const sel = createParentSelects[i];
    const node = nodes.find((n) => n.id === (sel && sel.value)) || nodes[0];
    nodes = node ? childrenOf(node, levelKind) || [] : [];
  }
  return nodes;
}

function buildCreateParentSelect(levelIndex, chain) {
  const levelKind = chain[levelIndex];
  const nodes = createNodesAtLevel(levelIndex, chain);
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const labelSpan = document.createElement("span");
  labelSpan.className = "field-label";
  labelSpan.textContent = KIND_LABEL[levelKind];
  const select = document.createElement("select");
  select.className = "select";
  for (const node of nodes) {
    const opt = document.createElement("option");
    opt.value = node.id;
    opt.textContent = node.name;
    select.appendChild(opt);
  }
  if (!nodes.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = `nenhum(a) ${KIND_LABEL[levelKind].toLowerCase()} cadastrado(a) ainda`;
    select.appendChild(opt);
  }
  wrapper.appendChild(labelSpan);
  wrapper.appendChild(select);
  select.addEventListener("change", () => rebuildCreateParentsFrom(levelIndex + 1, chain));
  return { wrapper, select };
}

function rebuildCreateParentsFrom(startIndex, chain) {
  createParentSelects.length = startIndex;
  while (createParentsEl.children.length > startIndex) {
    createParentsEl.removeChild(createParentsEl.lastChild);
  }
  for (let i = startIndex; i < chain.length; i++) {
    const { wrapper, select } = buildCreateParentSelect(i, chain);
    createParentsEl.appendChild(wrapper);
    createParentSelects[i] = select;
  }
}

function renderCreateParents() {
  createParentsEl.innerHTML = "";
  createParentSelects = [];
  rebuildCreateParentsFrom(0, CREATE_PARENT_CHAIN[createKindEl.value] || []);
}

function openCreatePanel() {
  createNameEl.value = "";
  createErrorEl.hidden = true;
  renderCreateParents();
  createPanel.classList.add("drawer-open");
  createBackdrop.classList.add("backdrop-visible");
}
function closeCreatePanel() {
  createPanel.classList.remove("drawer-open");
  createBackdrop.classList.remove("backdrop-visible");
}

async function handleCreateSubmit() {
  const kind = createKindEl.value;
  const name = createNameEl.value.trim();
  createErrorEl.hidden = true;
  if (!name) {
    createErrorEl.textContent = "Digite um nome.";
    createErrorEl.hidden = false;
    return;
  }

  const chain = CREATE_PARENT_CHAIN[kind] || [];
  let parentNode = null;
  let parentArray = state.tree;
  let parentId = null;

  if (chain.length) {
    for (let i = 0; i < chain.length; i++) {
      if (!createParentSelects[i] || !createParentSelects[i].value) {
        createErrorEl.textContent = `Escolha ${KIND_LABEL[chain[i]].toLowerCase()} antes de continuar (crie um primeiro se a lista estiver vazia).`;
        createErrorEl.hidden = false;
        return;
      }
    }
    const lastLevelKind = chain[chain.length - 1];
    const lastSelId = createParentSelects[chain.length - 1].value;
    const candidates = createNodesAtLevel(chain.length - 1, chain);
    parentNode = candidates.find((n) => n.id === lastSelId);
    if (!parentNode) {
      createErrorEl.textContent = "Não foi possível identificar o item pai escolhido. Feche e tente de novo.";
      createErrorEl.hidden = false;
      return;
    }
    parentId = parentNode.id;
    parentArray = childrenOf(parentNode, lastLevelKind);
  }

  createSubmitBtn.disabled = true;
  try {
    const child = await addNode(kind, parentId, parentArray.length, name);
    parentArray.push(child);
    if (parentNode) state.collapsed[parentNode.id] = false;
    saveViewPrefs();
    renderTreeTable();
    renderSummary();
    closeCreatePanel();
  } catch (err) {
    createErrorEl.textContent = "Não foi possível criar: " + describeError(err, "structure");
    createErrorEl.hidden = false;
  } finally {
    createSubmitBtn.disabled = false;
  }
}

document.getElementById("btnCreateItem").addEventListener("click", openCreatePanel);
document.getElementById("createClose").addEventListener("click", closeCreatePanel);
createBackdrop.addEventListener("click", closeCreatePanel);
createKindEl.addEventListener("change", renderCreateParents);
createSubmitBtn.addEventListener("click", handleCreateSubmit);

// ---------- autenticação ----------

function showAuthScreen() {
  authScreenEl.hidden = false;
  appScreenEl.hidden = true;
  currentUser = null;
  currentProfile = null;
  isAdmin = false;
  canEdit = false;
}
function showAppScreen() {
  authScreenEl.hidden = true;
  appScreenEl.hidden = false;
}
function showLoadError(err) {
  console.error("Falha ao carregar dados do Supabase:", err);
  loadErrorEl.hidden = false;
  loadErrorEl.textContent = "Não foi possível carregar os dados: " + describeError(err) + " — clique em \"Atualizar dados\" para tentar de novo.";
}
function clearLoadError() {
  loadErrorEl.hidden = true;
}

const ROLE_LABEL = { admin: "Administrador", auditor: "Auditor", leitor: "Leitor" };

function renderAuthBar() {
  document.getElementById("authUserLabel").textContent = (currentProfile && currentProfile.full_name) || currentUser.email;
  const roleBadge = document.getElementById("authRoleBadge");
  const role = (currentProfile && currentProfile.role) || "auditor";
  roleBadge.textContent = ROLE_LABEL[role] || role;
  roleBadge.className = "role-badge" + (isAdmin ? " role-badge-admin" : "");

  const toggleHiddenBtn = document.getElementById("btnToggleHidden");
  toggleHiddenBtn.hidden = !isAdmin;
  toggleHiddenBtn.textContent = state.showHidden ? "Esconder itens ocultos/retirados" : "Mostrar itens ocultos/retirados";

  document.getElementById("btnCreateItem").hidden = !isAdmin;
}

async function onSignedIn(session) {
  currentUser = session.user;
  showAppScreen();
  clearLoadError();
  treeWrap.innerHTML = '<p class="loading-note">Carregando dados do banco…</p>';
  summaryEl.innerHTML = "";
  try {
    const { data: profile } = await sb.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    currentProfile = profile || null;
    isAdmin = !!(currentProfile && currentProfile.role === "admin");
    canEdit = !!(currentProfile && currentProfile.role !== "leitor");
    renderAuthBar();
    await loadAll();
    render();
  } catch (err) {
    showLoadError(err);
  }
}

function translateAuthError(err) {
  const msg = (err && err.message) || String(err || "");
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha inválidos.";
  if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado — peça para o administrador confirmar seu cadastro em Authentication → Users no painel Supabase.";
  return msg || "Não foi possível entrar. Tente novamente.";
}

// A GoTrueClient dispara "INITIAL_SESSION" uma vez ao carregar (lendo o
// localStorage de forma assíncrona) e depois "SIGNED_IN"/"SIGNED_OUT" conforme
// o usuário interage. Em alguns navegadores essa checagem inicial demora mais
// que um login manual e o evento (às vezes um "INITIAL_SESSION" atrasado, às
// vezes um evento sem sessão) chega DEPOIS do "SIGNED_IN" que acabamos de
// processar — sem essa proteção, isso derruba o usuário de volta pra tela de
// login um instante depois de logar com sucesso. Por isso só tratamos
// "SIGNED_OUT" explícito como sinal de logout; qualquer evento sem sessão que
// chegue depois de já estarmos autenticados é ignorado.
let handledUserId = null;
let initialSessionSeen = false;
if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    console.log("[auth]", event, session ? session.user.id : null);
    if (event === "INITIAL_SESSION") {
      if (initialSessionSeen) return; // ignora repetições/atrasos do evento inicial
      initialSessionSeen = true;
    }
    if (event === "SIGNED_OUT") {
      handledUserId = null;
      showAuthScreen();
      return;
    }
    if (session && session.user) {
      if (handledUserId !== session.user.id) {
        handledUserId = session.user.id;
        onSignedIn(session);
      }
      return;
    }
    if (!handledUserId) {
      showAuthScreen();
    }
  });
} else {
  showAuthScreen();
  const errEl = document.getElementById("authError");
  errEl.textContent = "Não foi possível conectar ao Supabase: " + translateAuthError(SUPABASE_INIT_ERROR) + " Recarregue a página; se persistir, avise o administrador.";
  errEl.hidden = false;
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("authError");
  const submitBtn = document.getElementById("loginSubmit");
  errEl.hidden = true;
  if (!sb) {
    errEl.textContent = "Não foi possível conectar ao Supabase. Recarregue a página e tente de novo.";
    errEl.hidden = false;
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = "Entrando…";
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = translateAuthError(error);
      errEl.hidden = false;
    }
  } catch (err) {
    errEl.textContent = "Não foi possível conectar ao servidor: " + ((err && err.message) || String(err));
    errEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrar";
  }
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  await sb.auth.signOut();
});
