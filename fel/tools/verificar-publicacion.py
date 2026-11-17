#!/usr/bin/env python3
"""Garantías estáticas de la publicación privada (se ejecutan en el CI): ninguna ejecución automática puede publicar y los secretos de la demostración no se filtran a otros trabajos."""
import glob, re, sys, yaml
R = ".github/workflows/publicar-nube.yml"; DF = ".github/workflows/digifact-test.yml"; MG = ".github/workflows/migraciones-nube.yml"; fallos = []
def mal(m): fallos.append(m); print("FALLO", m)
def ok(m): print("OK   ", m)
def verificar_flujo(ruta, etiqueta, palabra, entrada, push_de_registro=False, pasos_con_secretos=1):
    """Las MISMAS garantías para todo flujo que recibe secretos DEMO_: solo manual, un trabajo, entorno protegido, rama fija, secretos aislados en un solo paso y confirmación explícita."""
    w = yaml.safe_load(open(ruta, encoding="utf-8").read()); disparo = w.get(True, w.get("on"))   # PyYAML lee «on» como True
    jobs = w["jobs"]
    if not push_de_registro:
        if set(disparo) == {"workflow_dispatch"}: ok(f"[{etiqueta}] solo se activa a mano (workflow_dispatch): sin push, pull_request, schedule, workflow_run ni repository_dispatch")
        else: mal(f"[{etiqueta}] disparadores no permitidos: {sorted(set(disparo) - {'workflow_dispatch'})}")
    else:
        # un «push» limitado a ESTE archivo solo sirve para registrar el flujo; el trabajo debe omitirse si el evento no es manual (así ese camino jamás recibe secretos ni pide aprobación)
        j0 = next(iter(jobs.values()))
        if set(disparo) == {"workflow_dispatch", "push"} and disparo["push"].get("paths") == [ruta] and not disparo["push"].get("branches") and "github.event_name == 'workflow_dispatch'" in str(j0.get("if", "")): ok(f"[{etiqueta}] solo se ejecuta a mano; el único «push» permitido es sobre este archivo y el trabajo se omite si el evento no es manual (solo registra el flujo)")
        else: mal(f"[{etiqueta}] disparadores no permitidos o el trabajo no se omite fuera del lanzamiento manual: {sorted(set(disparo))}")
    if len(jobs) == 1: ok(f"[{etiqueta}] un único trabajo")
    else: mal(f"[{etiqueta}] debe haber un único trabajo")
    j = next(iter(jobs.values()))
    if j.get("environment") == "demo-privada": ok(f"[{etiqueta}] el trabajo usa el entorno protegido «demo-privada» (aprobación obligatoria)")
    else: mal(f"[{etiqueta}] el trabajo debe usar environment: demo-privada")
    if "refs/heads/fel-proveedores-diseno" in str(j.get("if", "")): ok(f"[{etiqueta}] solo corre desde la rama fel-proveedores-diseno")
    else: mal(f"[{etiqueta}] falta la restricción de rama")
    texto = open(ruta, encoding="utf-8").read()
    nombres = re.findall(r"secrets\.([A-Za-z0-9_]+)", texto)
    if nombres and all(n.startswith("DEMO_") for n in nombres): ok(f"[{etiqueta}] los {len(set(nombres))} secretos usados tienen prefijo DEMO_ (no se mezclan con los del proyecto principal)")
    else: mal(f"[{etiqueta}] secretos sin prefijo DEMO_: {[n for n in nombres if not n.startswith('DEMO_')]}")
    # los secretos solo en el paso final (no en acciones de terceros ni a nivel de trabajo)
    if "secrets." in str(j.get("env", "")): mal(f"[{etiqueta}] hay secretos a nivel de trabajo")
    con_secretos = [s.get("name") or s.get("uses") for s in j["steps"] if "secrets." in str(s.get("env", "")) or "secrets." in str(s.get("with", ""))]
    if len(con_secretos) == pasos_con_secretos and all("uses" not in next(s for s in j["steps"] if (s.get("name") or s.get("uses")) == c) for c in con_secretos): ok(f"[{etiqueta}] los secretos se inyectan solo en {pasos_con_secretos} paso(s) propio(s) (run), nunca en acciones de terceros")
    else: mal(f"[{etiqueta}] secretos en pasos no permitidos: {con_secretos}")
    if palabra in texto and entrada in texto: ok(f"[{etiqueta}] la operación crítica exige escribir {palabra}")
    else: mal(f"[{etiqueta}] falta la confirmación explícita")
    return texto
