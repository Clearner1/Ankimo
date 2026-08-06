const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('style.css', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const containerRule = css.match(/\.heatmap-container\s*\{([^}]*)\}/)?.[1] || '';
const rectRule = css.match(/\.heatmap-container svg rect\s*\{([^}]*)\}/)?.[1] || '';
const heatmapCode = app.slice(app.indexOf('function localDateKey'), app.indexOf('// ===== Notes ====='));

assert.match(containerRule, /position:\s*relative/);
assert.doesNotMatch(rectRule, /(?:^|;)\s*fill\s*:/);
assert.match(css, /\.heatmap-container svg rect\.selected/);
assert.match(heatmapCode, /fill-opacity/);
assert.doesNotMatch(heatmapCode, /toISOString/);

console.log('Heatmap regression checks passed.');
