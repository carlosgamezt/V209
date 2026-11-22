#!/usr/bin/env python3
"""Pruebas locales (sin red, sin credenciales) de la vista previa de NEXA con acceso a NEXA FEL.
   Uso:  python3 pruebas-fel-nexa/vista-previa/test.py      (desde la raíz del repositorio; necesita PyYAML, bash, node y Playwright)
   A. preparar.py: URL válidas e inválidas, etiqueta, inserción de UNA línea, nexa/ intacto, FEL apagado sin URL.
   B. verificar-destino.sh con un «curl» falso: solo pasa si el proyecto es nexacorp, la producción es main y la vista previa es otra rama; el token no se imprime.
   C. Guardianes del workflow (con mutaciones: cada una debe hacer fallar el guardián).
   D. La copia preparada, cargada en un navegador: con URL, felCfg() la acepta; sin URL, FEL queda deshabilitado."""
import copy, json, os, re, shutil, subprocess, sys, tempfile, textwrap
import yaml

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VP = os.path.join(RAIZ, "pruebas-fel-nexa", "vista-previa")
WF = os.path.join(RAIZ, ".github", "workflows", "preview-nexa-fel.yml")
fallos = 0
def ok(m): print("OK    " + m)
def mal(m, extra=""):
    global fallos; fallos += 1; print("FALLO " + m); extra and print("      " + extra)
def prueba(c, m, extra=""): ok(m) if c else mal(m, extra)
def sh(args, env=None, cwd=None):
    r = subprocess.run(args, capture_output=True, text=True, env=env, cwd=cwd); return r.returncode, (r.stdout + r.stderr)

# ------------------------------------------------------------------------------------------------ A. preparar.py
print("== A. preparar.py")
T = tempfile.mkdtemp(prefix="vp-");
def preparar(*a, nombre="d"):
    destino = os.path.join(T, nombre + str(len(os.listdir(T))))
    rc, out = sh([sys.executable, os.path.join(VP, "preparar.py"), "--origen", os.path.join(RAIZ, "nexa"), "--destino", destino, *a]); return rc, out, destino
orig_html = open(os.path.join(RAIZ, "nexa", "index.html"), encoding="utf-8").read()
orig_hash = subprocess.run(["git", "-C", RAIZ, "status", "--porcelain", "--", "nexa"], capture_output=True, text=True).stdout
rc, out, d = preparar()
prueba(rc == 0 and "DESHABILITADO" in out, "sin URL: FEL queda DESHABILITADO", out)
h0 = open(os.path.join(d, "index.html"), encoding="utf-8").read()
prueba(h0 == orig_html and "\nwindow.PA_CONFIG.fel = " not in h0, "sin URL: index.html es idéntico al de nexa/ (no se añade nada)")
prueba(json.load(open(os.path.join(d, "version.json"))) == {"v": re.search(r"APP_VER='(v\d+)'", orig_html).group(1)}, "version.json se genera desde APP_VER (como deploy-nexa.yml)")
FEL = "https://nexa-fel-demo.pages.dev/"
rc, out, d = preparar("--fel-url", FEL, "--etiqueta", "Pruebas")
h1 = open(os.path.join(d, "index.html"), encoding="utf-8").read()
prueba(rc == 0 and "HABILITADO" in out and h1.count("\nwindow.PA_CONFIG.fel = ") == 1, "con URL válida: se añade UNA sola línea de configuración", out)
linea = re.search(r"\nwindow\.PA_CONFIG\.fel = (\{.*?\});", h1)
prueba(linea and json.loads(linea.group(1)) == {"url": FEL, "etiqueta": "Pruebas"}, "la línea contiene exactamente la URL y la etiqueta indicadas")
prueba(h1.replace(linea.group(0), "", 1) == orig_html, "quitando esa línea, index.html es idéntico al de nexa/")
cfg_ori = re.search(r"window\.PA_CONFIG\s*=\s*\{[^}]*\};", orig_html).group(0); prueba(cfg_ori in h1, "el objeto PA_CONFIG original (Supabase de NEXA) no se altera")
prueba(subprocess.run(["git", "-C", RAIZ, "status", "--porcelain", "--", "nexa"], capture_output=True, text=True).stdout == orig_hash, "nexa/ del repositorio NO se modificó")
for f in ("sw.js", "manifest.webmanifest", "_headers", "config.js", "supabase.js"):
    prueba(open(os.path.join(d, f), "rb").read() == open(os.path.join(RAIZ, "nexa", f), "rb").read(), f"{f} es idéntico al de nexa/")
