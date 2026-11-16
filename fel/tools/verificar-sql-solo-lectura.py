#!/usr/bin/env python3
"""Verificador estático de un SQL de verificación: solo puede contener sentencias SELECT (y órdenes \\pset de psql). Falla (exit 1) ante cualquier otra cosa.
Uso: python3 tools/verificar-sql-solo-lectura.py archivo.sql   ·   Es una capa MÁS: la barrera real es la transacción de solo lectura (tools/sql-solo-lectura.sh)."""
import re, sys
PROHIBIDO = [r"\binto\b", r"\bset_config\b", r"\bnextval\b", r"\bsetval\b", r"\bpg_advisory\w*", r"\blo_\w+", r"\bpg_terminate_backend\b", r"\bpg_cancel_backend\b", r"\bpg_reload_conf\b",
             r"\bpg_rotate_logfile\b", r"\bdblink\w*", r"\bcopy\b", r"\bpg_switch_wal\b", r"\bpg_create_\w+", r"\bpg_drop_\w+", r"\bpg_promote\b", r"\bpg_read_file\b", r"\bpg_ls_dir\b"]
def revisar(texto: str) -> list[str]:
    errores = []
    sin_comentarios = re.sub(r"--[^\n]*", "", texto)
    sin_literales = re.sub(r"'(?:[^']|'')*'", "''", sin_comentarios)      # el contenido de los textos no cuenta (p. ej. 'CREATE' como argumento)
    if "$$" in sin_literales or "/*" in sin_literales: errores.append("no se admiten bloques $$ ni comentarios /* */")
    lineas = [l for l in sin_literales.splitlines() if not l.lstrip().startswith("\\")]   # órdenes de psql (\pset): solo \pset
    for l in sin_literales.splitlines():
        if l.lstrip().startswith("\\") and not re.match(r"\s*\\pset\s", l): errores.append(f"orden de psql no permitida: {l.strip()[:60]}")
    cuerpo = "\n".join(lineas)
    sentencias = [s.strip() for s in cuerpo.split(";") if s.strip()]
    if not sentencias: errores.append("no hay ninguna sentencia")
    for s in sentencias:
        if not re.match(r"(?is)^select\b", s): errores.append(f"la sentencia no empieza por SELECT: {s[:50]!r}")
    for p in PROHIBIDO:
        if re.search(p, cuerpo, re.I): errores.append(f"construcción no permitida en una verificación de solo lectura: {p}")
    return errores
if __name__ == "__main__":
    if len(sys.argv) != 2: print("uso: verificar-sql-solo-lectura.py archivo.sql"); sys.exit(2)
    e = revisar(open(sys.argv[1], encoding="utf-8").read())
    if e: print("\n".join("NO PERMITIDO: " + x for x in e)); sys.exit(1)
    print("OK: el SQL solo contiene SELECT"); sys.exit(0)
