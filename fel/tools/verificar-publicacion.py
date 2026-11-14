#!/usr/bin/env python3
"""Garantías estáticas de la publicación privada (se ejecutan en el CI): ninguna ejecución automática puede publicar y los secretos de la demostración no se filtran a otros trabajos."""
import glob, re, sys, yaml
R = ".github/workflows/publicar-nube.yml"; DF = ".github/workflows/digifact-test.yml"; fallos = []
def mal(m): fallos.append(m); print("FALLO", m)
def ok(m): print("OK   ", m)
def verificar_flujo(ruta, etiqueta, palabra, entrada):
    """Las MISMAS garantías para todo flujo que recibe secretos DEMO_: solo manual, un trabajo, entorno protegido, rama fija, secretos aislados en un solo paso y confirmación explícita."""
    w = yaml.safe_load(open(ruta, encoding="utf-8").read()); disparo = w.get(True, w.get("on"))   # PyYAML lee «on» como True
    if set(disparo) == {"workflow_dispatch"}: ok(f"[{etiqueta}] solo se activa a mano (workflow_dispatch): sin push, pull_request, schedule, workflow_run ni repository_dispatch")
    else: mal(f"[{etiqueta}] disparadores no permitidos: {sorted(set(disparo) - {'workflow_dispatch'})}")
    jobs = w["jobs"]
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
    if len(con_secretos) == 1 and "uses" not in next(s for s in j["steps"] if (s.get("name") or s.get("uses")) == con_secretos[0]): ok(f"[{etiqueta}] los secretos se inyectan en un solo paso propio (run), no en acciones de terceros")
    else: mal(f"[{etiqueta}] secretos en pasos no permitidos: {con_secretos}")
    if palabra in texto and entrada in texto: ok(f"[{etiqueta}] la operación crítica exige escribir {palabra}")
    else: mal(f"[{etiqueta}] falta la confirmación explícita")
    return texto
verificar_flujo(R, "publicar-nube", "PUBLICAR", "inputs.confirmar")
txt_df = verificar_flujo(DF, "digifact-test", "CERTIFICAR-TEST", "inputs.confirmar")
if "testnucgt.digifact.com" in txt_df and "nucgt.digifact.com/gt.com.apinuc" not in txt_df and "--allow-net=testnucgt.digifact.com" in txt_df: ok("[digifact-test] solo puede salir a testnucgt.digifact.com (producción de Digifact no está permitida)")
else: mal("[digifact-test] debe limitar la red a testnucgt.digifact.com")
if "Digifact" in txt_df and "echo ${{ secrets" not in txt_df and "::add-mask" not in txt_df: ok("[digifact-test] ningún paso imprime secretos")
else: mal("[digifact-test] un paso podría imprimir secretos")
PERMITIDOS = {R, DF}
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
if len(hospedadas) == 4 and all(_bien(l) for l in hospedadas) and sum("--dry-run" in l for l in hospedadas) == 1: ok("las 4 órdenes hospedadas llevan destino explícito: db push por --remote=\"$URL_SESION\" (la de conexión solo con --dry-run, sin --yes; la de migraciones con --yes), y secrets/functions con --remote=<ref> y --yes; sin --project-ref obsoleto")
else: mal(f"órdenes hospedadas sin destino explícito: {hospedadas}")
if "destinos-demo.sh" in sh and "destinos-demo.sh" in sb and 'REF" = "$REF_ESPERADA"' in sb: ok("ambos scripts usan los destinos únicos y rechazan otra referencia")
else: mal("los scripts no validan contra destinos-demo.sh")
if r"pooler\.supabase\.com" in sb and "postgres\\.${REF}" in sb and "(6543|5432)" in sb and ":5432/postgres" in sb: ok("la URL de base de datos se valida contra el pooler compartido de nexa-demo y se deriva al puerto 5432 (Session Pooler, IPv4)")
else: mal("falta la validación/derivación del Session Pooler")
sys.exit(1 if fallos else 0)
