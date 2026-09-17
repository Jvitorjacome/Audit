const STORAGE_KEY = "dre-prototype-state-v3";

// ---------- seed cells: unify tree nodes + flat items into one lookup ----------

const ALL_SEED_CELLS = { ...SEED_CELLS };

function walkTree(nodes, kind, visit) {
  for (const node of nodes) {
    visit(node, kind);
    if (kind === "section") walkTree(node.channels, "channel", visit);
    else if (kind === "channel") walkTree(node.properties, "property", visit);
    else if (kind === "property") walkTree(node.centros, "centro", visit);
    else if (kind === "centro") walkTree(node.campos, "campo", visit);
  }
}

walkTree(TREE_SECTIONS, "section", (node) => {
  if (node.cells) {
    for (const mk in node.cells) {
      ALL_SEED_CELLS[`${node.id}::${mk}`] = node.cells[mk];
    }
  }
});

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

// ---------- state ----------

function cloneAccounts() {
  return SEED_ACCOUNTS.map((a) => ({ ...a }));
}
function cloneTree() {
  return JSON.parse(JSON.stringify(TREE_SECTIONS));
}

function loadState() {
  const fallback = {
    tab: "tree",
    tree: cloneTree(),
    accounts: cloneAccounts(),
    cells: {},
    visibleMonths: MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
    collapsed: {},
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      tab: parsed.tab || fallback.tab,
      tree: parsed.tree || fallback.tree,
      accounts: parsed.accounts || fallback.accounts,
      cells: parsed.cells || {},
      visibleMonths: parsed.visibleMonths || fallback.visibleMonths,
      collapsed: parsed.collapsed || {},
    };
  } catch (e) {
    return fallback;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* private window / storage blocked - prototype just won't persist */
  }
}

let state = loadState();

function cellKey(id, monthKey) {
  return `${id}::${monthKey}`;
}
function getCell(id, monthKey) {
  const key = cellKey(id, monthKey);
  return { ...(ALL_SEED_CELLS[key] || {}), ...(state.cells[key] || {}) };
}
function setCellField(id, monthKey, field, value) {
  const key = cellKey(id, monthKey);
  state.cells[key] = { ...getCell(id, monthKey), [field]: value };
  saveState();
}
function statusTone(value) {
  if (value === "Conforme") return "ok";
  if (value === "Não Conforme") return "div";
  if (value === "Não se aplica") return "na";
  return "unv";
}
function cellSummary(id, monthKey) {
  const cell = getCell(id, monthKey);
  let conforme = 0, div = 0;
  for (const f of STATUS_FIELDS) {
    const v = cell[f.key] || "Não verificado";
    if (v === "Conforme") conforme++;
    else if (v === "Não Conforme") div++;
  }
  return { conforme, div };
}

function items() {
  return state.accounts.filter((a) => a.type === "item");
}

function countLeaves(node, kind) {
  if (kind === "centro") return node.campos.length;
  const kids = childrenOf(node, kind);
  const nextKind = childKind(kind);
  return kids.reduce((sum, k) => sum + countLeaves(k, nextKind), 0);
}

// ---------- shared DOM refs ----------

const monthFilterEl = document.getElementById("monthFilter");
const summaryEl = document.getElementById("summary");
const drawerEl = document.getElementById("drawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const treeWrap = document.getElementById("treeWrap");
const flatWrap = document.getElementById("flatWrap");
const tabTreeBtn = document.getElementById("tabTree");
const tabFlatBtn = document.getElementById("tabFlat");
const addFormFlat = document.getElementById("addForm");
const addInputFlat = document.getElementById("addInput");

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
      saveState();
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
    const { conforme, div } = cellSummary(id, m.key);
    const dots = document.createElement("div");
    dots.className = "dots";
    const cell = getCell(id, m.key);
    for (const f of STATUS_FIELDS) {
      const val = cell[f.key] || "Não verificado";
      const dot = document.createElement("span");
      dot.className = `dot dot-${statusTone(val)}`;
      dot.title = `${f.label}: ${val}`;
      dots.appendChild(dot);
    }
    td.appendChild(dots);
    if (div > 0) td.classList.add("cell-has-div");
    else if (conforme === STATUS_FIELDS.length) td.classList.add("cell-all-ok");
    frag.appendChild(td);
  }
  return frag;
}

