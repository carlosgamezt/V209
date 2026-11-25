# Habilitar Digifact TEST en la demostración: inventario único de secretos, variables y requisitos

Estado (25/11/2026). Revisión hecha leyendo el flujo `publicar-nube.yml`, `publicar-nube.sh`, `supabase-hospedado.sh`, `digifact_entorno.ts` y los intentos de publicación 26–31. **Ningún valor sensible aparece aquí ni en los registros.** Producción de Digifact no existe en el cliente (solo `testnucgt.digifact.com`); NEXA principal no interviene.

## 1. Resultado de las tres lecturas (ejecuciones #32 `publicar-nube verificar`, #29 `datos-emisor`, #30 `credenciales-presentes`; 25/11/2026)
| Dato | Resultado |
|---|---|
| Base `nexa-demo` | 30 migraciones registradas, **0 pendientes**, 71 tablas con RLS |
| Empresa de «ana» | **`10000000-0000-0000-0000-0000000000d0`** (coincide con la esperada) |
| Secretos de Digifact en la función | los 15 **ausentes** (Digifact apagado, como debe estar hasta publicar) |
| `DEMO_DIGIFACT_TEST_USERNAME`, `_PASSWORD`, `_NIT` | **presentes** (`credenciales-presentes`: usuario, clave y NIT = sí) |
| Emisor de TEST | leído del DTE `39CBAB22-21E9-4AB9-B863-BA8F1FE87EF6`; **huella `04a1a7f8ff9a922f`**; sin discrepancias con lo esperado |

## 2. Inventario DEFINITIVO de lo que falta (3 secretos en `demo-privada`)
| Secreto | Valor |
|---|---|
| `DEMO_DIGIFACT_TEST_EMPRESA` | `10000000-0000-0000-0000-0000000000d0` |
| `DEMO_DIGIFACT_TEST_HUELLA` | `04a1a7f8ff9a922f` |
| `DEMO_DIGIFACT_TEST_EMISOR` | El JSON de abajo, **en una sola línea**, tal cual (**sin NIT**: el NIT sale solo de `DEMO_DIGIFACT_TEST_NIT`) |

```
{"nombre":"TEST GENS","nombreComercial":"ESTABLECIMIENTO \"TEST GEN\"","afiliacionIva":"GEN","codigoEstablecimiento":"2","correo":"","direccion":{"direccion":"0 AVENIDA APTO. \\108\\ \"CONDOMINIO NIMAJUYU I\" ZONA 21","codigoPostal":"01021","municipio":"Guatemala","departamento":"GUATEMALA","pais":"GT"},"frases":[{"tipo":1,"escenario":2}]}
```
Notas: las barras y comillas del domicilio ya están escapadas (JSON válido): cópialo tal cual. El despliegue lo envía a la función **codificado en base64**, así que no depende de cómo se interprete el archivo `.env`. **El NIT ya no se duplica:** se toma siempre de `DEMO_DIGIFACT_TEST_NIT`. Si tu secreto actual todavía trae un campo `"nit"`, se **ignora** (no hace falta editarlo). Protección independiente: la huella aprobada incluye el NIT del emisor del DTE aceptado por Digifact TEST; si el NIT de las credenciales no es ese, la huella no coincide y no se habilita. Además la verificación en seco hace un inicio de sesión de solo lectura en Digifact TEST con ese NIT y usuario (solo entra una cuenta que exista allí).

**Cómo crearlos de forma segura:** GitHub → Settings → Environments → `demo-privada` → *Add environment secret* (nombre y valor; se guardan cifrados, nunca en el chat ni en el repositorio). No uses secretos de repositorio: el flujo solo lee los del entorno protegido.

## 3. Verificación en seco antes de publicar
Con los 3 secretos creados, lanza `publicar-nube` con `modo=verificar`, `digifact=habilitado`, `digifact_referencia=CICLO-TEST` (solo lectura). Ahora esa ejecución corre `nube/verificar_digifact.ts`, que aplica las mismas reglas que la función y responde SI/NO por requisito (existencia, UUID, empresa de «ana», huella de 16 hex, sin comillas simples ni saltos de línea, huella aprobada = huella calculada con el NIT de las credenciales, e inicio de sesión de solo lectura en Digifact TEST). Termina con «configuración COMPLETA» o con la lista de lo que falla; **no publica nada**. Solo con «COMPLETA» se lanza la publicación real.

## 4. Entradas del flujo `publicar-nube` (no son secretos)
`modo=publicar` · `confirmar=PUBLICAR` · `digifact=habilitado` · `digifact_referencia=CICLO-TEST` · `digifact_prueba=habilitado`. Las demás (`digifact_nit`, `digifact_cui`, `digifact_correo`) quedan en `apagado`.

## 5. Reglas que el script valida antes de publicar la función (todo o nada)
1. Los seis secretos de Digifact (EMPRESA, USERNAME, PASSWORD, NIT, EMISOR, HUELLA) deben existir.
2. `EMPRESA` debe ser un UUID; `HUELLA` exactamente 16 hexadecimales.
3. `EMISOR` debe ser un JSON válido (una sola línea). Ya admite comillas y barras: viaja a la función en base64. Los demás valores no admiten comilla simple ni salto de línea.
4. El NIT del emisor se toma de `DEMO_DIGIFACT_TEST_NIT`; la huella calculada (datos del emisor + ese NIT) debe coincidir con `DEMO_DIGIFACT_TEST_HUELLA` (si se edita el JSON a mano, la huella cambia y no se habilita).
5. Almacén persistente: la migración 29 ya está aplicada en `nexa-demo` (30 migraciones registradas). No se aplica ninguna migración.
6. `digifact_referencia` solo vale con `digifact=habilitado`; admite un GUID (una sola prueba) o `CICLO-TEST` (el ciclo de pruebas).

## 6. (Histórico) Cómo se obtuvieron los valores
1. **EMPRESA**: ejecución `publicar-nube` con `modo=verificar` (solo lectura): imprime el UUID de la empresa de «ana» y los **nombres** de los secretos que ya hay en la función.
2. **EMISOR y HUELLA**: ejecución `digifact-test` con `paso=datos-emisor` (solo lectura) y la autorización (UUID) de un DTE ya certificado en TEST para ese NIT. La salida muestra los datos del emisor y la huella; los apruebas y los pegas tú en GitHub.
3. Comprobar credenciales: `digifact-test` con `paso=credenciales-presentes` (solo booleanos).

## 7. Después de configurar
Una sola publicación: `publicar-nube` con las entradas de §2. Ejecuta migraciones (ninguna pendiente), siembra, construye, publica la función con Digifact y la página, la prueba de humo y la **prueba de certificación** (2 facturas de PRUEBA). Para cerrar: otra publicación con `digifact=apagado` (retira `CICLO-TEST` y las credenciales de la función).
