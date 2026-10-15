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
      repository ? `<a href="${esc(repository)}" target="_blank" rel="noopener">Source code</a>` : '',
      website ? `<a href="${esc(website)}" target="_blank" rel="noopener">Website</a>` : '',
    ].filter(Boolean).join('<span class="node-card-separator">·</span>');
    const score = node.conformance || {};
    const scenarioScores = (node.scenario_scores || []).map((scenario) =>
      `<div class="key-value"><span>${esc(scenario.title)}</span><strong>${scenario.percentage === null ? '-' : `${scenario.percentage}%`}</strong></div>`
    ).join('');
    return `<article class="panel node-card">
      <img class="node-logo" src="${esc(node.logo)}" alt="${esc(node.name)} logo">
      <div class="node-card-body">
        <div class="node-card-heading">
          <div><h2 style="color:${esc(node.color)}">${esc(node.name)}</h2><div class="container meta-text m-top-sm">${esc(node.language)}<span class="node-card-separator">·</span>${links}</div></div>
          <div class="node-score"><strong>${esc(score.percentage)}%</strong></div>
        </div>
        <div class="prose m-top-sm node-description">${node.description || ''}</div>
        <div class="key-values node-scenarios">${scenarioScores}</div>
      </div>
    </article>`;
  }).join('');
}

async function main() {
  try {
    const response = await fetch('catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`catalog.json: HTTP ${response.status}`);
    const catalog = await response.json();
    $('scenarios').innerHTML = catalog.scenarios.map((scenario) => {
      const implementationLabels = scenario.implementations.map((node) =>
        `<span class="icon-prefix node-label"><span class="dot" style="background:${esc(node.color)}"></span>${esc(node.name)}</span>`
      ).join('');
      const kindTitle = scenario.kind === 'non-functional' ? 'Non-functional Tests' : 'Functional Tests';
      const icon = scenario.kind === 'non-functional' ? 'icons/cpu.svg' : 'icons/check-circle.svg';
      return `<a class="panel scenario-card" href="${esc(scenario.path)}">
        <div class="container split"><span class="icon-prefix kind ${esc(scenario.kind)}"><img src="${icon}" alt="">${kindTitle}</span><span class="arrow">↗</span></div>
        <h2>${esc(scenario.title)}</h2>
        <p class="prose m-top-sm">${esc(scenario.description)}</p>
        <div class="container scenario-nodes">${implementationLabels}</div>
      </a>`;
    }).join('');
    renderNodes(catalog.nodes || []);
  } catch (error) {
    $('scenarios').innerHTML = `<div class="note error"><strong>Could not load scenarios:</strong> ${esc(error.message)}</div>`;
    $('nodes').innerHTML = `<div class="note error"><strong>Could not load nodes:</strong> ${esc(error.message)}</div>`;
  }
}

main();
