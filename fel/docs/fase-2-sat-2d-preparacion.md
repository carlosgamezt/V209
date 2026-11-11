# Fase 2 — Preparación de sat-2d: cómo funciona la consulta del receptor (CF, solo lectura)

> Nada de esto se ejecuta contra SAT desde la PoC: **Playwright no se usa contra el portal**. Lo harás tú a mano en Chrome. No se pulsa Vista Previa, no se guarda, no se emite. `main` no se toca.

## 1. CI del commit 2e9e527
Confirmada: **los 5 jobs en verde** (run 23): Función fel-api (Deno), Migraciones y RLS, Integración con Supabase local, Interfaz + PoC (23 tests, 31 casos con Chrome, 10 de la simulación AngularJS) y su paso de PoC.

## 2. Privacidad del observador 3 (fragmento 3)
SHA-256 vigente: `b227b949ceeabb44cf088c6ee153e1b092d12ab34654377b64a74699bfd96408` (cambió respecto al informe anterior por un endurecimiento; el fragmento 1 y el 2 no cambian y el 2 sigue retirado).
| Pregunta | Respuesta (verificada con auditoría automática y pruebas) |
|---|---|
| ¿Hace peticiones de red? | **No.** Sin `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `performance`, `Request`, `Headers`. |
| ¿Escribe, hace clic, enfoca o cambia algo? | **No.** Solo lee; único efecto: copiar el JSON al portapapeles. |
| ¿Valores introducidos? | **No.** Nunca lee `.value` de campos; solo el rótulo de `<input>` de tipo botón. Lo que escribas (CF) no se captura. |
| ¿Sesión? | **No.** Sin cookies, almacenamiento, cabeceras ni `ViewState` (los `input hidden` se excluyen). |
| ¿Nombres? | **No se capturan por diseño**: ni valores ni el texto de las opciones de las listas (solo cuántas). Quedan etiquetas, títulos, texto de botones y encabezados (estáticos); el resultado de una consulta aparece como *valor* de un campo, que no se lee. |
| Endurecimiento nuevo | Los **literales de texto de 6+ caracteres dentro de expresiones `ng-*`** (posibles nombres o mensajes) salen como «…»; los códigos cortos (`'FACT'`) se conservan. Prueba: el JSON crudo no contiene el literal largo. |
| Riesgo residual | Etiquetas, títulos o encabezados que la página personalice con un nombre (no se detectan por patrón) → **revisa el JSON antes de enviarlo**. Con CF el nombre devuelto es genérico. |

## 3. ¿Se puede probar con CF, sin datos de terceros?
**Sí.** «CF» (consumidor final) es un valor genérico: no identifica a ninguna persona ni empresa, así que no hay datos fiscales de terceros. Lo que sí debes saber:
- Si al escribir CF la página **hace una consulta**, tú estarás haciendo una consulta normal desde tu sesión (como al facturar); no se guarda nada.
- **Puede que CF no dispare ninguna consulta** (es un caso especial en muchos sistemas). Entonces aprenderemos que *con CF no hace falta permitir ninguna petición*, pero **no** cómo se comporta la consulta con un NIT real. Si eso ocurre, la decisión siguiente (un NIT tuyo propio, con la ruta enmascarada) la tomas tú; no se hará sin tu autorización.
- **Por privacidad, nunca copies la ruta tal cual si contiene números** (podría llevar un NIT): sustituye cualquier número por `X`. Con CF no debería haber ninguno.

## 4. Instrucciones, paso a paso (Windows + Chrome; sin Git ni Node.js)
El formulario real es un **iframe** (`felav.c.sat.gob.gt`) dentro de la página del menú. Hay que ejecutar el fragmento *dentro* de ese iframe.
**A. Preparar el archivo (1 min)**
1. Guarda el `observar-consola-3.js` que te adjunto en Descargas. En PowerShell: `Get-FileHash "$env:USERPROFILE\Downloads\observar-consola-3.js" -Algorithm SHA256` → debe ser exactamente `b227b949ceeabb44cf088c6ee153e1b092d12ab34654377b64a74699bfd96408`. Si no coincide, no sigas.
2. Ábrelo en el Bloc de notas y léelo (al principio está la lista cerrada de selectores).
**B. Preparar DevTools (2 min)** — con la pestaña del formulario real, en el estado inicial, sin tocar nada.
3. Pulsa `F12` → pestaña **Network** (Red).
4. Marca **Preserve log** (Conservar registro) y en el filtro elige **Fetch/XHR**.
5. Clic derecho en la cabecera de columnas → activa **Method**; en **Name** activa **Path** si aparece (si no, usarás el nombre y pasarás el ratón por encima para ver la ruta).
6. Pulsa el icono 🚫 para **limpiar** el registro.
7. Importante: **no abras filas** (no mires Payload, Headers ni Cookies) y **no uses** «Copy as cURL/fetch», «Save all as HAR» ni «Copy response»: esos contienen cookies y datos.
**C. Acciones manuales (1 min)** — solo estas dos, y **nunca Enter**:
8. Elige con el ratón el radio **NIT**. Espera 5 s y anota las filas nuevas del registro (**A**).
9. Haz clic en el campo del NIT, escribe **CF** y pulsa **Tab** (sale del campo). Espera 5 s y anota las filas nuevas (**B**).
10. Mira la pantalla: ¿apareció algún campo con un nombre? ¿en qué campo (no copies el nombre)? ¿algún aviso o ventana? (anota solo si apareció y de qué tipo).
**D. Observación (2 min)**
11. Pestaña **Console** (Consola). Arriba a la izquierda hay un selector que dice `top`: ábrelo y elige la entrada **felav.c.sat.gob.gt…** (el iframe). Comprueba escribiendo `location.hostname` + Enter: debe responder `felav.c.sat.gob.gt`.
12. Escribe `allow pasting` + Enter (protección normal de Chrome), pega todo el contenido de `observar-consola-3.js` y Enter. Debe decir «Copiado al portapapeles».
13. Pega en el Bloc de notas y guarda `sat-2d.json`. Revísalo: busca nombres de personas o de tu empresa (los números largos y correos ya salen `[REDACTADO]`).
14. Cierra DevTools con `F12`. No pulses nada más en el formulario (Vista Previa, guardar y emitir quedan intactos).
**E. Qué me envías**
- La tabla de red (plantilla abajo) y las respuestas del punto 10.
- `sat-2d.json` ya revisado.
**Plantilla de red** (una fila por petición; **solo método, ruta enmascarada y código de estado**; sin query, sin números):
| Momento | Método | Ruta (números → X, sin ?parámetros) | Estado |
|---|---|---|---|
| A (al elegir NIT) | | | |
| B (al salir del campo con CF) | | | |
**Detente y avísame si:** aparece cualquier ventana que pida confirmar o guardar; en Network ves rutas con palabras como emitir, certificar, firmar, guardar o vista previa; se cierra la sesión; o algo no se parece a estas instrucciones.

## 5. Qué decidiremos con el resultado (implicaciones para el motor)
| Lo que veas | Consecuencia para la automatización |
|---|---|
| **No hay ninguna petición** (A y B vacías) y el nombre aparece solo o no aparece | Con CF el motor **no necesita permitir nada**; la red de solo lectura puede quedar como está. |
| **Solo GET** | Ya pasan (los GET no se bloquean). Solo hay que ajustar tiempos de espera (`leer` con reintento, `salir_del_campo`). |
| **Un POST de consulta** (ruta de «consulta/receptor/NIT/validar», sin palabras de emisión) | Hoy lo **bloquea** la guardia y el nombre no aparecería. Opción: permitir **esa ruta exacta** en `permitir_post` (método + host + prefijo de ruta), revisada por ti y nunca con palabras de emisión (el validador ya lo impide). Alternativa: no depender de la consulta usando CF. |
| **Ruta con palabras de emisión/guardado** | **No se permite jamás**; si la consulta usara esa ruta, la automatización del receptor no es viable y lo documentamos. |
| El nombre solo aparece tras **blur** | El paso `salir_del_campo` ya existe; sin él, la consulta ocurre al pasar al campo siguiente. |
Cambios hechos hoy en el motor por lo del iframe: la **comprobación de dominio también aplica al host del marco** (un iframe de otro host que contenga el texto esperado se rechaza), la búsqueda del marco compara **host + ruta** (sin puerto ni parámetros), y los hosts de SAT se resuelven a localhost solo en la prueba (el navegador de pruebas no resuelve ningún otro nombre).
