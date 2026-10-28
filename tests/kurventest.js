// Test: Überschwingt die neue Kurve? — Version 2, saubere Datenstruktur
// Aufruf: node /tmp/kurventest.js

// Kurve als Liste von Segmenten: { p0, cp1, cp2, p3 }
function segmentsOld(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    segs.push({
      p0: p1,
      cp1: { x: p1.x + (p2.x - p0.x) / 12, y: p1.y + (p2.y - p0.y) / 12 },
      cp2: { x: p2.x - (p3.x - p1.x) / 12, y: p2.y - (p3.y - p1.y) / 12 },
      p3: p2
    });
  }
  return segs;
}

function segmentsNew(pts) {
  if (pts.length < 2) return [];
  if (pts.length === 2) return [{ p0: pts[0], cp1: pts[0], cp2: pts[1], p3: pts[1] }];
  const dx = [], dy = [], slope = [];
  for (let i = 0; i < pts.length - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    slope[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }
  const tan = new Array(pts.length);
  tan[0] = slope[0];
  tan[pts.length - 1] = slope[slope.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tan[i] = 0;
    } else {
      const m = (slope[i - 1] + slope[i]) / 2;
      const lim = 3 * Math.min(Math.abs(slope[i - 1]), Math.abs(slope[i]));
      tan[i] = Math.sign(m) * Math.min(Math.abs(m), lim);
    }
  }
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const h = dx[i] / 3;
    segs.push({
      p0: pts[i],
      cp1: { x: pts[i].x + h, y: pts[i].y + tan[i] * h },
      cp2: { x: pts[i + 1].x - h, y: pts[i + 1].y - tan[i + 1] * h },
      p3: pts[i + 1]
    });
  }
  return segs;
}

function pointAt(s, t) {
  const u = 1 - t;
  return {
    x: u*u*u*s.p0.x + 3*u*u*t*s.cp1.x + 3*u*t*t*s.cp2.x + t*t*t*s.p3.x,
    y: u*u*u*s.p0.y + 3*u*u*t*s.cp1.y + 3*u*t*t*s.cp2.y + t*t*t*s.p3.y
  };
}

// Wie weit läuft die Kurve über die beiden Endpunkte eines Segments hinaus?
function overshoot(segs) {
  let up = 0, down = 0;
  for (const s of segs) {
    const lo = Math.min(s.p0.y, s.p3.y);
    const hi = Math.max(s.p0.y, s.p3.y);
    for (let k = 1; k < 40; k++) {
      const p = pointAt(s, k / 40);
      if (p.y > hi) up = Math.max(up, p.y - hi);
      if (p.y < lo) down = Math.max(down, lo - p.y);
    }
  }
  return { up, down };
}

const faelle = [
  { name: "Ruhige Wochen",      y: [200, 190, 195, 185, 192, 188] },
  { name: "Ausreißer hoch",     y: [200, 195, 100, 198, 192, 196] },
  { name: "Ausreißer tief",     y: [180, 185, 300, 182, 188, 184] },
  { name: "Zwei Spitzen",       y: [200, 120, 200, 190, 130, 200] },
  { name: "Starker Anstieg",    y: [220, 180, 140, 100, 60, 40] },
];

console.log("Überschwingen: wie weit läuft die Kurve über echte Messwerte hinaus?");
console.log("(kleiner = näher an der Realität)\n");
console.log("Fall".padEnd(20) + "ALT hoch".padStart(10) + "ALT tief".padStart(10) +
            "NEU hoch".padStart(10) + "NEU tief".padStart(10));
console.log("─".repeat(62));

let altSum = 0, neuSum = 0;
for (const f of faelle) {
  const pts = f.y.map((y, x) => ({ x: x * 60, y }));
  const a = overshoot(segmentsOld(pts));
  const n = overshoot(segmentsNew(pts));
  altSum += a.up + a.down;
  neuSum += n.up + n.down;
  console.log(
    f.name.padEnd(20) +
    a.up.toFixed(1).padStart(10) + a.down.toFixed(1).padStart(10) +
    n.up.toFixed(1).padStart(10) + n.down.toFixed(1).padStart(10)
  );
}

console.log("─".repeat(62));
console.log("Summe".padEnd(20) + altSum.toFixed(1).padStart(10) + "".padStart(10) +
            neuSum.toFixed(1).padStart(10));
console.log();
console.log("Reduktion:", (100 * (1 - neuSum / altSum)).toFixed(0) + " %");
console.log(neuSum === 0
  ? "\nERGEBNIS: Die neue Kurve überschwingt NICHT (0.0 px).\n          Sie bleibt immer zwischen den echten Messwerten."
  : "\nERGEBNIS: Neues Überschwingen " + neuSum.toFixed(2) + " px — prüfen.");