verificar_flujo(R, "publicar-nube", "PUBLICAR", "inputs.confirmar")
txt_df = verificar_flujo(DF, "digifact-test", "CERTIFICAR-TEST", "inputs.confirmar", push_de_registro=True)
if "testnucgt.digifact.com" in txt_df and "nucgt.digifact.com/gt.com.apinuc" not in txt_df and "--allow-net=testnucgt.digifact.com" in txt_df: ok("[digifact-test] solo puede salir a testnucgt.digifact.com (producción de Digifact no está permitida)")
else: mal("[digifact-test] debe limitar la red a testnucgt.digifact.com")
if "Digifact" in txt_df and "echo ${{ secrets" not in txt_df and "::add-mask" not in txt_df: ok("[digifact-test] ningún paso imprime secretos")
else: mal("[digifact-test] un paso podría imprimir secretos")
PERMITIDOS = {R, DF, MG}
for f in glob.glob(".github/workflows/*.yml"):
    if f not in PERMITIDOS and re.search(r"secrets\.DEMO_", open(f, encoding="utf-8").read()): mal(f"{f} usa secretos DEMO_")
else: ok("ningún otro flujo de trabajo usa los secretos DEMO_")
for f in glob.glob(".github/workflows/*.yml"):
    if f not in PERMITIDOS and "demo-privada" in open(f, encoding="utf-8").read(): mal(f"{f} usa el entorno demo-privada")
sh = open("fel/tools/publicar-nube.sh", encoding="utf-8").read(); pp = open("fel/tools/pages-proyecto.sh", encoding="utf-8").read()
if "nexa|nexacorp" in sh and "nexa|nexacorp" in pp and "nexa-fel-demo" in pp: ok("el proyecto de Pages solo puede ser nexa-fel-demo; nexa y nexacorp están vetados")
else: mal("faltan los vetos a nexa/nexacorp en los scripts de publicación")
if "pages project create" in pp and "2>&1 || " not in pp and "/dev/null 2>&1 ||" not in pp: ok("la creación del proyecto de Pages no oculta errores")
else: mal("la creación de Pages oculta errores")
if "PROHIBIDO: FEL_DEMO_PROYECTO_REF no es" in sh and "$REF_ESPERADA" in sh: ok("publicar-nube.sh rechaza cualquier referencia distinta de la fijada")
else: mal("publicar-nube.sh no valida la referencia fijada")
if "comprobar_cli" in sh and "--no-verify-jwt" in sh: ok("se comprueba la compatibilidad de la CLI antes de actuar")
else: mal("falta la comprobación de la CLI")
sb = open("fel/tools/supabase-hospedado.sh", encoding="utf-8").read(); d = open("fel/tools/destinos-demo.sh", encoding="utf-8").read()
if 'REF_ESPERADA="sbmchmknfercbtziwrge"' in d and 'PAGES_ESPERADO="nexa-fel-demo"' in d: ok("destinos únicos en tools/destinos-demo.sh")
else: mal("destinos no fijados en destinos-demo.sh")
hospedadas = [l for l in sb.splitlines() if re.search(r"supabase (db push|secrets set|functions deploy)", l)]
def _bien(l):
    if "--project-ref" in l: return False
    if "db push" in l:
        if '--remote="$URL_SESION"' not in l: return False
        return ("--dry-run" in l and "--yes" not in l) or ("--yes" in l and "--dry-run" not in l)
    return '--remote="$REF"' in l and "--yes" in l
