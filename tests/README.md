# 測試與資料重建

## 回歸測試
```
node tests/run.js
```
需要 playwright(`npm i -g playwright` 即可)與 Chromium。只印失敗項目與各組總數,有失敗以非零代碼結束。
改完任何東西、push 之前都要跑。

## 重建吉他和弦資料庫表(`GTR_REF`)
```
node tests/gtr-ref/rebuild.js
node tests/run.js
```
1. 從 npm 抓三個版本釘死的資料庫:`@tombatossals/chords-db@0.5.1`、`instruments-chords@0.0.15`、
   `guitar-chord-definitions@1.0.2`
2. `gtr-ref/normalize.mjs` 轉成同一格式
3. 在頁面裡用本工具的樂理規則重驗每個指法、投票排序
4. 寫回 `index.html` 的 `const GTR_REF = {...};`

不要手改 `GTR_REF`。要調整就改驗證或排序規則,再重建。
