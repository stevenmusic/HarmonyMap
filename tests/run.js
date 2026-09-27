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

    await q.click("#instGuitar");
    await q.evaluate(() => { STATE.chordId = "maj"; render(); });
    box = await q.locator("#keyboardCanvas").boundingBox();
    const pt = (s, f) => q.evaluate(([s, f]) => { const L = $("keyboardCanvas")._fb; return [L.xOf(f), L.yOf(s)]; }, [s, f]);
    const tapStr = async (s, f) => { const [x, y] = await pt(s, f); await q.mouse.click(box.x + x, box.y + y); };
    await tapStr(1, 10); await expect("吉他 C 撥 5 弦(點第 10 格)", "s48");
    await tapStr(0, 5); await expect("吉他 C 撥 6 弦(×)", "");
    await tapStr(3, 7); await expect("吉他 C 撥 3 弦(空弦)", "s55");
    const [x0, y0] = await pt(0, 4), [, y1] = await pt(5, 4);
    await q.mouse.move(box.x + x0, box.y + y0); await q.mouse.down();
    for (let i = 1; i <= 12; i++) await q.mouse.move(box.x + x0, box.y + y0 + (y1 - y0) * i / 12);
    await q.mouse.up();
    await expect("吉他 C 由 6 弦刷到 1 弦", "s48 s52 s55 s60 s64");
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

  /* ── 5c. 換和弦練習:進行換調、自訂進行、節拍器實際換和弦 ── */
  {
    const q = await openPage(browser, { viewport: { width: 390, height: 844 } });
    await q.click("#instPiano");
    await q.click("#practiceOpen");
    const fails = [];
    const steps = () => q.evaluate(() => [...document.querySelectorAll("#prSteps span")].map(x => x.textContent).join(" "));
    const want = async (label, exp) => { const got = await steps(); if (got !== exp) fails.push(label + ": " + got + " ≠ " + exp); };
    await want("C 大調 I–V–vi–IV", "C G Am F");
    await q.selectOption("#prKey", "1"); await want("G 大調 I–V–vi–IV", "G D Em C");
    await q.selectOption("#prKey", "10"); await want("B♭ 大調 I–V–vi–IV", "B♭ F Gm E♭");
    await q.selectOption("#prKey", "0");
    await q.locator("#prPresets .filter-chip").nth(5).click(); await want("C ii–V–I", "Dm7 G7 Cmaj7 Cmaj7");
    await q.locator("#prPresets .filter-chip").nth(6).click(); await want("C 12 小節藍調", "C7 C7 C7 C7 F7 F7 C7 C7 G7 F7 C7 G7");
    await q.fill("#prCustom", "C D/F# Em Xq"); await q.press("#prCustom", "Enter");
    await want("自訂進行", "C D/F♯ Em");
    if (!(await q.locator(".pr-bad").count())) fails.push("自訂進行打錯的字沒有提示");
    const hidden = await q.evaluate(() => [$("rootCard").hidden, $("typeCard").hidden, $("practiceCard").hidden]);
    if (hidden.join() !== "true,true,false") fails.push("練習時卡片顯示錯誤: " + hidden);
    // 節拍器:180 BPM、每個和弦 2 拍 → 約 0.67 秒換一次
    await q.evaluate(() => { window._plays = 0; playCurrent = () => window._plays++; });
    await q.selectOption("#prBeats", "2");
    await q.evaluate(() => { PRACTICE.bpm = 180; });
    await q.click("#prGo");
    await q.waitForTimeout(1600);
    const run = await q.evaluate(() => ({ plays: window._plays, now: $("prNow").textContent, sum: $("kbSummary").querySelector("b").textContent, running: PRACTICE.running }));
    if (!run.running || run.plays < 2) fails.push("節拍器沒有在換和弦: 換了 " + run.plays + " 次");
    if (run.now !== run.sum) fails.push("練習卡片的「現在」與鍵盤上的和弦不一致: " + run.now + " / " + run.sum);
    await q.click("#prGo");
    const stopped = await q.evaluate(() => { const n = window._plays; return new Promise(r => setTimeout(() => r(window._plays === n && !PRACTICE.running), 900)); });
    if (!stopped) fails.push("按停止後還在換和弦");
    await q.click("#prClose");
    if (await q.evaluate(() => !$("practiceCard").hidden || $("typeCard").hidden)) fails.push("結束練習後沒有回到和弦清單");
    if (q._errors.length) fails.push("頁面錯誤: " + q._errors.join("; "));
    report("換和弦練習", 12, fails);
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
    const pr = await q.evaluate(() => { STATE.inst = "piano"; STATE.tab = "chord"; PRACTICE.open = true; practiceLoad(0); render();
      const m = document.body.innerText.replace(/中/g, "").match(/[\u3400-\u9fff]+/g); PRACTICE.open = false; render(); return m ? m.slice(0, 3).join(",") : ""; });
    if (pr) fails.push("練習卡片: " + pr);
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
