  <script>
    const STORAGE_KEY = 'azt-state';
    const THEME_KEY = 'azt-theme';

    const state = {
      rows: [],
      editingDate: null,
      saving: false,
      trendMode: 'week',
      trendWeekKey: '',
      trendMonth: '',
      activeTab: 'capture',
      loaded: false
    };

    // ── Konstanten (Lohn/Steuer) ──
    const HOURLY_RATE = 13.90;
    const TAX_RATE = 0.75;

    // ── Capacitor Helper ──
    const Cap = window.Capacitor;
    const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
    const CapFs = () => window.Capacitor?.Plugins?.Filesystem;
    const CapShare = () => window.Capacitor?.Plugins?.Share;

    // Speichert eine Datei. Auf Android 16 (targetSdk 36) ist der direkte Schreibzugriff
    // auf /Downloads durch Scoped Storage gesperrt. Darum: Datei in den App-Ordner schreiben
    // und dann den Android-"Speichern unter"-Dialog anbieten (SAF) — dort wählt der Nutzer
    // den Zielordner, z. B. Downloads.
    async function saveTextFile(filename, text, mime) {
      if (isNative && CapFs()) {
        try {
          // 1. In den App-eigenen Dokumente-Ordner schreiben (immer erlaubt)
          const res = await CapFs().writeFile({
            path: filename,
            data: text,
            directory: 'CACHE',
            encoding: 'utf8',
          });

          // 2. Android-Dialog "Speichern unter" öffnen, damit der Nutzer den Ordner wählt
          if (CapShare() && res.uri) {
            await CapShare().share({
              title: filename,
              files: [res.uri],
              dialogTitle: 'Speichern unter …',
            });
            return true;
          }
          showToast('Gespeichert: ' + filename, 3200);
          return true;
        } catch (err) {
          const msg = (err && err.message) || String(err);
          // Nutzer hat den Dialog abgebrochen — kein Fehler
          if (/cancel/i.test(msg)) return false;
          alert('Speichern fehlgeschlagen: ' + msg);
          return false;
        }
      }
      // Browser-Fallback
      const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return true;
    }

    // ── CSV Export (Schichten + Urlaub in einer Datei) ──
    async function exportCSV() {
      const rows = [...state.rows].sort((a, b) => a.date.localeCompare(b.date));
      const leaves = await db.leave.toArray().catch(() => []);
      if (!rows.length && !leaves.length) { alert('Keine Daten zum Exportieren.'); return; }

      function esc(v) {
        var s = v == null ? '' : String(v);
        if (/[;",\n\r]/.test(s)) { s = '"' + s.replace(/"/g, '""') + '"'; }
        return s;
      }
      var tagOf = function(d) { return ['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(d + 'T12:00:00').getDay()]; };
      var isoWeek = function(d) {
        const dt = new Date(d + 'T12:00:00');
        const t = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
        return 'KW' + Math.ceil(((t - y0) / 86400000 + 1) / 7);
      };

      // Nach Datum zusammenführen: pro Tag eine Zeile
      const byDate = new Map();
      for (const r of rows) {
        byDate.set(r.date, {
          date: r.date,
          art: 'Arbeit',
          hours: r.actualHoursManual,
          tips: r.tips,
          note: r.note || '',
        });
      }
      for (const l of leaves) {
        const art = l.type === 'unpaid' ? 'Urlaub unbezahlt' : 'Urlaub bezahlt';
        if (byDate.has(l.date)) {
          // Urlaub schlägt Arbeit (kommt selten vor, aber wer weiß)
          byDate.get(l.date).art = art;
        } else {
          byDate.set(l.date, { date: l.date, art: art, hours: '', tips: '', note: l.note || '' });
        }
      }

      const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      const lines = ['Datum;Tag;Art;Stunden;Trinkgeld;Notiz;KW'];
      for (const r of sorted) {
        lines.push([r.date, tagOf(r.date), r.art, r.hours, r.tips, r.note, isoWeek(r.date)].map(esc).join(';'));
      }
      var csv = '\uFEFF' + lines.join('\r\n');
      var stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
      await saveTextFile('arbeitszeit-export-' + stamp + '.csv', csv, 'text/csv;charset=utf-8');
    }
    window.exportCSV = exportCSV;



    // ── CSV Import (Schichten + Urlaub) ──
    async function importCSV(event) {
      const file = event.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById('csvImportStatus');
      try {
        const text = await file.text();
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { alert('CSV ist leer.'); return; }
        // Trennzeichen erkennen: Semikolon (deutsch) oder Komma
        const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
        let imported = 0, importedLeave = 0, skipped = 0;
        const header = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
        const idx = (needle) => header.findIndex(h => h.includes(needle));
        const dateIdx = idx('datum'), hoursIdx = idx('stunden'), tipsIdx = idx('trinkgeld'),
              noteIdx = idx('notiz'), artIdx = idx('art');
        if (dateIdx < 0) { alert('Spalte "Datum" nicht gefunden. Header war: ' + header.join(' | ')); return; }

        const ops = [];
        const leaveOps = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
          const rawDate = (cols[dateIdx] || '').trim();
          let date = rawDate;
          // auch TT.MM.JJJJ akzeptieren
          const de = rawDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
          if (de) date = `${de[3]}-${de[2].padStart(2,'0')}-${de[1].padStart(2,'0')}`;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

          const note = (cols[noteIdx] || '').trim();
          const art = artIdx >= 0 ? (cols[artIdx] || '').toLowerCase() : '';

          // Urlaubszeile erkennen
          if (art.includes('urlaub') || art.includes('krank')) {
            const type = art.includes('unbezahlt') ? 'unpaid'
                       : art.includes('krank') ? 'unpaid'   // Krankheit zählt hier wie unbezahlt markiert
                       : 'paid';
            leaveOps.push({ date, type, note: note || '' });
            continue;
          }

          // Normale Arbeitszeile
          const exists = await db.entries.get(date);
          if (exists) { skipped++; continue; }
          const hours = parseFloat((cols[hoursIdx] || '0').replace(',', '.')) || 0;
          const tips = parseFloat((cols[tipsIdx] || '0').replace(',', '.')) || 0;
          ops.push({ date, actualHoursManual: hours, tips, note: note || '' });
        }

        if (ops.length) { await db.entries.bulkPut(ops); imported = ops.length; }
        if (leaveOps.length) { await db.leave.bulkPut(leaveOps); importedLeave = leaveOps.length; }

        if (!imported && !importedLeave) {
          alert(skipped ? `${skipped} Zeilen übersprungen (Datum existiert schon).` : 'Keine gültigen Zeilen gefunden.');
          return;
        }
        const msg = `${imported} Schichten, ${importedLeave} Urlaubstage importiert, ${skipped} übersprungen`;
        if (statusEl) statusEl.textContent = msg + '.';
        showToast(msg);
        await loadData();
      } catch (err) {
        alert('CSV-Import fehlgeschlagen: ' + (err.message || err));
      }
      event.target.value = '';
    }
    window.importCSV = importCSV;

    // ── Toast ──
    let toastTimer = null;
    function showToast(msg, duration) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('visible'), duration || 2200);
    }

    // ── Action Sheet ──
    let sheetCallback = null;
    function showSheet(title, buttons) {
      const overlay = document.getElementById('sheetOverlay');
      const sheet = document.getElementById('sheet');
      const body = document.getElementById('sheetBody');
      body.innerHTML = buttons.map((b, i) =>
        `<button class="sheet-btn${b.danger ? ' danger' : ''}" onclick="sheetAction(${i})">${b.label}</button>`
      ).join('');
      overlay.classList.add('open');
      sheet.classList.add('open');
      sheetCallback = (i) => { hideSheet(); if (buttons[i]?.action) buttons[i].action(); };
    }
    function sheetAction(i) {
      if (sheetCallback) sheetCallback(i);
    }
    function hideSheet() {
      document.getElementById('sheetOverlay').classList.remove('open');
      document.getElementById('sheet').classList.remove('open');
      sheetCallback = null;
    }
    document.getElementById('sheetOverlay').addEventListener('click', hideSheet);

    // ── Keyboard accessory ──
    let activeInput = null;
    document.querySelectorAll('input[inputmode="decimal"]').forEach(el => {
      el.addEventListener('focus', () => {
        activeInput = el;
        document.getElementById('inputAccessory').classList.add('visible');
      });
      el.addEventListener('blur', () => {
        setTimeout(() => {
          if (!activeInput) document.getElementById('inputAccessory').classList.remove('visible');
        }, 200);
      });
    });
    function dismissKeyboard() {
      if (activeInput) { activeInput.blur(); activeInput = null; }
      document.getElementById('inputAccessory').classList.remove('visible');
    }

    // ── Theme / Dark Mode ──
    function initTheme() {
      const stored = localStorage.getItem(THEME_KEY);
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(stored || (prefersDark ? 'dark' : 'light'));
    }
    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const icon = document.getElementById('themeIcon');
      const label = document.getElementById('themeLabel');
      if (theme === 'dark') {
        icon.textContent = '🌙';
        label.textContent = 'Dunkel';
      } else {
        icon.textContent = '☀️';
        label.textContent = 'Hell';
      }
      localStorage.setItem(THEME_KEY, theme);
    }
    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    }
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

    // ── State Persistence ──
    function persistState() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeTab: state.activeTab, trendMode: state.trendMode,
        trendWeekKey: state.trendWeekKey, trendMonth: state.trendMonth
      })); } catch (_) {}
    }
    function restoreState() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved) {
          if (saved.trendMode) state.trendMode = saved.trendMode;
          if (saved.trendWeekKey) state.trendWeekKey = saved.trendWeekKey;
          if (saved.trendMonth) state.trendMonth = saved.trendMonth;
          if (saved.activeTab) state.activeTab = saved.activeTab;
        }
      } catch (_) {}
    }

    const tabButtons = [...document.querySelectorAll('.tab-btn')];
    const form = {
      date: document.getElementById('date'),
      hours: document.getElementById('hours'),
      tips: document.getElementById('tipsInput'),
      note: document.getElementById('note'),
    };
    const trendControls = {
      mode: document.getElementById('trendMode'),
      week: document.getElementById('trendWeek'),
      month: document.getElementById('trendMonth'),
      weekWrap: document.getElementById('trendWeekWrap'),
      monthWrap: document.getElementById('trendMonthWrap'),
    };

    const eur = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
    const hrs = value => `${(Number(value) || 0).toFixed(2).replace('.', ',')} h`;
    const dateFmt = value => value ? new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value + 'T12:00:00')) : '—';
    const compactDate = value => value ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(new Date(value + 'T12:00:00')) : '—';
    const weekdayName = value => value ? new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(new Date(value + 'T12:00:00')) : '';

    function isoWeekInfo(dateStr) {
      const date = new Date(dateStr + 'T12:00:00');
      const origYear = date.getFullYear();
      const day = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - day + 3);
      const firstThursday = new Date(date.getFullYear(), 0, 4);
      const firstDay = (firstThursday.getDay() + 6) % 7;
      firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
      const week = 1 + Math.round((date - firstThursday) / 604800000);
      return { year: origYear, week, label: `KW${week}` };
    }

    function normalizeRow(row) {
      const hours = Number(row.actualHoursManual ?? row.hours ?? 0) || 0;
      const tips = Number(row.tips ?? 0) || 0;
      const note = row.note || weekdayName(row.date);
      const week = row.date ? isoWeekInfo(row.date) : { year: '', week: '', label: '—' };
      return { date: row.date, actualHoursManual: hours.toFixed(2), tips: tips.toFixed(2), note, week };
    }

    // ─── weekMeta helper: provides week info compatible with legacy code ───
    function weekMeta(date) {
      if (!date) return { year: '', week: '', label: '—' };
      return isoWeekInfo(date);
    }

    function setStatus(text, cls = '') {
      const el = document.getElementById('status');
      el.textContent = text;
      el.className = `status ${cls}`.trim();
    }

    // ── Tab activation ──
    function activateTab(targetId) {
      document.querySelectorAll('.tab-panel').forEach(panel =>
        panel.classList.toggle('active', panel.id === targetId)
      );
      tabButtons.forEach(button =>
        button.classList.toggle('active', button.dataset.target === targetId)
      );
      state.activeTab = targetId;
      persistState();
      // Kalender erst beim Öffnen des Tabs rendern (spart Arbeit und ist immer aktuell)
      if (targetId === 'calendar') { renderCalendar(); }
      // Trinkgeld-Tab rendern
      if (targetId === 'tip') { renderTipTab(); }
      // Chart neu zeichnen, wenn der Übersicht-Tab sichtbar wird (SVG braucht Layout)
      if (targetId === 'stats') {
        setTimeout(() => { try { renderTrendChart(getTrendRows([...state.rows].sort((a,b)=>a.date.localeCompare(b.date)))); } catch(e){} }, 60);
      }
    }

    function getTrendRows(rows) {
      if (!rows.length) return rows;
      const latest = rows[rows.length - 1];
      if (state.trendMode === 'week')
        return rows.filter(row => row.week.year === latest.week.year && row.week.week === latest.week.week);
      if (state.trendMode === 'kw') {
        const key = state.trendWeekKey || `${latest.week.year}-${latest.week.week}`;
        return rows.filter(row => `${row.week.year}-${row.week.week}` === key);
      }
      if (state.trendMode === 'month') {
        const month = state.trendMonth || latest.date.slice(0, 7);
        return rows.filter(row => row.date.startsWith(month));
      }
      return rows;
    }

    function syncTrendControls(rows, groups) {
      trendControls.mode.value = state.trendMode;
      if (!state.trendMonth && rows.length) state.trendMonth = rows[rows.length - 1].date.slice(0, 7);
      if (!state.trendWeekKey && groups.length) {
        const latestGroup = groups[groups.length - 1];
        state.trendWeekKey = `${latestGroup.year}-${latestGroup.week}`;
      }
      trendControls.week.innerHTML = groups.map(group => {
        const key = `${group.year}-${group.week}`;
        return `<option value="${key}">${group.label} · ${group.year}</option>`;
      }).join('');
      trendControls.week.value = state.trendWeekKey;
      trendControls.month.value = state.trendMonth;
      trendControls.weekWrap.style.display = state.trendMode === 'kw' ? '' : 'none';
      trendControls.monthWrap.style.display = state.trendMode === 'month' ? '' : 'none';
    }

    // (Prognose entfernt — auf Wunsch)

    function renderStats(rows, groups) {
      const totalHours = rows.reduce((sum, row) => sum + Number(row.actualHoursManual), 0);
      const totalTips = rows.reduce((sum, row) => sum + Number(row.tips), 0);
      const avgTipsHour = totalHours ? totalTips / totalHours : 0;
      const currentWeek = rows.length ? rows[rows.length - 1].week.label : '—';
      const currentWeekRows = rows.filter(row => row.week.label === currentWeek);
      const currentWeekHours = currentWeekRows.reduce((sum, row) => sum + Number(row.actualHoursManual), 0);
      const currentWeekTips = currentWeekRows.reduce((sum, row) => sum + Number(row.tips), 0);
      const bestWeek = groups.reduce((best, group) => group.tips > (best?.tips ?? -1) ? group : best, null);

      // Overview tab: Gesamt + Woche + Letzter Eintrag
      const ovStats = document.getElementById('overviewStats');
      if (ovStats) ovStats.innerHTML = [
        ['Stunden gesamt', hrs(totalHours), 'Alle gespeicherten Schichten'],
        ['Trinkgeld gesamt', eur(totalTips), 'Sauber aufsummiert'],
        ['Ø Trinkgeld pro Stunde', eur(avgTipsHour), 'Hilft beim Einordnen'],
        ['Beste Woche', bestWeek ? `${bestWeek.label} · ${eur(bestWeek.tips)}` : '—', 'Stärkste KW bisher'],
      ].map(([label, value, hint]) =>
        `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`
      ).join('');

      const wf = document.getElementById('weekFocus');
      if (wf) wf.innerHTML = [
        ['Aktuelle KW', currentWeek, 'Die neueste Kalenderwoche'],
        ['Stunden', hrs(currentWeekHours), 'In dieser Woche erfasst'],
        ['Trinkgeld', eur(currentWeekTips), 'Für diese Woche gesamt'],
        ['Ø pro Stunde', eur(currentWeekHours ? currentWeekTips / currentWeekHours : 0), 'Diese Woche'],
      ].map(([label, value, hint]) =>
        `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`
      ).join('');

      // Analysis tab: Kennzahlen
      const as = document.getElementById('analysisStats');
      if (as) as.innerHTML = [
        ['Einträge', String(rows.length), 'Anzahl gespeicherter Schichten'],
        ['Wochen', String(groups.length), 'Kalenderwochen mit Daten'],
        ['Bester Tag', rows.reduce((best, row) => Number(row.tips) > (Number(best?.tips) || -1) ? row : best, null)
          ? `${rows.reduce((best, row) => Number(row.tips) > (Number(best?.tips) || -1) ? row : best, null).week.label} · ${eur(rows.reduce((best, row) => Number(row.tips) > (Number(best?.tips) || -1) ? row : best, null).tips)}`
          : '—', 'Höchstes Trinkgeld an einem Tag'],
        ['Längste Schicht', rows.reduce((best, row) => Number(row.actualHoursManual) > (Number(best?.actualHoursManual) || -1) ? row : best, null)
          ? hrs(rows.reduce((best, row) => Number(row.actualHoursManual) > (Number(best?.actualHoursManual) || -1) ? row : best, null).actualHoursManual)
          : '—', 'Maximale Dauer'],
      ].map(([label, value, hint]) =>
        `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`
      ).join('');

      // Overview tab: Letzter Eintrag
      const lsc = document.getElementById('lastShiftCard');
      if (lsc) {
        const last = rows[rows.length - 1];
        lsc.innerHTML = last
          ? `<div class="metric"><div class="label">${dateFmt(last.date)} · ${last.week.label}</div><div class="value">${hrs(last.actualHoursManual)}</div><div class="hint">${eur(last.tips)} · ${last.note || 'Ohne Notiz'}</div></div>`
          : `<div class="metric"><div class="label">Noch nichts drin</div><div class="value">—</div><div class="hint">Sobald du eine Schicht einträgst, taucht sie hier auf.</div></div>`;
      }
    }

    // ═══════════════════════════════════════
    //  Urlaubs-Vergütung (Chef-Regel: Ø der letzten 30 Tage an Arbeitstagen)
    // ═══════════════════════════════════════

    // Durchschnittliche Stunden pro ARBEITSTAG der letzten `days` Tage vor `refDate`.
    // Nur Tage mit tatsächlichem Eintrag zählen (Arbeitstage!).
    function avgHoursPerWorkday(rows, refDate, days) {
      const ref = new Date(refDate + 'T12:00:00');
      const from = new Date(ref.getTime() - days * 86400000);
      const inWindow = rows.filter(r => {
        const d = new Date(r.date + 'T12:00:00');
        return d >= from && d <= ref;
      });
      if (!inWindow.length) return 0;
      const total = inWindow.reduce((s, r) => s + (Number(r.actualHoursManual) || 0), 0);
      return total / inWindow.length;
    }

    // Alle Urlaubstage, gruppiert nach Monat. Cache, damit render() nicht dauernd awaitet.
    let leaveCache = [];

    async function loadLeaveCache() {
      try { leaveCache = await db.leave.toArray(); }
      catch (e) { leaveCache = []; }
      return leaveCache;
    }

    // Für einen Monat: Urlaubstage + angerechnete Stunden (nach Chef-Regel)
    function leaveForMonth(monthKey, rows) {
      const leaves = leaveCache.filter(l => l.date.startsWith(monthKey));
      let paidHours = 0, unpaidCount = 0;
      const details = [];

      for (const l of leaves) {
        if (l.type === 'paid') {
          // Chef-Regel: Ø der letzten 30 Tage an Arbeitstagen, bezogen auf diesen Tag
          const avg = avgHoursPerWorkday(rows, l.date, 30);
          paidHours += avg;
          details.push({ date: l.date, type: 'paid', hours: avg });
        } else {
          unpaidCount++;
          details.push({ date: l.date, type: 'unpaid', hours: 0 });
        }
      }
      return { count: leaves.length, paidCount: leaves.length - unpaidCount, unpaidCount, paidHours, details };
    }

    function renderMonthlyEarnings(rows) {
      const months = new Map();
      for (const row of rows) {
        const month = row.date.slice(0, 7);
        const h = Number(row.actualHoursManual) || 0;
        const t = Number(row.tips) || 0;
        const prev = months.get(month) || { hours: 0, tips: 0 };
        months.set(month, { hours: prev.hours + h, tips: prev.tips + t });
      }
      // Monate, in denen NUR Urlaub steht, müssen auch auftauchen
      for (const l of leaveCache) {
        const month = l.date.slice(0, 7);
        if (!months.has(month)) months.set(month, { hours: 0, tips: 0 });
      }

      // Urlaubsstunden pro Monat einmal berechnen und an die Monatsdaten hängen
      for (const m of months.keys()) {
        const info = leaveForMonth(m, rows);
        const d = months.get(m);
        d.leaveCount = info.count;
        d.leavePaid = info.paidCount;
        d.leaveUnpaid = info.unpaidCount;
        d.leaveHours = info.paidHours;
      }

      const sorted = [...months.keys()].sort();
      const eurFmt = v => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
      const monthName = m => {
        const d = new Date(m + '-15T12:00:00');
        return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(d);
      };

      document.getElementById('overviewMonthlyBody').innerHTML = sorted.slice().reverse().map(m => {
        const d = months.get(m);
        const hWork = d.hours;
        const hLeave = d.leaveHours || 0;
        const h = hWork + hLeave;                 // Gesamtstunden inkl. bezahltem Urlaub
        const t = d.tips;
        const brutto = h * 13.90;
        const nettoEst = brutto * 0.75;
        const avgRate = hWork ? t / hWork : 0;
        const gesamt = nettoEst + t;
        const sv = localStorage.getItem('netto_' + m) || '';
        const istNetto = sv ? (Number(sv.replace(',', '.')) || 0) : 0;
        const diff = istNetto ? (istNetto - nettoEst) : 0;
        const diffClass = diff > 0 ? 'color:#30d158' : (diff < 0 ? 'color:#ff453a' : '');

        // Urlaubs-Spalte: "Ø h × N Tage"
        let leaveCell = '—';
        if (d.leaveCount) {
          const parts = [];
          if (d.leavePaid) parts.push(`${d.leavePaid}×bez.`);
          if (d.leaveUnpaid) parts.push(`${d.leaveUnpaid}×unb.`);
          leaveCell = `${parts.join(' + ')}<br><span style="font-size:11px;color:var(--muted);">${hrs(hLeave)}</span>`;
        }

        return '<tr><td>' + monthName(m) + '</td>'
          + '<td class="right">' + hrs(hWork) + (hLeave ? '<br><span style="font-size:11px;color:#0a84ff;">+' + hrs(hLeave) + '</span>' : '') + '</td>'
          + '<td class="right">' + leaveCell + '</td>'
          + '<td class="right">' + eurFmt(t) + '</td>'
          + '<td class="right">' + eurFmt(avgRate) + '</td>'
          + '<td class="right">' + eurFmt(brutto) + '</td>'
          + '<td class="right">' + eurFmt(nettoEst) + '</td>'
          + '<td class="right"><input type="text" inputmode="decimal" style="min-height:unset;padding:4px 6px;width:80px;font-size:13px;text-align:right;" placeholder="0" value="' + sv + '" onchange="localStorage.setItem(\'netto_\' + this.dataset.month, this.value);location.reload()" data-month="' + m + '" /></td>'
          + '<td class="right" style="' + diffClass + '">' + (istNetto ? eurFmt(diff) : '—') + '</td>'
          + '<td class="right">' + eurFmt(gesamt) + '</td>'
        + '</tr>';
      }).join('') + yearRow(sorted, months, eurFmt);
    }

    function yearRow(sorted, months, eurFmt) {
      let totHours = 0, totTips = 0, totBrutto = 0, totNetto = 0, totGesamt = 0, totLeave = 0, totLeaveDays = 0;
      for (const m of sorted) {
        const d = months.get(m);
        const h = d.hours + (d.leaveHours || 0);
        totHours += h;
        totTips += d.tips;
        totLeave += (d.leaveHours || 0);
        totLeaveDays += (d.leaveCount || 0);
        const b = h * 13.90;
        totBrutto += b;
        const n = b * 0.75;
        totNetto += n;
        totGesamt += n + d.tips;
      }
      return '<tr style="font-weight:700;border-top:2px solid var(--line)"><td>📅 Gesamtjahr</td>'
        + '<td class="right">' + hrs(totHours) + (totLeave ? '<br><span style="font-size:11px;color:#0a84ff;">+' + hrs(totLeave) + '</span>' : '') + '</td>'
        + '<td class="right">' + (totLeaveDays ? totLeaveDays + ' Tage' : '—') + '</td>'
        + '<td class="right">' + eurFmt(totTips) + '</td>'
        + '<td class="right">' + eurFmt(totHours ? totTips / totHours : 0) + '</td>'
        + '<td class="right">' + eurFmt(totBrutto) + '</td>'
        + '<td class="right">' + eurFmt(totNetto) + '</td>'
        + '<td class="right">—</td><td class="right">—</td>'
        + '<td class="right">' + eurFmt(totGesamt) + '</td></tr>';
    }

    function renderTrendChart(trendRows) {
      const chart = document.getElementById('trendChart');
      if (!trendRows.length) {
        chart.innerHTML = '';
        return;
      }

      const W = 400, H = 400;
      const pad = { top: 20, right: 34, bottom: 36, left: 34 };
      const innerW = W - pad.left - pad.right;
      const innerH = H - pad.top - pad.bottom;

      // Dynamische Max-Werte
      const maxHr = Math.max(12, Math.ceil(Math.max(...trendRows.map(r => Number(r.actualHoursManual) || 0)) / 3) * 3);
      const maxTip = Math.max(30, Math.ceil(Math.max(...trendRows.map(r => Number(r.tips) || 0)) / 10) * 10);

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.08)';
      const textColor = isDark ? '#98989d' : '#8e8e93';
      const hourColor = '#0a84ff';
      const tipColor = '#ffd60a';

      const yHr = v => pad.top + innerH - ((Number(v) || 0) / maxHr) * innerH;
      const yTip = v => pad.top + innerH - ((Number(v) || 0) / maxTip) * innerH;

      const n = trendRows.length;
      const stepX = innerW / Math.max(n - 1, 1);
      const getX = i => pad.left + i * stepX;

      // Grid: nur horizontal, dezent gestrichelt
      const hrSteps = maxHr / 3;
      const tipSteps = maxTip / 10;
      const gridLines = [];
      for (let v = 0; v <= maxHr; v += hrSteps) {
        gridLines.push(`<line x1="${pad.left}" y1="${yHr(v)}" x2="${W - pad.right}" y2="${yHr(v)}" stroke="${gridColor}" stroke-dasharray="3,3" />`);
      }

      // Y-Links (Stunden)
      const leftLabels = [];
      for (let v = 0; v <= maxHr; v += hrSteps) {
        leftLabels.push(`<text x="${pad.left - 6}" y="${yHr(v) + 5}" fill="${textColor}" font-size="16" font-family="Inter,system-ui,-apple-system,sans-serif" text-anchor="end">${v}h</text>`);
      }

      // Y-Rechts (Trinkgeld)
      const rightLabels = [];
      for (let v = 0; v <= maxTip; v += tipSteps) {
        rightLabels.push(`<text x="${W - pad.right + 6}" y="${yTip(v) + 5}" fill="${textColor}" font-size="16" font-family="Inter,system-ui,-apple-system,sans-serif" text-anchor="start">${v}€</text>`);
      }

      /* Kurvenverlauf: bewusst zurückhaltend, damit die Linie die echten Werte zeigt.
       *
       * Vorher: Catmull-Rom mit Kontrollpunkten aus den NACHBARN (p0, p3) und Faktor 1/12.
       * Problem: bei einem Ausreißer zog die Kurve über die Nachbarpunkte hinaus —
       * sie lief also über Werte, die es nie gab ("extrapoliert").
       *
       * Jetzt: monotone kubische Interpolation (Fritsch-Carlson), wie sie auch
       * Diagramm-Bibliotheken für Messwerte verwenden. Die Steigung wird so begrenzt,
       * dass zwischen zwei Punkten nie ein Wert entsteht, der außerhalb der beiden
       * liegt. Damit schwingt nichts mehr über und die Kurve bleibt an der Realität.
       */
      function buildSmoothPath(rows, getVal, yFn) {
        const pts = rows.map((r, i) => ({ x: getX(i), y: yFn(getVal(r)) }));

        if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
        if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

        // Steigungen zwischen den Punkten (Sekanten)
        const dx = [], dy = [], slope = [];
        for (let i = 0; i < pts.length - 1; i++) {
          dx[i] = pts[i + 1].x - pts[i].x;
          dy[i] = pts[i + 1].y - pts[i].y;
          slope[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
        }

        // Tangenten nach Fritsch-Carlson: begrenzt, damit kein Überschwingen entsteht
        const tan = new Array(pts.length);
        tan[0] = slope[0];
        tan[pts.length - 1] = slope[slope.length - 1];
        for (let i = 1; i < pts.length - 1; i++) {
          if (slope[i - 1] * slope[i] <= 0) {
            tan[i] = 0;                        // Richtungswechsel → waagerecht (Extrempunkt)
          } else {
            const m = (slope[i - 1] + slope[i]) / 2;
            const limit = 3 * Math.min(Math.abs(slope[i - 1]), Math.abs(slope[i]));
            tan[i] = Math.sign(m) * Math.min(Math.abs(m), limit);
          }
        }

        let d = `M${pts[0].x},${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
          const h = dx[i] / 3;
          const cp1x = pts[i].x + h;
          const cp1y = pts[i].y + tan[i] * h;
          const cp2x = pts[i + 1].x - h;
          const cp2y = pts[i + 1].y - tan[i + 1] * h;
          d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${pts[i + 1].x},${pts[i + 1].y}`;
        }
        return d;
      }

      const hourPath = buildSmoothPath(trendRows, r => Number(r.actualHoursManual) || 0, yHr);
      const tipPath = buildSmoothPath(trendRows, r => Number(r.tips) || 0, yTip);

      // Fläche unter den Linien
      const hourArea = `M${getX(0)},${yHr(0)} L${getX(0)},${yHr(0)} ` + hourPath.slice(1) + ` L${getX(n-1)},${yHr(0)} Z`;
      const tipArea = `M${getX(0)},${yTip(0)} L${getX(0)},${yTip(0)} ` + tipPath.slice(1) + ` L${getX(n-1)},${yTip(0)} Z`;

      // X-Labels: max 6, Schrift wie Card-Labels (13px)
      const labelInterval = Math.max(1, Math.floor(n / 6));
      const xLabels = [];
      for (let i = 0; i < n; i++) {
        if (i % labelInterval === 0 || i === n - 1) {
          xLabels.push(`<text x="${getX(i)}" y="${H - 6}" fill="${textColor}" font-size="16" font-family="Inter,system-ui,-apple-system,sans-serif" text-anchor="middle">${compactDate(trendRows[i].date)}</text>`);
        }
      }

      chart.innerHTML = `
        <defs>
          <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${hourColor}" stop-opacity="0.28" />
            <stop offset="100%" stop-color="${hourColor}" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="tipGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${tipColor}" stop-opacity="0.22" />
            <stop offset="100%" stop-color="${tipColor}" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${gridLines.join('')}
        <path d="${hourArea}" fill="url(#hourGrad)" stroke="none" />
        <path d="${tipArea}" fill="url(#tipGrad)" stroke="none" />
        <path d="${hourPath}" fill="none" stroke="${hourColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <path d="${tipPath}" fill="none" stroke="${tipColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <line id="hoverLine" x1="0" y1="${pad.top}" x2="0" y2="${H - pad.bottom}" stroke="rgba(255,255,255,0.3)" stroke-width="1" stroke-dasharray="4,4" style="display:none" />
      `;

      // Hover/Touch: Hit-Areas + Tooltip + Cursor-Linie
      chart.querySelectorAll('.hit-area').forEach(el => el.remove());
      const tip = document.getElementById('barTooltip');
      const hLine = document.getElementById('hoverLine');
      let activeIdx = -1;

      function showTip(i) {
        if (i === activeIdx) return;
        activeIdx = i;
        const r = trendRows[i];
        tip.style.display = 'block';
        hLine.style.display = 'block';
        document.getElementById('btDate').textContent = compactDate(r.date);
        document.getElementById('btHours').textContent = hrs(Number(r.actualHoursManual) || 0);
        document.getElementById('btTips').textContent = eur(Number(r.tips) || 0);
      }
      function hideTip() { tip.style.display = 'none'; hLine.style.display = 'none'; activeIdx = -1; }

      // Mouse hover
      trendRows.forEach((r, i) => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', getX(i) - stepX / 2 + 2);
        rect.setAttribute('y', pad.top);
        rect.setAttribute('width', stepX - 2);
        rect.setAttribute('height', innerH);
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('class', 'hit-area');
        rect.addEventListener('mouseenter', () => showTip(i));
        rect.addEventListener('mousemove', (e) => {
          const sr = chart.getBoundingClientRect();
          const svgX = (e.clientX - sr.left) / sr.width * W;
          hLine.setAttribute('x1', svgX);
          hLine.setAttribute('x2', svgX);
          tip.style.left = (e.clientX - sr.left - tip.offsetWidth / 2) + 'px';
          tip.style.top = (e.clientY - sr.top - tip.offsetHeight - 150) + 'px';
        });
        rect.addEventListener('mouseleave', hideTip);
        chart.appendChild(rect);
      });

      // Touch: finger über Chart wischen
      chart.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const sr = chart.getBoundingClientRect();
        const svgX = (touch.clientX - sr.left) / sr.width * W;
        const rx = svgX;
        const idx = Math.round((rx - pad.left) / stepX);
        if (idx >= 0 && idx < n) {
          showTip(idx);
          hLine.setAttribute('x1', svgX);
          hLine.setAttribute('x2', svgX);
          tip.style.left = (touch.clientX - sr.left - tip.offsetWidth / 2) + 'px';
          tip.style.top = (touch.clientY - sr.top - tip.offsetHeight - 150) + 'px';
        }
      }, { passive: false });
      chart.addEventListener('touchend', hideTip);
      chart.addEventListener('touchcancel', hideTip);
    }


    function render() {
      const rows = [...state.rows].sort((a, b) => a.date.localeCompare(b.date));
      const grouped = new Map();
      for (const row of rows) {
        const key = `${row.week.year}-KW${row.week.week}`;
        if (!grouped.has(key)) grouped.set(key, { ...row.week, rows: [] });
        grouped.get(key).rows.push(row);
      }
      const groups = [...grouped.values()].sort((a, b) => a.year !== b.year ? a.year - b.year : a.week - b.week).map(group => {
        const hours = group.rows.reduce((sum, row) => sum + Number(row.actualHoursManual), 0);
        const tips = group.rows.reduce((sum, row) => sum + Number(row.tips), 0);
        return { ...group, hours, tips, rate: hours ? tips / hours : 0 };
      });

      syncTrendControls(rows, groups);
      renderStats(rows, groups);
      renderMonthlyEarnings(rows);
      renderTrendChart(getTrendRows(rows));

      // Week comparison bars
      const maxWeekHours = Math.max(...groups.map(group => group.hours), 0) || 1;
      const maxWeekTips = Math.max(...groups.map(group => group.tips), 0) || 1;
      document.getElementById('weekBars').innerHTML = groups.slice().reverse().map(group =>
        `<div class="bar-row">
          <div class="bar-label">${group.label}</div>
          <div>
            <div class="bar-track" title="${hrs(group.hours)}"><div class="bar-fill" style="width:${(group.hours / maxWeekHours) * 100}%"></div></div>
            <div class="bar-track" style="margin-top:6px;" title="${eur(group.tips)}"><div class="bar-fill tips" style="width:${(group.tips / maxWeekTips) * 100}%"></div></div>
          </div>
          <div class="bar-value">${hrs(group.hours)}<br>${eur(group.tips)}</div>
        </div>`
      ).join('') || '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Noch keine Wochen</div></div>';

      // Day tiles + Week cards + Prognose — entfernt (auf Wunsch), ersetzt durch Kalender-Tab

      // Table
      document.getElementById('tableBody').innerHTML = rows.slice().reverse().map(row =>
        `<tr>
          <td>${row.week.label}</td>
          <td>${weekdayName(row.date)}</td>
          <td>${dateFmt(row.date)}</td>
          <td class="right">${hrs(row.actualHoursManual)}</td>
          <td class="right">${eur(row.tips)}</td>
          <td>${row.note || '—'}</td>
          <td>
            <div class="row-actions">
              <button class="btn-secondary" type="button" onclick="editRow('${row.date}')">Bearbeiten</button>
              <button class="warn" type="button" onclick="confirmDelete('${row.date}')">Löschen</button>
            </div>
          </td>
        </tr>`
      ).join('') || '<tr><td colspan="7" class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Noch nüscht drin.</div><div class="empty-sub">Leg los und trag deine erste Schicht ein.</div></td></tr>';

      // Hide skeleton, show content
      const ovSk = document.getElementById('overviewSkeleton');
      const ovCt = document.getElementById('overviewContent');
      if (ovSk) ovSk.style.display = 'none';
      if (ovCt) ovCt.style.display = 'block';

      renderCalendar();
    }

    // ═══════════════════════════════════════
    //  Kalender + Urlaub
    // ═══════════════════════════════════════
    const calState = { year: new Date().getFullYear(), month: new Date().getMonth() };

    const LEAVE_LABEL = { paid: 'Urlaub (bezahlt)', unpaid: 'Urlaub (unbezahlt)' };
    const LEAVE_SHORT = { paid: 'Urlaub', unpaid: 'unbez.' };
    const LEAVE_CLASS = { paid: 'leave-paid', unpaid: 'leave-unpaid' };

    function pad2(n) { return String(n).padStart(2, '0'); }

    async function renderCalendar() {
      const grid = document.getElementById('calGrid');
      const title = document.getElementById('calTitle');
      if (!grid) return;

      const { year, month } = calState;
      title.textContent = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })
        .format(new Date(year, month, 1));

      const leaveAll = await db.leave.toArray().catch(() => []);
      const leaveMap = new Map(leaveAll.map(l => [l.date, l]));
      const entryMap = new Map(state.rows.map(r => [r.date, r]));

      const first = new Date(year, month, 1);
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const lead = (first.getDay() + 6) % 7;   // Montag = 0
      const todayIso = new Date().toISOString().slice(0, 10);

      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<div class="cal-cell empty"></div>';

      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${year}-${pad2(month + 1)}-${pad2(d)}`;
        const entry = entryMap.get(iso);
        const leave = leaveMap.get(iso);
        const cls = ['cal-cell'];
        if (iso === todayIso) cls.push('today');
        if (leave) cls.push(LEAVE_CLASS[leave.type] || 'leave-paid');
        else if (entry) cls.push('work');

        let sub = '';
        if (leave) sub = LEAVE_SHORT[leave.type] || 'Urlaub';
        else if (entry) sub = (+entry.actualHoursManual).toFixed(1).replace('.', ',') + 'h';

        cells += `<button class="${cls.join(' ')}" type="button" onclick="openCalDay('${iso}')">
          <span class="cal-num">${d}</span>
          ${sub ? `<span class="cal-sub">${sub}</span>` : ''}
        </button>`;
      }
      grid.innerHTML = cells;

      // Monatszusammenfassung
      const monthPrefix = `${year}-${pad2(month + 1)}`;
      const mRows = state.rows.filter(r => r.date.startsWith(monthPrefix));
      const mHours = mRows.reduce((s, r) => s + Number(r.actualHoursManual), 0);
      const mTips = mRows.reduce((s, r) => s + Number(r.tips), 0);
      const mLeave = leaveAll.filter(l => l.date.startsWith(monthPrefix));
      const paid = mLeave.filter(l => l.type === 'paid').length;
      const unpaid = mLeave.filter(l => l.type === 'unpaid').length;

      const cs = document.getElementById('calSummary');
      if (cs) cs.innerHTML = [
        ['Arbeitstage', String(mRows.length), 'Einträge in diesem Monat'],
        ['Stunden', hrs(mHours), 'Diesen Monat gearbeitet'],
        ['Trinkgeld', eur(mTips), 'Diesen Monat gesammelt'],
        ['Brutto', eur(mHours * HOURLY_RATE), `${HOURLY_RATE.toFixed(2).replace('.', ',')} €/h`],
      ].map(([l, v, h]) =>
        `<div class="metric"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`
      ).join('');

      // Urlaubs-Kennzahlen (über alles)
      const allLeave = leaveAll;
      const totalPaid = allLeave.filter(l => l.type === 'paid').length;
      const totalUnpaid = allLeave.filter(l => l.type === 'unpaid').length;
      const ls = document.getElementById('leaveStats');
      if (ls) ls.innerHTML = [
        ['Urlaub bezahlt', String(totalPaid), 'Tage mit Bezahlung'],
        ['Urlaub unbezahlt', String(totalUnpaid), 'Tage ohne Bezahlung'],
        ['Urlaub gesamt', String(totalPaid + totalUnpaid), 'Alle erfassten Urlaubstage'],
        ['Resturlaub (30 Tage)', String(Math.max(0, 30 - totalPaid)), 'Bei 30 Tagen Jahresanspruch'],
      ].map(([l, v, h]) =>
        `<div class="metric"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`
      ).join('');

      // Urlaubs-Tabelle
      const ltb = document.getElementById('leaveTableBody');
      if (ltb) {
        const rowsLeave = [...allLeave].sort((a, b) => b.date.localeCompare(a.date));
        ltb.innerHTML = rowsLeave.map(l =>
          `<tr>
            <td>${dateFmt(l.date)}</td>
            <td>${weekdayName(l.date)}</td>
            <td>${LEAVE_LABEL[l.type] || l.type}</td>
            <td><button class="warn" type="button" onclick="removeLeave('${l.date}')">Entfernen</button></td>
          </tr>`
        ).join('') || '<tr><td colspan="4" class="empty-state"><div class="empty-icon">🏖️</div><div class="empty-title">Noch kein Urlaub eingetragen.</div><div class="empty-sub">Tippe einen Tag im Kalender an.</div></td></tr>';
      }
    }

    // Tag im Kalender angetippt → Action Sheet
    window.openCalDay = async function(iso) {
      const entry = state.rows.find(r => r.date === iso);
      const leave = await db.leave.get(iso).catch(() => null);
      const label = `${dateFmt(iso)}${leave ? ' · ' + (LEAVE_LABEL[leave.type] || '') : ''}`;

      const buttons = [];

      if (leave) {
        buttons.push({
          label: leave.type === 'paid' ? '→ auf unbezahlt umstellen' : '→ auf bezahlt umstellen',
          action: () => setLeave(iso, leave.type === 'paid' ? 'unpaid' : 'paid'),
        });
        buttons.push({ label: 'Urlaub entfernen', danger: true, action: () => removeLeave(iso) });
      } else {
        buttons.push({ label: '🏖️ Urlaub bezahlt', action: () => setLeave(iso, 'paid') });
        buttons.push({ label: '🏖️ Urlaub unbezahlt', action: () => setLeave(iso, 'unpaid') });
      }

      if (entry) {
        buttons.push({ label: `✏️ Schicht bearbeiten (${hrs(entry.actualHoursManual)})`, action: () => editRow(iso) });
        buttons.push({ label: '🗑️ Schicht löschen', danger: true, action: () => executeDelete(iso) });
      } else {
        buttons.push({ label: '📝 Schicht nachtragen', action: () => {
          resetForm();
          form.date.value = iso;
          activateTab('capture');
        }});
      }

      showSheet(label, buttons);
    };

    window.setLeave = async function(iso, type) {
      try {
        await db.leave.put({ date: iso, type, note: '' });
        showToast(LEAVE_LABEL[type] + ' gesetzt');
        await renderCalendar();
      } catch (err) {
        alert('Urlaub speichern fehlgeschlagen: ' + (err.message || err));
      }
    };

    window.removeLeave = async function(iso) {
      try {
        await db.leave.delete(iso);
        showToast('Urlaub entfernt');
        await renderCalendar();
      } catch (err) {
        alert('Urlaub löschen fehlgeschlagen: ' + (err.message || err));
      }
    };

    // Kalender-Navigation
    document.getElementById('calPrev')?.addEventListener('click', () => {
      calState.month--;
      if (calState.month < 0) { calState.month = 11; calState.year--; }
      renderCalendar();
    });
    document.getElementById('calNext')?.addEventListener('click', () => {
      calState.month++;
      if (calState.month > 11) { calState.month = 0; calState.year++; }
      renderCalendar();
    });

    // Accordion-Verhalten (Übersicht-Tab)
    document.querySelectorAll('.acc-head').forEach(head => {
      head.addEventListener('click', () => {
        const acc = head.closest('.acc');
        const wasOpen = acc.classList.contains('open');
        // Nur eines gleichzeitig offen halten? Nein — mehrere dürfen offen sein,
        // aber beim Öffnen eines neuen schließen wir die anderen NICHT (Nutzer behält Kontext).
        acc.classList.toggle('open', !wasOpen);
        // Charts brauchen nach dem Aufklappen ggf. ein Redraw
        if (!wasOpen) {
          const panel = acc.querySelector('.acc-body');
          if (panel && panel.querySelector('#trendChart')) {
            setTimeout(() => { try { renderTrendChart(getTrendRows([...state.rows].sort((a,b)=>a.date.localeCompare(b.date)))); } catch(e){} }, 120);
          }
        }
      });
    });

    // ═══════════════════════════════════════
    //  Trinkgeld per QR-Code / PayPal
    // ═══════════════════════════════════════
    const TIP_KEY = 'azt-tip';
    const TIP_AMOUNTS = [2, 3, 5, 10];
    let tipAmount = 0;   // 0 = kein Betrag vorgeschlagen

    function loadTipSettings() {
      try { return JSON.parse(localStorage.getItem(TIP_KEY) || '{}'); }
      catch (e) { return {}; }
    }

    function saveTipSettings() {
      const raw = (document.getElementById('tipPaypal').value || '').trim();
      const name = (document.getElementById('tipName').value || '').trim();
      const status = document.getElementById('tipSetupStatus');

      const link = normalizePaypal(raw);
      if (!link) {
        status.textContent = 'Bitte einen gültigen PayPal-Link eingeben (z. B. paypal.me/DeinName).';
        status.className = 'status error';
        return;
      }
      const data = { paypal: link, name: name };
      try { localStorage.setItem(TIP_KEY, JSON.stringify(data)); }
      catch (e) { status.textContent = 'Speichern fehlgeschlagen.'; status.className = 'status error'; return; }

      status.textContent = 'Gespeichert.';
      status.className = 'status ok';
      setTimeout(() => { status.textContent = ''; status.className = 'status'; }, 1500);
      renderTipTab();
    }
    window.saveTipSettings = saveTipSettings;

    // Akzeptiert "paypal.me/name", "@name", "name" oder eine volle URL
    function normalizePaypal(input) {
      if (!input) return '';
      let s = input.trim().replace(/^@/, '');
      if (/^https?:\/\//i.test(s)) {
        // volle URL — nur prüfen, dass paypal drinsteckt
        if (!/paypal\./i.test(s)) return '';
        return s;
      }
      s = s.replace(/^paypal\.me\//i, '').replace(/^www\./i, '');
      // falls jemand "paypal.me/xyz" ohne Protokoll eingibt
      if (/^paypal\.me$/i.test(s)) return '';
      if (!/^[A-Za-z0-9._-]+$/.test(s)) return '';
      return 'https://paypal.me/' + s;
    }

    // Link mit Betrag bauen
    function tipLink(amount) {
      const cfg = loadTipSettings();
      if (!cfg.paypal) return '';
      const base = cfg.paypal.replace(/\/$/, '');
      // paypal.me unterstützt /<betrag><währung> z. B. paypal.me/name/5EUR
      if (amount && /^https:\/\/paypal\.me\//i.test(base)) {
        return `${base}/${String(amount).replace('.', ',')}EUR`;
      }
      return base;
    }

    function editTipSettings() {
      document.getElementById('tipSetupCard').style.display = 'block';
      document.getElementById('tipQrCard').style.display = 'none';
      document.getElementById('tipStatsCard').style.display = 'none';
      const cfg = loadTipSettings();
      document.getElementById('tipPaypal').value = cfg.paypal || '';
      document.getElementById('tipName').value = cfg.name || '';
      document.getElementById('tipPaypal').focus();
    }
    window.editTipSettings = editTipSettings;

    function openTipInApp() {
      const link = tipLink(tipAmount);
      if (!link) return;
      window.open(link, '_system');
      try { window.location.href = link; } catch (e) {}
    }
    window.openTipInApp = openTipInApp;

    function setTipAmount(a) {
      tipAmount = a;
      renderTipTab();
    }
    window.setTipAmount = setTipAmount;

    function renderTipTab() {
      const cfg = loadTipSettings();
      const setup = document.getElementById('tipSetupCard');
      const qrCard = document.getElementById('tipQrCard');
      const statsCard = document.getElementById('tipStatsCard');

      if (!cfg.paypal) {
        setup.style.display = 'block';
        qrCard.style.display = 'none';
        statsCard.style.display = 'none';
        const pp = document.getElementById('tipPaypal');
        if (!pp.value) pp.value = '';
        return;
      }

      // Setup verstecken, QR zeigen
      setup.style.display = 'none';
      qrCard.style.display = 'block';
      statsCard.style.display = 'block';

      document.getElementById('tipQrHead').textContent =
        cfg.name ? `Trinkgeld für ${cfg.name}` : 'Trinkgeld geben';

      // Betrags-Buttons
      const wrap = document.getElementById('tipAmounts');
      wrap.innerHTML = TIP_AMOUNTS.map(a =>
        `<button class="tip-amt${a === tipAmount ? ' active' : ''}" type="button" onclick="setTipAmount(${a})">${a} €</button>`
      ).join('') +
      `<button class="tip-amt${tipAmount === 0 ? ' active' : ''}" type="button" onclick="setTipAmount(0)" style="grid-column:span 1;">frei</button>`;
      // "frei" soll die ganze Zeile füllen
      const freeBtn = wrap.lastElementChild;
      if (freeBtn) freeBtn.style.gridColumn = '1 / -1';

      // QR rendern
      const link = tipLink(tipAmount);
      const qrBox = document.getElementById('tipQr');
      try {
        const qr = qrcode(0, 'M');
        qr.addData(link);
        qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      } catch (e) {
        qrBox.innerHTML = '<div style="color:#c00;font-size:12px;padding:20px;text-align:center;">QR-Code konnte nicht erzeugt werden.</div>';
      }

      document.getElementById('tipQrCaption').innerHTML =
        (tipAmount ? `<strong>${tipAmount} € Trinkgeld</strong>` : 'Trinkgeld geben') +
        `<small>${link}</small>`;

      // Statistik aus den erfassten Daten
      const totalTips = state.rows.reduce((s, r) => s + Number(r.tips), 0);
      const days = state.rows.length;
      const ts = document.getElementById('tipStats');
      if (ts) ts.innerHTML = [
        ['Trinkgeld gesamt', eur(totalTips), 'In der App erfasst'],
        ['Ø pro Schicht', eur(days ? totalTips / days : 0), `${days} Schichten`],
        ['Bester Tag', state.rows.length
          ? eur(Math.max(...state.rows.map(r => Number(r.tips))))
          : '—', 'Höchstes Trinkgeld'],
        ['Ø pro Stunde', eur(
            (() => { const h = state.rows.reduce((s, r) => s + Number(r.actualHoursManual), 0);
                     return h ? totalTips / h : 0; })()
          ), 'Über alle Schichten'],
      ].map(([l, v, h]) =>
        `<div class="metric"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`
      ).join('');
    }
    window.renderTipTab = renderTipTab;

    function todayStr() { return new Date().toISOString().slice(0, 10); }

    function resetForm() {
      form.date.value = todayStr();
      form.hours.value = '';
      form.tips.value = '';
      form.note.value = '';
      state.editingDate = null;
      document.getElementById('saveBtn').textContent = 'Schicht speichern';
    }

    // ── Delete with iOS Action Sheet ──
    window.confirmDelete = function(date) {
      const row = state.rows.find(r => r.date === date);
      const label = row ? `${dateFmt(date)} · ${hrs(row.actualHoursManual)}` : date;
      showSheet(label, [
        { label: 'Eintrag löschen', danger: true, action: () => executeDelete(date) },
      ]);
    };
    async function executeDelete(date) {
      await db.entries.delete(date);
      await loadData();
      resetForm();
    }

    window.editRow = function(date) {
      const row = state.rows.find(entry => entry.date === date);
      if (!row) return;
      state.editingDate = date;
      form.date.value = row.date;
      form.hours.value = row.actualHoursManual;
      form.tips.value = row.tips;
      form.note.value = row.note;
      document.getElementById('saveBtn').textContent = 'Schicht aktualisieren';
      activateTab('capture');
      setStatus(`Bearbeite ${dateFmt(date)}`);
    };

    async function loadData() {
      const all = await db.entries.toArray();
      state.rows = all.map(r => ({
        ...r,
        actualHoursManual: r.actualHoursManual ?? r.hours ?? 0,
        tips: r.tips ?? 0,
        note: r.note ?? '',
        week: weekMeta(r.date),
      }));
      state.rows.sort((a, b) => a.date.localeCompare(b.date));
      state.loaded = true;
      await loadLeaveCache();     // Urlaubstage laden — render() braucht sie synchron
      render();
      setStatus(`${state.rows.length} Einträge geladen.`, 'ok');
    }

    // ── Pull-to-Refresh ──
    let ptrActive = false;
    let ptrStartY = 0;
    let ptrThreshold = 80;
    const ptrIndicator = document.getElementById('ptrIndicator');

    function onTouchStart(e) {
      if (window.scrollY > 10) return;
      ptrStartY = e.touches[0].clientY;
      ptrActive = true;
    }
    function onTouchMove(e) {
      if (!ptrActive) return;
      const delta = e.touches[0].clientY - ptrStartY;
      if (delta > 10 && window.scrollY <= 5) {
        ptrIndicator.classList.add('visible');
      }
    }
    function onTouchEnd(e) {
      if (!ptrActive) return;
      ptrActive = false;
      if (ptrIndicator.classList.contains('visible')) {
        ptrIndicator.classList.remove('visible');
        refreshData();
      }
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);

    async function refreshData() {
      showToast('Aktualisiere …');
      const ovSk3 = document.getElementById('overviewSkeleton');
      const ovCt3 = document.getElementById('overviewContent');
      if (ovSk3) ovSk3.style.display = state.loaded ? 'none' : 'block';
      if (ovCt3) ovCt3.style.display = 'none';
      try { await loadData(); showToast('Daten aktualisiert 😺'); }
      catch (err) { showToast('Fehler beim Aktualisieren', 3000); }
    }

    // ── Event binding ──
    tabButtons.forEach(button => button.addEventListener('click', () => activateTab(button.dataset.target)));

    trendControls.mode.addEventListener('change', () => {
      state.trendMode = trendControls.mode.value;
      persistState();
      render();
    });
    trendControls.week.addEventListener('change', () => {
      state.trendWeekKey = trendControls.week.value;
      persistState();
      if (state.trendMode === 'kw') render();
    });
    trendControls.month.addEventListener('change', () => {
      state.trendMonth = trendControls.month.value;
      persistState();
      if (state.trendMode === 'month') render();
    });

    function parseNum(v) {
      if (v === undefined || v === null) return NaN;
      v = String(v).trim();
      if (v === '') return NaN;
      return Number(v.replace(',', '.'));
    }

    document.getElementById('saveBtn').addEventListener('click', async () => {
      const date = form.date.value;
      const hours = parseNum(form.hours.value);
      const note = form.note.value.trim() || weekdayName(date);
      if (!date) return setStatus('Bitte ein Datum wählen.', 'error');
      if (Number.isNaN(hours)) return setStatus('Bitte die Stunden eingeben.', 'error');
      let tips = parseNum(form.tips.value);
      if (Number.isNaN(tips)) {
        const raw = (form.tips.value || '').trim();
        if (raw) return setStatus('Trinkgeld: Komma oder Punkt als Dezimaltrenner nutzen.', 'error');
        tips = 0;
      }
      await db.entries.put({ date, actualHoursManual: hours, tips, note: note || '' });
      await loadData();
      showToast('Schicht gespeichert 😺');
      resetForm();
    });



    // ── Init ──
    initTheme();
    restoreState();
    activateTab(state.activeTab);
    form.date.value = todayStr();
    loadData();
  </script>
</body>
