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
let lastT = Date.now();
function report(group, total, fails){ results.push({ group, total, fails, ms: Date.now() - lastT }); lastT = Date.now(); }

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
        "A|min":"× 0 2 2 1 0", "E|min":"0 2 2 0 0 0", "D|min":"× × 0 2 3 1", "F|maj":"× × 3 2 1 1", "E|7":"0 2 0 1 0 0",
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
          // 教材首選(TEACH_CANON,使用者逐一確認過)優先於資料庫;資料庫第一名中間打叉的不當推薦(使用者決定),不檢查
          const mid = f => { const lo = f.findIndex(x => x >= 0), hi = 5 - [...f].reverse().findIndex(x => x >= 0); for (let k = lo + 1; k < hi; k++) if (f[k] < 0) return true; return false; };
          if (teachCanon(+key, id)) exp = teachCanon(+key, id);
          else if (!canon && exp && mid(ref[0])) exp = null;
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
      // 橫按記號只畫在「兩端那兩條弦是同一根手指」的按法上;Cm7♭5 的 × 3 4 3 4 × 是 1 3 2 4,不是封閉和弦(使用者指正)
      total++;
      { const v = chordVoicingsFor(0, chordById("m7b5")).list[0];
        if (gtrTabText(v.frets) !== "× 3 4 3 4 ×" || v.barreShown || /封閉|橫按/.test(voicingLabel(v))) fails.push("Cm7♭5 不該標成橫按/封閉: " + gtrTabText(v.frets) + " " + voicingLabel(v)); }
      total++;
      { const bad = [];
        for (const def of CHORDS) for (let pc = 0; pc < 12; pc++) for (const v of chordVoicingsFor(pc, def).list) {
          if (!v.barreShown) continue;
          const fg = gtrFingering(v.frets);
          if (fg[v.barreLo] !== fg[v.barreHi]) bad.push(pc + ":" + def.sym + " " + gtrTabText(v.frets));
        }
        if (bad.length) fails.push("畫了橫按但兩端指法不同: " + bad.slice(0, 5).join(", ")); }
      // 斜線和弦也最多 3 種(和弦圖那一格只排得下一列 3 個;D/F♯ 曾列出 4 種、前三個被擠出畫面)
      total++;
      { const over = [];
        for (const def of CHORDS) for (let pc = 0; pc < 12; pc++) for (let iv = 1; iv < 12; iv++)
          if (chordVoicingsFor(pc, def, (pc + iv) % 12).list.length > 3) over.push(pc + ":" + def.sym + "/" + iv);
        if (over.length) fails.push("斜線和弦列了超過 3 種指法: " + over.slice(0, 5).join(", ")); }
      // 使用者的例子:Am7 不能再列 × 12 14 12 13 12(手貼到琴身)
      total++;
      if (chordVoicingsFor(9, chordById("m7")).list.some(v => Math.max(...v.frets) > 12)) fails.push("Am7 還列了第 12 格以上的指法");
      // 定義和弦的音(三音、七音、變化音)都要彈到:同一個和弦只要有一個完整的按法,列出來的就要全部完整
      // (原本 C13 會列出沒有 ♭7 的按法,那是 6/9)。整個和弦都沒有完整按法的(D7♭9♯9 等 3 組)才准退回
      let incomplete = 0;
      for (const d of CHORDS) for (let rp = 0; rp < 12; rp++) {
        // 教材首選(爵士殼音刻意省略音,使用者決定實用性優先)算完整
        const L = chordVoicingsFor(rp, d).list, real = L.map(v => voicingComplete(d, v.missing || [])), ok = L.map((v, i) => v.teach || real[i]);
        total++;
        // 「有完整的按法」只看教材首選以外的:整個和弦都沒有完整按法時(Gm11♭5),備選缺音是正常的
        if (real.some((x, i) => x && !L[i].teach) && !ok.every(Boolean)) fails.push(d.id + "@" + rp + ": 有完整的按法卻也列了缺音的 " + L.filter((v, i) => !ok[i]).map(v => gtrTabText(v.frets)).join(" / "));
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
      // 中間夾著打叉的弦(要另外悶):不能當推薦按法,清單裡一定排在不用悶弦的後面(使用者決定);Fm7♭5 的推薦不能是 1 × 1 1 0 ×
      let mid = 0;
      const mm = f => { const lo = f.findIndex(x => x >= 0), hi = 5 - [...f].reverse().findIndex(x => x >= 0); for (let k = lo + 1; k < hi; k++) if (f[k] < 0) return 1; return 0; };
      for (const def of CHORDS) for (let pc = 0; pc < 12; pc++) for (const bass of [null, ...[...Array(12).keys()]]) {
        if (bass != null && (pc + def.id.length) % 4) continue;   // 斜線和弦取樣四分之一,時間才不會太久
        const vs = chordVoicingsFor(pc, def, bass), L = vs.list.map(v => v.canon ? 0 : mm(v.frets));   // 標準 / 教材首選的可以打叉
        if (!L.length) continue;
        const bad = (L[vs.best] && L.some(x => !x)) || L.some((x, i) => i && L[i - 1] > x);
        if (bad && mid++ < 5) fails.push("中間打叉的指法當推薦或排在前面: " + def.id + "@" + pc + (bass != null ? "/" + bass : "") + " " + vs.list.map(v => v.frets.join(" ")).join(" | "));
      }
      // 教材首選(使用者確認過):m7♭5 的 12 個根音、Gsus4 / G7sus4 / Esus2 的開放按法、A♭dim / A♭sus2
      { const want = { m7b5: ["x3434x","x4545x","xx0111","x6767x","012333","1x110x","202210","3x332x","4x443x","x0101x","x1212x","x2323x"] };
        const tabS = f => f.map(x => x < 0 ? "x" : x.toString(36)).join("");
        want.m7b5.forEach((w, pc) => { const vs = chordVoicingsFor(pc, chordById("m7b5"), null), got = tabS(vs.list[vs.best].frets);
          if (got !== w) fails.push("m7♭5 的推薦(根音 " + pc + "): " + got + ",應該 " + w); });
        for (const [pc, id, w] of [[7, "sus4", "330013"], [7, "7sus4", "330011"], [4, "sus2", "024400"], [8, "dim", "4564xx"], [8, "sus2", "xx6896"]]) {
          const vs = chordVoicingsFor(pc, chordById(id), null), got = tabS(vs.list[vs.best].frets);
          if (got !== w) fails.push(id + "(根音 " + pc + ")的推薦: " + got + ",應該 " + w);
        } }
      // 教材首選表(960 組逐一核對後的結果)裡的每一條都要是推薦按法,而且按法本身要通過樂理檢查
      { let n = 0;
        for (const id in TEACH_CANON) for (const p in TEACH_CANON[id]) {
          const pc = +p, def = chordById(id), want = teachCanon(pc, id), vs = chordVoicingsFor(pc, def, null), got = vs.list[vs.best] && vs.list[vs.best].frets;
          if ((!got || got.join() !== want.join()) && n++ < 5) fails.push("教材首選沒有生效: " + id + "@" + pc + " 要 " + want.join(" ") + " 得 " + (got ? got.join(" ") : "-"));
        } }
      // 資料庫有收錄這個和弦時,網頁列出的每一個按法都要來自資料庫或標準表(使用者要求核對實用性)
      { let n = 0;
        for (const def of CHORDS) for (let pc = 0; pc < 12; pc++) { if (!gtrRef(pc, def.id, null).length) continue;
          const vs = chordVoicingsFor(pc, def, null), src = vs.list.filter(v => v.ref || v.canon);
          if (src.length && vs.list.some(v => !v.ref && !v.canon) && n++ < 5) fails.push("列了資料庫沒有的按法: " + def.id + "@" + pc + " " + vs.list.map(v => v.frets.join(" ")).join(" | ")); } }
      return { total: total + 6, fails };
    });
    report("指法都按得到", r.total, r.fails);
  }

  /* ── 3d. 左手指法(和弦圖圓點裡的 T 1 2 3 4):常見和弦要跟和弦書一樣,每一個列出來的按法都要是手指做得到的 ── */
  {
    const r = await p.evaluate(() => {
      const fails = [];
      let total = 0;
      const std = { "x32010": "x32010", "x02220": "x01230", "320003": "210003", "022100": "023100", "xx0232": "xx0132", "x02210": "x02310",
        "022000": "023000", "xx0231": "xx0231", "133211": "134211", "x24432": "x13421", "x21202": "x21304", "x35453": "x13241",
        "200232": "T00132", "x02010": "x02010", "320001": "320001", "x32310": "x32410", "xx3211": "xx3211", "xx0211": "xx0211",
        "xx0212": "xx0213", "xx3210": "xx3210", "x02020": "x02030", "320033": "210034", "x33211": "x34211" };
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
  /* ── 4c. 鋼琴的琴鍵標示:淡淡的八度標示只能在 C 上、八度是整數
     (音階分頁的鋼琴從 C 或 F 起,曾經在 F 上標出「C4.4166666667」,使用者回報) ── */
  {
    const r = await p.evaluate(() => {
      const fails = []; let total = 0;
      const keep = [STATE.tab, STATE.scaleId, STATE.letter, STATE.acc];
      STATE.tab = "scale";
      for (const sc of SCALES) for (let L = 0; L < 7; L++) for (const a of [-1, 0, 1]) {
        STATE.scaleId = sc.id; STATE.letter = L; STATE.acc = a; render(); total++;
        for (const [m, l] of currentView().labelMap)
          if (/\d\.\d/.test(l.text) || (!l.strong && l.text && pcOf(m) !== 0)) { fails.push(sc.id + " " + LETTERS[L] + a + " 鍵 " + m + " 標成「" + l.text + "」"); break; }
      }
      [STATE.tab, STATE.scaleId, STATE.letter, STATE.acc] = keep; render();
      return { total, fails: fails.slice(0, 10) };
    });
    report("琴鍵標示", r.total, r.fails);
  }
  /* ── 4d. 音階分頁的鋼琴:點鍵盤方框內任何地方 = 上行音階(使用者要求);音名照舊單音。
     古典旋律小調逐音上下行時,下行走自然小調(♭7 ♭6) ── */
  {
    const r = await p.evaluate(() => {
      const fails = []; let total = 0;
      const keep = [STATE.tab, STATE.inst, STATE.scaleId, STATE.letter, STATE.acc, STATE.playMode];
      const calls = [], pn = window.playNotes, ps = window.playSingle;
      window.playNotes = (m, mode, at, down) => { calls.push({ m: m.slice(), mode, down }); };
      window.playSingle = m => { calls.push({ single: m }); };
      STATE.tab = "scale"; STATE.inst = "piano"; STATE.scaleId = "melMinorCl"; STATE.letter = 5; STATE.acc = 0; render();
      const cv = $("keyboardCanvas"), rc = cv.getBoundingClientRect(), wr = document.querySelector(".kb-wrap").getBoundingClientRect();
      const fire = (el, x, y) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
      const want = "69,71,72,74,76,78,80,81";
      for (const [name, el, x, y] of [["白鍵", cv, rc.left + rc.width * 0.5, rc.top + rc.height * 0.85], ["黑鍵", cv, rc.left + rc.width * 0.5, rc.top + rc.height * 0.2],
                                       ["方框空白", document.querySelector(".kb-wrap"), wr.left + 3, wr.top + 3]]) {
        calls.length = 0; fire(el, x, y); total++;
        const c = calls[0];
        if (!c || c.mode !== "arp" || c.m.join(",") !== want || calls.length !== 1) fails.push("點" + name + "應該播上行音階 A 旋律小調(古典),實際 " + JSON.stringify(calls));
      }
      calls.length = 0; document.querySelectorAll("#kbSummary .tn")[1].click(); total++;
      if (!calls.length || calls[0].single !== 71) fails.push("點音名應該只響那一個音,實際 " + JSON.stringify(calls));
      STATE.playMode = "updown"; calls.length = 0; playCurrent(); total++;
      if (!calls[0] || (calls[0].down || []).join(",") !== "79,77,76,74,72,71,69") fails.push("古典旋律小調下行應該是 G F E D C B A,實際 " + JSON.stringify(calls[0]));
      total++; if (SAME_PITCH.has("melMinorCl") || SAME_PITCH.has("melMinor")) fails.push("古典旋律小調下行不同,不能算同音重複");
      // 摘要列的短名稱:括號是別名就拿掉,拿掉會撞名(旋律小調、減音階)就保留
      for (const [id, want] of [["ionian", "大調"], ["aeolian", "自然小調"], ["melMinorCl", "旋律小調(古典)"], ["melMinor", "旋律小調(爵士小調)"]]) {
        total++; const got = shortName(scaleById(id)); if (got !== want) fails.push("短名稱 " + id + ": " + got + " ≠ " + want);
      }
      { const seen = new Map(); for (const sc of SCALES) { const n = shortName(sc); total++; if (seen.has(n)) fails.push("短名稱撞名: " + n + " = " + seen.get(n) + " / " + sc.id); seen.set(n, sc.id); } }
      // 吉他也一樣(使用者要求):點指板任何地方 = 目前把位裡的上行音階;點把位鈕不發聲
      STATE.inst = "guitar"; STATE.playMode = "arp";
      for (const [id, L, steps] of [["ionian", 0, "2,2,1,2,2,2,1"], ["minPent", 5, "3,2,2,3,2"], ["melMinorCl", 5, "2,1,2,2,2,2,1"]]) {
        STATE.scaleId = id; STATE.letter = L; STATE.acc = 0; render();
        const nPos = scalePositions().length + 1;   // 全部 + 每個把位,用摘要列的 › 一個一個換
        STATE.scalePos = -1; render();
        for (let i = 0; i < nPos; i++) {
          calls.length = 0; if (i) $("posNext").click(); total++;
          if (calls.length) { fails.push("吉他 " + id + " 點把位 " + i + " 不應該發聲: " + JSON.stringify(calls)); continue; }
          const g = $("keyboardCanvas").getBoundingClientRect();
          for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.2], [0.9, 0.8]]) {
            calls.length = 0; fire($("keyboardCanvas"), g.left + g.width * fx, g.top + g.height * fy); total++;
            const c = calls[0], m = c && c.m, gvv = guitarView();
            const want = [...new Set(gvv.dots.map(x => x.midi).concat(gvv.markers.filter(x => x && x.type === "open").map(x => x.midi)))].sort((x, y) => x - y).join(",");
            // 選了把位 = 那個把位畫出來的每個音;「全部」= 一個八度(指板上三十幾個音整串彈不成音階)
            const ok = i ? m && m.join(",") === want && m.length >= 7 : m && m.length === currentNotes().length + 1 && pcOf(m[0]) === rootPc() && m[m.length - 1] - m[0] === 12;
            if (!c || c.mode !== "arp" || calls.length !== 1 || !ok) { fails.push("吉他 " + id + " 把位 " + i + " 點指板應該播上行音階,實際 " + JSON.stringify(calls)); break; }
          }
        }
      }
      window.playNotes = pn; window.playSingle = ps;
      [STATE.tab, STATE.inst, STATE.scaleId, STATE.letter, STATE.acc, STATE.playMode] = keep; render();
      return { total, fails };
    });
    report("音階點擊", r.total, r.fails);
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
    await tapWhite(71, 0.5, 0.85); await expect("鋼琴 Cmaj7 點 B(整個和弦一起彈)", "n60,64,67,71");
    await tapWhite(62, 0.5, 0.85); await expect("鋼琴 Cmaj7 點 D(非和弦音,也是整個和弦)", "n60,64,67,71");
    await tapWhite(64, 0.05, 0.3); await expect("鋼琴點 E 左上緣(黑鍵蓋住,也是整個和弦)", "n60,64,67,71");
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
    // 吉他反查:沒點的弦,比最低有點的弦高音的算空弦、更低的不彈(C 和弦只要點三個按弦)
    total++; { const r = await q.evaluate(() => { const o = STATE.findFrets; STATE.findFrets = [null, 3, 2, null, 1, null]; const f = gtrFindFrets().join(","); STATE.findFrets = [null, null, null, null, null, null]; const n = gtrFindFrets().join(","); STATE.findFrets = o; return f + "|" + n; });
      if (r !== "-1,3,2,0,1,0|-1,-1,-1,-1,-1,-1") fails.push("吉他反查沒點的弦: " + r); }
    // Dmaj7:只點 1~3 弦的 2 格,4 弦空弦要一起算(xx0222),不能變成 F♯m/A
    total++; { const r = await q.evaluate(() => { const o = STATE.findFrets; STATE.findFrets = [null, null, null, 2, 2, 2]; syncFindFromFrets(); const an = findAnalysis(); const nm = findChordName(an.results[0].rootPc, an.results[0].chord, an.bassPc, spellPrefFor(an.results[0].rootPc, an.results[0].chord)); STATE.findFrets = o; return nm; });
      if (r !== "Dmaj7") fails.push("吉他反查 xxx222 應該是 Dmaj7: " + r); }
    // 移調夾:夾第 2 格彈 D = 用 C 的指型、音高高兩個半音;辨識時按 C 的格子得到 D;音階把位的音都在音階裡
    total++; { const r = await q.evaluate(() => {
      const keep = { tab: STATE.tab, inst: STATE.inst, letter: STATE.letter, acc: STATE.acc, chordId: STATE.chordId, bassIv: STATE.bassIv, capo: STATE.capo, scaleId: STATE.scaleId };
      const bad = [];
      Object.assign(STATE, { inst: "guitar", tab: "chord", letter: 0, acc: 0, chordId: "maj", bassIv: null, capo: 0 }); render();
      const c0 = currentVoicing(), cm = voicingMidis(c0);
      Object.assign(STATE, { letter: 1, capo: 2 }); render();
      const d2 = currentVoicing(), dm = voicingMidis(d2);
      if (d2.frets.join() !== c0.frets.join()) bad.push("D 夾 2 的指型 " + d2.frets + " ≠ C " + c0.frets);
      if (dm.join() !== cm.map(m => m + 2).join()) bad.push("音高沒有加 2: " + dm);
      if (!/2/.test((document.querySelector("#kbSummary .capo-tag") || {}).textContent || "")) bad.push("摘要列沒有移調夾標示");
      STATE.tab = "find"; STATE.findFrets = [null, 3, 2, 0, 1, 0]; syncFindFromFrets(); render();
      const an = findAnalysis(), x = an.results[0], nm = x ? findChordName(x.rootPc, x.chord, an.bassPc, spellPrefFor(x.rootPc, x.chord)) : "?";
      if (nm !== "D") bad.push("夾 2 辨識 x32010 → " + nm);
      STATE.findFrets = [null, null, null, null, null, null]; STATE.findSel = new Set();
      Object.assign(STATE, { tab: "scale", scaleId: "ionian", letter: 1, acc: 0, scalePos: 0 }); render();
      const set = new Set(currentNotes().map(n => pcOf(n.midi)));
      for (const p of scalePositions()) for (const n of p.notes) if (!set.has(pcOf(n.midi)) || n.midi !== gm(n.s, n.f)) { bad.push("把位的音不對: " + JSON.stringify(n)); break; }
      Object.assign(STATE, keep); render();
      return bad;
    });
      if (r.length) fails.push("移調夾: " + r.join(" | ")); }
    // 左手吉他:指板鏡像後點畫出來的位置要對到同一條弦同一格;和弦圖 6 弦在右邊
    total++; { const r = await q.evaluate(() => {
      const keep = { tab: STATE.tab, inst: STATE.inst, lefty: STATE.lefty, chordId: STATE.chordId, letter: STATE.letter, acc: STATE.acc, bassIv: STATE.bassIv };
      Object.assign(STATE, { inst: "guitar", tab: "find", lefty: true }); render();
      const cv = $("keyboardCanvas"), L = cv._fb, hit = fretAt(cv._cssW - L.xOf(3), L.yOf(5));
      Object.assign(STATE, { tab: "chord", letter: 0, acc: 0, chordId: "maj", bassIv: null }); render();
      const lines = [...document.querySelectorAll("#gtrDiagrams .gd svg")][0].querySelectorAll("line.str");
      const x6 = +lines[0].getAttribute("x1"), x1 = +lines[5].getAttribute("x1");
      Object.assign(STATE, keep); render();
      return { hit: hit && hit.s + "/" + hit.f, order: x6 > x1 };
    });
      if (r.hit !== "5/3" || !r.order) fails.push("左手吉他: " + JSON.stringify(r)); }
    // 辨識結果點下去,和弦頁的名稱要跟點的那個一模一樣(斜線和弦的低音拼法:D♭13♭9/D 在和弦頁會變 E♭♭,要改寫成 C♯13♭9/D)
    total++; { const r = await q.evaluate(() => {
      const keep = { tab: STATE.tab, inst: STATE.inst, letter: STATE.letter, acc: STATE.acc, chordId: STATE.chordId, bassIv: STATE.bassIv, bassFor: STATE.bassFor };
      const op = playCurrent; playCurrent = () => {};
      const bad = [];
      for (const id of ["13b9", "7b9", "7alt", "mMaj7", "7", "m7b5", "maj7"]) for (const rp of [1, 8, 6, 3]) {
        const d = chordById(id), tones = d.t.map(x => pcOf(rp + tokenSemi(x)));
        for (const bpc of tones.slice(1, 3)) {
          STATE.tab = "find"; STATE.inst = "piano"; STATE.findSel = new Set([36 + bpc, ...tones.map(p => 48 + p)]); render();
          const it = document.querySelector('#readout .find-item[role="button"]'); if (!it) continue;
          const shown = it.querySelector(".fname").textContent; it.click();
          const got = chordTitle(chordById(STATE.chordId)); if (got !== shown) bad.push(shown + " → " + got);
        }
      }
      playCurrent = op; STATE.findSel = new Set(); Object.assign(STATE, keep); render();
      return bad;
    });
      if (r.length) fails.push("辨識跳到和弦頁名稱不一致: " + r.slice(0, 5).join(" | ")); }
    // 辨識結果可以點:跳到那個和弦;下面列出包含這些音的音階,點了跳到音階分頁
    total++; { const r = await q.evaluate(() => {
      const keep = { tab: STATE.tab, inst: STATE.inst, letter: STATE.letter, acc: STATE.acc, chordId: STATE.chordId, scaleId: STATE.scaleId, bassIv: STATE.bassIv, bassFor: STATE.bassFor };
      STATE.inst = "piano"; STATE.tab = "find"; STATE.findSel = new Set([48, 52, 55, 58]); render();
      const chips = [...document.querySelectorAll('#extraCard .link-chip[data-sid]')].map(b => b.dataset.rp + ":" + b.dataset.sid);
      document.querySelector('#readout .find-item[role="button"]').click();
      const chord = STATE.tab + " " + chordTitle(chordById(STATE.chordId));
      STATE.tab = "find"; render();
      const mix = document.querySelector('#extraCard .link-chip[data-sid="mixolydian"][data-rp="0"]');
      if (mix) mix.click();
      const scale = STATE.tab + " " + STATE.scaleId + " " + STATE.letter + "/" + STATE.acc;
      STATE.findSel = new Set(); Object.assign(STATE, keep); render(); window._log && window._log.splice(0);
      return { chips: chips.slice(0, 8), chord, scale };
    });
      if (r.chord !== "chord C7" || r.scale !== "scale mixolydian 0/0") fails.push("辨識結果點擊跳轉: " + JSON.stringify(r)); }
    // 常見開放和弦只點按弦的格子(空弦自動),都要認對;sus 和弦是對稱的,容易被讀成別的 sus;-1 = 自己點成 ×
    total++; { const r = await q.evaluate(() => {
      const nm = fr => { const o = STATE.findFrets; STATE.findFrets = fr; syncFindFromFrets(); const an = findAnalysis(); STATE.findFrets = o; if (!an.results.length) return "?"; const x = an.results[0]; return findChordName(x.rootPc, x.chord, an.bassPc, spellPrefFor(x.rootPc, x.chord)); };
      const N = null, cases = [
        [[N, N, N, 2, 3, N], "Dsus2"], [[N, N, N, 2, 3, 3], "Dsus4"], [[N, N, 2, 2, N, N], "Asus2"], [[N, N, 2, 2, 3, N], "Asus4"],
        [[N, 2, 2, 2, N, N], "Esus4"], [[N, 3, 2, N, 1, N], "C"], [[N, N, 2, 2, 2, N], "A"], [[N, N, N, 2, 3, 2], "D"], [[N, 2, 2, 1, N, N], "E"],
        [[N, N, 2, 2, 1, N], "Am"], [[N, 2, 2, N, N, N], "Em"], [[3, 2, N, N, N, 3], "G"], [[N, N, N, 2, 2, 2], "Dmaj7"],
        [[N, 3, -1, 4, 5, 3], "Cmaj7"], [[N, 3, -1, 3, 4, 3], "Cm7"]];
      return cases.map(([fr, want]) => { const g = nm(fr); return g === want ? "" : JSON.stringify(fr) + " → " + g + " ≠ " + want; }).filter(Boolean); });
      if (r.length) fails.push("吉他反查常見和弦: " + r.join(" | ")); }
    await take(); // 前面換根音也會發聲(和弦分頁換根音 = 彈新和弦),先清掉
    await L("D").click(); await expect("和弦分頁 C 換成 D 的瞬間彈 D 大三和弦", "n62,66,69");
    // 音階分頁換根音也要馬上播上行音階(鋼琴、吉他都一樣)
    for (const inst of ["piano", "guitar"]) {
      await q.evaluate(i => { STATE.inst = i; STATE.tab = "scale"; STATE.scaleId = "ionian"; STATE.letter = 0; STATE.acc = 0; render(); window._log.splice(0); }, inst);
      await L("D").click();
      const got = await take();
      // 鋼琴:D4 起一個八度;吉他:跟點指板一樣播目前把位裡的音(從把位最低的 D 開始,只有 D 大調的音)
      const ms = /^n/.test(got) ? got.slice(1).split(",").map(Number) : [];
      const ok = inst === "piano" ? /^n62,64,66,67,69,71,73,74/.test(got)
        : ms.length >= 7 && ms[0] % 12 === 2 && ms.every(m => [2, 4, 6, 7, 9, 11, 1].includes(((m % 12) + 12) % 12));
      total++; if (!ok) fails.push("音階分頁(" + inst + ")換到 D 要播 D 大調上行: " + (got || "(沒聲音)"));
    }
    await q.evaluate(() => { STATE.inst = "piano"; STATE.tab = "chord"; STATE.letter = 1; render(); window._log.splice(0); });
    await L("C").click(); await take();
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
    total++; if (gs !== "B C E G") fails.push("吉他 C/B 摘要列:低音排第一、其餘照公式(B C E G): " + gs);
    const bm = await q.evaluate(() => { const k = { letter: STATE.letter, acc: STATE.acc, chordId: STATE.chordId, bassIv: STATE.bassIv };
      Object.assign(STATE, { letter: 6, acc: 0, chordId: "maj7", bassIv: null }); render();
      const r = [...document.querySelectorAll("#kbSummary .tn")].map(x => x.textContent).join(" "); Object.assign(STATE, k); render(); return r; });
    total++; if (bm !== "B D♯ F♯ A♯") fails.push("吉他 Bmaj7 摘要列要照公式: " + bm);
    await take();
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
      const maj = scalePositions().length, seen = [];
      // 摘要列的 ‹ ›:全部(最左,‹ 變暗)→ 1 → … → 7(最右,› 變暗),兩端不繞回
      STATE.scalePos = -1; render();
      const ends = [$("posPrev").disabled, $("posNext").disabled];
      for (let i = 0; i < 10; i++) { seen.push(STATE.scalePos + ":" + $("kbSummary").querySelector(".pos-nav .n").textContent); if (!$("posNext").disabled) $("posNext").click(); }
      const endR = [$("posPrev").disabled, $("posNext").disabled];
      const atEnd = STATE.scalePos; $("posNext").click(); const stay = STATE.scalePos;
      for (let i = 0; i < 10; i++) if (!$("posPrev").disabled) $("posPrev").click();
      const rows = ends[0] && !ends[1] && !endR[0] && endR[1] && atEnd === stay && STATE.scalePos === -1 && seen.length === 10 && new Set(seen).size === 8 ? 8 : JSON.stringify({ ends, endR, seen, atEnd, stay });
      STATE.scalePos = 0; render();
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
    // 鋼琴小鍵盤:從 C 或 F 開始,整組進行同一個大小:全部放得進 8 個白鍵就畫 8、否則 11、否則 15(使用者要求:鍵太小)
    const kbCount = prog => q.evaluate(p => { const saved = PRACTICE.steps; PRACTICE.steps = practiceParseCustom(p).steps;
      const r = PRACTICE.steps.map(st => (stepDiagram(st).match(/<rect x="[\d.]+" y="0" width="13.2"/g) || []).length); PRACTICE.steps = saved; return r; }, prog);
    // 整組共用同一段鍵盤(起點是全組最低音下方的 C/F):「現在/下一個」同一個鍵上下對齊
    for (const [prog, want] of [["C F", 8], ["C G Am F", 11], ["Cmaj7 Am7 Dm7 G7", 15], ["C9 F13", 0], ["C G/B Am", 0]]) {
      const kb = await kbCount(prog);
      check(kb.length && kb.every(n => n === kb[0]) && (!want || kb[0] === want), "小鍵盤大小(" + prog + ")應該都是 " + (want || "同一個") + ": " + kb.join(","));
    }
    // 就近轉位:C G Am F 的 G 要變成 G/B(最低音 B)、組成音不變;移動量比原位小;斜線和弦低音照樣在最下面;關掉恢復原位
    { const r = await q.evaluate(() => { const saved = PRACTICE.steps, v0 = PRACTICE.voicing;
        const run = (p, mode) => { PRACTICE.steps = practiceParseCustom(p).steps; PRACTICE.voicing = mode; PRACTICE._vc = null;
          return PRACTICE.steps.map(st => withStep(st, () => displayNotes().map(n => n.midi))); };
        const move = v => v.slice(1).reduce((a, c, i) => a + c.reduce((x, m) => x + Math.min(...v[i].map(y => Math.abs(y - m))), 0), 0);
        const root = run("C G Am F", ""), near = run("C G Am F", "near"), slash = run("C D/F# G", "near");
        const pcs = v => v.map(c => [...new Set(c.map(m => ((m % 12) + 12) % 12))].sort().join());
        const r = { g: ((near[1][0] % 12) + 12) % 12, samePcs: pcs(root).join("|") === pcs(near).join("|"), less: move(near) < move(root),
          slashLow: ((slash[1][0] % 12) + 12) % 12, off: run("C G", "").join("|") === root.slice(0, 2).join("|") };
        PRACTICE.steps = saved; PRACTICE.voicing = v0; PRACTICE._vc = null; return r; });
      check(r.g === 11 && r.samePcs && r.less && r.slashLow === 6 && r.off, "就近轉位: " + JSON.stringify(r)); }
    // 全螢幕:5~8 個和弦排成兩排(上四下四)、整組照順序;4 個以內一排四張
    { const r = await q.evaluate(() => { const saved = PRACTICE.steps;
        const one = p => { PRACTICE.steps = practiceParseCustom(p).steps; PRACTICE.step = 1; practiceFullscreen(true);
          const g = document.querySelector(".pf-grid"), cs = [...g.querySelectorAll(".pf-card")];
          const tops = [...new Set(cs.map(c => Math.round(c.getBoundingClientRect().top)))].length;
          const r = [cs.length, tops, g.classList.contains("two"), cs.findIndex(c => c.classList.contains("now"))].join(); practiceFullscreen(false); return r; };
        const r = { six: one("C G Am F Dm Em"), four: one("C G Am F") }; PRACTICE.steps = saved; PRACTICE.step = 0; render(); return r; });
      check(r.six === "6,2,true,1" && r.four === "4,1,false,1", "全螢幕兩排 / 位置固定只換亮框: " + JSON.stringify(r)); }
    // 速度/拍子:上方「現在/下一個」與全螢幕也能調,三處同步(使用者要求)
    { const r = await q.evaluate(() => { const b0 = PRACTICE.bpm, beats0 = PRACTICE.beats;
        document.querySelector("#practiceStage .pt-faster").click(); const a = PRACTICE.bpm - b0;
        practiceFullscreen(true); const f = $("prFull"); const hasCtl = !!(f.querySelector(".pt-range") && f.querySelector(".pt-beats"));
        f.querySelector(".pt-slower").click(); const bk = PRACTICE.bpm === b0;
        const sel = f.querySelector(".pt-beats"); sel.value = "3"; sel.dispatchEvent(new Event("change"));
        const beats = PRACTICE.beats, sync = $("prBpmOut").textContent === PRACTICE.bpm + " BPM";
        practiceFullscreen(false); PRACTICE.beats = beats0; render(); return { a, hasCtl, bk, beats, sync }; });
      check(r.a === 5 && r.hasCtl && r.bk && r.beats === 3 && r.sync, "上方/全螢幕的速度拍子調整: " + JSON.stringify(r)); }
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
    // 級數輸入:先寫調,再寫羅馬數字;根音照級數拼(F♯ 大調的 vii° 是 E♯dim)
    const rn = await q.evaluate(() => [
      ["C: I V vi IV", "C G Am F"], ["Bb: ii7 V7 Imaj7", "Cm7 F7 B♭maj7"], ["Eb: bVII", "D♭"], ["Am: i iv V7", "Am Dm E7"],
      ["F#: vii°", "E♯dim"], ["C: viiø7 V7/", ""], ["G: I IV V7sus4", "G C D7sus4"], ["Am: III VI VII", "C F G"], ["D: iii7 vi7 ii7 V7", "F♯m7 Bm7 Em7 A7"],
      ["Am: i bVI bVII", "Am F G"], ["Am: bVII7", "G7"], ["Am: vii°7", "G♯dim7"], ["Am: VII", "G"], ["Am: imaj7", "AmMaj7"], ["Am: iadd9", "Am(add9)"], ["C: isus4", "Csus4"],
      ["I V", ""]
    ].map(([txt, want]) => { const r = practiceParseCustom(txt); const got = r.steps.map(stepName).join(" "); return got === want || (want === "" && r.bad.length) ? "" : txt + " → " + got + " ≠ " + want + " bad:" + r.bad.join(","); }).filter(Boolean));
    total++; if (rn.length) fails.push("級數輸入: " + rn.join(" | "));
    // 預備拍:先數一小節的點擊,第一個和弦落在下一小節的第一拍
    const ci = await q.evaluate(async () => {
      practiceStop();
      PRACTICE.steps = [{ letter: 0, acc: 0, id: "maj", bass: null }, { letter: 4, acc: 0, id: "maj", bass: null }];
      PRACTICE.bpm = 120; PRACTICE.beats = 4; PRACTICE.countIn = true; PRACTICE.accomp = true;
      const clicks = [], chords = [], oc = practiceClick, op = playCurrent;
      practiceClick = t => clicks.push(t); playCurrent = at => chords.push(at);
      practiceStart(); await new Promise(r => setTimeout(r, 2150));
      practiceStop(); practiceClick = oc; playCurrent = op; PRACTICE.countIn = false;
      return { firstChord: chords[0] != null ? +(chords[0] - clicks[0]).toFixed(3) : null, nClicksBefore: clicks.filter(t => chords[0] == null || t < chords[0] - 1e-6).length };
    });
    total++; if (ci.firstChord !== 2 || ci.nClicksBefore !== 4) fails.push("預備拍(第一個和弦要在 4 下點擊之後,120 BPM = 2 秒): " + JSON.stringify(ci));
    // 逐漸加速:每輪 +2,繞兩輪後速度多 4;停止時回到原本的速度
    const rampR = await q.evaluate(async () => {
      PRACTICE.steps = [{ letter: 0, acc: 0, id: "maj", bass: null }]; PRACTICE.beats = 2; PRACTICE.bpm = 200 - 10; PRACTICE.ramp = "2/1";
      const oc = practiceClick; practiceClick = () => {};
      practiceStart(); await new Promise(r => setTimeout(r, 1300));   // 190 BPM、兩拍一輪:約 0.63 秒一輪
      const during = PRACTICE.bpm; practiceStop(); practiceClick = oc;
      const after = PRACTICE.bpm; PRACTICE.ramp = ""; PRACTICE.bpm = 70; return { during, after };
    });
    total++; if (!(rampR.during >= 192 && rampR.during <= 196) || rampR.after !== 190) fails.push("逐漸加速: " + JSON.stringify(rampR));
    // 一小節兩個和弦:C*2 G*2 Am → 和弦落在第 0、2、4 拍;文字存回去時保留 *2
    const dur = await q.evaluate(async () => {
      practiceStop();
      const r = practiceParseCustom("C*2 G*2 Am");
      PRACTICE.steps = r.steps; PRACTICE.bpm = 200; PRACTICE.beats = 4; PRACTICE.countIn = false; PRACTICE.accomp = true;
      const clicks = [], chords = [], oc = practiceClick, op = playCurrent;
      practiceClick = t => clicks.push(t); playCurrent = at => chords.push(at);
      practiceStart(); await new Promise(res => setTimeout(res, 2600));
      practiceStop(); practiceClick = oc; playCurrent = op;
      const beatOf = at => Math.round((at - clicks[0]) / 0.3);
      return { at: chords.slice(0, 4).map(beatOf).join(","), text: r.steps.map(stepText).join(" ") };
    });
    total++; if (dur.at !== "0,2,4,8" || dur.text !== "C*2 G*2 Am") fails.push("半小節和弦: " + JSON.stringify(dur));
    // 沒寫拍數的和弦填到小節線:C*1 G Am F(4/4)= 1 + 3 + 4 + 4 拍、共 3 小節;點和弦換拍數:整小節 → 1 → 2 → 3 → 整小節
    const fill = await q.evaluate(() => { const keep = PRACTICE.steps, b0 = PRACTICE.beats; PRACTICE.beats = 4;
      const tl = p => { PRACTICE.steps = practiceParseCustom(p).steps; const x = practiceTimeline(); return x.start.join() + "/" + x.dur.join() + "/" + x.bars; };
      const r = { a: tl("C*1 G Am F"), b: tl("C*3 G*3 Am") };
      PRACTICE.steps = practiceParseCustom("C G").steps; PRACTICE.open = true; render();
      const seq = []; for (let k = 0; k < 4; k++) { $("prSteps").children[0].click(); seq.push(PRACTICE.steps[0].beats || 0); }
      r.seq = seq.join(); r.bars = $("prBars") && $("prBars").textContent;
      PRACTICE.steps = keep; PRACTICE.beats = b0; render(); return r; });
    total++; if (fill.a !== "0,1,4,8/1,3,4,4/3" || fill.b !== "0,3,6/3,3,2/2" || fill.seq !== "1,2,3,0" || !/2/.test(fill.bars || "")) fails.push("拍數與小節數: " + JSON.stringify(fill));
    // 移調夾建議:E♭ B♭ Cm A♭ → 夾第 3 格(C G Am F),或第 1 格(D A Bm G)也行;取開放指型最多、同分取低格
    const cb = await q.evaluate(() => { const keep = PRACTICE.steps; PRACTICE.steps = practiceParseCustom("Eb Bb Cm Ab").steps; const k = practiceCapoBest(); PRACTICE.steps = keep; return k; });
    total++; if (cb !== 3 && cb !== 1) fails.push("移調夾建議 E♭ B♭ Cm A♭ → " + cb);
    // 打拍子設定速度:每 500ms 點一下 → 120 BPM
    const tap = await q.evaluate(() => {
      PRACTICE.open = true; STATE.tab = "chord"; render();
      const out = $("prBpmOut"), t0 = performance.now(), realNow = performance.now.bind(performance);
      let fake = t0; performance.now = () => fake;
      for (let i = 0; i < 5; i++) { fake = t0 + i * 500; out.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); }
      performance.now = realNow;
      const bpm = PRACTICE.bpm; PRACTICE.bpm = 70; PRACTICE.open = false; render(); return bpm;
    });
    total++; if (tap !== 120) fails.push("打拍子設定速度: " + tap + " ≠ 120");
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
      const r = await q.evaluate(([inst, tab]) => {
        STATE.inst = inst; STATE.tab = tab; STATE.search = ""; STATE.group[tab] = ""; render();
        const bad = [];
        const items = tab === "chord" ? CHORDS : SCALES;
        // 畫面文字 + 讀屏軟體念的屬性(aria-label、title、placeholder);語言切換鈕本身的「中」除外
        const cjk = () => {
          const attrs = [...document.querySelectorAll("[aria-label],[title],[placeholder]")].filter(e => e.id !== "langToggle")
            .map(e => [e.getAttribute("aria-label"), e.getAttribute("title"), e.getAttribute("placeholder")].join(" ")).join(" ");
          const m = (document.body.innerText.replace(/中/g, "") + " " + attrs).match(/[㐀-鿿]+/g); return m ? m.slice(0, 3).join(",") : ""; };
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
        return [Math.round(r.left), Math.round(r.width), Math.round(r.top), Math.round(r.height), e.scrollWidth > e.clientWidth + 1 ? "cut" : ""].join("/"); }).join(" "));
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
    // 辨識分頁(鋼琴選音、吉他按弦)與鍵盤設定面板
    const fd = await q.evaluate(() => {
      const bad = [], cjk = () => { const attrs = [...document.querySelectorAll("[aria-label],[title],[placeholder]")].filter(e => e.id !== "langToggle")
        .map(e => [e.getAttribute("aria-label"), e.getAttribute("title"), e.getAttribute("placeholder")].join(" ")).join(" ");
        const m = (document.body.innerText.replace(/中/g, "") + " " + attrs).match(/[\u3400-\u9fff]+/g); return m ? m.slice(0, 3).join(",") : ""; };
      STATE.tab = "find"; STATE.inst = "piano"; STATE.findSel = new Set([60, 64, 67, 71]); render(); let c = cjk(); if (c) bad.push("鋼琴辨識: " + c);
      STATE.inst = "guitar"; STATE.findSel.clear(); STATE.findFrets = [null, 3, 2, 0, 1, 0]; syncFindFromFrets(); render(); c = cjk(); if (c) bad.push("吉他辨識: " + c);
      toggleKbPopover(); c = cjk(); if (c) bad.push("設定面板: " + c); toggleKbPopover();
      STATE.findFrets = [null, null, null, null, null, null]; STATE.findSel.clear(); STATE.inst = "piano"; STATE.tab = "chord"; render();
      return bad;
    });
    total++; fails.push(...fd);
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
    // 單欄的和弦與音階分頁顯示區同高(使用者要求:換分頁時 Cmaj7 / C 大調那一列不跳);音階換成 B 大調(13 個白鍵)也一樣
    for (const [w, h] of [[320, 568], [390, 844], [430, 932], [768, 1024], [844, 390]]) {
      const q = await openPage(browser, { viewport: { width: w, height: h } });
      const got = [];
      for (const inst of ["Piano", "Guitar"]) for (const tab of ["Chord", "Scale", "ScaleB"]) {
        got.push(await q.evaluate(([t, i]) => { if (t === "ScaleB") { $("tabScale").click(); STATE.letter = 6; STATE.acc = 0; render(); } else $("tab" + t).click();
          $("inst" + i).click(); scrollTo(0, 0);
          return Math.round($("kbSummary").getBoundingClientRect().top - document.querySelector(".kb-wrap").getBoundingClientRect().top); }, [tab, inst]));
      }
      total++; if (new Set(got).size !== 1) fails.push("和弦/音階顯示區不同高(" + w + "×" + h + "): " + got.join(","));
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
      // 比例:和弦圖最多放大 GD_MAX_K(2.2)倍,而圖裡的字(數字/格數/×)照螢幕像素限制在 16px 以內,才不會比介面的字大一截(使用者回報過);鋼琴白鍵最寬 56px(一個八度不會變方磚)
      const prop = await q.evaluate(() => {
        $("tabChord").click(); $("instGuitar").click();
        const sv = document.querySelector("#gtrDiagrams svg"), bb = sv.getBoundingClientRect(), vb = sv.viewBox.baseVal;
        const k = Math.min(bb.width / vb.width, bb.height / vb.height);
        $("tabScale").click(); $("instPiano").click();
        const key = $("keyboardCanvas").getBoundingClientRect().width / Math.max(KB_WHITE_KEYS.length, 1);
        $("tabChord").click();
        const big = Math.max(...[...sv.querySelectorAll("text.fn, text.frl, text.mx")].map(t => parseFloat(t.getAttribute("font-size")) * k));
        return { k, key, big };
      });
      total++; if (prop.k > 2.21 || prop.big > 16.5) fails.push("和弦圖放大 " + prop.k.toFixed(2) + " 倍、最大的字 " + prop.big.toFixed(1) + "px(" + w + "×" + h + "),圖裡的字會比介面大");
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
    // 字級下限(使用者要求「依裝置調整所有文字大小」,3fr、7fr 曾經只有 6px):
    // 手機 390/430 上 HTML 文字 ≥ 11px(★ 等記號 ≥ 10px)、和弦圖的格數與 × ≥ 10.5px、
    // 鋼琴鍵名 ≥ 11px(和弦分頁兩個八度)、指板音點裡的音名 ≥ 8.5px
    for (const [w, h] of [[390, 844], [430, 932]]) {
      const q = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      await q.route(/^https?:\/\//, r => r.abort());
      await q.addInitScript(() => { window.__cv = []; const ft = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (t) { const m = /([\d.]+)px/.exec(this.font); window.__cv.push([String(t), m ? +m[1] : 0]); return ft.apply(this, arguments); }; });
      await q.goto(PAGE); await q.waitForTimeout(150);
      const bad = await q.evaluate(() => {
        const out = [];
        const htmlMin = () => { for (const el of document.querySelectorAll("body *")) {
          if (!el.offsetParent || el.closest("svg")) continue;
          const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
          if (!txt) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize), min = /^[★≡≅]+$/.test(txt) ? 10 : 11;
          if (fs < min - 0.05) out.push("HTML「" + txt.slice(0, 8) + "」" + fs + "px"); } };
        STATE.inst = "piano"; STATE.tab = "chord"; STATE.chordId = "maj7"; STATE.letter = 0; STATE.acc = 0; window.__cv = []; render(); htmlMin();
        const keyMin = Math.min(...window.__cv.filter(([t]) => /^[A-G]/.test(t)).map(x => x[1]));
        if (keyMin < 11) out.push("鋼琴鍵名 " + keyMin.toFixed(1) + "px");
        STATE.inst = "guitar"; render();
        for (const sv of document.querySelectorAll("#gtrDiagrams svg")) {
          const k = sv.getBoundingClientRect().width / sv.viewBox.baseVal.width;
          for (const t of sv.querySelectorAll("text.frl, text.mx")) { const px = parseFloat(t.getAttribute("font-size")) * k; if (px < 10.5) out.push("和弦圖「" + t.textContent + "」" + px.toFixed(1) + "px"); }
        }
        STATE.tab = "scale"; window.__cv = []; render(); htmlMin();
        const noteMin = Math.min(...window.__cv.filter(([t]) => /^[A-G]/.test(t)).map(x => x[1]));
        if (noteMin < 8.5) out.push("指板音名 " + noteMin.toFixed(1) + "px");
        STATE.tab = "chord"; STATE.inst = "piano"; render();
        return [...new Set(out)];
      });
      total++; if (bad.length) fails.push("字太小(" + w + "×" + h + "): " + bad.slice(0, 6).join(", "));
      await q.close();
    }
    // 吉他音階摘要列:七個音名一律完整顯示(320 起);390 以上連名稱也不能被截;非大小調的音階名用英文
    for (const [w, h] of [[320, 568], [390, 844], [430, 932]]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const r = await q.evaluate((w) => { const bad = []; STATE.inst = "guitar"; STATE.tab = "scale";
        for (const id of ["phrygian", "lydian", "mixolydian", "locrian", "dorian", "ionian", "aeolian"]) { STATE.scaleId = id; STATE.letter = 0; STATE.acc = 0; render();
          const t = document.querySelector("#kbSummary .tones"), b = document.querySelector("#kbSummary b");
          if (t.scrollWidth > t.clientWidth + 1) bad.push(id + " 音名被截");
          if (w >= 390 && b.scrollWidth > b.clientWidth + 1) bad.push(id + " 名稱被截");
          if (/[\u4e00-\u9fff]/.test(b.textContent) !== /ionian|aeolian/.test(id)) bad.push(id + " 名稱語言 " + b.textContent); }
        return bad; }, w);
      total++; if (r.length) fails.push("吉他音階摘要列(" + w + "): " + r.join(", "));
      await q.close();
    }
    // 和弦圖兩側的粗/細:不能被卡片切掉;英文放得下(430 以上)要寫完整 low/high,窄的縮成 L/H
    for (const [w, h] of [[320, 568], [390, 844], [430, 932], [844, 390], [1280, 860]]) for (const lang of ["en", "zh"]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900 });
      if (lang === "en") await q.click("#langToggle");
      await q.click("#instGuitar"); await q.waitForTimeout(200);
      const r = await q.evaluate(() => [...document.querySelectorAll("#gtrDiagrams .gd")].map(c => { const cr = c.getBoundingClientRect();
        return [...c.querySelectorAll("text.slab")].map(t => { const b = t.getBoundingClientRect(); return t.textContent + (b.left < cr.left - 0.5 || b.right > cr.right + 0.5 ? "被切" : ""); }).join("/"); }));
      const want = lang === "zh" ? "粗/細" : w >= 430 ? "low/high" : "L/H";
      total++; if (!r.length || r.some(x => x !== want)) fails.push("和弦圖粗細標示(" + w + "×" + h + " " + lang + "): " + r.join(" ") + " ≠ " + want);
      await q.close();
    }
    // 和弦分頁的鋼琴(單欄):不再固定兩個八度。每個和弦同一個高度;白鍵長寬比維持 5~7.3(不會矮胖、也不會又細又長);
    // 必學和弦在 390px 只畫 11 個白鍵
    for (const [w, h] of [[320, 568], [390, 844], [430, 932], [768, 1024]]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const r = await q.evaluate(() => {
        const hs = new Set(), bad = []; let n390 = 0;
        for (const id of ["maj", "min", "7", "maj7", "m7", "13", "m11", "7s9", "dim7", "add9"]) for (const L of [0, 4, 6]) {
          STATE.tab = "chord"; STATE.inst = "piano"; STATE.chordId = id; STATE.letter = L; STATE.acc = 0; render();
          const cv = $("keyboardCanvas"), ww = cv._cssW / KB_WHITE_KEYS.length, kh = cv._kbH || cv._cssH;
          hs.add(cv._cssH); const a = kh / ww; if (a < 5 || a > 7.3) bad.push(id + "@" + L + " " + a.toFixed(1));
          if (id === "maj" && L === 0) n390 = KB_WHITE_KEYS.length;
        }
        STATE.chordId = "maj7"; STATE.letter = 0; render();
        return { hs: [...hs], bad, n390 };
      });
      total++; if (r.hs.length !== 1 || r.bad.length || (w === 390 && r.n390 !== 11)) fails.push("和弦鍵盤比例(" + w + "): " + JSON.stringify(r));
      await q.close();
    }
    // 摘要列任何內容都不能被截成「…」:所有音階/和弦 × 鋼琴/吉他 × 中英文,高度固定不隨內容變
    // 最窄(320)與寬版(1280)兩端;根音用最長的拼法(C 與 B♭)。390 夾在中間,320 放得下的它一定放得下
    for (const [w, h] of [[320, 568], [1280, 860]]) for (const lang of ["zh", "en"]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900 });
      if (lang === "en") await q.click("#langToggle");
      const r = await q.evaluate(() => {
        const cut = e => e && getComputedStyle(e).display !== "none" && e.scrollWidth > e.clientWidth + 1;
        const bad = new Set(), hs = new Set();
        for (const inst of ["piano", "guitar"]) for (const tab of ["scale", "chord"]) {
          STATE.inst = inst; STATE.tab = tab;
          for (const d of tab === "scale" ? SCALES : CHORDS) {
            if (tab === "scale") STATE.scaleId = d.id; else STATE.chordId = d.id;
            for (const [L, A] of [[0, 0], [6, -1]]) {
              STATE.letter = L; STATE.acc = A; render();
              const s = $("kbSummary"), sr = s.getBoundingClientRect(); hs.add(s.offsetHeight);
              for (const e of s.querySelectorAll("b, .zh, .tones, .nm span, .nmrow")) if (cut(e)) bad.add(inst + " " + d.id);
              for (const e of s.querySelectorAll("b, .tones, .vc-nav, .kb-gear")) { const b = e.getBoundingClientRect(); if (b.right > sr.right + 0.5 || b.left < sr.left - 0.5) bad.add(inst + " " + d.id + " 超出"); }
            }
          }
        }
        STATE.inst = "piano"; STATE.tab = "chord"; render();
        return { bad: [...bad].slice(0, 6), hs: [...hs] };
      });
      total++; if (r.bad.length || r.hs.length !== 1) fails.push("摘要列被截或高度會變(" + w + " " + lang + "): " + r.bad.join(", ") + " 高度 " + r.hs.join("/"));
      await q.close();
    }
    // 兩個名字的音階(Aeolian / Natural Minor)在摘要列疊兩行,整列高度跟一般音階一樣
    for (const [w, h] of [[390, 844], [1280, 860]]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900 });
      await q.click("#langToggle");
      const r = await q.evaluate(() => { STATE.tab = "scale"; STATE.scaleId = "dorian"; render(); const h1 = $("kbSummary").offsetHeight;
        STATE.scaleId = "aeolian"; render(); const b = document.querySelector("#kbSummary b");
        return { h1, h2: $("kbSummary").offsetHeight, stk: b.classList.contains("stk"), txt: [...b.querySelectorAll(".nm span")].map(x => x.textContent).join("|") }; });
      total++; if (r.h1 !== r.h2 || !r.stk || r.txt !== "Aeolian|(Natural Minor)") fails.push("音階名兩行(" + w + "): " + JSON.stringify(r));
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

  /* ── 6b. 往返一致:每個和弦 × 21 根音,寫出來的名稱要解析得回來;把組成音丟進辨識,要找得到自己 ── */
  {
    const rq = await openPage(browser);
    const r = await rq.evaluate(() => {
      const fails = []; let total = 0;
      STATE.tab = "chord"; STATE.inst = "piano"; STATE.bassIv = null; STATE.slash = null;
      for (const d of CHORDS) for (let L = 0; L < 7; L++) for (const A of [-1, 0, 1]) {
        STATE.letter = L; STATE.acc = A; STATE.chordId = d.id;
        const name = chordTitle(d), pc = parseChordName(name);
        total++;
        if (!pc || pc.letter !== L || pc.acc !== A || pc.def.id !== d.id || pc.bass != null) fails.push("解析 " + name + " → " + (pc ? LETTERS[pc.letter] + pc.acc + " " + pc.def.id + " /" + pc.bass : "null"));
        const rp = pcOf(rootMidi());
        STATE.findSel = new Set(d.t.map(x => 48 + rp + tokenSemi(x)));
        const an = findAnalysis();
        total++;
        if (!an.results.some(x => x.rootPc === rp && x.chord.id === d.id)) fails.push("辨識找不到 " + name);
      }
      STATE.findSel = new Set(); STATE.letter = 0; STATE.acc = 0; STATE.chordId = "maj7"; render();
      return { total, fails };
    });
    await rq.close();
    report("名稱與辨識往返", r.total, r.fails);
  }

  /* ── 6c. 分享連結:網址 # 帶著的和弦/音階/進行打開就是那一頁;換頁時網址跟著變 ── */
  {
    const fails = []; let total = 0;
    const open = async hash => { const q = await openPage(browser, { viewport: { width: 390, height: 844 } }); await q.goto(PAGE + "#" + hash); await q.reload(); return q; };
    for (const [hash, want] of [
      ["chord=Bbmaj7", "chord piano B♭maj7"], ["chord=C/E&inst=guitar", "chord guitar C/E"], ["chord=D&inst=guitar&capo=2", "chord guitar D capo2"],
      ["scale=F%23-dorian", "scale piano F♯ dorian"], ["prog=G:%20I%20V%20vi%20IV", "practice G D Em C"], ["tab=find", "find"]]) {
      const q = await open(hash);
      const got = await q.evaluate(() => PRACTICE.open ? "practice " + PRACTICE.steps.map(stepName).join(" ")
        : STATE.tab === "chord" ? "chord " + STATE.inst + " " + chordTitle(chordById(STATE.chordId)) + (STATE.capo ? " capo" + STATE.capo : "")
        : STATE.tab === "scale" ? "scale " + STATE.inst + " " + rootName() + " " + STATE.scaleId : STATE.tab);
      total++; if (got !== want) fails.push("#" + hash + " → " + got + " ≠ " + want);
      if (q._errors.length) fails.push("#" + hash + " 頁面錯誤 " + q._errors.join("; "));
      await q.close();
    }
    const q = await openPage(browser, { viewport: { width: 390, height: 844 } });
    const h = await q.evaluate(() => { STATE.tab = "scale"; STATE.letter = 6; STATE.acc = -1; STATE.scaleId = "lydian"; render(); return decodeURIComponent(location.hash); });
    total++; if (h !== "#scale=Bb-lydian&inst=guitar") fails.push("換頁後網址沒跟著變: " + h);   // 預設樂器是吉他
    // 沒寫樂器的舊連結用鋼琴開,不是收到的人上次用的樂器
    { const z = await openPage(browser, { viewport: { width: 390, height: 844 } });
      await z.evaluate(() => { try { localStorage.setItem("harmonymap.inst", "guitar"); } catch (e) {} });
      await z.goto(PAGE + "#chord=Bbmaj7"); await z.reload();
      const inst = await z.evaluate(() => STATE.inst);
      await z.evaluate(() => { try { localStorage.removeItem("harmonymap.inst"); } catch (e) {} });
      total++; if (inst !== "piano") fails.push("沒寫樂器的連結用了上次的樂器: " + inst);
      await z.close(); }
    // 鍵盤操作:焦點在分頁鈕上按空白鍵 = 按那顆鈕(不是播放);按根音字母鈕之後焦點留在根音列
    { const z = await openPage(browser, { viewport: { width: 1280, height: 860 } });
      await z.focus("#tabScale"); await z.keyboard.press(" ");
      const tab = await z.evaluate(() => STATE.tab);
      await z.click("#tabChord");
      await z.focus("#letterRow .key-btn:nth-child(2)"); await z.keyboard.press("Enter");
      const f = await z.evaluate(() => { const a = document.activeElement; return a && a.closest && a.closest("#letterRow") ? a.textContent : (a && a.tagName); });
      await z.click("#langToggle");
      const en = await z.evaluate(() => { STATE.tab = "scale"; STATE.scaleId = "dorian"; render(); const s = $("kbSummary"); return (s.querySelector("b").textContent + "|" + ((s.querySelector(".zh") || {}).textContent || "")); });
      await z.evaluate(() => { document.activeElement.blur(); STATE.tab = "find"; STATE.inst = "piano"; STATE.findSel = new Set(); render(); });
      for (const k of ["c", "e", "g", "Shift+A"]) await z.keyboard.press(k);
      const fsel = await z.evaluate(() => { const an = findAnalysis(); const r = an.results[0]; const n = r ? findChordName(r.rootPc, r.chord, an.bassPc, spellPrefFor(r.rootPc, r.chord)) : "?"; STATE.findSel = new Set(); STATE.tab = "chord"; render(); return n; });
      total++; if (fsel !== "C7") fails.push("辨識用鍵盤打 C E G Shift+A 應該是 C7: " + fsel);
      total++; if (tab !== "scale") fails.push("焦點在分頁鈕上按空白鍵沒有切換: " + tab);
      total++; if (f !== "D") fails.push("按根音鈕後焦點掉了: " + f);
      total++; if (/Dorian\|.*Dorian/.test(en)) fails.push("英文音階摘要名稱重複: " + en);
      await z.close(); }
    await q.close();
    // 全螢幕練習:橫式才有按鈕;按下去一次四個和弦(現在 + 後面三個,循環),離開鈕、轉直向都會關
    { const z = await openPage(browser, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
      await z.click("#practiceOpen");
      await z.evaluate(() => { PRACTICE.steps = practiceParseCustom("Fm C Am G").steps; PRACTICE.step = 3; render(); scrollTo(0, 0); });
      await z.click("#prFs");
      const r = await z.evaluate(() => ({ open: !$("prFull").hidden, names: [...document.querySelectorAll(".pf-card b")].map(x => x.textContent).join(" "), now: document.querySelector(".pf-card.now b").textContent }));
      total++; if (!r.open || r.names !== "Fm C Am G" || r.now !== "G") fails.push("全螢幕四個和弦: " + JSON.stringify(r));
      await z.setViewportSize({ width: 390, height: 844 }); await z.waitForTimeout(200);
      const closed = await z.evaluate(() => $("prFull").hidden && !PRACTICE.fs);
      const hidden = await z.evaluate(() => getComputedStyle($("prFs")).display === "none");
      total++; if (!closed || !hidden) fails.push("轉直向要離開全螢幕、按鈕要藏起來: " + closed + "/" + hidden);
      if (z._errors.length) fails.push("全螢幕頁面錯誤 " + z._errors.join("; "));
      await z.close(); }
    report("分享連結", total, fails);
  }

  /* ── 和弦表(列印 / 存成 PDF):張數、每張都有圖、英文沒有中文、只有和弦分頁有按鈕、320 寬不擠壞、列印時只印和弦表 ── */
  {
    const fails = []; let total = 0;
    for (const [w, h, lang] of [[320, 568, "zh"], [390, 844, "en"], [1280, 860, "zh"]]) {
      const q = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900 });
      if (lang === "en") await q.click("#langToggle");
      await q.evaluate(() => { window.__noPrint = true; });
      const vis = await q.evaluate(() => { const r = {}; for (const tb of ["Chord", "Scale", "Find"]) { $("tab" + tb).click(); r[tb] = !!$("printOpen").offsetParent; } $("tabChord").click(); return r; });
      total++; if (!vis.Chord || vis.Scale || vis.Find) fails.push("列印鈕只該在和弦分頁(" + w + "): " + JSON.stringify(vis));
      const row = await q.evaluate(() => { const r = document.querySelector(".find-row").getBoundingClientRect(), s = document.querySelector(".search-wrap").getBoundingClientRect(), b = $("printOpen").getBoundingClientRect();
        return { over: b.right > r.right + 1, search: Math.round(s.width), h: Math.round(r.height) }; });
      total++; if (row.over || row.search < 90 || row.h > 44) fails.push("清單上方那排擠壞了(" + w + "): " + JSON.stringify(row));
      await q.click("#printOpen");
      for (const [inst, lv, want] of [["guitar", "core", 84], ["piano", "other", 73 * 12], ["guitar", "all", 80 * 12]]) {
        await q.click('#printPop [data-g="inst"][data-v="' + inst + '"]'); await q.click('#printPop [data-g="set"][data-v="' + lv + '"]');
        await q.click('#printPop [data-g="roots"][data-v="all"]');
        await q.click("#printGo"); await q.waitForFunction(() => !PRINT.busy, null, { timeout: 60000 });
        const r = await q.evaluate(() => ({ cells: document.querySelectorAll("#printSheet .ps-cell").length, svg: document.querySelectorAll("#printSheet .ps-cell svg").length,
          fn: document.querySelectorAll("#printSheet svg text.fn").length, cjk: /[\u3400-\u9fff]/.test($("printSheet").textContent + $("printPop").textContent), inst: STATE.inst }));
        total++;
        if (r.cells !== want || r.svg !== want) fails.push("和弦表張數(" + w + " " + inst + " lv" + lv + "): " + r.cells + " 張、" + r.svg + " 張圖,應該 " + want);
        if (inst === "guitar" && !r.fn) fails.push("吉他和弦表沒有指法數字");
        if (lang === "en" && r.cjk) fails.push("英文和弦表有中文");
      }
      // 和弦表入口要看得出來是「下載和弦表」:有字、不是只有圖示(使用者反映原本的印表機圖示找不到)
      total++;
      // 窄手機(≤380px)只留下載圖示(搜尋框才不會被擠到 49px),其他寬度要有字
      if (!(await q.evaluate(w => { const s = $("printOpen").querySelector("span"), ic = $("printOpen").querySelector("svg");
        return w <= 380 ? ic.getBoundingClientRect().width > 0 : s && s.offsetWidth > 0 && /和弦表|Chart/.test(s.textContent); }, w))) fails.push("和弦表下載鈕沒有顯示文字(" + w + "px)");
      // 第一次打開(沒有存過樂器)預設是吉他(使用者要求)
      total++;
      { const z = await openPage(browser, { viewport: { width: 390, height: 844 } });
        if (!(await z.evaluate(() => STATE.inst === "guitar" && $("instGuitar").getAttribute("aria-pressed") === "true"))) fails.push("第一次打開應該預設吉他");
        await z.close(); }
      // 使用者指正過的指法(和弦表與網頁用同一個 gtrFingering)
      total++;
      { const bad = [];
        for (const [fr, want] of [["2,-1,1,2,1,-1", "2-131-"], ["3,2,0,0,0,2", "32---1"], ["-1,1,3,1,3,1", "-13141"], ["1,3,1,1,1,1", "131111"],
                                  ["1,3,3,1,1,1", "134111"], ["1,3,3,-1,-1,-1", "134---"], ["-1,0,2,2,2,2", "--1111"], ["1,3,1,0,1,-1", "131-2-"],
                                  ["-1,4,2,4,4,4", "-21344"], ["-1,3,1,3,3,3", "-21344"], ["-1,3,2,2,1,0", "-4231-"], ["3,-1,2,3,2,0", "2-131-"],
                                  ["-1,3,4,3,4,-1", "-1324-"], ["1,-1,1,2,3,2", "T-1243"]]) {
          const got = await q.evaluate(f => gtrFingering(f.split(",").map(Number)).map(x => x || "-").join(""), fr);
          if (got !== want) bad.push(fr + " → " + got + "(應為 " + want + ")");
        }
        if (bad.length) fails.push("指法: " + bad.join("; ")); }
      // 每個列出來的按法:指法不能有 0 號手指、最多 4 根手指(拇指另計)
      total++;
      { const bad = await q.evaluate(() => { const o = [];
          for (const def of CHORDS) for (let pc = 0; pc < 12; pc++) for (const v of chordVoicingsFor(pc, def).list) {
            const fg = gtrFingering(v.frets);
            if (fg.some(x => x === "0") || new Set(fg.filter(x => x && x !== "T")).size > 4 || fg.some((x, i) => (v.frets[i] > 0) !== !!x)) o.push(pc + def.sym + " " + gtrTabText(v.frets) + " " + fg.map(x => x || "-").join(""));
          }
          return o; });
        if (bad.length) fails.push("指法不合理: " + bad.slice(0, 5).join(", ")); }
      // 梅湘有限移調模式:移一個週期要回到同一組音(第三、四模式曾經各錯一個音:該是 ♯5 / ♭6 卻寫成 6,對照 tonal.js 找到)
      total++;
      { const bad = await q.evaluate(() => {
          const per = { messiaen3: 4, messiaen4: 6, messiaen5: 6, messiaen6: 6, messiaen7: 6 }, o = [];
          for (const [id, p] of Object.entries(per)) { const sc = SCALES.find(x => x.id === id); if (!sc) { o.push(id + " 不見了"); continue; }
            const set = new Set(sc.t.map(x => ((tokenSemi(x) % 12) + 12) % 12));
            if ([...set].some(x => !set.has((x + p) % 12))) o.push(id); }
          return o; });
        if (bad.length) fails.push("梅湘模式不對稱: " + bad.join(", ")); }
      // F 大三和弦第一個是小 F(× × 3 2 1 1),橫按 F 排後面(使用者要求開放把位優先)
      total++;
      { const f = await q.evaluate(() => { const vs = chordVoicingsFor(5, chordById("maj")); return vs.list.map(v => gtrTabText(v.frets)); });
        if (f[0] !== "× × 3 2 1 1" || !f.includes("1 3 3 2 1 1")) fails.push("F 的按法順序: " + f.join(" | ")); }
      // 樂器切換鈕與和弦表的樂器選項同一個順序:吉他在左、鋼琴在右
      total++;
      if (await q.evaluate(() => [...document.querySelectorAll(".inst-switch button")].map(b => b.id).join() !== "instGuitar,instPiano")) fails.push("樂器切換鈕應該吉他在左、鋼琴在右");
      // 只有目前的根音、基本 7 種:照「大三 小三 maj7 m7 7 m7♭5 dim7」排
      await q.click('#printPop [data-g="set"][data-v="core"]'); await q.click('#printPop [data-g="roots"][data-v="cur"]'); await q.click("#printGo");
      await q.waitForFunction(() => !PRINT.busy, null, { timeout: 60000 });
      const names = await q.evaluate(() => [...document.querySelectorAll("#printSheet .ps-cell b")].map(b => b.textContent).join(" "));
      total++; if (names !== "C Cm Cmaj7 Cm7 C7 Cm7♭5 Cdim7") fails.push("基本 7 種(只印目前根音): " + names);
      total++; if (!(await q.evaluate(() => /Steven Tsai/.test($("printSheet").textContent) && /HarmonyMap · steventsaimusic/.test($("printSheet").textContent) && /©/.test($("printSheet").textContent)))) fails.push("和弦表沒有作者與版權");
      // 分頁自己排:按鈕寫的頁數 = 產生的頁數 = 實際 PDF 頁數;每一頁都有頁尾(作者、版權)
      if (w === 390) for (const [inst, set] of [["guitar", "core"], ["piano", "other"]]) {
        await q.click('#printPop [data-g="inst"][data-v="' + inst + '"]'); await q.click('#printPop [data-g="set"][data-v="' + set + '"]'); await q.click('#printPop [data-g="roots"][data-v="all"]');
        const label = +(await q.evaluate(() => $("printGo").textContent)).replace(/\D+/g, " ").trim().split(" ").pop();
        await q.click("#printGo"); await q.waitForFunction(() => !PRINT.busy, null, { timeout: 60000 });
        const dom = await q.evaluate(() => ({ pages: document.querySelectorAll(".ps-page").length, feet: [...document.querySelectorAll(".ps-page")].filter(p => /Steven Tsai/.test(p.textContent) && /HarmonyMap/.test(p.lastElementChild.textContent) && p.querySelector(".ps-head .ps-title")).length }));   // 每一頁都有頁首與頁尾
        await q.evaluate(() => document.body.classList.add("printing"));
        const pdf = ((await q.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true })).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
        await q.evaluate(() => document.body.classList.remove("printing"));
        total++; if (!(label === dom.pages && dom.pages === pdf && dom.feet === pdf)) fails.push("和弦表頁數(" + inst + " " + set + "): 按鈕 " + label + "、產生 " + dom.pages + "、PDF " + pdf + "、有頁尾 " + dom.feet);
      }
      // 下載 PDF(網頁自己寫 PDF,不經過列印):頁數 = 按鈕寫的、A4、沒有直接列印鈕
      if (w === 390) {
        await q.click('#printPop [data-g="inst"][data-v="guitar"]'); await q.click('#printPop [data-g="set"][data-v="core"]'); await q.click('#printPop [data-g="roots"][data-v="all"]');
        const r = await q.evaluate(async () => {
          const want = +$("printGo").textContent.replace(/\D+/g, " ").trim().split(" ").pop();
          await buildPrintSheet();
          const blob = await new Promise(res => { window.__pdfCapture = res; exportPdf(); });
          window.__pdfCapture = null;
          const txt = new TextDecoder("latin1").decode(await blob.arrayBuffer());
          return { want, pages: (txt.match(/\/Type \/Page /g) || []).length, a4: txt.includes("/MediaBox [0 0 595.28 841.89]"), direct: !!$("printDirect"), kb: Math.round(blob.size / 1024) };
        });
        total++; if (r.pages !== r.want || !r.a4 || r.direct) fails.push("下載 PDF: " + JSON.stringify(r));
      }
      // 列印樣式:只看得到和弦表
      await q.emulateMedia({ media: "print" }); await q.evaluate(() => document.body.classList.add("printing"));
      const pr = await q.evaluate(() => ({ sheet: $("printSheet").getBoundingClientRect().height > 100, main: getComputedStyle(document.querySelector("main")).display, hdr: getComputedStyle(document.querySelector("header")).display }));
      total++; if (!pr.sheet || pr.main !== "none" || pr.hdr !== "none") fails.push("列印時應該只有和弦表: " + JSON.stringify(pr));
      await q.emulateMedia({ media: "screen" }); await q.evaluate(() => document.body.classList.remove("printing"));
      if (q._errors.length) fails.push("和弦表頁面錯誤 " + q._errors.join("; "));
      await q.close();
    }
    report("和弦表", total, fails);
  }

  /* ── 7. 音訊生命週期與穩定性:儲存空間被停用、iOS 打斷後叫醒、節拍器補拍與停止、單音不累積 ── */
  {
    const fails = []; let total = 0;
    // 儲存空間被停用(getItem/setItem 丟例外)時,畫面照樣出來
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const q = await ctx.newPage(); const errs = [];
      q.on("pageerror", e => errs.push(e.message));
      await q.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error("denied"); }; Storage.prototype.setItem = () => { throw new Error("denied"); }; });
      await q.route(/^https?:\/\//, r => r.abort());
      await q.goto(PAGE);
      await q.click("#langToggle").catch(() => {});
      const ok = await q.evaluate(() => typeof CHORDS !== "undefined" && $("typeList").children.length > 0 && LANG === "en");
      total++; if (!ok || errs.length) fails.push("儲存空間停用時畫面沒出來或換不了語言: " + errs.join("; "));
      await ctx.close();
    }
    const q = await openPage(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await q.locator("#kbSummary b").click();
    // iOS 打斷(這裡用 suspend 模擬)之後,回到前景或碰一下畫面就叫醒
    const woke = await q.evaluate(async () => {
      await audioCtx.suspend();
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise(r => setTimeout(r, 200));
      return audioCtx.state;
    });
    total++; if (woke !== "running") fails.push("音訊被暫停後回到前景沒有叫醒: " + woke);
    // 節拍器:計時器卡住 2 秒回來,錯過的拍子不能一口氣補(會聽到一串點擊)
    const burst = await q.evaluate(async () => {
      PRACTICE.steps = [{ letter: 0, acc: 0, id: "maj", bass: null }, { letter: 4, acc: 0, id: "maj", bass: null }];
      const clicks = [], orig = practiceClick;
      practiceClick = (t, a) => clicks.push(t);
      practiceStart(); await new Promise(r => setTimeout(r, 60));
      clicks.length = 0; PRACTICE.nextTime -= 2;
      await new Promise(r => setTimeout(r, 80));
      const n = clicks.length; practiceStop(); practiceClick = orig; return n;
    });
    total++; if (burst > 2) fails.push("節拍器卡住回來一次補了 " + burst + " 拍");
    // 在拍子前一刻按停止:已經排好、還沒響的下一個和弦要取消
    const cancelled = await q.evaluate(async () => {
      const hit = [];
      PRACTICE.bpm = 240; practiceStart();
      // 等到下一小節的和弦已經排好、還沒響的那一刻(節拍器提前 0.1 秒排)
      let pending = 0;
      for (let i = 0; i < 400 && !pending; i++) {
        await new Promise(r => setTimeout(r, 5));
        pending = scheduledNodes.filter(n => n._at > audioCtx.currentTime + 0.01).length;
      }
      const pend = scheduledNodes.filter(n => n._at > audioCtx.currentTime + 0.01);
      practiceStop();
      return { pending, hit: pend.filter(n => n._cancelled).length };
    });
    total++; if (!cancelled.pending || cancelled.hit < cancelled.pending) fails.push("停止後還沒響的和弦沒有取消: " + JSON.stringify(cancelled));
    // 播放中換小節只更新「現在 / 下一個」:文字框不能失去焦點、開始/停止鈕不能被換掉(換小節那一刻按停止會點空)
    const tick = await q.evaluate(async () => {
      PRACTICE.open = true; STATE.tab = "chord"; PRACTICE.step = 0; render();
      const go = $("prGo"), inp = $("prCustom"); inp.focus();
      PRACTICE.step = 1; practiceApply(); practiceTick();
      const r = { sameGo: $("prGo") === go, focus: document.activeElement && document.activeElement.id, now: $("prNow").textContent === stepName(PRACTICE.steps[1]) ? "E" : $("prNow").textContent,
                  cur: [...$("prSteps").children].findIndex(x => x.classList.contains("cur")) };
      PRACTICE.open = false; render(); return r;
    });
    total++; if (!tick.sameGo || tick.focus !== "prCustom" || tick.now !== "E" || tick.cur !== 1) fails.push("練習換小節時重建了整張卡片: " + JSON.stringify(tick));
    // 取樣一個都沒抓到之後,過一陣子(或網路恢復)要能重抓,不能整個工作階段都卡在合成音色
    const retry = await q.evaluate(async () => {
      if (pianoLoading) await pianoLoading;
      const before = { buf: pianoBuffers, loading: pianoLoading };
      // 做一個很短的 WAV 當作「網路恢復後抓到的檔案」
      const wav = () => { const n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 5) * 8000), true); return b; };
      const orig = sampleFetch; sampleFetch = () => Promise.resolve(wav());
      window.dispatchEvent(new Event("online"));
      if (pianoLoading) await pianoLoading;
      const after = pianoBuffers ? pianoBuffers.length : 0;
      sampleFetch = orig;
      return { failedFirst: before.buf === null && before.loading === null, after };
    });
    total++; if (!retry.failedFirst || !retry.after) fails.push("取樣抓不到之後不會重抓: " + JSON.stringify(retry));
    // Cache API:同一個檔案第二次從快取拿,不再上網抓
    const cached = await q.evaluate(async () => {
      const store = new Map(); let nets = 0;
      const cache = { match: u => Promise.resolve(store.has(u) ? store.get(u).clone() : undefined), put: (u, r) => { store.set(u, r); return Promise.resolve(); } };
      Object.defineProperty(window, "caches", { configurable: true, value: { open: () => Promise.resolve(cache) } });
      const of = window.fetch; window.fetch = () => { nets++; return Promise.resolve(new Response(new Uint8Array([1, 2, 3]))); };
      const a = await sampleFetch("https://x/a.mp3"), b = await sampleFetch("https://x/a.mp3");
      window.fetch = of; delete window.caches;
      return { nets, a: a.byteLength, b: b.byteLength };
    });
    total++; if (cached.nets !== 1 || cached.b !== 3) fails.push("取樣沒有存進快取: " + JSON.stringify(cached));
    // 轉向/改視窗大小之後摘要列要重新排:窄→寬不能留著縮小的字,寬→窄不能被切
    {
      await q.setViewportSize({ width: 320, height: 568 });
      await q.evaluate(() => { STATE.inst = "guitar"; STATE.tab = "scale"; STATE.scaleId = "chromatic"; render(); });
      await q.setViewportSize({ width: 1280, height: 860 }); await q.waitForTimeout(400);
      const wide = await q.evaluate(() => document.querySelector("#kbSummary .tones").style.fontSize);
      await q.setViewportSize({ width: 320, height: 568 }); await q.waitForTimeout(400);
      const narrow = await q.evaluate(() => { const t = document.querySelector("#kbSummary .tones"); return t.scrollWidth > t.clientWidth + 1; });
      await q.evaluate(() => { STATE.inst = "piano"; STATE.tab = "chord"; render(); });
      await q.setViewportSize({ width: 390, height: 844 });
      total++; if (wide || narrow) fails.push("改視窗大小後摘要列沒有重排: 寬版字級=" + wide + " 窄版被切=" + narrow);
    }
    // 連點單音:紀錄不能一直累積
    const grow = await q.evaluate(async () => {
      for (let i = 0; i < 300; i++) playSingle(60 + (i % 12));
      await new Promise(r => setTimeout(r, 2600));
      playSingle(60);
      return { w: soundingWindows.length, n: scheduledNodes.length };
    });
    total++; if (grow.w > 10 || grow.n > 20) fails.push("連點單音後紀錄一直累積: " + JSON.stringify(grow));
    if (q._errors.length) fails.push("頁面錯誤 " + q._errors.join("; "));
    await q.close();
    report("音訊與穩定性", total, fails);
  }

  await browser.close();

  let failed = 0;
  for (const r of results) {
    const ok = !r.fails.length;
    console.log((ok ? "✓ " : "✗ ") + r.group + "  " + (r.total - Math.min(r.total, r.fails.length)) + "/" + r.total + (process.env.TIMING ? "  " + (r.ms / 1000).toFixed(1) + "s" : ""));
    for (const f of r.fails.slice(0, 20)) console.log("    " + f);
    if (r.fails.length > 20) console.log("    …另外 " + (r.fails.length - 20) + " 項");
    failed += r.fails.length;
  }
  console.log(failed ? "\n失敗 " + failed + " 項" : "\n全部通過");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
