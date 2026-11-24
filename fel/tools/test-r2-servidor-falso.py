#!/usr/bin/env python3
"""Servidor R2 FALSO para pruebas locales (solo 127.0.0.1). Verifica la firma SigV4 con su propia implementación, respeta If-None-Match: * y guarda los objetos en un directorio.
Uso: test-r2-servidor-falso.py <puerto> <directorio> <access-key-id> <secreto> <registro>   (si existe el archivo <directorio>/RECHAZA responde 403 a todo)"""
import hashlib, hmac, http.server, os, re, sys
PUERTO, DIR, KID, SECRETO, REG = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _reg(self, t):
        open(REG, "a").write(t + "\n")
    def _firma_ok(self, cuerpo_hash):
        a = self.headers.get("authorization", "")
        m = re.fullmatch(r"AWS4-HMAC-SHA256 Credential=([^/]+)/(\d{8})/auto/s3/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})", a)
        if not m or m[1] != KID: return False
        _, fecha, firmadas, sig = m.groups(); nombres = firmadas.split(";")
        if "host" not in nombres or "x-amz-content-sha256" not in nombres or "x-amz-date" not in nombres: return False
        if self.headers.get("x-amz-content-sha256") != cuerpo_hash: return False
        canon = "\n".join([self.command, self.path.split("?")[0], "", "".join(f"{k}:{self.headers.get(k, '').strip()}\n" for k in nombres), firmadas, cuerpo_hash])
        sello = self.headers.get("x-amz-date")
        a_firmar = "\n".join(["AWS4-HMAC-SHA256", sello, f"{fecha}/auto/s3/aws4_request", hashlib.sha256(canon.encode()).hexdigest()])
        k = ("AWS4" + SECRETO).encode()
        for p in (fecha, "auto", "s3", "aws4_request"): k = hmac.new(k, p.encode(), hashlib.sha256).digest()
        return hmac.compare_digest(hmac.new(k, a_firmar.encode(), hashlib.sha256).hexdigest(), sig)
    def _resp(self, cod, cuerpo=b"", cab=None):
        self.send_response(cod)
        for k, v in (cab or {}).items(): self.send_header(k, v)
        self.send_header("Content-Length", str(len(cuerpo)) if self.command != "HEAD" else str(len(cuerpo)))
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(cuerpo)
    def _archivo(self): return os.path.join(DIR, "objetos", self.path.lstrip("/").replace("/", "__"))
    def do_PUT(self):
        n = int(self.headers.get("content-length", "0")); cuerpo = self.rfile.read(n)
        if os.path.exists(os.path.join(DIR, "RECHAZA")): self._reg(f"PUT {self.path} 403-forzado"); return self._resp(403, b"<Error><Code>AccessDenied</Code></Error>")
        if not self._firma_ok(hashlib.sha256(cuerpo).hexdigest()): self._reg(f"PUT {self.path} 403-firma"); return self._resp(403, b"<Error><Code>SignatureDoesNotMatch</Code></Error>")
        if self.headers.get("if-none-match") != "*": self._reg(f"PUT {self.path} 400-sin-if-none-match"); return self._resp(400, b"falta If-None-Match")
        os.makedirs(os.path.join(DIR, "objetos"), exist_ok=True); f = self._archivo()
        if os.path.exists(f): self._reg(f"PUT {self.path} 412"); return self._resp(412, b"<Error><Code>PreconditionFailed</Code></Error>")
        open(f, "wb").write(cuerpo); self._reg(f"PUT {self.path} 200 {len(cuerpo)}"); self._resp(200, b"", {"ETag": '"' + hashlib.md5(cuerpo).hexdigest() + '"'})
    def do_HEAD(self):
        if os.path.exists(os.path.join(DIR, "RECHAZA")) or not self._firma_ok(hashlib.sha256(b"").hexdigest()): self._reg(f"HEAD {self.path} 403"); return self._resp(403)
        f = self._archivo()
        if not os.path.exists(f): self._reg(f"HEAD {self.path} 404"); return self._resp(404)
        c = open(f, "rb").read(); self._reg(f"HEAD {self.path} 200"); self.send_response(200); self.send_header("Content-Length", str(len(c))); self.send_header("ETag", '"' + hashlib.md5(c).hexdigest() + '"'); self.end_headers()
http.server.HTTPServer(("127.0.0.1", PUERTO), H).serve_forever()
