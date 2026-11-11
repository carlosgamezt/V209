# Instalar y verificar la PoC en Windows (ETAPA 0: sin SAT)

> **Esta guía NO toca SAT.** Todo lo que verás ejecutarse usa **páginas simuladas** en tu propio equipo. La **Etapa 1** (comprobar localizadores en el portal real) y la **Etapa 2** (llenado en seco) **no están autorizadas todavía**: no las ejecutes.
> El ZIP no contiene credenciales, cookies, sesiones, observaciones del portal ni datos personales.

## 1. Instalar Node.js (una sola vez)
1. Entra en **https://nodejs.org** y descarga la versión **LTS** (botón verde, instalador `.msi`).
2. Ejecútalo y pulsa *Next* en todo (no marques «Tools for Native Modules»; no hace falta).
3. **Cierra y abre de nuevo PowerShell** (tecla Windows → escribe `PowerShell` → Enter) y comprueba:
   ```powershell
   node -v      # debe mostrar v20 o superior (p. ej. v22.x)
   npm -v
   ```
   Si PowerShell dice que *«la ejecución de scripts está deshabilitada»* al usar `npm`, escribe `npm.cmd` y `npx.cmd` en lugar de `npm` y `npx` (o usa el Símbolo del sistema `cmd`).

## 2. Descomprimir el ZIP
1. Comprueba que el archivo no está alterado (la huella te la doy en el chat):
   ```powershell
   Get-FileHash "$env:USERPROFILE\Downloads\NEXA-FEL-PoC-fel-fase-1-0-XXXXXXX.zip" -Algorithm SHA256
   ```
2. Clic derecho → **Extraer todo…** → carpeta **`C:\fel-poc`** (ruta corta; evita OneDrive y Escritorio).
3. Entra a la carpeta de la PoC:
   ```powershell
   cd C:\fel-poc\NEXA-FEL-PoC\fel\poc-sat
   ```

## 3. Instalar las dependencias (necesita internet; no pide credenciales)
```powershell
npm install
npx playwright install chromium
```
- `npm install` baja **Playwright 1.49.1** y **AngularJS 1.5.8** (este último solo se usa en la simulación).
- `npx playwright install chromium` baja un Chromium de pruebas (~170 MB) **solo para las simulaciones**. Las pruebas reales usarán **tu Chrome**, no este.
- Si falla por proxy, antivirus o red de la empresa, copia el mensaje y me lo envías.

## 4. Verificar la instalación (solo páginas simuladas)
```powershell
npm run huellas             # confirma que los fragmentos de consola son los revisados (todos «OK»; el nº 2 está RETIRADO: no usar)
npm run verificar:rapido    # pruebas de reglas, sin navegador: debe terminar con «pass 26» y «fail 0»
npm run verificar           # todo: reglas + 32 casos con Chrome + 18 de simulación AngularJS (1–3 min)
```
**Resultado esperado de `npm run verificar`:** `# pass 26 · # fail 0`, luego **`32/32 casos OK`** y **`18/18 casos OK`**.
- Qué hace: abre un Chromium **invisible** contra páginas locales (`127.0.0.1`). Para probar los nombres de host de SAT, **los resuelve a tu propio equipo y no resuelve ningún otro nombre**: es imposible que contacte con SAT.
- No deja archivos: borra lo que crea. No escribe nada fuera de la carpeta temporal.
- Si el firewall de Windows pregunta algo, es por el puerto local de pruebas: **«Cancelar» o permitir solo redes privadas** (nada sale a Internet).
- Si algún caso falla, copia **toda** la salida (no contiene datos) y me la envías.

## 5. Comando de «solo comprobar» — SOLO DOCUMENTADO, **NO EJECUTAR TODAVÍA**
Este comando es de la **Etapa 1** (no autorizada). Se conectaría a un Chrome tuyo con sesión SAT iniciada por ti, **resolvería los localizadores sin escribir, elegir, marcar, salir de campos ni pulsar nada**, y se detendría. Para correr contra el portal real el programa **exige una autorización explícita por etapa**; sin ella **se niega**:
```powershell
# NO EJECUTAR hasta que se autorice la Etapa 1
$env:FEL_AUTORIZACION_SAT = "si"; $env:FEL_ETAPA_AUTORIZADA = "etapa1"
copy config\empresa.ejemplo.json config\empresa.local.json
node bin\ejecutar.mjs --empresa=config\empresa.local.json --mapeo=config\mapeo.sat-preliminar.json --datos=config\datos-ficticios-lineas.json --solo-comprobar
```
Requisitos previos (también de la Etapa 1): un Chrome **con perfil separado y puerto de depuración local** (implica **iniciar otra sesión SAT**), el formulario abierto en el iframe, y la revisión del paso pendiente sobre la petición a `felav02.c.sat.gob.gt` (`docs/informe-viabilidad-fase-2.md`). `--solo-comprobar` **no** escribe en ningún campo, así que no dispara esa petición.

## 6. Qué sigue bloqueado, siempre
**Vista Previa, Guardar, Eliminar, Editar impuestos, «Agregar …», certificar y emitir** no pueden pulsarse (se rechazan por texto, `title` y `ng-click`). La red es de solo lectura: se aborta todo POST/PUT/PATCH/DELETE; los GET con rutas de emisión o guardado se bloquean; un XHR/fetch a un dominio **no listado** (como `felav02`) se bloquea salvo regla `permitir_get` revisada una por una (hoy **ninguna**). Los datos son ficticios (NIT = CF). No hay emisión.

## 7. Qué contiene el ZIP
`fel\poc-sat` (código, pruebas, mapeo preliminar, análisis de las observaciones sin datos personales) y `fel\docs` (los informes de la PoC), más `VERSION.txt` con la rama, el commit y las huellas. **No** contiene: `node_modules`, observaciones del portal, registros, perfiles de Chrome, archivos `.local`, credenciales ni cookies.

## 8. Desinstalar
Borra `C:\fel-poc`. Para quitar también el Chromium de pruebas: borra `%LOCALAPPDATA%\ms-playwright`.
