'use strict';

const turboState = { selected: null, order: 'cpu', failedOnly: false };

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signedDelta(value) {
  const number = numeric(value);
  if (number === null) return '—';
  const percentage = number * 100;
  return `${percentage > 0 ? '+' : ''}${percentage.toFixed(1)}%`;
}

function shortId(value) {
  const id = String(value);
  return id.length > 24 ? id.slice(0, 20) : id;
}

function bytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KiB`;
  return `${value.toFixed(0)} B`;
}

function duration(value) {
  const number = numeric(value);
  return number === null ? '—' : us(number);
}

function versionLabel(entry) {
  return entry?.plutus_version !== undefined && entry?.protocol_version !== undefined
    ? `${entry.plutus_version} / ${entry.protocol_version}`
    : '—';
}

// With a selected node, only that node keeps its name in the header. The others show their logo.
function tableHeader(tableId, nodes, withMetric = true, selectedId = null) {
  const table = $(tableId);
  table.querySelector(':scope > colgroup')?.remove();
  const columns = document.createElement('colgroup');
  for (let index = 0; index < (withMetric ? 3 : 2); index += 1) {
    const column = document.createElement('col');
    column.className = 'turbo-fit-column';
    columns.append(column);
  }
  nodes.forEach(() => {
    const column = document.createElement('col');
    column.className = 'turbo-node-column';
    columns.append(column);
  });
  table.prepend(columns);
  return `<tr>
    <th class="turbo-fit-cell turbo-meta-cell">Benchmark</th>
    <th class="turbo-fit-cell turbo-meta-cell">Plutus / Protocol</th>
    ${withMetric ? '<th class="turbo-fit-cell turbo-meta-cell">Metric</th>' : ''}
    ${nodes.map((node) => {
      const named = !selectedId || node.id === selectedId;
      return `<th class="turbo-node-cell${named ? '' : ' turbo-logo-only'}" title="${esc(node.name)}"><div class="icon-prefix node-name" aria-label="${esc(node.name)}">${nodeLogo(node)}${named ? esc(node.name) : ''}</div></th>`;
    }).join('')}
  </tr>`;
}

function bindPairedRowHover(tableBody) {
  const pairedRows = (bench) => [...tableBody.querySelectorAll('tr.turbo-result-row[data-bench-row]')]
    .filter((candidate) => candidate.dataset.benchRow === bench);
  tableBody.onmouseover = (event) => {
    const row = event.target.closest('tr[data-bench-row]');
    if (!row) return;
    pairedRows(row.dataset.benchRow).forEach((candidate) => candidate.classList.add('turbo-row-hover'));
  };
  tableBody.onmouseout = (event) => {
    const row = event.target.closest('tr[data-bench-row]');
    const next = event.relatedTarget?.closest?.('tr[data-bench-row]');
    if (!row || next?.dataset.benchRow === row.dataset.benchRow) return;
    pairedRows(row.dataset.benchRow).forEach((candidate) => candidate.classList.remove('turbo-row-hover'));
  };
}

function metricRow(name, value, delta, passed, suppressed = false) {
  const status = passed === null || passed === undefined ? '' : passed ? ' pass' : ' fail';
  return `<span class="turbo-stat-label">${name}</span>
    <span class="turbo-stat-value">${value}</span>
    <span class="turbo-stat-delta${status}">${delta === null ? (suppressed ? '-' : '') : ` Δ${signedDelta(delta)}`}</span>`;
}

function metricSummary(label, summary, formatter) {
  return `<div class="turbo-metric">
    <strong class="turbo-metric-label turbo-metric-label-span">${label}</strong>
    ${metricRow('mean', formatter(summary.mean), numeric(summary.mean_delta), summary.mean_pass, summary.mean_delta_suppressed)}
    ${metricRow('max', formatter(summary.max), numeric(summary.max_delta), summary.max_pass, summary.max_delta_suppressed)}
  </div>`;
}

function machineSummary(machine) {
  if (!machine) return '';
  return `<div class="turbo-machine">${[machine.architecture, machine.cpu].map(esc).join(' · ')}</div>`;
}

function metricCell(entry, dimension, show = 'both') {
  const valueField = dimension === 'memory' ? 'mem_bytes' : 'cpu_us';
  const deltaField = dimension === 'memory' ? 'mem_delta' : 'cpu_delta';
  const suppressedField = dimension === 'memory' ? 'mem_delta_suppressed' : 'cpu_delta_suppressed';
  const passField = dimension === 'memory' ? 'mem_pass' : 'cpu_pass';
  const value = numeric(entry?.[valueField]);
  const delta = deltaField ? numeric(entry?.[deltaField]) : null;
  const suppressed = entry?.[suppressedField] === true;
  const formatted = dimension === 'memory' ? bytes(value) : duration(value);
  if (show === 'delta') {
    const state = entry?.[passField] === true ? 'pass' : entry?.[passField] === false ? 'fail' : '';
    const text = delta !== null ? signedDelta(delta) : suppressed ? '-' : '';
    return `<td class="turbo-node-cell turbo-value-cell"><span class="turbo-cell-values single"><span class="measure deviation delta-only ${state}">${text}</span></span></td>`;
  }
  if (show === 'value') {
    return `<td class="turbo-node-cell turbo-value-cell"><span class="turbo-cell-values single"><span class="measure">${formatted}</span></span></td>`;
  }
  if (value === null) return `<td class="turbo-node-cell turbo-value-cell"><span class="turbo-cell-values"><span class="measure">${formatted}</span><span class="deviation"></span></span></td>`;
  const formattedDelta = delta === null
    ? suppressed ? '<span class="deviation">-</span>' : '<span class="deviation"></span>'
    : `<span class="deviation ${entry?.[passField] === true ? 'pass' : entry?.[passField] === false ? 'fail' : ''}"> Δ ${signedDelta(delta)}</span>`;
  return `<td class="turbo-node-cell turbo-value-cell"><span class="turbo-cell-values"><span class="measure">${formatted}</span>${formattedDelta}</span></td>`;
}

function budgetCell(entry, dimension) {
  const value = numeric(entry?.[dimension]);
  const status = entry?.[`${dimension}_status`] || 'missing';
  const formatted = value === null ? '—' : fmt(value);
  return `<td class="turbo-node-cell turbo-value-cell ${status}"><span class="turbo-cell-values single"><span class="measure">${formatted}</span></span></td>`;
}

// The selected node comes first, the others keep their order.
function selectedFirst(nodes) {
  return [...nodes].sort((a, b) => (b.id === turboState.selected) - (a.id === turboState.selected));
}

function renderTurbo(data) {
  const loaded = data.nodes.filter((node) => node.report);
  turboState.selected = turboState.selected || loaded[0]?.id;

  function renderSummary() {
    const cards = loaded.map((node) => {
      const summary = data.turbo_summary?.[node.id];
      const aggregateValue = summary || { passed: 0, total: 0 };
      const cpu = summary?.cpu || {
        mean: null, mean_delta: null,
        max: null, max_delta: null,
        mean_pass: null, max_pass: null, available: false,
      };
      const memory = summary?.memory || {
        mean: null, mean_delta: null, max: null, max_delta: null,
        mean_pass: null, max_pass: null, available: false,
      };
      const score = ratio(aggregateValue.passed, aggregateValue.total);
      const width = score === null ? 0 : Math.min(Number(pctValue(score)), 100);
      return `<button type="button" class="panel card turbo-node-card${node.id === turboState.selected ? ' selected' : ''}" data-node-id="${esc(node.id)}">
        <div class="card-head"><div class="icon-prefix node-name">${nodeLogo(node)}${esc(node.name)}</div></div>
        <div class="card-score" style="--node-color:${esc(node.color)}">
          <div class="score-line"><strong>${pctValue(score)}<small>%</small></strong><span class="card-count">${fmt(aggregateValue.passed)}/${fmt(aggregateValue.total)}</span></div>
          <span class="node-score-bar" aria-hidden="true"><i style="width:${width}%"></i></span>
        </div>
        ${machineSummary(summary?.machine)}
        <div class="turbo-metrics">
          ${metricSummary('CPU', cpu, duration)}
          ${metricSummary('MEM', memory, bytes)}
          <div class="turbo-metric">
            <strong class="turbo-metric-label">BUDGET</strong>
            ${metricRow('≠', fmt(data.turbo_disagreements?.by_node?.[node.id] || 0), null)}
          </div>
        </div>
      </button>`;
    });
    const unavailable = data.nodes.filter((node) => !node.report).map((node) => `
      <div class="panel card"><div class="card-head"><div class="icon-prefix node-name">${nodeLogo(node)}${esc(node.name)}</div></div>
        <div class="status error">No report</div><div class="warn-msg">${esc(node.error || 'no report')}</div>
      </div>`);
    $('summary').innerHTML = cards.concat(unavailable).join('') || '<div class="loading">No nodes configured.</div>';
    document.querySelectorAll('[data-node-id]').forEach((button) => button.addEventListener('click', () => {
      turboState.selected = button.dataset.nodeId;
      renderSummary();
      renderWorstCases();
      renderBudgetDisagreements();
    }));
  }

  function renderWorstCases() {
    const viewKey = turboState.failedOnly ? `${turboState.order}-failed` : turboState.order;
    const entries = data.turbo_views?.[turboState.selected]?.[viewKey] || [];
    const nodes = selectedFirst(data.nodes);
    const sourceNode = nodes.find((node) => node.id === turboState.selected);
    const sourceLabel = sourceNode
      ? `${turboState.failedOnly ? 'failed' : 'top 100'} across all versions · selected source: ${sourceNode.name}`
      : 'no source selected';
    const title = $('worst-cases-title');
    if (title)  {
      title.innerHTML = sourceNode
        ? `${turboState.failedOnly ? 'Failed' : 'Worst'} ${nodeLogo(sourceNode)} ${esc(sourceNode.name)}${turboState.failedOnly ? ' cases' : ' 100 cases'}`
        : turboState.failedOnly ? 'Failed cases' : 'Worst 100 cases';
    }
    $('worst-cases-source')?.replaceChildren(document.createTextNode(sourceLabel));
    $('table-head').innerHTML = tableHeader('worst-cases-table', nodes, false, turboState.selected);
    $('worst-cases-table').style.setProperty('--node-count', nodes.length);
    // The selected order ranks the scripts by one metric, so the table shows that metric, or its delta, and nothing else.
    const dimension = turboState.order.startsWith('cpu') ? 'cpu' : 'memory';
    const show = turboState.order.endsWith('deviation') ? 'delta' : 'value';
    $('table-body').innerHTML = entries.map((entry) => {
      const id = entry.bench;
      const cells = nodes.map((node) => metricCell(entry.nodes?.[node.id], dimension, show)).join('');
      return `<tr class="turbo-result-row" data-bench-row="${esc(id)}">
        <td class="turbo-fit-cell turbo-meta-cell" title="${esc(id)}">${esc(shortId(id))}</td>
        <td class="turbo-fit-cell turbo-meta-cell">${esc(versionLabel(entry))}</td>${cells}
      </tr>`;
    }).join('') || `<tr class="empty-row"><td colspan="${nodes.length + 2}">No results</td></tr>`;
    bindPairedRowHover($('table-body'));
  }

  function renderBudgetDisagreements() {
    const report = data.turbo_disagreements || { total: 0, items: [] };
    const nodes = selectedFirst(data.nodes);
    // Without a disagreement there is nothing to show, so the whole section stays hidden.
    $('budget-disagreements-section').hidden = report.items.length === 0;
    $('budget-disagreements-title').innerHTML = `Execution budget discrepancies <em>${fmt(report.total)} total</em>`;
    $('budget-disagreements-head').innerHTML = tableHeader('budget-disagreements-table', nodes);
    $('budget-disagreements-body').innerHTML = report.items.map((item) => {
      const cells = (dimension) => nodes.map((node) => budgetCell(item.nodes?.[node.id], dimension)).join('');
      return `<tr class="turbo-result-row turbo-result-top" data-bench-row="${esc(item.bench)}">
        <td class="turbo-fit-cell turbo-meta-cell" rowspan="2" title="${esc(item.bench)}">${esc(shortId(item.bench))}</td>
        <td class="turbo-fit-cell turbo-meta-cell" rowspan="2">${esc(versionLabel(item))}</td>
        <td class="turbo-fit-cell turbo-meta-cell turbo-dimension">CPU</td>${cells('cpu')}
      </tr>
      <tr class="turbo-result-row turbo-result-bottom" data-bench-row="${esc(item.bench)}">
        <td class="turbo-fit-cell turbo-meta-cell turbo-dimension">MEM</td>${cells('mem')}
      </tr>`;
    }).join('');
    bindPairedRowHover($('budget-disagreements-body'));
  }

  $('turbo-filters').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.filter === 'failed') {
      turboState.failedOnly = !turboState.failedOnly;
      button.classList.toggle('active', turboState.failedOnly);
      button.setAttribute('aria-pressed', String(turboState.failedOnly));
    } else if (button.dataset.order) {
      turboState.order = button.dataset.order;
      document.querySelectorAll('#turbo-filters [data-order]').forEach((candidate) =>
        candidate.classList.toggle('active', candidate === button));
    } else {
      return;
    }
    renderWorstCases();
  });

  renderSummary();
  renderWorstCases();
  renderBudgetDisagreements();
}

async function main() {
  try {
    const response = await fetch('data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`data.json: HTTP ${response.status}`);
    const data = await response.json();
    renderHeader(data.scenario);
    renderTurbo(data);
  } catch (error) {
    $('summary').innerHTML = `<div class="note error"><strong>Could not load report:</strong> ${esc(error.message)}</div>`;
  }
}

main();
