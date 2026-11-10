# Fase 2 — Observación del formulario real (solo lectura)

> **Estado honesto:** esta sesión de Claude **no tiene ningún equipo tuyo conectado**, así que Claude **no puede ver tu Chrome ni ejecutar nada en él**. Las herramientas están listas y probadas contra **páginas simuladas** (una genérica y una que imita patrones generales de JSF/PrimeFaces, ninguna es el portal real). **La observación del portal real la ejecutas tú en tu Windows** y compartes el resultado (revisado). Nada de lo de abajo emite, llena campos ni envía peticiones.
> Reglas: no se extraen contraseñas, cookies, tokens, `ViewState` ni valores de campos · no se hacen clics ni se llena nada · no se emite · sin Supabase.

## 1. Decisión previa: ¿cómo conectamos? (necesito tu confirmación antes de la vía A)
Tu Chrome actual ya tiene la sesión iniciada **pero no se abrió con puerto de depuración**, y Chrome reciente no lo activa en el perfil normal. Para que Playwright se conecte a *esa* ventana habría que **cerrar y reabrir Chrome** → se perdería la sesión SAT. **No lo recomiendo ni lo haré.**

| | **Vía B — fragmento en la consola (recomendada primero)** | **Vía A — Playwright con perfil separado** |
|---|---|---|
| Qué hace | Pegas un fragmento de solo lectura en la consola de DevTools de **la pestaña actual** y copias su resultado | Abres un **segundo Chrome independiente** (otro `--user-data-dir`, puerto de depuración **solo local** 127.0.0.1:9222) y Playwright se conecta a él |
| ¿Cierra o toca tu Chrome actual? | **No** | **No** (es otro proceso con otro perfil; no cambia la configuración del actual) |
| ¿Abre otra sesión SAT? | **No** | **Sí**: tienes que iniciar sesión **otra vez** en el segundo Chrome. **No sabemos** si SAT invalida la sesión anterior (está en la lista de pendientes). Guarda/termina lo que tengas en la ventana actual antes |
| ¿Usa Playwright? | No (procesas el resultado con `importar-observacion.mjs`) | Sí (es lo que realmente queremos validar: la conexión) |
| Limitaciones | Solo el documento superior; para un iframe cambias el contexto de la consola (`top`) y repites | Ve todos los marcos accesibles |
**Mi recomendación:** haz primero la **vía B** (cero riesgo para tu sesión). Cuando quieras validar la conexión de Playwright, y solo con tu OK explícito a abrir otra sesión, la **vía A**.

## 2. Preparación en Windows (PowerShell)
```powershell
# Node 20+ instalado (node -v). Trae solo esta rama:
git clone --branch fel-fase-1-0 --single-branch https://github.com/carlosgamezt/V209.git
cd V209\fel\poc-sat
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"   # no necesitamos descargar navegadores: se usa tu Chrome
npm install
node --test tests\guardia.test.mjs             # debe decir: pass 20, fail 0 (no abre ningún navegador)
```
(`npm test` completo necesita el Chromium de Playwright y está pensado para la CI; no hace falta aquí.)

