// Test: RRULE-Entfaltung, EXDATE und DURATION — die Fälle, die bei Tanda-Feeds auftreten
const fs = require('fs');
const src = fs.readFileSync('./src/05-app-logik.js', 'utf8');
const body = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));
const start = body.indexOf('const ICAL_KEY');
const endIdx = body.indexOf('//  Kalender + Urlaub');
const icsCode = body.slice(start, body.lastIndexOf('\n', endIdx));

const pad2 = n => String(n).padStart(2, '0');
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const state = { rows: [] };
const document = { getElementById: () => null };
const window = {};

const sb = new Function(
  'pad2', 'HOURLY_RATE', 'eur', 'state', 'localStorage', 'document', 'window',
  icsCode + '\nreturn { icalParse, icalExpandRrule, icalDuration, icalIsShift, icalEventsForMonth, localIso };'
)(pad2, 13.90, v => v.toFixed(2), state, localStorage, document, window);

let fails = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const unfold = ics => sb.icalExpandRrule(sb.icalParse(ics)).filter(sb.icalIsShift);
const dates = evs => evs.map(e => e.start).sort();

// ── 1 · Wöchentliche Regel: jeden Mo + Mi, 8h, ab 02.11.2026, 6 Wiederholungen
const weekly = `BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Berlin:20261102T080000\r
DTEND;TZID=Europe/Berlin:20261102T160000\r
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6\r
SUMMARY:Frühschicht\r
END:VEVENT\r
END:VCALENDAR`;
const w = unfold(weekly);
check('WEEKLY BYDAY=MO,WE mit COUNT=6 → 6 Termine', w.length === 6, w.length);
check('Termine liegen auf Mo+Mi: 02.,04.,09.,11.,16.,18.11',
  dates(w).join(',') === '2026-11-02,2026-11-04,2026-11-09,2026-11-11,2026-11-16,2026-11-18', dates(w));
check('jede Instanz hat 8h Dauer', w.every(e => sb.icalDuration(e) === 480), w.map(e => sb.icalDuration(e)));

// ── 2 · UNTIL statt COUNT
const untilIcs = `BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Berlin:20261102T080000\r
DTEND;TZID=Europe/Berlin:20261102T160000\r
RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T235959Z\r
SUMMARY:Montagsschicht\r
END:VEVENT\r
END:VCALENDAR`;
const u = unfold(untilIcs);
check('WEEKLY UNTIL 30.11. → 5 Montage (02.,09.,16.,23.,30.)', u.length === 5, dates(u));

// ── 3 · EXDATE: eine Instanz abgesagt
const exdateIcs = `BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Berlin:20261102T080000\r
DTEND;TZID=Europe/Berlin:20261102T160000\r
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5\r
EXDATE;TZID=Europe/Berlin:20261116T080000\r
SUMMARY:Schicht mit Ausfall\r
END:VEVENT\r
END:VCALENDAR`;
const ex = unfold(exdateIcs);
check('EXDATE entfernt den 16.11. → 4 Termine', ex.length === 4 && !dates(ex).includes('2026-11-16'), dates(ex));

// ── 4 · DURATION statt DTEND
const durIcs = `BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Berlin:20261103T170000\r
DURATION:PT8H30M\r
SUMMARY:Schicht mit DURATION\r
END:VEVENT\r
END:VCALENDAR`;
const du = unfold(durIcs);
check('DURATION:PT8H30M → 510 Minuten', du.length === 1 && sb.icalDuration(du[0]) === 510, du.length && sb.icalDuration(du[0]));

// ── 5 · INTERVAL=2 (jede zweite Woche)
const intIcs = `BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Berlin:20261102T080000\r
DTEND;TZID=Europe/Berlin:20261102T160000\r
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3\r
SUMMARY:Alle zwei Wochen\r
END:VEVENT\r
END:VCALENDAR`;
const iv = unfold(intIcs);
check('INTERVAL=2 → 02.,16.,30.11.', dates(iv).join(',') === '2026-11-02,2026-11-16,2026-11-30', dates(iv));

// ── 6 · Schicht über Mitternacht als Regel (22:00–06:00)
const nightIcs = `BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Berlin:20261102T220000\r
DTEND;TZID=Europe/Berlin:20261103T060000\r
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2\r
SUMMARY:Nachtschicht\r
END:VEVENT\r
END:VCALENDAR`;
const ni = unfold(nightIcs);
check('Nachtschicht-Regel: 2 Instanzen je 8h', ni.length === 2 && ni.every(e => sb.icalDuration(e) === 480),
  ni.map(e => [e.start, e.end, sb.icalDuration(e)]));

// ── 7 · Ohne RRULE bleibt alles beim Alten (Regression)
const plain = `BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Berlin:20261102T160000\r
DTEND;TZID=Europe/Berlin:20261102T220000\r
SUMMARY:Einzelschicht\r
END:VEVENT\r
END:VCALENDAR`;
check('ohne RRULE unverändert 1 Termin / 6h', unfold(plain).length === 1 && sb.icalDuration(unfold(plain)[0]) === 360);

// ── 8 · Sicherheitsnetz: Regel ohne Ende erzeugt nicht unendlich viele
const infIcs = `BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
DTSTART;TZID=Europe/Berlin:20261102T080000\r
DTEND;TZID=Europe/Berlin:20261102T160000\r
RRULE:FREQ=DAILY\r
SUMMARY:Endlos\r
END:VEVENT\r
END:VCALENDAR`;
const inf = unfold(infIcs);
check('RRULE ohne COUNT/UNTIL wird bei 500 gedeckelt', inf.length === 500, inf.length);

console.log(fails === 0 ? '\nALLE RRULE-TESTS OK' : `\n${fails} FEHLER`);
process.exit(fails ? 1 : 0);