malas = ["http://nexa-fel-demo.pages.dev/", "https://evil.example.com/", "javascript:alert(1)", "https://u:p@nexa-fel-demo.pages.dev/", "https://nexa-fel-demo.pages.dev:8443/",
         "https://nexa-fel-demo.pages.dev.evil.com/", "https://nexa-fel-demo.pages.dev/ruta", "https://nexa-fel-demo.pages.dev/?x=1", "https://nexa-fel-demo.pages.dev/#x", "https://pages.dev/",
         "https://-malo.pages.dev/", "ftp://x.pages.dev/", "https://nexa fel.pages.dev/", "//nexa-fel-demo.pages.dev/", "https://nexa-fel-demo.pages.dev:443/"]
for u in malas:
    rc, out, d2 = preparar("--fel-url", u)
    prueba(rc == 2 and "PROHIBIDO" in out and not os.path.exists(d2), f"URL rechazada y sin copia: {u}", out)
for e in ["", "x" * 41, "<b>", 'a"b', "a;b"]:
    rc, out, d2 = preparar("--fel-url", FEL, "--etiqueta", e); prueba(rc == 2, f"etiqueta rechazada: {e[:12]!r}", out)
rc, _ = sh([sys.executable, os.path.join(VP, "preparar.py"), "--origen", os.path.join(RAIZ, "nexa"), "--destino", os.path.join(RAIZ, "nexa", "dentro")])
prueba(rc == 2 and not os.path.exists(os.path.join(RAIZ, "nexa", "dentro")), "un destino dentro de nexa/ se rechaza")
rc, out = sh([sys.executable, os.path.join(VP, "preparar.py"), "--origen", os.path.join(RAIZ, "nexa"), "--destino", d]); prueba(rc == 2, "un destino que ya existe se rechaza", out)
rc, out, d4 = preparar("--fel-url", "https://Nexa-Fel-Demo.PAGES.dev", "--etiqueta", "Demostración"); prueba(rc == 0 and FEL in open(os.path.join(d4, "index.html"), encoding="utf-8").read(), "mayúsculas y sin barra final se normalizan a la URL canónica", out)

# ------------------------------------------------------------------------------------------------ B. verificar-destino.sh con curl falso
print("== B. verificar-destino.sh")
FAKE = os.path.join(T, "bin"); os.makedirs(FAKE)
open(os.path.join(FAKE, "curl"), "w").write(textwrap.dedent("""\
    #!/usr/bin/env bash
    # curl FALSO: lee la configuración por stdin (-K -), escribe el cuerpo en -o y el código en -w
    out=""; args=("$@"); for ((i=0;i<${#args[@]};i++)); do [ "${args[$i]}" = "-o" ] && out="${args[$((i+1))]}"; done
    cat >/dev/null; echo "$@" >> "$REG"
    [ -n "${FAKE_CURL_RC:-}" ] && exit "$FAKE_CURL_RC"
    printf '%s' "${FAKE_CUERPO:-}" > "$out"; printf '%s' "${FAKE_CODIGO:-200}"
    """)); os.chmod(os.path.join(FAKE, "curl"), 0o755)
REG = os.path.join(T, "reg.txt"); TOKEN = "TOKEN-FALSO-NO-IMPRIMIR-123"; CUENTA = "0123456789abcdef0123456789abcdef"
def dest(proyecto="nexacorp", rama="fel-nexa-acceso", cuerpo=None, codigo="200", rc="", token=TOKEN, cuenta=CUENTA):
    env = {"PATH": FAKE + ":" + os.environ["PATH"], "REG": REG, "FAKE_CUERPO": cuerpo or "", "FAKE_CODIGO": codigo, "FAKE_CURL_RC": rc}
    if token: env["CLOUDFLARE_API_TOKEN"] = token
    if cuenta: env["CLOUDFLARE_ACCOUNT_ID"] = cuenta
    open(REG, "w").close(); r, o = sh(["bash", os.path.join(VP, "verificar-destino.sh"), proyecto, rama], env=env); return r, o
