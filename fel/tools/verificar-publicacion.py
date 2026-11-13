#!/usr/bin/env python3
"""Garantías estáticas de la publicación privada (se ejecutan en el CI): ninguna ejecución automática puede publicar y los secretos de la demostración no se filtran a otros trabajos."""
import glob, re, sys, yaml
R = ".github/workflows/publicar-nube.yml"; fallos = []
def mal(m): fallos.append(m); print("FALLO", m)
def ok(m): print("OK   ", m)
w = yaml.safe_load(open(R, encoding="utf-8")); disparo = w.get(True, w.get("on"))   # PyYAML lee «on» como True
if set(disparo) == {"workflow_dispatch"}: ok("solo se activa a mano (workflow_dispatch): sin push, pull_request, schedule, workflow_run ni repository_dispatch")
else: mal(f"disparadores no permitidos: {sorted(set(disparo) - {'workflow_dispatch'})}")
jobs = w["jobs"]
if len(jobs) == 1: ok("un único trabajo")
else: mal("debe haber un único trabajo")
j = next(iter(jobs.values()))
if j.get("environment") == "demo-privada": ok("el trabajo usa el entorno protegido «demo-privada» (aprobación obligatoria)")
else: mal("el trabajo debe usar environment: demo-privada")
if "refs/heads/fel-proveedores-diseno" in str(j.get("if", "")): ok("solo corre desde la rama fel-proveedores-diseno")
else: mal("falta la restricción de rama")
texto = open(R, encoding="utf-8").read()
nombres = re.findall(r"secrets\.([A-Za-z0-9_]+)", texto)
if nombres and all(n.startswith("DEMO_") for n in nombres): ok(f"los {len(set(nombres))} secretos usados tienen prefijo DEMO_ (no se mezclan con los del proyecto principal)")
else: mal(f"secretos sin prefijo DEMO_: {[n for n in nombres if not n.startswith('DEMO_')]}")
# los secretos solo en el paso final (no en acciones de terceros ni a nivel de trabajo)
if "secrets." in str(j.get("env", "")): mal("hay secretos a nivel de trabajo")
con_secretos = [s.get("name") or s.get("uses") for s in j["steps"] if "secrets." in str(s.get("env", "")) or "secrets." in str(s.get("with", ""))]
if len(con_secretos) == 1 and "uses" not in next(s for s in j["steps"] if (s.get("name") or s.get("uses")) == con_secretos[0]): ok("los secretos se inyectan en un solo paso propio (run), no en acciones de terceros")
else: mal(f"secretos en pasos no permitidos: {con_secretos}")
if "PUBLICAR" in texto and "inputs.confirmar" in texto: ok("publicar exige escribir PUBLICAR")
else: mal("falta la confirmación explícita")
for f in glob.glob(".github/workflows/*.yml"):
    if f != R and re.search(r"secrets\.DEMO_", open(f, encoding="utf-8").read()): mal(f"{f} usa secretos DEMO_")
else: ok("ningún otro flujo de trabajo usa los secretos DEMO_")
for f in glob.glob(".github/workflows/*.yml"):
    if f != R and "demo-privada" in open(f, encoding="utf-8").read(): mal(f"{f} usa el entorno demo-privada")
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
if len(hospedadas) == 3 and all('--remote="$REF"' in l and "--yes" in l and "--project-ref" not in l for l in hospedadas): ok("las 3 órdenes hospedadas llevan --remote=<ref> explícito y --yes, sin --project-ref obsoleto")
else: mal(f"órdenes hospedadas sin destino explícito: {hospedadas}")
if "destinos-demo.sh" in sh and "destinos-demo.sh" in sb and 'REF" = "$REF_ESPERADA"' in sb: ok("ambos scripts usan los destinos únicos y rechazan otra referencia")
else: mal("los scripts no validan contra destinos-demo.sh")
sys.exit(1 if fallos else 0)
