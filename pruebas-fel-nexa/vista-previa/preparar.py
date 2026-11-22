#!/usr/bin/env python3
"""Prepara la copia TEMPORAL de NEXA para la vista previa (nunca modifica nexa/ ni el repositorio).
   · Copia nexa/ al destino indicado, escribe version.json (como deploy-nexa.yml) y, SOLO si se da una URL de NEXA FEL,
     añade al objeto de configuración incrustado de index.html una única línea:  window.PA_CONFIG.fel = {url, etiqueta};
   · Sin URL, FEL queda deshabilitado (la copia es idéntica a nexa/ salvo version.json).
   · La URL debe ser https, sin usuario ni puerto ni ruta, y de *.pages.dev. La etiqueta, texto corto.
   Uso: python3 preparar.py --origen nexa --destino /ruta/temporal [--fel-url https://xxx.pages.dev/] [--etiqueta Pruebas]"""
import argparse, json, os, re, shutil, sys
from urllib.parse import urlsplit

HOST = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.pages\.dev$")
ETIQ = re.compile(r"^[\wÁÉÍÓÚÜÑáéíóúüñ .·-]{1,40}$")
CONF = re.compile(r"(?m)^(window\.PA_CONFIG\s*=\s*\{[^}]*\};)")   # anclado al inicio de línea: index.html trae otro texto igual dentro de una cadena (la descarga de config.js)

def falla(m): print("PROHIBIDO: " + m); sys.exit(2)

def url_valida(u):
    try: p = urlsplit(u)
    except Exception: falla("la URL de NEXA FEL no se puede leer")
    if p.scheme != "https": falla("la URL de NEXA FEL debe ser https")
    if p.username or p.password: falla("la URL de NEXA FEL no puede llevar usuario ni contraseña")
    try: puerto = p.port
    except ValueError: puerto = -1
    if puerto is not None: falla("la URL de NEXA FEL no puede llevar puerto")
    h = (p.hostname or "").lower()
    if not HOST.match(h): falla("la URL de NEXA FEL debe ser un dominio *.pages.dev")
    if p.path not in ("", "/") or p.query or p.fragment: falla("la URL de NEXA FEL no puede llevar ruta, parámetros ni fragmento")
    return "https://" + h + "/"

def main():
    a = argparse.ArgumentParser(); a.add_argument("--origen", required=True); a.add_argument("--destino", required=True)
    a.add_argument("--fel-url", default=""); a.add_argument("--etiqueta", default="Pruebas")
    x = a.parse_args()
    origen, destino = os.path.realpath(x.origen), os.path.realpath(x.destino)
    if not os.path.isfile(os.path.join(origen, "index.html")): falla("el origen no contiene index.html")
    if os.path.exists(destino): falla("el destino ya existe: debe ser una carpeta nueva")
    if destino == origen or destino.startswith(origen + os.sep) or origen.startswith(destino + os.sep): falla("el destino no puede estar dentro del origen ni contenerlo")
    fel = url_valida(x.fel_url.strip()) if x.fel_url.strip() else ""
    if fel and not ETIQ.match(x.etiqueta): falla("la etiqueta debe ser un texto corto (letras, números, espacios, punto, guion)")
    shutil.copytree(origen, destino)
    ruta = os.path.join(destino, "index.html"); html = open(ruta, encoding="utf-8").read()
    m = re.search(r"APP_VER='(v\d+)'", html)
    if not m: falla("no se encontró APP_VER en index.html")
    open(os.path.join(destino, "version.json"), "w", encoding="utf-8").write(json.dumps({"v": m.group(1)}) + "\n")
    if fel:
        if len(CONF.findall(html)) != 1: falla("no se encontró exactamente un objeto PA_CONFIG incrustado en index.html")
        linea = "\nwindow.PA_CONFIG.fel = " + json.dumps({"url": fel, "etiqueta": x.etiqueta}, ensure_ascii=True).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026") + ";"
        nuevo = CONF.sub(lambda mm: mm.group(1) + linea, html, count=1)
        if nuevo.count("\nwindow.PA_CONFIG.fel = ") != 1 or nuevo.replace(linea, "", 1) != html: falla("la inserción no es exactamente una línea")
        open(ruta, "w", encoding="utf-8").write(nuevo)
        print(f"OK  vista previa preparada con NEXA FEL HABILITADO hacia {fel} (etiqueta «{x.etiqueta}»); nexa/ no se modificó")
    else:
        print("OK  vista previa preparada con NEXA FEL DESHABILITADO (sin URL); nexa/ no se modificó")

main()
