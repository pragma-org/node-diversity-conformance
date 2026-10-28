'use strict';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const url = (value) => /^https?:\/\//.test(value || '') ? value : null;

function renderNodes(nodes) {
  if (!nodes.length) {
    $('nodes').innerHTML = '<div class="loading">No node metadata available.</div>';
    return;
  }
  $('nodes').innerHTML = nodes.map((node) => {
    const repository = url(node.repository);
    const website = url(node.website);
    const links = [
      website ? `<a href="${esc(website)}" target="_blank" rel="noopener">Website</a>` : '',
      repository ? `<a href="${esc(repository)}" target="_blank" rel="noopener">Source code</a>` : '',
    ].filter(Boolean).join('');
    const score = node.conformance || {};
    const scenarioScores = (node.scenario_scores || []).map((scenario) =>
      `<div class="key-value"><span>${esc(scenario.title)}</span><strong>${scenario.percentage === null ? '-' : `${scenario.percentage}%`}</strong></div>`
    ).join('');
    return `<article class="panel node-card">
      <img class="node-logo" src="${esc(node.logo)}" alt="${esc(node.name)} logo">
      <div class="node-card-body">
        <div class="node-card-heading">
          <div><h2 style="color:${esc(node.color)}">${esc(node.name)}</h2><div class="container meta-text node-meta m-top-sm">${esc(node.language)}${links}</div></div>
          <div class="node-score" style="--node-color:${esc(node.color)}">
            <strong>${esc(score.percentage)}<small>%</small></strong>
            <span class="node-score-bar" aria-hidden="true"><i style="width:${Math.min(Number(score.percentage) || 0, 100)}%"></i></span>
          </div>
        </div>
        <div class="prose m-top-sm node-description">${node.description || ''}</div>
        <div class="key-values node-scenarios">${scenarioScores}</div>
      </div>
    </article>`;
  }).join('');
}

const STAGES = [
  { id: 'cbor-decoding', title: 'CBOR\ndecoding' },
  { id: 'ledger-rules', title: 'Ledger\nrules' },
  { id: 'uplc-execution', title: 'UPLC\nexecution' },
];

function scenarioCard(scenario, { title }) {
  const implementationLabels = scenario.implementations.map((node) =>
    `<span class="icon-prefix node-label"><span class="dot" style="background:${esc(node.color)}"></span>${esc(node.name)}</span>`
  ).join('');
  return `<a class="panel scenario-card" href="${esc(scenario.path)}">
    <div class="container split"><h2>${esc(title)}</h2><span class="arrow">↗</span></div>
    <p class="prose m-top-sm">${esc(scenario.description)}</p>
    <div class="container scenario-nodes">${implementationLabels}</div>
  </a>`;
}

const KINDS = {
  functional: 'Functional tests',
  'non-functional': 'Benchmarks',
};

function kindIcon(scenario) {
  const kind = scenario.kind === 'non-functional' ? 'non-functional' : 'functional';
  return `<a class="kind-icon ${kind}" href="${esc(scenario.path)}" title="${KINDS[kind]}: ${esc(scenario.title)}" aria-label="${KINDS[kind]}: ${esc(scenario.title)}"><span class="kind-glyph" aria-hidden="true"></span><span class="kind-label">${KINDS[kind]}</span></a>`;
}

// A stage is one tile. Its title opens the main scenario, and one icon per scenario opens that scenario.
function stageTile(title, index, scenarios) {
  const both = scenarios.some((scenario) => scenario.kind === 'non-functional');
  return `<div class="stage-tile${both ? ' both' : ''}">
    <span class="stage-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
    <span class="kind-icons">${scenarios.map(kindIcon).join('')}</span>
    <a class="stage-title" href="${esc(scenarios[0].path)}">${esc(title)}</a>
  </div>`;
}

// The scenarios run as a process: each stage is one tile with the functional scenario first, then any non-functional one.
// A scenario that names no known stage goes into a plain grid after the process.
function renderScenarios(scenarios) {
  const stageOf = (scenario) => STAGES.findIndex((stage) => stage.id === scenario.stage);
  const inStage = (index) => scenarios
    .filter((scenario) => stageOf(scenario) === index)
    .sort((a, b) => (a.kind === 'non-functional') - (b.kind === 'non-functional'));
  const cells = STAGES.map((stage, index) => {
    const arrow = index > 0 ? '<span class="stage-arrow" aria-hidden="true"></span>' : '';
    const members = inStage(index);
    return arrow + (members.length ? stageTile(stage.title, index, members) : '<div></div>');
  });
  const process = `<div class="pipeline">${cells.join('')}</div>`;
  const others = scenarios.filter((scenario) => stageOf(scenario) < 0);
  const rest = others.length
    ? `<div class="scenario-grid">${others.map((scenario) => scenarioCard(scenario, { title: scenario.title })).join('')}</div>`
    : '';
  return process + rest;
}

async function main() {
  try {
    const response = await fetch('catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`catalog.json: HTTP ${response.status}`);
    const catalog = await response.json();
    $('scenarios').innerHTML = renderScenarios(catalog.scenarios);
    renderNodes(catalog.nodes || []);
  } catch (error) {
    $('scenarios').innerHTML = `<div class="note error"><strong>Could not load scenarios:</strong> ${esc(error.message)}</div>`;
    $('nodes').innerHTML = `<div class="note error"><strong>Could not load nodes:</strong> ${esc(error.message)}</div>`;
  }
}

main();
