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

    // Speichert eine Datei. WICHTIG: Der Nutzer will die Datei SOFORT in „Downloads"
    // haben — kein Teilen-Dialog, kein „Speichern unter".
    //
    // Android 10+ (Scoped Storage): Direktes Schreiben nach /storage/emulated/0/Download
    // ist für Apps gesperrt. Der vorgesehene Weg ist der MediaStore. Capacitor Filesystem
    // bietet dafür `Directory.ExternalStorage` — seit Capacitor 5 wird das auf Android 10+
    // intern über den MediaStore aufgelöst und landet in „Downloads".
    // Fallback-Kette: ExternalStorage → Documents → (nur wenn alles scheitert) Teilen.
    async function saveTextFile(filename, text, mime) {
      if (isNative && CapFs()) {
        const Fs = CapFs();

        // 1. Bevorzugt: direkt nach Downloads (MediaStore, kein Dialog)
        try {
          await Fs.writeFile({
            path: 'Download/' + filename,
            data: text,
            directory: 'EXTERNAL_STORAGE',
            encoding: 'utf8',
            recursive: true,
          });
          showToast('In Downloads gespeichert 📥', 3000);
          return true;
        } catch (e1) {
          // 2. Fallback: App-eigener Dokumente-Ordner (immer erlaubt, kein Dialog)
          try {
            await Fs.writeFile({
              path: filename,
              data: text,
              directory: 'DOCUMENTS',
              encoding: 'utf8',
              recursive: true,
            });
            showToast('Gespeichert: ' + filename, 3200);
            return true;
          } catch (e2) {
            // 3. Letzter Ausweg: Teilen-Dialog (nur wenn 1+2 scheitern)
            try {
              const res = await Fs.writeFile({
                path: filename, data: text, directory: 'CACHE', encoding: 'utf8',
              });
              if (CapShare() && res.uri) {
                await CapShare().share({ title: filename, files: [res.uri] });
                return true;
              }
            } catch (e3) {}
            alert('Speichern fehlgeschlagen: ' + ((e2 && e2.message) || String(e2)));
            return false;
          }
        }
      }
      // Browser-Fallback: normaler Download
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
    // ACHTUNG: activeTab wird NICHT mehr gemerkt. Die App startet immer im
    // Tab „Eintragen" (Wunsch des Nutzers: morgens eintragen, nicht erst
    // dorthin navigieren). trendMode/trendWeekKey/trendMonth bleiben erhalten.
    function persistState() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({
        trendMode: state.trendMode,
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
        }
      } catch (_) {}
      // Immer im Erfassungs-Tab starten
      state.activeTab = 'capture';
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
      // Kalender-Link-Einstellungen im Datenbank-Tab füllen
      if (targetId === 'database') { initIcalSettings(); }
      // Chart neu zeichnen, wenn der Übersicht-Tab sichtbar wird (SVG braucht Layout)
      if (targetId === 'stats') {
        // Kalender ggf. nachladen, damit Soll/Ist aktuell ist
        (getIcalUrl() ? icalFetch(false) : Promise.resolve()).then(() => renderSollIst());
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

    // ═══════════════════════════════════════
    //  Soll / Ist — geplante vs. gearbeitete Stunden
    // ═══════════════════════════════════════
    // Soll  = Summe der Schichten aus dem Kalender-Link im Zeitraum
    // Ist   = Summe der in der App erfassten Stunden im Zeitraum
    // Saldo = Ist − Soll  (grün = mehr gearbeitet, rot = weniger)
    const siState = { period: 'month' };

    function siRange(period) {
      const now = new Date();
      if (period === 'week') {
        const dow = (now.getDay() + 6) % 7;           // Montag = 0
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
        const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
        return { from: localIso(mon), to: localIso(sun), label: `KW ${isoWeekInfo(localIso(now)).week}` };
      }
      if (period === 'year') {
        return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31`, label: String(now.getFullYear()) };
      }
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        from: localIso(from),
        to: localIso(to),
        label: new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(from),
      };
    }

    function siCompute(period) {
      const r = siRange(period);
      const inRange = d => d >= r.from && d <= r.to;

      const istRows = state.rows.filter(x => inRange(x.date));
      const istHours = istRows.reduce((s, x) => s + Number(x.actualHoursManual || 0), 0);
      const istTips = istRows.reduce((s, x) => s + Number(x.tips || 0), 0);

      // Soll nur aus echten Schichten des Kalender-Links.
      // TENTATIVE = unbestätigte/Draft-Schicht: zählt mit, wird aber getrennt ausgewiesen,
      // weil sie kurz-fristig abgesagt werden kann (Tanda „pending shift").
      const planEvents = icalEvents.filter(e => icalIsShift(e) && inRange(e.start));
      const planFest = planEvents.filter(e => (e.status || 'CONFIRMED') !== 'TENTATIVE');
      const planDraft = planEvents.filter(e => e.status === 'TENTATIVE');
      const sollMin = planFest.reduce((s, e) => s + (icalDuration(e) || 0), 0);
      const draftMin = planDraft.reduce((s, e) => s + (icalDuration(e) || 0), 0);
      const sollHours = sollMin / 60;
      const draftHours = draftMin / 60;
      // Für den Plan-Balken zählt beides (sonst fehlt die Hälfte), aber der Saldo
      // wird gegen das FESTE Soll gerechnet — Draft darf ihn nicht künstlich drücken.
      const sollMinGesamt = sollMin + draftMin;

      // Geplante Schichten, für die noch kein Ist-Eintrag existiert
      const offen = planEvents.filter(e => !istRows.some(x => x.date === e.start));
      const offenMin = offen.reduce((s, e) => s + (icalDuration(e) || 0), 0);

      // Ist-Schichten, die im Kalender gar nicht stehen (Einspringen / Zusatzschicht)
      const zusatz = istRows.filter(x => !planEvents.some(e => e.start === x.date));
      const zusatzHours = zusatz.reduce((s, x) => s + Number(x.actualHoursManual || 0), 0);

      const today = localIso(new Date());
      // Für den laufenden Zeitraum: nur bis heute bewerten, sonst wirkt jeder Monat „rot".
      // Grundlage ist das FESTE Soll — unbestätigte Draft-Schichten dürfen kein Minus erzeugen.
      const sollBisHeute = planFest.filter(e => e.start <= today).reduce((s, e) => s + (icalDuration(e) || 0), 0) / 60;
      const offenMinBisHeute = planFest.filter(e => e.start <= today && !istRows.some(x => x.date === e.start))
        .reduce((s, e) => s + (icalDuration(e) || 0), 0);

      return {
        ...r, istHours, istTips, sollHours, offen, offenHours: offenMin / 60,
        planDraft, draftHours, sollHoursGesamt: sollMinGesamt / 60,
        zusatz, zusatzHours, sollBisHeute, offenHoursBisHeute: offenMinBisHeute / 60,
        saldo: istHours - sollHours,
        saldoBisHeute: istHours - sollBisHeute,
        hasPlan: icalEvents.length > 0,
        isFutureOnly: sollBisHeute === 0 && sollHours > 0,
      };
    }

    function siBar(pct, tone) {
      const w = Math.max(0, Math.min(100, pct));
      return `<div class="si-bar"><div class="si-bar-fill ${tone}" style="width:${w.toFixed(1)}%"></div></div>`;
    }

    // Toleranzschwelle nach VDMA/Vergleichs-Apps (Deputy „Variance Tolerance"):
    // kleine Abweichungen sind normal und werden NICHT farblich alarmiert.
    // Unter 90 min bzw. unter 5 % des Plans gilt der Saldo als „im Plan".
    function siTolerance(sollHours) {
      return Math.max(1.5, sollHours * 0.05);
    }

    // Echte Grenzüberschreitung: Minijob-Grenze (556 €/Monat, Stand 2026)
    // bzw. ArbZG-Tagesobergrenze 10 h. Nur DANN wird es rot.
    const MINIJOB_LIMIT_EUR = 556;

    function renderSollIst() {
      const box = document.getElementById('sollIstBody');
      const title = document.getElementById('siTitle');
      if (!box) return;
      const d = siCompute(siState.period);
      if (title) title.textContent = d.label;

      document.querySelectorAll('#siPeriodSwitch .si-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.period === siState.period));

      if (!d.hasPlan) {
        box.innerHTML = `<div class="si-empty">
          <div class="si-empty-ico">🎯</div>
          <div class="si-empty-title">Noch kein Soll vorhanden</div>
          <div class="si-empty-sub">Sobald dein Kalender-Link hinterlegt ist (<strong>Einstellungen</strong>), steht hier geplant vs. gearbeitet.</div>
        </div>`;
        return;
      }

      const pct = d.sollHours ? (d.istHours / d.sollHours) * 100 : 0;

      // ── SALDO-BEZUG: bis heute, nicht Gesamtzeitraum ────────────────────────
      // Ein laufender Zeitraum darf nicht gegen den vollen Plan gerechnet werden:
      // am Dienstag sind die restlichen Schichten noch nicht gearbeitet — das ist
      // kein Minus, sondern Zukunft. Deshalb:
      //   · laufender Zeitraum  → Soll = nur Schichten bis heute
      //   · zurückliegend       → Soll = ganzer Zeitraum (alles ist fällig)
      //   · zukünftig           → Soll = 0, Saldo „—" (noch nichts fällig)
      const today = localIso(new Date());
      const isRunning = d.from <= today && d.to >= today;
      const isPast = d.to < today;
      const sollBasis = isPast ? d.sollHours : (isRunning ? d.sollBisHeute : 0);
      const saldo = isRunning || isPast ? d.istHours - sollBasis : null;
      const tol = siTolerance(sollBasis);
      const imPlan = saldo !== null && Math.abs(saldo) <= tol;

      // Farbe: im Plan = neutral. Sonst Akzent (grün/grau-orange).
      // Rot NUR, wenn eine echte Grenze gerissen wird — nicht bei „weniger gearbeitet".
      const verdienst = d.istHours * HOURLY_RATE;
      const ueberMinijob = siState.period === 'month' && verdienst > MINIJOB_LIMIT_EUR;
      const tone = saldo === null ? 'neutral'
        : ueberMinijob ? 'over-limit'
        : imPlan ? 'neutral'
        : (saldo > 0 ? 'plus' : 'minus');

      // Immer Wort + Pfeil + Zahl — „+3,5 h" allein ist mehrdeutig
      const saldoTxt = saldo === null ? '—'
        : imPlan ? 'im Plan'
        : (saldo > 0 ? '▲ ' : '▼ ') + hrs(Math.abs(saldo));
      const saldoHint = saldo === null
        ? 'noch nichts fällig'
        : ueberMinijob
        ? `über Minijob-Grenze (${eur(MINIJOB_LIMIT_EUR)})`
        : imPlan ? `Toleranz ±${hrs(tol)}`
        : (saldo > 0 ? 'mehr als geplant' : 'weniger als fällig');

      // Große Zeile: Soll | Ist | Saldo — antippbar (führt zur Schichtliste)
      let html = `<div class="si-figures">
        <div class="si-fig si-fig-link" role="button" tabindex="0" data-goto="planned">
          <div class="si-fig-label">Geplant</div>
          <div class="si-fig-value">${d.sollHoursGesamt > 0 ? hrs(d.sollHoursGesamt) : '—'}</div>
          <div class="si-fig-hint">${d.sollHoursGesamt > 0
            ? (d.planDraft.length ? `davon ${hrs(d.draftHours)} unbestätigt` : `${d.offen.length} offen`)
            : 'kein Plan'}</div>
        </div>
        <div class="si-fig si-fig-link" role="button" tabindex="0" data-goto="worked">
          <div class="si-fig-label">Gearbeitet</div>
          <div class="si-fig-value">${hrs(d.istHours)}</div>
          <div class="si-fig-hint">${eur(verdienst)}</div>
        </div>
        <div class="si-fig si-fig-saldo si-fig-link" role="button" tabindex="0" data-goto="saldo">
          <div class="si-fig-label">Saldo${isRunning ? ' <span class="si-muted">bis heute</span>' : ''}</div>
          <div class="si-fig-value ${tone}">${saldoTxt}</div>
          <div class="si-fig-hint">${saldoHint}</div>
        </div>
      </div>`;

      // Ohne geplante Stunden ist ein Fortschrittsbalken sinnlos (0 % von 0 h).
      // Dann zeigen wir stattdessen nur, was gearbeitet wurde.
      if (!(d.sollHoursGesamt > 0)) {
        html += `<div class="si-note si-note-plain">
          Gearbeitet: <strong>${hrs(d.istHours)}</strong> · ${eur(verdienst)}
          <span class="si-muted">— kein Kalender-Link verbunden, daher kein Soll</span>
        </div>`;
        box.innerHTML = html;
        return;
      }

      html += `<div class="si-progress">
        ${siBar(pct, tone)}
        <div class="si-progress-meta">
          <span><strong>${pct.toFixed(0)} %</strong> des Plans${siState.period !== 'year' ? ' · <span class="si-muted">läuft</span>' : ''}</span>
          <span>${hrs(d.istHours)} von ${hrs(d.sollHoursGesamt)}</span>
        </div>
      </div>`;

      // Laufender Zeitraum: Fortschritt bis heute statt Endstand.
      // Der Saldo oben rechnet bereits bis heute — hier steht die Erklärung,
      // damit niemand denkt, der Plan sei „schon durch".
      if (d.isFutureOnly) {
        html += `<div class="si-note">Der Zeitraum liegt noch vor dir — geplant sind ${hrs(d.sollHours)}.</div>`;
      } else if (isRunning && d.sollBisHeute > 0 && Math.abs(d.sollBisHeute - d.sollHours) > 0.05) {
        const pctHeuteVomPlan = d.sollHours ? (d.sollBisHeute / d.sollHours) * 100 : 0;
        const saldoHeute = d.istHours - d.sollBisHeute;
        const tolH = siTolerance(d.sollBisHeute);
        const imPlanH = Math.abs(saldoHeute) <= tolH;
        const toneH = imPlanH ? 'neutral' : (saldoHeute > 0 ? 'plus' : 'minus');
        const saldoHeuteTxt = imPlanH ? 'im Plan'
          : (saldoHeute > 0 ? '▲ ' : '▼ ') + hrs(Math.abs(saldoHeute));
        html += `<div class="si-until">
          <div class="si-until-head">
            <span>Stand heute <span class="si-muted">(fällig bis ${dateFmt(today).split(' ').slice(1).join(' ')})</span></span>
            <strong class="${toneH}">${saldoHeuteTxt}</strong>
          </div>
          <div class="si-bar si-bar-marked">
            <div class="si-bar-fill ${toneH}" style="width:${Math.min(100, d.istHours && d.sollHours ? (d.istHours / d.sollHours) * 100 : 0).toFixed(1)}%"></div>
            <div class="si-marker" style="left:${Math.min(100, pctHeuteVomPlan).toFixed(1)}%" title="Soll bis heute"></div>
          </div>
          <div class="si-progress-meta">
            <span>${hrs(d.istHours)} gearbeitet</span>
            <span>${hrs(d.sollBisHeute)} wären bis heute fällig</span>
          </div>
        </div>`;
      }

      // Zusatzschichten (nicht im Plan) und offene Schichten — antippbar
      const extras = [];
      if (d.zusatz.length) extras.push(`<button class="si-chip plus" type="button" data-goto="extra">+${d.zusatz.length} ohne Plan · ${hrs(d.zusatzHours)}</button>`);
      if (d.offen.length) extras.push(`<button class="si-chip minus" type="button" data-goto="open">${d.offen.length} offen · ${hrs(d.offenHours)}</button>`);
      if (extras.length) html += `<div class="si-chips">${extras.join('')}</div>`;

      box.innerHTML = html;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  DRILL-DOWN
    //  Prinzip: jede Zahl im Analyse-Tab ist antippbar und öffnet die
    //  Schichten, aus denen sie entstanden ist. Ein Sheet, viele Inhalte.
    //  Das ersetzt „Zahl ohne Kontext" durch „Zahl → Beleg".
    // ═══════════════════════════════════════════════════════════════════
    const ddState = { open: false, lastFocus: null };

    function ddOpen(title, sub, bodyHtml, kind) {
      const sheet = document.getElementById('ddSheet');
      const back = document.getElementById('ddBackdrop');
      if (!sheet || !back) return;
      ddState.lastFocus = document.activeElement;
      document.getElementById('ddTitle').textContent = title;
      document.getElementById('ddSub').textContent = sub || '';
      const bodyEl = document.getElementById('ddBody');
      bodyEl.innerHTML = bodyHtml;
      if (kind) bodyEl.dataset.kind = kind; else delete bodyEl.dataset.kind;
      back.classList.add('open');
      sheet.classList.add('open');
      ddState.open = true;
      document.getElementById('ddBody').scrollTop = 0;
      if (history.state?.dd !== true) history.pushState({ dd: true }, '');
    }

    function ddClose() {
      const sheet = document.getElementById('ddSheet');
      const back = document.getElementById('ddBackdrop');
      if (!sheet || !back || !ddState.open) return;
      back.classList.remove('open');
      sheet.classList.remove('open');
      ddState.open = false;
      if (ddState.lastFocus && ddState.lastFocus.focus) {
        try { ddState.lastFocus.focus({ preventScroll: true }); } catch (_) {}
      }
    }
    window.ddClose = ddClose;

    document.getElementById('ddClose')?.addEventListener('click', ddClose);
    document.getElementById('ddBackdrop')?.addEventListener('click', ddClose);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') ddClose(); });
    // Android-Zurück / Browser-Zurück schließt das Sheet statt die Ansicht zu verlassen
    window.addEventListener('popstate', () => { if (ddState.open) ddClose(); });
    // Wisch-Geste nach unten schließt
    (function ddSwipe() {
      const sheet = document.getElementById('ddSheet');
      if (!sheet) return;
      let y0 = null, dy = 0;
      const body = document.getElementById('ddBody');
      sheet.addEventListener('touchstart', e => {
        if (body && body.scrollTop > 4) return;
        y0 = e.touches[0].clientY; dy = 0;
        sheet.style.transition = 'none';
      }, { passive: true });
      sheet.addEventListener('touchmove', e => {
        if (y0 === null) return;
        dy = Math.max(0, e.touches[0].clientY - y0);
        if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
      }, { passive: true });
      sheet.addEventListener('touchend', () => {
        if (y0 === null) return;
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (dy > 90) ddClose();
        y0 = null; dy = 0;
      });
    })();

    // ── Bausteine für die Sheet-Inhalte ──
    // Eine Zeile pro Schicht. Tippen öffnet den Bearbeiten-Formular (Sheet zu).
    function ddShiftRow(r, opts = {}) {
      const o = opts;
      return `<div class="dd-row" role="button" tabindex="0" data-edit="${r.date}">
        <div class="dd-row-main">
          <div class="dd-row-day">${weekdayName(r.date)}${o.day ? ', ' + dateFmt(r.date).split(' ').slice(1).join(' ') : ''}</div>
          <div class="dd-row-meta">${r.week ? r.week.label : ''}${r.note ? ' · ' + r.note : ''}</div>
        </div>
        <div class="dd-row-val">
          <div class="dd-row-h">${hrs(r.actualHoursManual)}</div>
          <div class="dd-row-t">${eur(r.tips)}</div>
        </div>
      </div>`;
    }

    function ddEmpty(ico, title, sub) {
      return `<div class="dd-empty">
        <div class="dd-empty-ico">${ico}</div>
        <div class="dd-empty-title">${title}</div>
        <div class="dd-empty-sub">${sub}</div>
      </div>`;
    }

    // Cross-Sell statt Leere: gibt es in einem ANDEREN Zeitraum Daten?
    // NN/g Empty States: Systemstatus erklären + direkten Pfad anbieten.
    function ddEmptyWithHint(ico, title, sub, period, rowCount) {
      const alts = [['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr']]
        .filter(([p]) => p !== period);
      const counts = alts.map(([p, label]) => {
        const r = siRange(p);
        const all = state.rows || [];
        const n = all.filter(x => x.date >= r.from && x.date <= r.to).length;
        return { p, label, n };
      }).filter(x => x.n > 0);
      const hint = counts.length
        ? `<div class="dd-empty-cta">${counts.map(c =>
            `<button class="si-chip" type="button" data-switch-period="${c.p}">${c.label}: ${c.n}</button>`).join('')}</div>`
        : '';
      return `<div class="dd-empty">
        <div class="dd-empty-ico">${ico}</div>
        <div class="dd-empty-title">${title}</div>
        <div class="dd-empty-sub">${sub}</div>
        ${hint}
      </div>`;
    }

    // Zeitraum im Sheet direkt umschalten, ohne es zu schließen
    document.addEventListener('click', e => {
      const sw = e.target.closest('[data-switch-period]');
      if (!sw) return;
      e.preventDefault();
      siState.period = sw.dataset.switchPeriod;
      renderSollIst();
      // offenes Sheet mit dem neuen Zeitraum neu aufbauen
      const reopen = { worked: ddWorked, planned: ddPlanned, saldo: ddSaldo, extra: ddExtra, open: ddOpenShifts };
      const last = sw.closest('.dd-body')?.dataset.kind;
      if (last && reopen[last]) reopen[last]();
    });

    function ddSum(items) {
      return `<div class="dd-sum">${items.map(([k, v]) => `<span>${k} <strong>${v}</strong></span>`).join('')}</div>`;
    }

    function ddRowsOrEmpty(list, emptyIco, emptyTitle, emptySub) {
      return list.length ? list.join('') : ddEmpty(emptyIco, emptyTitle, emptySub);
    }

    // Holt die Schichten des aktuell gewählten Soll/Ist-Zeitraums
    function ddPeriodRows() {
      const r = siRange(siState.period);
      return state.rows.filter(x => x.date >= r.from && x.date <= r.to)
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    function ddPeriodLabel() {
      const r = siRange(siState.period);
      return r.label;
    }

    // ── Die einzelnen Drill-Down-Ziele ──
    function ddWorked() {
      const rows = ddPeriodRows();
      const d = siCompute(siState.period);
      const list = rows.slice().reverse().map(r => ddShiftRow(r, { day: true }));
      ddOpen(
        `Gearbeitet · ${hrs(d.istHours)}`,
        `${rows.length} ${rows.length === 1 ? 'Schicht' : 'Schichten'} · ${ddPeriodLabel()}`,
        ddSum([['Stunden', hrs(d.istHours)], ['Trinkgeld', eur(d.istTips)], ['Ø/Std', eur(d.istHours ? d.istTips / d.istHours : 0)]])
        + (list.length ? list.join('') : ddEmptyWithHint('📋', 'Noch keine Schicht erfasst', 'Trag im Tab „Eintragen" eine Schicht ein — dann steht sie hier.', siState.period)),
        'worked'
      );
    }

    function ddPlanned() {
      const d = siCompute(siState.period);
      const evs = icalEvents.filter(e => icalIsShift(e) && e.start >= d.from && e.start <= d.to)
        .sort((a, b) => a.start.localeCompare(b.start));
      const rows = evs.map(e => {
        const got = state.rows.find(x => x.date === e.start);
        const dur = (icalDuration(e) || 0) / 60;
        const draft = (e.status === 'TENTATIVE');
        return `<div class="dd-row" role="button" tabindex="0" ${got ? `data-edit="${got.date}"` : `data-plan="${e.start}"`}>
          <div class="dd-row-main">
            <div class="dd-row-day">${weekdayName(e.start)}, ${dateFmt(e.start).split(' ').slice(1).join(' ')}${draft ? ' <span class="si-muted">(unbestätigt)</span>' : ''}</div>
            <div class="dd-row-meta">${e.summary || 'Schicht'}${got ? ' · erfasst' : ' · offen'}</div>
          </div>
          <div class="dd-row-val">
            <div class="dd-row-h">${hrs(dur)}</div>
            <div class="dd-row-t">${got ? hrs(got.actualHoursManual) : '—'}</div>
          </div>
        </div>`;
      });
      ddOpen(
        `Geplant · ${hrs(d.sollHoursGesamt)}`,
        `${evs.length} ${evs.length === 1 ? 'Schicht' : 'Schichten'} im Kalender · ${ddPeriodLabel()}`,
        ddSum([['Bestätigt', hrs(d.sollHours)], ['Unbestätigt', hrs(d.draftHours)], ['Offen', `${d.offen.length}`]])
        + (rows.length ? rows.join('') : ddEmptyWithHint('🗓️', 'Keine Schichten im Plan', 'Der Kalender-Link ist gesetzt, aber in diesem Zeitraum steht nichts drin.', siState.period)),
        'planned'
      );
    }

    function ddSaldo() {
      const d = siCompute(siState.period);
      const today = localIso(new Date());
      const isRunning = d.from <= today && d.to >= today;
      const isPast = d.to < today;
      const basis = isPast ? d.sollHours : (isRunning ? d.sollBisHeute : 0);
      const saldo = d.istHours - basis;
      const diff = Math.abs(saldo);
      const tol = siTolerance(basis);
      const verdict = Math.abs(saldo) <= tol
        ? 'Du bist im Plan — die Abweichung liegt innerhalb der Toleranz.'
        : saldo > 0
        ? `Du hast ${hrs(diff)} mehr gearbeitet als fällig war.`
        : `Dir fehlen ${hrs(diff)} bis zum heutigen Soll. Kein Grund zur Panik: die restlichen Schichten zählen erst, wenn sie dran sind.`;
      const extras = [];
      if (d.offen.length) {
        extras.push(`<h3 class="dd-h3">Noch offen (${d.offen.length})</h3>`);
        extras.push(...d.offen.sort((a, b) => a.start.localeCompare(b.start)).map(e =>
          `<div class="dd-row"><div class="dd-row-main">
            <div class="dd-row-day">${weekdayName(e.start)}, ${dateFmt(e.start).split(' ').slice(1).join(' ')}</div>
            <div class="dd-row-meta">${e.summary || 'Schicht'}</div>
          </div><div class="dd-row-val"><div class="dd-row-h">${hrs((icalDuration(e) || 0) / 60)}</div></div></div>`));
      }
      ddOpen(
        `Saldo · ${saldo >= 0 ? '▲' : '▼'} ${hrs(diff)}`,
        isRunning ? 'gerechnet bis heute — nicht bis zum Ende des Zeitraums' : ddPeriodLabel(),
        ddSum([['Gearbeitet', hrs(d.istHours)], [isRunning ? 'Fällig bis heute' : 'Fällig gesamt', hrs(basis)], ['Differenz', (saldo >= 0 ? '+' : '−') + hrs(diff)]])
        + `<p class="dd-p">${verdict}</p>`
        + extras.join('')
      );
    }

    function ddExtra() {
      const d = siCompute(siState.period);
      const zusatz = d.zusatz.slice().sort((a, b) => a.date.localeCompare(b.date));
      const list = zusatz.reverse().map(r => ddShiftRow(r, { day: true }));
      ddOpen(
        `Ohne Plan · ${hrs(d.zusatzHours)}`,
        `${zusatz.length} ${zusatz.length === 1 ? 'Schicht' : 'Schichten'}, die nicht im Kalender stehen`,
        ddSum([['Stunden', hrs(d.zusatzHours)], ['Trinkgeld', eur(zusatz.reduce((s, r) => s + Number(r.tips || 0), 0))]])
        + (list.length ? list.join('') : ddEmptyWithHint('➕', 'Keine Zusatzschichten', 'Alles, was du gearbeitet hast, stand auch im Plan.', siState.period)),
        'extra'
      );
    }

    function ddOpenShifts() {
      const d = siCompute(siState.period);
      const offen = d.offen.slice().sort((a, b) => a.start.localeCompare(b.start));
      const rows = offen.map(e => `<div class="dd-row" role="button" tabindex="0" data-plan="${e.start}">
        <div class="dd-row-main">
          <div class="dd-row-day">${weekdayName(e.start)}, ${dateFmt(e.start).split(' ').slice(1).join(' ')}</div>
          <div class="dd-row-meta">${e.summary || 'Schicht'}</div>
        </div>
        <div class="dd-row-val"><div class="dd-row-h">${hrs((icalDuration(e) || 0) / 60)}</div><div class="dd-row-t">fehlt</div></div>
      </div>`);
      ddOpen(
        `Offen · ${hrs(d.offenHours)}`,
        `${offen.length} geplante ${offen.length === 1 ? 'Schicht' : 'Schichten'} ohne Eintrag`,
        (rows.length ? rows.join('') : ddEmptyWithHint('✅', 'Nichts offen', 'Alle geplanten Schichten dieses Zeitraums sind erfasst. Sauber.', siState.period)),
        'open'
      );
    }

    // Kachel-Drilldowns: Trinkgeld, Ø/Std, Beste Woche, Anzahl
    function ddTips() {
      const rows = [...state.rows].sort((a, b) => Number(b.tips) - Number(a.tips));
      const total = rows.reduce((s, r) => s + Number(r.tips || 0), 0);
      const list = rows.filter(r => Number(r.tips) > 0).slice(0, 100).map(r => ddShiftRow(r, { day: true }));
      ddOpen(
        `Trinkgeld · ${eur(total)}`,
        rows.length ? `aus ${rows.length} Schichten · sortiert nach Betrag` : 'noch keine Daten',
        ddSum([['Gesamt', eur(total)], ['Bester Tag', rows.length ? eur(Number(rows[0].tips) || 0) : '—']])
        + ddRowsOrEmpty(list, '💰', 'Noch kein Trinkgeld', 'Trag im Tab „Eintragen" ein Trinkgeld ein — dann erscheint es hier sortiert.')
      );
    }

    function ddRate() {
      const totalH = state.rows.reduce((s, r) => s + Number(r.actualHoursManual || 0), 0);
      const totalT = state.rows.reduce((s, r) => s + Number(r.tips || 0), 0);
      const rate = totalH ? totalT / totalH : 0;
      const ranked = state.rows
        .map(r => ({ ...r, rate: Number(r.actualHoursManual) ? Number(r.tips || 0) / Number(r.actualHoursManual) : 0 }))
        .filter(r => Number(r.actualHoursManual) > 0)
        .sort((a, b) => b.rate - a.rate);
      const list = ranked.slice(0, 60).map(r => `<div class="dd-row" role="button" tabindex="0" data-edit="${r.date}">
        <div class="dd-row-main">
          <div class="dd-row-day">${weekdayName(r.date)}, ${dateFmt(r.date).split(' ').slice(1).join(' ')}</div>
          <div class="dd-row-meta">${hrs(r.actualHoursManual)} · ${eur(r.tips)}</div>
        </div>
        <div class="dd-row-val"><div class="dd-row-h">${eur(r.rate)}</div></div>
      </div>`);
      ddOpen(
        `Ø Trinkgeld/Std · ${eur(rate)}`,
        'Deine besten Schichten nach Stundenlohn aus Trinkgeld',
        ddRowsOrEmpty(list, '⚡', 'Noch keine Auswertung', 'Sobald Stunden erfasst sind, siehst du hier, welche Schicht sich am meisten gelohnt hat.')
      );
    }

    function ddBestWeek() {
      const groups = new Map();
      for (const r of state.rows) {
        const k = `${r.week.year}-KW${String(r.week.week).padStart(2, '0')}`;
        if (!groups.has(k)) groups.set(k, { label: r.week.label, year: r.week.year, week: r.week.week, rows: [] });
        groups.get(k).rows.push(r);
      }
      const arr = [...groups.values()].map(g => ({
        ...g,
        tips: g.rows.reduce((s, r) => s + Number(r.tips || 0), 0),
        hours: g.rows.reduce((s, r) => s + Number(r.actualHoursManual || 0), 0),
      })).sort((a, b) => b.tips - a.tips);
      const list = arr.map(g => `<div class="dd-row" role="button" tabindex="0" data-week="${g.year}|${g.week}">
        <div class="dd-row-main">
          <div class="dd-row-day">${g.label}</div>
          <div class="dd-row-meta">${g.rows.length} Schichten · ${hrs(g.hours)}</div>
        </div>
        <div class="dd-row-val"><div class="dd-row-h">${eur(g.tips)}</div></div>
      </div>`);
      ddOpen(
        arr.length ? `Beste Woche · ${arr[0].label}` : 'Beste Woche · —',
        'Wochen nach Trinkgeld — tippe eine an für die Schichten',
        ddRowsOrEmpty(list, '🏆', 'Noch keine Wochen', 'Trag ein paar Schichten ein, dann siehst du hier deine stärkste Woche.')
      );
    }

    function ddWeekDetail(year, week) {
      const rows = state.rows.filter(r => r.week.year === Number(year) && r.week.week === Number(week))
        .sort((a, b) => a.date.localeCompare(b.date));
      const h = rows.reduce((s, r) => s + Number(r.actualHoursManual || 0), 0);
      const t = rows.reduce((s, r) => s + Number(r.tips || 0), 0);
      ddOpen(
        `KW ${week} · ${year}`,
        `${rows.length} ${rows.length === 1 ? 'Schicht' : 'Schichten'}`,
        ddSum([['Stunden', hrs(h)], ['Trinkgeld', eur(t)], ['Ø/Std', eur(h ? t / h : 0)]])
        + ddRowsOrEmpty(rows.map(r => ddShiftRow(r, { day: true })), '📅', 'Keine Schichten', 'In dieser Woche ist nichts erfasst.')
      );
    }

    function ddShiftCount() {
      const rows = [...state.rows].sort((a, b) => b.date.localeCompare(a.date));
      const h = rows.reduce((s, r) => s + Number(r.actualHoursManual || 0), 0);
      const days = new Set(rows.map(r => r.date)).size;
      ddOpen(
        `${rows.length} Schichten`,
        'Alle erfassten Einträge, neueste zuerst',
        ddSum([['Stunden', hrs(h)], ['Tage', String(days)], ['Ø/Schicht', hrs(rows.length ? h / rows.length : 0)]])
        + ddRowsOrEmpty(rows.map(r => ddShiftRow(r, { day: true })), '📋', 'Noch nichts erfasst', 'Leg im Tab „Eintragen" die erste Schicht an.')
      );
    }

    function ddMonthly(monthKey) {
      const rows = state.rows.filter(r => r.date.startsWith(monthKey)).sort((a, b) => a.date.localeCompare(b.date));
      const h = rows.reduce((s, r) => s + Number(r.actualHoursManual || 0), 0);
      const t = rows.reduce((s, r) => s + Number(r.tips || 0), 0);
      const d = new Date(monthKey + '-15T12:00:00');
      const name = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(d);
      ddOpen(
        name,
        `${rows.length} ${rows.length === 1 ? 'Schicht' : 'Schichten'}`,
        ddSum([['Stunden', hrs(h)], ['Trinkgeld', eur(t)], ['Brutto ≈', eur(h * 13.90)]])
        + ddRowsOrEmpty(rows.map(r => ddShiftRow(r, { day: true })), '📅', 'Nichts erfasst', 'In diesem Monat ist keine Schicht eingetragen.')
      );
    }

    // ── Ein globaler Klick-Handler für alle data-goto/data-edit/data-week ──
    document.addEventListener('click', e => {
      const goto = e.target.closest('[data-goto]');
      if (goto) {
        e.preventDefault();
        const k = goto.dataset.goto;
        if (k === 'worked') ddWorked();
        else if (k === 'planned') ddPlanned();
        else if (k === 'saldo') ddSaldo();
        else if (k === 'extra') ddExtra();
        else if (k === 'open') ddOpenShifts();
        else if (k === 'tips') ddTips();
        else if (k === 'rate') ddRate();
        else if (k === 'bestweek') ddBestWeek();
        else if (k === 'count') ddShiftCount();
        return;
      }
      const week = e.target.closest('[data-week]');
      if (week) {
        const [y, w] = week.dataset.week.split('|');
        ddWeekDetail(y, w);
        return;
      }
      const month = e.target.closest('[data-month-detail]');
      if (month) { ddMonthly(month.dataset.monthDetail); return; }
      const edit = e.target.closest('[data-edit]');
      if (edit) { ddClose(); setTimeout(() => editRow(edit.dataset.edit), 180); return; }
      const plan = e.target.closest('[data-plan]');
      if (plan) {
        ddClose();
        setTimeout(() => {
          resetForm();
          form.date.value = plan.dataset.plan;
          activateTab('capture');
          setStatus('Datum aus dem Plan übernommen — Stunden eintragen.', 'ok');
          form.hours.focus();
        }, 180);
      }
    });

    // Zeitraum-Umschalter
    document.querySelectorAll('#siPeriodSwitch .si-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        siState.period = btn.dataset.period;
        renderSollIst();
      });
    });

    // ═══════════════════════════════════════════════════════════════════
    //  FORTSCHRITT: Wochenziel-Ring, Streak, Erfolge
    //  Aus der älteren App-Version zurückgeholt (war ab v2.1 nicht mehr drin).
    //  Daten liegen in localStorage — keine Migration nötig, bestehende
    //  Erfolge werden beim ersten Start als „gesehen" nachgezogen.
    // ═══════════════════════════════════════════════════════════════════
    const GOAL_KEY = 'azt-weekgoal';
    const BADGE_KEY = 'azt-badges';

    function getWeekGoal() {
      const v = Number(localStorage.getItem(GOAL_KEY));
      return v > 0 ? v : 100;
    }

    window.saveWeekGoal = function () {
      const el = document.getElementById('weekGoal');
      if (!el) return;
      const v = Number(el.value);
      if (!v || v < 10) { alert('Bitte ein Ziel ab 10 € eingeben.'); return; }
      try { localStorage.setItem(GOAL_KEY, String(v)); } catch (e) {}
      showToast('Wochenziel gespeichert: ' + eur(v));
      renderProgress();
    };

    // Längste Serie aufeinanderfolgender Tage MIT Eintrag
    function computeStreak(rows) {
      if (!rows.length) return { current: 0, best: 0 };
      const dates = [...new Set(rows.map(r => r.date))].sort();
      let best = 1, run = 1;
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1] + 'T12:00:00');
        const cur = new Date(dates[i] + 'T12:00:00');
        const diff = Math.round((cur - prev) / 86400000);
        if (diff === 1) { run++; } else { run = 1; }
        best = Math.max(best, run);
      }
      const today = new Date(); today.setHours(12, 0, 0, 0);
      const last = new Date(dates[dates.length - 1] + 'T12:00:00');
      const gapToday = Math.round((today - last) / 86400000);
      let current = 0;
      if (gapToday <= 1) {
        current = 1;
        for (let i = dates.length - 1; i > 0; i--) {
          const a = new Date(dates[i - 1] + 'T12:00:00');
          const b = new Date(dates[i] + 'T12:00:00');
          if (Math.round((b - a) / 86400000) === 1) current++;
          else break;
        }
      }
      return { current, best };
    }

    function computeBadges(rows) {
      const tips = rows.map(r => Number(r.tips) || 0);
      const total = tips.reduce((a, b) => a + b, 0);
      const maxDay = Math.max(0, ...tips);
      const maxRate = Math.max(0, ...rows.map(r => {
        const h = Number(r.actualHoursManual) || 0;
        return h ? (Number(r.tips) || 0) / h : 0;
      }));
      const streak = computeStreak(rows);
      const days20 = tips.filter(t => t >= 20).length;
      const days30 = tips.filter(t => t >= 30).length;

      // Trinkgeld je Kalenderwoche
      const weeks = {};
      for (const r of rows) {
        const d = new Date(r.date + 'T12:00:00');
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
        const kw = Math.ceil(((t - y0) / 86400000 + 1) / 7);
        const k = t.getUTCFullYear() + '-' + kw;
        weeks[k] = (weeks[k] || 0) + (Number(r.tips) || 0);
      }
      const maxWeek = Math.max(0, ...Object.values(weeks));
      const leaveDays = leaveCache.length;

      return [
        { id: 'first',    ico: '🌱', name: 'Erster Eintrag',     hint: '1 Tag erfasst',     ok: rows.length >= 1 },
        { id: 'd10',      ico: '📝', name: '10 Schichten',       hint: '10 Tage erfasst',   ok: rows.length >= 10 },
        { id: 'd50',      ico: '💪', name: '50 Schichten',       hint: '50 Tage erfasst',   ok: rows.length >= 50 },
        { id: 'd100',     ico: '🎖️', name: '100 Schichten',      hint: '100 Tage erfasst',  ok: rows.length >= 100 },
        { id: 't100',     ico: '💯', name: '100 € Trinkgeld',    hint: 'Gesamt erreicht',   ok: total >= 100 },
        { id: 't500',     ico: '💰', name: '500 € Trinkgeld',    hint: 'Gesamt erreicht',   ok: total >= 500 },
        { id: 't1000',    ico: '🤑', name: '1.000 € Trinkgeld',  hint: 'Gesamt erreicht',   ok: total >= 1000 },
        { id: 't2500',    ico: '💎', name: '2.500 € Trinkgeld',  hint: 'Gesamt erreicht',   ok: total >= 2500 },
        { id: 'day20',    ico: '⭐', name: '20 € am Tag',        hint: 'Ein Tag ab 20 €',   ok: days20 >= 1 },
        { id: 'day30',    ico: '🌟', name: '30 € am Tag',        hint: 'Ein Tag ab 30 €',   ok: days30 >= 1 },
        { id: 'day50',    ico: '🏅', name: '50 € am Tag',        hint: 'Ein Tag ab 50 €',   ok: maxDay >= 50 },
        { id: 'w100',     ico: '📅', name: '100-€-Woche',        hint: 'Woche ab 100 €',    ok: maxWeek >= 100 },
        { id: 'w200',     ico: '🗓️', name: '200-€-Woche',        hint: 'Woche ab 200 €',    ok: maxWeek >= 200 },
        { id: 'streak7',  ico: '🔥', name: '7 Tage Serie',       hint: '7 Tage am Stück',   ok: streak.best >= 7 },
        { id: 'streak30', ico: '🚀', name: '30 Tage Serie',      hint: '30 Tage am Stück',  ok: streak.best >= 30 },
        { id: 'rate3',    ico: '⚡', name: '3 €/Stunde',         hint: 'Bester Schnitt',    ok: maxRate >= 3 },
        { id: 'rate4',    ico: '⚡', name: '4 €/Stunde',         hint: 'Bester Schnitt',    ok: maxRate >= 4 },
        { id: 'leave',    ico: '🏖️', name: 'Urlaub erfasst',     hint: 'Erster Urlaubstag', ok: leaveDays >= 1 },
      ];
    }

    function checkNewBadges(all) {
      let seen = [];
      try { seen = JSON.parse(localStorage.getItem(BADGE_KEY) || '[]'); } catch (e) { seen = []; }
      const nowEarned = all.filter(b => b.ok).map(b => b.id);
      const fresh = all.filter(b => b.ok && !seen.includes(b.id));
      if (fresh.length) {
        try { localStorage.setItem(BADGE_KEY, JSON.stringify(nowEarned)); } catch (e) {}
        const names = fresh.map(b => b.ico + ' ' + b.name).join(', ');
        setTimeout(() => showToast('🏆 Neuer Erfolg: ' + names, 4200), 700);
      }
      return nowEarned;
    }

    function renderProgress() {
      const rows = state.rows || [];
      const all = computeBadges(rows);
      const earnedIds = checkNewBadges(all);

      // ── Wochenziel-Ring: Trinkgeld seit Montag ──
      const goal = getWeekGoal();
      const today = new Date();
      const dow = (today.getDay() + 6) % 7;
      const monday = new Date(today); monday.setDate(today.getDate() - dow); monday.setHours(0, 0, 0, 0);
      const weekTips = rows
        .filter(r => new Date(r.date + 'T12:00:00') >= monday)
        .reduce((s, r) => s + (Number(r.tips) || 0), 0);
      const pct = Math.min(1, goal ? weekTips / goal : 0);
      const circumference = 2 * Math.PI * 52;

      const fg = document.getElementById('goalRingFg');
      if (fg) {
        fg.style.strokeDasharray = String(circumference);
        fg.style.strokeDashoffset = String(circumference * (1 - pct));
        fg.style.stroke = pct >= 1 ? '#30d158' : (pct >= 0.5 ? '#0a84ff' : '#ff9f0a');
      }
      const valEl = document.getElementById('goalRingVal');
      if (valEl) valEl.textContent = eur(weekTips);
      const subEl = document.getElementById('goalRingSub');
      if (subEl) subEl.textContent = 'von ' + eur(goal);

      // ── Streak ──
      const st = computeStreak(rows);
      const sn = document.getElementById('streakNum');
      if (sn) sn.textContent = String(st.current);
      const box = document.getElementById('streakBox');
      if (box) box.classList.toggle('cold', st.current === 0);
      const flame = document.getElementById('streakFlame');
      if (flame) flame.textContent = st.current > 0 ? '🔥' : '❄️';

      const meta = document.getElementById('goalMeta');
      if (meta) {
        const remaining = Math.max(0, goal - weekTips);
        const daysLeft = 7 - dow - 1;
        meta.innerHTML = (pct >= 1
          ? '✅ Wochenziel erreicht!'
          : `Noch <strong>${eur(remaining)}</strong> bis zum Ziel`)
          + `<br>Beste Serie: ${st.best} Tage`
          + (daysLeft > 0 && pct < 1 ? `<br>${daysLeft} Tag${daysLeft === 1 ? '' : 'e'} diese Woche übrig` : '');
      }

      // ── Erfolge ──
      const grid = document.getElementById('badgeGrid');
      if (grid) {
        grid.innerHTML = all.map(b => {
          const earned = earnedIds.includes(b.id);
          return `<div class="badge ${earned ? 'earned' : 'locked'}">
            <div class="badge-ico">${b.ico}</div>
            <div class="badge-name">${b.name}</div>
            <div class="badge-hint">${earned ? '✓ erreicht' : b.hint}</div>
          </div>`;
        }).join('');
      }
      const bc = document.getElementById('badgeCount');
      if (bc) bc.textContent = `${earnedIds.length}/${all.length}`;

      const gi = document.getElementById('weekGoal');
      if (gi && !gi.value) gi.value = String(goal);
    }

    function renderStats(rows, groups) {
      const totalHours = rows.reduce((sum, row) => sum + Number(row.actualHoursManual), 0);
      const totalTips = rows.reduce((sum, row) => sum + Number(row.tips), 0);
      const avgTipsHour = totalHours ? totalTips / totalHours : 0;
      const currentWeek = rows.length ? rows[rows.length - 1].week.label : '—';
      const currentWeekRows = rows.filter(row => row.week.label === currentWeek);
      const currentWeekHours = currentWeekRows.reduce((sum, row) => sum + Number(row.actualHoursManual), 0);
      const currentWeekTips = currentWeekRows.reduce((sum, row) => sum + Number(row.tips), 0);
      const bestWeek = groups.reduce((best, group) => group.tips > (best?.tips ?? -1) ? group : best, null);

      // Overview tab: die vier Kernzahlen — kompakt, ohne Aufklappen.
      // „Stunden" stand hier früher doppelt (oben in der Soll/Ist-Karte als
      // „Gearbeitet"). Statt der Doppelung zeigen wir den Verdienst.
      const ovStats = document.getElementById('overviewStats');
      if (ovStats) ovStats.innerHTML = [
        ['Trinkgeld', eur(totalTips), 'Gesammelt · antippen', 'accent', 'tips'],
        ['Ø Trinkgeld/Std', eur(avgTipsHour), 'Durchschnitt · antippen', '', 'rate'],
        ['Beste Woche', bestWeek ? bestWeek.label : '—', bestWeek ? eur(bestWeek.tips) : 'Noch keine Daten', '', 'bestweek'],
        ['Schichten', String(rows.length), 'Alle Einträge · antippen', '', 'count'],
      ].map(([label, value, hint, cls, goto]) =>
        `<div class="qs-cell is-tap has-chev" role="button" tabindex="0" data-goto="${goto}">
          <div class="qs-label">${label}</div>
          <div class="qs-value ${cls}">${value}</div>
          <div class="qs-hint">${hint}</div>
        </div>`
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

        return '<tr class="month-row" data-month-detail="' + m + '" role="button" tabindex="0" title="Antippen für die Schichten dieses Monats"><td>' + monthName(m) + '</td>'
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
      renderSollIst();
      renderStats(rows, groups);
      renderProgress();
      renderMonthlyEarnings(rows);
      renderTrendChart(getTrendRows(rows));

      // Day tiles + Week cards + Prognose — entfernt (auf Wunsch), ersetzt durch Kalender-Tab

      // Wochenvergleich: Balken sind antippbar → Schichten der Woche
      const maxWeekHours = Math.max(...groups.map(group => group.hours), 0) || 1;
      const maxWeekTips = Math.max(...groups.map(group => group.tips), 0) || 1;
      document.getElementById('weekBars').innerHTML = groups.slice().reverse().map(group =>
        `<div class="bar-row is-tap" role="button" tabindex="0" data-week="${group.year}|${group.week}" title="Antippen für die Schichten">
          <div class="bar-label">${group.label}</div>
          <div>
            <div class="bar-track" title="${hrs(group.hours)}"><div class="bar-fill" style="width:${(group.hours / maxWeekHours) * 100}%"></div></div>
            <div class="bar-track" style="margin-top:6px;" title="${eur(group.tips)}"><div class="bar-fill tips" style="width:${(group.tips / maxWeekTips) * 100}%"></div></div>
          </div>
          <div class="bar-value">${hrs(group.hours)}<br>${eur(group.tips)}</div>
        </div>`
      ).join('') || '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Noch keine Wochen</div></div>';

      // Table
      document.getElementById('tableBody').innerHTML = rows.slice().reverse().map(row =>
        `<tr>
          <td>${weekdayName(row.date)}<br><span class="row-sub">${row.week.label}</span></td>
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
      ).join('') || '<tr><td colspan="6" class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Noch nüscht drin.</div><div class="empty-sub">Leg los und trag deine erste Schicht ein.</div></td></tr>';

      // Hide skeleton, show content
      const ovSk = document.getElementById('overviewSkeleton');
      const ovCt = document.getElementById('overviewContent');
      if (ovSk) ovSk.style.display = 'none';
      if (ovCt) ovCt.style.display = 'block';

      renderCalendar();
    }

    // ═══════════════════════════════════════
    //  Kalender-Link (iCal / ICS) → zukünftige Schichten
    // ═══════════════════════════════════════
    // Idee: Der Dienstplan liegt im Google/iCloud/Outlook-Kalender. Statt ihn
    // doppelt zu pflegen, liest die App den (geheimen, nur lesbaren) ICS-Link.
    // Alles wird nur gelesen und lokal zwischengespeichert (localStorage).
    const ICAL_KEY = 'azt-ical-url';
    const ICAL_CACHE_KEY = 'azt-ical-cache';
    const ICAL_CACHE_MS = 15 * 60 * 1000;   // 15 Min Cache — spart mobilen Traffic
    const ICAL_MIN_KEY = 'azt-ical-minshift';
    let icalEvents = [];
    let icalSyncedAt = 0;
    let icalBusy = false;

    function getIcalUrl() {
      try { return (localStorage.getItem(ICAL_KEY) || '').trim(); } catch (e) { return ''; }
    }

    function icalStatusAttr(text, cls) {
      const el = document.getElementById('icalStatus');
      if (!el) return;
      el.textContent = text;
      el.className = 'status ' + (cls || '');
    }

    // ── ICS-Text in Blöcke zerlegen (Zeilen entfalten ist Pflicht laut RFC 5545) ──
    function icalUnfold(text) {
      return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
    }
    function icalUnescape(s) {
      return String(s).replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
    }

    // Datum/Uhrzeit nach RFC 5545. getLocalDate = "ist ein lokaler Termin" (kein Z)
    function icalParseDT(value) {
      const v = String(value || '').trim();
      let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
      if (m) {
        const [, y, mo, d, h, mi, , z] = m;
        const isoDate = `${y}-${mo}-${d}`;
        if (z) {
          // UTC → in die Handy-Zeitzone umrechnen
          const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
          return {
            local: true,
            date: localIso(dt),
            minutes: dt.getHours() * 60 + dt.getMinutes(),
            hasTime: true,
          };
        }
        return { local: true, date: isoDate, minutes: +h * 60 + +mi, hasTime: true };
      }
      m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (m) return { local: true, date: `${m[1]}-${m[2]}-${m[3]}`, minutes: null, hasTime: false };
      return null;
    }

    function localIso(d) {
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    // Ein ICS-Text → Event-Liste
    function icalParse(text) {
      const lines = icalUnfold(text).split('\n');
      const events = [];
      let cur = null;
      let inTz = false;

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
        if (line === 'END:VEVENT') {
          if (cur) events.push(cur);
          cur = null;
          continue;
        }
        if (line === 'BEGIN:VTIMEZONE') { inTz = true; continue; }
        if (line === 'END:VTIMEZONE') { inTz = false; continue; }
        // In VTIMEZONEN stehen TZOFFSET/STANDARD-Zeilen — überspringen
        if (inTz) continue;
        if (!cur) continue;

        const ci = line.indexOf(':');
        if (ci < 0) continue;
        const head = line.slice(0, ci);
        const value = line.slice(ci + 1);
        const semi = head.indexOf(';');
        const key = (semi > 0 ? head.slice(0, semi) : head).toUpperCase();
        const params = semi > 0 ? head.slice(semi + 1) : '';
        const tzid = (params.match(/TZID=([^;:]+)/i) || [])[1];

        if (key === 'SUMMARY') cur.summary = icalUnescape(value);
        else if (key === 'DTSTART') {
          const dt = icalParseDT(value);
          if (dt) {
            cur.start = dt.date;
            cur.startMin = dt.minutes;
            cur.allDay = !dt.hasTime;
            cur.tz = tzid || '';
          }
        } else if (key === 'DTEND') {
          const dt = icalParseDT(value);
          if (dt) { cur.end = dt.date; cur.endMin = dt.minutes; }
        } else if (key === 'DURATION') {
          // DURATION kommt statt DTEND vor (z. B. PT8H30M)
          const dm = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i.exec(value.trim());
          if (dm && (dm[1] || dm[2] || dm[3])) {
            cur.durationMin = (+(dm[1] || 0)) * 1440 + (+(dm[2] || 0)) * 60 + (+(dm[3] || 0));
          }
        } else if (key === 'RRULE') {
          cur.rrule = value.trim();
        } else if (key === 'EXDATE') {
          // Kann mehrere Daten kommagetrennt enthalten
          (cur.exdates = cur.exdates || []).push(...value.split(',').map(icalParseDT).filter(Boolean).map(d => d.date));
        } else if (key === 'DESCRIPTION') cur.description = icalUnescape(value);
        else if (key === 'LOCATION') cur.location = icalUnescape(value);
        else if (key === 'STATUS') cur.status = value.trim().toUpperCase();
      }
      return events.filter(e => e.start && e.summary && /^(CONFIRMED|TENTATIVE)?$/.test(e.status || ''));
    }

    // ── RRULE: wiederkehrende Schichten entfalten ──
    // Tanda & Co. legen Schichten teils als einen VEVENT mit RRULE an (jede Woche
    // Mo/Mi/Fr). Ohne Entfaltung sähe die App nur die allererste Schicht.
    // Unterstützt: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY, COUNT, UNTIL.
    const WEEKDAY_CODE = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

    function icalExpandRrule(events) {
      const out = [];
      const MAX_INSTANCES = 500;   // Sicherheitsnetz gegen Endlos-Feeds

      for (const e of events) {
        if (!e.rrule) { out.push(e); continue; }

        const rule = {};
        for (const part of e.rrule.split(';')) {
          const [k, v] = part.split('=');
          if (k && v) rule[k.toUpperCase()] = v;
        }
        const freq = (rule.FREQ || '').toUpperCase();
        if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
          // Unbekannte Regel (z. B. HOURLY) → nur der Starttermin
          out.push({ ...e, rrule: null });
          continue;
        }

        const interval = Math.max(1, parseInt(rule.INTERVAL || '1', 10) || 1);
        const count = rule.COUNT ? parseInt(rule.COUNT, 10) : null;
        const untilDt = rule.UNTIL ? icalParseDT(rule.UNTIL) : null;
        const until = untilDt ? untilDt.date : null;
        const byDay = rule.BYDAY
          ? rule.BYDAY.split(',').map(x => WEEKDAY_CODE[x.replace(/^[+-]?\d+/, '').toUpperCase()]).filter(v => v !== undefined)
          : null;

        const base = new Date(e.start + 'T12:00:00');
        const exdates = new Set(e.exdates || []);
        const durDays = e.end ? Math.round((new Date(e.end + 'T12:00:00') - base) / 86400000) : 0;

        const push = (d) => {
          const iso = localIso(d);
          if (exdates.has(iso)) return true;          // abgesagt → überspringen
          const endD = new Date(d.getTime() + durDays * 86400000);
          out.push({
            ...e,
            start: iso,
            end: localIso(endD),
            rrule: null,
            instanceOf: e.start,
          });
          return true;
        };

        let made = 0;
        const limit = count || MAX_INSTANCES;

        if (freq === 'WEEKLY' && byDay && byDay.length) {
          // Alle passenden Wochentage ab Startdatum durchlaufen
          const startWeek = new Date(base);
          startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));
          for (let w = 0; made < limit && w < 520; w += interval) {
            for (const dow of byDay) {
              const d = new Date(startWeek);
              d.setDate(startWeek.getDate() + w * 7 + ((dow + 6) % 7));
              if (d < base) continue;
              const iso = localIso(d);
              if (until && iso > until) return out;
              push(d); made++;
              if (made >= limit) break;
            }
          }
        } else {
          const step = freq === 'DAILY' ? 1 : freq === 'WEEKLY' ? 7 : 0;
          for (let i = 0; made < limit && i < MAX_INSTANCES + 50; i++) {
            let d;
            if (freq === 'MONTHLY') {
              d = new Date(base.getFullYear(), base.getMonth() + i * interval, base.getDate(), 12);
              if (d.getDate() !== base.getDate()) continue;   // 31. in kurzem Monat → überspringen
            } else if (freq === 'YEARLY') {
              d = new Date(base.getFullYear() + i * interval, base.getMonth(), base.getDate(), 12);
            } else {
              d = new Date(base.getTime() + i * interval * step * 86400000);
            }
            const iso = localIso(d);
            if (until && iso > until) break;
            push(d); made++;
          }
        }
      }
      return out;
    }

    // Dauer in Minuten (angefangene Schicht zählt bis Ende; über Mitternacht wird korrekt gerechnet)
    function icalDuration(e) {
      // DURATION statt DTEND (kommt bei Tanda & Co. vor)
      if (e.startMin != null && e.durationMin) return e.durationMin;
      if (e.startMin == null || e.endMin == null) return e.durationMin || null;
      if (e.end > e.start) {
        const days = (new Date(e.end + 'T12:00:00') - new Date(e.start + 'T12:00:00')) / 86400000;
        return days * 1440 + (e.endMin - e.startMin);
      }
      let d = e.endMin - e.startMin;
      if (d < 0) d += 1440;
      return d || null;
    }

    function icalIsShift(e) {
      const d = icalDuration(e);
      // Schichten sind Termine MIT Uhrzeit. Ganztägige Blöcke („Urlaub", „frei") und
      // kurze Termine (Meeting, Arzt) sind keine Schicht.
      if (!d || d < icalMinShiftMin()) return false;
      if (/^(urlaub|frei|abwesend|krank|feiertag)/i.test(e.summary)) return false;
      return true;
    }

    // Ab welcher Dauer ein Termin als Schicht gilt.
    // FEST auf 4 h — bewusst nicht mehr einstellbar: der Kalender-Link ist der
    // Arbeitskalender (Tanda/Google), da stehen nur echte Schichten drin. Kurze
    // Termine werden weiterhin über die Uhrzeit-Prüfung (Start+Ende) ausgefiltert.
    function icalMinShiftMin() {
      return 240;
    }

    function hm(min) { return min == null ? '' : `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; }

    // ── Laden mit CORS-Umgehung ──
    // Wichtig: Dienstplan-Anbieter (Tanda, Deputy …) senden KEIN
    // Access-Control-Allow-Origin. Im Browser würde fetch() deshalb scheitern.
    // In der Android-App läuft alles in einer WebView — Capacitor bietet dafür
    // CapacitorHttp an, das die Anfrage nativ ausführt (kein CORS).
    // Reihenfolge: nativ zuerst, im Browser-Fallback normales fetch().
    async function icalLoadText(url) {
      const target = normalizeIcalUrl(url);
      const CapHttp = window.Capacitor?.Plugins?.CapacitorHttp;

      if (isNative && CapHttp) {
        const res = await CapHttp.get({
          url: target,
          headers: { Accept: 'text/calendar, text/plain, */*' },
          connectTimeout: 15000,
          readTimeout: 15000,
        });
        if (res.status >= 400) throw new Error('HTTP ' + res.status);
        // data kann String oder bereits geparstes Objekt sein
        return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      }

      // Browser/Vorschau: hier gilt CORS. Für lokale Tests und offene Feeds ok.
      const res = await fetch(target, { cache: 'no-store', redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }

    function icalFetch(force) {
      const url = getIcalUrl();
      if (!url) { icalEvents = []; return Promise.resolve([], false); }

      // Cache nutzen, wenn frisch genug
      if (!force) {
        try {
          const c = JSON.parse(localStorage.getItem(ICAL_CACHE_KEY) || 'null');
          if (c && c.url === url && Date.now() - c.at < ICAL_CACHE_MS) {
            icalEvents = c.events || [];
            icalSyncedAt = c.at || 0;
            return Promise.resolve(icalEvents, true);
          }
        } catch (e) {}
      }

      if (icalBusy) return Promise.resolve(icalEvents, true);
      icalBusy = true;
      icalStatusAttr('Kalender wird geladen …', '');
      return icalLoadText(url)
        .then(text => {
          if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Das ist kein iCal-Kalender.');
          // Erst RRULE entfalten (Tanda: eine Regel = viele Schichten), dann filtern
          const all = icalExpandRrule(icalParse(text));
          icalEvents = all.filter(icalIsShift);
          // Doppelte Termine (gleicher Tag, gleiche Startzeit) zusammenfassen
          const seen = new Set();
          icalEvents = icalEvents.filter(e => {
            const k = e.start + '|' + (e.startMin ?? 'all');
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          icalSyncedAt = Date.now();
          try {
            localStorage.setItem(ICAL_CACHE_KEY, JSON.stringify({ url, at: icalSyncedAt, events: icalEvents }));
          } catch (e) {}
          const open = icalEvents.filter(e => e.start >= localIso(new Date())).length;
          icalStatusAttr(`Verbunden — ${icalEvents.length} Schichten, davon ${open} noch offen.`, 'ok');
          return icalEvents;
        })
        .catch(err => {
          const msg = String(err.message || err);
          let hint = '';
          if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
            // Häufigste Ursachen der Reihe nach — ohne Fachbegriffe
            hint = ' Der Link ist nicht erreichbar. Prüfe: (1) ist er komplett kopiert, '
              + 'ohne Leerzeichen am Ende? (2) funktioniert er im Browser, wenn du ihn dort einfügst? '
              + '(3) ist er noch gültig — manche Anbieter erneuern ihn, wenn du das Passwort änderst?';
          } else if (/HTTP 40[13]/.test(msg)) {
            hint = ' Der Anbieter verweigert den Zugriff. Der Link ist vermutlich abgelaufen '
              + 'oder wurde neu erzeugt — hol ihn in der App deines Arbeitgebers noch einmal.';
          } else if (/kein iCal/i.test(msg)) {
            hint = ' Die Adresse liefert keinen Kalender. Das passiert, wenn statt des '
              + 'iCal-Links die normale Webseite kopiert wurde.';
          }
          icalStatusAttr('Kalender konnte nicht geladen werden (' + msg + ').' + hint, 'error');
          return icalEvents;
        })
        .finally(() => { icalBusy = false; });
    }

    function icalEventsForMonth(year, month) {
      const pre = `${year}-${pad2(month + 1)}`;
      return icalEvents.filter(e => e.start.startsWith(pre)).sort((a, b) => a.start.localeCompare(b.start) || (a.startMin || 0) - (b.startMin || 0));
    }

    function icalPlanRow(e, opts) {
      const dur = icalDuration(e);
      const done = state.rows.some(r => r.date === e.start);
      const time = e.startMin != null ? `${hm(e.startMin)}–${hm(e.endMin)}` : 'ganztägig';
      const hStr = dur ? (dur / 60).toFixed(1).replace('.', ',') + ' h' : '';
      const bruto = dur ? eur(dur / 60 * HOURLY_RATE) : '';
      const meta = [time, hStr, bruto ? '≈ ' + bruto : '', e.location || ''].filter(Boolean).join(' · ');
      const when = opts && opts.short
        ? `${compactDate(e.start)}<small>${weekdayName(e.start)}</small>`
        : `${e.start.slice(8, 10)}.${e.start.slice(5, 7)}.`;
      return `<button class="plan-row" type="button" onclick="openCalDay('${e.start}')">
        <span class="plan-when">${when}</span>
        <span class="plan-main">
          <span class="plan-title">${escapeHtml(e.summary)}</span>
          <span class="plan-meta">${escapeHtml(meta)}</span>
        </span>
        <span class="plan-badge ${done ? 'done' : 'open'}">${done ? 'erfasst' : 'offen'}</span>
      </button>`;
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function renderUpcoming() {
      const box = document.getElementById('calUpcoming');
      if (!box) return;
      if (!getIcalUrl()) {
        box.innerHTML = '<div class="plan-empty">Noch kein Kalender verbunden. Unter <strong>Datenbank → Kalender-Link</strong> den iCal-Link eintragen — dann stehen hier alle kommenden Schichten.</div>';
        return;
      }
      const today = localIso(new Date());
      const next = icalEvents
        .filter(e => e.start >= today)
        .sort((a, b) => a.start.localeCompare(b.start) || (a.startMin || 0) - (b.startMin || 0))
        .slice(0, 6);
      box.innerHTML = next.length
        ? '<div class="plan-list">' + next.map(e => icalPlanRow(e, { short: true })).join('') + '</div>'
        : '<div class="plan-empty">Keine kommenden Schichten im Kalender gefunden. Link prüfen oder auf „Aktualisieren“ (Pull-to-Refresh).</div>';
    }

    function renderMonthShifts(year, month) {
      const body = document.getElementById('calMonthShiftsBody');
      const card = document.getElementById('calMonthShiftsCard');
      if (!body) return;
      if (!getIcalUrl()) { if (card) card.style.display = 'none'; return; }
      if (card) card.style.display = '';
      const rows = icalEventsForMonth(year, month);
      body.innerHTML = rows.length
        ? rows.map(e => {
            const dur = icalDuration(e);
            const done = state.rows.some(r => r.date === e.start);
            return `<tr onclick="openCalDay('${e.start}')" style="cursor:pointer;">
              <td>${compactDate(e.start)}<br><span style="color:var(--muted);font-size:11px;">${weekdayName(e.start)}</span></td>
              <td>${escapeHtml(e.summary)}${done ? ' <span class="plan-badge done">erfasst</span>' : ''}</td>
              <td class="right">${e.startMin != null ? hm(e.startMin) + '–' + hm(e.endMin) : '—'}</td>
              <td class="right">${dur ? (dur / 60).toFixed(1).replace('.', ',') : '—'}</td>
              <td class="right">${dur ? '≈ ' + eur(dur / 60 * HOURLY_RATE) : '—'}</td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="5" class="empty-state"><div class="empty-icon">🗓️</div><div class="empty-title">Keine geplanten Schichten.</div><div class="empty-sub">In diesem Monat steht nichts im Kalender.</div></td></tr>';
    }

    // ── Link normalisieren ──
    // Dienstplan-Anbieter (Tanda, Deputy, Personio …) geben den Link in sehr
    // unterschiedlichen Formen aus. Statt den Nutzer mit „muss mit https:// beginnen"
    // abzuweisen, reparieren wir die Eingabe:
    //   webcal://host/x        → https://host/x        (iOS-Abo-Konvention)
    //   host/x                 → https://host/x        (ohne Protokoll kopiert)
    //   http://host/x          → https://host/x        (App läuft unter https)
    //   "…ics" mit Leerzeichen → getrimmt
    function normalizeIcalUrl(input) {
      let s = String(input || '').trim();
      if (!s) return '';

      // Kopierte Links kommen manchmal mit Anführungszeichen oder als Markdown
      s = s.replace(/^[<"'\[]+/, '').replace(/[>"'\]]+$/, '').trim();

      // Relativer Pfad (z. B. "/kalender.ics") — für lokale Tests/Intranet.
      // Bleibt relativ, damit fetch() ihn gegen den aktuellen Origin auflöst.
      if (/^\/[^/]/.test(s)) return s;

      // webcal → https (fetch kann webcal:// nicht laden)
      s = s.replace(/^webcal:\/\//i, 'https://');
      // webcals (Safari-Variante) ebenfalls
      s = s.replace(/^webcals:\/\//i, 'https://');

      // Ohne Protokoll: Punkt im ersten Segment = Hostname
      // („localhost:8091/x" hat keinen Punkt — das ist auch ein gültiger Host)
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
        if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(s) || /^localhost(?::\d+)?(?:[/?#]|$)/i.test(s)) s = 'https://' + s;
        else return '';
      }

      // http → https, damit es im WebView nicht als Mixed Content blockiert wird
      s = s.replace(/^http:\/\//i, 'https://');

      // Leerzeichen im Pfad kodieren (kommt bei kopierten Links vor)
      s = s.replace(/ /g, '%20');

      return s;
    }

    // Einstellungen: Link speichern / entfernen
    window.saveIcalSettings = async function () {
      const raw = (document.getElementById('icalUrl')?.value || '').trim();
      if (!raw) { icalStatusAttr('Bitte einen Kalender-Link eingeben.', 'error'); return; }

      const url = normalizeIcalUrl(raw);
      if (!url) {
        icalStatusAttr('Das sieht nicht wie ein Link aus. Beispiel: '
          + 'https://eu.tanda.co/… — oder der Link beginnt mit webcal://', 'error');
        return;
      }
      // Nutzer sehen, was tatsächlich gespeichert wird (Transparenz bei webcal→https)
      const inp = document.getElementById('icalUrl');
      if (inp) inp.value = url;

      try { localStorage.setItem(ICAL_KEY, url); } catch (e) {}
      try { localStorage.removeItem(ICAL_CACHE_KEY); } catch (e) {}
      icalEvents = [];
      await icalFetch(true);
      await renderCalendar();
    };

    window.clearIcalSettings = async function () {
      try { localStorage.removeItem(ICAL_KEY); localStorage.removeItem(ICAL_CACHE_KEY); } catch (e) {}
      icalEvents = [];
      icalSyncedAt = 0;
      const inp = document.getElementById('icalUrl');
      if (inp) inp.value = '';
      icalStatusAttr('Kalender-Link entfernt.', '');
      await renderCalendar();
    };

    function initIcalSettings() {
      const inp = document.getElementById('icalUrl');
      if (inp && !inp.value) inp.value = getIcalUrl();
    }

    // ── Diagnose: zeigt, was im Feed WIRKLICH steckt ──
    // Nötig, weil Dienstplan-Anbieter (z.B. Tanda) ihr ICS-Format nicht dokumentieren.
    // Statt zu raten: einmal den echten Feed auswerten und die Befunde anzeigen.
    window.diagnoseIcal = async function () {
      const url = getIcalUrl();
      if (!url) { icalStatusAttr('Kein Link hinterlegt.', 'error'); return; }
      icalStatusAttr('Analysiere Feed …', '');
      try {
        const text = await icalLoadText(url);
        const raw = icalParse(text);

        const withZ = (text.match(/DTSTART[^:\r\n]*:\d{8}T\d{6}Z/g) || []).length;
        const withTz = (text.match(/DTSTART;TZID=/g) || []).length;
        const floating = (text.match(/DTSTART:\d{8}T\d{6}(?!Z)/g) || []).length;
        const allDay = (text.match(/DTSTART;VALUE=DATE:/g) || []).length;
        const rrules = (text.match(/^RRULE/gm) || []).length;
        const rruleTypes = [...new Set((text.match(/RRULE:[^\r\n]*FREQ=[A-Z]+/g) || [])
          .map(s => s.replace(/.*FREQ=/, '').split(';')[0]))];
        const exdates = (text.match(/^EXDATE/gm) || []).length;
        const durations = (text.match(/^DURATION/gm) || []).length;
        const statuses = {};
        for (const e of raw) statuses[e.status || 'CONFIRMED'] = (statuses[e.status || 'CONFIRMED'] || 0) + 1;

        const expanded = icalExpandRrule(raw);
        const shifts = expanded.filter(icalIsShift);

        const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

        const lines = [
          ['VEVENTs im Feed', raw.length],
          ['Schichten nach Filter', shifts.length],
          ['Termine durch RRULE zusätzlich', expanded.length - raw.length],
          ['Zeit UTC (Z)', withZ],
          ['Zeit mit TZID', withTz],
          ['Zeit lokal/floating', floating],
          ['Ganztägig', allDay],
          ['RRULE-Regeln', rrules],
          ['RRULE-Typen', rruleTypes.length ? rruleTypes.join(', ') : '—'],
          ['EXDATE (Absagen)', exdates],
          ['DURATION statt DTEND', durations],
          ['Status', Object.entries(statuses).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'],
          ['Beispiel-SUMMARY', raw[0] ? (raw[0].summary || '—') : '—'],
        ];

        let box = document.getElementById('icalDiag');
        if (!box) {
          box = document.createElement('div');
          box.id = 'icalDiag';
          box.className = 'diag';
          document.getElementById('icalStatus')?.after(box);
        }
        box.innerHTML = `<div class="diag-title">Feed-Diagnose</div>
          <div class="diag-rows">${lines.map(([k, v]) =>
            `<div class="diag-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
          <div class="diag-note">Wenn „RRULE-Regeln“ &gt; 0 ist, entfaltet die App sie bereits.
          Bei „Zeit UTC“ &gt; 0 wird korrekt in deine Zeitzone umgerechnet.</div>`;
        icalStatusAttr('Diagnose fertig.', 'ok');
      } catch (err) {
        icalStatusAttr('Diagnose fehlgeschlagen: ' + (err.message || err), 'error');
      }
    };

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
      // Kalender-Link: gecachte Schichten, bei Bedarf nachladen
      if (getIcalUrl()) await icalFetch(false);
      const planMap = new Map();
      for (const e of icalEvents) {
        if (!planMap.has(e.start)) planMap.set(e.start, []);
        planMap.get(e.start).push(e);
      }

      const first = new Date(year, month, 1);
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const lead = (first.getDay() + 6) % 7;   // Montag = 0
      const todayIso = localIso(new Date());

      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<div class="cal-cell empty"></div>';

      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${year}-${pad2(month + 1)}-${pad2(d)}`;
        const entry = entryMap.get(iso);
        const leave = leaveMap.get(iso);
        const plans = planMap.get(iso);
        const plan = plans ? plans[0] : null;
        const cls = ['cal-cell'];
        if (iso === todayIso) cls.push('today');
        if (plan) cls.push('planned');
        if (leave) cls.push(LEAVE_CLASS[leave.type] || 'leave-paid');
        else if (entry) cls.push('work');

        let sub = '';
        if (leave) sub = LEAVE_SHORT[leave.type] || 'Urlaub';
        else if (entry) sub = (+entry.actualHoursManual).toFixed(1).replace('.', ',') + 'h';
        else if (plan) {
          // geplante Schicht: Uhrzeit statt Stunden (dünn, damit es nicht mit erfassten Zeiten verwechselt wird)
          sub = plan.startMin != null ? hm(plan.startMin) : 'geplant';
        }

        cells += `<button class="${cls.join(' ')}" type="button" onclick="openCalDay('${iso}')"${plan ? ` title="${escapeHtml(plan.summary)}"` : ''}>
          <span class="cal-num">${d}</span>
          ${sub ? `<span class="cal-sub">${sub}</span>` : ''}
          ${plan ? '<span class="cal-corner"></span>' : ''}
        </button>`;
      }
      grid.innerHTML = cells;

      // Nächste Schichten + geplante Schichten im Monat
      renderUpcoming();
      renderMonthShifts(year, month);

      // Monatszusammenfassung
      const monthPrefix = `${year}-${pad2(month + 1)}`;
      const mRows = state.rows.filter(r => r.date.startsWith(monthPrefix));
      const mHours = mRows.reduce((s, r) => s + Number(r.actualHoursManual), 0);
      const mTips = mRows.reduce((s, r) => s + Number(r.tips), 0);
      const mLeave = leaveAll.filter(l => l.date.startsWith(monthPrefix));
      const paid = mLeave.filter(l => l.type === 'paid').length;
      const unpaid = mLeave.filter(l => l.type === 'unpaid').length;

      const cs = document.getElementById('calSummary');
      if (cs) {
        const metrics = [
          ['Arbeitstage', String(mRows.length), 'Einträge in diesem Monat'],
          ['Stunden', hrs(mHours), 'Diesen Monat gearbeitet'],
          ['Trinkgeld', eur(mTips), 'Diesen Monat gesammelt'],
          ['Brutto', eur(mHours * HOURLY_RATE), `${HOURLY_RATE.toFixed(2).replace('.', ',')} €/h`],
        ];
        // Geplante Schichten aus dem Kalender-Link (nur wenn verbunden)
        const mPlans = icalEventsForMonth(year, month);
        if (mPlans.length) {
          const planMin = mPlans.reduce((s, e) => s + (icalDuration(e) || 0), 0);
          const openPlans = mPlans.filter(e => !mRows.some(r => r.date === e.start));
          const openMin = openPlans.reduce((s, e) => s + (icalDuration(e) || 0), 0);
          metrics.push(['Geplant', `${mPlans.length} Schichten`, `${hrs(planMin / 60)} im Dienstplan`]);
          metrics.push(['Noch offen', `${openPlans.length} Schichten`, openPlans.length ? `≈ ${eur(openMin / 60 * HOURLY_RATE)} fehlen` : 'alles erfasst']);
        }
        cs.innerHTML = metrics.map(([l, v, h]) =>
          `<div class="metric"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`
        ).join('');
      }

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
        // Geplante Schicht aus dem Kalender-Link? Dann Uhrzeit direkt übernehmen.
        const plan = icalEvents.find(e => e.start === iso);
        if (plan && icalDuration(plan)) {
          const dur = icalDuration(plan);
          buttons.push({ label: `📅 Plan übernehmen (${hm(plan.startMin)}–${hm(plan.endMin)}, ${(dur / 60).toFixed(2).replace('.', ',')} h)`, action: () => {
            resetForm();
            form.date.value = iso;
            form.hours.value = String(dur / 60).replace('.', ',').slice(0, 5);
            if (form.note) form.note.value = plan.summary;
            activateTab('capture');
            showToast('Plan übernommen — Stunden prüfen und speichern');
          }});
        }
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
      try { await loadData(); await icalFetch(true); showToast('Daten aktualisiert 😺'); }
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

      // ── Update bestehender Eintrag? ──
      // editingDate ist der ursprüngliche Datums-Schlüssel (Primary Key in Dexie).
      // Ändert der Nutzer beim Bearbeiten das Datum (z. B. Sonntag → Montag), muss
      // der ALTE Eintrag gelöscht und der neue angelegt werden. Ohne das entstünde
      // ein zweiter Eintrag und der alte bliebe stehen (Bug bis 11/2026).
      const oldDate = state.editingDate;
      const isEdit = !!oldDate;
      const dateChanged = isEdit && oldDate !== date;

      if (isEdit && dateChanged) {
        // Ziel-Tag schon belegt? Dann nicht stillschweigend überschreiben.
        const clash = state.rows.find(r => r.date === date && r.date !== oldDate);
        if (clash) {
          return setStatus(`Am ${dateFmt(date)} gibt es schon einen Eintrag. Bitte dort bearbeiten oder den Tag zuerst leeren.`, 'error');
        }
        await db.entries.put({ date, actualHoursManual: hours, tips, note: note || '' });
        await db.entries.delete(oldDate);
      } else {
        // Neuer Eintrag oder Bearbeitung ohne Datumswechsel: put() reicht
        await db.entries.put({ date, actualHoursManual: hours, tips, note: note || '' });
      }

      await loadData();
      showToast(dateChanged ? 'Schicht verschoben 😺' : (isEdit ? 'Schicht aktualisiert 😺' : 'Schicht gespeichert 😺'));
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
