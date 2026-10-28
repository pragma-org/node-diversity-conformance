'use strict';

const DIMENSIONS = [
  { key: 'evaluation', label: 'Evaluation' },
  { key: 'budget', label: 'Budget' },
];

const state = { data: null, dimension: 'evaluation', protocol: null, plutus: null, cases: null, root: null };

// A percentage without the sign, as on the cards: a score is never rounded up to 100%.
function pctText(value) {
  return value === null ? '—' : `${pctValue(value)}%`;
}

// Green when everything passes, amber when the score only lacks missing results, red when a result fails.
function scoreClass({ fail, missing }) {
  if (fail > 0) return 'fail';
  return missing > 0 ? 'missing' : 'pass';
}

function countsOf(report, expectations, dimension) {
  const counts = dimensionCounts(report, expectations, dimension);
  const total = counts.pass + counts.fail + counts.missing;
  return { counts, total, score: ratio(counts.pass, total) };
}

// The score of one node for one dimension: a large percentage with the count, a bar, then the pass, fail and miss counts.
function dimensionBlock(node, report, expectations, dimension) {
  const { counts, total, score } = countsOf(report, expectations, dimension);
  const width = score === null ? 0 : Math.min(Number(pctValue(score)), 100);
  return `<div class="card-score" style="--node-color:${esc(node.color)}">
    <div class="score-line"><strong>${pctValue(score)}<small>%</small></strong><span class="card-count">${fmt(counts.pass)}/${fmt(total)}</span></div>
    <span class="node-score-bar" aria-hidden="true"><i style="width:${width}%"></i></span>
  </div>
  <div class="card-stats">${summaryTable(counts)}</div>`;
}

function budgetValue(value) {
  if (value && typeof value === 'object' && Number.isInteger(value.cpu) && Number.isInteger(value.mem)) {
    return value;
  }
  if (typeof value !== 'string') return null;
  const match = value.match(/cpu:\s*(-?\d+).*?mem:\s*(-?\d+)/s);
  return match ? { cpu: Number(match[1]), mem: Number(match[2]) } : null;
}

const normalized = new Map();

function normalizeEvaluation(value) {
  if (typeof value !== 'string') return value;
  if (!normalized.has(value)) normalized.set(value, normalizeTokens(value));
  return normalized.get(value);
}

