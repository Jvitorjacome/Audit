const STORAGE_KEY = "dre-prototype-state-v2";

function cloneAccounts() {
  return SEED_ACCOUNTS.map((a) => ({ ...a }));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        accounts: cloneAccounts(),
        cells: {},
        visibleMonths: MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
      };
    }
    const parsed = JSON.parse(raw);
    return {
      accounts: parsed.accounts || cloneAccounts(),
      cells: parsed.cells || {},
      visibleMonths: parsed.visibleMonths || MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
    };
  } catch (e) {
    return {
      accounts: cloneAccounts(),
      cells: {},
      visibleMonths: MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
    };
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

function cellKey(accountId, monthKey) {
  return `${accountId}::${monthKey}`;
}

function getCell(accountId, monthKey) {
  const key = cellKey(accountId, monthKey);
  const seed = SEED_CELLS[key] || {};
  const override = state.cells[key] || {};
  return { ...seed, ...override };
}

function setCellField(accountId, monthKey, field, value) {
  const key = cellKey(accountId, monthKey);
  const current = getCell(accountId, monthKey);
  state.cells[key] = { ...current, [field]: value };
  saveState();
}

function statusTone(value) {
  if (value === "Conforme") return "ok";
  if (value === "Não Conforme") return "div";
  if (value === "Não se aplica") return "na";
  return "unv";
}

function cellSummary(accountId, monthKey) {
  const cell = getCell(accountId, monthKey);
  let conforme = 0, div = 0, other = 0;
  for (const f of STATUS_FIELDS) {
    const v = cell[f.key] || "Não verificado";
    if (v === "Conforme") conforme++;
    else if (v === "Não Conforme") div++;
    else other++;
  }
  return { conforme, div, other };
}

function items() {
  return state.accounts.filter((a) => a.type === "item");
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
  thActions.textContent = "";
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

    for (const m of months) {
      const td = document.createElement("td");
      td.className = "cell-month";
      const { conforme, div } = cellSummary(row.id, m.key);
      const dots = document.createElement("div");
      dots.className = "dots";
      const cell = getCell(row.id, m.key);
      for (const f of STATUS_FIELDS) {
        const dot = document.createElement("span");
        const val = cell[f.key] || "Não verificado";
        dot.className = `dot dot-${statusTone(val)}`;
        dot.title = `${f.label}: ${val}`;
        dots.appendChild(dot);
      }
      td.appendChild(dots);
      if (div > 0) td.classList.add("cell-has-div");
      else if (conforme === STATUS_FIELDS.length) td.classList.add("cell-all-ok");
      td.addEventListener("click", () => openDrawer(row, m));
      tr.appendChild(td);
    }

    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "row-delete";
    delBtn.title = "Remover este indicador";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`Remover o indicador "${row.name}"? Os dados preenchidos dele neste protótipo serão perdidos.`)) return;
      state.accounts = state.accounts.filter((a) => a.id !== row.id);
      for (const m of MONTHS) delete state.cells[cellKey(row.id, m.key)];
      saveState();
      render();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  tableWrap.innerHTML = "";
  tableWrap.appendChild(table);
}

function renderSummary() {
  const months = visibleMonthList();
  const leaves = items();
  let filled = 0, div = 0, na = 0;
  const total = leaves.length * months.length * STATUS_FIELDS.length;
  for (const row of leaves) {
    for (const m of months) {
      const cell = getCell(row.id, m.key);
      for (const f of STATUS_FIELDS) {
        const v = cell[f.key];
        if (v) filled++;
        if (v === "Não Conforme") div++;
        if (v === "Não se aplica") na++;
      }
    }
  }
  const pct = total ? Math.round((filled / total) * 100) : 0;
  summaryEl.innerHTML = `
    <div class="stat"><span class="stat-value">${leaves.length}</span><span class="stat-label">indicadores</span></div>
    <div class="stat"><span class="stat-value">${months.length}</span><span class="stat-label">meses visíveis</span></div>
    <div class="stat"><span class="stat-value">${pct}%</span><span class="stat-label">campos verificados</span></div>
    <div class="stat stat-danger"><span class="stat-value">${div}</span><span class="stat-label">não conformes</span></div>
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
  document.getElementById("drawerSubtitle").textContent = `${month.label} · linha ${row.row} na planilha original`;

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
      setCellField(drawerCtx.accountId, drawerCtx.monthKey, f.key, select.value);
      renderTable();
      renderSummary();
    });
    wrap.appendChild(select);
    fieldsEl.appendChild(wrap);
  }

  const valorInput = document.getElementById("drawerValor");
  valorInput.value = cell.valorBaseTarget || "";
  valorInput.oninput = () => {
    setCellField(drawerCtx.accountId, drawerCtx.monthKey, "valorBaseTarget", valorInput.value);
  };

  const obsInput = document.getElementById("drawerObservacoes");
  obsInput.value = cell.observacoes || "";
  obsInput.oninput = () => {
    setCellField(drawerCtx.accountId, drawerCtx.monthKey, "observacoes", obsInput.value);
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
  if (!confirm("Restaurar o protótipo para os dados originais da planilha? Suas edições locais serão perdidas.")) return;
  state = {
    accounts: cloneAccounts(),
    cells: {},
    visibleMonths: MONTHS.filter((m) => m.inOriginal).map((m) => m.key),
  };
  saveState();
  render();
});

const addForm = document.getElementById("addForm");
const addInput = document.getElementById("addInput");
addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = addInput.value.trim();
  if (!name) return;
  const id = `custom-${Date.now()}`;
  state.accounts.push({ id, name, row: null, type: "item" });
  addInput.value = "";
  saveState();
  render();
  tableWrap.scrollTop = tableWrap.scrollHeight;
});

render();