def cuerpo(nombre="nexacorp", prod="main", exito=True): return json.dumps({"success": exito, "result": {"name": nombre, "production_branch": prod}})
r, o = dest(cuerpo=cuerpo()); prueba(r == 0 and "OK" in o and "no toca el dominio de producción" in o, "nexacorp con producción = main y vista previa = fel-nexa-acceso → se acepta", o)
prueba(TOKEN not in o and TOKEN not in open(REG).read(), "el token no aparece en la salida ni en los argumentos de curl")
prueba("-X GET" in open(REG).read() and "pages/projects/nexacorp" in open(REG).read() and not re.search(r"-X (POST|PUT|PATCH|DELETE)", open(REG).read()), "una sola petición, un GET, al proyecto nexacorp (nada se modifica)")
for desc, kw, esperado in [("la producción del proyecto NO es main (es «master»)", dict(cuerpo=cuerpo(prod="master")), 2), ("la producción ES la rama de la vista previa", dict(cuerpo=cuerpo(prod="fel-nexa-acceso")), 2),
        ("el proyecto devuelto tiene otro nombre", dict(cuerpo=cuerpo(nombre="otro")), 2), ("la API responde success=false", dict(cuerpo=cuerpo(exito=False)), 3), ("la API responde 401", dict(cuerpo="{}", codigo="401"), 3),
        ("la API responde 404", dict(cuerpo="{}", codigo="404"), 3), ("la API responde 500", dict(cuerpo="{}", codigo="500"), 3), ("curl falla (red)", dict(rc="7"), 3), ("respuesta ilegible", dict(cuerpo="no es json"), 3),
        ("respuesta sin result", dict(cuerpo=json.dumps({"success": True})), 3), ("sin token", dict(cuerpo=cuerpo(), token=""), 2), ("sin cuenta", dict(cuerpo=cuerpo(), cuenta=""), 2),
        ("cuenta con formato inválido", dict(cuerpo=cuerpo(), cuenta="no-es-hex"), 2), ("proyecto «nexa»", dict(proyecto="nexa", cuerpo=cuerpo(nombre="nexa")), 2), ("proyecto de FEL «nexa-fel-demo»", dict(proyecto="nexa-fel-demo", cuerpo=cuerpo(nombre="nexa-fel-demo")), 2),
        ("rama de vista previa «main»", dict(rama="main", cuerpo=cuerpo()), 2), ("rama de vista previa distinta de fel-nexa-acceso", dict(rama="otra", cuerpo=cuerpo()), 2)]:
    r, o = dest(**kw); prueba(r == esperado and "OK  destino" not in o and TOKEN not in o, f"{desc} → se rechaza (código {esperado})", o)