if len(hospedadas) == 5 and all(_bien(l) for l in hospedadas) and sum("--dry-run" in l for l in hospedadas) == 1: ok("las 5 órdenes hospedadas llevan destino explícito: db push por --remote=\"$URL_SESION\" (la de conexión solo con --dry-run, sin --yes; la de migraciones con --yes), y secrets/functions con --remote=<ref> y --yes; sin --project-ref obsoleto")
else: mal(f"órdenes hospedadas sin destino explícito: {hospedadas}")
if "destinos-demo.sh" in sh and "destinos-demo.sh" in sb and 'REF" = "$REF_ESPERADA"' in sb: ok("ambos scripts usan los destinos únicos y rechazan otra referencia")
else: mal("los scripts no validan contra destinos-demo.sh")
if r"pooler\.supabase\.com" in sb and "postgres\\.${REF}" in sb and "(6543|5432)" in sb and ":5432/postgres" in sb: ok("la URL de base de datos se valida contra el pooler compartido de nexa-demo y se deriva al puerto 5432 (Session Pooler, IPv4)")
else: mal("falta la validación/derivación del Session Pooler")
dg = sb[sb.index("  diagnostico)"):sb.index("  estado)")]
if "-c 'select 1'" in dg and "psql" in dg and dg.count("psql ") >= 1 and not re.search(r"insert|update|delete|drop|create|alter|--yes", dg, re.I): ok("el diagnóstico de contraseña solo hace «select 1» (lectura) y no usa --yes")
else: mal("el diagnóstico de contraseña debe ser solo lectura")
dg_sin_mascara = "\n".join(l for l in dg.splitlines() if "::add-mask::" not in l)   # «::add-mask::» OCULTA el valor en el registro de GitHub; no lo imprime
if not re.search(r'echo[^\n|]*\$\{?(CLAVE_URL|CLAVE_DB|CLAVE_BD)\b', dg_sin_mascara): ok("el diagnóstico de contraseña nunca imprime las contraseñas (solo SI/NO)")
else: mal("el diagnóstico imprime una contraseña")
es = sb[sb.index("  estado)"):sb.index("  migraciones)")]
if "default_transaction_read_only=on" in es and not re.search(r"insert |update |delete |drop |create |alter |truncate |grant |revoke |copy |--yes", es, re.I): ok("el reconocimiento del estado de la base es solo lectura de metadatos (sesión con default_transaction_read_only=on, solo SELECT)")
else: mal("el reconocimiento del estado de la base debe ser solo lectura")
es_sin_mascara = "\n".join(l for l in es.splitlines() if "::add-mask::" not in l)
if not re.search(r'echo[^\n|]*\$\{?(CLAVE_URL|CLAVE_BD)\b', es_sin_mascara): ok("el reconocimiento del estado nunca imprime la contraseña")
else: mal("el reconocimiento del estado imprime la contraseña")

