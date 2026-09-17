const STORAGE_KEY = "dre-prototype-state-v4";

// ---------- seed cells: flatten every tree node's real sheet data into one lookup ----------

const ALL_SEED_CELLS = {};

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
    for (const mk in node.cells) ALL_SEED_CELLS[`${node.id}::${mk}`] = node.cells[mk];
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

const KIND_LABEL = { section: "Seção", channel: "Estado", property: "Propriedade", centro: "Centro de custo", campo: "Campo auditado" };
const KIND_ADD_LABEL = { section: "Estado", channel: "Propriedade", property: "Centro de custo", centro: "Campo" };

function makeNode(kind, name, id) {
  const base = { id, name, row: null, cells: {} };
  if (kind === "channel") return { ...base, properties: [] };
  if (kind === "property") return { ...base, centros: [] };
  if (kind === "centro") return { ...base, campos: [] };
  return base; // campo: leaf
}

// ---------- state ----------

function cloneTree() {
  return JSON.parse(JSON.stringify(TREE_SECTIONS));
}

function loadState() {
  const fallback = {
    tree: cloneTree(),
    cells: {},
    visibleMonths: MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
    collapsed: {},
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      tree: parsed.tree || fallback.tree,
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

function countLeaves(node, kind) {
  if (kind === "campo") return 1;
  const kids = childrenOf(node, kind);
  const nextKind = childKind(kind);
  return kids.reduce((sum, k) => sum + countLeaves(k, nextKind), 0);
}
function countDescendantNodes(node, kind) {
  const kids = childrenOf(node, kind);
  if (!kids) return 0;
  const nextKind = childKind(kind);
  return kids.length + kids.reduce((sum, k) => sum + countDescendantNodes(k, nextKind), 0);
}

// ---------- DOM refs ----------

const monthFilterEl = document.getElementById("monthFilter");
const summaryEl = document.getElementById("summary");
const drawerEl = document.getElementById("drawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const treeWrap = document.getElementById("treeWrap");

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
    tr.className = `row-tree row-depth-${Math.min(depth, 5)} row-kind-${kind}`;
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
        saveState();
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
    nameSpan.title = `${KIND_LABEL[kind]}${node.row ? " · linha " + node.row + " na planilha original" : " · adicionado neste protótipo"}`;
    tdName.appendChild(nameSpan);

    if (hasKids) {
      const count = document.createElement("span");
      count.className = "node-count";
      count.textContent = ` (${countLeaves(node, kind)})`;
      tdName.appendChild(count);
    }
    tr.appendChild(tdName);

    tr.appendChild(monthCellsFragment(node.id, months));
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openDrawer(node, months[0], KIND_LABEL[kind]);
    });

    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    if (hasKids) {
      const addLabel = KIND_ADD_LABEL[kind];
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "row-add";
      addBtn.title = `Adicionar ${addLabel.toLowerCase()} aqui dentro`;
      addBtn.textContent = "+";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const name = prompt(`Nome do novo ${addLabel.toLowerCase()}:`);
        if (!name || !name.trim()) return;
        const finalName = nextKind === "channel" ? name.trim().toUpperCase() : name.trim();
        const child = makeNode(nextKind, finalName, `custom-${Date.now()}`);
        kids.push(child);
        state.collapsed[node.id] = false;
        saveState();
        renderTreeTable();
      });
      tdActions.appendChild(addBtn);
    }
    if (kind !== "section" && parentArray) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "row-delete";
      const nested = hasKids ? countDescendantNodes(node, kind) : 0;
      delBtn.title = nested > 0 ? `Remover (leva junto ${nested} item(ns) abaixo)` : `Remover ${KIND_LABEL[kind].toLowerCase()}`;
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const warn = nested > 0 ? ` Isso remove também os ${nested} item(ns) dentro dele/dela.` : "";
        if (!confirm(`Remover "${node.name}" (${KIND_LABEL[kind]})?${warn}`)) return;
        const idx = parentArray.indexOf(node);
        if (idx >= 0) parentArray.splice(idx, 1);
        saveState();
        renderTreeTable();
        renderSummary();
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

function openDrawer(node, month, kindLabel) {
  const months = visibleMonthList();
  const useMonth = month || months[0];
  if (!useMonth) return;
  drawerCtx = { id: node.id, monthKey: useMonth.key };
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

  document.getElementById("drawerSubtitle").textContent = node.row ? `linha ${node.row} na planilha original` : "adicionado neste protótipo";

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
  if (!confirm("Restaurar o protótipo para os dados originais da planilha? Suas edições locais (incluindo itens adicionados) serão perdidas.")) return;
  state = {
    tree: cloneTree(),
    cells: {},
    visibleMonths: MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
    collapsed: {},
  };
  saveState();
  render();
});
render();