// ---------- tree tab ----------

const KIND_LABEL = { section: "Seção", channel: "Canal", property: "Propriedade", centro: "Centro de custo", campo: "Campo auditado" };

function renderTreeTable() {
  const months = visibleMonthList();
  const table = document.createElement("table");
  table.className = "dre-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.className = "col-account";
  th0.textContent = "Propriedade / Centro de custo / Campo";
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

  function renderNode(node, kind, depth, parentArrayForDelete) {
    const kids = childrenOf(node, kind);
    const nextKind = childKind(kind);
    const hasKids = Array.isArray(kids);
    const isLeaf = kind === "campo";
    const collapsed = !!state.collapsed[node.id];

    const tr = document.createElement("tr");
    tr.className = `row-tree row-depth-${Math.min(depth, 5)} row-kind-${kind}`;
    const tdName = document.createElement("td");
    tdName.className = "col-account";
    tdName.style.paddingLeft = `${10 + depth * 18}px`;

    if (hasKids) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "toggle";
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.title = collapsed ? "Expandir" : "Recolher";
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        state.collapsed[node.id] = !collapsed;
        saveState();
        renderTreeTable();
      });
      tdName.appendChild(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "toggle-spacer";
      tdName.appendChild(spacer);
    }

    const nameSpan = document.createElement("span");
    nameSpan.textContent = node.name || "(sem nome)";
    nameSpan.title = `${KIND_LABEL[kind]} · linha ${node.row} na planilha original`;
    tdName.appendChild(nameSpan);

    if (hasKids) {
      const count = document.createElement("span");
      count.className = "node-count";
      count.textContent = ` (${countLeaves(node, kind)})`;
      tdName.appendChild(count);
    }
    tr.appendChild(tdName);

    // every row (leaf or not) carries its own real audit cells from the sheet, so all are clickable
    tr.appendChild(monthCellsFragment(node.id, months));
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".toggle") || e.target.closest(".row-delete") || e.target.closest(".row-add")) return;
      openMonthPicker(node, kind);
    });

    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    if (kind === "centro") {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "row-add";
      addBtn.title = "Adicionar campo auditado neste centro de custo";
      addBtn.textContent = "+";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const name = prompt("Nome do novo campo auditado:");
        if (!name || !name.trim()) return;
        node.campos.push({ id: `custom-${Date.now()}`, name: name.trim(), row: null, cells: {} });
        state.collapsed[node.id] = false;
        saveState();
        renderTreeTable();
      });
      tdActions.appendChild(addBtn);
    }
    if (isLeaf) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "row-delete";
      delBtn.title = "Remover este campo";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm(`Remover o campo "${node.name}"?`)) return;
        const idx = parentArrayForDelete.indexOf(node);
        if (idx >= 0) parentArrayForDelete.splice(idx, 1);
        saveState();
        renderTreeTable();
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

function openMonthPicker(node, kind) {
  // simplest: open drawer directly on the first visible month; user can switch inside via the month select
  const months = visibleMonthList();
  if (!months.length) return;
  openDrawer(node, months[0], KIND_LABEL[kind]);
}

// ---------- flat tab ----------

function renderFlatTable() {
  const months = visibleMonthList();
  const table = document.createElement("table");
  table.className = "dre-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const thAccount = document.createElement("th");
  thAccount.className = "col-account";
  thAccount.textContent = `Indicador (${items().length})`;
  headRow.appendChild(thAccount);
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
  for (const row of state.accounts) {
    if (row.type === "separator") {
      const tr = document.createElement("tr");
      tr.className = "row-separator";
      const td = document.createElement("td");
      td.colSpan = months.length + 2;
      tr.appendChild(td);
      tbody.appendChild(tr);
      continue;
    }
    const tr = document.createElement("tr");
    tr.className = "row-leaf";
    const tdName = document.createElement("td");
    tdName.className = "col-account";
    tdName.textContent = row.name;
    tdName.title = `Linha original da planilha: ${row.row}`;
    tr.appendChild(tdName);
    tr.appendChild(monthCellsFragment(row.id, months));
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".row-delete")) return;
      if (!months.length) return;
      openDrawer(row, months[0], "Indicador");
    });

    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "row-delete";
    delBtn.title = "Remover este indicador";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`Remover o indicador "${row.name}"?`)) return;
      state.accounts = state.accounts.filter((a) => a.id !== row.id);
      for (const m of MONTHS) delete state.cells[cellKey(row.id, m.key)];
      saveState();
      renderFlatTable();
      renderSummary();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  flatWrap.innerHTML = "";
  flatWrap.appendChild(table);
}

