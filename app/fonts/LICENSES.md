# 內建字型 / Bundled fonts

| 字型 | 字重 | 來源 | 授權 |
|---|---|---|---|
| Noto Serif TC | 600、700 | Google Fonts(https://fonts.google.com/noto/specimen/Noto+Serif+TC) | SIL Open Font License 1.1(`OFL-NotoSerifTC.txt`) |
| Noto Sans TC | 400、500、700 | Google Fonts(https://fonts.google.com/noto/specimen/Noto+Sans+TC) | SIL Open Font License 1.1(`OFL-NotoSansTC.txt`) |

- `fonts.css` 與 `files/*.woff2` 是 Google Fonts 對 Safari 回的 CSS 與字型檔,網址改成相對路徑;檔案本身沒有修改。
- OFL 允許隨 App 散布,條件是附上授權全文(已附)、不單獨販售字型。
- 重新產生:抓 `https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap`(用 Safari 的 User-Agent),
  下載裡面的 woff2、把網址改成 `files/<檔名>`,重算 SHA256SUMS,跑 `node tests/run.js`。