# ------------------------------------------------------------------------------------------------ C. guardianes del workflow + mutaciones
print("== C. guardianes del workflow")
def guardian(texto):
    """Devuelve la lista de problemas del workflow (vacía si cumple)."""
    p = []
    try: w = yaml.safe_load(texto)
    except Exception as e: return ["YAML ilegible: " + str(e)]
    on = w.get(True, w.get("on")) or {}
    if set(on) != {"push", "workflow_dispatch"}: p.append("los disparadores deben ser solo push (registro) y workflow_dispatch")
    pu = on.get("push") or {}
    if pu.get("branches") != ["fel-nexa-acceso"] or pu.get("paths") != [".github/workflows/preview-nexa-fel.yml"]: p.append("el push de registro debe limitarse a la rama fel-nexa-acceso y a este archivo")
    if w.get("permissions") != {"contents": "read"}: p.append("permissions debe ser solo contents: read")
    jobs = w.get("jobs") or {}
    if list(jobs) != ["vista-previa"]: p.append("debe haber un único trabajo «vista-previa»"); return p
    j = jobs["vista-previa"]; cond = str(j.get("if", ""))
    for t in ("github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/fel-nexa-acceso'", "inputs.confirmar == 'VISTA PREVIA'"):
        if t not in cond: p.append("falta en la condición del trabajo: " + t)
    if "environment" in j: p.append("no debe usar entornos (ni secretos de ellos)")
    pasos = j.get("steps") or []; ac = [s.get("uses") for s in pasos if s.get("uses")]
    if ac != ["actions/checkout@v4", "cloudflare/wrangler-action@v3"]: p.append("acciones permitidas: solo actions/checkout@v4 y cloudflare/wrangler-action@v3 (encontradas: %s)" % ac)
    deploy = [s for s in pasos if s.get("uses") == "cloudflare/wrangler-action@v3"]
    if len(deploy) != 1: return p + ["debe haber un único paso de despliegue"]
    cmd = str(deploy[0].get("with", {}).get("command", ""))
    if not re.fullmatch(r"pages deploy \$\{\{ runner\.temp \}\}/nexa-vista-previa --project-name=nexacorp --branch=fel-nexa-acceso --commit-dirty=true", cmd): p.append("el comando de despliegue debe ser exactamente el de vista previa (rama fel-nexa-acceso, proyecto nexacorp): " + cmd)
    if re.search(r"--branch=(main|master|production)|--branch=\$|--project-name=\$|--project-name=nexa\b(?!corp)", textwrap.dedent(texto)): p.append("rama o proyecto de producción / dinámico en un comando")
    nombres = [s.get("name", "") for s in pasos]; orden = [i for i, n in enumerate(nombres) if n.startswith("Verificar el destino")] + [i for i, n in enumerate(nombres) if n.startswith("Preparar")] + [i for i, n in enumerate(nombres) if n.startswith("Publicar")]
    if len(orden) != 3 or orden != sorted(orden): p.append("el orden debe ser: verificar destino → preparar → publicar")
    vd = [s for s in pasos if s.get("name", "").startswith("Verificar el destino")]
    if len(vd) != 1 or str(vd[0].get("run", "")).strip() != "bash pruebas-fel-nexa/vista-previa/verificar-destino.sh nexacorp fel-nexa-acceso": p.append("el paso «Verificar el destino» debe ejecutar exactamente verificar-destino.sh nexacorp fel-nexa-acceso")
    pp = [s for s in pasos if s.get("name", "").startswith("Preparar")]
    if len(pp) != 1 or not str(pp[0].get("run", "")).startswith("python3 pruebas-fel-nexa/vista-previa/preparar.py --origen nexa --destino"): p.append("el paso «Preparar» debe ejecutar preparar.py con origen nexa")
    sec = set(re.findall(r"secrets\.([A-Za-z0-9_]+)", texto))
    if sec != {"CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"}: p.append("solo pueden usarse los secretos CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID (encontrados: %s)" % sorted(sec))
    ejec = "\n".join(str(s.get("run", "")) + str(s.get("with", "")) + str(s.get("env", "")) for s in pasos)
    for prohibido in ("supabase", "SUPABASE", "db push", "migra", "aprovisionar", "DEMO_", "digifact", "DIGIFACT", "certific", "publicar-nube", "functions deploy", "secrets set"):
        if prohibido in ejec: p.append("el trabajo no puede mencionar: " + prohibido)
    for s in pasos:
        if "run" in s and re.search(r"\$\{\{\s*(inputs|github\.event)", str(s["run"])): p.append("un paso run interpola entradas directamente (usa env): " + s.get("name", ""))
    return p
