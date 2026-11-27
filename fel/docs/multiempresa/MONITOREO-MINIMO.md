# Monitoreo mínimo — errores de certificación y procesos internos

**Verificado en local** (`tests/secreto_sistema_test.ts`): `POST /tick` de `nexa-sys` devuelve los conteos del ciclo y un bloque `salud` con `estado` = `ok` | `atencion` | `critico` y `motivos` (`MOTIVOS_SALUD` en `src/sistema.ts`): certificaciones con error, operaciones atascadas, cola de correos fallidos, ciclo con errores, etc. Sin datos de clientes en la respuesta (solo conteos).

## Qué configurar (sin costo adicional)
1. Programar el `tick` (cada 5 min) con el secreto; **alerta** si `salud.estado != ok` durante 2 ciclos seguidos, o si el `tick` no responde / no se ejecuta en 15 min.
2. Consulta de solo lectura diaria (administrador): operaciones de Digifact con error/estancadas, documentos en `certificando` > 15 min, `envios_correo` fallidos, latidos de agentes vencidos.
3. Registros de las funciones (`nexa-api`, `nexa-sys`): revisar tasas de 4xx/5xx; una racha de 403 en `/api/*` indica JWT inválidos o ataque.
4. Alertas: correo del titular o notificación del proveedor de la plataforma (sin Resend hasta autorización).

## Pendiente hospedado
Programador real del `tick`, destino de alertas y retención de registros (**W5**).
