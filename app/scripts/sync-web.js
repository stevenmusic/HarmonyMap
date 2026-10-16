#!/usr/bin/env node
/* 把上一層的單檔 index.html 與取樣 samples/ 複製到 www/(Capacitor 的 webDir)。
   index.html 本身不動、不拆檔;www/ 是產生出來的,不進版本控制。
   複製前會核對 samples/SHA256SUMS,檔案缺了或被改過就停下來,不會把壞的取樣打包出去。 */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.resolve(__dirname, ".."), src = path.resolve(root, "..", "index.html"), dir = path.join(root, "www");
const samples = path.join(root, "samples");

const sums = fs.readFileSync(path.join(samples, "SHA256SUMS"), "utf8").split("\n").filter(Boolean);
let bad = 0, bytes = 0;
for (const line of sums) {
  const [hash, rel] = line.split(/\s+\*?/);
  const f = path.join(samples, rel);
  if (!fs.existsSync(f)) { console.error("缺檔:", rel); bad++; continue; }
  const buf = fs.readFileSync(f); bytes += buf.length;
  if (crypto.createHash("sha256").update(buf).digest("hex") !== hash) { console.error("內容不符:", rel); bad++; }
}
if (bad) { console.error("取樣核對失敗 " + bad + " 個,已停止"); process.exit(1); }

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, path.join(dir, "index.html"));
fs.cpSync(samples, path.join(dir, "samples"), { recursive: true, filter: p => !p.endsWith("SHA256SUMS") });
console.log("已複製 index.html(" + fs.statSync(src).size + " bytes)與 " + sums.length + " 個取樣(" + (bytes / 1048576).toFixed(1) + " MB)→ " + dir);
