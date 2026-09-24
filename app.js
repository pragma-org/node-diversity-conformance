'use strict';

const COLORS = ['#8b78ef', '#e8b83a', '#4ade80', '#5fb3f0', '#e07a9a', '#c48050', '#6fd6c8', '#d0d0e0'];

const CATEGORIES = [
  {
    key: 'roundtrip',
    label: 'Valid round-trip',
    short: 'Round-trip',
    expected: 'generated_decoded_reencoded_expected',
    actual: 'generated_decoded_reencoded_actual',
  },
  {
    key: 'rejected',
    label: 'Invalid rejected',
    short: 'Rejected',
    expected: 'generated_must_be_rejected_expected',
    actual: 'generated_must_be_rejected_actual',
  },
  {
    key: 'zap',
    label: 'Mutations rejected',
    short: 'Zap',
    expected: 'zap_must_be_rejected_expected',
    actual: 'zap_must_be_rejected_actual',
  },
];

const MAX_SAMPLES_PER_CLASS = 25;

const state = { nodes: [], category: 'all', onlyIssues: false };

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

function pct(ratio) {
  if (ratio === null) return '—';
  if (ratio === 1) return '100%';
  // Never round a failing node up to 100%.
  return `${Math.min(Math.floor(ratio * 10000) / 100, 99.99).toFixed(2)}%`;
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

function dot(node) {
  return `<span class="dot" style="background:${node.color}"></span>`;
}

function loaded() {
  return state.nodes.filter((n) => n.report);
}

// Nodes ranked by overall score; ties share a rank.
function ranked() {
  const sorted = loaded()
    .map((n) => ({ node: n, s: score(n.report.totals) }))
    .sort((a, b) => (b.s.ratio ?? -1) - (a.s.ratio ?? -1) || a.node.name.localeCompare(b.node.name));
  let rank = 0;
  let previous = null;
  sorted.forEach((entry, i) => {
    if (entry.s.ratio !== previous) rank = i + 1;
    previous = entry.s.ratio;
    entry.rank = rank;
  });
  return sorted;
}

function renderSubtitle(builtAt) {
  const corpora = [...new Set(loaded().map((n) => n.report.corpus))];
  const date = builtAt ? new Date(builtAt).toISOString().slice(0, 10) : '';
  const corpus = corpora.length ? `corpus <code>${corpora.map(esc).join(', ')}</code> &middot; ` : '';
  $('subtitle').innerHTML = `CBOR decoding conformance across node implementations &mdash; ${corpus}${esc(date)}`;
}

function renderWarnings() {
  const out = [];
  for (const n of state.nodes.filter((n) => n.error)) {
    out.push(`<div class="note error"><strong>${esc(n.name)}:</strong> report unavailable (${esc(n.error)}).</div>`);
  }
  const nodes = loaded();
  const corpora = new Set(nodes.map((n) => n.report.corpus));
  if (corpora.size > 1) {
    const list = nodes.map((n) => `${esc(n.name)} <code>${esc(n.report.corpus)}</code>`).join(', ');
    out.push(`<div class="note warn"><strong>Different corpora:</strong> ${list}. Scores are not directly comparable.</div>`);
  }
  const versions = new Set(nodes.map((n) => n.report.protocol_version));
  if (versions.size > 1) {
    const list = nodes.map((n) => `${esc(n.name)} <code>${esc(n.report.protocol_version)}</code>`).join(', ');
    out.push(`<div class="note warn"><strong>Different protocol versions:</strong> ${list}.</div>`);
  }
  for (const n of nodes) {
    const t = n.report.totals;
    const sum = Number(t.generated_decoded_reencoded_expected) + Number(t.generated_must_be_rejected_expected);
    if (Number(t.generated_total) !== sum) {
      out.push(`<div class="note warn"><strong>${esc(n.name)}:</strong> generated_total (${fmt(t.generated_total)})
        does not equal the sum of the generated expectations (${fmt(sum)}).</div>`);
    }
  }
  $('warnings').innerHTML = out.join('');
}

function renderCards() {
  const medals = ['gold', 'silver', 'bronze'];
  const cards = ranked().map(({ node, s, rank }) => {
    const r = node.report;
    const failures = Array.isArray(r.failures) ? r.failures.length : 0;
    const passed = s.ratio === 1;
    const status = passed
      ? '<div class="status pass">Fully conformant</div>'
      : `<div class="status fail">${failures ? `${fmt(failures)} failures` : 'Not conformant'}</div>`;
    const breakdown = CATEGORIES.map((c) => {
      const cs = score(r.totals, c.key);
      const cls = cs.ratio === null ? '' : cs.ratio === 1 ? 'ok' : 'ko';
      return `<div><span>${c.label}</span><span class="${cls}">${fmt(cs.met)}/${fmt(cs.expected)}</span></div>`;
    }).join('');
    const repository = safeUrl(node.repository);
    return `<div class="card ${medals[rank - 1] || ''}">
      <div class="rank">#${rank}</div>
      <div class="node-name">${dot(node)}${esc(node.name)}</div>
      <div class="lang">${esc(node.language || '')}</div>
      ${status}
      <div><span class="score">${pct(s.ratio)}</span><span class="ratio">${fmt(s.met)} / ${fmt(s.expected)}</span></div>
      <div class="breakdown">${breakdown}</div>
      <div class="meta">
        protocol ${esc(r.protocol_version)} &middot; <a href="${esc(node.report_file)}">report</a>
        ${repository ? `&middot; <a href="${esc(repository)}" target="_blank" rel="noopener">repository</a>` : ''}
      </div>
    </div>`;
  });
  const errors = state.nodes.filter((n) => n.error).map((node) => `<div class="card">
      <div class="node-name">${dot(node)}${esc(node.name)}</div>
      <div class="lang">${esc(node.language || '')}</div>
      <div class="status error">No report</div>
      <div class="err-msg">${esc(node.error)}</div>
    </div>`);
  $('cards').innerHTML = cards.concat(errors).join('') || '<div class="loading">No nodes configured.</div>';
}

function barRow(node, s, slim) {
  const width = s.ratio === null ? 0 : Math.max(s.ratio * 100, 0.5);
  return `<div class="bar-row${slim ? ' slim' : ''}">
    <div class="bar-fill" style="width:${width}%;background:${node.color}"></div>
    <div class="bar-info">
      <div class="bar-info-left"><span class="bar-name">${esc(node.name)}</span><span class="bar-sub">${esc(node.language || '')}</span></div>
      <div class="bar-info-right"><span class="bar-sub">${fmt(s.met)} / ${fmt(s.expected)}</span><span class="bar-value">${pct(s.ratio)}</span></div>
    </div>
  </div>`;
}

function renderBars() {
  const order = ranked().map((e) => e.node);
  const groups = [{ key: 'all', label: 'Overall' }, ...CATEGORIES];
  $('bars').innerHTML = groups.map((g) => {
    const rows = order.map((n) => barRow(n, score(n.report.totals, g.key), g.key !== 'all')).join('');
    return `<div class="bar-group-label">${esc(g.label)}</div>${rows}`;
  }).join('');
}

function renderFilters() {
  const buttons = [{ key: 'all', short: 'All categories' }, ...CATEGORIES].map((c) =>
    `<button class="filter-btn${state.category === c.key ? ' active' : ''}" data-category="${c.key}">${esc(c.short)}</button>`
  ).join('');
  $('filters').innerHTML = `<span class="label">Category</span>${buttons}<span class="filter-sep"></span>
    <button class="filter-btn toggle${state.onlyIssues ? ' active' : ''}" data-toggle="issues">Only rules with gaps</button>`;
}

function cell(outcome) {
  if (!outcome) return '<td class="missing">missing</td>';
  const s = score(outcome, state.category);
  if (s.ratio === null) return '<td class="na">—</td>';
  const cls = s.ratio === 1 ? 'full' : 'partial';
  return `<td class="${cls}">${pct(s.ratio)}<span class="cnt">${fmt(s.met)}/${fmt(s.expected)}</span></td>`;
}

function renderTable() {
  const nodes = ranked().map((e) => e.node);
  $('table-head').innerHTML = `<tr><th>Rule</th>${nodes.map((n) =>
    `<th>${esc(n.name)}<span class="th-sub">${esc(n.language || '')}</span></th>`).join('')}</tr>`;

  const rules = [...new Set(nodes.flatMap((n) => Object.keys(n.report.rules || {})))].sort();
  const hasGap = (rule) => nodes.some((n) => {
    const outcome = n.report.rules?.[rule];
    if (!outcome) return true;
    const s = score(outcome, state.category);
    return s.ratio !== null && s.ratio < 1;
  });
  const shown = state.onlyIssues ? rules.filter(hasGap) : rules;

  const body = shown.map((rule) =>
    `<tr><td>${esc(rule)}</td>${nodes.map((n) => cell(n.report.rules?.[rule])).join('')}</tr>`);
  if (shown.length === 0) {
    body.push(`<tr class="empty-row"><td colspan="${nodes.length + 1}">No rule has a gap in this category.</td></tr>`);
  }
  body.push(`<tr class="totals"><td>Total</td>${nodes.map((n) => cell(n.report.totals)).join('')}</tr>`);
  $('table-body').innerHTML = body.join('');
}

function renderFailures() {
  const blocks = ranked().map(({ node }) => {
    const failures = Array.isArray(node.report.failures) ? node.report.failures : [];
    const s = score(node.report.totals);
    const unmet = s.expected - s.met;
    let count;
    if (failures.length) count = `<span class="count">${fmt(failures.length)} failing samples</span>`;
    else if (unmet > 0) count = `<span class="count">${fmt(unmet)} unmet expectations, no failure details in report</span>`;
    else count = '<span class="count none">none</span>';

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
      return `<details class="fail-class">
        <summary><span class="cls">${esc(cls)}</span><span class="rules">${esc(rules.slice(0, 4).join(', '))}${rules.length > 4 ? '…' : ''}</span><span class="n">${fmt(items.length)}</span></summary>
        <div class="fail-samples">${samples}${more}</div>
      </details>`;
    }).join('');

    return `<div class="fail-node">
      <div class="fail-header"><span class="name">${dot(node)}${esc(node.name)}</span>${count}</div>
      ${classes}
    </div>`;
  });
  $('failures').innerHTML = blocks.join('');
}

