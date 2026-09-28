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
          if (!ref.some(f => f.join(",") === got.join(","))) fails.push(tag + ": 斜線和弦的第一個指法不在資料庫裡 " + gtrTabText(got));
        }
      }
      return { total, fails };
    });
    report("和弦資料庫一致", r.total, r.fails);
  }

  /* ── 3c. 每個和弦只給三種指法:最常用的開放和弦、五弦封閉、六弦封閉(使用者要求) ──
     封閉和弦:根音在最低那條弦、沒有空弦、最低格不比根音低超過 1 格;
     1 弦在橫按那一格是和弦音時,1 弦一定要彈(食指整排壓下去) */
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
        const kinds = [];
        for (const v of vs.list) {
          const f = v.frets, low = f.findIndex(x => x >= 0), hasOpen = f.some(x => x === 0);
          const rf = [pcOf(rp - 4) || 12, pcOf(rp - 9) || 12];
          let k = null;
          if (hasOpen && Math.max(...f) <= 4) k = "open";
          else if (!hasOpen && low <= 1 && f[low] === rf[low] && v.minF >= rf[low] - 1) k = low === 0 ? "six" : "five";
          if (!k) { if (vs.list.length > 1) fails.push(tag + ": " + gtrTabText(f) + " 不屬於三種"); continue; }
          if (kinds.includes(k)) fails.push(tag + ": 重複的 " + k);
          kinds.push(k);
          // 封閉和弦不硬湊:要嘛資料庫有列,要嘛是這種和弦自己的 E/A 開放形狀往上推
          if (vs.fallback) continue;   // 三種都沒有時只列一個(資料庫第一名或評分最好的),不算硬湊
          if (k !== "open" && !v.ref && !v.shape) fails.push(tag + ": " + gtrTabText(f) + " 資料庫沒有、也不是 E/A 形");
          if (k !== "open" && !v.shape && v.barreShown && v.span >= 3) fails.push(tag + ": " + gtrTabText(f) + " 橫按又撐 4 格");
        }
        // 1 弦:食指橫按的封閉和弦,1 弦在橫按那格是和弦音就一定要彈
        const all = [];
        for (const v of vs.list) {
          const f = v.frets;
          if (!v.barreShown || f.some(x => x === 0) || f[5] >= 0 || vs.fallback) continue;
          let canReach = true;   // 橫按延伸得到 1 弦(中間每條弦要嘛按更高格、要嘛在橫按那格是和弦音)
          for (let s = v.barreHi + 1; s <= 5; s++) if (f[s] < v.minF && !pcs.has(pcOf(GTR_OPEN[s] + v.minF))) canReach = false;
          if (canReach) all.push(gtrTabText(f));
        }
        if (all.length) fails.push(tag + ": 封閉和弦 1 弦沒彈 " + all.join(", "));
      }
      return { total, fails };
    });
    report("指法只有三種", r.total, r.fails);
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
    // 根音卡片沒有 ♮:♭ ♯ 是開關,按字母回到本位音
    const rn = () => q.evaluate(() => rootName());
    total++; if (await q.locator("#accRow .key-btn").count() !== 2) fails.push("根音卡片應該只有 ♭ ♯ 兩顆");
    await q.locator("#letterRow .key-btn", { hasText: /^B$/ }).click(); await q.locator("#accRow .key-btn").nth(0).click();
    total++; if ((await rn()) !== "B♭") fails.push("B + ♭ = " + await rn());
    await q.locator("#accRow .key-btn").nth(0).click();
    total++; if ((await rn()) !== "B") fails.push("♭ 再按一次應該取消: " + await rn());
    await q.locator("#accRow .key-btn").nth(1).click(); await q.locator("#letterRow .key-btn", { hasText: /^E$/ }).click();
    total++; if ((await rn()) !== "E") fails.push("按字母應該回到本位音: " + await rn());
    await q.evaluate(() => { STATE.letter = 0; STATE.acc = 0; render(); }); await take();

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
    await q.click("#prSlash"); await q.locator("#prLetters .key-btn", { hasText: /^F$/ }).click();
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
    await q.keyboard.press("/"); await q.keyboard.press("a");
    check((await steps()) === "C D/F♯ Em/A", "快捷鍵 / a: " + await steps());
    await q.keyboard.press("Backspace");
    await q.fill("#prCustom", "C D/F# Em"); await q.press("#prCustom", "Enter");
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
