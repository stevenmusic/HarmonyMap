#!/usr/bin/env node
/* 把上一層的單檔 index.html 複製到 www/(Capacitor 的 webDir)。
   index.html 本身不動、不拆檔;www/ 是產生出來的,不進版本控制。 */
const fs = require("fs"), path = require("path");
const src = path.resolve(__dirname, "..", "..", "index.html"), dir = path.resolve(__dirname, "..", "www");
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, path.join(dir, "index.html"));
console.log("已複製 index.html →", path.join(dir, "index.html"), fs.statSync(src).size + " bytes");
