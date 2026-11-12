// A tiny local web server for looking at the Signals screen in a browser, without the desktop
// app and without a model. It only serves this project's own files to this computer:
//   node scripts/preview/server.js     then open http://localhost:4173/scripts/preview/
// The page it serves (index.html here) shows the real screen with Threads saved by earlier
// scorecard runs (docs/eval). Nothing is written anywhere. No extra packages are needed.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.PORT) || 4173;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".csv": "text/csv", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
};

http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end("Not allowed"); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": `${TYPES[path.extname(file)] ?? "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`Signals preview: http://localhost:${port}/scripts/preview/`));
