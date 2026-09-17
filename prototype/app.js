const STORAGE_KEY = "dre-prototype-state-v1";

function flattenLeaves(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    out.push({ id: node.id, name: node.name, depth, hasChildren });
    if (hasChildren) flattenLeaves(node.children, depth + 1, out);
  }
  return out;
}

const ROWS = flattenLeaves(ACCOUNT_TREE);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { cells: {}, visibleMonths: null, collapsed: {} };
    const parsed = JSON.parse(raw);
    return {
      cells: parsed.cells || {},
      visibleMonths: parsed.visibleMonths || null,
      collapsed: parsed.collapsed || {},
    };
  } catch (e) {
    return { cells: {}, visibleMonths: null, collapsed: {} };
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
if (!state.visibleMonths) {
  state.visibleMonths = MONTHS.filter((m) => m.inOriginal).map((m) => m.key);
}

function cellKey(accountId, monthKey) {
  return `${accountId}::${monthKey}`;
}

function getCell(accountId, monthKey) {
  return (
    state.cells[cellKey(accountId, monthKey)] || {
      statuses: {},
      observacoes: "",
      valor: "",
    }
  );
}

function setCell(accountId, monthKey, patch) {
  const key = cellKey(accountId, monthKey);
  const current = getCell(accountId, monthKey);
  state.cells[key] = { ...current, ...patch };
  saveState();
}

function statusTone(value) {
  if (value === "OK") return "ok";
  if (value === "Divergente") return "div";
  return "unv";
}

function cellSummary(accountId, monthKey) {
  const cell = getCell(accountId, monthKey);
  let ok = 0, div = 0, unv = 0;
  for (const f of STATUS_FIELDS) {
    const v = cell.statuses[f.key] || "Não verificado";
    if (v === "OK") ok++;
    else if (v === "Divergente") div++;
    else unv++;
  }
  return { ok, div, unv };
}

function isRowVisible(row) {
  if (row.hasChildren) return true;
  // a leaf is hidden if any ancestor category is collapsed
  return true;
}

// ---------- rendering ----------

const monthFilterEl = document.getElementById("monthFilter");
const tableWrap = document.getElementById("tableWrap");
const summaryEl = document.getElementById("summary");
const drawerEl = document.getElementById("drawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");

function renderMonthFilter() {
  monthFilterEl.innerHTML = "";
  for (const m of MONTHS) {
    const active = state.visibleMonths.includes(m.key);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (active ? " chip-active" : "");
    chip.setAttribute("aria-pressed", String(active));
    chip.innerHTML =
      `<span>${m.label}</span>` +
      (!m.inOriginal ? '<span class="chip-badge">novo</span>' : "");
    chip.addEventListener("click", () => {
      if (active) {
        state.visibleMonths = state.visibleMonths.filter((k) => k !== m.key);
      } else {
        state.visibleMonths = [...state.visibleMonths, m.key].sort(
          (a, b) => MONTHS.findIndex((mm) => mm.key === a) - MONTHS.findIndex((mm) => mm.key === b)
        );
      }
      saveState();
      render();
    });
    monthFilterEl.appendChild(chip);
  }
}

function visibleMonthList() {
  return MONTHS.filter((m) => state.visibleMonths.includes(m.key));
}

function renderTable() {
  const months = visibleMonthList();
  const table = document.createElement("table");
  table.className = "dre-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const thAccount = document.createElement("th");
  thAccount.className = "col-account";
  thAccount.textContent = "Conta";
  headRow.appendChild(thAccount);
  for (const m of months) {
    const th = document.createElement("th");
    th.textContent = m.label;
    if (!m.inOriginal) th.classList.add("th-new");
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of ROWS) {
    const tr = document.createElement("tr");
    tr.className = row.hasChildren ? "row-category" : "row-leaf";
    const tdName = document.createElement("td");
    tdName.className = "col-account";
    tdName.style.paddingLeft = `${12 + row.depth * 18}px`;
    tdName.textContent = row.name;
    tr.appendChild(tdName);

    if (row.hasChildren) {
      const tdSpan = document.createElement("td");
      tdSpan.colSpan = months.length;
      tdSpan.className = "cell-category";
      tr.appendChild(tdSpan);
    } else {
      for (const m of months) {
        const td = document.createElement("td");
        td.className = "cell-month";
        const { ok, div, unv } = cellSummary(row.id, m.key);
        const dots = document.createElement("div");
        dots.className = "dots";
        const cell = getCell(row.id, m.key);
        for (const f of STATUS_FIELDS) {
          const dot = document.createElement("span");
          dot.className = `dot dot-${statusTone(cell.statuses[f.key])}`;
          dot.title = `${f.label}: ${cell.statuses[f.key] || "Não verificado"}`;
          dots.appendChild(dot);
        }
        td.appendChild(dots);
        if (div > 0) td.classList.add("cell-has-div");
        else if (ok === STATUS_FIELDS.length) td.classList.add("cell-all-ok");
        td.addEventListener("click", () => openDrawer(row, m));
        tr.appendChild(td);
      }
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  tableWrap.innerHTML = "";
  tableWrap.appendChild(table);
}

function renderSummary() {
  const months = visibleMonthList();
  const leaves = ROWS.filter((r) => !r.hasChildren);
  let filled = 0, div = 0, total = leaves.length * months.length * STATUS_FIELDS.length;
  for (const row of leaves) {
    for (const m of months) {
      const cell = getCell(row.id, m.key);
      for (const f of STATUS_FIELDS) {
        const v = cell.statuses[f.key];
        if (v) filled++;
        if (v === "Divergente") div++;
      }
    }
  }
  const pct = total ? Math.round((filled / total) * 100) : 0;
  summaryEl.innerHTML = `
    <div class="stat"><span class="stat-value">${leaves.length}</span><span class="stat-label">contas</span></div>
    <div class="stat"><span class="stat-value">${months.length}</span><span class="stat-label">meses visíveis</span></div>
    <div class="stat"><span class="stat-value">${pct}%</span><span class="stat-label">campos verificados</span></div>
    <div class="stat stat-danger"><span class="stat-value">${div}</span><span class="stat-label">divergências</span></div>
  `;
}

function render() {
  renderMonthFilter();
  renderTable();
  renderSummary();
}

// ---------- drawer ----------

let drawerCtx = null;

function openDrawer(row, month) {
  drawerCtx = { accountId: row.id, accountName: row.name, monthKey: month.key, monthLabel: month.label };
  const cell = getCell(row.id, month.key);

  document.getElementById("drawerTitle").textContent = row.name;
  document.getElementById("drawerSubtitle").textContent = month.label;

  const fieldsEl = document.getElementById("drawerFields");
  fieldsEl.innerHTML = "";
  for (const f of STATUS_FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const value = cell.statuses[f.key] || "Não verificado";
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
      const c = getCell(drawerCtx.accountId, drawerCtx.monthKey);
      setCell(drawerCtx.accountId, drawerCtx.monthKey, {
        statuses: { ...c.statuses, [f.key]: select.value },
      });
      renderTable();
      renderSummary();
    });
    wrap.appendChild(select);
    fieldsEl.appendChild(wrap);
  }

  const valorInput = document.getElementById("drawerValor");
  valorInput.value = cell.valor || "";
  valorInput.oninput = () => {
    setCell(drawerCtx.accountId, drawerCtx.monthKey, { valor: valorInput.value });
  };

  const obsInput = document.getElementById("drawerObservacoes");
  obsInput.value = cell.observacoes || "";
  obsInput.oninput = () => {
    setCell(drawerCtx.accountId, drawerCtx.monthKey, { observacoes: obsInput.value });
  };

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
  if (!confirm("Limpar todos os dados preenchidos neste protótipo local?")) return;
  state = { cells: {}, visibleMonths: MONTHS.filter((m) => m.inOriginal).map((m) => m.key), collapsed: {} };
  saveState();
  render();
});

render();
