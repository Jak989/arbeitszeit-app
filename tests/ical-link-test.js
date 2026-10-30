// Test: Link-Normalisierung — welche Formen akzeptiert die App?
const fs = require('fs');
const src = fs.readFileSync('./src/05-app-logik.js', 'utf8');
const start = src.indexOf('function normalizeIcalUrl');
const end = src.indexOf('// Einstellungen: Link speichern / entfernen');
const fn = src.slice(start, end);

const normalizeIcalUrl = new Function(fn + '\nreturn normalizeIcalUrl;')();

let fails = 0;
const check = (input, expected, note) => {
  const got = normalizeIcalUrl(input);
  const ok = got === expected;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + JSON.stringify(input) + (note ? ' (' + note + ')' : ''));
  if (!ok) { console.log('        erwartet: ' + JSON.stringify(expected)); console.log('        bekommen: ' + JSON.stringify(got)); fails++; }
};

// ── Tanda-Formen ──
check('https://eu.tanda.co/ical/abc123.ics', 'https://eu.tanda.co/ical/abc123.ics', 'Tanda EU normal');
check('webcal://eu.tanda.co/ical/abc123.ics', 'https://eu.tanda.co/ical/abc123.ics', 'Tanda webcal (iOS-Copy)');
check('webcals://eu.tanda.co/ical/abc123.ics', 'https://eu.tanda.co/ical/abc123.ics', 'Safari webcals');
check('eu.tanda.co/ical/abc123.ics', 'https://eu.tanda.co/ical/abc123.ics', 'ohne Protokoll kopiert');
check('http://eu.tanda.co/ical/abc123.ics', 'https://eu.tanda.co/ical/abc123.ics', 'http → https (Mixed Content)');
check('https://my.tanda.co/calendar/xyz', 'https://my.tanda.co/calendar/xyz', 'andere Tanda-Domain');

// ── Kopier-Artefakte ──
check('  https://eu.tanda.co/x.ics  ', 'https://eu.tanda.co/x.ics', 'führende/folgende Leerzeichen');
check('"https://eu.tanda.co/x.ics"', 'https://eu.tanda.co/x.ics', 'Anführungszeichen');
check('<https://eu.tanda.co/x.ics>', 'https://eu.tanda.co/x.ics', 'spitze Klammern');
check('https://eu.tanda.co/x.ics?token=a b', 'https://eu.tanda.co/x.ics?token=a%20b', 'Leerzeichen im Token');

// ── Andere Anbieter (Regression) ──
check('https://calendar.google.com/calendar/ical/x/basic.ics',
      'https://calendar.google.com/calendar/ical/x/basic.ics', 'Google');
check('webcal://p01-caldav.icloud.com/published/2/abc',
      'https://p01-caldav.icloud.com/published/2/abc', 'iCloud');
check('https://outlook.office365.com/owa/calendar/x/calendar.ics',
      'https://outlook.office365.com/owa/calendar/x/calendar.ics', 'Outlook');

// ── Muss abgelehnt werden ──
check('', '', 'leer');
check('   ', '', 'nur Leerzeichen');
check('kein link hier', '', 'Klartext');
check('12345', '', 'nur Ziffern');
check('javascript:alert(1)', '', 'kein http-Protokoll');

console.log(fails === 0 ? '\nALLE LINK-TESTS OK' : `\n${fails} FEHLER`);
process.exit(fails ? 1 : 0);
