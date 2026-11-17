// Sleep-queue tests: node tests/sleep.test.cjs
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SleepQ = new Function(src.slice(src.indexOf('// ==SLEEP START=='), src.indexOf('// ==SLEEP END==')) + '; return SleepQ;')();
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } }
console.log('Sleep queue tests');

test('lengths read from titles', () => {
  const H = 3600;
  const cases = [['10 Hours of Zelda Ambience', 10 * H], ['Pokémon lore to fall asleep to (3 hrs)', 3 * H], ['8h rain + TCG lore', 8 * H],
    ['2.5 hours of Yu-Gi-Oh history', 2.5 * H], ['1 hour 30 min chill', 1.5 * H], ['Deutsch lernen im Schlaf – 10 Stunden', 10 * H],
    ['2,5 Std. Deutsch hören', 2.5 * H], ['12-hour Skyrim sleep', 12 * H], ['3 hours and 20 minutes of lore', 3 * H + 20 * 60]];
  for (const [t, want] of cases) assert.strictEqual(SleepQ.fromTitle(t), want, t);
});
test('no false lengths', () => {
  for (const t of ['Top 10 cards of 2024', 'Zelda: Breath of the Wild review', 'The 100 best moments', '48 hours in Berlin', '', null])
    assert.strictEqual(SleepQ.fromTitle(t), null, String(t));
});
const lib = [
  { id: 'a', theme: 'German', lastPlayed: '2026-11-10T22:00:00Z', added: '2026-10-01' },
  { id: 'b', theme: 'German', lastPlayed: '', added: '2026-10-05' },
  { id: 'c', theme: 'German', lastPlayed: '2026-11-15T22:00:00Z', added: '2026-10-02' },
  { id: 'd', theme: 'German', lastPlayed: '', added: '2026-10-03' },
  { id: 'x', theme: 'Video games', lastPlayed: '', added: '2026-10-01' },
];
test('pick: never played first (oldest added first), then least recently played', () => {
  assert.deepStrictEqual(SleepQ.pick(lib, 'German', 4).map(v => v.id), ['d', 'b', 'a', 'c']);
  assert.deepStrictEqual(SleepQ.pick(lib, 'German', 2).map(v => v.id), ['d', 'b']);
});
test('pick: only the chosen theme', () => {
  assert.deepStrictEqual(SleepQ.pick(lib, 'Video games', 2).map(v => v.id), ['x']);
  assert.deepStrictEqual(SleepQ.pick(lib, 'Card games', 2), []);
});
test('pick: swapping one out brings in the next', () => {
  assert.deepStrictEqual(SleepQ.pick(lib, 'German', 2, ['d']).map(v => v.id), ['b', 'a']);
});
test('pick: everything swapped out wraps round instead of coming up empty', () => {
  assert.deepStrictEqual(SleepQ.pick(lib, 'German', 2, ['a', 'b', 'c', 'd']).map(v => v.id), ['d', 'b']);
});
test('total: known lengths added up', () => {
  const r = SleepQ.total([{ durationSec: 24 * 60 }, { durationSec: 3 * 3600 + 600 }, { durationSec: 8 * 3600 }]);
  assert.strictEqual(r.text, '24:00 + 3:10:00 + 8:00:00 = 11:34:00'); assert.strictEqual(r.sec, 41640); assert.strictEqual(r.unknown, 0);
});
test('total: unknown lengths shown as ?', () => {
  assert.strictEqual(SleepQ.total([{ durationSec: null }, { durationSec: 7200 }]).text, '? + 2:00:00 = 2:00:00 + ?');
});
test('total: a single item needs no sum', () => {
  assert.strictEqual(SleepQ.total([{ durationSec: 7200 }]).text, '');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
