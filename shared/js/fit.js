'use strict';

// Each node name in a table header gets the largest font size at which it fits next to its percentage.
const MIN_HEAD_FONT = 10;

// scrollWidth is a whole number, so it misses an overflow of a fraction of a pixel, and the ellipsis still shows.
function textWidth(name) {
  const range = document.createRange();
  range.selectNodeContents(name);
  return range.getBoundingClientRect().width;
}

function fitHeadNames() {
  for (const name of document.querySelectorAll('.head-name')) {
    name.style.fontSize = '';
    let size = parseFloat(getComputedStyle(name).fontSize);
    while (textWidth(name) > name.getBoundingClientRect().width - 1 && size > MIN_HEAD_FONT) {
      size -= 0.5;
      name.style.fontSize = `${size}px`;
    }
  }
}

window.addEventListener('resize', fitHeadNames);
// The widths change when the web fonts arrive, so fit the names again then.
if (document.fonts) document.fonts.ready.then(fitHeadNames);
