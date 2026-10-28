'use strict';

function shortId(value) {
  return String(value || '').match(/^\d{5}/)?.[0] || String(value || '');
}

function scenarioLabel(scenario) {
  return `(${scenario.id}) ${scenario.title}`;
}

function expectedValue(scenario) {
  if (scenario.expected && typeof scenario.expected === 'object') {
    if (scenario.expected.predicate) return scenario.expected.predicate;
    return JSON.stringify(scenario.expected);
  }
  return scenario.expected || 'Pass';
}

function expectedResult(scenario) {
  if (scenario.expected && typeof scenario.expected === 'object') {
    if (scenario.expected.decoding_failure === true) return 'DecodingFailure';
    if (scenario.expected.predicate) return scenario.expected.predicate;
  }
  return 'pass';
}

function resultPasses(scenario, result) {
  return resultStatus(scenario, result) === 'pass';
}

function resultStatus(scenario, result) {
  if (result === undefined) return 'missing';
  return result === expectedResult(scenario) ? 'pass' : 'fail';
}

function failureDetails(scenario, nodes, results) {
  const failures = nodes
    .map((node) => ({ node, result: results.get(node.id).get(scenario.id) }))
    .filter(({ result }) => !resultPasses(scenario, result));
  if (!failures.length) return '';
  return `<div class="scenario-results">
    <div class="scenario-result">
      <span class="scenario-result-label">Expected</span><code>${esc(expectedValue(scenario))}</code>
    </div>
    ${failures.map(({ node, result }) => {
      const missing = resultStatus(scenario, result) === 'missing';
      return `<div class="scenario-result">
      <span class="scenario-result-label">${esc(node.name)} actual</span><code class="${missing ? 'missing-value' : 'failure-value'}">${esc(missing ? 'missing' : result)}</code>
    </div>`;
    }).join('')}
  </div>`;
}

// The same figure as on the cards: a score is never rounded up to 100%.
function pctText(value) {
  return value === null ? '—' : `${pctValue(value)}%`;
}

function resultMap(node) {
  return new Map((node.report.scenarios || []).map((result) => [shortId(result.id), result.result]));
}

// Green when everything passes, amber when the score only lacks missing results, red when a scenario fails.
function scoreClass({ fail, missing }) {
  if (fail > 0) return 'fail';
  return missing > 0 ? 'missing' : 'pass';
}

function fraction(entries, nodes, results) {
  return nodes.map((node) => {
    const statuses = entries.map((entry) => resultStatus(entry, results.get(node.id).get(entry.id)));
    const passed = statuses.filter((status) => status === 'pass').length;
    const counts = { fail: statuses.filter((status) => status === 'fail').length, missing: statuses.filter((status) => status === 'missing').length };
    const score = ratio(passed, entries.length);
    return `<td class="group-count-cell"><span class="group-fraction"><span class="score ${scoreClass(counts)}">${pctText(score)}</span><span class="fraction-value">${fmt(passed)}/${fmt(entries.length)}</span></span></td>`;
  }).join('');
}

function summaryTable({ passed, failed, missing }) {
  return `<table class="summary-breakdown" aria-label="Scenario result counts">
    <thead><tr><th>Pass</th><th>Fail</th><th>Miss</th></tr></thead>
    <tbody><tr><td class="summary-count pass">${fmt(passed)}</td><td class="summary-count fail">${fmt(failed)}</td><td class="summary-count missing">${fmt(missing)}</td></tr></tbody>
  </table>`;
}