# ---------------------------------------------------------------- flujo «solo migraciones» (por etapas): no puede desplegar nada más
txt_mg = verificar_flujo(MG, "migraciones-nube", "APLICAR-MIGRACIONES", "inputs.confirmar", push_de_registro=True, pasos_con_secretos=4)
PERMITIDOS_MG = {"DEMO_SUPABASE_PROYECTO_REF", "DEMO_SUPABASE_ACCESS_TOKEN", "DEMO_SUPABASE_DB_PASSWORD", "DEMO_BD_URL", "DEMO_SUPABASE_ANON_KEY"}
usados_mg = set(re.findall(r"secrets\.([A-Za-z0-9_]+)", txt_mg))
if usados_mg and usados_mg <= PERMITIDOS_MG: ok(f"[migraciones-nube] solo recibe {len(usados_mg)} secretos de base de datos; ninguno de la función, Cloudflare, el intermediario ni las claves de la demostración")
else: mal(f"[migraciones-nube] secretos no permitidos: {sorted(usados_mg - PERMITIDOS_MG)}")
cuerpo_mg = "\n".join(l for l in txt_mg.splitlines() if not l.lstrip().startswith("#"))
if not re.search(r"wrangler|cloudflare|pages|functions deploy|secrets set|publicar-nube\.sh|setup-deno|setup-node|SERVICE_ROLE", cuerpo_mg, re.I): ok("[migraciones-nube] el flujo no menciona función, Cloudflare/Pages, Wrangler, publicación ni clave service_role")
else: mal("[migraciones-nube] el flujo menciona algo que despliega o que no necesita")
if "supabase-hospedado.sh" in cuerpo_mg and 'migraciones-etapa' in cuerpo_mg and 'verificar-etapa' in cuerpo_mg and 'verificar-inicial' in cuerpo_mg and 'diagnostico-inicial' in cuerpo_mg and not re.search(r"supabase-hospedado\.sh[^\n]*\b(funcion|migraciones|conexion|estado|diagnostico|validar)\b(?![-\w])", cuerpo_mg): ok("[migraciones-nube] solo invoca las acciones verificar-inicial, diagnostico-inicial, verificar-etapa y migraciones-etapa del script (no «migraciones» completa ni «funcion»)")
else: mal("[migraciones-nube] invoca acciones del script no permitidas")
me = sb[sb.index("  migraciones-etapa|verificar-etapa)"):sb.index("  funcion)")]
me_sin_comentarios = "\n".join(l for l in me.splitlines() if not l.lstrip().startswith("#"))
if not re.search(r"functions deploy|secrets set|wrangler|--include-all|--project-ref=|\bdb reset\b|\bdb remote\b", me_sin_comentarios): ok("[etapas] las acciones por etapas no despliegan función, no cargan secretos, no usan --include-all y no reinician la base")
else: mal("[etapas] las acciones por etapas contienen una orden no permitida")
if 'db push --remote="$URL_SESION" --yes --workdir "$SUB"' in me and me.count("db push") == 1 and 'FEL_CONFIRMAR_MIGRACIONES:-}" = "APLICAR-MIGRACIONES"' in me: ok("[etapas] un único «db push», sobre la carpeta temporal con SOLO las migraciones de la etapa, y con la confirmación literal exigida también dentro del script")
else: mal("[etapas] el «db push» no está acotado a la carpeta de la etapa o falta la confirmación literal")
if me.count("PGOPTIONS=") >= 2 and not re.search(r"psql [^\n]*(?<!read_only=on)\"? -c \"(insert|update|delete|create|alter|drop|truncate)", me_sin_comentarios, re.I) and all("default_transaction_read_only=on" in l for l in me.splitlines() if "psql \"host=" in l): ok("[etapas] todas las consultas de precondición y verificación usan la sesión forzada a solo lectura")
else: mal("[etapas] alguna consulta no está forzada a solo lectura")
if not re.search(r'echo[^\n|]*\$\{?(CLAVE_URL|CLAVE_BD|URL_SESION)\b', "\n".join(l for l in me_sin_comentarios.splitlines() if "::add-mask::" not in l)): ok("[etapas] ninguna salida imprime la contraseña ni la URL de conexión")
else: mal("[etapas] una salida imprime la contraseña o la URL")

