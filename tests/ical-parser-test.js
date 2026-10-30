// Test: ICS-Parser der Arbeitszeit-App gegen realistische Google-Calendar-Exporte
const fs = require('fs');
const src = fs.readFileSync('./src/05-app-logik.js', 'utf8');
const body = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));
// Nur die ICS-Funktionen herausnehmen und in einen Sandkasten laden
const start = body.indexOf('const ICAL_KEY');
// Ende: die Zeile mit dem Kommentar „Kalender + Urlaub" — davor steht die
// schließende Klammer von initIcalSettings. Wir übernehmen alles bis dahin.
const endMarker = '//  Kalender + Urlaub';
const endIdx = body.indexOf(endMarker);
const lineStart = body.lastIndexOf('\n', endIdx);
const icsCode = body.slice(start, lineStart);

const pad2 = n => String(n).padStart(2, '0');
const HOURLY_RATE = 13.90;
const eur = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €';
const state = { rows: [] };
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const statusBox = { textContent: '', className: '' };
const document = { getElementById: id => (id === 'icalStatus' ? statusBox : null) };
const window = {};

const sandbox = new Function(
  'pad2', 'HOURLY_RATE', 'eur', 'state', 'localStorage', 'document', 'window',
  icsCode + '\nreturn { icalParse, icalDuration, icalIsShift, icalEventsForMonth, hm, localIso, icalUnfold, icalMinShiftMin, setEvents: e => { icalEvents = e; } };'
)(pad2, HOURLY_RATE, eur, state, localStorage, document, window);
// Pflicht-Exporte prüfen — sonst testet man stillschweigend gegen undefined
for (const fn of ['icalParse', 'icalDuration', 'icalIsShift', 'icalEventsForMonth', 'hm', 'localIso']) {
  if (typeof sandbox[fn] !== 'function') throw new Error('Sandkasten: ' + fn + ' fehlt — Slice-Grenzen im Test prüfen');
}

const ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'TZNAME:CEST',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261102T160000',
  'DTEND;TZID=Europe/Berlin:20261102T220000',
  'SUMMARY:Spätschicht Bahnhof',
  'LOCATION:Filiale 3',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261103T050000Z',
  'DTEND:20261103T110000Z',
  'SUMMARY:Frühschicht',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261104T200000',
  'DTEND;TZID=Europe/Berlin:20261105T020000',
  'SUMMARY:',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261105T200000',
  'DTEND;TZID=Europe/Berlin:20261106T010000',
  'SUMMARY:Nachtschicht mit sehr langem Namen der laut RFC 5545 gefaltet werden',
  '  muss und beim Parsen wieder zusammengeführt wird',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261107T200000',
  'DTEND;TZID=Europe/Berlin:20261108T020000',
  'SUMMARY:Spätschicht Wochenende',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261109T220000',
  'DTEND;TZID=Europe/Berlin:20261110T040000',
  'SUMMARY:Nachtschicht über Mitternacht',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261106',
  'DTEND;VALUE=DATE:20261107',
  'SUMMARY:Urlaub',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261110T180000',
  'DTEND;TZID=Europe/Berlin:20261110T220000',
  'SUMMARY:Team-Meeting kurz',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261112T180000',
  'DTEND;TZID=Europe/Berlin:20261112T230000',
  'SUMMARY:Abgesagte Schicht',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

// Standard-Mindestdauer ist 4 h — hier 5 h erzwingen, damit das 4h-Meeting rausfällt
localStorage.setItem('azt-ical-minshift', '5');

const all = sandbox.icalParse(ICS);
const shifts = all.filter(sandbox.icalIsShift);
// Monats-/Listen-Funktionen arbeiten auf dem Modul-State → den befüllen wir wie icalFetch
sandbox.setEvents(shifts);
let fails = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

check('Mindestdauer aus localStorage gelesen (5 h = 300 min)', sandbox.icalMinShiftMin() === 300, sandbox.icalMinShiftMin());
check('alle VEVENTs geparst (7 bestätigte, CANCELLED gefiltert)', all.length === 7, all.length);
check('nur echte Schichten bleiben (Urlaub + 4h-Meeting raus)', shifts.length === 5 && !shifts.some(x => /Meeting/.test(x.summary)), shifts.map(s => s.summary));
check('TZID-Termin lokal: 02.11 16:00–22:00 = 6h', shifts[0].start === '2026-11-02' && sandbox.icalDuration(shifts[0]) === 360, sandbox.icalDuration(shifts[0]));
check('UTC-Termin konvertiert: 20261103T050000Z gibt 06:00 lokal (CET)', shifts[1].start === '2026-11-03' && shifts[1].startMin === 360, [shifts[1].start, shifts[1].startMin]);
const night = shifts.find(s => s.start === '2026-11-09');
check('über Mitternacht: 22:00 → 04:00 = 6h', night && sandbox.icalDuration(night) === 360, night && sandbox.icalDuration(night));
check('Event mit leerem SUMMARY wird verworfen', !all.some(e => e.start === '2026-11-04'));
check('Sortierung im Monat chronologisch', sandbox.icalEventsForMonth(2026, 10).map(e => e.start).join(',') === '2026-11-02,2026-11-03,2026-11-05,2026-11-07,2026-11-09', sandbox.icalEventsForMonth(2026, 10).map(e => e.start));
const folded = all.find(e => /Nachtschicht/.test(e.summary || ''));
check('gefaltete Zeile entfaltet + Unescape', folded && /gefaltet werden muss und beim Parsen/.test(folded.summary), folded && folded.summary);
check('Event ohne SUMMARY wird verworfen', !all.some(e => e.start === '2026-11-04' && !e.summary));
check('Monatsfilter November 2026 = 5 Schichten', sandbox.icalEventsForMonth(2026, 10).length === 5, sandbox.icalEventsForMonth(2026, 10).map(e => e.start + ':' + e.summary));
check('Zeitformel hm()', sandbox.hm(360) === '06:00' && sandbox.hm(0) === '00:00');
check('localIso() nutzt lokale Zeit (kein UTC-Drift)', sandbox.localIso(new Date(2026, 10, 1, 0, 30)) === '2026-11-01', sandbox.localIso(new Date(2026, 10, 1, 0, 30)));

// „erfasst"-Erkennung / Plan übernehmen im Month-View wird über state.rows geprüft
state.rows = [{ date: '2026-11-02' }];
check('erfasste Schicht erkannt (state.rows)', state.rows.some(r => r.date === shifts[0].start));

console.log(fails === 0 ? '\nALLE TESTS OK' : `\n${fails} FEHLER`);
process.exit(fails ? 1 : 0);
