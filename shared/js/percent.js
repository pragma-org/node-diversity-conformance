'use strict';

// A percentage without the sign. Only a perfect score reads 100, and a score is never rounded up to it.
function pctValue(ratio) {
  if (ratio === null || ratio === undefined) return '—';
  if (ratio === 1) return '100';
  return Math.min(Math.floor(Number(ratio) * 10000) / 100, 99.99).toFixed(2);
}
