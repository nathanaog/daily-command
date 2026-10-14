/* Sync merge tests — run: node tests/sync.test.cjs
 * Extracts the Sync engine from index.html (between ==SYNC START/END==) and
 * checks the phone ↔ desktop three-way merge rules.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const Sync = new Function(html.split('// ==SYNC START==')[1].split('// ==SYNC END==')[0] + '; return Sync;')();
const clone = x => JSON.parse(JSON.stringify(x));
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } }
console.log('Sync merge tests');

const T = (id, title, extra = {}) => ({ id, title, projectId: 'p1', done: false, ...extra });
const base = {
  savedAt: '2026-10-14T10:00:00Z',
  settings: { theme: 'dark', pomoWork: 25, pomoBreak: 5, name: 'Nathan' },
  tasks: [T('t1', 'Script'), T('t2', 'Email venue'), T('t3', 'Read chapter')],
  top3: { '2026-10-14': ['t1', 't2'] },
  digestRead: { a: 1, b: 2 },
  pomo: { phase: 'idle', count: 2 },
  ui: { open: { x: true } },
};
const at = (s, t) => ({ ...s, savedAt: t });

test('nothing changed → identical, no conflicts', () => {
  const r = Sync.mergeStates(base, clone(base), clone(base));
  assert.deepStrictEqual(Sync.shareable(r.state), Sync.shareable(base)); assert.strictEqual(r.conflicts, 0);
  assert.strictEqual(r.changedLocal, false); assert.strictEqual(r.changedRemote, false);
});
test('task added on phone + different task added on desktop → both kept', () => {
  const phone = at(clone(base), '2026-10-14T11:00:00Z'); phone.tasks.push(T('t4', 'From phone'));
  const desk = at(clone(base), '2026-10-14T11:05:00Z'); desk.tasks.push(T('t5', 'From desktop'));
  const r = Sync.mergeStates(base, desk, phone);
  assert.deepStrictEqual(r.state.tasks.map(t => t.id).sort(), ['t1', 't2', 't3', 't4', 't5']);
  assert.strictEqual(r.conflicts, 0);
});
test('ticked done on phone, renamed on desktop (different fields of the same task) → both changes', () => {
  const phone = clone(base); phone.tasks[0].done = true;
  const desk = clone(base); desk.tasks[0].title = 'Script ep. 4';
  const r = Sync.mergeStates(base, desk, phone);
  assert.deepStrictEqual(r.state.tasks[0], T('t1', 'Script ep. 4', { done: true }));
});
test('same field changed on both → newest save wins (and counted as a conflict)', () => {
  const phone = at(clone(base), '2026-10-14T12:00:00Z'); phone.settings.pomoWork = 50;
  const desk = at(clone(base), '2026-10-14T11:00:00Z'); desk.settings.pomoWork = 30;
  const r = Sync.mergeStates(base, desk, phone);           // desk is local, phone (newer) is remote
  assert.strictEqual(r.state.settings.pomoWork, 50); assert.strictEqual(r.conflicts, 1);
  const r2 = Sync.mergeStates(base, phone, desk);          // other way round: phone local and newer
  assert.strictEqual(r2.state.settings.pomoWork, 50);
});
test('different settings changed on each side → both kept', () => {
  const phone = clone(base); phone.settings.theme = 'sepia';
  const desk = clone(base); desk.settings.pomoBreak = 10;
  const r = Sync.mergeStates(base, desk, phone);
  assert.strictEqual(r.state.settings.theme, 'sepia'); assert.strictEqual(r.state.settings.pomoBreak, 10);
});
test('deleted on desktop, untouched on phone → deleted', () => {
  const phone = clone(base);
  const desk = clone(base); desk.tasks = desk.tasks.filter(t => t.id !== 't3');
  const r = Sync.mergeStates(base, phone, desk);
  assert.ok(!r.state.tasks.some(t => t.id === 't3'));
});
test('deleted on desktop, edited on phone meanwhile → edit wins, task kept', () => {
  const phone = clone(base); phone.tasks[2].title = 'Read chapter 4';
  const desk = clone(base); desk.tasks = desk.tasks.filter(t => t.id !== 't3');
  const r = Sync.mergeStates(base, phone, desk);
  assert.strictEqual(r.state.tasks.find(t => t.id === 't3').title, 'Read chapter 4');
});
test('top 3 for different days set on different devices → both days kept', () => {
  const phone = clone(base); phone.top3['2026-10-15'] = ['t3'];
  const desk = clone(base); desk.top3['2026-10-14'] = ['t1', 't2', 't3'];
  const r = Sync.mergeStates(base, desk, phone);
  assert.deepStrictEqual(r.state.top3, { '2026-10-14': ['t1', 't2', 't3'], '2026-10-15': ['t3'] });
});
test('digest read-marks: union from both devices', () => {
  const phone = clone(base); phone.digestRead.c = 3;
  const desk = clone(base); desk.digestRead.d = 4;
  assert.deepStrictEqual(Sync.mergeStates(base, desk, phone).state.digestRead, { a: 1, b: 2, c: 3, d: 4 });
});
test('focus started on desktop → phone picks up the running timer', () => {
  const desk = at(clone(base), '2026-10-14T13:00:00Z'); desk.pomo = { phase: 'work', count: 2, endsAt: 1, startedAt: 0, planned: 25 };
  const r = Sync.mergeStates(base, clone(base), desk);
  assert.strictEqual(r.state.pomo.phase, 'work'); assert.strictEqual(r.state.pomo.endsAt, 1);
});
test('first sync on a fresh desktop: takes the phone’s settings, keeps everything from both', () => {
  const fresh = at({ settings: { theme: 'auto', pomoWork: 25, pomoBreak: 5, name: '' }, tasks: [T('n1', 'Made on desktop before signing in')], top3: {}, digestRead: {}, pomo: { phase: 'idle', count: 0 } }, '2026-10-14T14:00:00Z');
  const r = Sync.mergeStates(null, fresh, clone(base));
  assert.strictEqual(r.state.settings.theme, 'dark'); assert.strictEqual(r.state.settings.name, 'Nathan');
  assert.deepStrictEqual(r.state.tasks.map(t => t.id).sort(), ['n1', 't1', 't2', 't3']);
  assert.deepStrictEqual(r.state.top3, base.top3);
});
test('device-only fields (open sections, savedAt) never travel', () => {
  const phone = clone(base); phone.ui = { open: { y: true } };
  const desk = clone(base); desk.ui = { open: { z: true } };
  const r = Sync.mergeStates(base, desk, phone);
  assert.deepStrictEqual(r.state.ui, { open: { z: true } });
  assert.ok(!('ui' in Sync.shareable(r.state)) && !('savedAt' in Sync.shareable(r.state)));
});
test('nothing in Drive yet → local is uploaded as-is', () => {
  const r = Sync.mergeStates(null, clone(base), null);
  assert.strictEqual(r.changedRemote, true); assert.deepStrictEqual(r.state, base);
});
test('emptying a list on one side (all inbox items sorted on phone) → empty after merge', () => {
  const b = { ...clone(base), inbox: [{ id: 'i1', text: 'a' }, { id: 'i2', text: 'b' }] };
  const phone = { ...clone(b), inbox: [] };
  const r = Sync.mergeStates(b, clone(b), phone);
  assert.deepStrictEqual(r.state.inbox, []);
});
test('routine blocks edited on both devices (different blocks) → both edits', () => {
  const b = { ...clone(base), routine: { weekday: [{ id: 'b1', name: 'Deep', start: '09:00', end: '11:00' }, { id: 'b2', name: 'Admin', start: '11:00', end: '12:00' }], weekend: [] } };
  const phone = clone(b); phone.routine.weekday[0].end = '11:30';
  const desk = clone(b); desk.routine.weekday[1].name = 'Email';
  const r = Sync.mergeStates(b, desk, phone);
  assert.strictEqual(r.state.routine.weekday[0].end, '11:30'); assert.strictEqual(r.state.routine.weekday[1].name, 'Email');
});
test('a null value (e.g. no active block) vs an object on the other side merges as one value', () => {
  const b = { ...clone(base), active: null };
  const desk = { ...clone(b), active: { id: 'x', title: 'Deep work' } };
  assert.deepStrictEqual(Sync.mergeStates(b, clone(b), desk).state.active, { id: 'x', title: 'Deep work' });
  assert.strictEqual(Sync.mergeStates(b, desk, { ...clone(b), active: null }).state.active.title, 'Deep work');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
