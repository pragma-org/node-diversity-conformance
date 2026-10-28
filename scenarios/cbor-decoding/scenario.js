'use strict';

const CATEGORIES = [
  {
    key: 'roundtrip',
    label: 'Valid round-trip',
    short: 'Round-trip',
    expected: 'valid_expected',
    actual: 'valid_actual',
  },
  {
    key: 'rejected',
    label: 'Invalid rejected',
    short: 'Rejected',
    expected: 'invalid_expected',
    actual: 'invalid_actual',
  },
];

const MAX_SAMPLES_PER_CLASS = 25;

const DEFAULT_ERA = 'conway';
// The eras that have a dataset. They are always offered, even when no node has published a report for them yet.
const ERAS = ['conway', 'dijkstra'];
const DATASET_REPOSITORY = 'https://github.com/r2rationality/cardano-cbor-dataset';
const LEDGER_REPOSITORY = 'https://github.com/IntersectMBO/cardano-ledger';

const state = {
  allNodes: [], nodes: [], eras: [], era: DEFAULT_ERA, category: 'all',
  open: new Set(), samples: {}, ledgerCommits: {},
};

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function safeUrl(url) {
  return /^https?:\/\//.test(url || '') ? url : null;
}

// Met and total expectations of one Outcome, for one category or all of them.
function score(outcome, category = 'all') {
  const cats = category === 'all' ? CATEGORIES : CATEGORIES.filter((c) => c.key === category);
  let met = 0;
  let expected = 0;
  for (const c of cats) {
    met += Number(outcome?.[c.actual] ?? 0);
    expected += Number(outcome?.[c.expected] ?? 0);
  }
  return { met, expected, ratio: expected === 0 ? null : met / expected };
}

// Never round a failing node up to 100%.
function pctValue(ratio) {
  if (ratio === null) return '—';
  if (ratio === 1) return '100';
  return Math.min(Math.floor(ratio * 10000) / 100, 99.99).toFixed(2);
}

