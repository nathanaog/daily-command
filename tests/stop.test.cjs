// Block-end stop tests: TZ=Europe/Berlin node tests/stop.test.cjs
process.env.TZ = process.env.TZ || 'Europe/Berlin';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const BlockStop = new Function(src.slice(src.indexOf('// ==STOP START=='), src.indexOf('// ==STOP END==')) + '; return BlockStop;')();
const at = (h, m, s = 0) => new Date(2026, 10, 17, h, m, s).getTime();
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } }
const base = { end: at(21, 30), label: 'Leisure', nextTitle: 'Wind-down' };

console.log('Block-end stop tests');
test('next fits → go, with the subtraction shown', () => {
  const r = BlockStop.after({ ...base, now: at(21, 12), dur: 12 * 60 });
  assert.strictEqual(r.go, true); assert.strictEqual(r.why, '21:30 − 21:12 = 18 min left · 12:00 ≤ 18:00 ✓ fits');
});
test('next too long → stop, says what comes next', () => {
  const r = BlockStop.after({ ...base, now: at(21, 12), dur: 24 * 60 });
  assert.strictEqual(r.go, false); assert.strictEqual(r.why, '21:30 − 21:12 = 18 min left · next is 24:00 > 18:00 → stop here → next: Wind-down');
});
test('up to 2 min over still fits (grace)', () => {
  assert.strictEqual(BlockStop.after({ ...base, now: at(21, 12), dur: 20 * 60 }).go, true);
  assert.strictEqual(BlockStop.after({ ...base, now: at(21, 12), dur: 20 * 60 + 1 }).go, false);
});
test('block already over → stop', () => {
  const r = BlockStop.after({ ...base, now: at(21, 35), dur: 60 });
  assert.strictEqual(r.go, false); assert.strictEqual(r.why, 'Leisure ended 21:30 → next: Wind-down');
});
test('last minute of the block → stop', () => {
  assert.strictEqual(BlockStop.after({ ...base, now: at(21, 29, 10), dur: 30 }).go, false);
});
test('unknown length: go with ≥ 10 min left, stop with less', () => {
  assert.strictEqual(BlockStop.after({ ...base, now: at(21, 10), dur: null }).go, true);
  const r = BlockStop.after({ ...base, now: at(21, 25), dur: null });
  assert.strictEqual(r.go, false); assert.match(r.why, /^21:30 − 21:25 = 5 min left · length unknown/);
});
test('no block end (open free time) → always go, no maths', () => {
  assert.deepStrictEqual(BlockStop.after({ now: at(1, 0), end: null, label: 'Free time', dur: 3600 }), { go: true, why: '' });
});
test('seconds past the minute: the comparison uses the minutes it shows', () => {
  const r = BlockStop.after({ ...base, now: at(21, 45, 3), end: at(22, 0), dur: 15 * 60 });
  assert.strictEqual(r.go, true); assert.strictEqual(r.why, '22:00 − 21:45 = 15 min left · 15:00 ≤ 15:00 ✓ fits');
});
test('block crossing midnight', () => {
  const r = BlockStop.after({ now: at(23, 50), end: at(24, 30), label: 'Wind-down', dur: 30 * 60 });
  assert.strictEqual(r.go, true); assert.strictEqual(r.why, '00:30 − 23:50 = 40 min left · 30:00 ≤ 40:00 ✓ fits');
});
test('live: plenty of room → ok', () => {
  const r = BlockStop.live({ ...base, now: at(20, 0), rem: 15 * 60 });
  assert.strictEqual(r.tone, 'ok'); assert.strictEqual(r.text, '20:00 + 15:00 = ~20:15 ≤ 21:30 ✓ · 75 min spare');
});
test('live: under 10 min spare → last one', () => {
  const r = BlockStop.live({ ...base, now: at(21, 12), rem: 12 * 60 });
  assert.strictEqual(r.tone, 'last'); assert.strictEqual(r.text, '21:12 + 12:00 = ~21:24 ≤ 21:30 ✓ · 6 min spare → last one before Leisure ends');
});
test('live: ends within the grace → last one, no false "≤"', () => {
  const r = BlockStop.live({ ...base, now: at(21, 12), rem: 19 * 60 });
  assert.strictEqual(r.tone, 'last'); assert.strictEqual(r.text, '21:12 + 19:00 = ~21:31 ≈ 21:30 ✓ · right on time → last one before Leisure ends');
});
test('live: runs past the end → over, by how much', () => {
  const r = BlockStop.live({ ...base, now: at(21, 12), rem: 29 * 60 });
  assert.strictEqual(r.tone, 'over'); assert.strictEqual(r.text, '21:12 + 29:00 = ~21:41 · Leisure ends 21:30 → 11 min over');
});
test('live: nothing known → no line', () => {
  assert.strictEqual(BlockStop.live({ ...base, now: at(21, 0), rem: null }), null);
  assert.strictEqual(BlockStop.live({ now: at(21, 0), end: null, label: 'x', rem: 60 }), null);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
