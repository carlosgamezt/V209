#!/usr/bin/env python3
"""NEXA FEL · RECUPERACIÓN VERIFICADA de un respaldo persistente (paso 6). Se ejecuta EN TU EQUIPO (Windows 11 o Linux); solo usa la biblioteca estándar de Python.

Qué hace, en este orden (se detiene en el primer fallo):
  1. obtiene los tres objetos  <base>.dump.age · <base>.dump.sha256 · <base>.informe.txt  (de R2 con --descargar, o de una carpeta con --carpeta);
  2. comprueba el SHA-256 del archivo cifrado contra el informe;
  3. descifra con TU clave privada de age (solo se pasa su RUTA a «age -i»; este programa nunca la lee ni la imprime);
  4. comprueba el SHA-256 del volcado descifrado contra el .sha256, el informe y (si se indica) el valor esperado independiente;
  5. levanta un PostgreSQL 17 NUEVO y aislado (directorio temporal, 127.0.0.1, contraseña aleatoria, puerto propio) y restaura ahí: NUNCA toca nexa-demo ni ningún Supabase;
  6. verifica tablas, filas, historial de migraciones, políticas RLS y (si hay repositorio) el catálogo de la migración 29;
  7. apaga y borra todo (el volcado descifrado se sobrescribe antes de borrarlo).
Salida: 0 = «RECUPERACIÓN VERIFICADA: OK» · 1 = falló (con el motivo) · 2 = uso o requisitos.
Uso:
  python recuperar-respaldo.py --base nexa-demo/AAAAMMDD-HHMMSS-<sha8> --bucket <bucket> --clave <ruta-de-la-clave-privada-age> --pgbin <carpeta-bin-de-PostgreSQL-17> --repo <carpeta-fel> (--descargar | --carpeta <carpeta>)
  Con --descargar hacen falta las variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY (el envoltorio de PowerShell las pide sin mostrarlas; un token de SOLO LECTURA basta).
"""
import argparse, hashlib, os, re, secrets, shutil, subprocess, sys, tempfile, time

EXE = ".exe" if os.name == "nt" else ""
OKS, MALOS = [], []


def ok(m):
    print(f"  OK    {m}", flush=True)


def falla(m):
    print(f"  FALLO {m}", flush=True)
    print("RECUPERACIÓN VERIFICADA: FALLÓ", flush=True)
    raise SystemExit(1)