function pct(ratio) {
  return ratio === null ? '—' : `${pctValue(ratio)}%`;
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

function eraOf(report) {
  return report.era || DEFAULT_ERA;
}

function eraName(era) {
  return era.charAt(0).toUpperCase() + era.slice(1);
}

function erasOf(nodes) {
  const eras = new Set(ERAS);
  for (const n of nodes) {
    if (n.report) eras.add(eraOf(n.report));
    for (const era of Object.keys(n.eras || {})) eras.add(era);
  }
  return [...ERAS, ...[...eras].filter((era) => !ERAS.includes(era)).sort()];
}

function nodeForEra(n, era) {
  const byEra = { ...(n.eras || {}) };
  if (n.report) byEra[eraOf(n.report)] = { report: n.report, report_url: n.report_url, error: n.error };
  if (byEra[era]) return { ...n, ...byEra[era] };
  const error = n.report || n.eras ? `no ${era} report` : n.error;
  return { ...n, report: null, report_url: null, error };
}

function commitLink(repository, commit) {
  const label = `<code>${esc(commit.slice(0, 7))}</code>`;
  const url = safeUrl(repository);
  return url ? `<a href="${esc(url)}/commit/${esc(commit)}" target="_blank" rel="noopener">${label}</a>` : label;
}

// The latest dataset is the one named by the most recent report that names one. A report made with another dataset, or
// with none, is not up to date.
function latestDatasetCommit() {
  const time = (n) => new Date(n.report.generated_at).getTime() || 0;
  const named = loaded().filter((n) => n.report.dataset_commit).sort((a, b) => time(b) - time(a));
  return named.length ? named[0].report.dataset_commit : null;
}

// A pill that tells whether the report was made with the latest dataset, with a box that gives the reason on hover.
// Nothing is shown when no report names a dataset.
function freshnessPill(report, latest) {
  if (!latest) return '';
  const short = (commit) => `<code>${esc(commit.slice(0, 7))}</code>`;
  const pill = (kind, label, reason) =>
    `<span class="freshness ${kind}" tabindex="0">${label}<span class="freshness-tip" role="tooltip">${reason}</span></span>`;
  if (report.dataset_commit === latest) {
    return pill('latest', 'Latest', `This report was made with the latest CBOR dataset: ${short(latest)}`);
  }
  const reason = report.dataset_commit
    ? `This report was made with an older version of the dataset: ${short(report.dataset_commit)}`
    : `This report was made with an older version of the dataset. The report does not name it.`;
  return pill('outdated', 'Outdated', reason);
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

// The facts that identify a report, folded under the card so that the score stays the first thing to read.
function reportDetails(report, node) {
  const rows = [
    ['Protocol', esc(report.protocol_version)],
    report.dataset_commit && ['Dataset version', commitLink(DATASET_REPOSITORY, report.dataset_commit)],
    report.implementation_commit && ['Node version', commitLink(node.repository, report.implementation_commit)],
    isoDate(report.generated_at) && ['Generated', esc(isoDate(report.generated_at))],
  ].filter(Boolean);
  return `<details class="card-details"><summary>Versions</summary><div class="key-values">${
    rows.map(([label, value]) => `<div class="key-value"><span>${label}</span><span>${value}</span></div>`).join('')
  }</div></details>`;
}

function dot(node) {
  return `<span class="dot" style="background:${node.color}"></span>`;
}

function logo(node) {
  return node.logo ? `<img class="node-logo-small" src="../../${esc(node.logo)}" alt="">` : dot(node);
}

function loaded() {
  return state.nodes.filter((n) => n.report);
}

// Keep the strongest reports first so all report sections use the same order.
function ranked() {
  return loaded()
    .map((n) => ({ node: n, s: score(n.report.totals) }))
    .sort((a, b) => (b.s.ratio ?? -1) - (a.s.ratio ?? -1) || a.node.name.localeCompare(b.node.name));
}

function renderWarnings() {
  const out = [];

  const icon = `<svg style="position: relative; top: 2px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-alert-triangle"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

  const nodes = loaded();
  if (nodes.length) {
    for (const n of state.nodes.filter((n) => n.error)) {
      out.push(`<div class="note error"><strong>${icon}${esc(n.name)}:</strong> report unavailable (${esc(n.error)}).</div>`);
    }
  }
  const versions = new Set(nodes.map((n) => n.report.protocol_version));
  if (versions.size > 1) {
    const list = nodes.map((n) => `${esc(n.name)} <code>${esc(n.report.protocol_version)}</code>`).join(', ');
    out.push(`<div class="note warn"><strong>${icon}Different protocol versions:</strong> ${list}.</div>`);
  }
  $('warnings').innerHTML = out.join('');
}

function renderCards() {
  const latest = latestDatasetCommit();
  const cards = ranked().map(({ node, s }) => {
    const r = node.report;
    const width = s.ratio === null ? 0 : Math.min(Number(pctValue(s.ratio)), 100);
    return `<div class="panel card">
      <div class="card-head"><div class="icon-prefix node-name">${logo(node)}${esc(node.name)}</div>${freshnessPill(r, latest)}</div>
      <div class="card-score" style="--node-color:${esc(node.color)}">
        <strong>${pctValue(s.ratio)}<small>%</small></strong>
        <span class="node-score-bar" aria-hidden="true"><i style="width:${width}%"></i></span>
      </div>
      <div class="card-foot">${reportDetails(r, node)}<span class="card-count">${fmt(s.met)}/${fmt(s.expected)}</span></div>
    </div>`;
  });
  // A node that has no report for the era is waiting for results. Any other error is shown as it is.
  const errors = state.nodes.filter((n) => n.error).map((node) => {
    const waiting = /^no (\w+ )?report$/.test(node.error);
    return `<div class="panel card">
      <div class="card-head"><div class="icon-prefix node-name">${logo(node)}${esc(node.name)}</div>${waiting ? '<span class="freshness pending">Pending</span>' : ''}</div>
      ${waiting ? '' : `<div class="err-msg">${esc(node.error)}</div>`}
    </div>`;
  });
  $('cards').innerHTML = cards.concat(errors).join('') || '<div class="loading">No nodes configured.</div>';
}

function renderEras() {
  $('eras').innerHTML = state.eras.map((era) =>
    `<button class="button${state.era === era ? ' active' : ''}" data-era="${esc(era)}">${esc(eraName(era))}</button>`
  ).join('');
}

function renderFilters() {
  const buttons = [...CATEGORIES, { key: 'all', short: 'All' }].map((c) =>
    `<button class="button${state.category === c.key ? ' active' : ''}" data-category="${c.key}">${esc(c.short)}</button>`
  ).join('');
  $('filters').innerHTML = buttons;
}

function cell(outcome) {
  let [cls, score] = scoreSpan(outcome);
  return `<td class="${cls}">${score}</td>`;
}

function scoreSpan(outcome) {
  if (!outcome) return ["missing", "missing"];
  const s = score(outcome, state.category);
  if (s.ratio === null) return ["na", "—"];
  const cls = s.ratio === 1 ? 'full' : 'partial';
  return [cls, `<span class="cellbox"><span class="pctv">${pct(s.ratio)}</span><span class="cnt">${fmt(s.met)}/${fmt(s.expected)}</span></span>`];
}

// The sample names are in a file of their own for each report. They are loaded the first time that a rule is unfolded.
function loadSamples(url) {
  if (!state.samples[url]) {
    state.samples[url] = { status: 'loading' };
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => { state.samples[url] = { status: 'ready', data }; })
      .catch((error) => { state.samples[url] = { status: 'error', error: error.message }; })
      .then(renderTable);
  }
  return state.samples[url];
}

function sampleCell(outcome) {
  if (outcome === undefined) return '<td class="na">—</td>';
  if (outcome === 1) return '<td class="full sample-pass">pass</td>';
  const failureClass = String(outcome).split(':')[0];
  return `<td class="partial sample-fail" title="${esc(outcome)}">fail <span class="cnt">${esc(failureClass)}</span></td>`;
}

// One row for each sample of the rule, with the outcome of every node that lists it.
function sampleRows(rule, nodes) {
  const columns = nodes.length + 1;
  const message = (text) => `<tr class="sample-row"><td class="sample-note" colspan="${columns}">${text}</td></tr>`;
  const sources = nodes.map((n) => (n.samples_file ? loadSamples(n.samples_file) : null));
  if (sources.some((source) => source?.status === 'loading')) return message('Loading samples&hellip;');
  const failed = sources.find((source) => source?.status === 'error');
  if (failed) return message(`Samples unavailable (${esc(failed.error)}).`);

  const kind = { roundtrip: 'valid', rejected: 'invalid' }[state.category];
  const outcomes = new Map();
  sources.forEach((source, column) => {
    for (const [sampleKind, name, outcome] of source?.data?.[rule] || []) {
      if (kind && sampleKind !== kind) continue;
      if (!outcomes.has(name)) outcomes.set(name, new Array(nodes.length));
      outcomes.get(name)[column] = outcome;
    }
  });
  if (outcomes.size === 0) return message('No sample names in the reports for this rule.');
  return [...outcomes.keys()].sort().map((name) =>
    `<tr class="sample-row"><td class="sample-name">${esc(name)}</td>${Array.from(outcomes.get(name), sampleCell).join('')}</tr>`
  ).join('');
}

// The Huddle specification of the selected era, at the ledger commit that the latest dataset was generated from.
function specificationLink() {
  const era = state.era;
  const name = era.charAt(0).toUpperCase() + era.slice(1);
  const dataset = latestDatasetCommit();
  const commit = (dataset && state.ledgerCommits[dataset]) || 'master';
  const url = `${LEDGER_REPOSITORY}/blob/${commit}/eras/${era}/impl/cddl/lib/Cardano/Ledger/${name}/HuddleSpec.hs`;
  return `<a class="spec-link" href="${esc(url)}" target="_blank" rel="noopener">Specification</a>`;
}

function renderTable() {
  const nodes = [...ranked().map((e) => e.node), ...state.nodes.filter((n) => !n.report)];
  const summary = nodes.map((n) => {
    const s = n.report ? score(n.report.totals, state.category) : null;
    const width = !s || s.ratio === null ? 0 : Math.min(Number(pctValue(s.ratio)), 100);
    const cls = !s ? 'missing' : s.ratio === null ? 'na' : s.ratio === 1 ? 'full' : 'partial';
    return { n, s, width, cls };
  });
  const row = (label, cell) =>
    `<tr class="head-row"><th>${label}</th>${summary.map((e) => `<th>${cell(e)}</th>`).join('')}</tr>`;

  $('table-head').innerHTML = [
    row('Rules', ({ n, s, cls }) =>
      `<span class="cellbox cellbox-head">${logo(n)}<span class="head-name" title="${esc(n.name)}">${esc(n.name)}</span><span class="score ${cls}">${s ? pct(s.ratio) : 'missing'}</span></span>`),
    row(specificationLink(), ({ n, width }) =>
      `<span class="cellbox"><span class="node-score-bar" style="--node-color:${esc(n.color)}" aria-hidden="true"><i style="width:${width}%"></i></span></span>`),
    row('', ({ s }) => `<span class="cellbox cellbox-end"><span class="cnt">${s ? `${fmt(s.met)}/${fmt(s.expected)}` : ''}</span></span>`),
  ].join('');

  const reference = state.allNodes.map((n) => nodeForEra(n, DEFAULT_ERA));
  // Rules whose name starts with % are generated helpers, so they go after the named rules.
  const byName = (a, b) => (a.startsWith('%') - b.startsWith('%')) || (a < b ? -1 : a > b ? 1 : 0);
  const rules = [...new Set([...nodes, ...reference].flatMap((n) => Object.keys(n.report?.rules || {})))].sort(byName);
  const body = rules.map((rule) =>
    `<tr class="rule-row"><td><button type="button" class="rule-toggle" data-rule="${esc(rule)}" aria-expanded="${state.open.has(rule)}">${esc(rule)}</button></td>${nodes.map((n) => cell(n.report?.rules?.[rule])).join('')}</tr>${state.open.has(rule) ? sampleRows(rule, nodes) : ''}`);
  $('table-body').innerHTML = body.join('');
  fitHeadNames();
}

function renderFailures() {
  // The section only exists when a report has something to show.
  const failing = ({ node, s }) => (Array.isArray(node.report.failures) && node.report.failures.length > 0) || s.expected > s.met;
  $('failures-section').hidden = !ranked().some(failing);
  const blocks = ranked().map(({ node }) => {
    const failures = Array.isArray(node.report.failures) ? node.report.failures : [];
    const s = score(node.report.totals);
    const unmet = s.expected - s.met;
    let count;
    if (failures.length) count = `<span class="meta-text count">${fmt(failures.length)} failing samples</span>`;
    else if (unmet > 0) count = `<span class="meta-text count">${fmt(unmet)} unmet expectations, no failure details in report</span>`;
    else count = '<span class="meta-text count none">none</span>';

    const byClass = new Map();
    for (const f of failures) {
      const key = f.class || 'unclassified';
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key).push(f);
    }
    const classes = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length).map(([cls, items]) => {
      const rules = [...new Set(items.map((f) => f.rule).filter(Boolean))];
      const samples = items.slice(0, MAX_SAMPLES_PER_CLASS).map((f) => `<div class="fail-sample">
          <div class="id">${esc(f.sample || f.rule || '')}</div>
          ${f.reason ? `<pre>${esc(f.reason)}</pre>` : ''}
        </div>`).join('');
      const more = items.length > MAX_SAMPLES_PER_CLASS
        ? `<div class="more">and ${fmt(items.length - MAX_SAMPLES_PER_CLASS)} more in the full report</div>` : '';
      return `<details class="panel fail-class">
        <summary><span class="cls">${esc(cls)}</span><span class="meta-text rules">${esc(rules.slice(0, 4).join(', '))}${rules.length > 4 ? '…' : ''}</span><span class="meta-text n">${fmt(items.length)}</span></summary>
        <div class="fail-samples">${samples}${more}</div>
      </details>`;
    }).join('');

    return `<div class="fail-node">
      <div class="fail-header"><span class="icon-prefix name">${dot(node)}${esc(node.name)}</span>${count}</div>
      ${classes}
    </div>`;
  });
  $('failures').innerHTML = blocks.join('');
}

function renderData() {
  renderTable();
  renderFilters();
}

function renderAll() {
  state.nodes = state.allNodes.map((n) => nodeForEra(n, state.era));
  renderEras();
  renderWarnings();
  renderCards();
  renderData();
  renderFailures();
}

function selectEra(era) {
  state.era = era;
  history.replaceState(null, '', `#${era}`);
  renderAll();
}

$('table-body').addEventListener('click', (event) => {
  const toggle = event.target.closest('.rule-toggle');
  if (!toggle) return;
  const rule = toggle.dataset.rule;
  if (!state.open.delete(rule)) state.open.add(rule);
  renderTable();
});

$('eras').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button?.dataset.era) selectEra(button.dataset.era);
});

$('filters').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.category) state.category = button.dataset.category;
  renderData();
});

async function main() {
  try {
    const response = await fetch('data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`data.json: HTTP ${response.status}`);
    const data = await response.json();
    state.ledgerCommits = data.ledger_commits || {};
    state.allNodes = data.nodes.map((n, i) => ({ ...n, color: n.color || "#ffffff" }));
    state.eras = erasOf(state.allNodes);
    const requested = location.hash.slice(1);
    state.era = state.eras.includes(requested) ? requested : DEFAULT_ERA;
    renderAll();
  } catch (error) {
    $('cards').innerHTML = `<div class="note error"><strong>Could not load data:</strong> ${esc(error.message)}.
      Run <code>python3 scripts/build.py</code> and serve <code>_site/</code>.</div>`;
  }
}

main();
