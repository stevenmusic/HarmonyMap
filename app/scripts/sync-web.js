#!/usr/bin/env node
/* 把上一層的單檔 index.html、取樣 samples/、字型 fonts/ 複製到 www/(Capacitor 的 webDir)。
   - index.html 本身不動、不拆檔;www/ 是產生出來的,不進版本控制。
   - 網頁版連 Google Fonts;App 版把那兩行換成內建的 fonts/fonts.css,字型一致、離線也一樣。
     換不到(index.html 的字型連結被改過)就停下來,不會默默打包出連網字型的版本。
   - 複製前用各資料夾的 SHA256SUMS 核對,缺檔或被改過就停止,不會把壞的檔案打包出去。 */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.resolve(__dirname, ".."), src = path.resolve(root, "..", "index.html"), dir = path.join(root, "www");

function verify(name) {
  const base = path.join(root, name);
  const lines = fs.readFileSync(path.join(base, "SHA256SUMS"), "utf8").split("\n").filter(Boolean);
  let bad = 0, bytes = 0;
  for (const line of lines) {
    const [hash, rel] = line.split(/\s+\*?/);
    const f = path.join(base, rel);
    if (!fs.existsSync(f)) { console.error(name + " 缺檔:", rel); bad++; continue; }
    const buf = fs.readFileSync(f); bytes += buf.length;
    if (crypto.createHash("sha256").update(buf).digest("hex") !== hash) { console.error(name + " 內容不符:", rel); bad++; }
  }
  if (bad) { console.error(name + " 核對失敗 " + bad + " 個,已停止"); process.exit(1); }
  return { n: lines.length, mb: bytes / 1048576 };
}
const smp = verify("samples"), fnt = verify("fonts");

let html = fs.readFileSync(src, "utf8");
const PRECONNECT = '<link rel="preconnect" href="https://fonts.googleapis.com">\n';
const FONT_LINK = /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/;
if (!html.includes(PRECONNECT) || !FONT_LINK.test(html)) { console.error("index.html 的 Google Fonts 連結跟預期不同,sync-web.js 要跟著改"); process.exit(1); }
html = html.replace(PRECONNECT, "").replace(FONT_LINK, '<link href="fonts/fonts.css" rel="stylesheet">');
if (/fonts\.(googleapis|gstatic)\.com/.test(html)) { console.error("換完還有連網字型的參照"); process.exit(1); }

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "index.html"), html);
const skip = p => !p.endsWith("SHA256SUMS");
fs.cpSync(path.join(root, "samples"), path.join(dir, "samples"), { recursive: true, filter: skip });
fs.cpSync(path.join(root, "fonts"), path.join(dir, "fonts"), { recursive: true, filter: skip });
console.log("已產生 " + dir + ":index.html(" + html.length + " 字元)、取樣 " + smp.n + " 個(" + smp.mb.toFixed(1) + " MB)、字型檔 " + (fnt.n - 1) + " 個(" + fnt.mb.toFixed(1) + " MB)");
