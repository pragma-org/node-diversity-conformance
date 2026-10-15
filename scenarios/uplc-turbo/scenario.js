'use strict';

const turboState = { selected: null, order: 'cpu' };
const DEVIATION_THRESHOLD = 0.5;

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signedDeviation(value) {
  const number = numeric(value);
  if (number === null) return '—';
  return `${number > 1 ? '+' : ''}${((number - 1) * 100).toFixed(1)}%`;
}

function shortId(value) {
  const id = String(value);
  return id.length > 24 ? `${id.slice(0, 20)}…${id.slice(-4)}` : id;
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
  return number === null ? '—' : ns(number);
}

function metricSummary(label, summary, formatter) {
  const line = (name, value, deviation) => {
    const status = deviation === null ? '' : deviation <= 1 + DEVIATION_THRESHOLD ? ' pass' : ' fail';
    return `<div class="turbo-metric-line">
    <span class="turbo-stat-label">${name}</span>
    <span class="turbo-stat-value">${formatter(value)}</span>
    <span class="turbo-stat-delta${status}">${deviation === null ? '' : ` Δ${signedDeviation(deviation)}`}</span>
  </div>`;
  };
  return `<div class="turbo-metric">
    <strong>${label}</strong>
    <div class="turbo-metric-values">
      ${line('mean', summary.mean, numeric(summary.mean_ratio))}
      ${line('max', summary.max, numeric(summary.max_ratio))}
    </div>
  </div>`;
}

function metricCell(entry, dimension) {
  const value = numeric(entry?.[dimension === 'memory' ? 'mem_max_bytes' : 'cpu_max_ns']);
  const deviation = numeric(entry?.[dimension === 'memory' ? 'mem_ratio' : 'cpu_ratio']);
  const formatted = dimension === 'memory' ? bytes(value) : duration(value);
  if (value === null) return `<td class="turbo-metric-cell"><span class="turbo-cell-values"><span class="measure">${formatted}</span><span class="deviation"></span></span></td>`;
  const status = deviation === null ? '' : deviation <= 1 + DEVIATION_THRESHOLD ? 'pass' : 'fail';
  const delta = deviation === null ? '' : `<span class="deviation ${status}"> Δ ${signedDeviation(deviation)}</span>`;
  return `<td class="turbo-metric-cell"><span class="turbo-cell-values"><span class="measure">${formatted}</span>${delta || '<span class="deviation"></span>'}</span></td>`;
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
      const failures = aggregateValue.total - aggregateValue.passed;
      const complete = aggregateValue.total > 0 && failures === 0;
      return `<button type="button" class="panel card turbo-node-card${node.id === turboState.selected ? ' selected' : ''}" data-node-id="${esc(node.id)}">
        <div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
        <div class="status ${complete ? 'pass' : 'fail'}">${complete ? 'Fully conformant' : `${fmt(failures)} failures`}</div>
        <div><span class="score ${complete ? 'pass' : 'fail'}">${pct(ratio(aggregateValue.passed, aggregateValue.total))}</span><span class="ratio">${fmt(aggregateValue.passed)} / ${fmt(aggregateValue.total)} scripts</span></div>
        <div class="turbo-metrics">${metricSummary('CPU', cpu, duration)}${metricSummary('MEM', memory, bytes)}</div>
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
    const entries = data.turbo_views?.[turboState.selected]?.[turboState.order] || [];
    const nodes = data.nodes;
    const sourceNode = nodes.find((node) => node.id === turboState.selected);
    const sourceLabel = sourceNode ? `top 10 across all versions · selected source: ${sourceNode.name}` : 'no source selected';
    const title = $('worst-cases-title');
    if (title)  {
      title.innerHTML = sourceNode
        ? `Worst ${nodeDot(sourceNode)} ${esc(sourceNode.name)} 10 cases`
        : 'Worst 10 cases';
    }
    $('worst-cases-source')?.replaceChildren(document.createTextNode(sourceLabel));
    $('table-head').innerHTML = `<tr><th>Benchmark</th><th>Metric</th>${nodes.map((node) => `<th><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div></th>`).join('')}</tr>`;
    $('table-body').innerHTML = entries.map((entry) => {
      const id = entry.bench;
      const cells = (dimension) => nodes.map((node) => metricCell(entry.nodes?.[node.id], dimension)).join('');
      return `<tr data-bench-row="${esc(id)}">
        <td rowspan="2" title="${esc(id)}">${esc(shortId(id))}</td>
        <td class="turbo-dimension">CPU</td>${cells('cpu')}
      </tr>
      <tr data-bench-row="${esc(id)}">
        <td class="turbo-dimension">MEM</td>${cells('memory')}
      </tr>`;
    }).join('') || `<tr class="empty-row"><td colspan="${nodes.length + 2}">No benchmark results.</td></tr>`;
    const tableBody = $('table-body');
    const pairedRows = (bench) => [...tableBody.querySelectorAll('tr[data-bench-row]')]
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

  $('turbo-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-order]');
    if (!button) return;
    turboState.order = button.dataset.order;
    document.querySelectorAll('#turbo-filters [data-order]').forEach((candidate) =>
      candidate.classList.toggle('active', candidate === button));
    renderWorstCases();
  });

  renderSummary();
  renderWorstCases();
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
