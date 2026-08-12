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

## 響應式斷點(與 ScrollScore 同一組,不要自己多開)
```
max-width:900 / 600 / 380 / 340    max-height:420    min-width:900
pointer:coarse ×3(單獨、+max-height:420、+max-width:420)
prefers-reduced-motion:reduce
```
- 這一組是 ScrollScore / SightScore / LoudNorm / HarmonyMap **四個專案共用**的,
  任何一邊要動都要四邊一起看。各專案只用得到的子集,但值一定要落在這組上
- 共 9 條,值與 ScrollScore 逐項相同。SightScore 用的是另一組(560 / 680 / 1024
  + reduced-motion + 橫向特例),那是它自己的版面結構;兩組混用會變成 7 個寬度階,
  反而更亂,所以 HarmonyMap 一律跟 ScrollScore 走(頁首、鍵盤、音源本來就都照抄它)
- 需要「隨尺寸連續變化」的東西一律用 clamp / vh 算,不要為它新增斷點
  (例如釘住的鍵盤高度上限是 `min(KB_MAX_H, innerHeight * 0.22)`)
- `min-width:900px` 的兩欄版面必須放在整份樣式表的**最後**。寬度剛好 900px 時
  `max-width:900px` 與 `min-width:900px` 會同時成立,靠順序決勝負(ScrollScore 也是這樣排)

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
- 響度:訊號鏈是 masterGain → loudnessComp(-18dB / 3:1)→ makeupGain(1.6)→ 限幅器。
  少了中間那段響度壓縮,平均音量會低到使用者得把裝置音量開到 80~90%。
  實測積分響度:合成備援 -9~-10 LUFS、取樣路徑最壞情況 -5 LUFS,峰值都在 0 dBFS 以下沒有削波
- 釘在鍵盤下方的那行摘要(`.kb-summary`)必須維持「絕對只有一行」(nowrap + 省略號)。
  它一旦會換行,底下整排和弦按鈕就會跟著上下跳,手指會點錯
- 同理,鍵盤區裡任何會出現/消失的東西(例如載入提示)都要用絕對定位,不能佔版面高度
- 上半部要維持「一個」sticky 區塊(`.topbar` 包住分頁 + 鍵盤 + 根音)。
  拆成三個各自釘住的元素會有兩個問題:元素之間的間距是透明的,底下內容會從縫隙穿出來;
  而且每個元素的 top 偏移量都要靠 JS 量前一個的高度
- `@media (max-height:420px)` 裡的 `.topbar{position:static}` 必須寫在 `.topbar` 基本樣式
  **之後**,同權重靠順序決勝負,寫在前面會被 `position:sticky` 蓋掉(手機橫向就會爆版)

## 驗證方式
改完樂理相關的程式後,至少確認這幾個拼寫是對的:
`Cdim7 = C E♭ G♭ B♭♭`、`F♯7♯9 = F♯ A♯ C♯ E G♯♯`、`D♭13 = D♭ F A♭ C♭ E♭ B♭`、
`C 大調順階七和弦 = Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7♭5`
