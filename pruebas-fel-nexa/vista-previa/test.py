#!/usr/bin/env python3
"""Pruebas locales (sin red, sin credenciales) de la vista previa de NEXA con acceso a NEXA FEL.
   Uso:  python3 pruebas-fel-nexa/vista-previa/test.py      (desde la raíz del repositorio; necesita PyYAML, bash, node y Playwright)
   A. preparar.py: copia idéntica (sin inyectar nada), se niega a preparar versiones con la regla anterior o con otra URL de FEL, nexa/ intacto.
   B. verificar-destino.sh con un «curl» falso: solo pasa si el proyecto es nexacorp, la producción es main y la vista previa es otra rama; el token no se imprime.
   C. Guardianes del workflow (con mutaciones: cada una debe hacer fallar el guardián).
   D. La copia preparada, cargada en un navegador: URL de FEL de la aplicación, sin configuración inyectada, y FEL oculto sin sesión."""
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
T = tempfile.mkdtemp(prefix="vp-"); FEL = "https://nexa-fel-demo.pages.dev/"
def preparar(origen=None, nombre="d"):
    destino = os.path.join(T, nombre + str(len(os.listdir(T))))
    rc, out = sh([sys.executable, os.path.join(VP, "preparar.py"), "--origen", origen or os.path.join(RAIZ, "nexa"), "--destino", destino]); return rc, out, destino
orig_html = open(os.path.join(RAIZ, "nexa", "index.html"), encoding="utf-8").read()
estado_git = subprocess.run(["git", "-C", RAIZ, "status", "--porcelain", "--", "nexa"], capture_output=True, text=True).stdout
rc, out, d = preparar()
prueba(rc == 0 and "sin cambios" in out, "la versión actual de nexa/ se prepara correctamente", out)
prueba(open(os.path.join(d, "index.html"), encoding="utf-8").read() == orig_html, "index.html de la copia es IDÉNTICO al de nexa/ (ya no se inyecta nada)")
prueba(json.load(open(os.path.join(d, "version.json"))) == {"v": re.search(r"APP_VER='(v\d+)'", orig_html).group(1)}, "version.json se genera desde APP_VER (como deploy-nexa.yml)")
for f in ("sw.js", "manifest.webmanifest", "_headers", "config.js", "supabase.js"):
    prueba(open(os.path.join(d, f), "rb").read() == open(os.path.join(RAIZ, "nexa", f), "rb").read(), f"{f} es idéntico al de nexa/")
prueba(subprocess.run(["git", "-C", RAIZ, "status", "--porcelain", "--", "nexa"], capture_output=True, text=True).stdout == estado_git, "nexa/ del repositorio NO se modificó")
prueba("PA_CONFIG.fel =" not in open(os.path.join(d, "index.html"), encoding="utf-8").read(), "la copia no lleva ninguna línea PA_CONFIG.fel inyectada")
# se niega a preparar versiones con la regla anterior o con otro destino de FEL
def variante(f):
    carpeta = os.path.join(T, "var" + str(len(os.listdir(T)))); shutil.copytree(os.path.join(RAIZ, "nexa"), carpeta)
    h = open(os.path.join(carpeta, "index.html"), encoding="utf-8").read(); h2 = f(h); assert h2 != h; open(os.path.join(carpeta, "index.html"), "w", encoding="utf-8").write(h2); return carpeta
for desc, f in [("sin la consulta nx_fel_autorizado (versión anterior)", lambda h: h.replace("nx_fel_autorizado", "nx_otra_cosa")),
                ("con la regla anterior que lee PA_CONFIG.fel", lambda h: h.replace("function felCfg(){", "function felCfg(){var _x=window.PA_CONFIG&&PA_CONFIG.fel&&PA_CONFIG.fel.url;", 1)),
                ("con felVis() dependiente del rol", lambda h: h.replace("function felVis(){const u=felUid();", "function felVis(){const u=felUid();if(me.role==='admin')return true;", 1)),
                ("con otra URL de FEL", lambda h: h.replace("url:'https://nexa-fel-demo.pages.dev/'", "url:'https://otro.pages.dev/'")),
                ("con la URL de FEL duplicada", lambda h: h.replace("const FEL_CFG=", "const FEL_X={url:'https://nexa-fel-demo.pages.dev/'};const FEL_CFG=", 1))]:
    rc, out, d2 = preparar(variante(f)); prueba(rc == 2 and "PROHIBIDO" in out and not os.path.exists(d2), f"se niega a preparar una versión {desc}", out)