# ---------------------------------------------------------------- «verificar-inicial»: solo lectura estricta, mínimo de secretos y ninguna ruta hacia las migraciones
wmg = yaml.safe_load(open(MG, encoding="utf-8").read()); pasos = wmg["jobs"]["migraciones"]["steps"]; disp = wmg.get(True, wmg.get("on"))["workflow_dispatch"]["inputs"]
paso_vi = [p for p in pasos if "run" in p and "verificar-inicial" in str(p["run"])]
paso_et = [p for p in pasos if "run" in p and "ACCION" in str(p.get("env", {}))]
if len(paso_vi) == 1 and str(paso_vi[0].get("if", "")) == "inputs.accion == 'verificar-inicial'" and set(paso_vi[0].get("env", {})) == {"FEL_DEMO_PROYECTO_REF", "FEL_DEMO_BD_URL"}: ok("[verificar-inicial] su paso recibe SOLO 2 secretos (referencia del proyecto y cadena de conexión): sin token de Supabase, sin contraseña aparte, sin confirmación de migraciones")
else: mal("[verificar-inicial] su paso debe existir una vez, con su condición y solo FEL_DEMO_PROYECTO_REF y FEL_DEMO_BD_URL")
if paso_vi and re.fullmatch(r"\s*bash fel/tools/supabase-hospedado\.sh verificar-inicial\s*", str(paso_vi[0]["run"])): ok("[verificar-inicial] su paso ejecuta únicamente «verificar-inicial» (sin variables de acción, sin etapas)")
else: mal("[verificar-inicial] su paso debe ejecutar solo «verificar-inicial»")
if len(paso_et) == 1 and "verificar-inicial" not in str(paso_et[0].get("if", "")) and "verificar-etapa" in str(paso_et[0].get("if", "")) and "migraciones-etapa" in str(paso_et[0].get("if", "")) and "verificar-inicial" not in str(paso_et[0]["run"]): ok("[verificar-inicial] el paso de las etapas (que sí puede aplicar migraciones) queda EXCLUIDO cuando la acción es verificar-inicial")
else: mal("[verificar-inicial] el paso de las etapas no excluye verificar-inicial")
cli = [p for p in pasos if p.get("uses") == "./.github/actions/supabase-cli"]
if len(cli) == 1 and str(cli[0].get("if", "")) == "inputs.accion != 'verificar-inicial' && inputs.accion != 'diagnostico-inicial' && inputs.accion != 'verificar-api-vault'": ok("[verificar-inicial] la CLI de Supabase NO se instala ni en la verificación inicial, ni en el diagnóstico, ni en la comprobación de la API")
else: mal("[verificar-inicial] la CLI de Supabase debe omitirse en verificar-inicial y diagnostico-inicial")
if disp["accion"].get("default") == "verificar-inicial" and "verificar-inicial" in disp["accion"]["options"]: ok("[verificar-inicial] es la acción por defecto del flujo (la de solo lectura)")
else: mal("[verificar-inicial] debe ser la acción por defecto")
vi = sb[sb.index("  verificar-inicial)"):sb.index("  migraciones-etapa|verificar-etapa)")]
vi_sc = "\n".join(l for l in vi.splitlines() if not l.lstrip().startswith("#"))
if not re.search(r"\bsupabase\b\s+(link|db|functions|secrets|migration|projects|start|stop)|db push|--yes|--include-all|FEL_CONFIRMAR_MIGRACIONES|SUPABASE_ACCESS_TOKEN|mktemp -d|cp supabase/migrations", vi_sc): ok("[verificar-inicial] el código de la acción no invoca la CLI de Supabase, ni «db push», ni lee el token ni la confirmación: no hay ruta hacia las migraciones")
else: mal("[verificar-inicial] el código de la acción contiene una ruta hacia migraciones o la CLI")
if all(x in vi for x in ["verificar-sql-solo-lectura.py", "envolver_solo_lectura", "default_transaction_read_only=on", "sesión de solo lectura | on | on | OK"]) and vi.count("psql ") >= 1 and all("default_transaction_read_only=on" in l for l in vi.splitlines() if 'psql "host=' in l): ok("[verificar-inicial] usa las 4 capas: verificador del SQL, transacción de solo lectura, sesión forzada a solo lectura y confirmación en el resultado")
else: mal("[verificar-inicial] faltan capas de solo lectura")
env_rl = "\n".join(l for l in open("fel/tools/sql-solo-lectura.sh", encoding="utf-8").read().splitlines() if not l.lstrip().startswith("#"))   # solo el código, no los comentarios
if "'begin transaction read only;'" in env_rl and "'rollback;'" in env_rl and not re.search(r"\b(commit|end)\b", env_rl, re.I) and env_rl.count("begin") == 1: ok("[verificar-inicial] el envoltorio es «begin transaction read only … rollback» y no contiene COMMIT")
else: mal("[verificar-inicial] el envoltorio no es de solo lectura")
sys.dont_write_bytecode = True   # no dejar __pycache__ en el repositorio
sys.path.insert(0, "fel/tools")
import importlib.util
_spec = importlib.util.spec_from_file_location("vsl", "fel/tools/verificar-sql-solo-lectura.py"); _vsl = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_vsl)
_err = _vsl.revisar(open("fel/docs/migracion-28/verificacion-inicial-nexa-demo.sql", encoding="utf-8").read())
if not _err: ok("[verificar-inicial] el SQL de verificación contiene solo SELECT (verificador estático)")
else: mal(f"[verificar-inicial] el SQL contiene algo que no es SELECT: {_err[:2]}")

