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
  return result === expectedResult(scenario);
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
    ${failures.map(({ node, result }) => `<div class="scenario-result">
      <span class="scenario-result-label">${esc(node.name)} actual</span><code class="failure-value">${esc(result || 'No result reported')}</code>
    </div>`).join('')}
  </div>`;
}

function resultMap(node) {
  return new Map((node.report.scenarios || []).map((result) => [shortId(result.id), result.result]));
}

function heading(node, passed, total) {
  const score = ratio(passed, total);
  return `<th><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
    <div class="score ${score === 1 ? 'full' : 'partial'}">${pct(score)}<span class="cnt">${fmt(passed)}/${fmt(total)}</span></div></th>`;
}

function fraction(entries, nodes, results) {
  return nodes.map((node) => {
    const passed = entries.filter((entry) => resultPasses(entry, results.get(node.id).get(entry.id))).length;
    const score = ratio(passed, entries.length);
    return `<td class="group-count-cell"><span class="group-fraction"><span class="score ${score === 1 ? 'pass' : 'fail'}">${pct(score)}</span><span class="fraction-value">${fmt(passed)}/${fmt(entries.length)}</span></span></td>`;
  }).join('');
}

function renderLedger(data) {
  const loaded = data.nodes.filter((node) => node.report);
  const results = new Map(loaded.map((node) => [node.id, resultMap(node)]));
  const cases = data.definitions || [];
  const totals = loaded.map((node) => ({
    node,
    passed: cases.filter((scenario) => resultPasses(scenario, results.get(node.id).get(scenario.id))).length,
    total: cases.length,
  }));
  const cards = totals.map(({ node, passed, total }) => `
    <div class="panel card"><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
      <div class="status ${passed === total ? 'pass' : 'fail'}">${passed === total ? 'Fully conformant' : `${fmt(total - passed)} failures`}</div>
      <div><span class="score ${passed === total ? 'pass' : 'fail'}">${pct(ratio(passed, total))}</span><span class="ratio">${fmt(passed)} / ${fmt(total)} scenarios</span></div>
    </div>`);
  const unavailable = data.nodes.filter((node) => !node.report).map((node) => `
    <div class="panel card"><div class="icon-prefix node-name">${nodeDot(node)}${esc(node.name)}</div>
      <div class="status error">No report</div><div class="warn-msg">${esc(node.error || 'no report')}</div>
    </div>`);
  $('summary').innerHTML = cards.concat(unavailable).join('') || '<div class="loading">No nodes configured.</div>';

  $('table-head').innerHTML = `<tr><th>Scenario</th>${totals.map(({ node, passed, total }) => heading(node, passed, total)).join('')}</tr>`;

  const rows = grouped(cases, (scenario) => scenario.category).map(([category, entries]) => {
    const fractions = fraction(entries, loaded, results);
    const body = entries.map((scenario, index) => {
      const cells = loaded.map((node) => {
        const result = results.get(node.id).get(scenario.id);
        const passed = resultPasses(scenario, result);
        return `<td class="${passed ? 'full' : 'partial'}">${passed ? 'Pass' : 'Fail'}</td>`;
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
