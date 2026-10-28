
  <script>
    // ═══════════════════════════════════════
    //  Arbeitszeit — Offline APK (Dexie)
    // ═══════════════════════════════════════

    // ── Database ──
    const db = new Dexie("arbeitszeit");
    db.version(1).stores({ entries: "date", clockEvents: "++id" });

    // ── Constants ──
    const STORAGE_KEY = "azt-state";
    const THEME_KEY = "azt-theme";
    const HOURLY_RATE = 13.90;
    const TAX_RATE = 0.75;

    // ── State ──
    const state = {
      rows: [], editingDate: null, saving: false,
      trendMode: "week", trendWeekKey: "", trendMonth: "",
      activeTab: "home", loaded: false
    };

    // ── User ──
    document.getElementById("userBadge").style.display = "inline-flex";
    document.getElementById("userBadgeName").textContent = "JD";

    // ── Format helpers ──
    const eur = v => new Intl.NumberFormat("de-DE", { style:"currency", currency:"EUR" }).format(+v||0);
    const hrs = v => (+v||0).toFixed(2).replace(".", ",") + " h";
    const dateFmt = v => v ? new Intl.DateTimeFormat("de-DE", { weekday:"short", day:"2-digit", month:"2-digit", year:"numeric" }).format(new Date(v+"T12:00:00")) : "—";
    const compactDate = v => v ? new Intl.DateTimeFormat("de-DE", { day:"2-digit", month:"2-digit" }).format(new Date(v+"T12:00:00")) : "—";
    const weekdayName = v => v ? new Intl.DateTimeFormat("de-DE", { weekday:"long" }).format(new Date(v+"T12:00:00")) : "";
    const todayStr = () => new Date().toISOString().slice(0,10);

    // ── ISO Week ──
    function isoWeekInfo(dateStr) {
      const d = new Date(dateStr + "T12:00:00");
      const oy = d.getFullYear();
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day + 3);
      const j4 = new Date(d.getFullYear(), 0, 4);
      const j4d = (j4.getDay() + 6) % 7;
      j4.setDate(j4.getDate() - j4d + 3);
      const wk = 1 + Math.round((d - j4) / 604800000);
      return { year: oy, week: wk, label: "KW" + wk };
    }

    function normalizeRow(row) {
      const h = +row.actualHoursManual || 0;
      const t = +row.tips || 0;
      return {
        date: row.date, actualHoursManual: h.toFixed(2), tips: t.toFixed(2),
        note: row.note || weekdayName(row.date),
        week: row.date ? isoWeekInfo(row.date) : { year:"", week:"", label:"—" }
      };
    }

    // ── DOM refs ──
    const $ = id => document.getElementById(id);
    const tabButtons = [...document.querySelectorAll(".tab-btn")];
    const form = { date: $("date"), hours: $("hours"), tips: $("tipsInput"), note: $("note") };
    const trendControls = {
      mode: $("trendMode"), week: $("trendWeek"), month: $("trendMonth"),
      weekWrap: $("trendWeekWrap"), monthWrap: $("trendMonthWrap")
    };

    // ═══════════════════════════════════════
    //  UI Helpers
    // ═══════════════════════════════════════

    function toggleUserMenu(e) {
      e.stopPropagation();
      $("userDropdown").classList.toggle("open");
    }
    document.addEventListener("click", () => $("userDropdown").classList.remove("open"));

    let toastTimer = null;
    function showToast(msg, dur) {
      const el = $("toast");
      el.textContent = msg; el.classList.add("visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove("visible"), dur || 2200);
    }

    let sheetCb = null;
    function showSheet(title, buttons) {
      $("sheetBody").innerHTML = buttons.map((b,i) =>
        `<button class="sheet-btn${b.danger?" danger":""}" onclick="window._sa(${i})">${b.label}</button>`
      ).join("");
      $("sheetOverlay").classList.add("open"); $("sheet").classList.add("open");
      sheetCb = i => { hideSheet(); buttons[i]?.action?.(); };
    }
    window._sa = i => sheetCb?.(i);
    function hideSheet() {
      $("sheetOverlay").classList.remove("open"); $("sheet").classList.remove("open");
      sheetCb = null;
    }
    $("sheetOverlay").addEventListener("click", hideSheet);

    function initTheme() {
      applyTheme(localStorage.getItem(THEME_KEY) || (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light"));
    }
    function applyTheme(t) {
      document.documentElement.setAttribute("data-theme", t);
      $("themeIcon").textContent = t === "dark" ? "🌙" : "☀️";
      $("themeLabel").textContent = t === "dark" ? "Dunkel" : "Hell";
      localStorage.setItem(THEME_KEY, t);
    }
    $("themeToggle")?.addEventListener("click", () => {
      applyTheme((document.documentElement.getAttribute("data-theme")||"light") === "dark" ? "light" : "dark");
    });

    function persistState() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeTab: state.activeTab, trendMode: state.trendMode,
        trendWeekKey: state.trendWeekKey, trendMonth: state.trendMonth
      })); } catch(_) {}
    }
    function restoreState() {
      try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s) Object.assign(state, s); } catch(_) {}
    }
    function setStatus(text, cls) {
      const el = $("status"); el.textContent = text; el.className = "status " + (cls||"");
    }

    // ═══════════════════════════════════════
    //  Data Layer (Dexie)
    // ═══════════════════════════════════════

    async function loadData() {
      try {
        const raw = await db.entries.orderBy("date").toArray();
        state.rows = raw.filter(r => r.date).map(normalizeRow);
        state.loaded = true;
        render();
        setStatus(state.rows.length + " Einträge geladen.", "ok");
      } catch(e) {
        setStatus(e.message, "error");
        $("homeSkeleton").style.display = "none";
        $("homeContent").style.display = "block";
        render();
      }
    }
    async function saveEntry(row) {
      return db.entries.put({ date: row.date, actualHoursManual: row.actualHoursManual, tips: row.tips, note: row.note });
    }
    async function deleteEntry(date) { return db.entries.delete(date); }

    function exportCSV() {
      $("userDropdown").classList.remove("open");
      const rows = state.rows;
      if (!rows.length) { alert("Keine Daten zum Exportieren."); return; }
      function esc(v) {
        let s = v == null ? "" : String(v);
        if (/[;"\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }
      const tagOf = d => ["So","Mo","Di","Mi","Do","Fr","Sa"][new Date(d).getDay()];
      const lines = [["Datum","Tag","Stunden","Trinkgeld","Notiz","KW"].join(";")];
      for (const r of rows) lines.push([r.date, tagOf(r.date), r.actualHoursManual, r.tips, r.note||"", r.week?.label||""].map(esc).join(";"));
      const csv = "\uFEFF" + lines.join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
      a.download = "arbeitszeit-export.csv"; a.click(); URL.revokeObjectURL(a.href);
    }
    window.exportCSV = exportCSV;

    function importCSV() {
      $("userDropdown").classList.remove("open");
      const input = document.createElement("input");
      input.type = "file"; input.accept = ".csv";
      input.onchange = e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          let text = ev.target.result;
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
          const lines = text.split(/\r?\n/).filter(l => l.trim());
          if (lines.length < 2) { alert("CSV ist leer."); return; }
          const ops = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(";");
            const date = (cols[0]||"").trim();
            const hours = parseFloat((cols[2]||"0").replace(",","."));
            const tips = parseFloat((cols[3]||"0").replace(",","."));
            const note = (cols[4]||"").trim();
            if (!date || isNaN(hours)) continue;
            ops.push({ date, actualHoursManual: hours.toFixed(2), tips: tips.toFixed(2), note });
          }
          if (!ops.length) { alert("Keine gültigen Zeilen."); return; }
          ops.sort((a,b) => a.date.localeCompare(b.date));
          db.entries.bulkPut(ops).then(() => { showToast(ops.length + " Einträge importiert"); loadData(); })
            .catch(err => alert("Import fehlgeschlagen: " + err.message));
        };
        reader.readAsText(file);
      };
      input.click();
    }
    window.importCSV = importCSV;