function normalizeTokens(value) {
  const tokens = value.match(/"(?:\\.|[^"\\])*"|[()[\],{}]|[^\s()[\],{}]+/gs) || [];
  return tokens
    .join(' ')
    .replace(/([\[\({])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

function outcomeStatus(actual, expected, dimension) {
  if (!expected) return null;
  if (dimension === 'budget' && expected.budget === null) return null;
  if (actual === undefined) return 'missing';
  if (actual === null) return 'fail';
  if (actual.plutus_version !== expected.plutus_version || actual.protocol_version !== expected.protocol_version) return 'fail';
  if (dimension === 'evaluation') {
    return normalizeEvaluation(actual.evaluation) === normalizeEvaluation(expected.evaluation) ? 'pass' : 'fail';
  }
  const actualBudget = budgetValue(actual.budget);
  return actualBudget !== null && actualBudget.cpu === expected.budget.cpu && actualBudget.mem === expected.budget.mem ? 'pass' : 'fail';
}

function outcome(actual, expected, dimension) {
  const status = outcomeStatus(actual, expected, dimension);
  return status === null ? null : status === 'pass';
}

function dimensionCounts(report, expectations, dimension) {
  const counts = { pass: 0, fail: 0, missing: 0 };
  expectations.forEach((expected) => {
    const actual = actualFor(report, expected);
    const status = outcomeStatus(actual, expected, dimension);
    if (status) counts[status] += 1;
  });
  return counts;
}

function summaryTable({ pass, fail, missing }) {
  return `<table class="summary-breakdown" aria-label="Scenario result counts">
    <thead><tr><th>Pass</th><th>Fail</th><th>Miss</th></tr></thead>
    <tbody><tr><td class="summary-count pass">${fmt(pass)}</td><td class="summary-count fail">${fmt(fail)}</td><td class="summary-count missing">${fmt(missing)}</td></tr></tbody>
  </table>`;
}

function dimensionCell(actual, expected, dimension) {
  if (!expected || (dimension === 'budget' && expected.budget === null)) {
    return '<span class="dimension-status unknown">n/a</span>';
  }
  const status = outcomeStatus(actual, expected, dimension);
  return `<span class="dimension-status ${status === 'pass' ? 'full' : status === 'missing' ? 'missing' : 'partial'}">${status.toUpperCase()}</span>`;
}

function mismatchValue(value, dimension) {
  if (dimension === 'budget') {
    const budget = budgetValue(value);
    if (budget) return `cpu: ${budget.cpu}, mem: ${budget.mem}`;
  }
  return value === undefined || value === null ? '—' : String(value);
}

function mismatchRows(node, expected, actual) {
  if (actual === undefined) {
    const rows = [
      { label: `${node.name} · Evaluation`, expected: expected.evaluation, actual: 'missing', missing: true },
    ];
    if (expected.budget !== null && expected.budget !== undefined) {
      rows.push({ label: `${node.name} · Budget`, expected: expected.budget, actual: 'missing', dimension: 'budget', missing: true });
    }
    return rows;
  }

  const rows = [];
  if (actual.plutus_version !== expected.plutus_version || actual.protocol_version !== expected.protocol_version) {
    rows.push({
      label: `${node.name} · Version`,
      expected: `${expected.plutus_version} / ${expected.protocol_version}`,
      actual: `${actual.plutus_version || '—'} / ${actual.protocol_version || '—'}`,
    });
  }
  if (normalizeEvaluation(actual.evaluation) !== normalizeEvaluation(expected.evaluation)) {
    rows.push({
      label: `${node.name} · Evaluation`,
      expected: expected.evaluation,
      actual: actual.evaluation,
    });
  }
  if (expected.budget !== null && expected.budget !== undefined) {
    const actualBudget = budgetValue(actual.budget);
    if (!actualBudget || actualBudget.cpu !== expected.budget.cpu || actualBudget.mem !== expected.budget.mem) {
      rows.push({
        label: `${node.name} · Budget`,
        expected: expected.budget,
        actual: actual.budget,
        dimension: 'budget',
      });
    }
  }
  return rows;
}

function scenarioFailureDetails(item, nodes, byKey, expectations) {
  const expected = expectations.get(scenarioKey(item));
  if (!expected) return '';

  const mismatches = nodes
    .filter((node) => node.report)
    .flatMap((node) => mismatchRows(node, expected, byKey(node, item)))
    .filter((row) => (row.dimension === 'budget') === (state.dimension === 'budget'));
  if (!mismatches.length) return '';

  return `<div class="scenario-results">${mismatches.map(({ label, expected: expectedValue, actual, dimension, missing }) => `
    <div class="scenario-result">
      <span class="scenario-result-label">${esc(label)} · expected</span><code>${esc(mismatchValue(expectedValue, dimension))}</code>
      <span class="scenario-result-label ${missing ? 'missing-value' : 'failure-value'}">${esc(label)} · actual</span><code class="${missing ? 'missing-value' : 'failure-value'}">${esc(mismatchValue(actual, dimension))}</code>
    </div>`).join('')}</div>`;
}

function categoryPath(item) {
  const protocolVersion = item.protocol_version ?? 'unknown';
  const plutusVersion = item.plutus_version ?? 'unknown';
  const categories = String(item.group || 'other').split('/').filter(Boolean);
  return [
    { key: `protocol:${protocolVersion}`, label: `Protocol version ${protocolVersion}` },
    { key: `plutus:${plutusVersion}`, label: `Plutus ${plutusVersion}` },
    ...categories.map((category) => ({
      key: `category:${category}`,
      label: category.replaceAll('_', ' '),
    })),
  ];
}

function tree(items) {
  const root = { key: '', label: '', children: new Map(), items: [] };
  items.forEach((item) => {
    let parent = root;
    let parentKey = '';
    categoryPath(item).forEach(({ key: partKey, label }) => {
      const key = parentKey ? `${parentKey}/${partKey}` : partKey;
      if (!parent.children.has(key)) parent.children.set(key, { key, label, children: new Map(), items: [] });
      parent = parent.children.get(key);
      parentKey = key;
    });
    parent.items.push(item);
  });
  return root;
}

function descendants(node) {
  node.all ||= [...node.items, ...[...node.children.values()].flatMap(descendants)];
  return node.all;
}

// Switching between dimensions renders the page again, so what does not change is computed once.
const scenarioKeys = new WeakMap();

function scenarioKey(scenario) {
  if (!scenarioKeys.has(scenario)) {
    scenarioKeys.set(scenario, `${scenario.id}\u0000${scenario.plutus_version}\u0000${scenario.protocol_version}`);
  }
  return scenarioKeys.get(scenario);
}

// The results of a report by scenario key, and by scenario id for the results that name no versions.
const reportIndexes = new WeakMap();

function reportIndex(report) {
  if (!reportIndexes.has(report)) {
    const byKey = new Map();
    const byId = new Map();
    (report.scenarios || []).forEach((scenario) => {
      const key = scenarioKey(scenario);
      if (!byKey.has(key)) byKey.set(key, scenario);
      if (!byId.has(scenario.id)) byId.set(scenario.id, scenario);
    });
    reportIndexes.set(report, { byKey, byId });
  }
  return reportIndexes.get(report);
}

function actualFor(report, expected) {
  const index = reportIndex(report);
  return index.byKey.get(scenarioKey(expected)) || index.byId.get(expected.id);
}

function dimensionFraction(entries, node, byKey, dimension, expectations) {
  const counts = { pass: 0, fail: 0, missing: 0 };
  entries.forEach((entry) => {
    const status = outcomeStatus(byKey(node, entry), expectations.get(scenarioKey(entry)), dimension);
    if (status) counts[status] += 1;
  });
  const total = counts.pass + counts.fail + counts.missing;
  if (!total) return '<span class="dimension-status unknown">n/a</span>';
  const value = ratio(counts.pass, total);
  return `<span class="score ${scoreClass(counts)}">${pctText(value)}</span><span class="fraction-value">${fmt(counts.pass)}/${fmt(total)}</span>`;
}

function treeRows(root, nodes, byKey, expectations) {
  const rows = [];
  const dimension = state.dimension;
  let scenarioIndex = 0;
  function visit(node, parentKey = '', depth = 0) {
    const children = [...node.children.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
    for (const child of children) {
      const entries = descendants(child);
      const fractions = nodes.map((node) => `<td class="group-node-cell">
        <div>${dimensionFraction(entries, node, byKey, dimension, expectations)}</div>
      </td>`).join('');
      rows.push(`<tr class="group-header" data-group="${esc(child.key)}" data-parent="${esc(parentKey)}" data-depth="${depth}" style="--group-depth: ${depth}; --group-parent-depth: ${Math.max(depth - 1, 0)}"${depth ? ' hidden' : ''}>
        <td><button type="button" class="button button-plain group-toggle" aria-expanded="false">
          <span class="group-toggle-marker" aria-hidden="true"></span><span class="group-label">${esc(child.label.replaceAll('_', ' '))}</span>
        </button></td>${fractions}</tr>`);
      visit(child, child.key, depth + 1);
      child.items.sort((left, right) => String(left.id).localeCompare(String(right.id))).forEach((item) => {
        const details = scenarioFailureDetails(item, nodes, byKey, expectations);
        const detailId = `uplc-scenario-detail-${scenarioIndex++}`;
        const title = esc(item.title || item.id);
        const label = details
          ? `<button type="button" class="scenario-toggle" data-detail="${detailId}" aria-expanded="false">${title}</button>`
          : title;
        const cells = nodes.map((node) => {
          const scenario = byKey(node, item);
          const expected = expectations.get(scenarioKey(item));
          return `<td class="dimension-cell${scenario ? '' : ' missing'}">
            <div>${dimensionCell(scenario, expected, dimension)}</div>
          </td>`;
        }).join('');
        rows.push(`<tr id="${detailId}-row" class="scenario-row" data-parent="${esc(child.key)}" style="--group-depth: ${depth}"${item === child.items[child.items.length - 1] ? ' data-last="true"' : ''} hidden><td>${label}</td>${cells}</tr>`);
        if (details) {
          rows.push(`<tr id="${detailId}" class="scenario-detail" data-parent="${esc(child.key)}" data-scenario-detail="${detailId}-row" style="--group-depth: ${depth}" hidden><td colspan="${nodes.length + 1}"><div class="prose">${details}</div></td></tr>`);
        }
      });
    }
  }
  visit(root);
  return rows.join('');
}

function scenarioFailures(report, expectations) {
  if (!report) return null;
  return expectations.reduce((counts, expected) => {
    const actual = actualFor(report, expected);
    const evaluation = outcomeStatus(actual, expected, 'evaluation');
    const budget = outcomeStatus(actual, expected, 'budget');
    if (evaluation === 'fail' || budget === 'fail') counts.fail += 1;
    else if (evaluation === 'missing' || budget === 'missing') counts.missing += 1;
    return counts;
  }, { fail: 0, missing: 0 });
}

function activateTreeToggles() {
  const rows = [...document.querySelectorAll('#table-body tr[data-group], #table-body tr[data-parent]:not([data-group])')];
  const headers = new Map(rows.filter((row) => row.dataset.group).map((row) => [row.dataset.group, row]));
  const ancestorsOf = (key) => {
    const parts = key.split('/');
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  };
  const isExpanded = (key) => headers.get(key)?.querySelector('.group-toggle')?.getAttribute('aria-expanded') === 'true';
  const isVisible = (parentKey) => !parentKey || ancestorsOf(parentKey).filter((key) => headers.has(key)).every(isExpanded);
  const sync = () => rows.forEach((row) => {
    const parentVisible = isVisible(row.dataset.parent || '');
    if (row.dataset.scenarioDetail) {
      const scenarioRow = document.getElementById(row.dataset.scenarioDetail);
      row.hidden = !parentVisible || !scenarioRow || scenarioRow.hidden || scenarioRow.querySelector('.scenario-toggle')?.getAttribute('aria-expanded') !== 'true';
    } else {
      row.hidden = !parentVisible;
    }
  });

  document.querySelectorAll('.group-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const header = toggle.closest('tr');
      const group = header.dataset.group;
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      if (!expanded) {
        headers.forEach((child) => {
          if (child !== header && child.dataset.group.startsWith(`${group}/`)) {
            child.querySelector('.group-toggle')?.setAttribute('aria-expanded', 'false');
          }
        });
      }
      sync();
    });
  });
  document.querySelectorAll('.scenario-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      sync();
    });
  });
  sync();
}

