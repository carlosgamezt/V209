# Respaldo · Fase 2 — copia conservada en Cloudflare R2 (SOLO DISEÑO; no implementada, no habilitada)

Estado: **documentación de una arquitectura futura**. No existe ningún bucket, secreto, flujo ni código de R2. Nada de esto se activa sin una autorización expresa y un commit aparte.
La fase 1 (`ensayo-respaldo`) ya demuestra que una copia se produce y se restaura; esta fase añadiría **conservar** una copia fuera de GitHub y de Supabase.

## 1. Arquitectura propuesta
```
nexa-demo (solo lectura) ──pg_dump──▶ ejecutor de GitHub (disco efímero)
                                       │ 1. SHA-256 del archivo en claro y pg_restore --list
                                       │ 2. ensayo de restauración efímera (fase 1, obligatorio ANTES de subir)
                                       │ 3. CIFRADO con la clave PÚBLICA (el ejecutor no puede descifrar)
                                       ▼
                         Cloudflare R2 · bucket PRIVADO · objeto «nexa-demo/AAAAMMDD-HHMMSS-<sha8>.dump.age»
                                       │ + «.sha256» y «.informe.txt» (sin datos)
                                       ▼
        Tú: descargas, DESCIFRAS con la clave PRIVADA (solo tuya), verificas SHA-256 y restauras con el procedimiento probado
```
- **Orden y condición:** solo se sube si el ensayo de la fase 1 terminó en «OK»; una copia que no se pudo restaurar no se conserva como buena.
- **Bucket privado:** sin dominio público ni URL pública; acceso solo con credenciales S3.
- **Cifrado antes de almacenar:** cifrado de **clave pública** en el ejecutor (p. ej. `age` con el destinatario público). El ejecutor y Cloudflare solo ven texto cifrado. Cifrar con una contraseña guardada como secreto **no** se acepta: quien robe GitHub tendría las dos mitades.
- **Clave privada fuera de GitHub:** la genera el responsable en su equipo, vive en un gestor de contraseñas y en una copia impresa en lugar seguro; **nunca** entra a GitHub, a R2 ni a un chat. Si se pierde, **todas** las copias quedan inservibles; por eso el procedimiento de restauración se prueba una vez de punta a punta antes de confiar en el esquema.
- **Verificación:** el `.sha256` del archivo en claro y el informe permiten comprobar tras descifrar que la copia es la que se respaldó.

## 2. Credenciales de alcance mínimo
| Credencial | Alcance | Dónde vive |
|---|---|---|
| Token de API de R2 | permiso **Object Read & Write limitado a UN solo bucket** (`Apply to specific buckets only`). *Nota honesta:* R2 **no ofrece un permiso de solo escritura**; el mínimo disponible es leer y escribir objetos de ese bucket | secreto del entorno `demo-privada` (nuevo) |
| Identificador de cuenta y nombre del bucket | no son secretos pero se guardan junto al token | variables del entorno `demo-privada` |
| Clave **pública** de cifrado | solo cifra | variable del entorno `demo-privada` |
| Clave **privada** | descifra | **solo el responsable, fuera de GitHub** |
- Token distinto del de Pages/Workers; sin permisos de administración, de cuenta ni de zona; con **vencimiento** y rotación (misma costumbre que los tokens de 7 días).
- El flujo de la fase 2 sería **otro trabajo** (los secretos de R2 no se mezclan con los del ensayo) y solo en el paso de subida.
- Como el token puede **sobrescribir y borrar** objetos de su bucket: nombres de objeto únicos con fecha y huella (no se sobrescribe), **bloqueo de retención del bucket** si el plan de Cloudflare lo ofrece y un token de **solo lectura** aparte, en manos del responsable, para descargar.

## 3. Política de retención (propuesta)
- Una copia **antes de cada migración o cambio de esquema** (p. ej. antes de la etapa 3) y una semanal mientras `nexa-demo` tenga datos que importen.
- Conservar las **8 últimas semanales + todas las previas a una migración durante 90 días**; borrado por reglas de ciclo de vida del bucket (o manual), nunca desde el flujo de respaldo.
- Una copia **restaurada con éxito** se marca en el informe; las no restauradas no cuentan como respaldo.
- Cuando existan operaciones fiscales (TEST o reales), la retención se alarga según el plazo legal aplicable: **a confirmar con el contador**; no se supone aquí.

## 4. Procedimiento de restauración verificado (el mismo de la fase 1, ya probado en local)
1. Descargar el objeto cifrado y su `.sha256`.
2. Descifrar con la clave privada y comparar el SHA-256.
3. `pg_restore --list` (debe listar `TABLE DATA public empresas` y `supabase_migrations schema_migrations`).
4. Restaurar en una base **aparte** (nunca sobre `nexa-demo`): sin recrear `public`, retirando los privilegios por defecto de `anon`, `authenticated` y `service_role`, y creando usuarios de prueba para las claves foráneas de Auth (los usuarios reales no van en la copia).
5. Verificar: mismos conteos, historial de migraciones, la migración esperada ausente o presente según el momento, y el **catálogo de la 28** en una transacción de solo lectura.
6. Después de **cualquier** restauración: no reactivar la certificación; **conciliar con Digifact** antes de enviar nada (`RECUPERACION-Y-CONCILIACION.md`).
La restauración **real** sobre un proyecto Supabase distinto sigue **sin probar** y requiere autorización aparte.

## 5. Riesgos de esta fase y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Token de R2 filtrado | solo afecta a un bucket; el contenido va cifrado; vencimiento y rotación; bloqueo de retención |
| Pérdida de la clave privada | copia en gestor y en papel; prueba de restauración completa antes de depender de ella |
| Que el flujo suba una copia no restaurable | solo se sube tras «ENSAYO … OK» |
| Que el archivo en claro llegue a GitHub | el volcado vive fuera del espacio de trabajo, se sobrescribe y se borra; el flujo no usa artefactos, cachés ni releases (los guardianes de `verificar-publicacion.py` lo exigen) |
| Costos | datos simulados y pequeños; la capa gratuita de R2 alcanza; revisar antes de habilitar |

## 6. Qué se necesita para habilitarla (cada paso con su autorización)
1. Decisión de usar R2 y revisión de este diseño.
2. Crear el bucket privado y el token acotado (lo haces tú en Cloudflare).
3. Generar tu par de claves; entregar **solo la pública**.
4. Cargar los secretos y variables en `demo-privada`.
5. Implementar el trabajo de subida, sus guardianes y pruebas, y publicarlo con otro commit autorizado.
6. Primera corrida real y **prueba de restauración desde R2** antes de dar la fase por cerrada.