txt = open(WF, encoding="utf-8").read()
prueba(guardian(txt) == [], "el workflow cumple todos los guardianes", "; ".join(guardian(txt)))
muts = [("añadir un disparador pull_request", lambda t: t.replace("on:\n  push:", "on:\n  pull_request:\n  push:")),
        ("el push de registro sin limitar a la rama", lambda t: t.replace("    branches: [fel-nexa-acceso]\n", "")),
        ("el push de registro desde main", lambda t: t.replace("branches: [fel-nexa-acceso]", "branches: [main]")),
        ("desplegar con --branch=main", lambda t: t.replace("--branch=fel-nexa-acceso --commit-dirty", "--branch=main --commit-dirty")),
        ("desplegar al proyecto nexa", lambda t: t.replace("--project-name=nexacorp --branch", "--project-name=nexa --branch")),
        ("quitar la guarda de rama", lambda t: t.replace(" && github.ref == 'refs/heads/fel-nexa-acceso'", "")),
        ("quitar la confirmación", lambda t: t.replace(" && inputs.confirmar == 'VISTA PREVIA'", "")),
        ("permisos de escritura", lambda t: t.replace("contents: read", "contents: write")),
        ("usar un secreto DEMO_", lambda t: t.replace("secrets.CLOUDFLARE_ACCOUNT_ID }}\n        run", "secrets.CLOUDFLARE_ACCOUNT_ID }}\n          X: ${{ secrets.DEMO_BD_URL }}\n        run", 1)),
        ("mencionar supabase en un paso", lambda t: t.replace('        run: |\n          echo "Vista previa publicada', '        run: |\n          supabase db push\n          echo "Vista previa publicada')),
        ("añadir una acción ajena", lambda t: t.replace("      - uses: actions/checkout@v4", "      - uses: actions/cache@v4\n      - uses: actions/checkout@v4", 1)),
        ("saltar la verificación del destino", lambda t: t.replace("run: bash pruebas-fel-nexa/vista-previa/verificar-destino.sh nexacorp fel-nexa-acceso", "run: echo omitido")),
        ("interpolar la entrada en un run", lambda t: t.replace('--fel-url "$FEL_URL"', '--fel-url "${{ inputs.fel_url }}"')),
        ("usar un entorno", lambda t: t.replace("    runs-on: ubuntu-latest\n    timeout-minutes: 10", "    runs-on: ubuntu-latest\n    environment: produccion\n    timeout-minutes: 10"))]
for n, f in muts:
    t2 = f(txt); prueba(t2 != txt and guardian(t2) != [], f"mutación detectada: {n}", "la mutación no cambió el texto" if t2 == txt else "el guardián no la detectó")

# ------------------------------------------------------------------------------------------------ D. la copia preparada en un navegador
print("== D. la copia preparada en un navegador (felCfg)")
E2E = r"""
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const [conUrl, sinUrl] = process.argv.slice(2);
const srv = (root) => new Promise((res) => { const s = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = path.join(root, u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1', () => res({ s, url: 'http://127.0.0.1:' + s.address().port + '/' })); });
(async () => { const b = await chromium.launch(); const out = {};
  for (const [k, root] of [['con', conUrl], ['sin', sinUrl]]) { const s = await srv(root); const ctx = await b.newContext(); await ctx.route((u) => !['127.0.0.1'].includes(u.hostname), (r) => r.abort());
    const pg = await ctx.newPage(); await pg.goto(s.url); await pg.waitForTimeout(1500);
    out[k] = await pg.evaluate(() => ({ cfg: typeof felCfg === 'function' ? felCfg() : 'sin función', fel: (window.PA_CONFIG || {}).fel || null, supa: !!((window.PA_CONFIG || {}).url) }));
    await ctx.close(); s.s.close(); }
  await b.close(); console.log(JSON.stringify(out)); })();
"""
rc, o, dcon = preparar("--fel-url", FEL, "--etiqueta", "Pruebas"); rc2, o2, dsin = preparar()
open(os.path.join(T, "e2e.cjs"), "w").write(E2E)
env = dict(os.environ); env["NODE_PATH"] = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip() + os.pathsep + os.path.join(RAIZ, "node_modules")
r = subprocess.run(["node", os.path.join(T, "e2e.cjs"), dcon, dsin], capture_output=True, text=True, env=env, cwd=RAIZ)
try: res = json.loads(r.stdout.strip().splitlines()[-1])
except Exception: res = None; mal("no se pudo ejecutar la comprobación en el navegador", (r.stdout + r.stderr)[-300:])
if res:
    prueba(res["con"]["cfg"] == {"url": FEL, "et": "Pruebas"}, "con URL: felCfg() de la página acepta la URL y la etiqueta", json.dumps(res["con"]))
    prueba(res["sin"]["cfg"] is None and res["sin"]["fel"] is None, "sin URL: NEXA FEL queda deshabilitado (felCfg() es nulo)", json.dumps(res["sin"]))
    prueba(res["con"]["supa"] and res["sin"]["supa"], "la configuración de Supabase de NEXA sigue intacta en ambas copias")

shutil.rmtree(T, ignore_errors=True)
print(f"{fallos} fallo(s)" if fallos else "VISTA PREVIA DE NEXA CON ACCESO A NEXA FEL: OK")
sys.exit(1 if fallos else 0)
