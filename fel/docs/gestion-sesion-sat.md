# Gestión de la sesión SAT en la prueba de viabilidad

> **Alcance:** módulo de la PoC `fel/poc-sat` (no es producción, no toca la arquitectura de NEXA, **no emite nada**). Probado solo contra una página de ejemplo local que simula un cierre de sesión; **no se ha probado con el portal real**.
> **Hipótesis de trabajo (NO confirmada):** SAT podría cerrar la sesión tras 20–30 minutos de inactividad. Ninguna parte del código asume ese tiempo: la detección reacciona a *señales*, no a un reloj, y `bin/medir-sesion.mjs` sirve para medir el valor real.

## 1. Principios
| # | Principio | Cómo se cumple |
|---|---|---|
| 1 | **Sesiones de NEXA y SAT independientes** | La sesión SAT vive solo en el Chrome de la persona. La PoC no tiene sesión de NEXA, no importa código de NEXA ni Supabase, y **no lee cookies, almacenamiento ni estado de sesión del navegador** (escaneo estático en `tests/guardia.test.mjs`). El progreso se identifica por alias de empresa y plan, nunca por un token. Si en el futuro NEXA tuviera sesión propia, cerrarla o renovarla no afecta a la de SAT y viceversa. |
| 2 | **Detectar cuándo SAT pide iniciar sesión** | Monitor pasivo (sección 2). |
| 3 | **La persona se autentica en el portal oficial** | El ejecutor se pausa y espera. No existe ningún paso que llene credenciales: un paso `llenar` sobre un campo de contraseña/`one-time-code` se **rechaza**, y el borrador de mapeo omite esos campos. |
| 4 | **Conservar borradores y progreso** | Punto de control atómico por paso + reconciliación de solo lectura al reanudar (sección 4). |
| 5 | **Reanudar solo con la sesión verificada** | `verificarActiva` (sección 3). Sin prueba, no se reanuda. |
| 6 | **Sin clics artificiales contra la expiración** | El módulo de sesión solo hace lecturas pasivas: `url`, presencia/visibilidad de elementos y conteo de respuestas 401. No hay clics, teclas, recargas, navegación, peticiones ni temporizadores de acción; el esquema de configuración **rechaza** claves como `keepalive`, `ping`, `refrescar`, `heartbeat`. Verificado por escaneo estático y por una prueba que cuenta eventos de usuario en la página durante la espera (cero). |
| 7 | **Sin emisiones duplicadas** | Sección 5. |
| 8 | **Registrar tiempos sin datos sensibles** | Sección 6. |
| 9 | **Parar antes de emitir** | Sin cambios: el plan termina siempre en `detener`; no existe paso de emisión. |

## 2. Detección: estados y señales
Estados: **`requiere_login`**, **`activa`**, **`desconocida`**. Solo `activa` autoriza a reanudar sin preguntar; ante la duda se pide confirmación humana.
| Señal (código en el registro) | Qué es | ¿Necesita observar el portal? |
|---|---|---|
| `campo_de_clave_visible` | Hay un `<input type=password>` visible (en cualquier marco). Heurística genérica; desactivable con `campo_clave_visible:false` | No |
| `respuesta_401` | El portal respondió 401 a una petición de la pestaña | No |
| `host_de_login` / `ruta_de_login` | La URL coincide con `sesion.hosts_login` / `sesion.rutas_login` | **Sí**: tú las anotas tras observar |
| `indicador_de_login` | Aparece un elemento de `sesion.indicadores_login` | **Sí** |
| `indicador_de_sesion_activa` | Aparece un elemento de `sesion.indicadores_sesion_activa` (p. ej. algo que solo existe con sesión) | **Sí** |
Una señal de login **gana** a cualquier indicador de sesión activa. **No hay ningún selector, host ni ruta del portal en el código**: el bloque `sesion` del mapeo se completa con lo observado y cada indicador exige `verificado:true`.

## 3. Verificación antes de reanudar
- **Con indicadores confirmados:** la espera consulta pasivamente cada `intervalo_ms` (mínimo 1 s, por defecto 5 s) hasta que haya un indicador activo y ninguna señal de login; límite `espera_max_ms` (por defecto 30 min, máximo 4 h). Si se agota, **no se reanuda** y el progreso queda guardado.
- **Sin indicadores:** se pregunta a la persona («escribe `si` cuando termines») y, **además**, se exige que no queden señales de login (un «si» con la pantalla de login aún visible no reanuda: probado).
- Tras verificar, la persona **vuelve ella misma al formulario** (`sesion.reanudar_instruccion`), se comprueba que el dominio sigue permitido y se reconcilia.

