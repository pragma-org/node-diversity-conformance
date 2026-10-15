'use strict';

function dimensionSummary(totals, dimension) {
  const value = totals?.[dimension] || {};
  const score = ratio(value.passed, value.total);
  const status = score === null ? 'unknown' : score === 1 ? 'full' : 'partial';
  return `<span class="summary-measure"><span class="summary-score ${status}">${pct(score)}</span><span class="summary-fraction">${fmt(value.passed)} / ${fmt(value.total)}</span></span>`;
}

function dimensionCell(outcome) {
  if (!outcome || outcome.passed === null || outcome.passed === undefined) {
    return '<span class="dimension-status unknown">—</span>';
  }
  return `<span class="dimension-status ${outcome.passed ? 'full' : 'partial'}">${outcome.passed ? 'PASS' : 'FAIL'}</span>`;
}

function tree(items) {
  const root = { key: '', label: '', children: new Map(), items: [] };
  items.forEach((item) => {
    let parent = root;
    const parts = String(item.group || 'other').split('/').filter(Boolean);
    const path = [];
    parts.forEach((part) => {
      path.push(part);
      const key = path.join('/');
      if (!parent.children.has(key)) parent.children.set(key, { key, label: part, children: new Map(), items: [] });
      parent = parent.children.get(key);
    });
    parent.items.push(item);
  });
  return root;
}

function descendants(node) {
  return [...node.items, ...[...node.children.values()].flatMap(descendants)];
}

function dimensionFraction(entries, node, byId, dimension) {
  const outcomes = entries
    .map((entry) => byId(node, entry.id)?.[dimension])
    .filter((outcome) => outcome?.passed !== null && outcome?.passed !== undefined);
  if (!outcomes.length) return '<span class="dimension-status unknown">—</span>';
  const passed = outcomes.filter((outcome) => outcome.passed === true).length;
  const value = ratio(passed, outcomes.length);
  const status = value === null ? 'na' : value === 1 ? 'full' : 'partial';
  return `<span class="score ${status}">${pct(value)}</span><span class="fraction-value">${fmt(passed)}/${fmt(outcomes.length)}</span>`;
}

function treeRows(root, nodes, byId) {
  const rows = [];
  function visit(node, parentKey = '', depth = 0) {
    for (const child of node.children.values()) {
      const entries = descendants(child);
      const fractions = nodes.map((node) => `<td class="group-node-cell">
        <div>${dimensionFraction(entries, node, byId, 'evaluation')}</div>
        <div>${dimensionFraction(entries, node, byId, 'budget')}</div>
      </td>`).join('');
      rows.push(`<tr class="group-header" data-group="${esc(child.key)}" data-parent="${esc(parentKey)}" data-depth="${depth}" style="--group-depth: ${depth}; --group-parent-depth: ${Math.max(depth - 1, 0)}"${depth ? ' hidden' : ''}>
        <td><button type="button" class="button button-plain group-toggle" aria-expanded="false">
          <span class="group-toggle-marker" aria-hidden="true"></span><span class="group-label">${esc(child.label.replaceAll('_', ' '))}</span>
        </button></td><td class="group-dimensions"><div>Evaluation</div><div>Budget</div></td>${fractions}</tr>`);
      visit(child, child.key, depth + 1);
      child.items.sort((left, right) => String(left.id).localeCompare(String(right.id))).forEach((item) => {
        const cells = nodes.map((node) => {
          const scenario = byId(node, item.id);
          return `<td class="dimension-cell${scenario ? '' : ' missing'}">
            <div>${dimensionCell(scenario?.evaluation)}</div>
            <div>${dimensionCell(scenario?.budget)}</div>
          </td>`;
        }).join('');
        rows.push(`<tr class="scenario-row" data-parent="${esc(child.key)}" style="--group-depth: ${depth}"${item === child.items[child.items.length - 1] ? ' data-last="true"' : ''} hidden><td>${esc(item.title || item.id)}</td><td class="dimension-labels"><div>Evaluation</div><div>Budget</div></td>${cells}</tr>`);
      });
    }
  }
  visit(root);
  return rows.join('');
}

function scenarioFailures(report) {
  return (report.scenarios || []).filter((scenario) =>
    scenario.evaluation?.passed === false || scenario.budget?.passed === false).length;
}

function nodeHeading(node) {
  return `<th><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div></th>`;
}

function activateTreeToggles() {
  const rows = [...document.querySelectorAll('#table-body tr[data-group], #table-body tr[data-parent]:not([data-group])')];
  const headers = new Map(rows.filter((row) => row.dataset.group).map((row) => [row.dataset.group, row]));
  const ancestorsOf = (key) => {
    const parts = key.split('/');
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  };
  const isExpanded = (key) => headers.get(key)?.querySelector('.group-toggle')?.getAttribute('aria-expanded') === 'true';
  const isVisible = (parentKey) => !parentKey || ancestorsOf(parentKey).every(isExpanded);
  const sync = () => rows.forEach((row) => {
    row.hidden = !isVisible(row.dataset.parent || '');
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
  sync();
}

function renderUplc(data) {
  const nodes = data.nodes || [];
  const reported = nodes.filter((node) => node.report);
  const cards = reported.map((node) => {
    const totals = node.report.totals || {};
    const failures = scenarioFailures(node.report);
    const complete = (node.report.scenarios || []).length > 0 && failures === 0;
    return `<div class="panel card"><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
      <div class="status ${complete ? 'pass' : 'fail'}">${complete ? 'Fully conformant' : `${fmt(failures)} failures`}</div>
      <div class="key-values dimension-summary"><div class="key-value"><strong>Evaluation</strong><span>${dimensionSummary(totals, 'evaluation')}</span></div>
      <div class="key-value"><strong>Budget</strong><span>${dimensionSummary(totals, 'budget')}</span></div></div>
    </div>`;
  });
  const unavailable = nodes.filter((node) => !node.report).map((node) => `
    <div class="panel card"><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
      <div class="status error">No report</div><div class="warn-msg">${esc(node.error || 'no report')}</div>
    </div>`);
  $('summary').innerHTML = cards.concat(unavailable).join('') || '<div class="loading">No nodes configured.</div>';

  if ($('cost-models')) {
    $('cost-models').textContent = 'Budget model: protocol defaults selected for each Plutus language and protocol version.';
  }

  const cases = [...new Map(reported.flatMap((node) => node.report.scenarios || [])
    .map((scenario) => [scenario.id, scenario])).values()];
  const byId = (node, id) => node.report?.scenarios?.find((scenario) => scenario.id === id);
  $('table-columns').innerHTML = `<col class="table-scenario"><col class="table-dimension">${nodes.map(() => '<col class="table-node">').join('')}`;
  $('table-head').innerHTML = `<tr><th>Scenario</th><th class="dimension-heading">Dimension</th>${nodes.map(nodeHeading).join('')}</tr>`;
  $('table-body').innerHTML = treeRows(tree(cases), nodes, byId) ||
    `<tr class="empty-row"><td colspan="${nodes.length + 2}">No scenarios in the reports.</td></tr>`;
  activateTreeToggles();
}

async function main() {
  try {
    const response = await fetch('data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`data.json: HTTP ${response.status}`);
    const data = await response.json();
    renderHeader(data.scenario);
    renderUplc(data);
  } catch (error) {
    $('summary').innerHTML = `<div class="note error"><strong>Could not load report:</strong> ${esc(error.message)}</div>`;
  }
}

main();