// The protocol versions of the scenarios, as the first level of the tree. The oldest comes first.
function protocolNodes() {
  return [...state.root.children.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

// The Plutus versions of the selected protocol version, as the second level of the tree.
function plutusNodes() {
  const protocolNode = state.root.children.get(state.protocol);
  if (!protocolNode) return [];
  return [...protocolNode.children.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

function renderSelectors() {
  // A Plutus version is named by the last part of its key, so that the choice holds when the protocol version changes.
  const buttons = (nodes, selected, attribute, text) => nodes.map((node) => {
    const name = node.key.split('/').pop();
    const value = attribute === 'plutus' ? name : node.key;
    return `<button class="button${selected === value ? ' active' : ''}" data-${attribute}="${esc(value)}">${esc(text(node))}</button>`;
  }).join('');
  $('protocols').innerHTML = `<span class="label">Protocol</span>${buttons(protocolNodes(), state.protocol, 'protocol', (node) => node.label.replace('Protocol version ', ''))}`
    + `<span class="filter-sep" aria-hidden="true"></span>`
    + `<span class="label">Plutus</span>${buttons(plutusNodes(), state.plutus, 'plutus', (node) => node.label.replace('Plutus ', ''))}`;
}

function renderDimensions() {
  $('dimensions').innerHTML = DIMENSIONS.map(({ key, label }) =>
    `<button class="button${state.dimension === key ? ' active' : ''}" data-dimension="${key}">${label}</button>`
  ).join('');
}

function renderUplc() {
  const { data, dimension } = state;
  const nodes = data.nodes || [];
  const expectationList = data.expectations || [];
  const expectations = new Map(expectationList.map((expected) => [scenarioKey(expected), expected]));
  const reported = nodes.filter((node) => node.report);
  renderDimensions();

  const cards = reported.map((node) => `<div class="panel card">
      <div class="card-head"><div class="icon-prefix node-name">${nodeLogo(node)}${esc(node.name)}</div></div>
      ${dimensionBlock(node, node.report, expectationList, dimension)}
    </div>`);
  const unavailable = nodes.filter((node) => !node.report).map((node) => `
    <div class="panel card"><div class="card-head"><div class="icon-prefix node-name">${nodeLogo(node)}${esc(node.name)}</div></div>
      <div class="status error">No report</div><div class="warn-msg">${esc(node.error || 'no report')}</div>
    </div>`);
  $('summary').innerHTML = cards.concat(unavailable).join('') || '<div class="loading">No nodes configured.</div>';

  state.cases ||= [...new Map(expectationList.concat(reported.flatMap((node) => node.report.scenarios || []))
    .map((scenario) => [scenarioKey(scenario), scenario])).values()];
  state.root ||= tree(state.cases);
  const protocols = protocolNodes();
  if (!protocols.some((node) => node.key === state.protocol)) state.protocol = protocols[protocols.length - 1]?.key ?? null;
  const plutusVersions = plutusNodes();
  if (!plutusVersions.some((node) => node.key.endsWith(`/${state.plutus}`))) state.plutus = plutusVersions[plutusVersions.length - 1]?.key.split('/').pop() ?? null;
  const plutusNode = state.root.children.get(state.protocol)?.children.get(`${state.protocol}/${state.plutus}`);
  const protocolVersion = state.protocol?.replace('protocol:', '');
  const plutusVersion = state.plutus?.replace('plutus:', '');
  // The totals in the header are those of the selected protocol and Plutus versions.
  const protocolExpectations = expectationList.filter((expected) =>
    String(expected.protocol_version ?? 'unknown') === protocolVersion && String(expected.plutus_version ?? 'unknown') === plutusVersion);
  renderSelectors();
  const byKey = (node, expected) => (node.report ? actualFor(node.report, expected) : undefined);
  document.querySelector('.uplc-table').style.setProperty('--node-count', nodes.length);
  $('table-columns').innerHTML = `<col class="table-scenario">${nodes.map(() => '<col class="table-node">').join('')}`;
  const row = (first, cell) =>
    `<tr class="head-row"><th>${first}</th>${nodes.map((node) => `<th>${cell(node)}</th>`).join('')}</tr>`;
  const measure = (node) => (node.report ? countsOf(node.report, protocolExpectations, dimension) : null);
  $('table-head').innerHTML = [
    row('Scenarios', (node) => {
      const m = measure(node);
      const score = m ? `<span class="score ${scoreClass(m.counts)}">${pctText(m.score)}</span>` : '<span class="score missing">missing</span>';
      return `<span class="cellbox cellbox-head">${nodeLogo(node)}<span class="head-name" title="${esc(node.name)}">${esc(node.name)}</span>${score}</span>`;
    }),
    row('', (node) => {
      const m = measure(node);
      const width = !m || m.score === null ? 0 : Math.min(Number(pctValue(m.score)), 100);
      return `<span class="cellbox"><span class="node-score-bar" style="--node-color:${esc(node.color)}" aria-hidden="true"><i style="width:${width}%"></i></span></span>`;
    }),
    row('', (node) => {
      const m = measure(node);
      return `<span class="cellbox cellbox-end"><span class="cnt">${m ? `${fmt(m.counts.pass)}/${fmt(m.total)}` : ''}</span></span>`;
    }),
  ].join('');
  $('table-body').innerHTML = (plutusNode && treeRows(plutusNode, nodes, byKey, expectations)) ||
    `<tr class="empty-row"><td colspan="${nodes.length + 1}">No scenarios in the reports.</td></tr>`;
  activateTreeToggles();
  fitHeadNames();
}

$('protocols').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button?.dataset.protocol) return;
  state.protocol = button.dataset.protocol;
  renderUplc();
});

$('protocols').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button?.dataset.plutus) return;
  state.plutus = button.dataset.plutus;
  renderUplc();
});

$('dimensions').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button?.dataset.dimension) return;
  state.dimension = button.dataset.dimension;
  history.replaceState(null, '', `#${state.dimension}`);
  renderUplc();
});

async function main() {
  try {
    const response = await fetch('data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`data.json: HTTP ${response.status}`);
    const data = await response.json();
    renderHeader(data.scenario);
    state.data = data;
    const requested = location.hash.slice(1);
    if (DIMENSIONS.some(({ key }) => key === requested)) state.dimension = requested;
    renderUplc();
  } catch (error) {
    $('summary').innerHTML = `<div class="note error"><strong>Could not load report:</strong> ${esc(error.message)}</div>`;
  }
}

main();
