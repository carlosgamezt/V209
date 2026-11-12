# Motor fiscal NEXA FEL · D1-A — reglas, fuentes y bloqueos

Estado: **D1-A implementado. Nada calcula ni certifica.** D1-B y D2 no están autorizados.

## Qué es (y qué no es)
- Es un motor de **validación y verificación** de un DTE alineado con el XSD oficial `GT_Documento-0.2.1`. Código en `fel/fiscal/`.
- **No calcula importes** y **no certifica**: `calcularDte`, `certificarDte` y `prepararCertificacionDte` lanzan siempre `EscenarioNoAprobado` (regla `ESC-BLOQUEO`).
- `validarDte` es de solo lectura y devuelve `aprobadoParaCertificar: false` **siempre**. «Sin violaciones» solo significa «no se detectó incumplimiento de las reglas respaldadas por fuente oficial», no que el DTE sea fiscalmente válido.
- Lo que no tiene fuente oficial leída se devuelve como `noVerificable` (con los puntos V que lo bloquean), nunca como correcto.
- No se conecta a SAT ni a Digifact. No usa credenciales. No toca pantallas, orquestador, idempotencia/conciliación, agente local ni `main`.

## Recursos oficiales versionados (`fel/fiscal/recursos/sat-fel/`)
| Dato | Valor |
|---|---|
| Fuente | https://github.com/notificacioneselectfel/Catalogo-FEL (publicado por la Gerencia de Informática de SAT; licencia GPL-3.0) |
| Referencia fijada | rama `main`, commit `025144527e33116c65d4138c48865b8ac99e0c08` (2026-10-14) |
| Descarga | 2026-11-12 |
| Archivos | 32 (27 XSD, 3 catálogos JSON, LICENSE, README), copiados **sin modificar** |
| Registro | `MANIFIESTO.json`: ruta, versión (del nombre del archivo), bytes y SHA-256 de cada archivo |
| Verificación | `cargarRecursos()` comprueba tamaño y hash **antes** de usar cada archivo; un archivo alterado aborta (`RECURSO_ALTERADO`) |
| Estabilidad del hash | `fel/fiscal/recursos/.gitattributes` (`* -text`): git no cambia los saltos de línea |

Versiones usadas: `XSD/GT_Documento-0.2.1.xsd`, `Catalogos/CatalogoFrases-0.6.0.json` (12 tipos, 92 escenarios), `Catalogos/catalogoUnidadesGravables-0.1.4.json`, `Catalogos/catalogoMensajes-0.3.0.json` (213 mensajes).
Las fechas de las cabeceras de los catálogos no son fiables (alguna es anterior a decretos que su contenido ya refleja); **la versión de referencia es el commit**.
Los números del catálogo (`factor`) se leen como **texto exacto** (nunca coma flotante); si el motor JSON no entrega el texto fuente, la carga falla.

## Reglas implementadas (registro en `fel/fiscal/src/reglas.ts`; cada una con prueba que la nombra `[ID]`)
**Estructura (XSD 0.2.1)** — `ESQ-RAIZ`, `ESQ-TIPO`, `ESQ-FECHA-EMISION`, `ESQ-MONEDA`, `ESQ-NUMERO-ACCESO`, `ESQ-MARCAS`, `ESQ-EMISOR-NIT`, `ESQ-EMISOR-TEXTOS`, `ESQ-EMISOR-ESTABLECIMIENTO`, `ESQ-EMISOR-AFILIACION`, `ESQ-CORREO`, `ESQ-DIRECCION-EMISOR`, `ESQ-RECEPTOR-ID`, `ESQ-RECEPTOR-TEXTOS`, `ESQ-FRASES-CARDINALIDAD`, `ESQ-FRASE-CAMPOS`, `ESQ-ITEMS-CARDINALIDAD`, `ESQ-ITEM-CAMPOS`, `ESQ-ITEM-IMPORTES` (NumeroNDecimales: ≥ 0, ≤ 10 decimales, ≤ 22 dígitos), `ESQ-IMPUESTOS-CARDINALIDAD`, `ESQ-IMPUESTO-CAMPOS`, `ESQ-TOTALES`. Enumeraciones y patrones se **extraen del propio XSD** (no se copian a mano); una prueba contrasta los límites numéricos con las facetas del XSD.

**Proyecto (autorización D1-A)** — `PRY-SIN-FLOTANTES` (importes = texto decimal; un `number` se rechaza), `ESC-BLOQUEO`.

**Catálogo de unidades gravables 0.1.4** — `CAT-UG-EXISTE`, `CAT-UG-CASILLA`.

