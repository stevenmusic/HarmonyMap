// 把三個來源轉成同一格式:{src, key(pc), id, bass(pc|null), frets[6], first(bool)}
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const out = [];
const PC = { C:0, "C#":1, Csharp:1, Db:1, D:2, "D#":3, Dsharp:3, Eb:3, E:4, F:5, "F#":6, Fsharp:6, Gb:6, G:7, "G#":8, Gsharp:8, Ab:8, A:9, "A#":10, Asharp:10, Bb:10, B:11 };
// 1. chords-db
const DB = require(process.env.REF_DIR + "/tombatossals-chords-db-0.5.1/package/lib/guitar.json");
const DBMAP = { major:"maj", minor:"min", dim:"dim", dim7:"dim7", sus2:"sus2", sus4:"sus4", "7sus4":"7sus4", aug:"aug", "6":"6", "69":"69",
  "7":"7", "7b5":"7b5", aug7:"7s5", "9":"9", "9b5":"9b5", aug9:"9s5", "7b9":"7b9", "7#9":"7s9", "11":"11", "9#11":"9s11", "13":"13",
  maj7:"maj7", maj7b5:"maj7b5", "maj7#5":"maj7s5", maj9:"maj9", maj13:"maj13", m6:"m6", m69:"m69", m7:"m7", m7b5:"m7b5", m9:"m9",
  m11:"m11", mmaj7:"mMaj7", mmaj7b5:"dimMaj7", mmaj9:"mMaj9", mmaj11:"mMaj11", add9:"add9", madd9:"madd9" };
for (const k in DB.chords) for (const ch of DB.chords[k]) {
  let id = DBMAP[ch.suffix], bass = null;
  const sl = ch.suffix.match(/^(m?)\/([A-G][#b]?)$/);
  if (sl) { id = sl[1] ? "min" : "maj"; bass = PC[sl[2]]; }
  if (!id) continue;
  ch.positions.forEach((p, i) => out.push({ src: "chords-db", key: PC[k], id, bass,
    frets: p.frets.map(f => f < 0 ? -1 : f === 0 ? 0 : f + p.baseFret - 1), first: i === 0 }));
}
// 2. instruments-chords(ES module,每個調一個檔)
const ICMAP = { major:"maj", minor:"min", "5":"pow", "7":"7", maj7:"maj7", m7:"m7", sus4:"sus4", add9:"add9", sus2:"sus2", "9":"9" };
const dir = process.env.REF_DIR + "/instruments-chords-0.0.15/package/dist/chords/";
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".js") && f !== "index.js")) {
  const name = f.replace(".js", "");
  const mod = await import("file://" + dir + f);
  const data = mod[name];
  for (const t in data) {
    const id = ICMAP[t]; if (!id) continue;
    for (const [vk, v] of Object.entries(data[t].variants))
      out.push({ src: "instruments-chords", key: PC[name], id, bass: null,
        frets: [6,5,4,3,2,1].map(s => v[s] === "x" || v[s] == null ? -1 : +v[s]), first: String(vk) === String(data[t].default) });
  }
}
// 3. guitar-chord-definitions(frets: 格 → {弦: 手指} 或 "BarFret")
const { chords } = require(process.env.REF_DIR + "/guitar-chord-definitions-1.0.2/package/dist/chords.js");
const GMAP = { "":"maj", m:"min", dim:"dim", sus2:"sus2", sus4:"sus4", "7":"7", "9":"9", add9:"add9" };
for (const c of chords) {
  const m = c.shortName.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  const id = GMAP[m[2]]; if (!id) continue;
  const fr = [0,0,0,0,0,0]; // 索引 0 = 6 弦
  const muted = new Set(Object.entries(c.strings || {}).filter(([, v]) => v === "DoNotPlayString").map(([s]) => +s));
  const bar = Object.entries(c.frets || {}).filter(([, v]) => v === "BarFret").map(([f]) => +f);
  for (const b of bar) for (let s = 1; s <= 6; s++) if (!muted.has(s)) fr[6 - s] = Math.max(fr[6 - s], b);
  for (const [f, v] of Object.entries(c.frets || {})) if (v !== "BarFret") for (const s of Object.keys(v)) fr[6 - +s] = Math.max(fr[6 - +s], +f);
  muted.forEach(s => fr[6 - s] = -1);
  out.push({ src: "guitar-chord-definitions", key: PC[m[1]], id, bass: m[3] ? PC[m[3]] : null, frets: fr, first: true });
}
fs.writeFileSync(process.env.REF_DIR + "/sources.json", JSON.stringify(out));
const by = {}; for (const o of out) by[o.src] = (by[o.src] || 0) + 1;
console.log(out.length, JSON.stringify(by));