function renderLedger(data) {
  const loaded = data.nodes.filter((node) => node.report);
  const results = new Map(loaded.map((node) => [node.id, resultMap(node)]));
  const cases = data.definitions || [];
  const totals = loaded.map((node) => ({
    node,
    counts: cases.reduce((counts, scenario) => {
      counts[resultStatus(scenario, results.get(node.id).get(scenario.id))] += 1;
      return counts;
    }, { pass: 0, fail: 0, missing: 0 }),
    total: cases.length,
  }));
  const cards = totals.map(({ node, counts, total }) => {
    const score = ratio(counts.pass, total);
    const width = score === null ? 0 : Math.min(Number(pctValue(score)), 100);
    return `
    <div class="panel card">
      <div class="card-head"><div class="icon-prefix node-name">${nodeLogo(node)}${esc(node.name)}</div></div>
      <div class="card-score" style="--node-color:${esc(node.color)}">
        <div class="score-line"><strong>${pctValue(score)}<small>%</small></strong><span class="card-count">${fmt(counts.pass)}/${fmt(total)}</span></div>
        <span class="node-score-bar" aria-hidden="true"><i style="width:${width}%"></i></span>
      </div>
      <div class="card-stats">${summaryTable({ passed: counts.pass, failed: counts.fail, missing: counts.missing })}</div>
    </div>`;
  });
  const unavailable = data.nodes.filter((node) => !node.report).map((node) => `
    <div class="panel card"><div class="card-head"><div class="icon-prefix node-name">${nodeLogo(node)}${esc(node.name)}</div></div>
      <div class="status error">No report</div><div class="warn-msg">${esc(node.error || 'no report')}</div>
    </div>`);
  $('summary').innerHTML = cards.concat(unavailable).join('') || '<div class="loading">No nodes configured.</div>';

  document.querySelector('.ledger-table').style.setProperty('--node-count', loaded.length);
  $('table-columns').innerHTML = `<col class="table-scenario">${loaded.map(() => '<col class="table-node">').join('')}`;
  const row = (label, cell) =>
    `<tr class="head-row"><th>${label}</th>${totals.map((entry) => `<th>${cell(entry)}</th>`).join('')}</tr>`;
  const scoreOf = ({ counts, total }) => ratio(counts.pass, total);
  $('table-head').innerHTML = [
    row('Scenarios', (entry) => {
      const score = scoreOf(entry);
      return `<span class="cellbox cellbox-head">${nodeLogo(entry.node)}<span class="head-name" title="${esc(entry.node.name)}">${esc(entry.node.name)}</span><span class="score ${scoreClass(entry.counts)}">${pctText(score)}</span></span>`;
    }),
    row('', (entry) => {
      const score = scoreOf(entry);
      const width = score === null ? 0 : Math.min(Number(pctValue(score)), 100);
      return `<span class="cellbox"><span class="node-score-bar" style="--node-color:${esc(entry.node.color)}" aria-hidden="true"><i style="width:${width}%"></i></span></span>`;
    }),
    row('', (entry) => `<span class="cellbox cellbox-end"><span class="cnt">${fmt(entry.counts.pass)}/${fmt(entry.total)}</span></span>`),
  ].join('');

  const rows = grouped(cases, (scenario) => scenario.category).map(([category, entries]) => {
    const fractions = fraction(entries, loaded, results);
    const body = entries.map((scenario, index) => {
      const cells = loaded.map((node) => {
        const result = results.get(node.id).get(scenario.id);
        const status = resultStatus(scenario, result);
        return `<td class="${status === 'pass' ? 'full' : status === 'missing' ? 'missing' : 'partial'}">${status === 'pass' ? 'Pass' : status === 'missing' ? 'Missing' : 'Fail'}</td>`;
      }).join('');
      const detailId = `scenario-${esc(scenario.id)}`;
      const branch = index === entries.length - 1 ? ' data-last="true"' : '';
      return `<tr class="scenario-row" data-parent="${esc(category)}"${branch} hidden><td><button type="button" class="scenario-toggle" data-detail="${detailId}" aria-expanded="false">${esc(scenarioLabel(scenario))}</button></td>${cells}</tr>
        <tr id="${detailId}" class="scenario-detail" data-parent="${esc(category)}" hidden><td colspan="${loaded.length + 1}"><div class="prose">${esc(scenario.description)}${failureDetails(scenario, loaded, results)}</div></td></tr>`;
    }).join('');
    return `<tr class="group-header" data-group="${esc(category)}"><td>
      <button type="button" class="button button-plain group-toggle" aria-expanded="false">
        <span class="group-toggle-marker" aria-hidden="true"></span><span class="group-label">${esc(groupLabel(category))}</span>
      </button>
    </td>${fractions}</tr>${body}`;
  }).join('');
  $('table-body').innerHTML = rows || `<tr class="empty-row"><td colspan="${loaded.length + 1}">No scenarios in the reports.</td></tr>`;
  activateGroupToggles();
  activateScenarioToggles();
  fitHeadNames();
}

async function main() {
  try {
    const response = await fetch('data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`data.json: HTTP ${response.status}`);
    const data = await response.json();
    renderHeader(data.scenario);
    renderLedger(data);
  } catch (error) {
    $('summary').innerHTML = `<div class="note error"><strong>Could not load report:</strong> ${esc(error.message)}</div>`;
  }
}

main();
