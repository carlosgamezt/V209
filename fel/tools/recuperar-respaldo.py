#!/usr/bin/env python3
"""NEXA FEL · RECUPERACIÓN VERIFICADA de un respaldo persistente (paso 6). Se ejecuta EN TU EQUIPO (Windows 11 o Linux); solo usa la biblioteca estándar de Python.

Qué hace, en este orden (se detiene en el primer fallo):
  1. obtiene los tres objetos  <base>.dump.age · <base>.dump.sha256 · <base>.informe.txt  (de R2 con --descargar, o de una carpeta con --carpeta);
  2. comprueba el SHA-256 del archivo cifrado contra el informe;
  3. descifra con TU clave privada de age (solo se pasa su RUTA a «age -i»; este programa nunca la lee ni la imprime);
  4. comprueba el SHA-256 del volcado descifrado contra el .sha256, el informe y (si se indica) el valor esperado independiente;
  5. levanta un PostgreSQL 17 NUEVO y aislado y restaura ahí: NUNCA toca nexa-demo ni ningún Supabase ni una base local que ya tengas.
       --docker : contenedor «postgres:17» con nombre único y SIN puertos publicados (solo se entra con «docker exec»); se elimina al terminar.
       nativo   : PostgreSQL 17 instalado (--pgbin); clúster nuevo en un directorio temporal, 127.0.0.1, puerto libre, contraseña aleatoria.
  6. verifica tablas, filas, historial de migraciones, políticas RLS y (si hay repositorio) el catálogo de la migración 29;
  7. apaga y borra todo (el volcado descifrado se sobrescribe antes de borrarlo) y escribe un INFORME de recuperación sin datos ni claves.
Salida: 0 = «RECUPERACIÓN VERIFICADA: OK» · 1 = falló (con el motivo) · 2 = uso o requisitos.
Uso:
  python recuperar-respaldo.py --base nexa-demo/AAAAMMDD-HHMMSS-<sha8> --bucket <bucket> --clave <ruta-de-la-clave-privada-age> --repo <carpeta-fel> (--docker | --pgbin <carpeta-bin-de-PostgreSQL-17>) (--descargar | --carpeta <carpeta>) [--informe <archivo>]
  Con --descargar hacen falta las variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY (el envoltorio de PowerShell las pide sin mostrarlas; un token de SOLO LECTURA basta).
"""
import argparse, datetime, hashlib, os, re, secrets, shutil, socket, subprocess, sys, tempfile

EXE = ".exe" if os.name == "nt" else ""
LINEAS = []          # todo lo que se muestra, para el informe final (nunca incluye secretos: no se imprimen)


def say(m):
    print(m, flush=True)
    LINEAS.append(m)


def ok(m):
    say(f"  OK    {m}")


def cierra(codigo, titulo, informe):
    say(titulo)
    if informe:
        try:
            cab = [f"NEXA FEL · informe de recuperación (sin datos ni claves) · {datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')} hora de este equipo", ""]
            with open(informe, "w", encoding="utf-8-sig") as f:      # con BOM: PowerShell 5 (Get-Content) y el Bloc de notas muestran bien los acentos
                f.write("\n".join(cab + LINEAS) + "\n")
            print(f"  INFO  informe guardado en {informe}", flush=True)
        except OSError as e:
            print(f"  AVISO no se pudo guardar el informe: {type(e).__name__}", flush=True)
    raise SystemExit(codigo)


class Fallo(Exception):
    pass


def falla(m):
    raise Fallo(m)


