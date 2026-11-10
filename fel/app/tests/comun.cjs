// Utilidades compartidas por las pruebas de interfaz: servidor estático local y arranque del navegador.
const http = require("http"), fs = require("fs"), path = require("path");
const RAIZ = path.resolve(__dirname, "..");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function servirEstaticos() {
  const servidor = http.createServer((req, res) => {
    const f = path.join(RAIZ, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+$/, "/index.html"));
    if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TIPOS[path.extname(f)] ?? "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => servidor.listen(0, "127.0.0.1", () => ok({ servidor, base: `http://127.0.0.1:${servidor.address().port}/` })));
}
module.exports = { RAIZ, servirEstaticos };
