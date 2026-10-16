# 內建取樣的來源與授權 / Bundled sample sources and licenses

App 版(`app/`)把取樣打包在 `samples/`,網頁版則是連網載入同一批檔案。
檔案內容與下載來源一致,`SHA256SUMS` 記錄每個檔案的雜湊值,`npm run sync` 複製前會核對。

| 資料夾 | 內容 | 檔數 | 來源 | 授權 |
|---|---|---|---|---|
| `piano/` | Salamander Grand Piano(A0~C8,每 3 半音一個) | 30 mp3 | Alexander Holm 的 Salamander Grand Piano V3,Tone.js 整理後託管於 https://github.com/Tonejs/audio(`salamander/`) | CC BY 3.0 |
| `acoustic/` | 民謠吉他(E2~D5,每個半音) | 37 mp3 | npm `tonejs-instrument-guitar-acoustic-mp3@1.1.2`(原錄音:University of Iowa Musical Instrument Samples) | CC BY 3.0(tonejs-instruments 專案對取樣的聲明)、程式 MIT |
| `electric/` | 電吉他(每 3 半音) | 17 mp3 | npm `tonejs-instrument-guitar-electric-mp3@1.1.1`(原錄音:Karoryfer Samples) | CC BY 3.0(同上)、程式 MIT |
| `classical/` | 古典吉他(E2~C6,每個半音;強音層) | 38 flac + manifest.json | Philharmonia Orchestra 免費取樣,經 ScrollScore 整理(https://github.com/stevenmusic/ScrollScore `guitar/classical/`) | CC BY-SA 3.0 |

## 標示(App 內「說明(?)」最下面已列)
- Piano: Salamander Grand Piano, Alexander Holm, CC BY 3.0
- Classical guitar: Philharmonia Orchestra, CC BY-SA 3.0 (processed by ScrollScore)
- Acoustic guitar: University of Iowa MIS; electric guitar: Karoryfer Samples — prepared by tonejs-instruments, samples CC BY 3.0

## 注意
- CC BY-SA 3.0(古典吉他):取樣經過處理(裁切、音準校正)的版本,同樣以 CC BY-SA 3.0 散布;App 的程式碼不是取樣的衍生作品,不受 ShareAlike 影響。
- 取樣若要更新:換檔後重算 `SHA256SUMS`(在 `app/samples/` 執行
  `find . -type f \( -name '*.mp3' -o -name '*.flac' -o -name manifest.json \) | sort | sed 's|^\./||' | xargs sha256sum > SHA256SUMS`),
  並確認 `tests/run.js` 的「App 內建取樣」通過。