class Requisito(Exception):
    pass


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ejecuta(cmd, env=None, entrada=None):
    r = subprocess.run(cmd, env=env, input=entrada, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, r.stdout, r.stderr


def puerto_libre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Pg:
    """Un PostgreSQL 17 NUEVO y aislado, nativo (--pgbin) o en un contenedor (--docker). Siempre se crea de cero; nunca se reutiliza ni se sobrescribe nada existente."""

    def __init__(s, modo, pgbin, trabajo, imagen):
        s.modo, s.bin, s.trabajo, s.imagen = modo, pgbin, trabajo, imagen
        s.dir = os.path.join(trabajo, "datos"); s.puerto = puerto_libre() if modo == "nativo" else 0
        s.clave = secrets.token_urlsafe(24); s.nombre = "nexa-recuperacion-" + secrets.token_hex(4)
        s.env = dict(os.environ, PGPASSWORD=s.clave, PGCONNECT_TIMEOUT="10"); s.arrancado = False

    def b(s, n):
        return os.path.join(s.bin, n + EXE)

    def inicia(s):
        if s.modo == "docker":
            rc, o, e = ejecuta(["docker", "ps", "-a", "--filter", f"name=^{s.nombre}$", "-q"])
            if rc or o.strip(): falla("el nombre del contenedor ya existe (no se reutiliza nada existente)")
            # sin -p: ningún puerto publicado; solo «docker exec» entra. Contraseña aleatoria; el socket local del contenedor es la única vía.
            rc, o, e = ejecuta(["docker", "run", "-d", "--rm", "--name", s.nombre, "-e", f"POSTGRES_PASSWORD={s.clave}", "-e", "POSTGRES_HOST_AUTH_METHOD=scram-sha-256", s.imagen])
            if rc: falla("no se pudo crear el contenedor " + s.imagen + ": " + (e or o).strip()[-200:].replace("\n", " "))
            s.arrancado = True
            for _ in range(60):
                rc, o, e = ejecuta(["docker", "exec", s.nombre, "psql", "-U", "postgres", "-d", "postgres", "-tAc", "select 1"])
                if rc == 0 and o.strip() == "1": return
                import time; time.sleep(1)
            falla("el contenedor de PostgreSQL no quedó listo a tiempo")
        pw = os.path.join(s.trabajo, "pw.txt")
        with open(pw, "w") as f:
            f.write(s.clave)
        rc, o, e = ejecuta([s.b("initdb"), "-D", s.dir, "-U", "postgres", "-A", "scram-sha-256", "--pwfile=" + pw, "-E", "UTF8", "--locale=C"])
        os.remove(pw)
        if rc: falla("initdb falló: " + (e or o)[-200:].replace("\n", " "))
        opts = f"-p {s.puerto} -c listen_addresses=127.0.0.1" + ("" if os.name == "nt" else f" -c unix_socket_directories={s.trabajo}")
        rc, o, e = ejecuta([s.b("pg_ctl"), "-D", s.dir, "-o", opts, "-w", "-t", "60", "-l", os.path.join(s.trabajo, "pg.log"), "start"])
        if rc: falla("no arrancó el PostgreSQL temporal: " + (e or o)[-200:].replace("\n", " "))
        s.arrancado = True

    def para(s):
        if not s.arrancado: return
        if s.modo == "docker": ejecuta(["docker", "rm", "-f", s.nombre])
        else: ejecuta([s.b("pg_ctl"), "-D", s.dir, "-m", "immediate", "stop"])
        s.arrancado = False

    def _ex(s, herramienta, args, base=None, entrada=None, interactivo=False):
        if s.modo == "docker":
            pre = ["docker", "exec"] + (["-i"] if entrada is not None else []) + [s.nombre, herramienta, "-U", "postgres"] + (["-d", base] if base else [])
            return ejecuta(pre + args, entrada=entrada)
        cx = ["-h", "127.0.0.1", "-p", str(s.puerto), "-U", "postgres"] + (["-d", base] if base else [])
        return ejecuta([s.b(herramienta)] + cx + args, env=s.env, entrada=entrada)

    def psql(s, base, *args, entrada=None):
        return s._ex("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", *args], base, entrada)

    def consulta(s, base, sql):
        rc, o, e = s.psql(base, "-tA", "-c", sql)
        if rc: falla("consulta fallida en la base temporal: " + e.strip()[-200:].replace("\n", " "))
        return o.strip()

    def sube(s, ruta, nombre):
        """Pone un archivo donde pg_restore lo pueda leer; devuelve la ruta que PostgreSQL debe usar."""
        if s.modo != "docker": return ruta
        destino = "/tmp/" + nombre
        rc, o, e = ejecuta(["docker", "cp", ruta, f"{s.nombre}:{destino}"])
        if rc: falla("no se pudo copiar un archivo al contenedor: " + (e or o).strip()[-160:])
        return destino

    def restore(s, base, *args):
        return s._ex("pg_restore", list(args), base)

    def restore_texto(s, *args):
        return s._ex("pg_restore", list(args))


