# Texto de arranque para un chat nuevo de Claude Code
Abre el chat con el repositorio `carlosgamezt/V209` (rama `main`). Claude lee `CLAUDE.md` solo; este texto fija el objetivo. Pega UNO (no se mezclan productos en un mismo chat; NEXA FEL no se toca).

## A) Genérico (cambia {PRODUCTO})
```
Vamos a construir NEXA {PRODUCTO} desde cero, solo este producto en este chat.
1) Lee CLAUDE.md, docs/egress/ESTANDAR-DESARROLLO-NEXA.md y docs/plantillas/README.md. No toques NEXA principal, NEXA FEL ni otros productos; no generes costos; no publiques nada en producción ni a main sin mi autorización expresa; no pegues ni pidas claves en el chat.
2) Crea tu rama de trabajo y la carpeta del producto con la estructura de la plantilla. Primero entrégame el PLAN (módulos, tablas con prefijo del producto, roles y permisos, pantallas, datos de prueba, riesgos, qué probarás y cómo) en una página, y espera mi visto bueno antes de programar.
3) Desarrolla todo contra la réplica local (PostgreSQL local con RLS, funciones con Deno y simulaciones, interfaz con Playwright) y deja pruebas automáticas. Al final, una sola suite integral y un informe corto (real vs simulado).
4) Prepara el flujo de VISTA PREVIA con enlace de pruebas (plantilla de docs/plantillas) para que yo lo pruebe desde mi dispositivo sin tocar producción, con datos de ejemplo.
5) Cuando yo cree el proyecto de Supabase del producto, te daré la URL y la clave publicable (nunca la secreta); entonces preparas las migraciones auto-verificadas, sin aplicarlas hasta que lo autorice.
Responde en español, breve. Agrupa lo que necesites de mí con instrucciones exactas.
```

## B) NEXA POS (añadir al genérico)
```
Contexto POS: venta en mostrador con varias sucursales/cajas, catálogo e inventario, apertura/cierre de caja, ventas, pagos mixtos, devoluciones, corte por turno y reportes. Debe funcionar con mala conexión (cola local y sincronización incremental). Roles: administrador, gerente, cajero, solo lectura. Facturación electrónica (FEL) queda FUERA: solo deja un punto de integración documentado.
```

## C) NEXA Colegios (añadir al genérico)
```
Contexto Colegios: estudiantes, familias/encargados, grados y secciones, cuotas y cobros, becas/descuentos, estados de cuenta, comunicados y asistencia. Roles: administración, secretaría, docente, familia, solo lectura. Privacidad estricta de menores: cada familia ve solo a sus hijos; auditoría de accesos. Documentos y fotos con transferencia directa al almacenamiento.
```

## D) NEXA Hotel (añadir al genérico)
```
Contexto Hotel: habitaciones y tipos, reservas, disponibilidad por fechas sin traslapes, check-in/check-out, tarifas y temporadas, consumos, limpieza/mantenimiento y reportes de ocupación. Roles: administración, recepción, limpieza, solo lectura.
```
