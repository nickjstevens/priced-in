const fs = require('fs');
const data = JSON.parse(fs.readFileSync('prices-api.json', 'utf8'));

function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(Array.isArray(data.years) && data.years.length > 0, 'years missing');
assert(data.contextSeries && typeof data.contextSeries === 'object', 'context series missing');
assert(Array.isArray(data.items) && data.items.length > 0, 'items missing');

const len = data.years.length;
for (const [k, s] of Object.entries(data.contextSeries)) {
  assert(Array.isArray(s.values) && s.values.length === len, `denominator length mismatch: ${k}`);
}
for (const item of data.items) {
  assert(Array.isArray(item.values) && item.values.length === len, `item length mismatch: ${item.key}`);
  assert(item.metadata, `metadata missing: ${item.key}`);
}
console.log('Data validation passed');