def principal(a, informe_ruta):
    if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0 and not a.docker: raise Requisito("PostgreSQL no se puede iniciar como administrador (root); ejecuta esto con un usuario normal")
    if not re.fullmatch(r"nexa-demo/[0-9]{8}-[0-9]{6}-[0-9a-f]{8}", a.base): raise Requisito("--base debe tener la forma nexa-demo/AAAAMMDD-HHMMSS-<sha8>")
    if not os.path.isfile(a.clave): raise Requisito("no existe el archivo de la clave privada indicado en --clave (solo se usa su ruta; no se lee aquí)")
    if a.sha_esperado and not re.fullmatch(r"[0-9a-f]{64}", a.sha_esperado): raise Requisito("--sha-esperado no es un SHA-256 de 64 hexadecimales")
    if a.docker:
        rc, o, e = ejecuta(["docker", "info"])
        if rc: raise Requisito("Docker no está disponible o no está en marcha (abre Docker Desktop y espera a que diga «running»), o usa --pgbin con PostgreSQL 17 instalado")
        if not re.fullmatch(r"postgres:17[A-Za-z0-9.\-]*", a.imagen): raise Requisito("--imagen debe ser postgres:17 (o una etiqueta 17 de esa imagen)")
    else:
        if not a.pgbin: raise Requisito("indica --docker o --pgbin <carpeta bin de PostgreSQL 17>")
        for h in ("initdb", "pg_ctl", "psql", "pg_restore"):
            if not os.path.isfile(os.path.join(a.pgbin, h + EXE)): raise Requisito(f"falta {h} en --pgbin ({a.pgbin}); se necesita PostgreSQL 17")
        rc, o, e = ejecuta([os.path.join(a.pgbin, "pg_restore" + EXE), "--version"])
        if rc or not re.search(rf"\) {a.pg_mayor}(\.|\b)", o + e): raise Requisito(f"pg_restore de --pgbin no es de PostgreSQL {a.pg_mayor}: " + o.strip())
    rc, o, e = ejecuta([a.age, "--version"])
    if rc: raise Requisito("no se encontró age (instálalo: winget install FiloSottile.age)")
    if a.descargar and not all(os.environ.get(k) for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")): raise Requisito("con --descargar hacen falta R2_ACCOUNT_ID, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY")
    aqui = os.path.dirname(os.path.abspath(__file__)); fel = os.path.abspath(a.repo) if a.repo else os.path.dirname(aqui)

    trabajo = tempfile.mkdtemp(prefix="nexa-recuperacion-"); os.chmod(trabajo, 0o700)
    pg = Pg("docker" if a.docker else "nativo", a.pgbin, trabajo, a.imagen)
    descifrado = os.path.join(trabajo, "respaldo.dump")
    try:
        say(f"== NEXA FEL · RECUPERACIÓN VERIFICADA de {a.base} · todo en un PostgreSQL 17 {'(contenedor Docker sin puertos publicados)' if a.docker else '(clúster nuevo y local)'} aislado; nexa-demo NO se toca")
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
        # ---- 5. PostgreSQL 17 nuevo y restauración
        pg.inicia()
        ver = pg.consulta("postgres", "select current_setting('server_version_num')::int / 10000")
        if ver != str(a.pg_mayor): falla(f"el PostgreSQL temporal es de la versión {ver}, no la {a.pg_mayor}")
        ok(f"PostgreSQL {ver} temporal e independiente ({'contenedor ' + pg.nombre + ', sin puertos publicados' if a.docker else '127.0.0.1:' + str(pg.puerto) + ', directorio y contraseña aleatorios'})")
        dump_pg = pg.sube(descifrado, "respaldo.dump")
        rc, lista, e = pg.restore_texto("--list", dump_pg)
        if rc or "TABLE DATA public empresas" not in lista or "TABLE DATA supabase_migrations schema_migrations" not in lista: falla("pg_restore --list no reconoce el volcado (faltan los datos de empresas o del historial)")
        ok("pg_restore --list: el volcado contiene los datos de public y el historial de migraciones")
        shim = os.path.join(fel, "tools", "shim_supabase.sql")
        if not os.path.isfile(shim): falla("falta tools/shim_supabase.sql (indica --repo con la carpeta fel del repositorio actualizado)")
        BD = "recuperacion"
        rc, o, e = pg.psql("postgres", "-c", f"create database {BD}")
        if rc: falla("no se pudo crear la base temporal: " + e[-160:])
        rc, o, e = pg.psql(BD, entrada=open(shim, encoding="utf-8").read())
        if rc: falla("no se pudo preparar la base temporal (roles y esquema auth mínimos): " + e[-160:])
        pg.psql(BD, "-c", "alter default privileges in schema public revoke all on tables from anon, authenticated, service_role", "-c", "alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role", "-c", "alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role")
        sin_schema = os.path.join(trabajo, "lista.txt")
        open(sin_schema, "w", encoding="utf-8", newline="\n").write("".join(l for l in lista.splitlines(True) if " SCHEMA - public " not in l))
        lista_pg = pg.sube(sin_schema, "lista.txt")
        rc, todo, e = pg.restore_texto("-L", lista_pg, "-f", "-", dump_pg)
        if rc: falla("no se pudo leer el contenido del volcado")
        nombres = set()
        for mm in re.finditer(r"^(?:GRANT|REVOKE)\b[^;]*?\b(?:TO|FROM)\s+([^;]+);", todo, re.M | re.S):
            resto = re.split(r"\s+(?:GRANTED BY|WITH GRANT OPTION|CASCADE|RESTRICT)\b", mm.group(1))[0]
            nombres |= {x.strip().strip('"') for x in resto.split(",")}
        for mm in re.finditer(r"ALTER DEFAULT PRIVILEGES FOR ROLE\s+(\S+)", todo): nombres.add(mm.group(1).strip('"'))
        for r in sorted(n for n in nombres - {"PUBLIC", "CURRENT_USER", "CURRENT_ROLE", "SESSION_USER", "postgres", ""} if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", n)):
            if pg.consulta(BD, f"select exists (select 1 from pg_roles where rolname = '{r}')") != "t": pg.psql(BD, "-c", f'create role "{r}" nologin')
        for sec, extra in (("pre-data", []), ("data", ["--disable-triggers"])):
            rc, o, e = pg.restore(BD, "--no-owner", "--exit-on-error", f"--section={sec}", *extra, "-L", lista_pg, dump_pg)
            if rc: falla(f"la restauración ({sec}) falló: {e.strip()[-200:]}")
        rc, post, e = pg.restore_texto("--section=post-data", "-L", lista_pg, "-f", "-", dump_pg)
        pares = set(re.findall(r"ALTER TABLE ONLY ([\w\".]+)\s+ADD CONSTRAINT [\w\"]+ FOREIGN KEY \((\w+)\) REFERENCES auth\.users\(id\)", post))
        if pares:
            sql = "".join(f"insert into auth.users (id, email) select distinct {c}, 'recuperacion-' || {c}::text || '@invalido.test' from {t} where {c} is not null on conflict do nothing;\n" for t, c in sorted(pares))
            rc, o, e = pg.psql(BD, entrada=sql)
            if rc: falla("no se pudieron crear los usuarios de prueba para las claves foráneas: " + e[-160:])
        rc, o, e = pg.restore(BD, "--no-owner", "--exit-on-error", "--section=post-data", "-L", lista_pg, dump_pg)
        if rc: falla("la restauración (restricciones e índices) falló: " + e.strip()[-200:])
        ok("restauración completa en la base temporal (estructura, datos, restricciones e índices, permisos)")
        # ---- 6. verificaciones
        tablas = [r.split("|") for r in pg.consulta(BD, "select schemaname || '|' || tablename from pg_tables where schemaname in ('public', 'supabase_migrations') order by 1").splitlines() if r]
        sqlc = " union all ".join(f"select count(*) as n from \"{sc}\".\"{tb}\"" for sc, tb in tablas)
        total = int(pg.consulta(BD, f"select sum(n) from ({sqlc}) x"))
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
        # la migración 30 (tipos de documento) debe estar exactamente cuando el historial la registra (30 versiones): ni a medias ni sin registrar
        dos = pg.consulta(BD, "select (to_regclass('public.fel_tipos_dte') is not null) || '/' || (to_regclass('public.empresa_tipos_documento') is not null)")
        if dos not in ("true/true", "false/false", "t/t", "f/f"): falla(f"la migración 30 está a medias en lo restaurado (tablas presentes: {dos})")
        con30 = dos in ("true/true", "t/t")
        if con30 != (nm == "30"): falla(f"deriva entre el historial ({nm} migraciones) y la base (la migración 30 {'presente' if con30 else 'ausente'})")
        if con30: ok("la migración 30 (tipos de documento) está registrada en el historial y presente en lo restaurado")
        sin_rls = pg.consulta(BD, "select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity")
        ncon = pg.consulta(BD, "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity"); npol = pg.consulta(BD, "select count(*) from pg_policies where schemaname = 'public'")
        if sin_rls or int(ncon) == 0 or int(npol) == 0: falla(f"RLS incompleta: tablas de public sin RLS: {sin_rls or 'ninguna'} · con RLS: {ncon} · políticas: {npol}")
        ok(f"RLS: las {ncon} tablas de public tienen RLS activa y hay {npol} políticas")
        ver29 = os.path.join(fel, "docs", "migracion-29", "verificacion-posterior-29.sql")
        if os.path.isfile(ver29) and pg.consulta(BD, "select to_regclass('public.digifact_operaciones') is not null") == "t":
            if pg.consulta(BD, "select to_regprocedure('public.rls_auto_enable()') is not null") == "t":
                pg.psql(BD, "-c", "drop event trigger if exists ensure_rls", "-c", "create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute function public.rls_auto_enable()")
            rc, o, e = pg.psql(BD, entrada="\\set ON_ERROR_STOP on\nbegin transaction read only;\n" + open(ver29, encoding="utf-8").read() + "\n")
            if rc or "VERIFICACION POSTERIOR 29 OK" not in o + e: falla("el catálogo de la migración 29 no pasa en lo restaurado: " + (e or o).strip()[-200:])
            ok("catálogo de la migración 29 sano en lo restaurado (políticas, funciones, disparadores y privilegios; transacción de solo lectura)")
        if con30:
            ver30 = os.path.join(fel, "docs", "migracion-tipos-documento", "verificacion-tipos.sql")
            if not os.path.isfile(ver30): falla("falta docs/migracion-tipos-documento/verificacion-tipos.sql (indica --repo con la carpeta fel del repositorio actualizado)")
            rc, o, e = pg.psql(BD, "-tA", "-F", "|", entrada="\\set ON_ERROR_STOP on\nbegin transaction read only;\n" + open(ver30, encoding="utf-8").read() + "\n")
            filas = [l for l in o.splitlines() if l.count("|") >= 3]
            if rc or not filas or any(l.endswith("|f") for l in filas) or not any(l.endswith("|t") for l in filas): falla("la verificación de la migración 30 no pasa en lo restaurado: " + (e or o).strip()[-200:].replace("\n", " "))
            ok(f"verificación de la migración 30 sana en lo restaurado ({len(filas)} controles de tipos de documento, todos con ok = true; solo lectura)")
        say("  LIMITACIONES (no son prueba): roles y membresías, extensiones, disparadores de evento de la plataforma, auth/storage/vault y expresiones CHECK/políticas no se reproducen; los usuarios de Auth son de prueba")
        say(f"== INFORME (sin datos): {a.base} · {len(tablas)} tablas · {total} filas · {nm} migraciones · RLS {ncon} tablas / {npol} políticas · SHA-256 {s}")
        return 0, "RECUPERACIÓN VERIFICADA: OK"
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
        say("  OK    PostgreSQL temporal apagado y eliminado, y archivos temporales (volcado descifrado incluido) sobrescritos y borrados" if not os.path.exists(trabajo) else f"  AVISO: no se pudo borrar {trabajo}; bórralo a mano")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True); ap.add_argument("--bucket", default="nexa-fel-backups")
    ap.add_argument("--clave", required=True); ap.add_argument("--pgbin", default=""); ap.add_argument("--repo", default="")
    ap.add_argument("--age", default="age"); ap.add_argument("--sha-esperado", default="")
    ap.add_argument("--pg-mayor", type=int, default=17, help="versión mayor exigida de PostgreSQL (17; solo las pruebas automáticas usan otra)")
    ap.add_argument("--docker", action="store_true"); ap.add_argument("--imagen", default="postgres:17"); ap.add_argument("--informe", default="")
    g = ap.add_mutually_exclusive_group(required=True); g.add_argument("--descargar", action="store_true"); g.add_argument("--carpeta")
    a = ap.parse_args()
    informe = a.informe or ""
    if informe and os.path.exists(informe):
        print("PROHIBIDO/REQUISITO: el archivo de informe ya existe; no se sobrescribe. Elige otro nombre con --informe.", flush=True); return 2
    try:
        codigo, titulo = principal(a, informe)
    except Requisito as e:
        print(f"PROHIBIDO/REQUISITO: {e}", flush=True); return 2
    except Fallo as e:
        say(f"  FALLO {e}"); cierra(1, "RECUPERACIÓN VERIFICADA: FALLÓ", informe)
    cierra(codigo, titulo, informe)


if __name__ == "__main__":
    sys.exit(main())
