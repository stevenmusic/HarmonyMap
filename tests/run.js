#!/usr/bin/env node
/* HarmonyMap 回歸測試。在 headless Chromium 裡打開 index.html,直接呼叫頁面裡的函式驗證。
   只印出失敗項目與各組總數;有任何失敗就以非零代碼結束。

   執行:node tests/run.js
   需要 playwright(npm i -g playwright 或專案外任何一處裝好即可)。
   Chromium 路徑可用環境變數 CHROMIUM_PATH 指定,沒指定時用 playwright 內建的。
   測試時封鎖所有外部網路(音檔、字型),結果不受網路狀況影響。 */
"use strict";
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

function loadPlaywright(){
  try { return require("playwright"); } catch (e) {}
  const g = execSync("npm root -g").toString().trim();
  return require(path.join(g, "playwright"));
}
const { chromium } = loadPlaywright();
const PAGE = "file://" + path.resolve(__dirname, "..", "index.html");
const exe = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const results = [];   // { group, total, fails: [] }
function report(group, total, fails){ results.push({ group, total, fails }); }

async function openPage(browser, opts = {}){
  const p = await browser.newPage(Object.assign({ viewport: { width: 1200, height: 900 } }, opts));
  p._errors = [];
  p.on("pageerror", e => p._errors.push(e.message));
  await p.route(/^https?:\/\//, r => r.abort());
  await p.goto(PAGE);
  return p;
}

(async () => {
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await openPage(browser);

  /* ── 1. 樂理:CLAUDE.md 指定的拼寫與 C 大調順階七和弦 ── */
  {
    const r = await p.evaluate(() => {
      const fails = [];
      const cases = [["C",0,"dim7","C E♭ G♭ B♭♭"], ["F",1,"7s9","F♯ A♯ C♯ E G♯♯"], ["D",-1,"13","D♭ F A♭ C♭ E♭ B♭"]];
      for (const [L, a, id, want] of cases) {
        STATE.tab = "chord"; STATE.inst = "piano"; STATE.letter = LETTERS.indexOf(L); STATE.acc = a; STATE.chordId = id;
        const got = currentNotes().map(n => n.name).join(" ");
        if (got !== want) fails.push(L + accText(a) + chordById(id).sym + ": " + got + " ≠ " + want);
      }
      STATE.letter = 0; STATE.acc = 0;
      const dia = diatonicChords(scaleById("ionian")).map(d => d.seventh).join(" ");
      if (dia !== "Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7♭5") fails.push("C 大調順階七和弦: " + dia);
      return { total: cases.length + 1, fails };
    });
    report("樂理拼寫", r.total, r.fails);
  }

  /* ── 1b. 字典:全部和弦與音階 × 21 個根音 ──
     拼寫與 MIDI 自洽、音階內不得有重複音高、七聲音階七個字母各一次。
     兩種情形不算錯:級數本身就重複的音階(♭7 與 7、♭3 與 3),
     以及三重升降時 spell() 刻意退回等音簡易拼寫(acc 為 null) */
  {
    const r = await p.evaluate(() => {
      const fails = [];
      let total = 0;
      const NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
      const pcOfSpelled = n => pcOf(NAT[n[0]] + [...n.slice(1)].reduce((a, c) => a + (c === "♯" ? 1 : c === "♭" ? -1 : 0), 0));
      for (const def of [...CHORDS, ...SCALES]) for (let li = 0; li < 7; li++) for (const a of [-1, 0, 1]) {
        total++;
        const tag = LETTERS[li] + accText(a) + " " + (def.sym != null ? def.sym || "maj" : def.id);
        const rp = pcOf(LETTER_PC[li] + a);
        const notes = def.t.map(tok => spell(li, a, tok));
        for (const n of notes) if (pcOfSpelled(n.name) !== pcOf(rp + n.semi)) fails.push(tag + ": " + n.tok + " 拼成 " + n.name + ",音高不符");
        if (def.sym == null) {
          const degs = def.t.map(tok => parseToken(tok).deg);
          const dupDeg = new Set(degs).size !== degs.length;
          const pcs = notes.map(n => pcOf(rp + n.semi));
          if (new Set(pcs).size !== pcs.length) fails.push(tag + ": 音階內有重複音高");
          if (def.t.length === 7 && !dupDeg && notes.every(n => n.acc !== null)) {
            const letters = new Set(notes.map(n => n.name[0]));
            if (letters.size !== 7) fails.push(tag + ": 七聲音階字母不是各一次 " + notes.map(n => n.name).join(" "));
          }
        }
      }
      // 建議音階(和弦音階理論):音階必須包含和弦的每一個組成音;每個和弦至少一個建議
      for (const def of CHORDS) {
        const ids = CHORD_SCALES[def.id] || [];
        total++;
        if (!ids.length) { fails.push(def.id + ": 沒有建議音階"); continue; }
        const cp = def.t.map(tok => pcOf(tokenSemi(tok)));
        for (const sid of ids) {
          total++;
          const sc = SCALES.find(x => x.id === sid);
          if (!sc) { fails.push(def.id + " → " + sid + ": 沒有這個音階"); continue; }
          const sp = new Set(sc.t.map(tok => pcOf(tokenSemi(tok))));
          const miss = def.t.filter((tok, i) => !sp.has(cp[i]));
          if (miss.length) fails.push(def.id + " → " + sid + ": 音階少了和弦音 " + miss.join(" "));
        }
      }
      // 說明裡「X 的第 N 級」要跟實際的音對得上(大洛克里安曾經寫成「和聲大調的第五級」,其實是拿坡里大調的第五級)
      {
        const PAR = { "和聲小調": "harmMinor", "旋律小調": "melMinor", "和聲大調": "harmMajor", "雙和聲大調": "dblHarm", "拿坡里大調": "neapMajor", "拿坡里小調": "neapMinor" };
        const NUM = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7 };
        const pcsOf = t => t.map(x => pcOf(tokenSemi(x)));
        for (const item of SCALES.concat(CHORDS)) {
          const re = /(雙和聲大調|和聲小調|旋律小調|和聲大調|拿坡里大調|拿坡里小調)(?:的)?第([一二三四五六七])級/g;
          let m;
          while ((m = re.exec(item.d))) {
            total++;
            const parP = pcsOf(SCALES.find(x => x.id === PAR[m[1]]).t), r = parP[NUM[m[2]] - 1];
            const mode = new Set(parP.map(x => pcOf(x - r))), mine = new Set(pcsOf(item.t));
            const ok = SCALES.includes(item) ? mine.size === mode.size && [...mine].every(x => mode.has(x)) : [...mine].every(x => mode.has(x));
            if (!ok) fails.push(item.id + " 的說明寫「" + m[0] + "」,但音對不上");
          }
        }
      }
      // 順階和弦表:名稱的拼法跟表上的組成音不同(等音)就一定要標 ≅;點下去要能跳(根音不能是 null)
      for (const sc of SCALES.filter(x => x.t.length === 7)) for (let L = 0; L < 7; L++) for (const a of [-1, 0, 1]) {
        STATE.letter = L; STATE.acc = a;
        for (const row of diatonicChords(sc)) {
          if (!row.seventhId) continue;
          total++;
          const tag = sc.id + " " + LETTERS[L] + (a ? (a > 0 ? "♯" : "♭") : "") + " " + row.roman;
          if (row.seventhAcc == null || Number.isNaN(row.seventhAcc)) { fails.push(tag + ": 七和弦根音沒有升降值,點了跳不過去"); continue; }
          const own = chordById(row.seventhId).t.map(tok => spell(row.seventhLetter, row.seventhAcc, tok).name).join(" ");
          if (own !== row.tones && !row.enh7) fails.push(tag + " " + row.seventh + ": 表上 " + row.tones + " 與名稱拼法 " + own + " 不同卻沒有標 ≅");
        }
      }
      STATE.letter = 0; STATE.acc = 0;
      return { total, fails };
    });
    report("字典 × 21 根音", r.total, r.fails);
  }

  /* ── 2. 吉他指法:標準指法、OPEN_CANON 排第一 ── */
  {
    const r = await p.evaluate(() => {
      const want = {
        "C|maj":"× 3 2 0 1 0", "G|maj":"3 2 0 0 0 3", "D|maj":"× × 0 2 3 2", "A|maj":"× 0 2 2 2 0", "E|maj":"0 2 2 1 0 0",
        "A|min":"× 0 2 2 1 0", "E|min":"0 2 2 0 0 0", "D|min":"× × 0 2 3 1", "F|maj":"1 3 3 2 1 1", "E|7":"0 2 0 1 0 0",
        "C|maj7":"× 3 2 0 0 0", "B|7":"× 2 1 2 0 2", "A|7":"× 0 2 0 2 0", "D|7":"× × 0 2 1 2", "G|7":"3 2 0 0 0 1",
        "C|7":"× 3 2 3 1 0", "F|maj7":"× × 3 2 1 0", "B|maj":"× 2 4 4 4 2", "C|min":"× 3 5 5 4 3", "G|min":"3 5 5 3 3 3",
        "B|min":"× 2 4 4 3 2", "F|min":"1 3 3 1 1 1", "F|7":"1 3 1 2 1 1", "C|m7":"× 3 5 3 4 3", "Bb|maj":"× 1 3 3 3 1"
      };
      const pcOfName = n => pcOf(LETTER_PC[LETTERS.indexOf(n[0])] + (n[1] === "b" ? -1 : n[1] === "#" ? 1 : 0));
      const fails = [];
      let total = 0;
      for (const [k, exp] of Object.entries(want)) {
        total++;
        const [n, id] = k.split("|");
        const vs = chordVoicingsFor(pcOfName(n), chordById(id));
        const got = vs.list[vs.best] ? gtrTabText(vs.list[vs.best].frets) : "none";
        if (got !== exp) fails.push(n + chordById(id).sym + ": " + got + " ≠ " + exp);
      }
      // 標準開放斜線和弦(SLASH_CANON)一定排第一,同一組音的另一個名稱也一樣(Am/G 與 Am7/G 都是 3 0 2 2 1 0)
      for (const k in SLASH_CANON) {
        total++;
        const [r0, id, bb] = k.split("|"), rp = OPEN_CANON_PC[r0], bp = pcOf(OPEN_CANON_PC[bb[0]] + (bb[1] === "#" ? 1 : 0));
        const exp = SLASH_CANON[k].split("").map(c => c === "x" ? "×" : c).join(" ");
        const vs = chordVoicingsFor(rp, chordById(id), bp);
        const got = vs.list[vs.best] ? gtrTabText(vs.list[vs.best].frets) : "none";
        if (got !== exp) fails.push("SLASH_CANON " + k + ": " + got + " ≠ " + exp);
        const pair = slashPair(chordById(id), pcOf(bp - rp));
        if (pair) { const o = chordVoicingsFor(rp, pair.full, bp); const g2 = o.list[o.best] ? gtrTabText(o.list[o.best].frets) : "none"; if (g2 !== exp) fails.push("SLASH_CANON 同音異名 " + pair.full.id + ": " + g2 + " ≠ " + exp); }
      }
      for (const id in OPEN_CANON) for (const L in OPEN_CANON[id]) {
        total++;
        const vs = chordVoicingsFor(OPEN_CANON_PC[L], chordById(id));
        const exp = OPEN_CANON[id][L].split("").map(c => c === "x" ? "×" : c).join(" ");
        const got = vs.list[vs.best] ? gtrTabText(vs.list[vs.best].frets) : "none";
        if (got !== exp) fails.push("OPEN_CANON " + L + chordById(id).sym + ": " + got + " ≠ " + exp);
      }
      return { total, fails };
    });
    report("吉他標準指法", r.total, r.fails);
  }

  /* ── 3. 吉他:全部和弦 × 21 根音 × (根音 + 每個和弦內音當低音) ──
     每組都要找得到指法;○/× 與按弦都要對;跨度 ≤ 3;低音正確;沒指定低音時最低音是根音 */
  {
    const r = await p.evaluate(() => {
      const fails = [];
      let total = 0;
      for (const c of CHORDS) for (let li = 0; li < 7; li++) for (const a of [-1, 0, 1]) {
        const rp = pcOf(LETTER_PC[li] + a), nm = LETTERS[li] + accText(a) + c.sym;
        const pcs = new Set(c.t.map(tok => pcOf(rp + tokenSemi(tok))));
        for (const bp of [null, ...pcs]) {
          if (bp === rp) continue;
          total++;
          const vs = chordVoicingsFor(rp, c, bp);
          const tag = nm + (bp == null ? "" : "/" + simpleName(bp, "sharp"));
          if (!vs.list.length) { fails.push(tag + ": 找不到指法"); continue; }
          for (const v of vs.list) {
            const mk = gtrMarkers(v.frets);
            v.frets.forEach((f, s) => {
              if ((mk[s] === "open") !== (f === 0) || (mk[s] === "mute") !== (f === -1)) fails.push(tag + " " + (6 - s) + " 弦 ○/× 標記錯");
              if (f >= 0 && !pcs.has(pcOf(GTR_OPEN[s] + f))) fails.push(tag + " " + (6 - s) + " 弦不是和弦音");
            });
            const fr = v.frets.filter(f => f > 0);
            if (fr.length && Math.max(...fr) - Math.min(...fr) > GTR_MAX_SPAN) fails.push(tag + " 跨度超過 " + GTR_MAX_SPAN);
            const low = v.frets.findIndex(f => f >= 0);
            const lowPc = pcOf(GTR_OPEN[low] + v.frets[low]);
            if (bp != null && lowPc !== bp) fails.push(tag + " 低音錯");
            if (bp == null && lowPc !== rp) fails.push(tag + " 最低音不是根音 " + gtrTabText(v.frets));
          }
        }
      }
      return { total, fails };
    });
    report("吉他全組合(含斜線和弦)", r.total, r.fails);
  }

  /* ── 3b. 和弦資料庫(GTR_REF):有資料的和弦,第一個指法要是資料投票的第一名。
     例外:標準開放和弦表優先;這種和弦有開放和弦表、但這個根音沒有(Cm)時,低把位帶空弦的不採用 ── */
  {
    const r = await p.evaluate(() => {
      VOICING_CACHE.clear();
      const fails = [];
      let total = 0;
      for (const k in GTR_REF) {
        const [key, id, bass] = k.split("|");
        const ref = gtrRef(+key, id, bass === "" ? null : +bass);
        const vs = chordVoicingsFor(+key, chordById(id), bass === "" ? null : +bass);
        const got = vs.list[vs.best] ? vs.list[vs.best].frets : null;
        const tag = simpleName(+key, "flat") + chordById(id).sym + (bass === "" ? "" : "/" + simpleName(+bass, "flat"));
        if (!got) { total++; fails.push(tag + ": 找不到指法"); continue; }
        // 每個資料庫指法都要在引擎的候選裡(沒有被評估規則擋掉)
        if (bass === "") {
          const canon = openCanon(+key, id);
          const openPos = f => { const fr = f.filter(x => x > 0); return (fr.length ? Math.min(...fr) : 0) < 3 && f.some(x => x === 0); };
          // 開放和弦表優先;否則資料庫第一名只要屬於「開放 / 五弦封閉 / 六弦封閉」三種之一,就要排第一
          // (第一名是 4 弦根音或高把位混空弦的指法時不在三種裡,不檢查)
          let exp = canon || (vs.list.some(v => v.frets.join(",") === ref[0].join(",")) ? ref[0] : null);
          if (!canon && canon === null && openPos(ref[0])) exp = null;   // Cm 規則:不檢查
          if (exp) { total++; if (exp.join(",") !== got.join(",")) fails.push(tag + ": " + gtrTabText(got) + " ≠ " + gtrTabText(exp) + (canon ? "(開放和弦表)" : "(資料庫第一名)")); }
        } else {
          total++;
          // 標準開放斜線和弦表優先於資料庫(跟 OPEN_CANON 一樣),表上有的不檢查
          if (!slashCanon(+key, id, +bass) && !ref.some(f => f.join(",") === got.join(","))) fails.push(tag + ": 斜線和弦的第一個指法不在資料庫裡 " + gtrTabText(got));
        }
      }
      return { total, fails };
    });
    report("和弦資料庫一致", r.total, r.fails);
  }

  /* ── 3c. 每個和弦列出最實用的 3 種指法(使用者要求;不再固定「開放 / 五弦封閉 / 六弦封閉」) ──
     最高按到第 12 格(再上去手會碰到琴身)、1 或 2 弦至少彈一條、至少 4 條弦、中間不夾悶掉的弦(6 弦根音的爵士按法例外)、
     第 5 格以上混空弦時空弦只能是低音、兩個指法不能是「同一條低音弦、差 1 格以內」的同一種;
     食指橫按的,1 弦在橫按那格是和弦音就一定要彈 */
  {
    const r = await p.evaluate(() => {
      VOICING_CACHE.clear();
      const fails = [];
      let total = 0;
      for (const c of CHORDS) for (let rp = 0; rp < 12; rp++) {
        const vs = chordVoicingsFor(rp, c);
        const tag = simpleName(rp, "flat") + c.sym;
        const pcs = new Set(c.t.map(t => pcOf(rp + tokenSemi(t))));
        total++;
        if (vs.list.length > 3) fails.push(tag + ": 列了 " + vs.list.length + " 個指法");
        if (vs.fallback) continue;   // 只有一個(罕用和弦的資料庫第一名 / 評分最好的)時不套下面的規則
        const low = f => f.findIndex(x => x >= 0);
        vs.list.forEach((v, i) => {
          const f = v.frets, T = tag + " " + gtrTabText(f);
          if (Math.max(...f) > 12) fails.push(T + ": 超過第 12 格");
          if (v.canon) return;
          if (f[4] < 0 && f[5] < 0) fails.push(T + ": 1、2 弦都沒彈");
          if (f.filter(x => x >= 0).length < 4) fails.push(T + ": 少於 4 條弦");
          const hi = 5 - [...f].reverse().findIndex(x => x >= 0);
          for (let s = low(f) + 1; s < hi; s++) if (f[s] < 0 && !(s === 1 && low(f) === 0 && f[0] > 0)) fails.push(T + ": 中間夾悶掉的弦");
          if (Math.max(...f) >= 5 && f.some((x, s) => x === 0 && s !== low(f))) fails.push(T + ": 高把位的空弦不是低音");
          vs.list.slice(0, i).forEach(u => {
            const open = w => w.frets.some(x => x === 0) && Math.max(...w.frets) <= 4;
            if (low(u.frets) === low(f) && Math.abs(u.minF - v.minF) <= 1 && open(u) === open(v)) fails.push(T + ": 跟 " + gtrTabText(u.frets) + " 是同一種");
          });
        });
        const all = [];
        for (const v of vs.list) {
          const f = v.frets;
          if (!v.barreShown || f.some(x => x === 0) || f[5] >= 0) continue;
          let canReach = true;
          for (let s = v.barreHi + 1; s <= 5; s++) if (f[s] < v.minF && !pcs.has(pcOf(GTR_OPEN[s] + v.minF))) canReach = false;
          if (canReach) all.push(gtrTabText(f));
        }
        if (all.length) fails.push(tag + ": 封閉和弦 1 弦沒彈 " + all.join(", "));
      }
      // 使用者的例子:Am7 不能再列 × 12 14 12 13 12(手貼到琴身)
      total++;
      if (chordVoicingsFor(9, chordById("m7")).list.some(v => Math.max(...v.frets) > 12)) fails.push("Am7 還列了第 12 格以上的指法");
      // 定義和弦的音(三音、七音、變化音)都要彈到:同一個和弦只要有一個完整的按法,列出來的就要全部完整
      // (原本 C13 會列出沒有 ♭7 的按法,那是 6/9)。整個和弦都沒有完整按法的(D7♭9♯9 等 3 組)才准退回
      let incomplete = 0;
      for (const d of CHORDS) for (let rp = 0; rp < 12; rp++) {
        const L = chordVoicingsFor(rp, d).list, ok = L.map(v => voicingComplete(d, v.missing || []));
        total++;
        if (ok.some(Boolean) && !ok.every(Boolean)) fails.push(d.id + "@" + rp + ": 有完整的按法卻也列了缺音的 " + L.filter((v, i) => !ok[i]).map(v => gtrTabText(v.frets)).join(" / "));
        if (!ok.some(Boolean)) incomplete++;
      }
      total++; if (incomplete > 3) fails.push("沒有完整按法的和弦 × 根音變多了:" + incomplete + "(原本 3)");
      return { total, fails };
    });
    report("指法挑選", r.total, r.fails);
  }

  /* ── 3c. 每一個列出來的指法都要按得到(80 種 × 12 根音 × 原位與 11 種低音,清單裡的每一個,不只第一個) ── */
  {
    const r = await p.evaluate(() => {
      const fails = []; let total = 0;
      for (const def of CHORDS) for (let rp = 0; rp < 12; rp++) for (let iv = 0; iv < 12; iv++) {
        const bpc = iv ? (rp + iv) % 12 : null;
        for (const v of chordVoicingsFor(rp, def, bpc).list) {
          total++;
          const fr = v.frets, tag = def.id + " " + rp + (iv ? "/" + bpc : "") + " " + gtrTabText(fr);
          const f = fr.filter(x => x > 0);
          if (f.length && Math.max(...f) - Math.min(...f) > 3) fails.push(tag + ": 撐超過 3 格");
          // 五根手指:只有拇指勾 6 弦才可能
          if (gtrFingersNeeded(fr) > 4 && fr[0] <= 0) fails.push(tag + ": 要五根手指");
          // 食指橫按中間幾條弦,低音側兩根手指 + 高音側一根(7 7 5 5 5 7)
          if (v.barre) {
            const lo = fr.map((x, s) => s).filter(s => s < v.barreLo && fr[s] > v.minF), hi = fr.map((x, s) => s).filter(s => s > v.barreHi && fr[s] > v.minF);
            if (lo.length >= 2 && hi.length) fails.push(tag + ": 手指要跨過橫按");
          }
        }
      }
      const has = (rp, id, b, tab) => chordVoicingsFor(rp, chordById(id), b).list.some(v => gtrTabText(v.frets) === tab);
      if (has(0, "maj7", 11, "7 7 5 5 5 7")) fails.push("Cmaj7/B 不該有 7 7 5 5 5 7(使用者回報按不到)");
      // 同一組音的兩種名稱(C/B = Cmaj7/B、D/C = D7/C、Am/G = Am7/G…)指法清單要完全一樣(使用者回報 C/B 與 Cmaj7/B 不同)
      const L = (rp, d, b) => chordVoicingsFor(rp, d, b).list.map(v => gtrTabText(v.frets)).join(" / ");
      let pairs = 0;
      for (const def of CHORDS) for (let rp = 0; rp < 12; rp++) for (let iv = 1; iv < 12; iv++) {
        if (chordSetPcs(def).has(iv)) continue;
        const pair = slashPair(def, iv); if (!pair) continue;
        const full = pair.full;
        pairs++;
        const b = (rp + iv) % 12;
        if (L(rp, def, b) !== L(rp, full, b)) fails.push("同一組音指法不同: " + def.id + "/" + iv + " vs " + full.id + " (根音 " + rp + ")");
      }
      if (pairs < 700) fails.push("同音異名的配對太少: " + pairs);
      // 只有等音相同的不配對(德國增六 ♯6 ≠ C9 的 ♭7);拼寫要是同一組
      for (const d of CHORDS) if (/\+6/.test(d.sym)) for (let iv = 1; iv < 12; iv++) { const pr = slashPair(d, iv); if (pr) fails.push("增六和弦不該配對: " + d.id + "/" + iv + " = " + pr.full.id); }
      if (has(0, "maj", 5, "× 8 5 5 5 8")) fails.push("C/F 不該有 × 8 5 5 5 8");
      // 斜線和弦的低音可以在上面的弦重複(使用者確認過),和弦外的低音也一樣:D/C♯ 的 × 4 0 2 2 2(C♯ 在 5 弦與 2 弦)
      { const { tones } = voicingTones(2, chordById("maj"));
        if (!evalVoicing([-1, 4, 0, 2, 2, 2], tones, 2, 1, 1)) fails.push("D/C♯ 的 × 4 0 2 2 2 應該可以(低音在上面重複)"); }
      if (!has(0, "69", null, "× 3 2 2 3 3")) fails.push("C6/9 的 × 3 2 2 3 3 是常見按法,不該被刪");
      if (!has(0, "9s5", null, "8 7 8 7 9 ×")) fails.push("C9♯5 的 8 7 8 7 9 × 按得到,不該被刪");
      return { total: total + 4, fails };
    });
    report("指法都按得到", r.total, r.fails);
  }

  /* ── 3d. 左手指法(和弦圖圓點裡的 T 1 2 3 4):常見和弦要跟和弦書一樣,每一個列出來的按法都要是手指做得到的 ── */
  {
    const r = await p.evaluate(() => {
      const fails = [];
      let total = 0;
      const std = { "x32010": "x32010", "x02220": "x01230", "320003": "210003", "022100": "023100", "xx0232": "xx0132", "x02210": "x02310",
        "022000": "012000", "xx0231": "xx0231", "133211": "134211", "x24432": "x13421", "x21202": "x21304", "x35453": "x13241",
        "200232": "T00132", "x02010": "x02010", "320001": "320001", "x32310": "x32410", "xx3211": "xx3211", "xx0211": "xx0211",
        "xx0212": "xx0213", "xx3210": "xx3210", "x02020": "x01020", "320033": "210034", "x33211": "x34211" };
      const show = (f, g) => g.map((x, i) => f[i] < 0 ? "x" : f[i] === 0 ? "0" : x).join("");
      for (const [fr, want] of Object.entries(std)) {
        total++;
        const f = [...fr].map(c => c === "x" ? -1 : +c), got = show(f, gtrFingering(f));
        if (got !== want) fails.push(fr + " 指法 " + got + ",和弦書是 " + want);
      }
      // 全部列出來的按法:每個按弦都有手指、最多 4 指(拇指另計)、同一指同一格、編號小的手指不在比較高的格(不交叉)
      const seen = new Set();
      for (const d of CHORDS) for (let rp = 0; rp < 12; rp++) for (const bs of [null, ...Array.from({ length: 12 }, (_, i) => i)])
        for (const v of chordVoicingsFor(rp, d, bs == null ? null : (rp + bs) % 12).list) {
          const k = v.frets.join(","); if (seen.has(k)) continue; seen.add(k); total++;
          const f = v.frets, g = gtrFingering(f), nums = [...new Set(g.filter(x => x && x !== "T"))];
          let why = "";
          if (f.some((x, s) => x > 0 && !g[s])) why = "有按弦沒有手指";
          else if (nums.some(x => +x > 4)) why = "超過 4 指";
          else for (const a of nums) {
            const fa = f.filter((x, s) => g[s] === a);
            if (new Set(fa).size > 1) why = "同一指按不同格";
            for (const b of nums) if (+a < +b && Math.max(...fa) > Math.min(...f.filter((x, s) => g[s] === b))) why = "手指交叉";
          }
          if (why) fails.push(gtrTabText(f) + " → " + show(f, g) + ":" + why);
        }
      return { total, fails };
    });
    report("左手指法", r.total, r.fails);
  }

  /* ── 4. 搜尋框的和弦名稱解析 ── */
  {
    const r = await p.evaluate(() => {
      const cases = { "C/B":"C|maj|11", "D/F#":"D|maj|4", "Bbmaj7":"B♭|maj7|null", "F#m7b5":"F♯|m7b5|null", "Am/G":"A|min|10",
        "C6/9":"C|69|null", "Cm6/9/E♭":"C|m69|3", "G7/F":"G|7|10", "Ebm":"E♭|min|null", "C/C":"C|maj|null",
        "add9":"null", "dim":"null", "aug":"null", "Xyz":"null" };
      const fails = [];
      for (const [q, want] of Object.entries(cases)) {
        const r = parseChordName(q);
        const got = r ? LETTERS[r.letter] + accText(r.acc) + "|" + r.def.id + "|" + r.bass : "null";
        if (got !== want) fails.push(q + ": " + got + " ≠ " + want);
      }
      return { total: Object.keys(cases).length, fails };
    });
    report("和弦名稱解析", r.total, r.fails);
  }
  /* ── 4b. 辨識:常見的音組合第一個讀法要對(拼寫照調號、省略五音、增六和弦排在一般讀法後面) ── */
  {
    const r = await p.evaluate(() => {
      const cases = [[[60,64,67],"C"],[[64,67,72],"C/E"],[[55,60,64],"C/G"],[[60,64,67,70],"C7"],[[57,60,64,67],"Am7"],[[60,64,67,69],"C6"],
        [[60,63,66,69],"Cdim7"],[[60,64,68],"Caug"],[[60,62,67],"Csus2"],[[60,65,67],"Csus4"],[[52,55,58,62],"Em7♭5"],[[48,55],"C5"],
        [[60,64,70,75],"C7♯9"],[[54,62,69],"D/F♯"],[[59,60,64,67],"Cmaj7/B"],[[58,60,64,67],"C7/B♭"],[[60,64,67,74],"Cadd9"],
        [[61,65,68],"D♭"],[[63,67,70,73],"E♭7"],[[56,60,63,66],"A♭7"],[[61,64,68],"C♯m"],[[68,71,75],"G♯m"],[[63,66,70],"E♭m"],[[70,73,77],"B♭m"],
        [[60,64,70],"C7"],[[60,64,71],"Cmaj7"],[[60,63,70],"Cm7"],[[62,65,72,76],"Dm9"],[[55,59,65,69,76],"G13"],[[56,59,62,65],"G♯dim7"],
        [[60,64,66,70],"C7♭5"],[[60,64,67,70,73],"C7♭9"],[[56,60,62,66],"A♭7♭5"],[[65,69,72,74],"F6"],[[62,65,69,71],"Dm6"]];
      const save = [STATE.tab, STATE.findSel, STATE.findSpell];
      STATE.tab = "find"; STATE.findSpell = "auto";
      const fails = [];
      for (const [notes, want] of cases) {
        STATE.findSel = new Set(notes);
        const an = findAnalysis(), r0 = an.results[0];
        const got = r0 ? findChordName(r0.rootPc, r0.chord, an.bassPc, spellPrefFor(r0.rootPc, r0.chord)) : "(沒有)";
        if (got !== want) fails.push(notes.join(" ") + ": " + got + " ≠ " + want);
      }
      [STATE.tab, STATE.findSel, STATE.findSpell] = save;
      return { total: cases.length, fails };
    });
    report("辨識命名", r.total, r.fails);
  }
  await p.close();

  /* ── 5. 互動:鋼琴只讓組成音發聲、摘要列音名單獨發聲、吉他撥弦與刷弦 ── */
  {
    const q = await openPage(browser, { viewport: { width: 390, height: 844 } });
    await q.click("#instPiano");
    await q.evaluate(() => {
      STATE.tab = "chord"; STATE.letter = 0; STATE.acc = 0; STATE.chordId = "maj7"; render();
      window._log = [];
      playSingle = m => window._log.push("s" + m);
      playNotes = m => window._log.push("n" + m.join(","));
    });
    const fails = [];
    let total = 0;
    const take = () => q.evaluate(() => window._log.splice(0).join(" "));
    const expect = async (label, want) => { total++; const got = await take(); if (got !== want) fails.push(label + ": " + (got || "(沒聲音)") + " ≠ " + (want || "(沒聲音)")); };
    let box = await q.locator("#keyboardCanvas").boundingBox();
    const g = await q.evaluate(() => { const cv = $("keyboardCanvas"); return { ww: cv._cssW / KB_WHITE_KEYS.length, h: cv._cssH, idx: KB_WHITE_IDX }; });
    const tapWhite = (m, fx, fy) => q.mouse.click(box.x + (g.idx[m] + fx) * g.ww, box.y + g.h * fy);
    await tapWhite(71, 0.5, 0.85); await expect("鋼琴 Cmaj7 點 B", "s71");
    await tapWhite(62, 0.5, 0.85); await expect("鋼琴 Cmaj7 點 D(非和弦音)", "");
    await tapWhite(64, 0.05, 0.3); await expect("鋼琴點 E 左上緣(黑鍵蓋住)", "s64");
    await q.locator("#kbSummary .tn", { hasText: "B" }).click(); await expect("摘要列點 B", "s71");
    await q.locator("#kbSummary b").click(); await expect("摘要列點和弦名稱", "n60,64,67,71");
    // 根音卡片沒有 ♮:♭ ♯ 是開關,按字母回到本位音
    const rn = () => q.evaluate(() => rootName());
    total++; if ((await q.evaluate(() => [...document.querySelectorAll("#accRow .key-btn")].map(b => b.textContent).join(""))) !== "♭♯/") fails.push("和弦分頁的根音卡片應該是 ♭ ♯ /");
    await q.locator("#letterRow .key-btn", { hasText: /^B$/ }).click(); await q.locator("#accRow .key-btn").nth(0).click();
    total++; if ((await rn()) !== "B♭") fails.push("B + ♭ = " + await rn());
    await q.locator("#accRow .key-btn").nth(0).click();
    total++; if ((await rn()) !== "B") fails.push("♭ 再按一次應該取消: " + await rn());
    await q.locator("#accRow .key-btn").nth(1).click(); await q.locator("#letterRow .key-btn", { hasText: /^E$/ }).click();
    total++; if ((await rn()) !== "E") fails.push("按字母應該回到本位音: " + await rn());
    // 根音卡片的 /:下一個字母(+ ♭ ♯)是低音;選好之後再按字母是換根音(低音照規則跟著走)
    await q.evaluate(() => { STATE.letter = 0; STATE.acc = 0; STATE.chordId = "maj"; STATE.bassIv = null; render(); });
    const title = () => q.evaluate(() => chordTitle(chordById(STATE.chordId)));
    const L = x => q.locator("#letterRow .key-btn", { hasText: new RegExp("^" + x + "$") });
    await q.click("#rootSlash"); await L("E").click();
    total++; if ((await title()) !== "C/E") fails.push("根音卡片 / + E: " + await title());
    total++; if ((await take()) !== "n64,67,72") fails.push("選好低音要彈 C/E 的轉位");
    await q.locator("#accRow .key-btn").nth(0).click();
    total++; if ((await title()) !== "C/E♭") fails.push("根音卡片 / + E + ♭: " + await title());
    await L("G").click();
    // 換根音 = 換和弦,低音回到原位(不是跟著走變 G/B♭——那樣從 C/E 換到 G 會得到 G/B,使用者回報不方便)
    total++; if ((await title()) !== "G" || await q.evaluate(() => !!rootSlashState())) fails.push("選好低音後按字母應該換根音、回到原位: " + await title());
    await q.click("#rootSlash"); await L("G").click();
    total++; if ((await title()) !== "G") fails.push("低音 = 根音應該回到原位: " + await title());
    await q.click("#rootSlash"); await q.locator("#quickGrid .quick-btn", { hasText: /^m7$/ }).click(); await L("A").click();
    total++; if ((await title()) !== "Am7") fails.push("換和弦後 / 應該失效: " + await title());
    // 根音一直是金色,低音用青色框另外標
    await q.click("#rootSlash"); await L("E").click();
    total++; if (!(await q.evaluate(() => { const bs = [...document.querySelectorAll("#letterRow .key-btn")]; return bs.find(b => b.textContent === "A").getAttribute("aria-pressed") === "true" && bs.find(b => b.textContent === "E").classList.contains("bass"); }))) fails.push("根音要維持金色、低音另外標");
    total++; if (await q.locator("#accRow .key-btn.bass").count() !== 0) fails.push("沒選中的 ♭ ♯ 不該亮青框");
    await q.click("#rootSlash");
    await q.click("#tabScale");
    total++; if (await q.locator("#accRow .key-btn").count() !== 2) fails.push("音階分頁不該有 /");
    await q.click("#tabChord");
    total++; if (await q.evaluate(() => !!rootSlashState())) fails.push("換分頁回來 / 應該取消");
    await q.evaluate(() => { STATE.letter = 0; STATE.acc = 0; STATE.chordId = "maj7"; STATE.bassIv = null; render(); }); await take();

    await q.click("#instGuitar");
    await q.evaluate(() => { STATE.chordId = "maj"; render(); });
    // 吉他和弦分頁:上方是這個和弦的每種指法排在一起(不是長指板)
    const gal = await q.evaluate(() => ({ n: document.querySelectorAll("#gtrDiagrams .gd").length, list: currentVoicingSet().list.length,
      canvas: $("keyboardCanvas").getBoundingClientRect().height, on: document.querySelectorAll("#gtrDiagrams .gd.on").length,
      labels: [...document.querySelectorAll("#gtrDiagrams .gd-lab")].map(x => x.textContent).join(" / ") }));
    total++; if (gal.n !== gal.list || gal.n < 2 || gal.canvas !== 0 || gal.on !== 1) fails.push("吉他和弦指法並排不對: " + JSON.stringify(gal));
    // 在選中的那張圖(C 開放 × 3 2 0 1 0)上:點一下 = 整個和弦(點在哪條弦都一樣),左右滑 = 一條一條撥
    const svgBox = await q.locator("#gtrDiagrams .gd.on svg").boundingBox();
    const W = await q.evaluate(() => VSVG.W), X0 = await q.evaluate(() => VSVG.x0), GAP = await q.evaluate(() => VSVG.gap);
    const sx = s => svgBox.x + (X0 + s * GAP) / W * svgBox.width, sy = svgBox.y + svgBox.height * 0.6;
    await q.mouse.click(sx(1), sy); await expect("吉他 C 點和弦圖(5 弦位置)= 整個和弦", "n48,52,55,60,64");
    await q.mouse.click(sx(0), sy); await expect("吉他 C 點和弦圖(× 的 6 弦位置)= 整個和弦", "n48,52,55,60,64");
    await q.mouse.move(sx(0), sy); await q.mouse.down();
    for (let i = 1; i <= 12; i++) await q.mouse.move(sx(0) + (sx(5) - sx(0)) * i / 12, sy);
    await q.mouse.up();
    await expect("吉他 C 由 6 弦刷到 1 弦", "s48 s52 s55 s60 s64");
    // 點另一張圖 = 選它並刷一次
    await q.locator("#gtrDiagrams .gd").nth(1).click();
    total++; if ((await q.evaluate(() => STATE.vIdx)) !== 1 || !(await take()).startsWith("n")) fails.push("點另一張指法圖沒有選它並發聲");
    // 結果面板:「+ 加入練習」把目前的和弦(含斜線低音)排進練習,練習按鈕上的數字跟著加
    await q.evaluate(() => { PRACTICE.steps = []; STATE.chordId = "maj"; STATE.bassIv = 4; STATE.bassFor = "maj"; render(); });
    await q.click("#addToPractice");
    const ap = await q.evaluate(() => [PRACTICE.steps.map(stepName).join(" "), $("practiceCount").textContent]);
    total++; if (ap[0] !== "C/E" || ap[1] !== "1") fails.push("加入練習: " + ap.join(" / "));
    // 低音列不再有「其他音…」下拉(交給根音卡片的 /);組成音是一列小晶片
    total++; if (await q.locator("#bassOther").count()) fails.push("低音列還有「其他音」下拉");
    // 使用說明:點 ? 打開、點外面關掉
    await q.click("#helpToggle");
    total++; if (await q.evaluate(() => $("helpPop").hidden || $("helpPop").querySelectorAll("li").length < 5)) fails.push("使用說明沒有打開");
    await q.mouse.click(5, 800);
    total++; if (!(await q.evaluate(() => $("helpPop").hidden))) fails.push("點外面沒有關掉使用說明");
    await q.evaluate(() => { PRACTICE.steps = []; STATE.bassIv = null; render(); }); await take();
    // 同一組音的另一種寫法:兩個方向都能一鍵切換(Cmaj7/B ↔ C/B),兩種都正確,不是更正
    await q.evaluate(() => { STATE.chordId = "maj7"; STATE.bassIv = 11; STATE.bassFor = "maj7"; render(); });
    await q.click("#slashAlt");
    total++; if ((await q.evaluate(() => chordTitle(chordById(STATE.chordId)))) !== "C/B") fails.push("Cmaj7/B 改用 → 應該是 C/B");
    await q.click("#slashAlt");
    total++; if ((await q.evaluate(() => chordTitle(chordById(STATE.chordId)))) !== "Cmaj7/B") fails.push("C/B 改用 → 應該是 Cmaj7/B");
    await q.evaluate(() => { STATE.chordId = "maj"; STATE.bassIv = 4; STATE.bassFor = "maj"; render(); });
    total++; if (await q.locator("#slashAlt").count()) fails.push("C/E 是轉位,不該出現另一種寫法");
    // 和弦名稱不寫重升重降:Cdim7 的七音當低音寫 Cdim7/A(組成音拼寫仍是 B♭♭);反查的名稱也一樣
    await q.evaluate(() => { STATE.chordId = "dim7"; STATE.bassIv = 9; STATE.bassFor = "dim7"; render(); });
    const dn = await q.evaluate(() => [chordTitle(chordById("dim7")), findChordName(0, chordById("dim7"), 9, "sharp"), currentNotes().map(n => n.name).join(" ")]);
    total++; if (dn[0] !== "Cdim7/A" || dn[1] !== "Cdim7/A" || dn[2] !== "C E♭ G♭ B♭♭") fails.push("重降:" + dn.join(" | "));
    await take();
    // 吉他斜線和弦:摘要列要列出低音、排最前面(C/B 原本只寫 C E G)
    await q.evaluate(() => { STATE.chordId = "maj"; STATE.bassIv = 11; STATE.bassFor = "maj"; render(); });
    const gs = await q.evaluate(() => [...document.querySelectorAll("#kbSummary .tn")].map(x => x.textContent).join(" "));
    total++; if (gs !== "B E G C") fails.push("吉他 C/B 摘要列要照實際的音由低到高(× 2 2 0 1 0 = B E G C): " + gs);
    // 每一個斜線和弦指法(不只第一個)最低的弦都要是名稱寫的低音
    const lowBad = await q.evaluate(() => { const bad = [];
      for (const def of CHORDS) for (let rp = 0; rp < 12; rp++) for (let iv = 1; iv < 12; iv++) {
        const bpc = (rp + iv) % 12;
        for (const v of chordVoicingsFor(rp, def, bpc).list) { const low = v.frets.findIndex(f => f >= 0); if (low < 0 || pcOf(GTR_OPEN[low] + v.frets[low]) !== bpc) bad.push(def.id + " " + rp + "/" + bpc); }
      } return bad; });
    total++; if (lowBad.length) fails.push("斜線和弦指法最低音不是低音: " + lowBad.slice(0, 5).join(", "));
    await q.evaluate(() => { STATE.bassIv = null; render(); }); await take();
    // 吉他音階分把位:大調 7 個(每弦 3 音)、五聲 5 個(每弦 2 音,A 小調五聲 box 1 在 5~8 格);
    // 預設是 6 弦根音那個把位,選了把位時其他位置的音只畫淡淡的小點;「全部」才整個指板都畫
    const sp = await q.evaluate(() => {
      STATE.tab = "scale"; STATE.letter = 0; STATE.acc = 0; STATE.scaleId = "ionian"; STATE.scalePos = 0; render();
      const maj = scalePositions().length, rows = document.querySelectorAll("#scalePosRow [data-pos]").length;
      const gv = guitarView();
      STATE.letter = 5; STATE.scaleId = SCALES.find(x => /pent/i.test(x.id) && x.t.length === 5 && x.t.includes("♭3")).id; render();
      const pent = scalePositions(), box1 = pent.find(p => p.k === 0);
      STATE.scalePos = -1; render(); const allDots = guitarView().dots.length;
      STATE.scalePos = 0; STATE.tab = "chord"; STATE.letter = 0; render();
      return { maj, rows, dots: gv.dots.length, ghosts: gv.ghosts.length, pent: pent.length, box1: box1.lo + "-" + box1.hi, allDots };
    });
    total++; if (sp.maj !== 7 || sp.rows !== 8 || sp.pent !== 5 || sp.box1 !== "5-8" || !sp.ghosts || sp.allDots <= sp.dots) fails.push("吉他音階把位: " + JSON.stringify(sp));
    // 全部音階 × 12 根音的每個把位:音都在音階裡、沒有負格、六條弦都有音;藍調 = 五聲 box + ♭5(5 個、box 1 在 5~8 格);
    // 把位超過第 12 格時指板平移(永遠 12 格),不拉長
    const sp2 = await q.evaluate(() => { const bad = []; STATE.tab = "scale"; STATE.inst = "guitar";
      for (const sc of SCALES) for (let r = 0; r < 12; r++) { const [l, a] = PC_SPELL[r]; STATE.letter = l; STATE.acc = a; STATE.scaleId = sc.id;
        const set = new Set(currentNotes().map(x => pcOf(x.midi)));
        for (const q of scalePositions()) {
          if (q.notes.some(x => x.f < 0 || !set.has(pcOf(GTR_OPEN[x.s] + x.f)))) bad.push(sc.id + " 音不對");
          if (new Set(q.notes.map(x => x.s)).size < 6) bad.push(sc.id + " 少了弦");
          STATE.scalePos = q.k; const gv = guitarView();
          if (gv.frets !== 12 || gv.first + gv.frets < q.hi || gv.first >= q.lo && q.lo > 0) bad.push(sc.id + " 指板沒有把整個把位放進來");
        } }
      STATE.letter = 5; STATE.acc = 0; STATE.scaleId = "bluesMin"; const bl = scalePositions(); const box1 = bl.find(p => p.k === 0);
      STATE.scalePos = 0; STATE.tab = "chord"; STATE.letter = 0; render();
      return { bad: [...new Set(bad)].slice(0, 5), blues: bl.length, box1: box1.lo + "-" + box1.hi };
    });
    total++; if (sp2.bad.length || sp2.blues !== 5 || sp2.box1 !== "5-8") fails.push("吉他音階把位全檢: " + JSON.stringify(sp2));
    // 鋼琴音階只顯示一個八度(從 C 或 F 開始)
    await q.click("#instPiano");
    const po = await q.evaluate(() => { STATE.tab = "scale"; STATE.scaleId = "ionian"; STATE.letter = 0; render(); const c = KB_WHITE_KEYS.length; STATE.letter = 4; render(); const g = [KB_LOW % 12, KB_WHITE_KEYS.length]; STATE.tab = "chord"; STATE.letter = 0; render(); return [c, g]; });
    total++; if (po[0] !== 8 || po[1][0] !== 5 || po[1][1] !== 9) fails.push("鋼琴音階一個八度: " + JSON.stringify(po));
    // 每個音階的公式都在一個八度內、由低到高,鋼琴上剛好是主音到高八度主音(新增音階時別超過)
    const over = await q.evaluate(() => { const bad = []; STATE.tab = "scale"; STATE.inst = "piano";
      for (const sc of SCALES) { STATE.scaleId = sc.id; const se = sc.t.map(tokenSemi), d = displayNotes().map(n => n.midi);
        if (Math.max(...se) >= 12 || !se.every((x, i) => !i || x > se[i - 1]) || Math.max(...d) - Math.min(...d) !== 12) bad.push(sc.id); }
      STATE.tab = "chord"; STATE.inst = "guitar"; render(); return bad; });
    total++; if (over.length) fails.push("音階超過一個八度: " + over.join(", "));
    await q.click("#instGuitar");
    // 音階分頁仍然是長指板
    await q.click("#tabScale");
    total++; if (await q.evaluate(() => $("keyboardCanvas").getBoundingClientRect().height === 0 || !$("gtrDiagrams").hidden)) fails.push("音階分頁應該用長指板");
    await q.click("#tabChord");
    total++;
    if (q._errors.length) fails.push("頁面錯誤: " + q._errors.join("; "));
    report("互動", total, fails);
    await q.close();
  }

  /* ── 5b. iPhone 靜音開關:有 Audio Session API 就設成 playback;沒有的舊 iOS 提示一次 ── */
  {
    const fails = [];
    const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
    // 新 iOS:有 navigator.audioSession
    let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IOS_UA, hasTouch: true, isMobile: true });
    let q = await ctx.newPage();
    await q.addInitScript(() => { navigator.audioSession = { type: "auto" }; });
    await q.route(/^https?:\/\//, r => r.abort());
    await q.goto(PAGE);
    await q.locator("#kbSummary b").click();
    await q.waitForTimeout(3500);
    const a = await q.evaluate(() => ({ type: navigator.audioSession.type, status: audioStatusKey }));
    if (a.type !== "playback") fails.push("有 audioSession 時沒設成 playback: " + a.type);
    if (a.status === "iosMuteHint") fails.push("有 audioSession 時不該出現靜音提示");
    await ctx.close();
    // 舊 iOS:沒有 audioSession → 第一次發聲後提示;第二次開頁面不再提示
    ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, userAgent: IOS_UA, hasTouch: true, isMobile: true });
    q = await ctx.newPage();
    await q.route(/^https?:\/\//, r => r.abort());
    await q.goto(PAGE);
    await q.locator("#kbSummary b").click();
    await q.waitForFunction(() => audioStatusKey === "iosMuteHint", null, { timeout: 15000 }).catch(() => fails.push("舊 iOS 沒有出現靜音提示"));
    const clipped = await q.evaluate(() => { const el = $("audioStatus"); const w = el.parentElement.getBoundingClientRect(), r = el.getBoundingClientRect(); return r.right > w.right + 1; });
    if (clipped) fails.push("靜音提示超出鍵盤區(被切掉)");
    await q.reload();
    await q.locator("#kbSummary b").click();
    await q.waitForTimeout(4000);
    if (await q.evaluate(() => audioStatusKey === "iosMuteHint")) fails.push("靜音提示第二次開頁面又出現");
    await ctx.close();
    report("iPhone 靜音開關", 5, fails);
  }

  /* ── 5c. 換和弦練習:輸入板排進行、上方換成「現在 / 下一個」兩張圖、節拍器實際換和弦 ── */
  {
    const q = await openPage(browser, { viewport: { width: 390, height: 844 } });
    await q.click("#instPiano");
    await q.click("#practiceOpen");
    const fails = [];
    let total = 0;
    const check = (cond, msg) => { total++; if (!cond) fails.push(msg); };
    const steps = () => q.evaluate(() => [...document.querySelectorAll("#prSteps span:not(.pr-steps-empty)")].map(x => x.textContent).join(" "));
    // 沒有範例進行、沒有調性選單;一開始是空的,開始鈕不在
    check(await q.evaluate(() => !document.querySelector("#prPreset, #prKey, #prPresets")), "還有範例進行或調性選單");
    check((await steps()) === "", "一開始進行應該是空的");
    check(await q.locator("#prGo").count() === 0, "進行是空的時不該有開始鈕");
    // 練習時上方指板/鍵盤換成兩張和弦圖
    check(await q.evaluate(() => document.querySelector(".kb-wrap").getBoundingClientRect().height === 0 && $("practiceStage").getBoundingClientRect().height > 0), "練習時上方應該是和弦圖、不是指板/鍵盤");
    check(await q.evaluate(() => $("practiceStage").closest(".topbar") !== null), "和弦圖要在釘住的上方區塊裡");
    // 輸入板:根音 + 和弦種類 → 立刻加進去
    const pad = async (letter, acc, quick) => {
      await q.locator("#prLetters .key-btn", { hasText: new RegExp("^" + letter + "$") }).click();
      if (acc) await q.locator("#prAcc .key-btn").nth(acc < 0 ? 0 : 1).click();
      await q.locator("#prQuick .quick-btn", { hasText: new RegExp("^" + quick + "$") }).click();
    };
    await pad("C", 0, "maj"); await pad("G", 0, "maj"); await pad("A", 0, "min"); await pad("F", 0, "maj");
    check((await steps()) === "C G Am F", "輸入板排出來的進行: " + await steps());
    check(await q.locator("#prSteps span.new").count() === 1, "新加的和弦要閃一下");
    // 沒有 ♮:輸入板只有 ♭ ♯ /,按字母就是本位音,♭ ♯ 再按一次取消
    check(await q.evaluate(() => [...document.querySelectorAll("#prAcc .key-btn")].map(b => b.textContent).join("") === "♭♯/"), "輸入板的記號鈕應該是 ♭ ♯ /");
    // 斜線:按 / 再按低音,改的是最後一個和弦;♭ 是開關;按和弦種類就離開斜線模式
    await q.click("#prSlash"); await q.locator("#prLetters .key-btn", { hasText: /^C$/ }).click();
    check((await steps()) === "C G Am F/C", "/ + C: " + await steps());
    await q.click("#prSlash"); await q.locator("#prLetters .key-btn", { hasText: /^E$/ }).click(); await q.locator("#prAcc .key-btn").nth(0).click();
    check((await steps()) === "C G Am F/E♭", "/ + E + ♭: " + await steps());
    await q.locator("#prAcc .key-btn").nth(0).click();
    check((await steps()) === "C G Am F/E", "♭ 再按一次取消: " + await steps());
    await q.click("#prSlash"); await q.locator("#prLetters .key-btn", { hasText: /^F$/ }).click();
    check((await steps()) === "C G Am F", "低音 = 根音就是原位: " + await steps());
    // 低音選好之後再按字母 = 下一個和弦的根音,不能再改到低音
    await q.click("#prSlash"); await q.locator("#prLetters .key-btn", { hasText: /^A$/ }).click();
    await q.locator("#prLetters .key-btn", { hasText: /^G$/ }).click();
    check((await steps()) === "C G Am F/A" && await q.evaluate(() => !PRACTICE.slash && PRACTICE.pad.letter === 4), "選好低音後按字母應該是下一個根音: " + await steps());
    // 根音 / 低音:還沒按種類就按 / = 大三和弦(G / F 三下就是 G/F,使用者嫌 G maj / F 太麻煩)
    await q.click("#prSlash"); await q.locator("#prLetters .key-btn", { hasText: /^F$/ }).click();
    check((await steps()) === "C G Am F/A G/F", "G / F 應該是 G/F: " + await steps());
    await q.click("#prUndo");
    await q.click("#prSlash"); await q.locator("#prLetters .key-btn", { hasText: /^F$/ }).click();
    check((await steps()) === "C G Am F", "低音選回根音: " + await steps());
    await q.click("#prSlash"); await q.locator("#prQuick .quick-btn", { hasText: /^min$/ }).click(); await q.click("#prUndo");
    await pad("B", -1, "maj");
    check((await steps()) === "C G Am F B♭" && await q.evaluate(() => !PRACTICE.slash), "按和弦種類要離開斜線模式、新加一個: " + await steps());
    await q.locator("#prLetters .key-btn", { hasText: /^B$/ }).click();
    check(await q.evaluate(() => PRACTICE.pad.acc === 0), "按字母應該回到本位音");
    await q.click("#prUndo");
    const st = await q.evaluate(() => ({ now: $("prNow").textContent, next: $("prNext").textContent,
      fs: [...document.querySelectorAll(".pr-now b")].map(b => getComputedStyle(b).fontSize), dg: document.querySelectorAll("#practiceStage svg.dg").length }));
    check(st.now === "C" && st.next === "G", "現在/下一個: " + st.now + " / " + st.next);
    check(st.fs[0] === st.fs[1], "現在/下一個字級不同: " + st.fs.join(" / "));
    check(st.dg === 2, "兩個和弦的按法要同時顯示(" + st.dg + ")");
    // 鋼琴小鍵盤:固定兩個八度、從 C 或 F 開始,兩張一樣大
    const kb = await q.evaluate(() => PRACTICE.steps.map(st => withStep(st, () => ((pianoDiagramSVG().match(/<rect x="[\d.]+" y="0" width="13.2"/g) || []).length))));
    check(kb.every(n => n === 14), "小鍵盤不是固定兩個八度: " + kb.join(","));
    const firstKey = await q.evaluate(() => withStep(PRACTICE.steps[2], () => { let lo = Math.min(...displayNotes().map(n => n.midi)); while (![0, 5].includes(pcOf(lo))) lo--; return simpleName(pcOf(lo), "sharp"); }));
    check(firstKey === "F", "Am 的小鍵盤應該從 F 開始,實際從 " + firstKey);
    const wh = await q.evaluate(() => [...document.querySelectorAll("#practiceStage svg.dg")].map(x => Math.round(x.getBoundingClientRect().width) + "x" + Math.round(x.getBoundingClientRect().height)));
    check(wh[0] === wh[1], "現在/下一個的小鍵盤大小不同: " + wh.join(" / "));
    // 刪除最後一個、文字框同步、斜線和弦、打錯提示
    await q.click("#prUndo");
    check((await steps()) === "C G Am", "刪除最後一個: " + await steps());
    check((await q.inputValue("#prCustom")) === "C G Am", "文字框沒有跟輸入板同步");
    await q.fill("#prCustom", "C D/F# Em Xq"); await q.press("#prCustom", "Enter");
    check((await steps()) === "C D/F♯ Em", "文字框輸入: " + await steps());
    check(await q.locator(".pr-bad").count() === 1, "打錯的字要提示");
    // 鋼琴的轉位照輸入的名稱:沒有斜線 = 原位,低音是和弦內音 = 真正的轉位(不在原位底下多加一個音),
    // 和弦外的低音才是另外加在下面
    const inv = await q.evaluate(() => [[0, "maj", null], [0, "maj", 4], [0, "maj", 7], [0, "7", 10], [0, "maj", 11]]
      .map(([l, id, b]) => withStep({ letter: l, acc: 0, id, bass: b }, () => displayNotes().map(n => n.midi).join(","))));
    check(inv.join(" | ") === "60,64,67 | 64,67,72 | 67,72,76 | 70,72,76,79 | 59,60,64,67", "鋼琴轉位不對: " + inv.join(" | "));
    // 整組移調(斜線低音跟著走)、上次的進行存在裝置上、儲存/取消儲存/載入
    await q.click("#prUp"); await q.click("#prUp");
    check((await steps()) === "D E/G♯ F♯m", "移調 +2: " + await steps());
    await q.click("#prDown"); await q.click("#prDown");
    check((await steps()) === "C D/F♯ Em", "移調回來: " + await steps());
    check((await q.evaluate(() => localStorage.getItem("harmonymap.practice"))) === "C D/F♯ Em", "目前的進行沒有存在裝置上");
    await q.click("#prSave");
    check((await q.getAttribute("#prSave", "aria-pressed")) === "true" && await q.locator("#prSaved option").count() === 2, "儲存後應該出現在已存清單");
    await q.click("#prClearSteps");
    await q.selectOption("#prSaved", "0");
    check((await steps()) === "C D/F♯ Em", "載入已存的進行: " + await steps());
    await q.click("#prSave");
    check(await q.locator("#prSaved").count() === 0, "取消儲存後清單應該是空的");
    // 快捷鍵:字母 = 輸入板根音、- = ♭、Backspace = 刪除最後一個
    await q.locator("#practiceStage").click({ position: { x: 2, y: 2 } }).catch(() => {});
    await q.evaluate(() => document.activeElement && document.activeElement.blur());
    await q.keyboard.press("g"); await q.keyboard.press("-");
    check(await q.evaluate(() => PRACTICE.pad.letter === 4 && PRACTICE.pad.acc === -1), "快捷鍵 g、- 沒有設定輸入板根音");
    await q.keyboard.press("c"); await q.keyboard.press("/"); await q.keyboard.press("e");
    check((await steps()) === "C D/F♯ Em C/E", "快捷鍵 c / e: " + await steps());
    await q.keyboard.press("Backspace");
    await q.keyboard.press("Backspace");
    check((await steps()) === "C D/F♯", "Backspace 沒有刪除最後一個: " + await steps());
    await q.fill("#prCustom", "C D/F# Em"); await q.press("#prCustom", "Enter");
    // 吉他:下一個和弦的圖就是指板上會用的指法
    await q.click("#instGuitar"); await q.click("#practiceOpen").catch(() => {});
    const nt = await q.evaluate(() => { const lab = document.querySelectorAll("#practiceStage svg.dg")[1].getAttribute("aria-label");
      const st = PRACTICE.steps[1]; const b = st.bass == null ? null : pcOf(LETTER_PC[st.letter] + st.acc + st.bass);
      const vs = chordVoicingsFor(pcOf(LETTER_PC[st.letter] + st.acc), chordById(st.id), b); return [lab, gtrTabText(vs.list[vs.best].frets)]; });
    check(nt[0] === nt[1], "下一個和弦的吉他圖不是指板上會用的指法: " + nt.join(" / "));
    await q.click("#instPiano"); await q.click("#practiceOpen").catch(() => {});
    // 速度 − / +、卡片高度
    await q.click("#prFaster"); await q.click("#prFaster"); await q.click("#prSlower");
    check((await q.evaluate(() => PRACTICE.bpm)) === 75, "速度加減不對");
    const prH = await q.evaluate(() => Math.round($("practiceCard").getBoundingClientRect().height));
    check(prH <= 560, "練習卡片太高: " + prH + "px");
    check(await q.evaluate(() => document.querySelector(".info").getBoundingClientRect().height === 0 && $("rootCard").hidden && $("typeCard").hidden), "練習時根音卡片、清單、結果面板要收起來");
    // 和弦與節拍器同一刻:第一拍的點擊聲時間 = 和弦第一個音的開始時間(真的去排音,不 mock playCurrent)
    await q.evaluate(() => {
      window._clicks = []; window._notes = [];
      const pc0 = practiceClick; practiceClick = (t, acc) => { if (acc) window._clicks.push(t); return pc0(t, acc); };
      const sn0 = scheduleNote; scheduleNote = (m, when, dur, a) => { window._notes.push(when); return sn0(m, when, dur, a); };
      PRACTICE.bpm = 180; PRACTICE.beats = 2; PRACTICE.accomp = true;
    });
    await q.click("#prGo");
    await q.waitForTimeout(1500);
    await q.click("#prGo");
    const sync = await q.evaluate(() => window._clicks.map(t => Math.min(...window._notes.map(n => Math.abs(n - t)))));
    check(sync.length >= 2 && sync.every(d => d < 0.001), "和弦沒有跟節拍器第一拍同時開始(差 " + sync.map(d => Math.round(d * 1000) + "ms").join(", ") + ")");
    // 節拍器:180 BPM、每個和弦 2 拍
    await q.evaluate(() => { window._plays = 0; playCurrent = () => window._plays++; });
    await q.selectOption("#prBeats", "2");
    await q.evaluate(() => { PRACTICE.bpm = 180; });
    await q.click("#prGo");
    await q.waitForTimeout(1600);
    // 進行中:現在這個和弦的邊框跟著拍子發光(使用者要求)
    const glow = await q.evaluate(() => { const c = document.querySelector("#prSteps span.cur"); return c && getComputedStyle(c).animationName; });
    check(glow === "prGlow", "練習中現在的和弦沒有光暈動畫: " + glow);
    const glowCard = await q.evaluate(() => getComputedStyle(document.querySelector("#practiceStage .now")).animationName);
    check(glowCard === "prGlowCard", "練習中上方「現在」那張圖沒有光暈動畫: " + glowCard);
    const run = await q.evaluate(() => ({ plays: window._plays, now: $("prNow").textContent, step: PRACTICE.steps[PRACTICE.step], running: PRACTICE.running }));
    check(run.running && run.plays >= 2, "節拍器沒有在換和弦: 換了 " + run.plays + " 次");
    check(run.now === await q.evaluate(() => stepName(PRACTICE.steps[PRACTICE.step])), "「現在」不是目前這一步");
    await q.click("#prGo");
    const stopped = await q.evaluate(() => { const n = window._plays; return new Promise(r => setTimeout(() => r(window._plays === n && !PRACTICE.running), 900)); });
    check(stopped, "按停止後還在換和弦");
    await q.click("#prClose");
    check(await q.evaluate(() => $("practiceCard").hidden && !$("typeCard").hidden && document.querySelector(".kb-wrap").getBoundingClientRect().height > 0 && $("practiceStage").hidden), "結束練習後沒有回到原本的畫面");
    check(!q._errors.length, "頁面錯誤: " + q._errors.join("; "));
    report("換和弦練習", total, fails);
    await q.close();
  }

  /* ── 6. 英文介面:兩個分頁的每個條目都點一次,畫面上除了「中」不能有中文 ── */
  {
    const q = await openPage(browser);
    await q.click("#langToggle");
    const fails = [];
    let total = 0;
    for (const inst of ["piano", "guitar"]) for (const tab of ["chord", "scale"]) {
      if (tab === "scale" && inst === "guitar") continue;
      const r = await q.evaluate(([inst, tab]) => {
        STATE.inst = inst; STATE.tab = tab; STATE.search = ""; STATE.group[tab] = ""; render();
        const bad = [];
        const items = tab === "chord" ? CHORDS : SCALES;
        const cjk = () => { const m = document.body.innerText.replace(/中/g, "").match(/[㐀-鿿]+/g); return m ? m.slice(0, 3).join(",") : ""; };
        for (const it of items) {
          if (tab === "chord") STATE.chordId = it.id; else STATE.scaleId = it.id;
          render();
          const c = cjk();
          if (c) bad.push(inst + " " + (it.en || it.id) + ": " + c);
        }
        return { n: items.length, bad };
      }, [inst, tab]);
      total += r.n;
      fails.push(...r.bad);
    }
    total++;
    const pr = await q.evaluate(() => { STATE.inst = "piano"; STATE.tab = "chord"; PRACTICE.open = true; PRACTICE.steps = [{ letter: 0, acc: 0, id: "maj", bass: null }, { letter: 4, acc: 0, id: "7", bass: null }]; PRACTICE.step = 0; render();
      const m = document.body.innerText.replace(/中/g, "").match(/[\u3400-\u9fff]+/g); PRACTICE.open = false; render(); return m ? m.slice(0, 3).join(",") : ""; });
    if (pr) fails.push("練習卡片: " + pr);
    total++;
    // 換語言時上方分頁與樂器按鈕不能移位、文字不能被切掉(使用者要求)
    for (const w of [320, 390, 1280]) {
      const z = await openPage(browser, { viewport: { width: w, height: 700 } });
      const pos = () => z.evaluate(() => ["tabChord", "tabScale", "tabFind", "instPiano", "instGuitar"].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.width), e.scrollWidth > e.clientWidth + 1 ? "cut" : ""].join("/"); }).join(" "));
      const a1 = await pos(); await z.click("#langToggle"); const a2 = await pos();
      total++; if (a1 !== a2 || /cut/.test(a1 + a2)) fails.push("換語言分頁移位或文字被切(" + w + "px): " + a1 + " → " + a2);
      // 選中的分頁是粗體、比較寬,每一個分頁都要在選中時放得下(320px 的「Identify」曾經變成「Ident…」)
      for (const tb of ["tabScale", "tabFind", "tabChord"]) {
        await z.click("#" + tb);
        const cut = await z.evaluate(id => { const e = document.getElementById(id); return e.scrollWidth > e.clientWidth + 1 ? e.textContent : ""; }, tb);
        total++; if (cut) fails.push("選中的分頁文字被切(" + w + "px): " + cut);
      }
      await z.close();
    }
    const hp = await q.evaluate(() => { toggleHelp(true); const m = $("helpPop").innerText.match(/[\u3400-\u9fff]+/g); toggleHelp(false); return m ? m.slice(0, 3).join(",") : ""; });
    if (hp) fails.push("使用說明: " + hp);
    report("英文介面無中文", total, fails);
    await q.close();
  }

  /* ── 7. 版面:六種尺寸 × 鋼琴/吉他 ── */
  {
    const fails = [];
    let total = 0;
    const sizes = [[320, 568, true], [390, 844, false], [768, 1024, false], [1024, 768, false], [1366, 850, false], [844, 390, true]];
    for (const [w, h, shouldUnstick] of sizes) for (const inst of ["piano", "guitar"]) {
      total++;
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900 });
      await q.click(inst === "guitar" ? "#instGuitar" : "#instPiano");
      await q.waitForTimeout(150);
      const m = await q.evaluate(() => {
        const sum = $("kbSummary");
        return {
          hscroll: document.documentElement.scrollWidth > innerWidth,
          sumWrap: sum.scrollHeight > sum.clientHeight + 1 || sum.getBoundingClientRect().height > 48,
          small: [...document.querySelectorAll("button")].filter(x => x.offsetParent).map(x => x.getBoundingClientRect()).filter(r => r.width && (r.width < 24 || r.height < 24)).length,
          clipped: [...document.querySelectorAll(".quick-btn,.key-btn,.tabs button,.inst-switch button")].filter(x => x.offsetParent && x.scrollWidth > x.clientWidth + 1).map(x => x.textContent.trim()),
          unstick: document.querySelector(".topbar").classList.contains("unstick")
        };
      });
      const tag = w + "×" + h + " " + inst;
      if (m.hscroll) fails.push(tag + ": 有橫向捲動");
      if (m.sumWrap) fails.push(tag + ": 摘要列不只一行");
      if (m.small) fails.push(tag + ": " + m.small + " 顆按鈕小於 24px");
      if (m.clipped.length) fails.push(tag + ": 文字被截斷 " + m.clipped.join(","));
      if (m.unstick !== shouldUnstick) fails.push(tag + ": 釘住狀態應為 " + (shouldUnstick ? "不釘" : "釘住"));
      if (q._errors.length) fails.push(tag + ": 頁面錯誤 " + q._errors.join("; "));
      await q.close();
    }
    // 切換鋼琴/吉他時顯示區同高、底下的根音卡片不能移位(使用者要求)
    for (const [w, h] of [[320, 568], [390, 844], [768, 1024], [1280, 860]]) {
      const q = await openPage(browser, { viewport: { width: w, height: h } });
      for (const tab of ["Chord", "Scale", "Find"]) {
        await q.click("#tab" + tab);
        const m = {};
        for (const inst of ["Piano", "Guitar"]) {
          await q.click("#inst" + inst); await q.waitForTimeout(60);
          m[inst] = await q.evaluate(() => { const c = $("rootCard").hidden ? $("findCard") : $("rootCard");
            return Math.round(document.querySelector(".kb-wrap").getBoundingClientRect().height) + "/" + Math.round(c.getBoundingClientRect().top); });
        }
        total++; if (m.Piano !== m.Guitar) fails.push("切換樂器移位(" + w + "×" + h + " " + tab + "): 鋼琴 " + m.Piano + " 吉他 " + m.Guitar);
      }
      await q.close();
    }
    // 兩欄版面(≥900px,含大手機橫向 932×430):右邊顯示區的底部要跟左欄卡片對齊,不能空一大段(使用者回報);
    // 換樂器時兩邊與下面的清單都不能動
    for (const [w, h] of [[932, 430], [1024, 768], [1280, 860]]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: w < 1100, isMobile: w < 1100 });
      for (const tab of ["Chord", "Scale", "Find"]) {
        const got = {};
        for (const inst of ["Guitar", "Piano"]) {
          await q.evaluate(([t, i]) => { $("tab" + t).click(); $("inst" + i).click(); scrollTo(0, 0); }, [tab, inst]);
          await q.waitForTimeout(80);
          got[inst] = await q.evaluate(() => { const c = [$("rootCard"), $("findCard")].find(x => !x.hidden).getBoundingClientRect();
            return [Math.round(c.bottom), Math.round(document.querySelector(".kb-wrap").getBoundingClientRect().bottom), Math.round(document.querySelector(".lower").getBoundingClientRect().top)]; });
          total++;
          if (Math.abs(got[inst][0] - got[inst][1]) > 1) fails.push("兩欄沒對齊(" + w + "×" + h + " " + tab + " " + inst + "):左欄底 " + got[inst][0] + " 右邊底 " + got[inst][1]);
        }
        total++; if (got.Guitar.join() !== got.Piano.join()) fails.push("兩欄版面換樂器移位(" + w + "×" + h + " " + tab + "): " + got.Guitar + " → " + got.Piano);
      }
      // 比例:和弦圖最多放大 1.4 倍(圖裡的字才不會比介面的字大一截,使用者回報);鋼琴白鍵最寬 56px(一個八度不會變方磚)
      const prop = await q.evaluate(() => {
        $("tabChord").click(); $("instGuitar").click();
        const sv = document.querySelector("#gtrDiagrams svg"), bb = sv.getBoundingClientRect(), vb = sv.viewBox.baseVal;
        const k = Math.min(bb.width / vb.width, bb.height / vb.height);
        $("tabScale").click(); $("instPiano").click();
        const key = $("keyboardCanvas").getBoundingClientRect().width / Math.max(KB_WHITE_KEYS.length, 1);
        $("tabChord").click();
        return { k, key };
      });
      total++; if (prop.k > 1.41) fails.push("和弦圖放大 " + prop.k.toFixed(2) + " 倍(" + w + "×" + h + "),圖裡的字會比介面大");
      total++; if (prop.key > 56.5) fails.push("鋼琴白鍵 " + Math.round(prop.key) + "px 寬(" + w + "×" + h + ")");
      await q.close();
    }
    // 轉橫向:iPhone 的 resize 事件比版面還早到,第一次算出來是直向的小鍵盤,捲動後才變大(使用者回報)。
    // 模擬成「resize 完全沒幫上忙」(在 App 之前攔掉),轉向後大小要跟直接用橫向打開一樣
    for (const inst of ["Piano", "Guitar"]) {
      const ref = await openPage(browser, { viewport: { width: 932, height: 430 }, hasTouch: true, isMobile: true });
      await ref.click("#inst" + inst); await ref.waitForTimeout(100);
      const want = await ref.evaluate(() => [$("keyboardCanvas"), $("gtrDiagrams")].map(e => Math.round(e.getBoundingClientRect().height)).join("/"));
      await ref.close();
      const q = await browser.newPage({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
      await q.route(/^https?:\/\//, r => r.abort());
      await q.addInitScript(() => { window.addEventListener("resize", e => e.stopImmediatePropagation()); });
      await q.goto(PAGE);
      await q.click("#inst" + inst); await q.waitForTimeout(100);
      await q.setViewportSize({ width: 932, height: 430 }); await q.waitForTimeout(300);
      const got = await q.evaluate(() => [$("keyboardCanvas"), $("gtrDiagrams")].map(e => Math.round(e.getBoundingClientRect().height)).join("/"));
      total++; if (got !== want) fails.push("轉橫向後大小不對(" + inst + "):" + got + ",直接橫向打開是 " + want);
      await q.close();
    }
    // 吉他和弦圖不能超出格子(iPhone 上網頁字型晚一步載入、標籤變高時,圖超出格子底部,使用者回報):
    // 模擬標籤變高,圖與標籤都要還在格子裡
    for (const [w, h] of [[320, 568], [390, 844], [430, 932], [932, 430]]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      await q.click("#instGuitar"); await q.waitForTimeout(100);
      await q.addStyleTag({ content: ".gtr-dgs .gd-lab{font-size:19px !important;line-height:2.4 !important}" });
      await q.waitForTimeout(250);
      const bad = await q.evaluate(() => [...document.querySelectorAll("#gtrDiagrams .gd")].map(d => {
        const c = d.getBoundingClientRect(), sv = d.querySelector("svg").getBoundingClientRect(), lb = d.querySelector(".gd-lab").getBoundingClientRect();
        return sv.bottom > c.bottom + 0.5 || lb.top < c.top - 0.5 ? Math.round(sv.bottom - c.bottom) + "/" + Math.round(c.top - lb.top) : "";
      }).filter(Boolean));
      total++; if (bad.length) fails.push("和弦圖超出格子(" + w + "×" + h + "): " + bad.join(" "));
      // 粗/細(弦的方向)在手機上要看得到:螢幕上至少 10.5px、不能被格子切掉(原本跟著圖縮到 5~8px,使用者回報看不到)
      await q.addStyleTag({ content: ".gtr-dgs .gd-lab{font-size:inherit !important;line-height:normal !important}" }); await q.waitForTimeout(200);
      const lab = await q.evaluate(() => [...document.querySelectorAll("#gtrDiagrams .gd")].map(d => {
        const sv = d.querySelector("svg"), k = sv.getBoundingClientRect().width / sv.viewBox.baseVal.width, c = d.getBoundingClientRect();
        return [...d.querySelectorAll("text.slab")].map(t => { const r = t.getBoundingClientRect(); const px = parseFloat(t.getAttribute("font-size")) * k;
          return px < 10.5 || r.left < c.left || r.right > c.right ? t.textContent + " " + px.toFixed(1) + "px" : ""; }).filter(Boolean).join(",");
      }).filter(Boolean));
      total++; if (lab.length) fails.push("粗/細太小或被切掉(" + w + "×" + h + "): " + lab.join(" "));
      await q.close();
    }
    // 鍵盤設定面板:整個放得進鍵盤區(overflow:hidden 會切掉)、不能蓋住齒輪、再點齒輪要關得掉(點在圖示上也一樣)
    for (const [w, h] of [[320, 568], [844, 390], [390, 844], [1280, 860]]) for (const inst of ["Piano", "Guitar"]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900 });
      await q.click("#inst" + inst);
      await q.click("#kbGear svg");
      const r = await q.evaluate(() => { const g = $("kbGear").getBoundingClientRect(), pp = $("kbPopover").getBoundingClientRect(), wr = document.querySelector(".kb-wrap").getBoundingClientRect();
        return { open: !$("kbPopover").hidden, overlap: !(pp.right <= g.left || pp.left >= g.right || pp.bottom <= g.top || pp.top >= g.bottom),
                 inside: pp.left >= wr.left - 0.5 && pp.top >= wr.top - 0.5 && pp.bottom <= wr.bottom + 0.5 && pp.right <= wr.right + 0.5 }; });
      await q.click("#kbGear svg");
      const closed = await q.evaluate(() => $("kbPopover").hidden);
      total++;
      if (!r.open || r.overlap || !r.inside || !closed) fails.push("鍵盤設定面板(" + w + "×" + h + " " + inst + "): " + JSON.stringify(r) + " 再點齒輪關掉=" + closed);
      await q.close();
    }
    // 模擬真人操作抓到的問題(每一項都是實際點下去會點錯/縮放/頓的情形)
    {
      const q = await openPage(browser, { viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
      // iOS 點進字級 < 16px 的輸入框會自動放大整頁
      const small = await q.evaluate(() => { PRACTICE.open = true; render(); const r = [...document.querySelectorAll("input,select,textarea")].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id); PRACTICE.open = false; render(); return r; });
      total++; if (small.length) fails.push("觸控裝置輸入框字級 < 16px(iOS 會自動放大): " + small.join(","));
      // 練習:加第一個和弦、移調時,輸入板與設定列不能跳
      await q.click("#practiceOpen");
      const pos = () => q.evaluate(() => ["prLetters", "prUp"].map(id => Math.round($(id).getBoundingClientRect().top + scrollY)).join("/"));
      const p0 = await pos();
      await q.locator("#prLetters .key-btn", { hasText: /^C$/ }).click(); await q.locator("#prQuick .quick-btn", { hasText: /^maj$/ }).click();
      const p1 = await pos();
      total++; if (p0.split("/")[0] !== p1.split("/")[0]) fails.push("練習加第一個和弦時輸入板移位: " + p0 + " → " + p1);
      for (const [r, k] of [["A", "min"], ["F", "maj"], ["G", "7"], ["E", "m7"]]) { await q.locator("#prLetters .key-btn", { hasText: new RegExp("^" + r + "$") }).click(); await q.locator("#prQuick .quick-btn", { hasText: new RegExp("^" + k + "$") }).click(); }
      const p2 = await pos(); await q.click("#prUp"); await q.click("#prUp"); const p3 = await pos();
      total++; if (p2 !== p3) fails.push("練習移調時設定列移位: " + p2 + " → " + p3);
      // 長和弦名稱(A♭m7♭5/C♭)在 320px 要放得下,兩格字級一樣
      const fit = await q.evaluate(() => {
        const keep = PRACTICE.steps; PRACTICE.steps = [{ letter: 0, acc: 0, id: "maj7", bass: null }, { letter: 5, acc: -1, id: "m7b5", bass: 3 }]; PRACTICE.step = 0; render();
        const a = $("prNow"), b = $("prNext");
        const r = { over: b.scrollWidth > b.clientWidth + 1 || a.scrollWidth > a.clientWidth + 1, same: getComputedStyle(a).fontSize === getComputedStyle(b).fontSize };
        PRACTICE.steps = keep; render(); return r;
      });
      total++; if (fit.over || !fit.same) fails.push("練習的現在/下一個:長名稱被切或兩格字級不同 " + JSON.stringify(fit));
      await q.click("#prClose");
      // 矮螢幕往下捲之後換分頁,分頁鈕要留在原地:吉他音階時釘住區是釘著的,換到辨識會改成不釘
      await q.click("#instGuitar"); await q.click("#tabScale");
      await q.evaluate(() => scrollTo(0, 300));
      const y0 = await q.evaluate(() => Math.round($("tabFind").getBoundingClientRect().top));
      await q.evaluate(() => $("tabFind").click());   // 不用 q.click:它會先把按鈕捲進畫面
      const y1 = await q.evaluate(() => Math.round($("tabFind").getBoundingClientRect().top));
      total++; if (Math.abs(y1 - y0) > 1) fails.push("換分頁時分頁鈕移位: " + y0 + " → " + y1);
      // 程度收合:選中的那一層也要收得起來;選擇跳進收起來的那一層時要自動打開
      const tier = await q.evaluate(() => {
        STATE.tab = "chord"; STATE.search = ""; STATE.level = 0; STATE.chordId = "maj7"; STATE.tierClosed.clear(); render();
        const first = () => document.querySelector(".tier-toggle");
        first().click(); const closed = first().getAttribute("aria-expanded") === "false";
        STATE.chordId = "maj"; render(); STATE.chordId = "maj7"; render();
        const reopened = first().getAttribute("aria-expanded") === "true";
        return { closed, reopened };
      });
      total++; if (!tier.closed || !tier.reopened) fails.push("程度收合: 選中那層收得起來=" + tier.closed + " 跳進收起來的那層會打開=" + tier.reopened);
      // 320px:順階和弦表不能要橫滑才看得到組成音;摘要列放不下時先縮副標,音名至少看得到大半
      const nar = await q.evaluate(() => {
        STATE.tab = "scale"; STATE.scaleId = "ionian"; STATE.letter = 0; STATE.acc = 0; render();
        const tb = document.querySelector("table.dia"), tn = $("kbSummary").querySelector(".tones");
        const r = { over: tb.scrollWidth - tb.parentElement.clientWidth, tones: tn.getBoundingClientRect().width / tn.scrollWidth };
        STATE.tab = "chord"; render(); return r;
      });
      total++; if (nar.over > 1) fails.push("320px 順階和弦表超出 " + nar.over + "px");
      total++; if (nar.tones < 0.6) fails.push("320px 摘要列音名只剩 " + Math.round(nar.tones * 100) + "%(副標應該先縮)");
      // 背景執行緒算的指法要跟主執行緒一模一樣(兩個根音 × 全部和弦)
      const wk = await q.evaluate(async () => {
        if (!voicingWorker) return "Worker 沒有建起來";
        const w = new Worker(URL.createObjectURL(new Blob([voicingWorkerSource()], { type: "text/javascript" })));
        const jobs = []; for (const r of [1, 6]) for (const d of CHORDS) jobs.push([r, d.id]);
        const got = new Map();
        const err = await new Promise(res => { w.onmessage = e => { got.set(e.data[0], e.data[1]); if (got.size === jobs.length) res(""); }; w.onerror = e => res(e.message || "error"); w.postMessage(jobs); });
        w.terminate();
        if (err) return err;
        VOICING_CACHE.clear();
        const bad = jobs.filter(([r, id]) => JSON.stringify(chordVoicingsFor(r, chordById(id))) !== JSON.stringify(got.get(r + "|" + id + "|null")));
        return bad.length ? "不同: " + bad.slice(0, 3).map(j => j.join(" ")).join(", ") : "";
      });
      total++; if (wk) fails.push("背景指法計算: " + wk);
      if (q._errors.length) fails.push("模擬操作: 頁面錯誤 " + q._errors.join("; "));
      await q.close();
    }
    report("版面", total, fails);
  }

  await browser.close();

  let failed = 0;
  for (const r of results) {
    const ok = !r.fails.length;
    console.log((ok ? "✓ " : "✗ ") + r.group + "  " + (r.total - Math.min(r.total, r.fails.length)) + "/" + r.total);
    for (const f of r.fails.slice(0, 20)) console.log("    " + f);
    if (r.fails.length > 20) console.log("    …另外 " + (r.fails.length - 20) + " 項");
    failed += r.fails.length;
  }
  console.log(failed ? "\n失敗 " + failed + " 項" : "\n全部通過");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
