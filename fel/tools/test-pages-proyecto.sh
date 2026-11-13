#!/usr/bin/env bash
# Prueba (sin red externa ni cuenta real) de tools/pages-proyecto.sh con una API de Cloudflare simulada y un «wrangler» falso.
set -uo pipefail
S="$(cd "$(dirname "$0")" && pwd)/pages-proyecto.sh"; W=$(mktemp -d); PUERTO=${PUERTO:-8898}; fallos=0; ID=$(printf 'a%.0s' $(seq 32))
trap 'kill $SRV 2>/dev/null || true; rm -rf "$W"' EXIT
cat > "$W/servidor.py" <<'PY'
import http.server, json, os, sys
estado = {"existe": False}; llamadas = []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        ctl = json.load(open(os.environ["CTL"])); llamadas.append(self.path)
        if self.headers.get("Authorization") != "Bearer TOKEN-DE-PRUEBA": return self.responder(403, {"success": False})
        if ctl.get("forzar"): return self.responder(ctl["forzar"], {"success": False})
        nombre = self.path.rsplit("/", 1)[1]
        if os.path.exists(os.environ["MARCA"]): return self.responder(200, {"success": True, "result": {"name": nombre, "subdomain": ctl.get("subdominio", nombre) + ".pages.dev"}})
        return self.responder(404, {"success": False})
    def responder(self, c, j):
        b = json.dumps(j).encode(); self.send_response(c); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b)
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
export CTL="$W/ctl.json" MARCA="$W/existe"; echo '{}' > "$CTL"
cat > "$W/wrangler" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$LLAMADAS"; [ -n "${FALLA:-}" ] && { echo "error simulado" >&2; exit 1; }; touch "$MARCA"
SH
chmod +x "$W/wrangler"; export LLAMADAS="$W/llamadas.txt"
python3 "$W/servidor.py" "$PUERTO" & SRV=$!; sleep 1
base() { env PAGES_PROYECTO="$1" CLOUDFLARE_ACCOUNT_ID="$ID" CLOUDFLARE_API_TOKEN=TOKEN-DE-PRUEBA CLOUDFLARE_API_BASE="http://127.0.0.1:$PUERTO" WRANGLER_CMD="$W/wrangler" bash "$S"; }
ok() { echo "OK    $1"; }; mal() { echo "FALLO $1"; fallos=$((fallos+1)); }
rm -f "$MARCA" "$LLAMADAS"; echo '{}' > "$CTL"
S1=$(base nexa-fel-demo 2>&1); R=$?; [ $R = 0 ] && [ "$(tail -1 <<<"$S1")" = "HOST=nexa-fel-demo.pages.dev" ] && grep -q "pages project create nexa-fel-demo --production-branch main" "$LLAMADAS" && ok "no existe → se crea con Wrangler y se verifica" || { mal "creación"; echo "$S1"; }
rm -f "$LLAMADAS"; S2=$(base nexa-fel-demo 2>&1); R=$?; [ $R = 0 ] && [ ! -e "$LLAMADAS" ] && ok "ya existe → se reutiliza sin crear nada" || mal "reutilización"
rm -f "$MARCA" "$LLAMADAS"; echo '{"subdominio":"nexa-fel-demo-x7q"}' > "$CTL"; S3=$(base nexa-fel-demo 2>&1); [ "$(tail -1 <<<"$S3")" = "HOST=nexa-fel-demo-x7q.pages.dev" ] && ok "subdominio con sufijo (nombre ocupado en pages.dev): se usa el real" || { mal "subdominio"; echo "$S3"; }
rm -f "$MARCA" "$LLAMADAS"; echo '{}' > "$CTL"
for n in nexa nexacorp; do base $n >/dev/null 2>&1; [ $? = 2 ] && [ ! -e "$LLAMADAS" ] && ok "«$n» (proyecto principal) rechazado antes de cualquier llamada" || mal "$n aceptado"; done
for n in otro-proyecto nexa-fel-demo2 "NEXA-FEL-DEMO" "nexa-fel-demo/../nexa"; do base "$n" >/dev/null 2>&1; [ $? = 2 ] && ok "nombre «$n» rechazado" || mal "nombre «$n» aceptado"; done
echo '{"forzar":403}' > "$CTL"; rm -f "$LLAMADAS"; base nexa-fel-demo >/dev/null 2>&1; [ $? = 1 ] && [ ! -e "$LLAMADAS" ] && ok "token rechazado (403) → se detiene sin crear" || mal "403"
echo '{"forzar":500}' > "$CTL"; base nexa-fel-demo >/dev/null 2>&1; [ $? = 1 ] && [ ! -e "$LLAMADAS" ] && ok "respuesta inesperada (500) → se detiene sin crear" || mal "500"
echo '{}' > "$CTL"; rm -f "$MARCA" "$LLAMADAS"; FALLA=1 base nexa-fel-demo >/dev/null 2>&1; [ $? != 0 ] && ok "si Wrangler falla al crear, el script falla (no se oculta)" || mal "error oculto"
CLOUDFLARE_API_TOKEN=x PAGES_PROYECTO=nexa-fel-demo CLOUDFLARE_ACCOUNT_ID=corto bash "$S" >/dev/null 2>&1; [ $? = 2 ] && ok "id de cuenta con formato incorrecto rechazado" || mal "id de cuenta"
[ "$fallos" = 0 ] && echo "PROYECTO DE PAGES OK" || { echo "$fallos fallo(s)"; exit 1; }