## 4. Progreso, borradores y reanudación
**Qué se guarda:** `registros/<alias>/progreso-<plan>-<datos>.json` con ids de pasos hechos, hora, estado y nº de pausas/reanudaciones. Escritura atómica tras cada paso. **Nunca** valores de campos, cookies, tokens ni credenciales.
**Qué NO se guarda:** el borrador del portal. Si SAT conserva o no un borrador tras volver a iniciar sesión es una **incógnita por verificar** (sección 9). La PoC no pulsa «Guardar borrador» (palabra prohibida).
**Reconciliación (solo lectura):** tras una pausa o con `--reanudar`, se leen los campos ya llenados y se comparan con lo esperado:
| Situación | Decisión | Probado |
|---|---|---|
| El portal conservó todo | Continuar sin repetir nada | ✅ sesión 1, reanudación |
| Perdió solo campos posteriores al último clic | Volver a llenar **solo esos campos**, en orden | ✅ sesión 3 |
| Perdió algo anterior a un clic (abrir pestaña, **agregar línea**) | **No se repiten clics** (podrían duplicar líneas): estado `requiere_reinicio_manual`; descarta lo que quede y usa `--reiniciar` | ✅ sesión 2 |
| La sesión se cerró **durante** un clic | No se reintenta: `requiere_decision_manual` (comprueba a mano si se aplicó) | ✅ sesión 4 |
| La sesión se cerró durante un llenado (idempotente) | Un único reintento tras verificar y reconciliar | ✅ sesión 1 |
| Interrupción del proceso/Chrome | `--reanudar` (exige sesión verificada); no se repiten pasos hechos | ✅ sesiones 7 y 8 |
Estados finales: `detenido` (terminó bien, sin emitir), `interrumpido`, `requiere_reinicio_manual`, `requiere_decision_manual`, `no_inicio`. Una ejecución con estado distinto de `detenido` **no se puede ignorar**: el comando exige `--reanudar` o `--reiniciar`.

## 5. Anti-duplicados
- **Llenado:** los pasos de campo son idempotentes (repetirlos no duplica); los clics **no** lo son y nunca se repiten solos; `agregar línea` y similares son clics.
- **Libro de emisiones (`registros/<alias>/libro-emisiones.json`):** clave estable por empresa + datos del documento. Estados: `preparado`, `detenido_antes_de_emitir`, `emision_solicitada`, `emision_desconocida`, `emitido`, `emitido_manual`, `descartado`. Si un documento figura en `emision_solicitada`, `emision_desconocida`, `emitido` o `emitido_manual`, **ninguna ejecución empieza** hasta que una persona concilie en el portal y lo marque (`descartado` solo si comprobó que **no existe**). Probado.
- **Importante:** en esta PoC el libro solo llega a `preparado` y `detenido_antes_de_emitir`, porque **no se emite**. Los demás estados están implementados y probados para dejar fijada la regla que tendría que cumplir cualquier fase futura: la intención de emitir se escribe en disco **antes** de pulsar nada, y tras un error, cierre de sesión o interrupción **no se reintenta a ciegas**. Esto no habilita ni prepara la emisión real.

## 6. Registro de tiempos (sin datos sensibles)
Fases en `registros/<alias>/*.resumen.json`: **`autenticacion`** (desde la pausa hasta la sesión verificada y el regreso al formulario), **`llenado`** (pasos automáticos) y **`espera`** (esperas por una persona), más `interrupciones_de_sesion` y `estado_final`. Eventos `sesion_sat` con **estado y códigos de razón** únicamente.
**Nunca se registra:** credenciales, cookies, cabeceras, tokens, cuerpos de peticiones, valores de campos, parámetros de URL (`?…`), parámetros de ruta (`;jsessionid=…`) ni segmentos de ruta con aspecto de token/identificador (se sustituyen por `:id`). Probado (también el archivo de progreso).

## 7. Comandos
```
node bin/medir-sesion.mjs --empresa=config/empresa.local.json [--mapeo=mapeo.local.json] [--intervalo=30] [--max-min=45]
      # NO toques la ventana. Mide cuánto tarda el portal en pedir iniciar sesión sin interacción. Repite en distintos momentos: un dato no confirma nada.
node bin/ejecutar.mjs … --reanudar     # continúa una ejecución interrumpida (verifica sesión y reconcilia primero)
node bin/ejecutar.mjs … --reiniciar    # descarta el progreso y empieza de cero (desde un formulario vacío)
```
Ctrl+C guarda el estado `interrumpido`, libera el candado y no emite nada.

## 8. Cómo se probó (sin el portal real)
`npm test` en `fel/poc-sat` (también en la CI): 20 tests unitarios (estados, esquema estricto, regla de reanudación, saneado, progreso, libro, escaneos estáticos) + 26 casos con Chrome real contra una página de ejemplo que **simula** el cierre de sesión (superposición de login, pérdida total/parcial de datos): pausa sin interacción, verificación, reconciliación, no duplicación de líneas, espera agotada, confirmación manual, reanudación, libro, rechazo de campos de contraseña y el comando `medir-sesion`.

## 9. Pendiente de verificar con Chrome y el portal real
- [ ] **Tiempo real de cierre por inactividad** (hipótesis 20–30 min): ejecutar `medir-sesion` varias veces, a distintas horas.
- [ ] Si lecturas pasivas del DOM **no** alargan la sesión (no lo pretendemos) y si el portal cierra por **tiempo absoluto** además de inactividad.
- [ ] **Cómo se manifiesta** el cierre: redirección, ventana emergente, error en una petición, 401/403, mensaje en la página… (define los indicadores y rutas de `sesion`).
- [ ] **¿Conserva SAT el borrador** al volver a iniciar sesión? ¿Hay «borradores» propios en el portal?
- [ ] **¿Se puede volver al formulario** tras el login (URL directa, menú) y en qué estado queda?
- [ ] Inicio de sesión con **CAPTCHA/verificación en dos pasos**: duración y si invalida pestañas abiertas.
- [ ] **Una sesión por empresa/perfil:** si abrir otra sesión cierra la anterior.
- [ ] Que el **401** (o la señal que corresponda) llegue a la pestaña y que `campo_clave_visible` no dé falsos positivos en pantallas del portal (p. ej. «confirmar clave» dentro del formulario).
- [ ] **Autorización/términos de uso de SAT** para automatizar (persona responsable): no revisado.
