# HarmonyMap 專案規則

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
- 音名不要改成查表法。必須維持「字母照級數推、升降記號照音高差算」的規則,
  否則 Cdim7 會變成 C D♯ F♯ A 這種錯誤拼寫
- 不要把音源換成純合成音色。取樣清單(`PIANO_SAMPLES`)與網址是逐一驗證過的,
  改動前先確認檔案真的存在,套用不存在的組合只會讓抓取落空、整組退回合成音色

## 已知踩過的坑
- 和弦的延伸音(9/11/13)半音數會超過 12,拿去比對和弦字典時要先 mod 12,
  但推算拼寫時**不能** mod,不然會算錯字母與八度
- 窄螢幕把鍵盤釘在頂欄下方(`position:sticky`)之後,分組標題的 sticky 會躲進鍵盤底下,
  窄螢幕要把標題改回 `position:static`
- CSS 同權重的規則要寫在後面才蓋得過去:`.type-scroll` 的手機版覆寫必須放在
  桌機版那條規則之後,寫在版面區塊裡會失效
- 頂欄高度會隨字級與換行改變,鍵盤的 sticky 偏移量用 JS 量出來寫進 `--header-h`,
  不要寫死數字
- 取樣有 30 個檔案,等按下播放才開始抓的話,第一次播放一定只聽得到合成音色。
  所以在「使用者第一次碰到頁面」時就 `ensureAudio()` 暖機,不要退回按下播放才載入

## 驗證方式
改完樂理相關的程式後,至少確認這幾個拼寫是對的:
`Cdim7 = C E♭ G♭ B♭♭`、`F♯7♯9 = F♯ A♯ C♯ E G♯♯`、`D♭13 = D♭ F A♭ C♭ E♭ B♭`、
`C 大調順階七和弦 = Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7♭5`
