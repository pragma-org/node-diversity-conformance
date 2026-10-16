'use strict';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const fmt = (value) => Number(value ?? 0).toLocaleString('en-US');
const ns = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number >= 1e9) return `${(number / 1e9).toFixed(2)} s`;
  if (number >= 1e6) return `${(number / 1e6).toFixed(2)} ms`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(2)} μs`;
  return `${number.toFixed(0)} ns`;
};
const us = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number >= 1e6) return `${(number / 1e6).toFixed(2)} s`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(2)} ms`;
  return `${number.toFixed(0)} μs`;
};
const ratio = (passed, total) => Number(total) ? Number(passed) / Number(total) : null;
const pct = (value) => value === null || value === undefined ? '—' : `${(Number(value) * 100).toFixed(2)}%`;

function nodeDot(node) {
  return `<span class="dot" style="background:${esc(node.color || '#1b6e4e')}"></span>`;
}

function groupLabel(value) {
  return String(value).split('/').map((part) => part.replaceAll('_', ' ')).join(' / ');
}

function grouped(items, groupBy, preferredOrder = []) {
  const groups = new Map();
  items.forEach((item) => {
    const key = groupBy(item) || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const order = new Map(preferredOrder.map((key, index) => [key, index]));
  return [...groups.entries()].sort(([left], [right]) => {
    const leftOrder = order.has(left) ? order.get(left) : Number.MAX_SAFE_INTEGER;
    const rightOrder = order.has(right) ? order.get(right) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.localeCompare(right);
  });
}

function activateGroupToggles() {
  document.querySelectorAll('.group-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const collapsed = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(collapsed));
      const header = toggle.closest('tr');
      const group = header.dataset.group;
      const rows = group
        ? [...header.parentElement.children].filter((row) => row.dataset.parent === group)
        : (() => {
          const descendants = [];
          let row = header.nextElementSibling;
          while (row && !row.classList.contains('group-header')) {
            descendants.push(row);
            row = row.nextElementSibling;
          }
          return descendants;
        })();
      rows.forEach((row) => {
        if (row.classList.contains('scenario-detail')) {
          row.hidden = true;
          row.previousElementSibling?.querySelector('.scenario-toggle')?.setAttribute('aria-expanded', 'false');
        } else {
          row.hidden = !collapsed;
        }
      });
    });
  });
}

function activateScenarioToggles() {
  document.querySelectorAll('.scenario-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const detail = document.getElementById(toggle.dataset.detail);
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      detail.hidden = expanded;
    });
  });
}

function renderHeader(meta) {
  document.title = `${meta.title} · Cardano node diversity`;
  $('title').textContent = meta.title;
}
