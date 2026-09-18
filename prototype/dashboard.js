// ---------- Indicadores: dashboard de auditoria ----------
// Réplica (adaptada) do projeto Lovable "Audit Insights Hub", mas lendo os
// dados do Supabase (state.tree/state.cells já carregados por app.js) em vez
// da planilha do Google Sheets. Paleta e specs de marca seguem a skill de
// dataviz: cor única (azul, slot categórico 1) para os rankings por
// categoria, cores de status (verde/vermelho/âmbar) só onde a cor significa
// mesmo bom/ruim. O gráfico de pizza "Ocorrências por tipo" do original virou
// barra aqui: com até 16 tipos possíveis, pizza passa do limite (~6 fatias)
// recomendado antes de virar ilegível.

const DASH_ALL = "__all__";

const DASH_COLOR = {
  blue: "#2a78d6",
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  textPrimary: "#0b0b0b",
  textSecondary: "#52514e",
  textMuted: "#898781",
};

function dashFormatCurrency(v) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dashParseValor(raw) {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/R\$\s?/g, "").trim();
  if (!cleaned) return 0;
  if (/,\d{1,2}$/.test(cleaned)) return parseFloat(cleaned.replace(/\./g, "").replace(",", ".")) || 0;
  return parseFloat(cleaned.replace(/,/g, "")) || 0;
}

const DASH_QAVI_KEYWORDS = ["qavi", "menor que o target", "menor que target", "pago e n", "não lançado", "nao lancado"];
function dashClassifyImpact(tipo) {
  const joined = (tipo || "").toLowerCase();
  return DASH_QAVI_KEYWORDS.some((k) => joined.includes(k)) ? "qavi" : "proprietario";
}

// ---------- coletar linhas a partir da árvore + state.cells já carregados ----------

function collectDashboardRows() {
  const propertyByCampoId = {};
  const activeCampoIds = [];
  for (const section of state.tree || []) {
    for (const channel of section.channels || []) {
      for (const property of channel.properties || []) {
        for (const centro of property.centros || []) {
          for (const campo of centro.campos || []) {
            if (campo.isActive === false) continue;
            propertyByCampoId[campo.id] = property.name;
            activeCampoIds.push(campo.id);
          }
        }
      }
    }
  }

  const rows = [];
  const analyzedByMonth = {};
  for (const campoId of activeCampoIds) {
    for (const m of MONTHS) {
      const raw = state.cells[cellKey(campoId, m.key)];
      if (!raw) continue;
      analyzedByMonth[m.key] = (analyzedByMonth[m.key] || 0) + 1;
      const hasNaoConforme = STATUS_FIELDS.some((f) => raw[f.key] === "Não Conforme");
      if (!hasNaoConforme) continue;
      rows.push({
        propriedade: propertyByCampoId[campoId] || "—",
        mes: m.key,
        valor: dashParseValor(raw.valorBaseTarget),
        ocorrenciaTipo: raw.ocorrenciaTipo || "",
        corrigido: raw.corrigido || "",
        setor: raw.setorResponsavel || "",
        funcionario: raw.funcionarioResponsavel || "",
        impactType: dashClassifyImpact(raw.ocorrenciaTipo),
      });
    }
  }
  const properties = Array.from(new Set(Object.values(propertyByCampoId))).sort();
  return { rows, analyzedByMonth, properties };
}

