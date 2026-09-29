# HarmonyMap 專案規則

## Git
- 改完、驗證過就直接 push 到 `main`,不用問(使用者明確要求)

## 技術棧
- 單檔 HTML,沒有任何相依套件(只有 Google Fonts,離線時會退回系統字型)
- Canvas 2D 畫鍵盤
- 音源與 ScrollScore 相同:Salamander 鋼琴真實取樣為主,Web Audio 合成音色為備援

## 絕不能做的事
- 不要把單檔拆成多檔案,除非我明確要求(跟 ScrollScore 同一套部署方式)
- 不要改動照抄自 ScrollScore 的那一段鍵盤繪製程式(`isBlackKey` / `KB_*` /
  `computeKeyboardHeight` / `rebuildKeyboardRange` / `drawKeyboard`)。要加東西就像
  `drawKeyLabels` 那樣「在上面再疊一層」,不要動原本的函式本體
- 頂欄品牌名的 CSS 與 ScrollScore 逐項相同(字型、clamp 字級、字距、各斷點),
  改之前先確認兩邊還是一致
- 圖示一律用 ScrollScore 那一套線稿 SVG(24 格線、`stroke-width:2`、圓端點、
  `stroke:currentColor`),不要用 ⚙ ☀ 這種字元——字元的粗細與造型會隨系統字型跑掉,
  跟旁邊的線稿圖示放在一起會明顯不同掛。目前照抄的有:淺色模式切換、鍵盤設定齒輪;
  照同一套規格畫的有:使用說明 ?、練習卡片的 × 與 − / +、刪除最後一個(倒退鍵)
- 音名不要改成查表法。必須維持「字母照級數推、升降記號照音高差算」的規則,
  否則 Cdim7 會變成 C D♯ F♯ A 這種錯誤拼寫
- 不要把音源換成純合成音色。取樣清單(`PIANO_SAMPLES`)與網址是逐一驗證過的,
  改動前先確認檔案真的存在,套用不存在的組合只會讓抓取落空、整組退回合成音色

## 響應式斷點(與 ScrollScore 同一組,不要自己多開)
```
max-width:900 / 600 / 380 / 340    max-height:420    min-width:900
pointer:coarse ×3(單獨、+max-height:420、+max-width:420)
prefers-reduced-motion:reduce
```
- 這一組是 ScrollScore / SightScore / LoudNorm / HarmonyMap **四個專案共用**的,
  任何一邊要動都要四邊一起看。各專案只用得到的子集,但值一定要落在這組上
- SightScore 原本用 560 / 680 / 1024、LoudNorm 原本用 480 / 768 / 1200 / 1400,
  已經全部收斂到上面這一組;四個專案裡不會再出現這組以外的數字
- 需要「隨尺寸連續變化」的東西一律用 clamp / vh 算,不要為它新增斷點
  (例如釘住的鍵盤高度上限是 `min(KB_MAX_H, innerHeight * 0.22)`)
- `min-width:900px` 的兩欄版面必須放在整份樣式表的**最後**。寬度剛好 900px 時
  `max-width:900px` 與 `min-width:900px` 會同時成立,靠順序決勝負(ScrollScore 也是這樣排)

## 驗證方式
**改完任何東西、push 之前都要跑 `node tests/run.js`**(約 45 秒,需要 playwright)。
它只印失敗項目與各組總數,有失敗就以非零代碼結束。涵蓋:下面這幾個拼寫、字典 × 21 根音、
吉他標準指法與 OPEN_CANON、7917 組吉他指法(含斜線和弦)、和弦名稱解析、點擊發聲的互動、
英文介面無中文(每個條目都點過)、六種尺寸 × 鋼琴/吉他的版面。
新增規則或修 bug 時,把對應的檢查加進 `tests/run.js`,不要只在暫存區驗證(暫存區會隨工作階段消失)。
測試是開發用的,`index.html` 本身仍然是單檔、沒有相依套件。

改完樂理相關的程式後,至少確認這幾個拼寫是對的:
`Cdim7 = C E♭ G♭ B♭♭`、`F♯7♯9 = F♯ A♯ C♯ E G♯♯`、`D♭13 = D♭ F A♭ C♭ E♭ B♭`、
`C 大調順階七和弦 = Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7♭5`
改完雙語相關的程式後,把語言切到英文,把兩個分頁的分類全部展開、每個條目都點一次,
確認畫面上除了語言切換鈕的「中」以外沒有任何中文字。

## 細節規則放在 docs/(要改相關功能時才讀,不要整份載入)
| 要改什麼 | 先讀 |
|---|---|
| 踩過的坑(轉向、sticky、音源、響度、摘要列一行…)、操作手感(不移位、不縮放、不卡頓) | `docs/pitfalls.md` |
| 版面、儘量滿版、字級、分類/篩選/三層清單、結果面板、記號圖例 | `docs/layout.md` |
| 和弦/音階字典、辨識(反查)、中英雙語、播放方式、快捷鍵 | `docs/dictionary.md` |
| 換和弦練習(節拍器、輸入板、移調、存進行) | `docs/practice.md` |
| 吉他:指法挑選、和弦圖、把位、撥弦、斜線和弦 | `docs/guitar.md` |

改完規則相關的東西,要把新規則寫回對應的 docs 檔(不是這裡)。這裡只放「絕不能做的事」與全域約定。
