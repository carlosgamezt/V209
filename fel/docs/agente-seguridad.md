# Seguridad del agente local (Fase 4)

## 1. Modelo de amenazas resumido
Equipo del usuario no confiable en parte (otro usuario de Windows, malware); red no confiable; un agente vinculado a la empresa A no debe poder tocar la B; un agente tardío o repetido no debe duplicar una emisión; nada de esto puede alcanzar SAT ni un certificador.

## 2. Separación estricta simulador ↔ integración real (condición 4)
| Capa | Control | Prueba |
|---|---|---|
| Base de datos | `ordenes_emision.ambiente = 'simulado'` (restricción de tabla); `portal_playwright` solo con `ambientes = {simulado}`; `digifact` **no habilitable** (restricción); el proveedor simulado solo en simulado; ningún canal real habilitable | pruebas SQL: `pruebas`/`produccion`/`digifact` rechazados |
| Servidor | Resultado `emitido_simulado` exige prefijo `SIM-`; `reclamar` solo entrega órdenes `simulado` | pruebas SQL y del plano de control |
| Agente | Lista blanca de hosts (solo el servidor NEXA configurado y `127.0.0.1` del simulador); cualquier otro host se bloquea y se registra; rechaza órdenes con `ambiente ≠ simulado` | pruebas del agente |
| Código | El conductor `simulador_fel` vive aparte; no existe conductor para el portal real; el simulador es un paquete separado | revisión + prueba de que no hay referencias a hosts reales |
| Datos | Documentos y empresas de prueba; sin NIT reales | — |

## 3. Credenciales y secretos
- **Ninguna contraseña SAT**: no hay campo, parámetro ni código que la reciba.
- Clave privada Ed25519 del agente: **solo en el equipo**, protegida con **DPAPI** en Windows (modo desarrollo con permisos 0600 en Linux, con aviso). Nunca se envía.
- Código de vinculación: un uso, 10 min, solo se guarda su hash; límite de intentos fallidos.
- Registros: JSONL **sin valores de campos**, sin tokens ni cabeceras ni claves; prueba con valores «sentinela».

## 4. Aislamiento entre empresas
`agentes_locales.empresa_id` inmutable; la empresa se toma siempre del agente autenticado, nunca del cuerpo; RLS en todas las tablas nuevas; pruebas con dos empresas (códigos, agentes, órdenes, reclamo, resultado cruzados).

## 5. Anti-reproducción y fencing
Firma sobre método+ruta+marca de tiempo+nonce+hash del cuerpo; nonce de un uso; ±60 s. Token de *fencing* incrementado en cada reclamo y exigido en `progreso`/`resultado`.

## 6. Auditoría
Vinculación, revocación, reclamo, presentación, resultado, vencimiento y cierre quedan en `auditoria` (actor: usuario o `sistema`/agente) y en los eventos de la operación.

## 7. Riesgos residuales (a revisar)
Clave privada en disco (DPAPI mitiga, no elimina); reloj desfasado del equipo (se detecta y se muestra como error); una persona puede confirmar en el simulador y el agente caer antes de informar: es precisamente el caso `incierta` ⇒ `por_verificar`.