**Frases (CatalogoFrases 0.6.0 + catalogoMensajes 0.3.0)** — `FRA-CATALOGO` (RCP320, solo existencia), `FRA-UNICA` (RCP487), `FRA-EXENTO-ITEMS-SIN-IVA` (RCP325), `FRA-EXENTO-EXPORTACION` (RCP323), `FRA-ESCENARIOS-9` (RCP112, cláusulas 1 y 2). El tipo «exento o no afecto al IVA» (4) se identifica por su nombre oficial en el catálogo.

**Fechas** — `FEC-MES-CERTIFICACION` (RCP301, hora de Guatemala UTC−06:00). Solo se evalúa si se entrega la fecha de certificación; nunca se asume «ahora».

**Aritmética (solo verificación, racionales exactos)** — `ARI-PRECIO` (RCP313), `ARI-DESCUENTO` (RCP314), `ARI-IVA-BASE` (RCP226, solo IVA unidad 1), `ARI-IVA-IMPUESTO` (RCP331), `ARI-TOTAL-ITEM` (RCP348: el IVA no se suma), `ARI-TOTAL-IMPUESTO` (RCP332, solo IVA), `ARI-GRAN-TOTAL` (RCP349).
- **Tolerancia: parámetro obligatorio**, sin valor predeterminado; ausente, nula, negativa, no decimal o `number` → error. El anexo oficial que la define («Tolerancia en el cálculo de las casillas numéricas») no está disponible (V2). Con tolerancia `0` la comparación es exacta; la diferencia igual a la tolerancia pasa.
- Un cociente no terminante (100 / 1,12 = 625/7) se informa como fracción exacta, **nunca redondeado**.
- `noVerificable`: IVA con unidad ≠ 1, `OtrosDescuento` ≠ 0 (RCP226 y SEC500 difieren), impuestos distintos del IVA, `Idp`, y totales de impuesto no verificables o ausentes.

## Puntos bloqueados (no se implementa nada que dependa de ellos)
V1 cálculo con IVA incluido (las fórmulas del texto oficial solo se usan para **verificar**) · V2 decimales, redondeo y tolerancia por campo · V3 matriz tipo de DTE × afiliación × personería · V4 frases obligatorias por régimen · V5 límite de consumidor final · V6 tipos de DTE sin impuesto · V7 dígito verificador de NIT/CUI · V8 retenciones ISR/IVA · V9 notas de crédito y débito · V10 exportaciones · V11 impuestos distintos del IVA · V12 anulación (plazo y calendario).

## Reglas vistas en las fuentes y NO implementadas (por qué)
- RCP112, tercera cláusula: texto ambiguo. · RCP473, RCP317: no cubiertos por D1-A.
- INF300 (plazo de emisión): el mismo mensaje dice «tres» y «cinco» días; sin aclaración, no se implementa.
- INF534 (texto de retención) y RCP535 (límite de consumidor final): faltan valores/matriz.
- RCP226 frente a SEC500: difieren en si `OtrosDescuento` se resta; por eso ese caso es `noVerificable`.

## Riesgos pendientes
1. **Fuente**: el repositorio es público y publicado por SAT, pero no es el portal oficial ni la «Guía de Reglas y Validaciones» (sat.gob.gt no fue accesible desde el entorno). Las reglas se limitan a lo que dicen literalmente los archivos oficiales; conviene que un contador/consultor fiscal confirme el alcance antes de D1-B.
2. **Tolerancia/redondeo (V2)**: sin el anexo oficial no se puede decidir cuántos decimales ni qué diferencia es aceptable; el motor no lo inventa.
3. **Frases por régimen (V4) y matriz (V3)**: no se puede decir qué DTE es *completo* para un contribuyente; solo se detectan incumplimientos puntuales.
4. **Versionado de catálogos**: SAT actualiza los archivos; hay que re-descargar, regenerar el manifiesto (`herramientas/generar_manifiesto.ts`) y revisar las diferencias.
5. **Licencia**: los recursos son GPL-3.0 (se conserva el `LICENSE`). Conviene revisar con asesoría legal su redistribución dentro de un producto comercial.
6. **Patrón de correo y NIT**: se aplican tal como están en el XSD (p. ej. el NIT de un solo dígito no cumple el patrón oficial); no se «corrigen».
7. Las pruebas de integridad corren en Linux; los hashes se protegen con `.gitattributes`, pero no hay trabajo de CI en Windows para este módulo.

## Cómo ejecutar
```
cd fel/fiscal
deno check mod.ts pruebas/*.ts
deno test -A pruebas/
```
