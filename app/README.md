# HarmonyMap iOS 封裝

網頁本體是上一層的單檔 `index.html`(不拆檔、無相依套件,CLAUDE.md 的規定)。
這個資料夾只放 iOS 封裝(Capacitor)用的設定,`www/` 與 `ios/` 是產生出來的。

## 需要準備
- 一台 Mac + Xcode(15 以上)+ Node 18 以上
- Apple Developer Program 帳號(年費 USD 99)
- 一個可公開存取的隱私權政策網址(內容用 `store/privacy-policy.md`)

## 步驟(第一次)
```bash
cd app
npm install
node scripts/sync-web.js            # 把 ../index.html 複製到 www/
npx cap add ios                     # 產生 ios/ 專案
npx capacitor-assets generate --ios # 用 assets/icon-only.png 產生各尺寸圖示
npx cap sync ios
npx cap open ios                    # 開 Xcode
```
在 Xcode 裡:
1. 選 App target → Signing & Capabilities:選你的 Team;Bundle Identifier 要跟 `capacitor.config.json` 的 `appId` 一樣(要改就兩邊一起改)。
2. General → Deployment Info:iPhone + iPad、Orientation 全選(網頁已適配直橫)。
3. `ios/App/App/Info.plist` 加:
   - `ITSAppUsesNonExemptEncryption` = `NO`(只用系統 HTTPS,不用自家加密)
   - `UIBackgroundModes` 不要加(沒有背景播放需求)
4. 實機或模擬器跑一遍(見下面「上架前自測」)。
5. Product → Archive → Distribute App → App Store Connect → Upload。
6. 到 App Store Connect 填 `store/listing.md` 的資料、上傳截圖、選建置版本、送審。

## 之後改了網頁
```bash
cd app && npm run sync   # 重新複製 index.html 並同步到 ios/
```
然後把版本號(Xcode 的 Version / Build)加一,重新 Archive。

## 上架前自測(實機)
- 離線(飛航模式)開啟:要能用,音色改成合成音色
- 連網:鋼琴、吉他取樣音色有載入(第一次載入要幾秒)
- 靜音開關打開時仍有聲音(網頁已處理 iOS 靜音開關)
- 直式、橫式、iPad 分割畫面:沒有橫向捲動、按鈕不被截斷
- 瀏海與底部 Home 指示條:內容不被蓋住(`viewport-fit=cover` 與 safe-area 已處理)
- 切語言、切主題、重新開啟後設定還在

## 已知的審核風險
- Guideline 4.2(最低功能):純網頁包裝可能被退。本 App 有完整字典、反查、練習、取樣音色與離線退路,
  審核備註已說明;若被退,補充說明功能深度即可。
- 音檔來自網路(jsDelivr / GitHub):沒有網路時退回合成音色。若想完全離線,需把取樣打包進 App(體積會大很多),目前沒做。
