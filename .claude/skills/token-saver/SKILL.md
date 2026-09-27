---
name: token-saver
description: 在 HarmonyMap 裡工作時節省 token 的做法。index.html 是 200KB、2700+ 行的單檔,任何要讀或改這個專案的工作(改功能、修 bug、查樂理資料、跑驗證)開始之前都先套用這份規則。
---

# 節省 token

這個專案只有一個大檔(`index.html`,約 200KB)。整份讀一次就吃掉上萬 token,
而且改完再讀一次又是一萬。原則是**先定位、再局部讀、改完不重讀**。

## 讀檔

- **不要整份 Read `index.html`**。先用 Grep 找位置,再用 Read 的 `offset` / `limit` 讀需要的那一段
  (通常 40~120 行就夠)。
- 找大區塊用區段標題:`Grep "══" -n`(每一節都有 `N. 標題` 的框線註解),
  函式用 `Grep "^function \w+" -n`,CSS 用 `Grep "^\.class-name|@media" -n`。
- 字典資料(`CHORDS` / `SCALES`)一條一行,查特定條目用 `Grep 'id:"maj7"'`,不要把整張表讀進來。
- `CLAUDE.md` 已經在系統提示裡,不要再 Read 一次。`README.md` 只在要改說明時才讀。
- 同一段程式這一輪已經讀過就不要再讀;Edit 成功就代表改進去了,不用讀回來確認。

## 指令輸出

- 會印很多東西的指令一律加 `| head -N`、`| tail -N`、`grep -c` 或只印失敗項目。
- 驗證一律跑 `node tests/run.js`,它本來就只輸出**失敗清單與總數**。不要另外寫一次性的驗證腳本,
  需要新檢查就加進 `tests/run.js`。
- `git diff` 先看 `--stat`,真的需要時才看單一段落。

## 工具使用

- 彼此不相依的讀取、搜尋、指令放在同一輪平行呼叫。
- 不要為了「找東西」開子代理(Agent):單檔專案用 Grep 就找得到,開子代理要重新建立整份上下文,反而更貴。
- 小改動用 Edit;只有要大幅重寫某個檔時才用 Write。
- 驗證用 headless Chromium(已預裝,`executablePath: '/opt/pw-browsers/chromium'`)在頁面裡直接呼叫函式,
  比把程式碼抽出來在 node 裡重建環境省事。腳本放 scratchpad,不要進 repo。

## 回覆

- 回報結果寫重點:改了什麼、驗證了什麼、有什麼沒做。不要貼整段程式碼或完整 diff。
- 不要複述 CLAUDE.md 的規則給使用者聽,照著做就好。
