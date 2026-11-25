# Habilitar Digifact TEST en la demostración: inventario único de secretos, variables y requisitos

Estado (25/11/2026). Revisión hecha leyendo el flujo `publicar-nube.yml`, `publicar-nube.sh`, `supabase-hospedado.sh`, `digifact_entorno.ts` y los intentos de publicación 26–31. **Ningún valor sensible aparece aquí ni en los registros.** Producción de Digifact no existe en el cliente (solo `testnucgt.digifact.com`); NEXA principal no interviene.

## 1. Secretos del entorno `demo-privada` (GitHub → Settings → Environments → demo-privada → Secrets)
| Secreto | Para qué | Estado |
|---|---|---|
| `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_SERVICE_ROLE_KEY`, `DEMO_BD_URL`, `DEMO_SUPABASE_DB_PASSWORD` | Proyecto `nexa-demo` | **OK** (la publicación del 25/11 12:14 con Digifact apagado los usó) |
| `DEMO_SUPABASE_ACCESS_TOKEN` | CLI de Supabase: secretos y función de `nexa-demo` | **OK** (token del 25/11: Edge Functions y Secrets en lectura-escritura; vence a los 90 días). No hace falta `project_admin_read`: con las 30 migraciones registradas el script ya no enlaza el proyecto |
| `DEMO_CLOUDFLARE_API_TOKEN`, `DEMO_CLOUDFLARE_ACCOUNT_ID`, `DEMO_PAGES_PROYECTO` | Cloudflare Pages `nexa-fel-demo` | **OK** (mismo uso) |
| `DEMO_PROXY_SECRETO`, `DEMO_MFA_SEMILLAS`, `DEMO_CLAVES` | Intermediario, MFA y cuentas de demostración (la prueba usa la cuenta de «ana») | **OK** |
| `DEMO_DIGIFACT_TEST_USERNAME`, `DEMO_DIGIFACT_TEST_PASSWORD`, `DEMO_DIGIFACT_TEST_NIT` | Credenciales de Digifact TEST (el NIT del emisor debe ser este NIT) | **Sin verificar**: el script solo avisa del primer faltante y se detuvo antes. Se comprueban con `digifact-test` → `credenciales-presentes` (solo imprime sí/no) |
| `DEMO_DIGIFACT_TEST_EMPRESA` | UUID de la **única** empresa de demostración que usa esas credenciales (la de «ana») | **FALTA** (causa del fallo del 25/11 13:08) |
| `DEMO_DIGIFACT_TEST_EMISOR` | JSON con los datos del emisor (nombre, afiliación, establecimiento, dirección, frases) leído de un DTE ya aceptado | **FALTA (probable)** |
| `DEMO_DIGIFACT_TEST_HUELLA` | Huella de 16 caracteres hexadecimales de esos datos, aprobada por una persona | **FALTA (probable)** |
| `DEMO_DIGIFACT_CORREO_DESTINATARIOS` | Solo si se pidiera correo por Digifact | **No necesario** (correo apagado) |

## 2. Entradas del flujo `publicar-nube` (no son secretos)
`modo=publicar` · `confirmar=PUBLICAR` · `digifact=habilitado` · `digifact_referencia=CICLO-TEST` · `digifact_prueba=habilitado`. Las demás (`digifact_nit`, `digifact_cui`, `digifact_correo`) quedan en `apagado`.

## 3. Reglas que el script valida antes de publicar la función (todo o nada)
1. Los seis secretos de Digifact (EMPRESA, USERNAME, PASSWORD, NIT, EMISOR, HUELLA) deben existir.
2. `EMPRESA` debe ser un UUID; `HUELLA` exactamente 16 hexadecimales.
3. **`EMISOR` debe ir en una sola línea y sin comillas simples** (`'`): el script las rechaza (no hay forma segura de pasarlas a la función). Un nombre con apóstrofo exigiría ajustar el script.
4. El NIT del emisor debe coincidir con `DEMO_DIGIFACT_TEST_NIT`, y la huella calculada de `EMISOR` con `DEMO_DIGIFACT_TEST_HUELLA` (si se edita el JSON a mano, la huella cambia y no se habilita).
5. Almacén persistente: la migración 29 ya está aplicada en `nexa-demo` (30 migraciones registradas). No se aplica ninguna migración.
6. `digifact_referencia` solo vale con `digifact=habilitado`; admite un GUID (una sola prueba) o `CICLO-TEST` (el ciclo de pruebas).

## 4. Cómo obtener los tres valores que faltan (sin escribir nada sensible en el chat)
1. **EMPRESA**: ejecución `publicar-nube` con `modo=verificar` (solo lectura): imprime el UUID de la empresa de «ana» y los **nombres** de los secretos que ya hay en la función.
2. **EMISOR y HUELLA**: ejecución `digifact-test` con `paso=datos-emisor` (solo lectura) y la autorización (UUID) de un DTE ya certificado en TEST para ese NIT. La salida muestra los datos del emisor y la huella; los apruebas y los pegas tú en GitHub.
3. Comprobar credenciales: `digifact-test` con `paso=credenciales-presentes` (solo booleanos).

## 5. Después de configurar
Una sola publicación: `publicar-nube` con las entradas de §2. Ejecuta migraciones (ninguna pendiente), siembra, construye, publica la función con Digifact y la página, la prueba de humo y la **prueba de certificación** (2 facturas de PRUEBA). Para cerrar: otra publicación con `digifact=apagado` (retira `CICLO-TEST` y las credenciales de la función).
