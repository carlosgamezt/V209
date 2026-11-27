# Informe de preparación local (fase 4) — candidato estable para el ensayo hospedado

Rama `fel-proveedores-diseno`, desde cf6a552. Solo local. No se tocó `nexa-demo`, producción ni otros worktrees; sin Resend, sin correos, sin certificación real, sin clientes reales; el borrador a Digifact no se modificó ni se publicó; sin credenciales ni costos. Alcance **congelado**: no hay nuevas fases de refactorización; solo se corrigen fallos críticos.

## 1. Qué se hizo
1. **Cierre local de R3** (`RIESGO-RESIDUAL-R3.md` §3): prelecturas (`api.documento_ref/cliente_ref/referencia/documento_cobertura`), `/api/estado` y `/api/configuracion` (`api.empresa_contexto`), Digifact/correo/almacén/límites con **cerrojo estructural de SQL directo** y siete `fel_sys_*`; privilegios mínimos de `nexa_sys` (cuatro tablas de servicio); funciones DEFINER auditadas (`search_path` vacío, `revoke` explícito, solo `nexa_sys`/`authenticated` según el caso).
2. **Identidad y empresa también en escrituras:** el JWT lo **verifica el servidor** (ES256/RS256 por JWKS) en rutas fuera de la Data API, `sub` = persona de la sesión, sesión viva comprobada. *Hallazgo real corregido:* con un JWT de firma ajena la ruta de Digifact respondía 200.
3. **Condiciones previas:** respaldo/restauración, carga/concurrencia, monitoreo (`salud` del `tick`), rotación manual (con `FEL_SYS_SECRETO_ANTERIOR`). Ver `CONDICIONES-PREVIAS-LANZAMIENTO.md`.

## 2. Resultados de pruebas (todo en verde)
| Suite | Resultado |
|---|---|
| Aplicación | **154** (148 + cierre R3 3, verificador JWT 2, monitoreo/rotación 1) |
| Proveedores | **223** |
| Base de datos (`pruebas_db`) | **59** con migraciones solas y con todas las propuestas |
| Navegador (Chromium) | **20 de 20** (19 existentes + `e2e_paginacion`) |
| SQL rol-app / nexa_sys / cierre R3 / reversión (incluye `reversion-M-V`) | 20 OK, exit 0 |
| Multiempresa SQL, guardas de publicación | OK |
| Ensayos nuevos | respaldo/restauración OK · carga básica OK · rotación OK |
**Mutaciones** del cierre: TS 11/12 detectadas (la restante es equivalente: HS256 ya lo rechaza el `catch`); SQL 12/12 detectadas tras añadir dos casos (alerta de otra empresa y cobertura sin permiso con consumos reales).

## 3. Riesgos CERRADOS EN LOCAL vs que REQUIEREN `nexa-fel-test`
| Cerrado en local (evidencia arriba) | Requiere verificación hospedada |
|---|---|
| Lecturas de personas y de servicios sin pooler con identidad afirmada por la aplicación; cerrojo de SQL directo; privilegios mínimos de `nexa_sys`; rotación y monitoreo básicos; respaldo/restauración del esquema; concurrencia básica | **W0** (llaves asimétricas, claims, `auth.sessions`/`aal2`, cabecera de origen, ruta de funciones) |
| Verificación de JWT en servidor (con JWT del emulador) | **W5** (funciones separadas; delegar los pasos fiscales `fel_ses_sys_*` a `nexa-sys`; programador del `tick`) |
| Reversión de M-V y cadena completa | **W6** (Supabase Auth; retiro de `demo_sesiones`; sonda R1 «rechazada») → cierra R1 |
| | **Ensayo 1E** (M-D…M-V1/M-V/M-E por el pooler real), M-P, restauración en proyecto real, comparación contra #55, carga real |
**R1, R2 y R3 NO se declaran cerrados globalmente.** Riesgos que persisten: `nexa-sys` comprometido = todos los agentes (aceptado); la base no verifica la firma del agente; los 7 envoltorios `fel_ses_sys_*` dependen de token hasta W5/W6; mediciones locales no incluyen red.

## 4. Siguiente etapa
Ejecutar **W0, W5, W6 y el ensayo 1E** en `nexa-fel-test` con `SECUENCIA-Y-LISTAS-NEXA-FEL-TEST.md` (orden con M-V1 y M-V antes de M-E).