function renderSources() {
  $('sources').innerHTML = state.nodes.map((n) => {
    const detail = n.report
      ? `${esc(n.report.corpus)} &middot; pv ${esc(n.report.protocol_version)}`
      : 'unavailable';
    const url = safeUrl(n.report_url);
    const name = url ? `<a class="nm" href="${esc(url)}" target="_blank" rel="noopener">${esc(n.name)}</a>` : `<span class="nm">${esc(n.name)}</span>`;
    return `<span class="src-tag">${dot(n)}${name}<span class="ver">${detail}</span></span>`;
  }).join('');
}

function renderData() {
  renderTable();
  renderFilters();
}

$('filters').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.category) state.category = button.dataset.category;
  if (button.dataset.toggle === 'issues') state.onlyIssues = !state.onlyIssues;
  renderData();
});

async function main() {
  try {
    const response = await fetch('data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`data.json: HTTP ${response.status}`);
    const data = await response.json();
    state.nodes = data.nodes.map((n, i) => ({ ...n, color: n.color || COLORS[i % COLORS.length] }));
    renderSubtitle(data.built_at);
    renderWarnings();
    renderCards();
    renderBars();
    renderData();
    renderFailures();
    renderSources();
  } catch (error) {
    $('cards').innerHTML = `<div class="note error"><strong>Could not load data:</strong> ${esc(error.message)}.
      Run <code>python3 scripts/build.py</code> and serve <code>_site/</code>.</div>`;
  }
}

main();
