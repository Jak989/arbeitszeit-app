
    // ═══════════════════════════════════════
    //  Tabs
    // ═══════════════════════════════════════

    function activateTab(id) {
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === id));
      tabButtons.forEach(b => b.classList.toggle("active", b.dataset.target === id));
      state.activeTab = id; persistState();
    }

    function getTrendRows(rows) {
      if (!rows.length) return rows;
      const latest = rows[rows.length-1];
      if (state.trendMode === "week")
        return rows.filter(r => r.week.year === latest.week.year && r.week.week === latest.week.week);
      if (state.trendMode === "kw") {
        const key = state.trendWeekKey || (latest.week.year + "-" + latest.week.week);
        return rows.filter(r => (r.week.year + "-" + r.week.week) === key);
      }
      if (state.trendMode === "month") {
        const m = state.trendMonth || latest.date.slice(0,7);
        return rows.filter(r => r.date.startsWith(m));
      }
      return rows;
    }

    function syncTrendControls(rows, groups) {
      trendControls.mode.value = state.trendMode;
      if (!state.trendMonth && rows.length) state.trendMonth = rows[rows.length-1].date.slice(0,7);
      if (!state.trendWeekKey && groups.length) {
        const lg = groups[groups.length-1];
        state.trendWeekKey = lg.year + "-" + lg.week;
      }
      trendControls.week.innerHTML = groups.map(g => {
        const k = g.year + "-" + g.week;
        return `<option value="${k}">${g.label} \u00b7 ${g.year}</option>`;
      }).join("");
      trendControls.week.value = state.trendWeekKey;
      trendControls.month.value = state.trendMonth;
      trendControls.weekWrap.style.display = state.trendMode === "kw" ? "" : "none";
      trendControls.monthWrap.style.display = state.trendMode === "month" ? "" : "none";
    }

    // ═══════════════════════════════════════
    //  Render Engine
    // ═══════════════════════════════════════

    function renderStats(rows, groups) {
      const tH = rows.reduce((s,r) => s + +r.actualHoursManual, 0);
      const tT = rows.reduce((s,r) => s + +r.tips, 0);
      const aTH = tH ? tT/tH : 0;
      const cw = rows.length ? rows[rows.length-1].week.label : "\u2014";
      const cwR = rows.filter(r => r.week.label === cw);
      const cwH = cwR.reduce((s,r) => s + +r.actualHoursManual, 0);
      const cwT = cwR.reduce((s,r) => s + +r.tips, 0);
      const bestW = groups.reduce((b,g) => g.tips > (b?.tips??-1) ? g : b, null);

      $("homeStats").innerHTML = [
        ["Stunden gesamt", hrs(tH), "Alle gespeicherten Schichten"],
        ["Trinkgeld gesamt", eur(tT), "Sauber aufsummiert"],
        ["\u00d8 Trinkgeld pro Stunde", eur(aTH), "Hilft beim Einordnen"],
        ["Beste Woche", bestW ? bestW.label + " \u00b7 " + eur(bestW.tips) : "\u2014", "St\u00e4rkste KW bisher"]
      ].map(([l,v,h]) => `<div class="metric"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`).join("");

      $("weekFocus").innerHTML = [
        ["Aktuelle KW", cw, "Die neueste Kalenderwoche"],
        ["Stunden", hrs(cwH), "In dieser Woche erfasst"],
        ["Trinkgeld", eur(cwT), "F\u00fcr diese Woche gesamt"],
        ["\u00d8 pro Stunde", eur(cwH ? cwT/cwH : 0), "Diese Woche"]
      ].map(([l,v,h]) => `<div class="metric"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`).join("");

      const bestDay = rows.reduce((b,r) => +r.tips > (+b?.tips||-1) ? r : b, null);
      const longest = rows.reduce((b,r) => +r.actualHoursManual > (+b?.actualHoursManual||-1) ? r : b, null);
      const aStats = [
        ["Eintr\u00e4ge", String(rows.length), "Anzahl gespeicherter Schichten"],
        ["Wochen", String(groups.length), "Kalenderwochen mit Daten"],
        ["Bester Tag", bestDay ? bestDay.week.label + " \u00b7 " + eur(bestDay.tips) : "\u2014", "H\u00f6chstes Trinkgeld an einem Tag"],
        ["L\u00e4ngste Schicht", longest ? hrs(longest.actualHoursManual) : "\u2014", "Maximale Dauer"]
      ];
      $("analysisStats").innerHTML = aStats.map(([l,v,h]) =>
        `<div class="metric"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`
      ).join("");
      const aps = $("analysisPanelStats");
      if (aps) aps.innerHTML = $("analysisStats").innerHTML;

      const last = rows[rows.length-1];
      $("lastShiftCard").innerHTML = last
        ? `<div class="metric"><div class="label">${dateFmt(last.date)} \u00b7 ${last.week.label}</div><div class="value">${hrs(last.actualHoursManual)}</div><div class="hint">${eur(last.tips)} \u00b7 ${last.note||"Ohne Notiz"}</div></div>`
        : `<div class="metric"><div class="label">Noch nichts drin</div><div class="value">\u2014</div><div class="hint">Sobald du eine Schicht eintr\u00e4gst, taucht sie hier auf.</div></div>`;
    }

    function renderMonthlyEarnings(rows) {
      const months = new Map();
      for (const r of rows) {
        const m = r.date.slice(0,7);
        const p = months.get(m) || { h:0, t:0 };
        months.set(m, { h: p.h + +r.actualHoursManual, t: p.t + +r.tips });
      }
      const sorted = [...months.keys()].sort();
      const eF = v => new Intl.NumberFormat("de-DE", { style:"currency", currency:"EUR" }).format(v);
      const mN = m => new Intl.DateTimeFormat("de-DE", { month:"long", year:"numeric" }).format(new Date(m+"-15T12:00:00"));

      $("monthlyEarningsBody").innerHTML = sorted.slice().reverse().map(m => {
        const d = months.get(m);
        const b = d.h * HOURLY_RATE, n = b * TAX_RATE;
        const rate = d.h ? d.t/d.h : 0, ges = n + d.t;
        const sv = localStorage.getItem("netto_"+m) || "";
        const ist = sv ? (+sv.replace(",",".")||0) : 0;
        const diff = ist ? ist - n : 0;
        const dc = diff > 0 ? "color:#30d158" : (diff < 0 ? "color:#ff453a" : "");
        return `<tr><td>${mN(m)}</td><td class="right">${hrs(d.h)}</td><td class="right">${eF(d.t)}</td><td class="right">${eF(rate)}</td><td class="right">${eF(b)}</td><td class="right">${eF(n)}</td><td class="right"><input type="text" inputmode="decimal" style="min-height:unset;padding:4px 6px;width:80px;font-size:13px;text-align:right" placeholder="0" value="${sv}" onchange="localStorage.setItem('netto_'+this.dataset.month,this.value);location.reload()" data-month="${m}"></td><td class="right" style="${dc}">${ist?eF(diff):"\u2014"}</td><td class="right">${eF(ges)}</td></tr>`;
      }).join("") + yrRow(sorted, months, eF);
    }

    function yrRow(sorted, months, eF) {
      let tH=0, tT=0, tB=0, tN=0, tG=0;
      for (const m of sorted) {
        const d = months.get(m); tH += d.h; tT += d.t;
        const b = d.h * HOURLY_RATE; tB += b; tN += b * TAX_RATE; tG += (b*TAX_RATE)+d.t;
      }
      return `<tr style="font-weight:700;border-top:2px solid var(--line)"><td>\ud83d\udcc5 Gesamtjahr</td><td class="right">${hrs(tH)}</td><td class="right">${eF(tT)}</td><td class="right">${eF(tH?tT/tH:0)}</td><td class="right">${eF(tB)}</td><td class="right">${eF(tN)}</td><td class="right">\u2014</td><td class="right">\u2014</td><td class="right">${eF(tG)}</td></tr>`;
    }

    function renderForecast(rows) {
      const el = $("forecastGrid");
      if (!rows.length) {
        el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">\ud83d\udd2e</div><div class="empty-title">Noch keine Daten</div><div class="empty-sub">Trag erstmal ein paar Schichten ein.</div></div>`;
        return;
      }
      const latest = rows[rows.length-1], cm = latest.date.slice(0,7);
      const cy = +cm.slice(0,4), cmn = +cm.slice(5,7);
      const mR = rows.filter(r => r.date.startsWith(cm));
      const dim = new Date(cy, cmn, 0).getDate();
      const now = new Date();
      const elap = Math.max(now.getDate(), mR.length ? Math.max(...mR.map(r => +r.date.slice(8,10))) : 1);
      const pct = Math.min(100, (elap/dim)*100);
      const mH = mR.reduce((s,r) => s + +r.actualHoursManual, 0);
      const mT = mR.reduce((s,r) => s + +r.tips, 0);
      const allD = rows.length, allH = rows.reduce((s,r) => s + +r.actualHoursManual, 0);
      const allT = rows.reduce((s,r) => s + +r.tips, 0);
      const adh = allD ? allH/allD : 0, adt = allD ? allT/allD : 0;
      const rem = dim - elap;
      const mName = new Intl.DateTimeFormat("de-DE", { month:"long", year:"numeric" }).format(new Date(cy, cmn-1));
      el.innerHTML = [
        `<div class="forecast-card"><div class="fc-label">Monat</div><div class="fc-value">${mName}</div><div class="fc-hint">Aktuelle Periode</div><div class="fc-bar"><div class="fc-bar-fill" style="width:${pct}%"></div></div></div>`,
        `<div class="forecast-card"><div class="fc-label">Bisherige Stunden</div><div class="fc-value">${hrs(mH)}</div><div class="fc-hint">${elap} von ${dim} Tagen</div></div>`,
        `<div class="forecast-card"><div class="fc-label">Voraussichtlich</div><div class="fc-value">${hrs(mH+adh*Math.max(0,rem))}</div><div class="fc-hint">Hochrechnung Monatsende</div></div>`,
        `<div class="forecast-card"><div class="fc-label">Bisher Trinkgeld</div><div class="fc-value">${eur(mT)}</div><div class="fc-hint">${mR.length} Eintr\u00e4ge diesen Monat</div></div>`,
        `<div class="forecast-card"><div class="fc-label">Voraussichtlich</div><div class="fc-value">${eur(mT+adt*Math.max(0,rem))}</div><div class="fc-hint">Prognose Monats-Trinkgeld</div></div>`,
        `<div class="forecast-card"><div class="fc-label">\u00d8 pro Tag</div><div class="fc-value">${eur(adt)}</div><div class="fc-hint">${rem} Tage verbleiben</div></div>`
      ].join("");
    }

    function renderTrendChart(trendRows) {
      const chart = $("trendChart");
      if (!trendRows.length) {
        chart.innerHTML = `<text x="50%" y="50%" fill="#6e6e73" text-anchor="middle" dominant-baseline="middle">Keine Daten f\u00fcr diesen Filter.</text>`;
        return;
      }
      const W=760, H=280, pad={t:20,r:46,b:34,l:42};
      const iW=W-pad.l-pad.r, iH=H-pad.t-pad.b;
      const dark = document.documentElement.getAttribute("data-theme")==="dark";
      const gc = dark ? "rgba(255,255,255,0.1)" : "rgba(60,60,67,0.12)";
      const tc = dark ? "#98989d" : "#6e6e73";
      const hc="#0a84ff", tipC="#ffd60a";
      const hrM=15, tipM=50;
      const yH=v=>pad.t+iH-(v/hrM)*iH, yT=v=>pad.t+iH-(v/tipM)*iH;
      const n=trendRows.length, gW=iW/n, barW=Math.min(gW*.32,28), gap=gW*.04;
      let svg = "";
      for (let i=0;i<6;i++) {
        const v=i*3;
        svg += `<line x1="${pad.l}" y1="${yH(v)}" x2="${W-pad.r}" y2="${yH(v)}" stroke="${gc}"/>`;
        svg += `<text x="${pad.l-8}" y="${yH(v)+4}" fill="${hc}" font-size="10" text-anchor="end" opacity=".7">${v.toFixed(v<10?1:0)}</text>`;
        svg += `<text x="${W-pad.r+8}" y="${yT(i*10)+4}" fill="${tc}" font-size="10" text-anchor="start">${i*10}\u20ac</text>`;
      }
      svg += `<text x="${pad.l-12}" y="${pad.t+6}" fill="${hc}" font-size="10" text-anchor="middle" opacity=".6">h</text>`;
      svg += `<text x="${W-pad.r+14}" y="${pad.t+6}" fill="${tipC}" font-size="10" text-anchor="middle" opacity=".6">\u20ac</text>`;
      for (let i=0;i<n;i++) {
        const r=trendRows[i], cx=pad.l+i*gW;
        const hv=+r.actualHoursManual||0, tv=+r.tips||0;
        const hh=(hv/hrM)*iH, th=(tv/tipM)*iH;
        const x1=cx+gap, x2=cx+gW-gap-barW;
        svg += `<rect x="${x1}" y="${yH(hv)}" width="${barW}" height="${hh}" rx="3" fill="${hc}" opacity=".85"><title>${compactDate(r.date)} \u00b7 ${hrs(hv)}</title></rect>`;
        svg += `<rect x="${x2}" y="${yT(tv)}" width="${barW}" height="${th}" rx="3" fill="${tipC}" opacity=".85"><title>${compactDate(r.date)} \u00b7 ${eur(tv)}</title></rect>`;
        svg += `<text x="${cx+gW/2}" y="${H-10}" fill="${tc}" font-size="10" text-anchor="middle">${compactDate(r.date)}</text>`;
      }
      chart.innerHTML = `<rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="transparent"/>${svg}`;
    }

    function render() {
      const rows = [...state.rows].sort((a,b) => a.date.localeCompare(b.date));
      const grp = new Map();
      for (const r of rows) {
        const k = r.week.year + "-KW" + r.week.week;
        if (!grp.has(k)) grp.set(k, { ...r.week, rows: [] });
        grp.get(k).rows.push(r);
      }
      const groups = [...grp.values()]
        .sort((a,b) => a.year!==b.year ? a.year-b.year : a.week-b.week)
        .map(g => {
          const h = g.rows.reduce((s,r) => s + +r.actualHoursManual, 0);
          const t = g.rows.reduce((s,r) => s + +r.tips, 0);
          return { ...g, hours:h, tips:t, rate:h?t/h:0 };
        });

      syncTrendControls(rows, groups);
      renderStats(rows, groups);
      renderMonthlyEarnings(rows);
      renderTrendChart(getTrendRows(rows));
      renderForecast(rows);

      const mxH = Math.max(...groups.map(g => g.hours), 0) || 1;
      const mxT = Math.max(...groups.map(g => g.tips), 0) || 1;
      $("weekBars").innerHTML = groups.map(g =>
        `<div class="bar-row"><div class="bar-label">${g.label}</div><div><div class="bar-track" title="${hrs(g.hours)}"><div class="bar-fill" style="width:${(g.hours/mxH)*100}%"></div></div><div class="bar-track" style="margin-top:6px" title="${eur(g.tips)}"><div class="bar-fill tips" style="width:${(g.tips/mxT)*100}%"></div></div></div><div class="bar-value">${hrs(g.hours)}<br>${eur(g.tips)}</div></div>`
      ).join("") || `<div class="empty-state"><div class="empty-icon">\ud83d\udcca</div><div class="empty-title">Noch keine Wochen</div></div>`;

      const mxDR = Math.max(...rows.map(r => { const h=+r.actualHoursManual; return h?+r.tips/h:0; }), 0) || 1;
      const dk2 = document.documentElement.getAttribute("data-theme")==="dark";
      const tBg = dk2 ? "rgba(58,58,60,.96), rgba(50,50,52,.94)" : "rgba(255,255,255,.96), rgba(248,248,250,.94)";
      $("dayTiles").innerHTML = rows.slice().reverse().map((r,i) => {
        const h=+r.actualHoursManual, t=+r.tips, rate=h?t/h:0;
        return `<div class="day-tile" style="animation-delay:${i*.03}s;background:linear-gradient(180deg,${tBg}),radial-gradient(circle at top right,rgba(48,209,88,${.12+(rate/mxDR)*.34}),transparent 42%)"><div class="top"><span>${r.week.label}</span><span>${compactDate(r.date)}</span></div><div class="main">${hrs(h)}</div><div class="subline">${eur(t)} Trinkgeld</div><div class="subline">${eur(rate)}/h</div></div>`;
      }).join("") || `<div class="empty-state"><div class="empty-icon">\ud83d\udcb0</div><div class="empty-title">Noch keine Tage</div></div>`;

      $("weeks").innerHTML = groups.slice().reverse().map(g =>
        `<div class="week-card"><h3>${g.label}</h3><div><strong>${hrs(g.hours)}</strong></div><div class="mini">Trinkgeld: ${eur(g.tips)}</div><div class="mini">Eintr\u00e4ge: ${g.rows.length}</div><div class="mini">\u00d8 Trinkgeld/Stunde: ${eur(g.rate)}</div></div>`
      ).join("") || `<div class="empty-state"><div class="empty-icon">\ud83d\udcc5</div><div class="empty-title">Noch keine Daten</div></div>`;

      $("tableBody").innerHTML = rows.slice().reverse().map(r =>
        `<tr><td>${r.week.label}</td><td>${weekdayName(r.date)}</td><td>${dateFmt(r.date)}</td><td class="right">${hrs(r.actualHoursManual)}</td><td class="right">${eur(r.tips)}</td><td>${r.note||"\u2014"}</td><td><div class="row-actions"><button class="btn-secondary" onclick="editRow('${r.date}')">Bearbeiten</button><button class="warn" onclick="confirmDelete('${r.date}')">L\u00f6schen</button></div></td></tr>`
      ).join("") || `<tr><td colspan="7" class="empty-state"><div class="empty-icon">\ud83d\udccb</div><div class="empty-title">Noch n\u00fcscht drin.</div></td></tr>`;

      $("homeSkeleton").style.display = "none";
      $("homeContent").style.display = "block";
    }

    // ═══════════════════════════════════════
    //  Actions: Save, Edit, Delete
    // ═══════════════════════════════════════

    function resetForm() {
      form.date.value = todayStr();
      form.hours.value = form.tips.value = form.note.value = "";
      state.editingDate = null;
      $("saveBtn").textContent = "Schicht speichern";
    }

    window.editRow = function(date) {
      const row = state.rows.find(r => r.date === date);
      if (!row) return;
      state.editingDate = date;
      form.date.value = row.date; form.hours.value = row.actualHoursManual;
      form.tips.value = row.tips; form.note.value = row.note;
      $("saveBtn").textContent = "Schicht aktualisieren";
      activateTab("capture");
      setStatus("Bearbeite " + dateFmt(date));
    };

    window.confirmDelete = function(date) {
      const row = state.rows.find(r => r.date === date);
      const label = row ? dateFmt(date) + " \u00b7 " + hrs(row.actualHoursManual) : date;
      showSheet(label, [{ label: "Eintrag l\u00f6schen", danger: true, action: () => execDelete(date) }]);
    };

    async function execDelete(date) {
      try {
        await deleteEntry(date);
        state.rows = state.rows.filter(r => r.date !== date);
        render(); showToast("Eintrag gel\u00f6scht \ud83d\ude3a");
      } catch(e) { setStatus("L\u00f6schen fehlgeschlagen", "error"); }
      resetForm();
    }

    function parseNum(v) {
      if (v === undefined || v === null) return NaN;
      v = String(v).trim(); return v === "" ? NaN : Number(v.replace(",","."));
    }

    $("saveBtn").addEventListener("click", async () => {
      const date = form.date.value;
      const hours = parseNum(form.hours.value);
      const note = form.note.value.trim() || weekdayName(date);
      if (!date) return setStatus("Bitte ein Datum w\u00e4hlen.", "error");
      if (isNaN(hours)) return setStatus("Bitte die Stunden eingeben.", "error");
      let tips = parseNum(form.tips.value);
      if (isNaN(tips)) {
        if ((form.tips.value||"").trim()) return setStatus("Trinkgeld: Komma oder Punkt als Dezimaltrenner nutzen.", "error");
        tips = 0;
      }
      if (state.editingDate && state.editingDate !== date) {
        try { await deleteEntry(state.editingDate); } catch(_) {}
      }
      try {
        await saveEntry({ date, actualHoursManual: hours.toFixed(2), tips: tips.toFixed(2), note });
        await loadData();
        showToast("Schicht gespeichert \ud83d\ude3a");
        resetForm();
      } catch(e) { setStatus(e.message, "error"); }
    });

    $("resetFormBtn").addEventListener("click", resetForm);
    $("reloadBtn").addEventListener("click", refreshData);

    // ═══════════════════════════════════════
    //  Pull-to-Refresh
    // ═══════════════════════════════════════

    let ptrA=false, ptrSY=0;
    const ptrEl = $("ptrIndicator");
    document.addEventListener("touchstart", e => {
      if (scrollY>10) return; ptrSY = e.touches[0].clientY; ptrA = true;
    }, {passive:true});
    document.addEventListener("touchmove", e => {
      if (!ptrA) return;
      if (e.touches[0].clientY-ptrSY > 10 && scrollY <= 5) ptrEl.classList.add("visible");
    }, {passive:true});
    document.addEventListener("touchend", () => {
      if (!ptrA) return; ptrA = false;
      if (ptrEl.classList.contains("visible")) { ptrEl.classList.remove("visible"); refreshData(); }
    });

    async function refreshData() {
      showToast("Aktualisiere \u2026");
      $("homeSkeleton").style.display = state.loaded ? "none" : "block";
      $("homeContent").style.display = "none";
      try { await loadData(); showToast("Daten aktualisiert \ud83d\ude3a"); }
      catch(e) { showToast("Fehler beim Aktualisieren", 3000); }
    }

    // ═══════════════════════════════════════
    //  Event Bindings & Init
    // ═══════════════════════════════════════

    tabButtons.forEach(b => b.addEventListener("click", () => activateTab(b.dataset.target)));

    trendControls.mode.addEventListener("change", () => {
      state.trendMode = trendControls.mode.value; persistState(); render();
    });
    trendControls.week.addEventListener("change", () => {
      state.trendWeekKey = trendControls.week.value; persistState();
      if (state.trendMode === "kw") render();
    });
    trendControls.month.addEventListener("change", () => {
      state.trendMonth = trendControls.month.value; persistState();
      if (state.trendMode === "month") render();
    });

    let activeInput = null;
    document.querySelectorAll('input[inputmode="decimal"]').forEach(el => {
      el.addEventListener("focus", () => { activeInput = el; $("inputAccessory").classList.add("visible"); });
      el.addEventListener("blur", () => setTimeout(() => {
        if (!activeInput) $("inputAccessory").classList.remove("visible");
      }, 200));
    });
    window.dismissKeyboard = () => {
      if (activeInput) { activeInput.blur(); activeInput = null; }
      $("inputAccessory").classList.remove("visible");
    };

    document.querySelectorAll(".modal-overlay").forEach(o => {
      o.addEventListener("click", function(e) { if (e.target===this) o.classList.remove("open"); });
    });

    // ── START ──
    initTheme();
    restoreState();
    activateTab(state.activeTab);
    form.date.value = todayStr();
    loadData().catch(() => {});
  </script>
