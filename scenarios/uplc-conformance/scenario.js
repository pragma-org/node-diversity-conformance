'use strict';

function dimensionSummary(report, expectations, dimension) {
  if (!report) return '<span class="summary-measure"><span class="summary-score unknown">—</span><span class="summary-fraction">—</span></span>';
  const counts = dimensionCounts(report, expectations, dimension);
  const total = counts.pass + counts.fail + counts.missing;
  const score = ratio(counts.pass, total);
  const status = score === null ? 'unknown' : score === 1 ? 'full' : 'partial';
  return `<div class="dimension-result">
    <span class="summary-measure"><span class="summary-score ${status}">${pct(score)}</span><span class="summary-fraction">${fmt(counts.pass)} / ${fmt(total)}</span></span>
    ${summaryTable(counts)}
  </div>`;
}

function budgetValue(value) {
  if (value && typeof value === 'object' && Number.isInteger(value.cpu) && Number.isInteger(value.mem)) {
    return value;
  }
  if (typeof value !== 'string') return null;
  const match = value.match(/cpu:\s*(-?\d+).*?mem:\s*(-?\d+)/s);
  return match ? { cpu: Number(match[1]), mem: Number(match[2]) } : null;
}

function normalizeEvaluation(value) {
  if (typeof value !== 'string') return value;

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
    return '<span class="dimension-status unknown">—</span>';
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
    .flatMap((node) => mismatchRows(node, expected, byKey(node, item)));
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
  return [...node.items, ...[...node.children.values()].flatMap(descendants)];
}

function scenarioKey(scenario) {
  return `${scenario.id}\u0000${scenario.plutus_version}\u0000${scenario.protocol_version}`;
}

function actualFor(report, expected) {
  return report.scenarios?.find((scenario) => scenarioKey(scenario) === scenarioKey(expected))
    || report.scenarios?.find((scenario) => scenario.id === expected.id);
}

function dimensionFraction(entries, node, byKey, dimension, expectations) {
  const outcomes = entries
    .map((entry) => outcome(byKey(node, entry), expectations.get(scenarioKey(entry)), dimension))
    .filter((value) => value !== null);
  if (!outcomes.length) return '<span class="dimension-status unknown">—</span>';
  const passed = outcomes.filter(Boolean).length;
  const value = ratio(passed, outcomes.length);
  const status = value === null ? 'na' : value === 1 ? 'full' : 'partial';
  return `<span class="score ${status}">${pct(value)}</span><span class="fraction-value">${fmt(passed)}/${fmt(outcomes.length)}</span>`;
}

function treeRows(root, nodes, byKey, expectations) {
  const rows = [];
  let scenarioIndex = 0;
  function visit(node, parentKey = '', depth = 0) {
    const children = [...node.children.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
    for (const child of children) {
      const entries = descendants(child);
      const fractions = nodes.map((node) => `<td class="group-node-cell">
        <div>${dimensionFraction(entries, node, byKey, 'evaluation', expectations)}</div>
        <div>${dimensionFraction(entries, node, byKey, 'budget', expectations)}</div>
      </td>`).join('');
      rows.push(`<tr class="group-header" data-group="${esc(child.key)}" data-parent="${esc(parentKey)}" data-depth="${depth}" style="--group-depth: ${depth}; --group-parent-depth: ${Math.max(depth - 1, 0)}"${depth ? ' hidden' : ''}>
        <td><button type="button" class="button button-plain group-toggle" aria-expanded="false">
          <span class="group-toggle-marker" aria-hidden="true"></span><span class="group-label">${esc(child.label.replaceAll('_', ' '))}</span>
        </button></td><td class="group-dimensions"><div>Evaluation</div><div>Budget</div></td>${fractions}</tr>`);
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
            <div>${dimensionCell(scenario, expected, 'evaluation')}</div>
            <div>${dimensionCell(scenario, expected, 'budget')}</div>
          </td>`;
        }).join('');
        rows.push(`<tr id="${detailId}-row" class="scenario-row" data-parent="${esc(child.key)}" style="--group-depth: ${depth}"${item === child.items[child.items.length - 1] ? ' data-last="true"' : ''} hidden><td>${label}</td><td class="dimension-labels"><div>Evaluation</div><div>Budget</div></td>${cells}</tr>`);
        if (details) {
          rows.push(`<tr id="${detailId}" class="scenario-detail" data-parent="${esc(child.key)}" data-scenario-detail="${detailId}-row" style="--group-depth: ${depth}" hidden><td colspan="${nodes.length + 2}"><div class="prose">${details}</div></td></tr>`);
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

function renderUplc(data) {
  const nodes = data.nodes || [];
  const expectationList = data.expectations || [];
  const expectations = new Map(expectationList.map((expected) => [scenarioKey(expected), expected]));
  const reported = nodes.filter((node) => node.report);
  const cards = reported.map((node) => {
    const counts = scenarioFailures(node.report, expectationList);
    const complete = expectationList.length > 0 && counts.fail === 0 && counts.missing === 0;
    return `<div class="panel card"><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
      <div class="status ${complete ? 'pass' : 'fail'}">${complete ? 'Fully conformant' : `${fmt(counts.fail)} failures · ${fmt(counts.missing)} missing`}</div>
      <div class="key-values dimension-summary"><div class="key-value"><strong>Evaluation</strong><div>${dimensionSummary(node.report, expectationList, 'evaluation')}</div></div>
      <div class="key-value"><strong>Budget</strong><div>${dimensionSummary(node.report, expectationList, 'budget')}</div></div></div>
    </div>`;
  });
  const unavailable = nodes.filter((node) => !node.report).map((node) => `
    <div class="panel card"><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
      <div class="status error">No report</div><div class="warn-msg">${esc(node.error || 'no report')}</div>
    </div>`);
  $('summary').innerHTML = cards.concat(unavailable).join('') || '<div class="loading">No nodes configured.</div>';

  const cases = [...new Map(expectationList.concat(reported.flatMap((node) => node.report.scenarios || []))
    .map((scenario) => [scenarioKey(scenario), scenario])).values()];
  const byKey = (node, expected) => node.report?.scenarios?.find((scenario) => scenarioKey(scenario) === scenarioKey(expected))
    || node.report?.scenarios?.find((scenario) => scenario.id === expected.id);
  $('table-columns').innerHTML = `<col class="table-scenario"><col class="table-dimension">${nodes.map(() => '<col class="table-node">').join('')}`;
  $('table-head').innerHTML = `<tr><th>Scenario</th><th class="dimension-heading">Dimension</th>${nodes.map(nodeHeading).join('')}</tr>`;
  $('table-body').innerHTML = treeRows(tree(cases), nodes, byKey, expectations) ||
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
