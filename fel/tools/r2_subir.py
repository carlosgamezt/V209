#!/usr/bin/env python3
"""Sube UN archivo a un bucket PRIVADO de Cloudflare R2 (API compatible con S3, firma SigV4) usando solo la biblioteca estándar.

Uso:  r2_subir.py poner <bucket> <clave-del-objeto> <archivo>     PUT sin sobrescribir (If-None-Match: *) + HEAD de verificación (tamaño y ETag = MD5)
      r2_subir.py cabecera <bucket> <clave-del-objeto>            HEAD (existe y qué tamaño tiene)
      r2_subir.py bajar <bucket> <clave-del-objeto> <destino>     GET firmado a un archivo NUEVO (no sobrescribe) y comprobación del tamaño anunciado
Entorno obligatorio: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.  Nada de esto se imprime nunca.
Solo para pruebas locales: FEL_R2_ENDPOINT_PRUEBA=http://127.0.0.1:<puerto> (se rechaza cualquier otro anfitrión).
Salida: 0 = hecho · 1 = falló (el motivo va a stderr, sin credenciales) · 2 = uso o entorno inválido.
"""
import datetime, hashlib, hmac, http.client, os, re, sys, urllib.parse

REGION, SERVICIO = "auto", "s3"


def sale(codigo, msg):
    print(msg, file=sys.stderr)
    sys.exit(codigo)


