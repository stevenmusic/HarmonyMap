# App Store 上架資料(草稿,請確認後貼進 App Store Connect)

## 基本
- App 名稱:HarmonyMap(30 字內)
- 副標題(30 字內):和弦、音階、吉他指法一次查
- 分類:主要「音樂」,次要「教育」
- 年齡分級:4+(無使用者內容、無網頁瀏覽、無購買)
- 價格:免費(未使用內購與廣告)
- Bundle ID:com.stevenmusic.harmonymap(`capacitor.config.json`,要改的話兩邊一起改)
- 隱私權政策網址:需放在可公開存取的網址(例如 GitHub Pages 發佈 `store/privacy-policy.md`),填進 App Store Connect
- 支援網址:同上(GitHub 專案頁即可)
- 隱私問卷(App Privacy):選「不蒐集資料」(Data Not Collected)
- 出口合規:只用系統標準加密(HTTPS)→ `ITSAppUsesNonExemptEncryption` = NO(已寫在 README 步驟裡)

## 說明(繁體中文)
HarmonyMap 是給音樂人與學習者的和弦與音階字典。選根音、挑和弦或音階,馬上在鋼琴鍵盤或吉他指板上看到每個音,點一下就能聽。

• 和弦字典:80 種和弦 × 21 個根音,組成音照樂理拼寫(Cdim7 = C E♭ G♭ B♭♭)
• 音階字典:大小調、教會調式、五聲、藍調、爵士與異國音階,吉他音階分把位
• 反查:在鍵盤或指板上點音,找出是什麼和弦
• 吉他:每個和弦列出最實用的 3 種指法,和弦圖標示左手手指、可設移調夾與左手模式
• 斜線和弦與轉位、同音異名的另一種寫法
• 換和弦練習:節拍器、和弦進行輸入、移調與存檔
• 內建真實鋼琴與三種吉他(古典、民謠、電吉他)取樣音色,完全離線也能用
• 繁體中文與英文介面、淺色與深色主題,適配手機、平板與桌面尺寸

## Description (English)
HarmonyMap is a chord and scale dictionary for musicians and learners. Pick a root, choose a chord or scale, and see every note on a piano keyboard or guitar fretboard — tap to hear it.

• Chord dictionary: 80 chord types × 21 roots, spelled correctly (Cdim7 = C E♭ G♭ B♭♭)
• Scale dictionary: major/minor, modes, pentatonic, blues, jazz and exotic scales, with guitar positions
• Reverse lookup: tap notes to identify the chord
• Guitar: the 3 most practical voicings per chord, fingering numbers, capo and left-handed mode
• Slash chords, inversions, and enharmonic alternate names
• Chord-change practice: metronome, progression input, transposition, saving
• Realistic piano and three guitar sounds (classical, acoustic, electric) built in — works fully offline
• English and Traditional Chinese, light and dark themes, from phones to desktops

## 關鍵字(100 字元內)
和弦,音階,吉他,鋼琴,指法,樂理,chord,scale,guitar,piano,fretboard,theory

## 審核備註(App Review Notes)
No login required. The app is a self-contained music-theory tool; no account, purchase, or user-generated content. Piano and guitar samples are bundled in the app (credits are listed at the bottom of the in-app Help screen); no network is required.

## 截圖
App Store Connect 目前要求至少 6.9 吋(或 6.5 吋)iPhone 截圖一組,若支援 iPad 還需 13 吋 iPad 截圖一組。
在 Xcode 模擬器裡執行後用 ⌘S 截圖(建議:和弦鋼琴、和弦吉他、音階、反查、練習,各一張,中英文各一組)。
