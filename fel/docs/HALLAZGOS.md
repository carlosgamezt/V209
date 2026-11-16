# NEXA FEL · Registro de hallazgos del acceso anticipado (DEMO)
Cómo reportar: en la demostración, «Reportar un problema» (pie de página, o menú «Más» en móvil) copia versión, pantalla, rol, tamaño de ventana y errores recientes (sin datos de facturas ni clientes). Pégalo en el chat con qué esperabas y qué pasó.

| # | Versión | Pantalla | Hallazgo | Estado |
|---|---|---|---|---|
| 1 | demo-ea1 | Móvil · menú inferior | 9 accesos; «Plan y consumo» quedaba cortado | Corregido: 4 accesos + «Más» |
| 2 | demo-ea1 | Móvil · Nueva factura | Barra de acciones en dos filas tapaba campos | Corregido: una sola fila compacta |
| 3 | demo-ea1 | Todas | Sin rótulo explícito de DEMO/persistencia | Corregido: franja «DEMO · datos NO persistentes» (según la base real) |
| 4 | demo-ea1 | Nueva factura | Precio unitario Q0.00 se acepta | **Decidido (DEMO):** se acepta con aviso visible «solo DEMO, no válido para certificar»; los negativos se rechazan; al preparar para certificar (Digifact) se rechaza |
| 5 | demo-ea1 | Nueva factura | Mensaje «cantidad no válido» (concordancia) y no distingue negativo de texto | Pendiente (menor) |
| 6 | demo-ea1 | Consola | 404 de `/api/sesion` en modo de pruebas | No es un error: respuesta esperada sin inicio de sesión |

Validaciones comprobadas contra la API real (rechazan con 400): cantidad 0, negativa, texto o notación científica; precio negativo; más de 6 decimales; descuento >100 % o mayor que la línea; descripción vacía; sin líneas. Aceptan: decimales válidos (2.5 × 10.55).

7. (fallo de CI #126, **corregido**) `remoto.test.mjs` 1.er caso: «incierta» en lugar de «emitida». Causa: el agente leía sesión y libro del simulador en dos peticiones; si la persona confirmaba entre ambas, una lectura veía la emisión sin sesión confirmada. Ahora una discrepancia de una sola lectura se vuelve a leer; la persistente (y los duplicados) siguen siendo inciertas. Prueba determinista: `agente-local/pruebas/ejecutor_carrera.test.mjs`.
