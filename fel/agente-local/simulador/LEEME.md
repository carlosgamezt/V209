# Simulador local del formulario FEL (solo pruebas del agente)

**SIMULADO - SIN VALOR FISCAL.** No es el portal de SAT: no emite documentos reales, no usa credenciales y no contacta ningún host (solo escucha en `127.0.0.1`).

- Iniciar: `node fel/agente-local/simulador/servidor.mjs` (imprime la URL y el token de control; puerto con `FEL_SIM_PUERTO`).
- **Formulario** (`/f/<sesión>`): documento, fecha, establecimiento, receptor (NIT/CUI/EXT/CF), conceptos (cantidad, precio, descuento), validaciones en el servidor, **vista previa** y botón «Confirmar emisión simulada».
- **Quién puede confirmar:** solo una petición del navegador con el token de la vista previa. La superficie de control (`/control/…`, con token) crea sesiones, consulta estados/eventos/libro e interrumpe, pero **no puede confirmar**: una confirmación que lleve el token de control se rechaza (`SOLO_HUMANO`), aunque el token CSRF sea válido.
- **Fallos inyectables** al crear la sesión (`fallo`): `error_antes` (error antes de registrar), `corte_tras_confirmar` (se registra y se corta la conexión: resultado incierto para quien mira), `lento`.
- **Duplicados:** el simulador *no deduplica a propósito* (como un portal real tolerante); registra `emision_duplicada_de_referencia`. La defensa contra duplicados es de NEXA (operación única, orden única, `por_verificar`).
- **Aislamiento:** todo va ligado a la empresa de la sesión; otra empresa recibe «no existe».
- **Límite conocido:** un agente que controla el navegador con Playwright produce eventos de usuario válidos; impedir que pulse «Confirmar» es una regla del propio agente (commit 6) además de la del servidor.
- Pruebas: `node --test "fel/agente-local/pruebas/*.test.mjs"` (núcleo, servidor HTTP y Chromium; Playwright 1.49.1).
