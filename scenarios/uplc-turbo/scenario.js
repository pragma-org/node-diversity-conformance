'use strict';

const turboState = { selected: null, order: 'cpu', failedOnly: false };
const DEVIATION_THRESHOLD = 0.5;

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signedDeviation(value) {
  const number = numeric(value);
  if (number === null) return '—';
  const deviation = (number - 1) * 100;
  return `${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%`;
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

function tableHeader(tableId, nodes) {
  const table = $(tableId);
  table.querySelector(':scope > colgroup')?.remove();
  const columns = document.createElement('colgroup');
  for (let index = 0; index < 3; index += 1) {
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
    <th class="turbo-fit-cell turbo-meta-cell">Metric</th>
    ${nodes.map((node) => `<th class="turbo-node-cell"><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div></th>`).join('')}
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

function metricRow(name, value, deviation) {
  const status = deviation === null ? '' : deviation <= 1 + DEVIATION_THRESHOLD ? ' pass' : ' fail';
  return `<span class="turbo-stat-label">${name}</span>
    <span class="turbo-stat-value">${value}</span>
    <span class="turbo-stat-delta${status}">${deviation === null ? '' : ` Δ${signedDeviation(deviation)}`}</span>`;
}

function metricSummary(label, summary, formatter) {
  return `<div class="turbo-metric">
    <strong class="turbo-metric-label turbo-metric-label-span">${label}</strong>
    ${metricRow('mean', formatter(summary.mean), numeric(summary.mean_ratio))}
    ${metricRow('max', formatter(summary.max), numeric(summary.max_ratio))}
  </div>`;
}

function machineSummary(machine) {
  if (!machine) return '';
  const parts = [
    [machine.os, machine.os_version].filter(Boolean).join(' '),
    machine.architecture,
    machine.cpu,
    numeric(machine.logical_cores) === null ? null : `${fmt(machine.logical_cores)} logical cores`,
    numeric(machine.memory_bytes) === null ? null : `${bytes(machine.memory_bytes)} RAM`,
  ].filter(Boolean);
  return parts.length === 0 ? '' : `<div class="turbo-machine">${parts.map(esc).join(' · ')}</div>`;
}

function cpuFlatSummary(cpu, flat) {
  return `<div class="turbo-metric">
    <strong class="turbo-metric-label turbo-metric-label-span">CPU + FLAT</strong>
    ${metricRow('mean', `${duration(cpu.mean)} + ${duration(flat.mean)}`, numeric(cpu.mean_ratio))}
    ${metricRow('max', `${duration(cpu.max)} + ${duration(flat.max)}`, numeric(cpu.max_ratio))}
  </div>`;
}

function metricCell(entry, dimension) {
  const valueField = dimension === 'memory' ? 'mem_bytes' : dimension === 'flat' ? 'flat_us' : 'cpu_us';
  const ratioField = dimension === 'memory' ? 'mem_ratio' : dimension === 'flat' ? 'flat_ratio' : 'cpu_ratio';
  const passField = dimension === 'memory' ? 'mem_pass' : dimension === 'flat' ? 'flat_pass' : 'cpu_pass';
  if (entry?.error) {
    return `<td class="turbo-node-cell turbo-value-cell" title="${esc(entry.error)}"><span class="turbo-cell-values"><span class="measure">Not measured</span><span class="deviation"></span></span></td>`;
  }
  if (dimension === 'cpu-flat') {
    const cpu = numeric(entry?.cpu_us);
    const flat = numeric(entry?.flat_us);
    const deviation = numeric(entry?.cpu_ratio);
    if (cpu === null && flat === null) {
      return '<td class="turbo-node-cell turbo-value-cell"><span class="turbo-cell-values"><span class="measure">—</span><span class="deviation"></span></span></td>';
    }
    const status = entry?.cpu_pass === true
      ? 'pass'
      : entry?.cpu_pass === false
        ? 'fail'
        : deviation === null ? '' : deviation <= 1 + DEVIATION_THRESHOLD ? 'pass' : 'fail';
    const delta = deviation === null ? '' : `<span class="deviation ${status}"> Δ ${signedDeviation(deviation)}</span>`;
    return `<td class="turbo-node-cell turbo-value-cell"><span class="turbo-cell-values"><span class="measure">${duration(cpu)} + ${duration(flat)}</span>${delta || '<span class="deviation"></span>'}</span></td>`;
  }
  const value = numeric(entry?.[valueField]);
  const deviation = numeric(entry?.[ratioField]);
  const formatted = dimension === 'memory' ? bytes(value) : duration(value);
  if (value === null) return `<td class="turbo-node-cell turbo-value-cell"><span class="turbo-cell-values"><span class="measure">${formatted}</span><span class="deviation"></span></span></td>`;
  const status = entry?.[passField] === true
    ? 'pass'
    : entry?.[passField] === false
      ? 'fail'
      : deviation === null ? '' : deviation <= 1 + DEVIATION_THRESHOLD ? 'pass' : 'fail';
  const delta = deviation === null ? '' : `<span class="deviation ${status}"> Δ ${signedDeviation(deviation)}</span>`;
  return `<td class="turbo-node-cell turbo-value-cell"><span class="turbo-cell-values"><span class="measure">${formatted}</span>${delta || '<span class="deviation"></span>'}</span></td>`;
}

function budgetCell(entry, dimension) {
  const value = numeric(entry?.[dimension]);
  const status = entry?.[`${dimension}_status`] || 'missing';
  const formatted = value === null ? '—' : fmt(value);
  return `<td class="turbo-node-cell turbo-value-cell ${status}"><span class="turbo-cell-values single"><span class="measure">${formatted}</span></span></td>`;
}

function renderTurbo(data) {
  const loaded = data.nodes.filter((node) => node.report);
  turboState.selected = turboState.selected || loaded[0]?.id;
  const reportFor = () => loaded.find((node) => node.id === turboState.selected)?.report;

  function renderSummary() {
    const cards = loaded.map((node) => {
      const summary = data.turbo_summary?.[node.id];
      const aggregateValue = summary || { passed: 0, total: 0 };
      const cpu = summary?.cpu || { mean: null, mean_ratio: null, max: null, max_ratio: null, available: false };
      const memory = summary?.memory || { mean: null, mean_ratio: null, max: null, max_ratio: null, available: false };
      const flat = summary?.flat || { mean: null, mean_ratio: null, max: null, max_ratio: null, available: false };
      const failures = aggregateValue.total - aggregateValue.passed;
      const complete = aggregateValue.total > 0 && failures === 0;
      return `<button type="button" class="panel card turbo-node-card${node.id === turboState.selected ? ' selected' : ''}" data-node-id="${esc(node.id)}">
        <div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
        <div class="status ${complete ? 'pass' : 'fail'}">${complete ? 'Fully conformant' : `${fmt(failures)} failures`}</div>
        <div><span class="score ${complete ? 'pass' : 'fail'}">${pct(ratio(aggregateValue.passed, aggregateValue.total))}</span><span class="ratio">${fmt(aggregateValue.passed)} / ${fmt(aggregateValue.total)} scripts</span></div>
        ${machineSummary(summary?.machine)}
        <div class="turbo-metrics">
          ${cpuFlatSummary(cpu, flat)}
          ${metricSummary('MEM', memory, bytes)}
          <div class="turbo-metric">
            <strong class="turbo-metric-label">BUDGET</strong>
            ${metricRow('≠', fmt(data.turbo_disagreements?.by_node?.[node.id] || 0), null)}
          </div>
        </div>
      </button>`;
    });
    const unavailable = data.nodes.filter((node) => !node.report).map((node) => `
      <div class="panel card"><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
        <div class="status error">No report</div><div class="warn-msg">${esc(node.error || 'no report')}</div>
      </div>`);
    $('summary').innerHTML = cards.concat(unavailable).join('') || '<div class="loading">No nodes configured.</div>';
    document.querySelectorAll('[data-node-id]').forEach((button) => button.addEventListener('click', () => {
      turboState.selected = button.dataset.nodeId;
      renderSummary();
      renderWorstCases();
    }));
  }

  function renderWorstCases() {
    const viewKey = turboState.failedOnly ? `${turboState.order}-failed` : turboState.order;
    const entries = data.turbo_views?.[turboState.selected]?.[viewKey] || [];
    const nodes = data.nodes;
    const sourceNode = nodes.find((node) => node.id === turboState.selected);
    const sourceLabel = sourceNode
      ? `${turboState.failedOnly ? 'failed' : 'top 10'} across all versions · selected source: ${sourceNode.name}`
      : 'no source selected';
    const title = $('worst-cases-title');
    if (title)  {
      title.innerHTML = sourceNode
        ? `${turboState.failedOnly ? 'Failed' : 'Worst'} ${nodeDot(sourceNode)} ${esc(sourceNode.name)} 10 cases`
        : turboState.failedOnly ? 'Failed cases' : 'Worst 10 cases';
    }
    $('worst-cases-source')?.replaceChildren(document.createTextNode(sourceLabel));
    $('table-head').innerHTML = tableHeader('worst-cases-table', nodes);
    $('table-body').innerHTML = entries.map((entry) => {
      const id = entry.bench;
      const cells = (dimension) => nodes.map((node) => metricCell(entry.nodes?.[node.id], dimension)).join('');
      return `<tr class="turbo-result-row turbo-result-top" data-bench-row="${esc(id)}">
        <td class="turbo-fit-cell turbo-meta-cell" rowspan="2" title="${esc(id)}">${esc(shortId(id))}</td>
        <td class="turbo-fit-cell turbo-meta-cell" rowspan="2">${esc(versionLabel(entry))}</td>
        <td class="turbo-fit-cell turbo-meta-cell turbo-dimension">CPU + FLAT</td>${cells('cpu-flat')}
      </tr>
      <tr class="turbo-result-row turbo-result-bottom" data-bench-row="${esc(id)}">
        <td class="turbo-fit-cell turbo-meta-cell turbo-dimension">MEM</td>${cells('memory')}
      </tr>`;
    }).join('') || `<tr class="empty-row"><td colspan="${nodes.length + 3}">No benchmark results.</td></tr>`;
    bindPairedRowHover($('table-body'));
  }

  function renderBudgetDisagreements() {
    const report = data.turbo_disagreements || { total: 0, items: [] };
    const nodes = data.nodes;
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
    }).join('') || `<tr class="empty-row"><td colspan="${nodes.length + 3}">No disagreements found.</td></tr>`;
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
      turboState.failedOnly = false;
      document.querySelectorAll('#turbo-filters [data-order]').forEach((candidate) =>
        candidate.classList.toggle('active', candidate === button));
      const failedFilter = document.querySelector('#turbo-filters [data-filter="failed"]');
      failedFilter?.classList.remove('active');
      failedFilter?.setAttribute('aria-pressed', 'false');
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