function computeDashboardMetrics(dataset, mesFilter, propFilter) {
  const rows = dataset.rows.filter(
    (r) => (mesFilter === DASH_ALL || r.mes === mesFilter) && (propFilter === DASH_ALL || r.propriedade === propFilter)
  );

  const monthsInScope =
    mesFilter === DASH_ALL ? MONTHS.filter((m) => dataset.analyzedByMonth[m.key]).map((m) => m.key) : [mesFilter];

  const totalAnalyzed = monthsInScope.reduce((s, mk) => s + (dataset.analyzedByMonth[mk] || 0), 0);
  const totalErros = rows.length;
  const taxaErroTotal = totalAnalyzed > 0 ? (totalErros / totalAnalyzed) * 100 : 0;
  const taxaConformidadeTotal = Math.max(0, 100 - taxaErroTotal);

  const sumWhere = (pred) => rows.filter(pred).reduce((s, r) => s + r.valor, 0);
  const valorImpactado = sumWhere((r) => r.corrigido === "Não");
  const corrigidoQAVI = sumWhere((r) => r.corrigido === "Sim" && r.impactType === "qavi");
  const corrigidoProprietario = sumWhere((r) => r.corrigido === "Sim" && r.impactType === "proprietario");
  const impactoQAVI = sumWhere((r) => r.corrigido === "Não" && r.impactType === "qavi");
  const impactoProprietario = sumWhere((r) => r.corrigido === "Não" && r.impactType === "proprietario");

  const aggBy = (key) => {
    const map = new Map();
    rows.forEach((r) => {
      const v = (r[key] || "").trim() || "Não informado";
      map.set(v, (map.get(v) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  };
  const errosPorSetor = aggBy("setor");
  const errosPorFuncionario = aggBy("funcionario");

  const conformidadePorMes = monthsInScope.map((mk) => {
    const m = MONTHS.find((mm) => mm.key === mk);
    const analisados = dataset.analyzedByMonth[mk] || 0;
    const erros = rows.filter((r) => r.mes === mk).length;
    const conformes = Math.max(0, analisados - erros);
    return { mesLabel: m.label, analisados, erros, conformes, taxaConf: analisados > 0 ? (conformes / analisados) * 100 : 0 };
  });

  const propMap = new Map();
  rows.forEach((r) => propMap.set(r.propriedade, (propMap.get(r.propriedade) || 0) + 1));
  const errosPorPropriedade = Array.from(propMap.entries())
    .map(([name, count]) => ({ name, count, pct: totalErros > 0 ? (count / totalErros) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  const tipoMap = new Map();
  rows.forEach((r) => {
    const tipos = r.ocorrenciaTipo ? r.ocorrenciaTipo.split(/[,;]/).map((t) => t.trim()).filter(Boolean) : ["Não classificado"];
    tipos.forEach((tipo) => {
      const e = tipoMap.get(tipo) || { count: 0, valor: 0 };
      e.count += 1;
      e.valor += r.valor;
      tipoMap.set(tipo, e);
    });
  });
  const ocorrenciasPorTipo = Array.from(tipoMap.entries())
    .map(([name, { count, valor }]) => ({ name, count, valor }))
    .sort((a, b) => b.count - a.count);

  return {
    totalAnalyzed, totalErros, taxaConformidadeTotal, taxaErroTotal,
    valorImpactado, corrigidoQAVI, corrigidoProprietario, impactoQAVI, impactoProprietario,
    errosPorSetor, errosPorFuncionario, conformidadePorMes, errosPorPropriedade, ocorrenciasPorTipo,
    monthsInScope,
  };
}

// ---------- construção de DOM (sem interpolar texto do banco em innerHTML) ----------

function dashKpiCard(title, value, subtitle, variant) {
  const card = document.createElement("div");
  card.className = "dash-kpi" + (variant ? ` dash-kpi-${variant}` : "");
  const titleEl = document.createElement("p");
  titleEl.className = "dash-kpi-title";
  titleEl.textContent = title;
  const valueEl = document.createElement("p");
  valueEl.className = "dash-kpi-value";
  valueEl.textContent = value;
  card.appendChild(titleEl);
  card.appendChild(valueEl);
  if (subtitle) {
    const subEl = document.createElement("p");
    subEl.className = "dash-kpi-subtitle";
    subEl.textContent = subtitle;
    card.appendChild(subEl);
  }
  return card;
}

function dashChartCard(title, subtitle) {
  const card = document.createElement("div");
  card.className = "dash-chart-card";
  const head = document.createElement("div");
  head.className = "dash-chart-head";
  const titleEl = document.createElement("h3");
  titleEl.textContent = title;
  head.appendChild(titleEl);
  if (subtitle) {
    const subEl = document.createElement("p");
    subEl.textContent = subtitle;
    head.appendChild(subEl);
  }
  card.appendChild(head);
  return card;
}

function dashEmptyNote(text) {
  const p = document.createElement("p");
  p.className = "dash-empty";
  p.textContent = text;
  return p;
}

let dashCharts = {};
function dashDestroyCharts() {
  Object.values(dashCharts).forEach((c) => c && c.destroy());
  dashCharts = {};
}

function dashBarChart(canvas, key, labels, datasets, opts) {
  dashCharts[key] = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels, datasets },
    options: Object.assign(
      {
        indexAxis: opts && opts.horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: datasets.length > 1, labels: { color: DASH_COLOR.textSecondary, font: { size: 11 } } },
          tooltip: { titleColor: "#fff", bodyColor: "#fff" },
        },
        scales: {
          x: {
            grid: { color: DASH_COLOR.grid, display: !(opts && opts.horizontal) },
            ticks: { color: DASH_COLOR.textMuted, font: { size: 11 } },
            border: { color: DASH_COLOR.axis },
          },
          y: {
            grid: { color: DASH_COLOR.grid, display: !!(opts && opts.horizontal) },
            ticks: { color: DASH_COLOR.textMuted, font: { size: 11 } },
            border: { color: DASH_COLOR.axis },
          },
        },
      },
      opts && opts.overrides
    ),
  });
}

function dashRankingChart(container, key, items, opts) {
  const canvasWrap = document.createElement("div");
  const height = Math.max(180, items.length * 30);
  canvasWrap.style.height = height + "px";
  canvasWrap.style.position = "relative";
  const canvas = document.createElement("canvas");
  canvasWrap.appendChild(canvas);
  container.appendChild(canvasWrap);
  if (!items.length) {
    container.appendChild(dashEmptyNote((opts && opts.emptyText) || "Sem dados no filtro selecionado."));
    return;
  }
  dashBarChart(
    canvas,
    key,
    items.map((i) => i.name),
    [{ label: (opts && opts.seriesLabel) || "Total", data: items.map((i) => i.value), backgroundColor: DASH_COLOR.blue, maxBarThickness: 22, borderRadius: 4 }],
    { horizontal: true }
  );
}

// ---------- render principal ----------

let dashFilterState = { mes: DASH_ALL, prop: DASH_ALL };

function renderDashboard() {
  const dataset = collectDashboardRows();
  renderDashboardFilters(dataset);
  renderDashboardBody(dataset);
}

function renderDashboardFilters(dataset) {
  const el = document.getElementById("dashFilters");
  el.innerHTML = "";
  el.className = "dash-filters";

  const mesField = document.createElement("label");
  mesField.className = "field";
  const mesLabel = document.createElement("span");
  mesLabel.className = "field-label";
  mesLabel.textContent = "Mês";
  const mesSelect = document.createElement("select");
  mesSelect.className = "select";
  const mesAllOpt = document.createElement("option");
  mesAllOpt.value = DASH_ALL;
  mesAllOpt.textContent = "Todos os meses";
  mesSelect.appendChild(mesAllOpt);
  for (const m of MONTHS) {
    if (!dataset.analyzedByMonth[m.key]) continue;
    const o = document.createElement("option");
    o.value = m.key;
    o.textContent = m.label;
    mesSelect.appendChild(o);
  }
  mesSelect.value = dashFilterState.mes;
  mesSelect.addEventListener("change", () => {
    dashFilterState.mes = mesSelect.value;
    renderDashboardBody(dataset);
  });
  mesField.appendChild(mesLabel);
  mesField.appendChild(mesSelect);

  const propField = document.createElement("label");
  propField.className = "field";
  const propLabel = document.createElement("span");
  propLabel.className = "field-label";
  propLabel.textContent = "Propriedade";
  const propSelect = document.createElement("select");
  propSelect.className = "select";
  const propAllOpt = document.createElement("option");
  propAllOpt.value = DASH_ALL;
  propAllOpt.textContent = "Todas propriedades";
  propSelect.appendChild(propAllOpt);
  for (const p of dataset.properties) {
    const o = document.createElement("option");
    o.value = p;
    o.textContent = p;
    propSelect.appendChild(o);
  }
  propSelect.value = dashFilterState.prop;
  propSelect.addEventListener("change", () => {
    dashFilterState.prop = propSelect.value;
    renderDashboardBody(dataset);
  });
  propField.appendChild(propLabel);
  propField.appendChild(propSelect);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn";
  clearBtn.textContent = "Limpar filtros";
  clearBtn.addEventListener("click", () => {
    dashFilterState = { mes: DASH_ALL, prop: DASH_ALL };
    renderDashboard();
  });

  el.appendChild(mesField);
  el.appendChild(propField);
  el.appendChild(clearBtn);
}

function renderDashboardBody(dataset) {
  dashDestroyCharts();
  const body = document.getElementById("dashBody");
  body.innerHTML = "";

  if (!Object.keys(dataset.analyzedByMonth).length) {
    body.appendChild(
      dashEmptyNote("Ainda não há dados suficientes para o painel — marque alguns status de auditoria primeiro na aba Auditoria.")
    );
    return;
  }

  const m = computeDashboardMetrics(dataset, dashFilterState.mes, dashFilterState.prop);

  // KPIs — linha 1
  const kpiGrid1 = document.createElement("div");
  kpiGrid1.className = "dash-kpi-grid";
  kpiGrid1.appendChild(dashKpiCard("Total analisado", m.totalAnalyzed.toLocaleString("pt-BR"), m.monthsInScope.length + " mês(es) no escopo"));
  kpiGrid1.appendChild(dashKpiCard("Não conformidades", m.totalErros.toLocaleString("pt-BR"), `${m.taxaErroTotal.toFixed(2)}% de erro`, "critical"));
  kpiGrid1.appendChild(dashKpiCard("Taxa de conformidade", `${m.taxaConformidadeTotal.toFixed(1)}%`, "Itens conformes", "good"));
  kpiGrid1.appendChild(dashKpiCard("Impacto financeiro", dashFormatCurrency(m.valorImpactado), 'Erros com "Corrigido = Não"', "critical"));
  body.appendChild(kpiGrid1);

  // KPIs — linha 2 (impacto detalhado)
  const kpiGrid2 = document.createElement("div");
  kpiGrid2.className = "dash-kpi-grid";
  kpiGrid2.appendChild(dashKpiCard("Impacto QAVI (não corrigido)", dashFormatCurrency(m.impactoQAVI), "Pago menor que o target / não lançado", "warning"));
  kpiGrid2.appendChild(dashKpiCard("Impacto proprietário (não corrigido)", dashFormatCurrency(m.impactoProprietario), "Demais não conformidades", "critical"));
  kpiGrid2.appendChild(dashKpiCard("Corrigido QAVI", dashFormatCurrency(m.corrigidoQAVI), "Seria impacto QAVI, já corrigido", "good"));
  kpiGrid2.appendChild(dashKpiCard("Corrigido proprietário", dashFormatCurrency(m.corrigidoProprietario), "Seria impacto proprietário, já corrigido", "good"));
  body.appendChild(kpiGrid2);

  // Erros por setor / funcionário
  const chartRow1 = document.createElement("div");
  chartRow1.className = "dash-chart-grid-2";
  const setorCard = dashChartCard("Erros por setor responsável", `${m.errosPorSetor.length} setor(es) com ocorrências`);
  dashRankingChart(setorCard, "setor", m.errosPorSetor.map((r) => ({ name: r.name, value: r.count })), { seriesLabel: "Erros" });
  const funcCard = dashChartCard("Erros por funcionário responsável", `${m.errosPorFuncionario.length} funcionário(s) com ocorrências`);
  dashRankingChart(funcCard, "func", m.errosPorFuncionario.map((r) => ({ name: r.name, value: r.count })), { seriesLabel: "Erros" });
  chartRow1.appendChild(setorCard);
  chartRow1.appendChild(funcCard);
  body.appendChild(chartRow1);

  // Conformidade por mês (mini cards)
  if (m.conformidadePorMes.length) {
    const monthGrid = document.createElement("div");
    monthGrid.className = "dash-month-grid";
    for (const item of m.conformidadePorMes) {
      const card = document.createElement("div");
      card.className = "dash-month-card";
      const label = document.createElement("p");
      label.className = "dash-month-label";
      label.textContent = item.mesLabel;
      const value = document.createElement("p");
      value.className = "dash-month-value";
      value.textContent = `${item.taxaConf.toFixed(1)}%`;
      const sub = document.createElement("p");
      sub.className = "dash-month-sub";
      sub.textContent = `${item.analisados} analisados · ${item.erros} erros`;
      const bar = document.createElement("div");
      bar.className = "dash-month-bar";
      const fill = document.createElement("div");
      fill.className = "dash-month-bar-fill";
      fill.style.width = `${item.taxaConf}%`;
      bar.appendChild(fill);
      card.appendChild(label);
      card.appendChild(value);
      card.appendChild(sub);
      card.appendChild(bar);
      monthGrid.appendChild(card);
    }
    body.appendChild(monthGrid);
  }

  // Conformidade por mês (gráfico) + Erros por propriedade
  const chartRow2 = document.createElement("div");
  chartRow2.className = "dash-chart-grid-2";
  const confCard = dashChartCard("Conformidade por mês", "Conformes vs erros");
  if (m.conformidadePorMes.length) {
    const wrap = document.createElement("div");
    wrap.style.height = "280px";
    wrap.style.position = "relative";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    confCard.appendChild(wrap);
    dashBarChart(
      canvas,
      "conf",
      m.conformidadePorMes.map((i) => i.mesLabel),
      [
        { label: "Conformes", data: m.conformidadePorMes.map((i) => i.conformes), backgroundColor: DASH_COLOR.good, maxBarThickness: 24, borderRadius: 4 },
        { label: "Erros", data: m.conformidadePorMes.map((i) => i.erros), backgroundColor: DASH_COLOR.critical, maxBarThickness: 24, borderRadius: 4 },
      ]
    );
  } else {
    confCard.appendChild(dashEmptyNote("Sem dados no filtro selecionado."));
  }
  chartRow2.appendChild(confCard);

  const propCard = dashChartCard("Erros por propriedade", "Distribuição de não conformidades");
  dashRankingChart(propCard, "prop", m.errosPorPropriedade.map((r) => ({ name: r.name, value: r.count })), { seriesLabel: "Erros" });
  if (m.errosPorPropriedade.length) {
    const list = document.createElement("div");
    list.className = "dash-prop-list";
    for (const p of m.errosPorPropriedade) {
      const row = document.createElement("div");
      row.className = "dash-prop-row";
      const name = document.createElement("span");
      name.textContent = p.name;
      const count = document.createElement("span");
      count.className = "dash-prop-count";
      count.textContent = `${p.count} (${p.pct.toFixed(1)}%)`;
      row.appendChild(name);
      row.appendChild(count);
      list.appendChild(row);
    }
    propCard.appendChild(list);
  }
  chartRow2.appendChild(propCard);
  body.appendChild(chartRow2);

  // Ocorrências por tipo (contagem) + impacto financeiro por tipo
  const chartRow3 = document.createElement("div");
  chartRow3.className = "dash-chart-grid-2";
  const tipoCountCard = dashChartCard("Ocorrências por tipo", `${m.ocorrenciasPorTipo.length} tipo(s) com ocorrências`);
  dashRankingChart(tipoCountCard, "tipoCount", m.ocorrenciasPorTipo.map((r) => ({ name: r.name, value: r.count })), { seriesLabel: "Ocorrências" });
  const tipoValorCard = dashChartCard("Impacto financeiro por tipo", "Soma do valor (R$) por tipo de ocorrência");
  dashRankingChart(tipoValorCard, "tipoValor", m.ocorrenciasPorTipo.map((r) => ({ name: r.name, value: r.valor })), { seriesLabel: "Valor (R$)" });
  chartRow3.appendChild(tipoCountCard);
  chartRow3.appendChild(tipoValorCard);
  body.appendChild(chartRow3);

  // Tabela resumo por tipo
  const tableCard = dashChartCard("Resumo detalhado por tipo de ocorrência", "Quantidade e valor total no escopo filtrado");
  if (m.ocorrenciasPorTipo.length) {
    const table = document.createElement("table");
    table.className = "dash-table";
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Tipo</th><th class=\"num\">Quantidade</th><th class=\"num\">Valor total</th><th class=\"num\">Ticket médio</th></tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const tipo of m.ocorrenciasPorTipo) {
      const tr = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.textContent = tipo.name;
      const tdCount = document.createElement("td");
      tdCount.className = "num";
      tdCount.textContent = tipo.count.toLocaleString("pt-BR");
      const tdValor = document.createElement("td");
      tdValor.className = "num";
      tdValor.textContent = dashFormatCurrency(tipo.valor);
      const tdTicket = document.createElement("td");
      tdTicket.className = "num";
      tdTicket.textContent = dashFormatCurrency(tipo.count ? tipo.valor / tipo.count : 0);
      tr.appendChild(tdName);
      tr.appendChild(tdCount);
      tr.appendChild(tdValor);
      tr.appendChild(tdTicket);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableCard.appendChild(table);
  } else {
    tableCard.appendChild(dashEmptyNote("Nenhuma ocorrência para o filtro selecionado."));
  }
  body.appendChild(tableCard);
}

// ---------- abas ----------

function showTab(tab) {
  const isAuditoria = tab === "auditoria";
  document.getElementById("tabAuditoria").hidden = !isAuditoria;
  document.getElementById("tabIndicadores").hidden = isAuditoria;
  document.getElementById("tabBtnAuditoria").classList.toggle("tab-btn-active", isAuditoria);
  document.getElementById("tabBtnIndicadores").classList.toggle("tab-btn-active", !isAuditoria);
  if (!isAuditoria) renderDashboard();
}
document.getElementById("tabBtnAuditoria").addEventListener("click", () => showTab("auditoria"));
document.getElementById("tabBtnIndicadores").addEventListener("click", () => showTab("indicadores"));
