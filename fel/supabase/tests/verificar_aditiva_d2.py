#!/usr/bin/env python3
"""D2 · garantía de que las migraciones de D2 son ADITIVAS y de que lo existente no cambió.
  1) hashes SHA-256 de las 17 migraciones previas, del orquestador (orquestador_db.ts) y de la interfaz EmissionProvider (tipos.ts): deben coincidir con inmutables_d2.sha256;
  2) cada migración 2026111200* solo puede crear objetos nuevos y tocar tablas que ELLA misma crea: sin DROP, TRUNCATE, ALTER de tablas ajenas, DELETE/UPDATE/INSERT sobre tablas ajenas,
     ni reemplazar funciones que ya existían. (La migración M5 de D2 añadirá filas de catálogo: se autorizará por separado ampliando PERMITIDOS_AJENOS.)"""
import hashlib, pathlib, re, sys
RAIZ = pathlib.Path(__file__).resolve().parents[3]          # raíz del repositorio
MIG = RAIZ / "fel/supabase/migrations"
PERMITIDOS_AJENOS = {                                        # {archivo: {accion: {tabla,...}}}: excepciones EXPLÍCITAS, una por migración, con su justificación
    # D3-1: digifact pasa a «solo simulado» (misma barrera que portal_playwright); se reemplaza la restricción que lo bloqueaba por completo
    "20261112000300_fel_digifact_simulado.sql": {"alter": {"proveedores_emision"}, "update": {"proveedores_emision", "operaciones_fiscales"}, "insert": {"operaciones_fiscales"}},   # las funciones de anulación simulada crean y cierran operaciones
}
fallos = []
# 1) inmutables
for linea in (pathlib.Path(__file__).with_name("inmutables_d2.sha256")).read_text().splitlines():
    if not linea.strip(): continue
    h, ruta = linea.split(None, 1); ruta = ruta.strip().lstrip("*")
    p = RAIZ / ruta
    if not p.exists(): fallos.append(f"falta {ruta}"); continue
    if hashlib.sha256(p.read_bytes()).hexdigest() != h: fallos.append(f"CAMBIÓ lo existente: {ruta}")
# 2) migraciones de D2
previas = [f for f in sorted(MIG.glob("*.sql")) if f.name < "20261112000100"]
funciones_previas = set()
for f in previas:
    for m in re.finditer(r"create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)", f.read_text(), re.I): funciones_previas.add(m.group(1))
d2 = sorted(MIG.glob("2026111200*.sql"))
# Las tablas creadas por CUALQUIER migración de D2 son propias de D2 (una migración posterior puede ampliarlas); las anteriores a D2 son ajenas.
nuevas = set()
for f in d2:
    nuevas |= {m.group(1) for m in re.finditer(r"create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)", re.sub(r"--[^\n]*", "", f.read_text()), re.I)}
for f in d2:
    texto = re.sub(r"--[^\n]*", "", f.read_text())
    permitido = PERMITIDOS_AJENOS.get(f.name, {})
    def ajena(tabla, accion):
        return tabla not in nuevas and tabla not in permitido.get(accion, set())
    for m in re.finditer(r"\bdrop\s+(?!trigger\s+if|constraint)\w+", texto, re.I): fallos.append(f"{f.name}: DROP no permitido ({m.group(0)})")
    if re.search(r"\btruncate\b", texto, re.I): fallos.append(f"{f.name}: TRUNCATE no permitido")
    for m in re.finditer(r"alter\s+table\s+(?:only\s+)?public\.(\w+)", texto, re.I):
        if ajena(m.group(1), "alter"): fallos.append(f"{f.name}: ALTER TABLE sobre tabla ajena {m.group(1)}")
    for m in re.finditer(r"delete\s+from\s+public\.(\w+)", texto, re.I):
        if ajena(m.group(1), "delete"): fallos.append(f"{f.name}: DELETE sobre tabla ajena {m.group(1)}")
    for m in re.finditer(r"(?<![\w.])update\s+public\.(\w+)\s+set", texto, re.I):
        if ajena(m.group(1), "update"): fallos.append(f"{f.name}: UPDATE sobre tabla ajena {m.group(1)}")
    for m in re.finditer(r"insert\s+into\s+public\.(\w+)", texto, re.I):
        if ajena(m.group(1), "insert"): fallos.append(f"{f.name}: INSERT sobre tabla ajena {m.group(1)}")
    for m in re.finditer(r"create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)", texto, re.I):
        if m.group(1) in funciones_previas: fallos.append(f"{f.name}: reemplaza una función existente ({m.group(1)})")
    for m in re.finditer(r"create\s+trigger\s+\w+\s+.*?\s+on\s+public\.(\w+)", texto, re.I | re.S):
        if m.group(1) not in nuevas: fallos.append(f"{f.name}: trigger sobre tabla ajena {m.group(1)}")
    if re.search(r"alter\s+default\s+privileges|alter\s+(?:role|database|system)", texto, re.I): fallos.append(f"{f.name}: cambia privilegios globales")
    for m in re.finditer(r"(?:grant|revoke)\s+.*?\s+on\s+(?:table\s+)?([\w.,\s]+?)\s+(?:from|to)\b", texto, re.I | re.S):
        for t in re.findall(r"public\.(\w+)", m.group(1)):
            if t not in nuevas and "function" not in m.group(0).lower(): fallos.append(f"{f.name}: GRANT/REVOKE sobre tabla ajena {t}")
if fallos:
    print("\n".join("FALLO: " + x for x in fallos)); sys.exit(1)
print("OK aditiva: lo existente no cambió y las migraciones de D2 solo crean objetos nuevos")
