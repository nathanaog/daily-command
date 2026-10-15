// Quick-add parser tests: TZ=Europe/Berlin node tests/quickadd.test.cjs
process.env.TZ = process.env.TZ || 'Europe/Berlin';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const QuickAdd = new Function(src.slice(src.indexOf('// ==QUICKADD START=='), src.indexOf('// ==QUICKADD END==')) + '; return QuickAdd;')();
let pass = 0, fail = 0;
const NOW = new Date(2026, 9, 15, 14, 0);   // Thu 15 Oct 2026, 14:00
const fmt = d => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function t(input, want) {
  const r = QuickAdd.parse(input, NOW);
  const got = r ? `${r.title} | ${fmt(r.start)}–${r.allDay ? 'allday' : fmt(r.end).slice(-5)}` : 'null';
  if (got === want) pass++; else { fail++; console.log(`✗ "${input}"\n   got:  ${got}\n   want: ${want}`); }
}
t('Drinks with Tom Sat 7pm', 'Drinks with Tom | Sat 17/10 19:00–21:00');
t('dentist tomorrow 9:30', 'Dentist | Fri 16/10 09:30–10:30');
t('Call mum at 6', 'Call mum | Thu 15/10 18:00–19:00');
t('lunch with Sam friday', 'Lunch with Sam | Fri 16/10 12:30–13:30');
t('Climbing next thursday 18:00-20:00', 'Climbing | Thu 22/10 18:00–20:00');
t('Football on Sunday 3-5pm', 'Football | Sun 18/10 15:00–17:00');
t('Anna birthday 24/10', 'Anna birthday | Sat 24/10 00:00–allday');
t('Lisa\'s birthday 3 Nov', 'Lisa\'s birthday | Tue 3/11 00:00–allday');
t('Flight to Hanoi 12.01.', 'Flight to Hanoi | Tue 12/1 00:00–allday');
t('Meeting 10am for 90 min', 'Meeting | Fri 16/10 10:00–11:30');
t('Gym 19 uhr', 'Gym | Thu 15/10 19:00–20:00');
t('Kino mit Max morgen 20:15', 'Kino mit Max | Fri 16/10 20:15–22:15');
t('Essen am Samstag um 19', 'Essen | Sat 17/10 19:00–20:00');
t('BBQ this weekend', 'BBQ | Sat 17/10 00:00–allday');
t('Dinner with Jo tonight', 'Dinner with Jo | Thu 15/10 19:00–21:00');
t('Thursday 4pm coffee', 'Coffee | Thu 15/10 16:00–17:00');
t('haircut Oct 20th 11:00', 'Haircut | Tue 20/10 11:00–12:00');
t('Remember to buy milk', 'null');
t('Pick up parcel 7:30am', 'Pick up parcel | Fri 16/10 07:30–08:30');
t('Party sat 9pm for 4h', 'Party | Sat 17/10 21:00–01:00');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
