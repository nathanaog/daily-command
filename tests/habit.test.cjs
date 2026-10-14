// Habit engine tests: node tests/habit.test.cjs  (extracts the pure block from index.html)
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const block = src.slice(src.indexOf('// ==HABIT START=='), src.indexOf('// ==HABIT END=='));
const Habit = new Function(block + '; return Habit;')();
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log('✗ ' + name); } };
const log = (id, ...days) => ({ [id]: Object.fromEntries(days.map(d => [d, 1])) });

// --- interval ---
const charge = { id: 'c', kind: 'interval', every: 5, learn: true };
t('never done → due', Habit.status(charge, {}, '2026-10-14').due);
t('done 2 days ago, every 5 → not due', !Habit.status(charge, log('c', '2026-10-12'), '2026-10-14').due);
let s = Habit.status(charge, log('c', '2026-10-10'), '2026-10-14');
t('4 days, every 5 → due a day early (urgency 1)', s.due && s.urgency === 1);
t('math shows the subtraction', s.math.startsWith('14 Oct − 10 Oct = 4 days · every 5 days → nudge from day 4'));
t('5 days → urgency 2', Habit.status(charge, log('c', '2026-10-09'), '2026-10-14').urgency === 2);
t('ticked today → not due', !Habit.status(charge, log('c', '2026-10-01', '2026-10-14'), '2026-10-14').due);
s = Habit.status(charge, log('c', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11'), '2026-10-14');
t('learns every 7 from gaps 7,7,7', s.every === 7 && s.math.includes('median of 7, 7, 7') && !s.due);
t('learned 7 → due at day 6', Habit.status(charge, log('c', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-08'), '2026-10-14').due === true);
t('learn off → uses set value', Habit.status({ ...charge, learn: false }, log('c', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11'), '2026-10-14').every === 5);
t('every 2 → no early nudge', !Habit.status({ id: 'c', kind: 'interval', every: 2 }, log('c', '2026-10-13'), '2026-10-14').due);

// --- weekly (Wed 14 Oct 2026; week Mon 12 – Sun 18) ---
const gym = { id: 'g', kind: 'weekly', target: 3 };
s = Habit.status(gym, log('g', '2026-10-12'), '2026-10-14');
t('1 of 3, 5 days left incl. today', s.math === '1 of 3 this week · 2 more in 5 days' && s.due);
t('week dots Mon..Sun', s.week.join() === 'true,false,false,false,false,false,false');
t('last week does not count', Habit.status(gym, log('g', '2026-10-11'), '2026-10-14').count === 0);
t('target met → not due', !Habit.status(gym, log('g', '2026-10-12', '2026-10-13', '2026-10-14'), '2026-10-14').due);
t('Sat with 2 still needed → urgency 2', Habit.status(gym, log('g', '2026-10-12'), '2026-10-17').urgency === 2);
t('Sunday rolls to a fresh week next day', Habit.status(gym, log('g', '2026-10-12', '2026-10-13', '2026-10-14'), '2026-10-19').count === 0);

// --- schedule ---
const cls = { id: 'k', kind: 'schedule', days: Habit.parseDays('Tue, Thu'), time: '19:00', lead: 25, dur: 60 };
t('parseDays Tue, Thu', cls.days.join() === '2,4');
t('parseDays German Di Do + weekdays', Habit.parseDays('Di Do').join() === '2,4' && Habit.parseDays('weekdays').join() === '1,2,3,4,5');
t('parseDays "th, sat, sun"', Habit.parseDays('th, sat, sun').join() === '0,4,6');
t('not on Wed', !Habit.status(cls, {}, '2026-10-14', 1150).due);
t('Thu 16:00 → not yet (shows from 17:35)', !Habit.status(cls, {}, '2026-10-15', 960).due);
s = Habit.status(cls, {}, '2026-10-15', 1060);
t('Thu 17:40 → due, "19:00 · leave 18:35"', s.due && s.text === '19:00 · leave 18:35');
t('Thu 20:30 → "did you go?"', Habit.status(cls, {}, '2026-10-15', 1230).text === 'did you go?');
t('tally 1 of 2 this week', Habit.status(cls, log('k', '2026-10-13'), '2026-10-15', 1060).math.startsWith('1 of 2 this week (Tue, Thu 19:00)'));
t('occurrences Mon–Sun → Tue + Thu', Habit.occurrences([cls], '2026-10-12', '2026-10-18').map(o => o.day).join() === '2026-10-13,2026-10-15');
t('paused → no occurrences, not due', Habit.occurrences([{ ...cls, paused: true }], '2026-10-12', '2026-10-18').length === 0 && !Habit.status({ ...cls, paused: true }, {}, '2026-10-15', 1100).due);

// --- nudges ---
const hs = [charge, gym, { ...cls, when: 'life' }, { id: 'w', kind: 'interval', every: 3, when: 'winddown' }];
let n = Habit.nudges(hs, log('g', '2026-10-12'), '2026-10-15', 1120, 'life');
t('life mode: class (urgency 2) first, wind-down habit hidden', n[0].h.id === 'k' && !n.some(x => x.h.id === 'w'));
t('snoozed today → hidden', !Habit.nudges(hs, {}, '2026-10-15', 1100, 'life', { c: '2026-10-15' }).some(x => x.h.id === 'c'));
t('snooze expires next day', Habit.nudges(hs, {}, '2026-10-16', 1100, 'life', { c: '2026-10-15' }).some(x => x.h.id === 'c'));

t('"someday" is not Sunday; "Dienstag" is Tue', Habit.parseDays('someday').length === 0 && Habit.parseDays('Dienstag, Do').join() === '2,4');
t('upcoming class outranks an overdue chore', Habit.nudges([{ id: 'p', kind: 'interval', every: 2 }, cls], log('p', '2026-10-01'), '2026-10-15', 1070, 'life')[0].h.id === 'k');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
