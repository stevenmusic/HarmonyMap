#!/usr/bin/env node
/* 重建 index.html 裡的 GTR_REF(吉他和弦資料庫指法表)。
   1. 從 npm 抓三個版本釘死的和弦資料庫
   2. normalize.mjs 轉成同一格式:{src, key, id, bass, frets, first}
   3. 在 headless Chromium 裡用本工具自己的樂理規則重驗每一個指法,再投票排序
   4. 壓成每個指法 6 個字元,寫回 index.html 的 `const GTR_REF = {...};`

   執行:node tests/gtr-ref/rebuild.js(需要 npm 與 playwright,改完記得跑 node tests/run.js) */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");

const PKGS = ["@tombatossals/chords-db@0.5.1", "instruments-chords@0.0.15", "guitar-chord-definitions@1.0.2"];
const ROOT = path.resolve(__dirname, "..", "..");
const INDEX = path.join(ROOT, "index.html");

function loadPlaywright(){
  try { return require("playwright"); } catch (e) {}
  return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtr-ref-"));
  for (const p of PKGS) {
    const tgz = execSync("npm pack " + p + " --silent", { cwd: dir }).toString().trim().split("\n").pop();
    const out = path.join(dir, tgz.replace(/\.tgz$/, ""));
    fs.mkdirSync(out, { recursive: true });
    execSync("tar xzf " + tgz + " -C " + out, { cwd: dir });
  }
  execSync("node " + path.join(__dirname, "normalize.mjs"), { env: Object.assign({}, process.env, { REF_DIR: dir }), stdio: "inherit" });
  const SRC = JSON.parse(fs.readFileSync(path.join(dir, "sources.json"), "utf8"));

  const { chromium } = loadPlaywright();
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  await page.route(/^https?:\/\//, r => r.abort());
  await page.goto("file://" + INDEX);
  const r = await page.evaluate((SRC) => {
    // 排序的最後一個比較用「沒有資料庫加分」的評分,所以先把現有的表清空,結果才不會受舊表影響
    for (const k in GTR_REF) delete GTR_REF[k];
    VOICING_CACHE.clear();
    const bad = {}, groups = {};
    for (let v of SRC) {
      const def = chordById(v.id);
      if (v.key == null || !def) { bad[v.src] = (bad[v.src] || 0) + 1; continue; }
      // 整排橫按讓最低音不是根音時(3 3 5 3 4 3 的低音是 G),照吉他手讀譜的方式把低音那幾條弦悶掉
      if (v.bass == null) {
        const fr = v.frets.slice();
        for (let s = 0; s < 3; s++) {
          if (fr[s] < 0) continue;
          if (pcOf(GTR_OPEN[s] + fr[s]) === v.key) break;
          fr[s] = -1;
        }
        v = Object.assign({}, v, { frets: fr });
      }
      const pcs = new Set(def.t.map(t => pcOf(v.key + tokenSemi(t))));
      const played = v.frets.map((f, s) => f < 0 ? null : pcOf(GTR_OPEN[s] + f)).filter(x => x != null);
      const low = v.frets.findIndex(f => f >= 0);
      const need = def.t.filter(t => !(t === "5" || (def.t.length >= 6 && t === "11") || (def.t.length >= 7 && t === "9")));
      const ok = played.length >= Math.min(3, pcs.size) &&
        played.every(x => pcs.has(x) || x === v.bass) &&
        pcOf(GTR_OPEN[low] + v.frets[low]) === (v.bass == null ? v.key : v.bass) &&
        need.every(t => played.includes(pcOf(v.key + tokenSemi(t))));
      if (!ok) { bad[v.src] = (bad[v.src] || 0) + 1; continue; }
      const k = v.key + "|" + v.id + "|" + (v.bass == null ? "" : v.bass);
      const g = groups[k] || (groups[k] = {});
      const e = g[v.frets.join(",")] || (g[v.frets.join(",")] = { frets: v.frets, srcs: new Set(), first: 0 });
      e.srcs.add(v.src);
      if (v.first) e.first++;
    }
    const enc = f => f.map(x => x < 0 ? "x" : x.toString(36)).join("");
    const table = {};
    let kept = 0, valid = 0;
    for (const k in groups) {
      const [key, id, bass] = k.split("|");
      const costOf = fr => voicingCost(+key, chordById(id), bass === "" ? null : +bass, fr);
      // 分數 = 列出它的來源數 + 1.5 × 把它當預設的來源數(來源自己的首選比「有列出來」更有份量)
      const score = e => e.srcs.size + 1.5 * e.first;
      const list = Object.values(groups[k]).sort((a, b) => score(b) - score(a) || costOf(a.frets) - costOf(b.frets) || enc(a.frets).localeCompare(enc(b.frets)));
      valid += list.length;
      table[k] = list.slice(0, 6).map(e => enc(e.frets)).join(" ");
      kept += Math.min(6, list.length);
    }
    return { table, bad, valid, kept, entries: Object.keys(table).length };
  }, SRC);
  await browser.close();

  const sorted = {};
  for (const k of Object.keys(r.table).sort((a, b) => { const [x1, y1, z1] = a.split("|"), [x2, y2, z2] = b.split("|"); return (+x1 - +x2) || y1.localeCompare(y2) || z1.localeCompare(z2); })) sorted[k] = r.table[k];
  let html = fs.readFileSync(INDEX, "utf8");
  const next = html.replace(/const GTR_REF = \{.*?\};/s, "const GTR_REF = " + JSON.stringify(sorted) + ";");
  if (next === html && !html.includes("const GTR_REF = " + JSON.stringify(sorted))) throw new Error("index.html 裡找不到 const GTR_REF");
  fs.writeFileSync(INDEX, next);
  console.log("來源 " + SRC.length + " 個指法,通過 " + r.valid + ",沒通過 " + JSON.stringify(r.bad));
  console.log("寫入 " + r.entries + " 組、" + r.kept + " 個指法 → index.html");
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