def uso(m):
    print(f"PROHIBIDO/REQUISITO: {m}", flush=True)
    raise SystemExit(2)


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ejecuta(cmd, env=None, entrada=None, ok_rc=(0,)):
    r = subprocess.run(cmd, env=env, input=entrada, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, r.stdout, r.stderr


class Pg:
    def __init__(s, pgbin, trabajo, puerto):
        s.bin, s.dir, s.puerto = pgbin, os.path.join(trabajo, "datos"), puerto
        s.clave = secrets.token_urlsafe(24)
        s.env = dict(os.environ, PGPASSWORD=s.clave, PGCONNECT_TIMEOUT="10")
        s.arrancado = False

    def b(s, n):
        return os.path.join(s.bin, n + EXE)

    def inicia(s):
        pw = os.path.join(os.path.dirname(s.dir), "pw.txt")
        with open(pw, "w") as f:
            f.write(s.clave)
        rc, o, e = ejecuta([s.b("initdb"), "-D", s.dir, "-U", "postgres", "-A", "scram-sha-256", "--pwfile=" + pw, "-E", "UTF8", "--locale=C"])
        os.remove(pw)
        if rc: falla("initdb falló: " + (e or o)[-200:].replace("\n", " "))
        opts = f"-p {s.puerto} -c listen_addresses=127.0.0.1" + ("" if os.name == "nt" else f" -c unix_socket_directories={os.path.dirname(s.dir)}")
        rc, o, e = ejecuta([s.b("pg_ctl"), "-D", s.dir, "-o", opts, "-w", "-t", "60", "-l", os.path.join(os.path.dirname(s.dir), "pg.log"), "start"])
        if rc: falla("no arrancó el PostgreSQL temporal: " + (e or o)[-200:].replace("\n", " "))
        s.arrancado = True

    def para(s):
        if s.arrancado:
            ejecuta([s.b("pg_ctl"), "-D", s.dir, "-m", "immediate", "stop"])
            s.arrancado = False

    def cx(s, base="postgres"):
        return ["-h", "127.0.0.1", "-p", str(s.puerto), "-U", "postgres", "-d", base]

    def psql(s, base, *args, entrada=None):
        return ejecuta([s.b("psql"), *s.cx(base), "-X", "-q", "-v", "ON_ERROR_STOP=1", *args], env=s.env, entrada=entrada)

    def consulta(s, base, sql):
        rc, o, e = s.psql(base, "-tA", "-c", sql)
        if rc: falla("consulta fallida en la base temporal: " + e.strip()[-200:].replace("\n", " "))
        return o.strip()

    def restore(s, base, *args):
        return ejecuta([s.b("pg_restore"), *s.cx(base), *args], env=s.env)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True); ap.add_argument("--bucket", default="nexa-fel-backups")
    ap.add_argument("--clave", required=True); ap.add_argument("--pgbin", required=True); ap.add_argument("--repo", default="")
    ap.add_argument("--age", default="age"); ap.add_argument("--puerto", type=int, default=54417); ap.add_argument("--sha-esperado", default=""); ap.add_argument("--pg-mayor", type=int, default=17, help="versión mayor exigida de PostgreSQL (17; solo las pruebas automáticas usan otra)")
    g = ap.add_mutually_exclusive_group(required=True); g.add_argument("--descargar", action="store_true"); g.add_argument("--carpeta")
    a = ap.parse_args()

    if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0: uso("PostgreSQL no se puede iniciar como administrador (root); ejecuta esto con un usuario normal")
    if not re.fullmatch(r"nexa-demo/[0-9]{8}-[0-9]{6}-[0-9a-f]{8}", a.base): uso("--base debe tener la forma nexa-demo/AAAAMMDD-HHMMSS-<sha8>")
    if not os.path.isfile(a.clave): uso("no existe el archivo de la clave privada indicado en --clave (solo se usa su ruta; no se lee aquí)")
    if a.sha_esperado and not re.fullmatch(r"[0-9a-f]{64}", a.sha_esperado): uso("--sha-esperado no es un SHA-256 de 64 hexadecimales")
    for h in ("initdb", "pg_ctl", "psql", "pg_restore"):
        if not os.path.isfile(os.path.join(a.pgbin, h + EXE)): uso(f"falta {h} en --pgbin ({a.pgbin}); se necesita PostgreSQL 17")
    rc, o, e = ejecuta([os.path.join(a.pgbin, "pg_restore" + EXE), "--version"])
    if rc or not re.search(rf"\) {a.pg_mayor}(\.|\b)", o + e): uso(f"pg_restore de --pgbin no es de PostgreSQL {a.pg_mayor}: " + o.strip())
    rc, o, e = ejecuta([a.age, "--version"])
    if rc: uso("no se encontró age (instálalo: winget install FiloSottile.age)")
    if a.descargar and not all(os.environ.get(k) for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")): uso("con --descargar hacen falta R2_ACCOUNT_ID, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY")
    aqui = os.path.dirname(os.path.abspath(__file__)); fel = os.path.abspath(a.repo) if a.repo else os.path.dirname(aqui)

    trabajo = tempfile.mkdtemp(prefix="nexa-recuperacion-"); os.chmod(trabajo, 0o700)
    pg = Pg(a.pgbin, trabajo, a.puerto)
    descifrado = os.path.join(trabajo, "respaldo.dump")
    try:
        print(f"== NEXA FEL · RECUPERACIÓN VERIFICADA de {a.base} · todo en un PostgreSQL 17 temporal y aislado; nexa-demo NO se toca", flush=True)
        # ---- 1. obtener los tres objetos
        desc = os.path.join(trabajo, "descarga"); os.makedirs(desc)
        ext = {"age": "dump.age", "sha": "dump.sha256", "inf": "informe.txt"}; arch = {k: os.path.join(desc, v) for k, v in ext.items()}
        for k, v in ext.items():
            if a.descargar:
                rc, o, e = ejecuta([sys.executable, os.path.join(aqui, "r2_subir.py"), "bajar", a.bucket, f"{a.base}.{v}", arch[k]])
                if rc: falla(f"no se pudo descargar {a.base}.{v}: {(e or o).strip()[:200]}")
            else:
                orig = os.path.join(a.carpeta, os.path.basename(a.base) + "." + v)
                if not os.path.isfile(orig): falla(f"falta en la carpeta {os.path.basename(a.base)}.{v}")
                shutil.copyfile(orig, arch[k])
            if os.path.getsize(arch[k]) == 0: falla(f"{v} está vacío")
        ok(f"los tres objetos obtenidos ({'descargados de R2' if a.descargar else 'copiados de la carpeta'}): cifrado {os.path.getsize(arch['age'])} bytes · huella {os.path.getsize(arch['sha'])} bytes · informe {os.path.getsize(arch['inf'])} bytes")
        informe = open(arch["inf"], encoding="utf-8").read()
        m_cif = re.search(r"SHA-256 del cifrado ([0-9a-f]{64})", informe); m_cla = re.search(r"volcado en claro[^:]*: ([0-9a-f]{64}) · (\d+) bytes", informe)
        m_con = re.search(r"contenido: (\d+) tablas · (\d+) filas · (\d+) migraciones", informe)
        if not (m_cif and m_cla and m_con): falla("el informe no tiene el formato esperado")
        # ---- 2. huella del cifrado
        if sha256(arch["age"]) != m_cif[1]: falla("el SHA-256 del archivo CIFRADO no coincide con el del informe: el archivo se alteró o se dañó. No se descifra.")
        ok(f"SHA-256 del archivo cifrado = informe ({m_cif[1][:16]}…)")
        # ---- 3. descifrar
        rc, o, e = ejecuta([a.age, "-d", "-i", a.clave, "-o", descifrado, arch["age"]])
        if rc or not os.path.isfile(descifrado) or os.path.getsize(descifrado) == 0: falla("age no pudo descifrar (¿es la clave privada correcta de este respaldo?): " + re.sub(r"AGE-SECRET-KEY-\S+", "***", (e or o).strip())[:160])
        ok(f"descifrado con tu clave privada: {os.path.getsize(descifrado)} bytes")
        # ---- 4. huella del volcado
        s = sha256(descifrado); decl = open(arch["sha"], encoding="utf-8").read().split()[0]
        if not re.fullmatch(r"[0-9a-f]{64}", decl): falla("el archivo .sha256 no tiene un SHA-256 válido")
        if s != decl or s != m_cla[1] or os.path.getsize(descifrado) != int(m_cla[2]): falla(f"el SHA-256 del volcado descifrado ({s[:16]}…) no coincide con el .sha256 y el informe")
        if a.sha_esperado and s != a.sha_esperado: falla("el SHA-256 del volcado descifrado no coincide con el valor esperado que indicaste")
        ok(f"SHA-256 del volcado descifrado = .sha256 = informe{' = valor esperado independiente' if a.sha_esperado else ''}: {s}")
        rc, lista, e = ejecuta([os.path.join(a.pgbin, "pg_restore" + EXE), "--list", descifrado])
        if rc or "TABLE DATA public empresas" not in lista or "TABLE DATA supabase_migrations schema_migrations" not in lista: falla("pg_restore --list no reconoce el volcado (faltan los datos de empresas o del historial)")
        ok("pg_restore --list: el volcado contiene los datos de public y el historial de migraciones")
        # ---- 5. PostgreSQL 17 nuevo y restauración
        pg.inicia()
        ver = pg.consulta("postgres", "select current_setting('server_version_num')::int / 10000")
        if ver != str(a.pg_mayor): falla(f"el PostgreSQL temporal es de la versión {ver}, no la {a.pg_mayor}")
        ok(f"PostgreSQL {ver} temporal e independiente (127.0.0.1:{a.puerto}, directorio y contraseña aleatorios)")
        shim = os.path.join(fel, "tools", "shim_supabase.sql")
        if not os.path.isfile(shim): falla("falta tools/shim_supabase.sql (indica --repo con la carpeta fel del repositorio actualizado)")
        BD = "recuperacion"
        rc, o, e = pg.psql("postgres", "-c", f"create database {BD}")
        if rc: falla("no se pudo crear la base temporal: " + e[-160:])
        rc, o, e = pg.psql(BD, "-f", shim)
        if rc: falla("no se pudo preparar la base temporal (roles y esquema auth mínimos): " + e[-160:])
        pg.psql(BD, "-c", "alter default privileges in schema public revoke all on tables from anon, authenticated, service_role", "-c", "alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role", "-c", "alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role")
        sin_schema = os.path.join(trabajo, "lista.txt")
        open(sin_schema, "w", encoding="utf-8").write("".join(l for l in lista.splitlines(True) if " SCHEMA - public " not in l))
        rc, todo, e = ejecuta([os.path.join(a.pgbin, "pg_restore" + EXE), "-L", sin_schema, "-f", "-", descifrado])
        if rc: falla("no se pudo leer el contenido del volcado")
        nombres = set()
        for mm in re.finditer(r"^(?:GRANT|REVOKE)\b[^;]*?\b(?:TO|FROM)\s+([^;]+);", todo, re.M | re.S):
            resto = re.split(r"\s+(?:GRANTED BY|WITH GRANT OPTION|CASCADE|RESTRICT)\b", mm.group(1))[0]
            nombres |= {x.strip().strip('"') for x in resto.split(",")}
        for mm in re.finditer(r"ALTER DEFAULT PRIVILEGES FOR ROLE\s+(\S+)", todo): nombres.add(mm.group(1).strip('"'))
        for r in sorted(n for n in nombres - {"PUBLIC", "CURRENT_USER", "CURRENT_ROLE", "SESSION_USER", "postgres", ""} if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", n)):
            if pg.consulta(BD, f"select exists (select 1 from pg_roles where rolname = '{r}')") != "t": pg.psql(BD, "-c", f'create role "{r}" nologin')
        for sec, extra in (("pre-data", []), ("data", ["--disable-triggers"])):
            rc, o, e = pg.restore(BD, "--no-owner", "--exit-on-error", f"--section={sec}", *extra, "-L", sin_schema, descifrado)
            if rc: falla(f"la restauración ({sec}) falló: {e.strip()[-200:]}")
        rc, post, e = ejecuta([os.path.join(a.pgbin, "pg_restore" + EXE), "--section=post-data", "-L", sin_schema, "-f", "-", descifrado])
        pares = set(re.findall(r"ALTER TABLE ONLY ([\w\".]+)\s+ADD CONSTRAINT [\w\"]+ FOREIGN KEY \((\w+)\) REFERENCES auth\.users\(id\)", post))
        if pares:
            sql = "".join(f"insert into auth.users (id, email) select distinct {c}, 'recuperacion-' || {c}::text || '@invalido.test' from {t} where {c} is not null on conflict do nothing;\n" for t, c in sorted(pares))
            rc, o, e = pg.psql(BD, entrada=sql)
            if rc: falla("no se pudieron crear los usuarios de prueba para las claves foráneas: " + e[-160:])
        rc, o, e = pg.restore(BD, "--no-owner", "--exit-on-error", "--section=post-data", "-L", sin_schema, descifrado)
        if rc: falla("la restauración (restricciones e índices) falló: " + e.strip()[-200:])
        ok("restauración completa en la base temporal (estructura, datos, restricciones e índices, permisos)")
        # ---- 6. verificaciones
        tablas = [r.split("|") for r in pg.consulta(BD, "select schemaname || '|' || tablename from pg_tables where schemaname in ('public', 'supabase_migrations') order by 1").splitlines() if r]
        total = 0
        sqlc = " union all ".join(f"select count(*) from \"{sc}\".\"{tb}\"" for sc, tb in tablas)
        total = int(pg.consulta(BD, f"select sum(n) from ({sqlc.replace('select count(*)', 'select count(*) as n')}) x"))
        if len(tablas) != int(m_con[1]) or total != int(m_con[2]): falla(f"tablas/filas restauradas ({len(tablas)} tablas · {total} filas) distintas de las del informe ({m_con[1]} tablas · {m_con[2]} filas)")
        ok(f"tablas y registros: {len(tablas)} tablas · {total} filas, exactamente las del informe")
        nm = pg.consulta(BD, "select count(*) from supabase_migrations.schema_migrations"); vers = pg.consulta(BD, "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations").split()
        if nm != m_con[3]: falla(f"el historial restaurado tiene {nm} migraciones y el informe {m_con[3]}")
        mig = os.path.join(fel, "supabase", "migrations")
        if os.path.isdir(mig):
            repo = sorted(f.split("_")[0] for f in os.listdir(mig) if f.endswith(".sql") and f.split("_")[0] <= vers[-1])
            if repo != vers: falla("las versiones del historial restaurado no coinciden con las del repositorio")
            ok(f"historial de migraciones: {nm} versiones, idénticas a supabase/migrations del repositorio (última {vers[-1]})")
        else:
            ok(f"historial de migraciones: {nm} versiones (última {vers[-1]}; sin repositorio para compararlas)")
        sin_rls = pg.consulta(BD, "select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity")
        ncon = pg.consulta(BD, "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity"); npol = pg.consulta(BD, "select count(*) from pg_policies where schemaname = 'public'")
        if sin_rls or int(ncon) == 0 or int(npol) == 0: falla(f"RLS incompleta: tablas de public sin RLS: {sin_rls or 'ninguna'} · con RLS: {ncon} · políticas: {npol}")
        ok(f"RLS: las {ncon} tablas de public tienen RLS activa y hay {npol} políticas")
        ver29 = os.path.join(fel, "docs", "migracion-29", "verificacion-posterior-29.sql")
        if os.path.isfile(ver29) and pg.consulta(BD, "select to_regclass('public.digifact_operaciones') is not null") == "t":
            if pg.consulta(BD, "select to_regprocedure('public.rls_auto_enable()') is not null") == "t":
                pg.psql(BD, "-c", "drop event trigger if exists ensure_rls", "-c", "create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute function public.rls_auto_enable()")
            rc, o, e = pg.psql(BD, entrada="\\set ON_ERROR_STOP on\nbegin transaction read only;\n\\i " + ver29.replace("\\", "/") + "\n")
            if rc or "VERIFICACION POSTERIOR 29 OK" not in o + e: falla("el catálogo de la migración 29 no pasa en lo restaurado: " + (e or o).strip()[-200:])
            ok("catálogo de la migración 29 sano en lo restaurado (políticas, funciones, disparadores y privilegios; transacción de solo lectura)")
        print("  LIMITACIONES (no son prueba): roles y membresías, extensiones, disparadores de evento de la plataforma, auth/storage/vault y expresiones CHECK/políticas no se reproducen; los usuarios de Auth son de prueba", flush=True)
        print(f"== INFORME (sin datos): {a.base} · {len(tablas)} tablas · {total} filas · {nm} migraciones · RLS {ncon} tablas / {npol} políticas · SHA-256 {s}", flush=True)
        print("RECUPERACIÓN VERIFICADA: OK", flush=True)
        return 0
    finally:
        pg.para()
        try:
            if os.path.isfile(descifrado):
                n = os.path.getsize(descifrado)
                with open(descifrado, "r+b") as f:
                    f.write(b"\0" * n); f.flush(); os.fsync(f.fileno())
        except OSError:
            pass
        shutil.rmtree(trabajo, ignore_errors=True)
        print("  OK    PostgreSQL temporal apagado y archivos temporales (volcado descifrado incluido) sobrescritos y borrados" if not os.path.exists(trabajo) else f"  AVISO: no se pudo borrar {trabajo}; bórralo a mano", flush=True)


if __name__ == "__main__":
    sys.exit(main())
