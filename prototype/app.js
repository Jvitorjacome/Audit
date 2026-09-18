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

const KIND_LABEL = { section: "Seção", channel: "Estado", property: "Propriedade", centro: "Centro de custo", campo: "Campo auditado" };
const KIND_ADD_LABEL = { section: "Estado", channel: "Propriedade", property: "Centro de custo", centro: "Campo" };

function makeNode(kind, name, id, row = null) {
  const base = { id, name, row };
  if (kind === "channel") return { ...base, properties: [] };
  if (kind === "property") return { ...base, centros: [] };
  if (kind === "centro") return { ...base, campos: [] };
  return { ...base, isActive: true }; // campo: leaf
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
};

let currentUser = null;
let currentProfile = null;
let isAdmin = false;

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
function cellAggregateTone(id, monthKey) {
  const cell = getCell(id, monthKey);
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
function cellDetailTitle(id, monthKey) {
  const cell = getCell(id, monthKey);
  return STATUS_FIELDS.map((f) => `${f.label}: ${cell[f.key] || "Não verificado"}`).join(" · ");
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

// ---------- Supabase: carregar árvore + status ----------

function buildTree(sections, states, properties, costCenters, auditFields, showHidden) {
  const statesBySection = groupBy(states, "section_id");
  const propertiesByState = groupBy(properties, "state_id");
  const costCentersByProperty = groupBy(costCenters, "property_id");
  const auditFieldsByCostCenter = groupBy(auditFields, "cost_center_id");

  return sections.map((s) => ({
    id: s.id, name: s.name, row: s.source_row,
    channels: (statesBySection[s.id] || []).map((st) => ({
      id: st.id, name: st.name, row: st.source_row,
      properties: (propertiesByState[st.id] || []).map((p) => ({
        id: p.id, name: p.name, row: p.source_row,
        centros: (costCentersByProperty[p.id] || []).map((cc) => ({
          id: cc.id, name: cc.name, row: cc.source_row,
          campos: (auditFieldsByCostCenter[cc.id] || [])
            .filter((af) => showHidden || af.is_active !== false)
            .map((af) => ({
              id: af.id, name: af.name, row: af.source_row, isActive: af.is_active !== false,
            })),
        })),
      })),
    })),
  }));
}

function buildCells(statusRows) {
  const cells = {};
  for (const row of statusRows) {
    const m = MONTH_BY_NUMBER[row.month];
    if (!m) continue;
    const cell = { valorBaseTarget: row.valor_base_target || "", observacoes: row.observacoes || "" };
    for (const f of STATUS_FIELDS) cell[f.key] = STATUS_DB_TO_LABEL[row[f.column]] || "Não verificado";
    for (const f of OCORRENCIA_FIELDS) cell[f.key] = row[f.column] || "";
    cells[cellKey(row.audit_field_id, m.key)] = cell;
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
  const [sections, states, properties, costCenters, auditFields, ocorrenciaOptionsRows] = await Promise.all([
    fetchAllRows("sections", "sort_order"),
    fetchAllRows("states", "sort_order"),
    fetchAllRows("properties", "sort_order"),
    fetchAllRows("cost_centers", "sort_order"),
    fetchAllRows("audit_fields", "sort_order"),
    fetchAllRows("ocorrencia_options", "sort_order"),
  ]);

  rawHierarchy = { sections, states, properties, costCenters, auditFields };
  rebuildTreeFromCache();

  state.ocorrenciaOptions = {};
  for (const row of ocorrenciaOptionsRows) {
    (state.ocorrenciaOptions[row.field_key] ||= []).push(row.value);
  }

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
  const cfg = HIERARCHY[kind];
  const finalName = kind === "channel" ? rawName.trim().toUpperCase() : rawName.trim();
  const payload = { name: finalName, sort_order: siblingCount, created_by: currentUser.id, [cfg.parentColumn]: parentId };
  const { data, error } = await sb.from(cfg.table).insert(payload).select().single();
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

async function deleteNode(kind, id) {
  const cfg = HIERARCHY[kind];
  const { error } = await sb.from(cfg.table).delete().eq("id", id);
  if (error) throw error;
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

function monthCellsFragment(id, months) {
  const frag = document.createDocumentFragment();
  for (const m of months) {
    const td = document.createElement("td");
    td.className = "cell-month";
    const { tone, label } = cellAggregateTone(id, m.key);
    const badge = document.createElement("span");
    badge.className = `status-badge status-badge-${tone}`;
    badge.textContent = label;
    td.appendChild(badge);
    td.title = cellDetailTitle(id, m.key);
    if (tone === "div") td.classList.add("cell-tone-div");
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
    const kids = childrenOf(node, kind);
    const nextKind = childKind(kind);
    const hasKids = Array.isArray(kids);
    const collapsed = !!state.collapsed[node.id];

    const tr = document.createElement("tr");
    tr.className = `row-tree row-depth-${Math.min(depth, 5)} row-kind-${kind}` + (node.isActive === false ? " row-inactive" : "");
    const tdName = document.createElement("td");
    tdName.className = "col-account";
    tdName.style.paddingLeft = `${10 + depth * 20}px`;

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

    if (kind === "campo" && node.isActive === false) {
      const hiddenBadge = document.createElement("span");
      hiddenBadge.className = "node-count";
      hiddenBadge.textContent = " (oculto)";
      tdName.appendChild(hiddenBadge);
    }

    if (hasKids) {
      const count = document.createElement("span");
      count.className = "node-count";
      count.textContent = ` (${countLeaves(node, kind)})`;
      tdName.appendChild(count);
    }
    tr.appendChild(tdName);

    if (kind === "campo") {
      tr.appendChild(monthCellsFragment(node.id, months));
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
    }
    if (kind !== "section" && parentArray && isAdmin) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "row-delete";
      const nested = hasKids ? countDescendantNodes(node, kind) : 0;
      delBtn.title = nested > 0 ? `Remover (leva junto ${nested} item(ns) abaixo)` : `Remover ${KIND_LABEL[kind].toLowerCase()}`;
      delBtn.textContent = "×";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const warn = nested > 0 ? ` Isso remove também os ${nested} item(ns) dentro dele/dela.` : "";
        if (!confirm(`Remover "${node.name}" (${KIND_LABEL[kind]})?${warn}`)) return;
        delBtn.disabled = true;
        try {
          await deleteNode(kind, node.id);
          const idx = parentArray.indexOf(node);
          if (idx >= 0) parentArray.splice(idx, 1);
          renderTreeTable();
          renderSummary();
        } catch (err) {
          alert("Não foi possível remover: " + describeError(err, "structure"));
          delBtn.disabled = false;
        }
      });
      tdActions.appendChild(delBtn);
    }
    tr.appendChild(tdActions);
    tbody.appendChild(tr);

    if (hasKids && !collapsed) {
      for (const child of kids) renderNode(child, nextKind, depth + 1, kids);
    }
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
  let filled = 0, div = 0;
  const total = ids.length * months.length * STATUS_FIELDS.length;
  for (const id of ids) {
    for (const m of months) {
      const cell = getCell(id, m.key);
      for (const f of STATUS_FIELDS) {
        const v = cell[f.key];
        if (v) filled++;
        if (v === "Não Conforme") div++;
      }
    }
  }
  const pct = total ? Math.round((filled / total) * 100) : 0;
  summaryEl.innerHTML = `
    <div class="stat"><span class="stat-value">${ids.length}</span><span class="stat-label">campos auditados</span></div>
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
  return debounce(async (id, monthKey, value) => {
    setSaving("saving");
    try {
      await persistCellField(id, monthKey, uiFieldKey, value);
      setSaving("saved");
    } catch (err) {
      setSaving("error");
    }
  }, 600);
}
const persistValor = makeTextPersister("valorBaseTarget");
const persistObs = makeTextPersister("observacoes");

function openDrawer(node, month, kindLabel) {
  const months = visibleMonthList();
  const useMonth = month || months[0];
  if (!useMonth) return;
  drawerCtx = { id: node.id, monthKey: useMonth.key };
  const cell = getCell(node.id, useMonth.key);

  document.getElementById("drawerTitle").textContent = node.name || "(sem nome)";
  document.getElementById("drawerKind").textContent = kindLabel || "";
  const saveStatusEl = document.getElementById("drawerSaveStatus");
  if (saveStatusEl) saveStatusEl.hidden = true;

  const monthSelectEl = document.getElementById("drawerMonth");
  monthSelectEl.innerHTML = "";
  for (const m of months) {
    const o = document.createElement("option");
    o.value = m.key;
    o.textContent = m.label;
    if (m.key === useMonth.key) o.selected = true;
    monthSelectEl.appendChild(o);
  }
  monthSelectEl.onchange = () => openDrawer(node, MONTHS.find((m) => m.key === monthSelectEl.value), kindLabel);

  document.getElementById("drawerSubtitle").textContent = node.row ? `linha ${node.row} na planilha original` : "adicionado neste sistema";

  const fieldsEl = document.getElementById("drawerFields");
  fieldsEl.innerHTML = "";
  for (const f of STATUS_FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const value = cell[f.key] || "Não verificado";
    wrap.innerHTML = `<span class="field-label">${f.label}</span>`;
    const select = document.createElement("select");
    select.className = `select select-${statusTone(value)}`;
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
        await persistCellField(drawerCtx.id, drawerCtx.monthKey, f.key, select.value);
        setSaving("saved");
        renderTreeTable();
        renderSummary();
      } catch (err) {
        setSaving("error");
        alert("Não foi possível salvar: " + describeError(err));
      }
    });
    wrap.appendChild(select);
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
    const select = document.createElement("select");
    select.className = "select";
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
          await persistCellField(drawerCtx.id, drawerCtx.monthKey, f.key, newValue.trim());
          setSaving("saved");
          openDrawer(node, useMonth, kindLabel);
        } catch (err) {
          setSaving("error");
          alert("Não foi possível adicionar a opção: " + describeError(err, "structure"));
          select.value = value;
        }
        return;
      }
      setSaving("saving");
      try {
        await persistCellField(drawerCtx.id, drawerCtx.monthKey, f.key, select.value);
        setSaving("saved");
        openDrawer(node, useMonth, kindLabel);
      } catch (err) {
        setSaving("error");
        alert("Não foi possível salvar: " + describeError(err));
      }
    });
    wrap.appendChild(select);
    fieldsEl.appendChild(wrap);
  }

  const valorInput = document.getElementById("drawerValor");
  valorInput.value = cell.valorBaseTarget || "";
  valorInput.oninput = () => persistValor(drawerCtx.id, drawerCtx.monthKey, valorInput.value);

  const obsInput = document.getElementById("drawerObservacoes");
  obsInput.value = cell.observacoes || "";
  obsInput.oninput = () => persistObs(drawerCtx.id, drawerCtx.monthKey, obsInput.value);

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
  if (e.key === "Escape") closeDrawer();
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

// ---------- autenticação ----------

function showAuthScreen() {
  authScreenEl.hidden = false;
  appScreenEl.hidden = true;
  currentUser = null;
  currentProfile = null;
  isAdmin = false;
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

function renderAuthBar() {
  document.getElementById("authUserLabel").textContent = (currentProfile && currentProfile.full_name) || currentUser.email;
  const roleBadge = document.getElementById("authRoleBadge");
  roleBadge.textContent = isAdmin ? "Administrador" : "Auditor";
  roleBadge.className = "role-badge" + (isAdmin ? " role-badge-admin" : "");

  const toggleHiddenBtn = document.getElementById("btnToggleHidden");
  toggleHiddenBtn.hidden = !isAdmin;
  toggleHiddenBtn.textContent = state.showHidden ? "Esconder campos ocultos" : "Mostrar campos ocultos";
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