def entorno():
    cuenta, kid, secreto = (os.environ.get(k, "") for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"))
    if not (cuenta and kid and secreto):
        sale(2, "R2: faltan R2_ACCOUNT_ID, R2_ACCESS_KEY_ID o R2_SECRET_ACCESS_KEY")
    if not re.fullmatch(r"[0-9a-f]{32}", cuenta):
        sale(2, "R2: R2_ACCOUNT_ID no tiene el formato esperado (32 hexadecimales)")
    prueba = os.environ.get("FEL_R2_ENDPOINT_PRUEBA", "")
    if prueba:
        u = urllib.parse.urlsplit(prueba)
        if u.scheme != "http" or u.hostname != "127.0.0.1" or not u.port:
            sale(2, "R2: el destino de prueba solo puede ser http://127.0.0.1:<puerto>")
        return cuenta, kid, secreto, ("http", "127.0.0.1", u.port)
    return cuenta, kid, secreto, ("https", f"{cuenta}.r2.cloudflarestorage.com", 443)


def validar(bucket, clave):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", bucket):
        sale(2, "R2: nombre de bucket inválido")
    if not re.fullmatch(r"nexa-demo/[0-9]{8}-[0-9]{6}-[0-9a-f]{8}\.(dump\.age|dump\.sha256|informe\.txt)", clave):
        sale(2, "R2: la clave del objeto debe ser nexa-demo/AAAAMMDD-HHMMSS-<sha8>.(dump.age|dump.sha256|informe.txt)")


def firma(secreto, kid, metodo, ruta, host, cabeceras, hash_cuerpo, ahora):
    fecha, sello = ahora.strftime("%Y%m%d"), ahora.strftime("%Y%m%dT%H%M%SZ")
    h = {k.lower(): v.strip() for k, v in cabeceras.items()}
    h.update({"host": host, "x-amz-content-sha256": hash_cuerpo, "x-amz-date": sello})
    nombres = sorted(h)
    canon = "\n".join([metodo, ruta, "", "".join(f"{k}:{h[k]}\n" for k in nombres), ";".join(nombres), hash_cuerpo])
    ambito = f"{fecha}/{REGION}/{SERVICIO}/aws4_request"
    a_firmar = "\n".join(["AWS4-HMAC-SHA256", sello, ambito, hashlib.sha256(canon.encode()).hexdigest()])
    k = ("AWS4" + secreto).encode()
    for parte in (fecha, REGION, SERVICIO, "aws4_request"):
        k = hmac.new(k, parte.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, a_firmar.encode(), hashlib.sha256).hexdigest()
    h["authorization"] = f"AWS4-HMAC-SHA256 Credential={kid}/{ambito}, SignedHeaders={';'.join(nombres)}, Signature={sig}"
    return h


def peticion(metodo, bucket, clave, archivo=None, sin_sobrescribir=False):
    cuenta, kid, secreto, (esquema, host, puerto) = entorno()
    ruta = "/" + urllib.parse.quote(f"{bucket}/{clave}", safe="/-_.~")
    extra = {"if-none-match": "*"} if (metodo == "PUT" and sin_sobrescribir) else {}
    if archivo:
        sha, md5, tam = hashlib.sha256(), hashlib.md5(), 0
        with open(archivo, "rb") as f:
            for bloque in iter(lambda: f.read(1 << 20), b""):
                sha.update(bloque); md5.update(bloque); tam += len(bloque)
        hash_cuerpo = sha.hexdigest()
    else:
        hash_cuerpo, md5, tam = hashlib.sha256(b"").hexdigest(), None, 0
    h = firma(secreto, kid, metodo, ruta, host if puerto in (80, 443) else f"{host}:{puerto}", extra, hash_cuerpo, datetime.datetime.now(datetime.timezone.utc))
    con = (http.client.HTTPSConnection if esquema == "https" else http.client.HTTPConnection)(host, puerto, timeout=60)
    try:
        con.putrequest(metodo, ruta, skip_host=True, skip_accept_encoding=True)
        for k, v in h.items():
            con.putheader(k, v)
        if metodo == "PUT":
            con.putheader("content-length", str(tam))
        con.endheaders()
        if archivo:
            with open(archivo, "rb") as f:
                for bloque in iter(lambda: f.read(1 << 20), b""):
                    con.send(bloque)
        r = con.getresponse()
        cuerpo = r.read(400).decode("utf-8", "replace")
        return r.status, dict((k.lower(), v) for k, v in r.getheaders()), cuerpo, tam, (md5.hexdigest() if md5 else None)
    except OSError as e:
        sale(1, f"R2: error de red ({type(e).__name__})")
    finally:
        con.close()


def descargar(bucket, clave, destino):
    cuenta, kid, secreto, (esquema, host, puerto) = entorno()
    ruta = "/" + urllib.parse.quote(f"{bucket}/{clave}", safe="/-_.~")
    h = firma(secreto, kid, "GET", ruta, host if puerto in (80, 443) else f"{host}:{puerto}", {}, hashlib.sha256(b"").hexdigest(), datetime.datetime.now(datetime.timezone.utc))
    con = (http.client.HTTPSConnection if esquema == "https" else http.client.HTTPConnection)(host, puerto, timeout=60)
    try:
        con.putrequest("GET", ruta, skip_host=True, skip_accept_encoding=True)
        for k, v in h.items():
            con.putheader(k, v)
        con.endheaders()
        r = con.getresponse()
        if r.status != 200:
            sale(1, f"R2: la descarga fue rechazada (HTTP {r.status}): {limpia(r.read(400).decode('utf-8', 'replace'))}")
        esperado = int(r.getheader("content-length", "-1"))
        try:
            f = open(destino, "xb")
        except FileExistsError:
            sale(1, "R2: el archivo de destino ya existe; no se sobrescribe")
        total = 0
        with f:
            for bloque in iter(lambda: r.read(1 << 20), b""):
                f.write(bloque); total += len(bloque)
        if total != esperado or total == 0:
            sale(1, f"R2: descarga incompleta ({total} de {esperado} bytes)")
        return total
    except OSError as e:
        sale(1, f"R2: error de red ({type(e).__name__})")
    finally:
        con.close()


def limpia(texto):
    for k in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        v = os.environ.get(k, "")
        if v:
            texto = texto.replace(v, "***")
    return re.sub(r"\s+", " ", texto)[:200]


def main(a):
    if len(a) == 5 and a[1] == "poner":
        _, _, bucket, clave, archivo = a
        validar(bucket, clave)
        if not os.path.isfile(archivo) or os.path.getsize(archivo) == 0:
            sale(2, "R2: el archivo no existe o está vacío")
        est, _, cuerpo, tam, md5 = peticion("PUT", bucket, clave, archivo, True)
        if est == 412:
            sale(1, "R2: el objeto YA EXISTE; no se sobrescribe")
        if est not in (200, 201):
            sale(1, f"R2: la subida fue rechazada (HTTP {est}): {limpia(cuerpo)}")
        est, cab, cuerpo, _, _ = peticion("HEAD", bucket, clave)
        if est != 200 or int(cab.get("content-length", "-1")) != tam:
            sale(1, f"R2: la verificación posterior a la subida falló (HTTP {est}, tamaño {cab.get('content-length')} frente a {tam})")
        etag = cab.get("etag", "").strip('"')
        if re.fullmatch(r"[0-9a-f]{32}", etag) and etag != md5:
            sale(1, "R2: el ETag del objeto no coincide con el MD5 del archivo subido")
        print(f"R2 OK: {clave} · {tam} bytes · verificado con HEAD")
        return 0
    if len(a) == 4 and a[1] == "cabecera":
        _, _, bucket, clave = a
        validar(bucket, clave)
        est, cab, cuerpo, _, _ = peticion("HEAD", bucket, clave)
        if est != 200:
            sale(1, f"R2: HEAD respondió HTTP {est}")
        print(f"R2 OK: {clave} · {cab.get('content-length')} bytes")
        return 0
    if len(a) == 5 and a[1] == "bajar":
        _, _, bucket, clave, destino = a
        validar(bucket, clave)
        print(f"R2 OK: {clave} · {descargar(bucket, clave, destino)} bytes descargados")
        return 0
    sale(2, __doc__)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
