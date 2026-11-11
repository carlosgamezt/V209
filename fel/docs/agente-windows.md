# Agente local en Windows — preparación y validación (Fase 4, commit 7)

Alcance: **preparar y validar** el agente en Windows. El instalador definitivo (empaquetado, firma, inicio automático) **no** forma parte de este commit y requiere autorización aparte. Todo sigue limitado al simulador local: sin SAT, sin certificadores, sin contraseñas SAT.

## 1. Protección de la clave privada (DPAPI)
- La clave Ed25519 del equipo se guarda **protegida con DPAPI** (`ProtectedData`, ámbito `CurrentUser` + entropía propia de la aplicación): solo el mismo usuario de Windows, en el mismo equipo, puede abrirla. En disco solo existe el blob protegido (`identidad.json` → `clave_protegida`); **no hay PEM en claro ni copias**.
- Implementación sin dependencias nativas: el PowerShell que trae Windows, con ruta absoluta (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`), `-NoProfile -NonInteractive -EncodedCommand`, **sin** `-ExecutionPolicy` ni ningún cambio de directivas; los datos viajan por la entrada estándar (nunca por la línea de comandos).
- **Sin degradación**: en Windows solo existe el protector DPAPI; el protector de «archivo restringido» (0600, para desarrollo en Linux) **se niega a funcionar en Windows** y una identidad guardada con él no se abre allí. Si DPAPI falla (p. ej. PowerShell en modo restringido por directiva de la empresa), el agente **no arranca**: no hay alternativa más débil.
- Migración: una identidad del formato anterior (PEM en claro) se re-protege al abrirla y el texto plano desaparece.
- Pruebas: contrato (PowerShell simulado, en Linux y Windows) y DPAPI real en `windows-latest` (ida y vuelta, el blob no contiene el secreto, datos alterados o entropía distinta no se descifran).

## 2. Experiencia de inicio sin conocimientos técnicos
Hoy (versión de prueba): doble clic en **«Iniciar agente NEXA.cmd»** → se abre una página local con letra grande y un solo paso:
1. **Primera vez**: «Escribe el código que muestra NEXA (Configuración → Agente local → Generar código)» → botón **Vincular este equipo**. Los errores se dicen en lenguaje sencillo («ese código no es válido, ya se usó o venció; pide uno nuevo»).
2. **Después**: una frase de estado con un punto de color («Conectado a NEXA. Esperando una factura»; «La factura está lista en la ventana: una persona autorizada debe aprobarla en NEXA y confirmar»; «No se pudo confirmar con certeza… NO la repitas»), la lista de lo último que pasó y tres botones: **Pausar**, **Reanudar**, **Cerrar el agente** (cierre ordenado).
3. Abrirlo dos veces **no** inicia otro agente: vuelve a mostrar el mismo panel.
Seguridad del panel: solo 127.0.0.1, ruta con secreto aleatorio, cabecera propia en cada acción, verificación de Host/Origin, CSP estricta, sin trazas ni detalles técnicos en los mensajes.
**Falta para el instalador definitivo (no incluido)**: empaquetar Node.js dentro del instalador (hoy el `.cmd` avisa con un mensaje claro si no está), firmar el instalador, icono en la bandeja, inicio automático con Windows, desinstalación que borre identidad y perfil, actualizaciones.

## 3. Cierre ordenado y recuperación
- Cierre (botón, Ctrl+C, `SIGTERM`/`SIGBREAK`): el agente **no reclama más**, resuelve la orden en curso (con la vista previa abierta: cierra la sesión del simulador, consulta el libro y descarta si nada se emitió), cierra Chromium y después el panel; sale con código 0.
- Caída del proceso (matarlo): el diario conserva la orden presentada; al volver a abrir, el agente cierra la sesión vieja, **consulta el libro** y resuelve sin repetir nada; después sigue trabajando con el mismo perfil de Chromium.

## 4. Límites declarados
- Windows en CI se valida con `windows-latest`; no equivale a todos los equipos de las empresas (antivirus, directivas de PowerShell, perfiles de usuario itinerantes). 
- Las firmas, SmartScreen y la reputación del instalador no se tratan aquí.
- El agente sigue sin confirmar nada: la autorización humana es la de `agente-confirmacion-humana.md`.