# ---------------------------------------------------------------- «diagnostico-inicial»: misma barrera que verificar-inicial (solo lectura, 2 secretos, sin CLI, sin ruta hacia las migraciones)
paso_di = [p for p in pasos if "run" in p and "diagnostico-inicial" in str(p["run"])]
if len(paso_di) == 1 and str(paso_di[0].get("if", "")) == "inputs.accion == 'diagnostico-inicial'" and set(paso_di[0].get("env", {})) == {"FEL_DEMO_PROYECTO_REF", "FEL_DEMO_BD_URL"} and re.fullmatch(r"\s*bash fel/tools/supabase-hospedado\.sh diagnostico-inicial\s*", str(paso_di[0]["run"])): ok("[diagnostico-inicial] su paso recibe SOLO 2 secretos, no lleva variables de acción y ejecuta únicamente «diagnostico-inicial»")
else: mal("[diagnostico-inicial] su paso debe existir una vez, con su condición, solo FEL_DEMO_PROYECTO_REF y FEL_DEMO_BD_URL y ejecutar solo «diagnostico-inicial»")
if paso_et and "diagnostico-inicial" not in str(paso_et[0].get("if", "")) and "diagnostico-inicial" not in str(paso_et[0]["run"]): ok("[diagnostico-inicial] el paso de las etapas (que sí puede aplicar migraciones) queda EXCLUIDO cuando la acción es diagnostico-inicial")
else: mal("[diagnostico-inicial] el paso de las etapas no excluye diagnostico-inicial")
di = sb[sb.index("  diagnostico-inicial)"):sb.index("  verificar-inicial)")]
di_sc = "\n".join(l for l in di.splitlines() if not l.lstrip().startswith("#"))
if not re.search(r"\bsupabase\b\s+(link|db|functions|secrets|migration|projects|start|stop)|db push|--yes|--include-all|FEL_CONFIRMAR_MIGRACIONES|SUPABASE_ACCESS_TOKEN|mktemp -d|cp supabase/migrations", di_sc): ok("[diagnostico-inicial] el código de la acción no invoca la CLI de Supabase, ni «db push», ni lee el token ni la confirmación: no hay ruta hacia las migraciones")
else: mal("[diagnostico-inicial] el código de la acción contiene una ruta hacia migraciones o la CLI")
if all(x in di for x in ["verificar-sql-solo-lectura.py", "envolver_solo_lectura", "default_transaction_read_only=on", "00 sesión | transaction_read_only | on"]) and all("default_transaction_read_only=on" in l for l in di.splitlines() if 'psql "host=' in l): ok("[diagnostico-inicial] usa las 4 capas: verificador del SQL, transacción de solo lectura, sesión forzada a solo lectura y confirmación en el resultado")
else: mal("[diagnostico-inicial] faltan capas de solo lectura")
_err2 = _vsl.revisar(open("fel/docs/migracion-28/diagnostico-funcion-y-vault-nexa-demo.sql", encoding="utf-8").read())
if not _err2: ok("[diagnostico-inicial] el SQL de diagnóstico contiene solo SELECT (verificador estático)")
else: mal(f"[diagnostico-inicial] el SQL contiene algo que no es SELECT: {_err2[:2]}")
if not re.search(r"vault\.(decrypted_secrets|secrets)\b[^\n]*\bfrom\b|from\s+vault\.(decrypted_secrets|secrets)\b", open("fel/docs/migracion-28/diagnostico-funcion-y-vault-nexa-demo.sql", encoding="utf-8").read().replace("'", "§")): ok("[diagnostico-inicial] el SQL NO lee el contenido de vault.secrets ni de vault.decrypted_secrets (solo privilegios y catálogo)")
else: mal("[diagnostico-inicial] el SQL lee el contenido de Vault")

# ---------------------------------------------------------------- huella controlada de la función de plataforma (rls_auto_enable)
import hashlib
_real = open("fel/supabase/tests/plataforma/rls_auto_enable_real.sql", encoding="utf-8").read()
_huella = hashlib.sha256(_real.split("$function$")[1].encode()).hexdigest()
_vi_sql = open("fel/docs/migracion-28/verificacion-inicial-nexa-demo.sql", encoding="utf-8").read()
if _vi_sql.count(_huella) >= 4 and re.findall(r"[0-9a-f]{64}", _vi_sql) and set(re.findall(r"[0-9a-f]{64}", _vi_sql)) == {_huella}: ok("[huella] la huella SHA-256 fijada en la verificación inicial es EXACTAMENTE la del cuerpo de la definición verificada (rls_auto_enable_real.sql) y no hay otra")
else: mal("[huella] la huella fijada en la verificación inicial no coincide con la definición verificada del repositorio")
if all(x in _vi_sql for x in ["'ensure_rls'", "p.prosecdef", "search_path=pg_catalog", "'event_trigger'::regtype", "e.evtenabled = 'O'", "ddl_command_end", "'supabase_admin'"]) and "not f.reconocida" in _vi_sql: ok("[huella] el reconocimiento exige huella, SECURITY DEFINER, search_path, tipo, propietario y el disparador ensure_rls activo; todo lo demás es REVISAR")
else: mal("[huella] el reconocimiento de la función de plataforma no exige todas las condiciones")
_tl = open("fel/tools/test-local.sh", encoding="utf-8").read(); _ci = open(".github/workflows/fel-tests.yml", encoding="utf-8").read()
if "test-plataforma-ensure-rls.sh" in _tl and "test-plataforma-ensure-rls.sh" in _ci and "image: postgres:16" in _ci: ok("[huella] la prueba con la función real corre en test-local.sh y en el CI (con un PostgreSQL de superusuario)")
else: mal("[huella] la prueba con la función real no está en test-local.sh o en el CI")

