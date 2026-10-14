/* Now/Next engine edge-case tests.
 * Run:  node tests/engine.test.cjs            (uses your local time zone)
 *       TZ=UTC node tests/engine.test.cjs     (try others too)
 * The engine is extracted from index.html between the ENGINE START/END
 * markers, so these tests run against the exact code the app ships.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.split('// ==ENGINE START==')[1].split('// ==ENGINE END==')[0];
const Engine = new Function(code + '; return Engine;')();

// Local-time constructor: "2026-10-13 10:00" -> Date in the process TZ.
const at = s => { const [d, t] = s.split(' '); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const B = (id, name, start, end, kind, mode) => ({ id, name, start, end, kind, mode });

// Same shape as the app's default routine.
const routine = {
  weekday: [
    B('wake', 'Wake up', '07:30', '07:45', 'wake', 'life'), B('morn', 'Morning sequence', '07:45', '09:00', 'morning', 'life'),
    B('deep1', 'Deep work', '09:00', '11:30', 'deep', 'work'), B('adm1', 'Admin', '11:30', '12:30', 'admin', 'work'),
    B('lunch', 'Lunch', '12:30', '13:15', 'lunch', 'life'), B('deep2', 'Deep work', '13:15', '15:30', 'deep', 'work'),
    B('ger', 'German', '15:30', '16:00', 'german', 'life'), B('adm2', 'Admin & shallow work', '16:00', '17:30', 'admin', 'work'),
    B('life', 'Life', '17:30', '19:00', 'life', 'life'), B('leis', 'Leisure', '19:00', '22:00', 'leisure', 'leisure'),
    B('wd', 'Wind-down', '22:00', '23:00', 'winddown', 'winddown'),
  ],
  weekend: [
    B('wwake', 'Wake up', '08:30', '08:45', 'wake', 'life'), B('wmorn', 'Morning sequence', '08:45', '10:00', 'morning', 'life'),
    B('wlife', 'Life & errands', '10:00', '13:00', 'life', 'life'), B('wlunch', 'Lunch', '13:00', '14:00', 'lunch', 'life'),
    B('wleis1', 'Leisure', '14:00', '18:00', 'leisure', 'leisure'), B('wger', 'German', '18:00', '18:30', 'german', 'life'),
    B('wleis2', 'Leisure', '18:30', '23:00', 'leisure', 'leisure'), B('wwd', 'Wind-down', '23:00', '00:30', 'winddown', 'winddown'),
  ],
};
const ev = (id, title, s, e, extra = {}) => ({ id, title, start: at(s).toISOString(), end: at(e).toISOString(), ...extra });
const baseState = (over = {}) => ({
  routine, events: [], settings: { overrunMin: 20, dayCutoff: 4 },
  projects: [{ id: 'p1', name: 'YouTube', nextId: 't2' }, { id: 'p2', name: 'Wedding', nextId: null }],
  tasks: [
    { id: 't1', title: 'Script episode 4', projectId: 'p1', done: false, created: 3 },
    { id: 't2', title: 'Email venue', projectId: 'p2', done: false, created: 2 },
    { id: 't3', title: 'Oldest task', projectId: 'p2', done: false, created: 1 },
  ],
  top3: { '2026-10-13': ['t1'] }, skips: {}, ...over,
});

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); }
}
console.log(`Engine tests — TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

// ---------------- basics: routine + top task ----------------
test('weekday 10:00 → Deep work with top-3 task', () => {
  const r = Engine.resolve(at('2026-10-13 10:00'), baseState());
  assert.strictEqual(r.current.type, 'block'); assert.strictEqual(r.current.title, 'Deep work');
  assert.strictEqual(r.current.pick.task.id, 't1'); assert.strictEqual(r.current.pick.source, 'top3');
  assert.strictEqual(r.mode, 'work');
  assert.strictEqual(r.next.title, 'Admin'); assert.strictEqual(hm(r.next.at), '11:30');
});
test('no top 3 → project next action', () => {
  const r = Engine.resolve(at('2026-10-13 10:00'), baseState({ top3: {} }));
  assert.strictEqual(r.current.pick.task.id, 't2'); assert.strictEqual(r.current.pick.source, 'next');
});
test('no top 3, no next action → oldest open task', () => {
  const s = baseState({ top3: {} }); s.projects.forEach(p => p.nextId = null);
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:00'), s).current.pick.task.id, 't3');
});
test('no tasks at all → pick is null (UI asks to pick top 3)', () => {
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:00'), baseState({ tasks: [], top3: {} })).current.pick, null);
});
test('done top-3 task is skipped', () => {
  const s = baseState({ top3: { '2026-10-13': ['t1', 't3'] } }); s.tasks[0].done = true;
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:00'), s).current.pick.task.id, 't3');
});
test('"Not now" skip moves to next candidate; if all skipped, falls back to first', () => {
  const s = baseState({ skips: { '2026-10-13': ['t1'] } });
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:00'), s).current.pick.task.id, 't2');
  s.skips['2026-10-13'] = ['t1', 't2', 't3'];
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:00'), s).current.pick.task.id, 't1');
});
test('non-work block (Lunch) shows no task', () => {
  const r = Engine.resolve(at('2026-10-13 12:45'), baseState());
  assert.strictEqual(r.current.title, 'Lunch'); assert.strictEqual(r.current.pick, undefined); assert.strictEqual(r.mode, 'life');
});
test('block boundaries are [start, end): 11:30 exactly is Admin', () => {
  assert.strictEqual(Engine.resolve(at('2026-10-13 11:30'), baseState()).current.title, 'Admin');
  assert.strictEqual(Engine.resolve(at('2026-10-13 11:29'), baseState()).current.title, 'Deep work');
});

// ---------------- calendar events override ----------------
test('event overrides block; Next = resume Deep work when it ends', () => {
  const r = Engine.resolve(at('2026-10-13 10:15'), baseState({ events: [ev('e1', 'Standup', '2026-10-13 10:00', '2026-10-13 10:30')] }));
  assert.strictEqual(r.current.type, 'event'); assert.strictEqual(r.current.title, 'Standup');
  assert.strictEqual(r.current.underlying.name, 'Deep work'); assert.strictEqual(r.mode, 'work');
  assert.strictEqual(r.next.title, 'Deep work'); assert.strictEqual(r.next.resume, true); assert.strictEqual(hm(r.next.at), '10:30');
});
test('overlapping events: most recently started wins, other listed as "also"', () => {
  const events = [ev('a', 'Long meeting', '2026-10-13 10:00', '2026-10-13 11:00'), ev('b', 'Call', '2026-10-13 10:15', '2026-10-13 10:45')];
  const r = Engine.resolve(at('2026-10-13 10:20'), baseState({ events }));
  assert.strictEqual(r.current.title, 'Call'); assert.deepStrictEqual(r.current.also, ['Long meeting']);
  assert.strictEqual(r.next.title, 'Long meeting'); assert.strictEqual(hm(r.next.at), '10:45');
});
test('overlapping events with the same start: the one ending first wins', () => {
  const events = [ev('a', 'Hour', '2026-10-13 10:00', '2026-10-13 11:00'), ev('b', 'Half', '2026-10-13 10:00', '2026-10-13 10:30')];
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:10'), baseState({ events })).current.title, 'Half');
});
test('event hiding several blocks: Next jumps to what is current when it ends', () => {
  const r = Engine.resolve(at('2026-10-13 11:10'), baseState({ events: [ev('e', 'Offsite', '2026-10-13 11:00', '2026-10-13 13:00')] }));
  assert.strictEqual(r.next.title, 'Lunch'); assert.strictEqual(hm(r.next.at), '13:00'); assert.strictEqual(r.next.resume, true);
});
test('all-day event never overrides but is listed', () => {
  const s = baseState({ events: [{ id: 'ad', title: 'Partner birthday', allDay: true, start: at('2026-10-13 00:00').toISOString(), end: at('2026-10-14 00:00').toISOString() }] });
  const r = Engine.resolve(at('2026-10-13 10:00'), s);
  assert.strictEqual(r.current.title, 'Deep work'); assert.deepStrictEqual(r.allDay, ['Partner birthday']);
});
test('"free"/info events (Google: transparent, working location) never override, shown as context', () => {
  const s = baseState({ events: [ev('w', 'Working from home', '2026-10-13 09:00', '2026-10-13 17:00', { info: true }),
                                 ev('f', 'Gym (free)', '2026-10-13 10:00', '2026-10-13 10:30', { info: true })] });
  const r = Engine.resolve(at('2026-10-13 10:10'), s);
  assert.strictEqual(r.current.title, 'Deep work'); assert.deepStrictEqual(r.allDay, ['Working from home', 'Gym (free)']);
  assert.strictEqual(r.next.title, 'Admin', 'info events are not Next either');
});
test('upcoming event becomes Next if it starts before the next block', () => {
  const r = Engine.resolve(at('2026-10-13 10:00'), baseState({ events: [ev('e', 'Dentist', '2026-10-13 10:45', '2026-10-13 11:15')] }));
  assert.strictEqual(r.next.title, 'Dentist'); assert.strictEqual(r.next.type, 'event');
});
test('broken events (end before start, bad dates) are ignored', () => {
  const s = baseState({ events: [ev('x', 'Backwards', '2026-10-13 10:30', '2026-10-13 10:00'), { id: 'y', title: 'Junk', start: 'nope', end: 'nope' }] });
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:15'), s).current.title, 'Deep work');
});

// ---------------- weekends + midnight rollover ----------------
test('Saturday 10:30 uses the weekend template', () => {
  const r = Engine.resolve(at('2026-10-17 10:30'), baseState());
  assert.strictEqual(r.current.title, 'Life & errands'); assert.strictEqual(r.mode, 'life');
});
test('Sunday 00:15 → still Saturday-night Wind-down (block wraps midnight)', () => {
  const r = Engine.resolve(at('2026-10-18 00:15'), baseState());
  assert.strictEqual(r.current.title, 'Wind-down'); assert.strictEqual(r.current.day, '2026-10-17'); assert.strictEqual(r.mode, 'winddown');
});
test('Monday 00:15 → Sunday wind-down from the WEEKEND template, Next = Monday wake 07:30', () => {
  const r = Engine.resolve(at('2026-10-19 00:15'), baseState());
  assert.strictEqual(r.current.title, 'Wind-down'); assert.strictEqual(r.current.day, '2026-10-18');
  assert.strictEqual(r.next.title, 'Wake up'); assert.strictEqual(hm(r.next.at), '07:30');
});
test('Monday 01:00 → free gap, winddown mode, Next = wake 07:30', () => {
  const r = Engine.resolve(at('2026-10-19 01:00'), baseState());
  assert.strictEqual(r.current.type, 'gap'); assert.strictEqual(r.mode, 'winddown');
  assert.strictEqual(hm(r.current.start), '00:30'); assert.strictEqual(hm(r.current.end), '07:30');
  assert.strictEqual(r.next.title, 'Wake up');
});
test('Saturday 00:15 (after Friday weekday wind-down) → gap; Next is the WEEKEND wake 08:30', () => {
  const r = Engine.resolve(at('2026-10-17 00:15'), baseState());
  assert.strictEqual(r.current.type, 'gap'); assert.strictEqual(hm(r.next.at), '08:30');
});
test('Tuesday 23:30 → Next is tomorrow 07:30', () => {
  const r = Engine.resolve(at('2026-10-13 23:30'), baseState());
  assert.strictEqual(r.next.title, 'Wake up'); assert.strictEqual(r.next.at.getDate(), 14); assert.strictEqual(hm(r.next.at), '07:30');
});
test('event crossing midnight overrides on both sides', () => {
  const s = baseState({ events: [ev('p', 'Party', '2026-10-13 23:00', '2026-10-14 01:00')] });
  assert.strictEqual(Engine.resolve(at('2026-10-13 23:30'), s).current.title, 'Party');
  assert.strictEqual(Engine.resolve(at('2026-10-14 00:30'), s).current.title, 'Party');
  assert.strictEqual(Engine.resolve(at('2026-10-14 01:00'), s).current.type, 'gap');
});
test('logical day: 02:00 still counts as yesterday (top 3, wrap-up)', () => {
  assert.strictEqual(Engine.dateKey(Engine.logicalDay(at('2026-10-14 02:00'), 4)), '2026-10-13');
  assert.strictEqual(Engine.dateKey(Engine.logicalDay(at('2026-10-14 04:00'), 4)), '2026-10-14');
  assert.strictEqual(Engine.resolve(at('2026-10-14 02:00'), baseState()).logicalDay, '2026-10-13');
});
test('DST change day (Europe: 25 Oct 2026): blocks still resolve by wall-clock', () => {
  const s = baseState({ routine: { weekday: [], weekend: [B('n', 'Night shift', '01:00', '04:00', 'deep', 'work'), B('m', 'Morning', '04:00', '09:00', 'life', 'life')] } });
  assert.strictEqual(Engine.resolve(at('2026-10-25 03:30'), s).current.title, 'Night shift');
  assert.strictEqual(Engine.resolve(at('2026-10-25 04:30'), s).current.title, 'Morning');
});

// ---------------- routine quirks ----------------
test('overlapping blocks in a template: later start wins', () => {
  const s = baseState({ routine: { weekday: [B('a', 'Deep', '09:00', '12:00', 'deep', 'work'), B('b', 'Gym', '10:00', '11:00', 'life', 'life')], weekend: [] } });
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:30'), s).current.title, 'Gym');
  assert.strictEqual(Engine.resolve(at('2026-10-13 11:15'), s).current.title, 'Deep');
});
test('malformed / zero-length blocks are ignored', () => {
  const s = baseState({ routine: { weekday: [B('a', 'Bad', '25:00', '26:00', 'deep', 'work'), B('b', 'Zero', '10:00', '10:00', 'deep', 'work'), B('c', 'Ok', '09:00', '11:00', 'admin', 'work')], weekend: [] } });
  assert.strictEqual(Engine.resolve(at('2026-10-13 10:00'), s).current.title, 'Ok');
});
test('empty routine + missing fields (fresh/offline state) does not throw', () => {
  const r = Engine.resolve(at('2026-10-13 10:00'), { routine: { weekday: [], weekend: [] } });
  assert.strictEqual(r.current.type, 'gap'); assert.strictEqual(r.next, null); assert.strictEqual(r.mode, 'work'); // hour fallback
});

// ---------------- modes ----------------
test('manual mode override applies until its expiry', () => {
  const s = baseState({ modeOverride: { mode: 'leisure', until: at('2026-10-13 11:30').toISOString() } });
  let r = Engine.resolve(at('2026-10-13 10:00'), s); assert.strictEqual(r.mode, 'leisure'); assert.strictEqual(r.autoMode, 'work');
  r = Engine.resolve(at('2026-10-13 11:31'), s); assert.strictEqual(r.mode, 'work'); assert.strictEqual(r.overrideOn, false);
});
test('manual Work mode during the morning block shows the top task ("Start work" early)', () => {
  const s = baseState({ modeOverride: { mode: 'work', until: at('2026-10-13 09:00').toISOString() } });
  const r = Engine.resolve(at('2026-10-13 08:40'), s);
  assert.strictEqual(r.current.title, 'Morning sequence'); assert.strictEqual(r.mode, 'work');
  assert.strictEqual(r.current.pick.task.id, 't1'); assert.strictEqual(r.current.forcedWork, true);
});
test('manual Work mode does NOT put a task over a calendar event', () => {
  const s = baseState({ modeOverride: { mode: 'work', until: at('2026-10-13 09:00').toISOString() },
    events: [ev('e', 'Doctor', '2026-10-13 08:30', '2026-10-13 08:50')] });
  const r = Engine.resolve(at('2026-10-13 08:40'), s);
  assert.strictEqual(r.current.type, 'event'); assert.strictEqual(r.current.pick, undefined);
});
test('manual Leisure mode in a work block keeps the routine (no forced task logic)', () => {
  const s = baseState({ modeOverride: { mode: 'leisure', until: at('2026-10-13 11:30').toISOString() } });
  const r = Engine.resolve(at('2026-10-13 10:00'), s);
  assert.strictEqual(r.mode, 'leisure'); assert.strictEqual(r.current.forcedWork, undefined);
});
test('gap mode inherits the block that just ended', () => {
  const s = baseState({ routine: { weekday: [B('a', 'Leisure', '19:00', '20:00', 'leisure', 'leisure')], weekend: [] } });
  assert.strictEqual(Engine.resolve(at('2026-10-13 20:30'), s).mode, 'leisure');
});

// ---------------- overrun nudge ----------------
test('overrun: nudge only after 20 min past planned end, once the schedule moved on', () => {
  const s = baseState({ active: { id: '2026-10-13|deep1', title: 'Deep work', plannedEnd: at('2026-10-13 11:30').toISOString() } });
  assert.strictEqual(Engine.resolve(at('2026-10-13 11:49'), s).overrun, null);
  const r = Engine.resolve(at('2026-10-13 11:50'), s);
  assert.ok(r.overrun); assert.strictEqual(r.overrun.minutesOver, 20); assert.strictEqual(r.current.title, 'Admin');
});
test('overrun: snoozed nudge stays quiet until snooze ends', () => {
  const s = baseState({ active: { id: 'x', title: 'X', plannedEnd: at('2026-10-13 11:30').toISOString(), snoozeUntil: at('2026-10-13 12:05').toISOString() } });
  assert.strictEqual(Engine.resolve(at('2026-10-13 12:00'), s).overrun, null);
  assert.ok(Engine.resolve(at('2026-10-13 12:06'), s).overrun);
});
test('overrun: no nudge while the active item is still current (e.g. a long event)', () => {
  const s = baseState({ events: [ev('e', 'Workshop', '2026-10-13 10:00', '2026-10-13 13:00')],
    active: { id: 'ev:e', title: 'Workshop', plannedEnd: at('2026-10-13 10:30').toISOString() } });
  assert.strictEqual(Engine.resolve(at('2026-10-13 12:00'), s).overrun, null);
});

// ---------------- agenda ----------------
test('agenda lists distinct upcoming items in order, skipping gaps', () => {
  const ag = Engine.agenda(at('2026-10-13 21:00'), baseState(), 3);
  assert.deepStrictEqual(ag.map(a => a.title), ['Wind-down', 'Wake up', 'Morning sequence']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