rc, out, d3 = preparar(os.path.join(T, "no-existe")); prueba(rc == 2, "un origen sin index.html se rechaza", out)
rc, _ = sh([sys.executable, os.path.join(VP, "preparar.py"), "--origen", os.path.join(RAIZ, "nexa"), "--destino", os.path.join(RAIZ, "nexa", "dentro")])
prueba(rc == 2 and not os.path.exists(os.path.join(RAIZ, "nexa", "dentro")), "un destino dentro de nexa/ se rechaza")
rc, out = sh([sys.executable, os.path.join(VP, "preparar.py"), "--origen", os.path.join(RAIZ, "nexa"), "--destino", d]); prueba(rc == 2, "un destino que ya existe se rechaza", out)
rc, out = sh([sys.executable, os.path.join(VP, "preparar.py"), "--origen", os.path.join(RAIZ, "nexa"), "--destino", os.path.join(T, "x"), "--fel-url", "https://nexa-fel-demo.pages.dev/"])
prueba(rc != 0, "ya no existe la opción --fel-url (no se puede inyectar una URL de FEL)", out)

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
def cuerpo(nombre="nexacorp", prod="main", exito=True, doms=("nexacorp.pages.dev", "app.ejemplo.com")): return json.dumps({"success": exito, "result": {"name": nombre, "production_branch": prod, "domains": list(doms)}})
r, o = dest(cuerpo=cuerpo()); prueba(r == 0 and "OK" in o and "no toca el dominio de producción" in o, "nexacorp con producción = main y vista previa = fel-nexa-acceso → se acepta", o)
prueba("2 dominios de producción" in o, "informa cuántos dominios de producción tiene el proyecto y que la vista previa no coincide con ninguno", o)
prueba(TOKEN not in o and TOKEN not in open(REG).read(), "el token no aparece en la salida ni en los argumentos de curl")
prueba("-X GET" in open(REG).read() and "pages/projects/nexacorp" in open(REG).read() and not re.search(r"-X (POST|PUT|PATCH|DELETE)", open(REG).read()), "una sola petición, un GET, al proyecto nexacorp (nada se modifica)")
for desc, kw, esperado in [("la producción del proyecto NO es main (es «master»)", dict(cuerpo=cuerpo(prod="master")), 2), ("la producción ES la rama de la vista previa", dict(cuerpo=cuerpo(prod="fel-nexa-acceso")), 2),
        ("el proyecto devuelto tiene otro nombre", dict(cuerpo=cuerpo(nombre="otro")), 2), ("la API responde success=false", dict(cuerpo=cuerpo(exito=False)), 3), ("la API responde 401", dict(cuerpo="{}", codigo="401"), 3),
        ("la API responde 404", dict(cuerpo="{}", codigo="404"), 3), ("la API responde 500", dict(cuerpo="{}", codigo="500"), 3), ("curl falla (red)", dict(rc="7"), 3), ("respuesta ilegible", dict(cuerpo="no es json"), 3),
        ("respuesta sin result", dict(cuerpo=json.dumps({"success": True})), 3), ("sin token", dict(cuerpo=cuerpo(), token=""), 2), ("sin cuenta", dict(cuerpo=cuerpo(), cuenta=""), 2),
        ("cuenta con formato inválido", dict(cuerpo=cuerpo(), cuenta="no-es-hex"), 2), ("proyecto «nexa»", dict(proyecto="nexa", cuerpo=cuerpo(nombre="nexa")), 2), ("proyecto de FEL «nexa-fel-demo»", dict(proyecto="nexa-fel-demo", cuerpo=cuerpo(nombre="nexa-fel-demo")), 2),
        ("la dirección de la vista previa coincide con un dominio de producción", dict(cuerpo=cuerpo(doms=("nexacorp.pages.dev", "fel-nexa-acceso.nexacorp.pages.dev"))), 2), ("un dominio de producción empieza por la rama de vista previa", dict(cuerpo=cuerpo(doms=("fel-nexa-acceso.ejemplo.com",))), 2), ("los dominios no son una lista", dict(cuerpo=json.dumps({"success": True, "result": {"name": "nexacorp", "production_branch": "main", "domains": "x"}})), 2),
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
    if cmd != "pages deploy nexa-vista-previa --project-name=nexacorp --branch=fel-nexa-acceso --commit-dirty=true": p.append("el comando de despliegue debe ser exactamente «pages deploy» de vista previa (rama fel-nexa-acceso, proyecto de Pages nexacorp; nunca el Worker «nexa»): " + cmd)
    if str(deploy[0].get("with", {}).get("workingDirectory", "")) != "${{ runner.temp }}": p.append("wrangler debe ejecutarse fuera del repositorio (workingDirectory = runner.temp) para no usar el wrangler.jsonc del Worker «nexa»")
    if list(((on.get("workflow_dispatch") or {}).get("inputs") or {})) != ["confirmar"]: p.append("el único dato de entrada debe ser «confirmar» (ya no se pasa ninguna URL de FEL ni configuración)")
    if re.search(r"--branch=(main|master|production)|--branch=\$|--project-name=\$|--project-name=nexa\b(?!corp)", textwrap.dedent(texto)): p.append("rama o proyecto de producción / dinámico en un comando")
    nombres = [s.get("name", "") for s in pasos]; orden = [i for i, n in enumerate(nombres) if n.startswith("Verificar el destino")] + [i for i, n in enumerate(nombres) if n.startswith("Preparar")] + [i for i, n in enumerate(nombres) if n.startswith("Publicar")]
    if len(orden) != 3 or orden != sorted(orden): p.append("el orden debe ser: verificar destino → preparar → publicar")
    vd = [s for s in pasos if s.get("name", "").startswith("Verificar el destino")]
    if len(vd) != 1 or str(vd[0].get("run", "")).strip() != "bash pruebas-fel-nexa/vista-previa/verificar-destino.sh nexacorp fel-nexa-acceso": p.append("el paso «Verificar el destino» debe ejecutar exactamente verificar-destino.sh nexacorp fel-nexa-acceso")
    pp = [s for s in pasos if s.get("name", "").startswith("Preparar")]
    if len(pp) != 1 or str(pp[0].get("run", "")).strip() != 'python3 pruebas-fel-nexa/vista-previa/preparar.py --origen nexa --destino "$RUNNER_TEMP/nexa-vista-previa"' or pp[0].get("env"): p.append("el paso «Preparar» debe ejecutar exactamente preparar.py con origen nexa, sin entradas ni variables")
    sec = set(re.findall(r"secrets\.([A-Za-z0-9_]+)", texto))
    if sec != {"CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"}: p.append("solo pueden usarse los secretos CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID (encontrados: %s)" % sorted(sec))
    ejec = "\n".join(str(s.get("run", "")) + str(s.get("with", "")) + str(s.get("env", "")) for s in pasos)
    if re.search(r"wrangler[ -]+deploy|--name[= ]|\bdeploy\b(?<!pages deploy)", cmd.replace("pages deploy", "")): p.append("solo se permite «pages deploy» (no el despliegue de Workers)")
    for prohibido in ("supabase", "SUPABASE", "db push", "migra", "aprovisionar", "DEMO_", "digifact", "DIGIFACT", "certific", "publicar-nube", "functions deploy", "secrets set"):
        if prohibido in ejec: p.append("el trabajo no puede mencionar: " + prohibido)
    for s in pasos:
        if "run" in s and re.search(r"\$\{\{\s*(inputs|github\.event)", str(s["run"])): p.append("un paso run interpola entradas directamente (usa env): " + s.get("name", ""))
    return p
txt = open(WF, encoding="utf-8").read()
prueba(guardian(txt) == [], "el workflow cumple todos los guardianes", "; ".join(guardian(txt)))
muts = [("volver a pasar la URL de FEL al preparar", lambda t: t.replace('--destino "$RUNNER_TEMP/nexa-vista-previa"\n', '--destino "$RUNNER_TEMP/nexa-vista-previa" --fel-url "https://nexa-fel-demo.pages.dev/"\n', 1)),
        ("volver a añadir la entrada fel_url", lambda t: t.replace("      confirmar:\n", "      fel_url:\n        type: string\n        default: ''\n      confirmar:\n", 1)),
        ("añadir un disparador pull_request", lambda t: t.replace("on:\n  push:", "on:\n  pull_request:\n  push:")),
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
        ("interpolar una entrada en un run", lambda t: t.replace("run: echo omitido", "run: echo omitido") if False else t.replace('run: python3 pruebas-fel-nexa/vista-previa/preparar.py', 'run: echo "${{ inputs.confirmar }}" && python3 pruebas-fel-nexa/vista-previa/preparar.py')),
        ("desplegar como Worker (wrangler deploy)", lambda t: t.replace("command: pages deploy nexa-vista-previa", "command: deploy nexa-vista-previa")),
        ("apuntar al Worker con --name=nexa", lambda t: t.replace("--commit-dirty=true\n      - name: \"Resumen\"", "--commit-dirty=true --name=nexa\n      - name: \"Resumen\"")),
        ("quitar workingDirectory (usaría el wrangler.jsonc del Worker)", lambda t: t.replace("          workingDirectory: ${{ runner.temp }}\n", "")),
        ("usar un entorno", lambda t: t.replace("    runs-on: ubuntu-latest\n    timeout-minutes: 10", "    runs-on: ubuntu-latest\n    environment: produccion\n    timeout-minutes: 10"))]
for n, f in muts:
    t2 = f(txt); prueba(t2 != txt and guardian(t2) != [], f"mutación detectada: {n}", "la mutación no cambió el texto" if t2 == txt else "el guardián no la detectó")

# ------------------------------------------------------------------------------------------------ D. la copia preparada en un navegador
print("== D. la copia preparada en un navegador")
E2E = r"""
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const srv = new Promise((res) => { const s = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = path.join(root, u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1', () => res(s)); });
(async () => { const s = await srv; const b = await chromium.launch(); const ctx = await b.newContext(); await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort());
  const pg = await ctx.newPage(); await pg.goto('http://127.0.0.1:' + s.address().port + '/'); await pg.waitForTimeout(1500);
  const o = await pg.evaluate(() => ({ cfg: felCfg(), vis: felVis(), fel: (window.PA_CONFIG || {}).fel || null, supa: !!((window.PA_CONFIG || {}).url), estado: FELACC.estado, titulo: document.title }));
  await b.close(); s.close(); console.log(JSON.stringify(o)); })();
"""
open(os.path.join(T, "e2e.cjs"), "w").write(E2E)
env = dict(os.environ); env["NODE_PATH"] = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip() + os.pathsep + os.path.join(RAIZ, "node_modules")
r = subprocess.run(["node", os.path.join(T, "e2e.cjs"), d], capture_output=True, text=True, env=env, cwd=RAIZ)
try: res = json.loads(r.stdout.strip().splitlines()[-1])
except Exception: res = None; mal("no se pudo ejecutar la comprobación en el navegador", (r.stdout + r.stderr)[-300:])
if res:
    prueba(res["cfg"] == {"url": FEL, "et": "Pruebas"} and res["fel"] is None, "la copia preparada: la URL de FEL es la de la aplicación y no hay configuración inyectada", json.dumps(res))
    prueba(res["vis"] is False and res["estado"] == "idle", "la copia preparada, sin sesión: NEXA FEL permanece oculto (la decisión es del servidor)", json.dumps(res))
    prueba(res["supa"], "la configuración de Supabase de NEXA sigue intacta")

shutil.rmtree(T, ignore_errors=True)
print(f"{fallos} fallo(s)" if fallos else "VISTA PREVIA DE NEXA CON ACCESO A NEXA FEL: OK")
sys.exit(1 if fallos else 0)