// ---------- summary (counts whatever tab is active) ----------

function renderSummary() {
  const months = visibleMonthList();
  let ids = [];
  if (state.tab === "tree") {
    walkTree(state.tree, "section", (node, kind) => {
      if (kind === "campo") ids.push(node.id);
    });
  } else {
    ids = items().map((a) => a.id);
  }
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
    <div class="stat"><span class="stat-value">${ids.length}</span><span class="stat-label">${state.tab === "tree" ? "campos auditados" : "indicadores"}</span></div>
    <div class="stat"><span class="stat-value">${months.length}</span><span class="stat-label">meses visíveis</span></div>
    <div class="stat"><span class="stat-value">${pct}%</span><span class="stat-label">campos verificados</span></div>
    <div class="stat stat-danger"><span class="stat-value">${div}</span><span class="stat-label">não conformes</span></div>
  `;
}

function render() {
  renderMonthFilter();
  if (state.tab === "tree") {
    treeWrap.hidden = false;
    flatWrap.hidden = true;
    addFormFlat.hidden = true;
    tabTreeBtn.classList.add("tab-active");
    tabFlatBtn.classList.remove("tab-active");
    renderTreeTable();
  } else {
    treeWrap.hidden = true;
    flatWrap.hidden = false;
    addFormFlat.hidden = false;
    tabTreeBtn.classList.remove("tab-active");
    tabFlatBtn.classList.add("tab-active");
    renderFlatTable();
  }
  renderSummary();
}

// ---------- drawer ----------

let drawerCtx = null;

function openDrawer(node, month, kindLabel) {
  const months = visibleMonthList();
  const useMonth = month || months[0];
  if (!useMonth) return;
  drawerCtx = { id: node.id, name: node.name, monthKey: useMonth.key };
  const cell = getCell(node.id, useMonth.key);

  document.getElementById("drawerTitle").textContent = node.name || "(sem nome)";
  document.getElementById("drawerKind").textContent = kindLabel || "";

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

  document.getElementById("drawerSubtitle").textContent = `linha ${node.row ?? "—"} na planilha original`;

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
    select.addEventListener("change", () => {
      select.className = `select select-${statusTone(select.value)}`;
      setCellField(drawerCtx.id, drawerCtx.monthKey, f.key, select.value);
      render();
    });
    wrap.appendChild(select);
    fieldsEl.appendChild(wrap);
  }

  const valorInput = document.getElementById("drawerValor");
  valorInput.value = cell.valorBaseTarget || "";
  valorInput.oninput = () => setCellField(drawerCtx.id, drawerCtx.monthKey, "valorBaseTarget", valorInput.value);

  const obsInput = document.getElementById("drawerObservacoes");
  obsInput.value = cell.observacoes || "";
  obsInput.oninput = () => setCellField(drawerCtx.id, drawerCtx.monthKey, "observacoes", obsInput.value);

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
  saveState();
  render();
});
document.getElementById("btnOriginalMonths").addEventListener("click", () => {
  state.visibleMonths = MONTHS.filter((m) => m.inOriginal).map((m) => m.key);
  saveState();
  render();
});
document.getElementById("btnReset").addEventListener("click", () => {
  if (!confirm("Restaurar o protótipo para os dados originais da planilha? Suas edições locais serão perdidas.")) return;
  state = {
    tab: state.tab,
    tree: cloneTree(),
    accounts: cloneAccounts(),
    cells: {},
    visibleMonths: MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
    collapsed: {},
  };
  saveState();
  render();
});

tabTreeBtn.addEventListener("click", () => {
  state.tab = "tree";
  saveState();
  render();
});
tabFlatBtn.addEventListener("click", () => {
  state.tab = "flat";
  saveState();
  render();
});

addFormFlat.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = addInputFlat.value.trim();
  if (!name) return;
  state.accounts.push({ id: `custom-${Date.now()}`, name, row: null, type: "item" });
  addInputFlat.value = "";
  saveState();
  renderFlatTable();
  renderSummary();
});

render();