## 3. Vía B — consola de Chrome (sin Playwright, sin nueva sesión)
1. Abre `consola\observar-consola.js` en el Bloc de notas y **léelo** (unas 100 líneas, solo lee; no hace peticiones, no escribe, no hace clic; hay una prueba automática que lo exige).
2. En la pestaña del formulario real: `F12` → pestaña **Console**. Chrome pedirá escribir `allow pasting` (protección normal): escríbelo y Enter.
3. Pega **todo** el contenido del archivo y Enter. Verás «Copiado al portapapeles…».
4. Abre el Bloc de notas, pega y guarda como `consola.json` (dentro de `fel\poc-sat`).
5. Procesa:
   ```powershell
   node bin\importar-observacion.mjs --entrada=consola.json --alias=empresa-a
   ```
   Genera en `observaciones\` el inventario (`.json`) y el borrador de mapeo (`.mapeo-borrador.json`) y muestra el resumen con **posibles obstáculos**.
6. **Campos dinámicos:** guarda esa observación como «antes». Luego **tú, a mano**, abre la sección o elige el tipo/opción que haga aparecer más campos (sin emitir), repite 2–5 con `--alias=empresa-a-despues` y compara:
   ```powershell
   node bin\comparar.mjs observaciones\<antes>.json observaciones\<despues>.json
   ```
7. **Iframes:** si el resumen dice `marcos_sin_inspeccionar_en_consola`, en la consola cambia el selector de contexto («top») al iframe y repite.

## 4. Vía A — Playwright con perfil separado (solo con tu confirmación)
**Qué hará cada comando, antes de ejecutarlo:**
1. `Start-Process chrome …` abre una **segunda ventana de Chrome** con perfil nuevo en `%USERPROFILE%\fel-poc\perfiles\empresa-a` y puerto de depuración **local**. **No** cierra ni cambia tu Chrome actual. Tienes que **iniciar sesión a mano** (otra sesión SAT → posible efecto sobre la actual) y abrir tú el formulario sin emitir.
2. `node bin\observar.mjs …` se conecta a ese Chrome (rechaza cualquier dirección que no sea local), **solo lee** la pestaña elegida, no hace clic ni escribe, no solicita nada, y **suelta** la conexión sin cerrar tu Chrome.
```powershell
# (1) segunda ventana, perfil separado — pide tu confirmación antes
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9222","--user-data-dir=$env:USERPROFILE\fel-poc\perfiles\empresa-a","--no-first-run"
#    → inicia sesión a mano en ESA ventana, abre el formulario (sin emitir). Comprueba en su navegador: http://127.0.0.1:9222/json/version
# (2) observar (solo lectura)
Copy-Item config\empresa.ejemplo.json config\empresa.local.json
node bin\observar.mjs --empresa=config\empresa.local.json          # si hay varias pestañas candidatas: --pestana=N
# (3) al terminar, cierra SOLO esa segunda ventana (cierra el puerto de depuración)
```
Mientras el puerto está abierto, cualquier programa de tu equipo podría controlar *esa* ventana: úsala solo para esto y ciérrala.

## 5. Qué se registra y qué nunca
| Se registra | Nunca se registra |
|---|---|
| Etiquetas, tipos, `name`, `id` estable, marcador, rol, requerido/deshabilitado/solo lectura | Valores de campos (ni escritos por ti) |
| Ruta DOM resumida (etiquetas y clases `ui-`/`p-`; ids solo si son estables) | Contraseñas, cookies, tokens, almacenamiento, cabeceras |
| Candidatos de localizador y si son **únicos** | `javax.faces.ViewState` (solo se anota que JSF está presente) |
| Formularios: método y **ruta** de acción, sin `;jsessionid` ni `?parámetros` | Parámetros de URL, identificadores de sesión (se sustituyen por `:id`) |
| Marcos (host + ruta), CAPTCHA, shadow DOM, componentes JSF/PrimeFaces (conteos) | Textos del cuerpo de la página (solo etiquetas/botones) |
| Botones y acciones sensibles (emitir, enviar, guardar, cerrar sesión…, envío AJAX) | Opciones de listas (solo cuántas; con `--opciones` en vía A se incluyen: **no las uses** si pueden traer clientes) |
**Antes de compartir:** abre el `.json` y revísalo. Las etiquetas, el título o el host pueden contener el **nombre de tu empresa**; tacha lo que no quieras compartir. `observaciones\` y `consola.json` están en `.gitignore` (no los subas al repositorio).

## 6. Qué obstáculos se analizan (y qué haré con ellos)
El resumen lista, con severidad: ids autogenerados (`j_idt…`), campos sin etiqueta o sin localizador único, **componentes personalizados** (desplegables, autocompletar, calendario → el paso `seleccionar` hoy solo soporta `<select>` nativo; haría falta un tipo de paso nuevo diseñado con lo observado), **envío AJAX de JSF** (la red de solo lectura bloquearía esas peticiones: se decidirá caso por caso con «solicitudes bloqueadas»), tablas/asistentes/diálogos (campos dinámicos), marcos, shadow DOM, CAPTCHA, ViewState atado a la pestaña (no recargar ni duplicar pestañas) y los botones peligrosos. **Todo esto son hipótesis a contrastar con lo que salga de tu portal; no se asume nada de su estructura.**

## 7. Qué me entregas y qué te devuelvo
1. Tu resumen de consola (texto) y, revisado, el `.json` del inventario (o las partes relevantes).
2. Yo analizo: campos reales, localizadores propuestos (ordenados por estabilidad), obstáculos reales, tipos de paso nuevos necesarios, y reviso el **borrador de mapeo** (todo sigue `verificado:false`/`dato:null` hasta que lo confirmes contra el portal).
3. Siguiente fase (no antes): construir el mapeo, y solo entonces plantear `bin/ejecutar.mjs` en seco con datos ficticios y parada obligatoria. **`ejecutar.mjs` no se usa en esta fase.**

## 8. Detente si…
La página pide algo inesperado, SAT te cierra la sesión, ves un aviso de actividad sospechosa o dudas de cualquier paso. Nada de esto es urgente.
