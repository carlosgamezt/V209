#!/usr/bin/env python3
"""Prepara la copia TEMPORAL de NEXA para la vista previa (nunca modifica nexa/ ni el repositorio).
   · Copia nexa/ al destino indicado y escribe version.json desde APP_VER (como deploy-nexa.yml). index.html NO se modifica: ya no se inyecta ninguna configuración de NEXA FEL.
   · Quién ve NEXA FEL lo decide el SERVIDOR (función nx_fel_autorizado() según el UUID de Supabase Auth de la sesión); la URL de FEL es configuración de la aplicación dentro de index.html.
   · Antes de copiar se comprueba que index.html tiene el mecanismo nuevo y no la regla anterior (basada en el rol admin y en PA_CONFIG.fel), y que la URL de FEL es exactamente https://nexa-fel-demo.pages.dev/.
   Uso: python3 preparar.py --origen nexa --destino /ruta/temporal"""
import argparse, json, os, re, shutil, sys

FEL_URL = "https://nexa-fel-demo.pages.dev/"   # el ÚNICO destino de NEXA FEL permitido (proyecto de Pages «nexa-fel-demo»)

def falla(m): print("PROHIBIDO: " + m); sys.exit(2)

def main():
    a = argparse.ArgumentParser(); a.add_argument("--origen", required=True); a.add_argument("--destino", required=True)
    x = a.parse_args()
    origen, destino = os.path.realpath(x.origen), os.path.realpath(x.destino)
    ruta = os.path.join(origen, "index.html")
    if not os.path.isfile(ruta): falla("el origen no contiene index.html")
    if os.path.exists(destino): falla("el destino ya existe: debe ser una carpeta nueva")
    if destino == origen or destino.startswith(origen + os.sep) or origen.startswith(destino + os.sep): falla("el destino no puede estar dentro del origen ni contenerlo")
    html = open(ruta, encoding="utf-8").read()
    m = re.search(r"APP_VER='(v\d+)'", html)
    if not m: falla("no se encontró APP_VER en index.html")
    sinc = re.sub(r"/\*[\s\S]*?\*/", "", html)   # sin comentarios
    if "nx_fel_autorizado" not in html: falla("index.html no consulta nx_fel_autorizado(): no tiene el mecanismo de acceso por cuenta (¿versión anterior?)")
    if re.search(r"PA_CONFIG\s*&&\s*PA_CONFIG\.fel|PA_CONFIG\.fel\.url|c\.dominios", sinc): falla("index.html todavía lee PA_CONFIG.fel (regla anterior basada en configuración del navegador)")
    if re.search(r"function felVis\(\)\{[^}]*role", sinc): falla("felVis() todavía depende del rol")
    if html.count("url:'" + FEL_URL + "'") != 1: falla("la URL de NEXA FEL en index.html debe ser exactamente " + FEL_URL)
    shutil.copytree(origen, destino)
    open(os.path.join(destino, "version.json"), "w", encoding="utf-8").write(json.dumps({"v": m.group(1)}) + "\n")
    if open(os.path.join(destino, "index.html"), encoding="utf-8").read() != html: falla("index.html cambió durante la copia")
    print(f"OK  vista previa preparada ({m.group(1)}): index.html sin cambios, NEXA FEL por cuenta autorizada en el servidor, URL de FEL {FEL_URL}; nexa/ no se modificó")

main()