# ---------------------------------------------------------------- «verificar-api-vault»: solo lectura (GET a la raíz de la API), clave anon pública, sin base de datos, sin CLI, sin claves de servicio
paso_av = [p for p in pasos if "run" in p and "verificar-api-vault" in str(p["run"])]
if len(paso_av) == 1 and str(paso_av[0].get("if", "")) == "inputs.accion == 'verificar-api-vault'" and set(paso_av[0].get("env", {})) == {"FEL_DEMO_PROYECTO_REF", "FEL_DEMO_ANON_KEY"} and "secrets.DEMO_SUPABASE_ANON_KEY" in str(paso_av[0]["env"]["FEL_DEMO_ANON_KEY"]) and re.fullmatch(r"\s*bash fel/tools/supabase-hospedado\.sh verificar-api-vault\s*", str(paso_av[0]["run"])): ok("[verificar-api-vault] su paso recibe SOLO la referencia del proyecto y la clave anon pública (sin cadena de conexión, sin token, sin claves de servicio) y ejecuta únicamente esa acción")
else: mal("[verificar-api-vault] su paso debe existir una vez, con su condición, solo FEL_DEMO_PROYECTO_REF y FEL_DEMO_ANON_KEY (DEMO_SUPABASE_ANON_KEY) y ejecutar solo esa acción")
if paso_et and "verificar-api-vault" not in str(paso_et[0].get("if", "")) and "verificar-api-vault" not in str(paso_et[0]["run"]): ok("[verificar-api-vault] el paso de las etapas (que sí puede aplicar migraciones) queda EXCLUIDO cuando la acción es verificar-api-vault")
else: mal("[verificar-api-vault] el paso de las etapas no excluye verificar-api-vault")
av = sb[sb.index("  verificar-api-vault)"):sb.index("  diagnostico-inicial)")]
av_sc = "\n".join(l for l in av.splitlines() if not l.lstrip().startswith("#"))
if not re.search(r"\bpsql\b|\bsupabase\b\s+(link|db|functions|secrets|migration|projects)|db push|FEL_DEMO_BD_URL|SERVICE_ROLE|SUPABASE_ACCESS_TOKEN|FEL_CONFIRMAR_MIGRACIONES|--yes", av_sc): ok("[verificar-api-vault] el código de la acción no usa psql, ni la CLI, ni la cadena de conexión, ni claves de servicio, ni el token: no hay ruta hacia la base ni las migraciones")
else: mal("[verificar-api-vault] el código de la acción usa algo que no debe")
curls = re.findall(r"\bcurl\b[^\n]*", av_sc)
if len(curls) == 1 and "-K -" in curls[0] and 'https://${REF}.supabase.co/rest/v1/"' in curls[0] and not re.search(r"\s-X\b|--request|\s-d\b|--data|\s-T\b|--upload|\s-F\b|--form|--json|--post|--put|--delete", curls[0]): ok("[verificar-api-vault] una sola orden curl: GET a la raíz «/rest/v1/» del proyecto fijado, con la clave por la entrada estándar y sin ningún método ni cuerpo de escritura")
else: mal("[verificar-api-vault] la orden curl no es un GET a la raíz de la API del proyecto fijado")
if "sb_secret_*" in av and 'p.get("role") == "anon"' in av and 'p.get("ref") == os.environ["R"]' in av: ok("[verificar-api-vault] solo admite la clave publicable o el JWT anon de este proyecto y rechaza las claves secretas antes de enviar nada")
else: mal("[verificar-api-vault] no valida que la clave sea pública y de este proyecto")
# ---- Digifact TEST hacia la función: opcional, apagado por defecto, todo o nada, solo a los secretos de la función y sin imprimir valores
import yaml as _yaml
_pn = _yaml.safe_load(open(R, encoding="utf-8")); _txt_pn = open(R, encoding="utf-8").read()
_ent = _pn[True]["workflow_dispatch"]["inputs"].get("digifact", {})
if _ent.get("default") == "apagado" and _ent.get("options") == ["apagado", "habilitado"]: ok("[publicar-nube] Digifact TEST llega a la función solo si eliges «habilitado» en la ejecución (por defecto: apagado)")
else: mal("[publicar-nube] el interruptor «digifact» debe ser apagado/habilitado con valor por defecto apagado")
_dg = [l for l in _txt_pn.splitlines() if re.search(r"secrets\.DEMO_DIGIFACT", l)]
if _dg and all("inputs.digifact == 'habilitado'" in l for l in _dg): ok(f"[publicar-nube] los {len(_dg)} secretos de Digifact solo se cargan con digifact=habilitado")
else: mal("[publicar-nube] hay un secreto de Digifact que se carga sin el interruptor")
if len({x for x in re.findall(r"secrets\.(DEMO_DIGIFACT_\w+)", _txt_pn)}) == 6 and "DEMO_DIGIFACT_TEST_PASSWORD" in _txt_pn: ok("[publicar-nube] los secretos de Digifact son DEMO_* y están en el mismo único paso que los demás")
else: mal("[publicar-nube] conjunto inesperado de secretos de Digifact")
_pub = open("fel/tools/publicar-nube.sh", encoding="utf-8").read(); _pub_sc = "\n".join(l for l in _pub.splitlines() if not l.lstrip().startswith("#"))
_lineas_dg = [l for l in _pub_sc.splitlines() if re.search(r"DIGIFACT|__DG_|DG_VARS", l)]
if all(not re.search(r"wrangler|npx|pages|aprovisionar|construir|migraciones|curl|\becho\b[^\n]*\$\{?(__DG_|DIGIFACT|FEL_DIGIFACT)", l) or "DG_ESTADO" in l for l in _lineas_dg): ok("[publicar-nube.sh] las variables de Digifact se apartan y nunca van en la misma orden que Cloudflare, las migraciones o la construcción, ni se imprimen")
else: mal("[publicar-nube.sh] una orden mezcla variables de Digifact con otro paso o las imprime")
_ult = [l for l in _pub_sc.splitlines() if "supabase-hospedado.sh funcion" in l]
if len(_ult) == 1 and "( for v in" in _ult[0] and "export" in _ult[0]: ok("[publicar-nube.sh] solo el paso de la función (en un subshell) recibe las variables de Digifact")
else: mal("[publicar-nube.sh] el paso de la función no aísla las variables de Digifact")
_fun = sb[sb.index("  funcion)"):]; _fun_sc = "\n".join(l for l in _fun.splitlines() if not l.lstrip().startswith("#"))
if all(x in _fun_sc for x in ["todo o nada", "no se publica la función", '*"\'"*', "FEL_DIGIFACT_TEST_HUELLA no es una huella", "solo admite «habilitado»"]) and not re.search(r"echo[^\n]*\$\{?(valor|DIGIFACT_TEST_PASSWORD|DIGIFACT_TEST_USERNAME|FEL_DIGIFACT_TEST_EMISOR)", _fun_sc): ok("[funcion] Digifact: todo o nada, valida el formato, rechaza comillas y saltos de línea y no imprime ningún valor")
else: mal("[funcion] la transmisión de Digifact no es todo-o-nada validada o imprime valores")
_wk = open("fel/demo-facturacion/nube/pages/worker.ts", encoding="utf-8").read()
if not re.search(r"DIGIFACT|digifact", _wk): ok("[cloudflare] el intermediario de Cloudflare no conoce nada de Digifact: ningún secreto fiscal llega ni al navegador ni a Cloudflare")
else: mal("[cloudflare] el worker menciona Digifact")
sys.exit(1 if fallos else 0)
