# Etapa 2 — informe de validación integral LOCAL

Base: commit `951dd1e`, rama `fel-fase-1-0`. **No se contactó con SAT, no se usaron credenciales, no se ejecutó la Etapa 2 real, no se tocó `main` ni se desplegó. La Etapa 2 sigue NO autorizada.**

## 1. Cómo se probó

El ensayo extremo a extremo ejecuta el comando real `node bin/ejecutar.mjs` contra una página AngularJS 1.5.8 **simulada** servida en localhost dentro de un iframe, como en el portal. Los nombres reales de host (`farm3.sat.gob.gt`, `felav.c.sat.gob.gt`) se resuelven a `127.0.0.1` solo dentro del Chrome de prueba (`--host-resolver-rules … MAP * ~NOTFOUND`), de modo que nada sale a Internet. El ejecutor se conecta por CDP a ese Chrome, con las variables de autorización de Etapa 2, el mapa **real** `mapeo.sat-etapa2.json` (copia temporal con solo el indicador de sesión confirmado, lo que haría la persona) y los datos ficticios reales. Chrome de las pruebas: Chromium de Playwright (Linux); en tu Windows se ejecuta con `FEL_NAVEGADOR=chrome`.

## 2. Pruebas de extremo a extremo (comando real, modo estricto)

| # | Prueba | Resultado |
|---|---|---|
| 1 | Tramo 2A feliz: radio verificado sin pulsarlo, dirección + una línea, total leído (251.00), termina «detenido», código 0 | OK |
| 1b | En esa misma ejecución: 0 POST, sin archivo de progreso, 0 solicitudes bloqueadas, Vista Previa/impuestos sin abrir, 1 sola línea, NIT sin escribir, el radio no ejecutó su manejador, el registro no contiene valores (descripción, precio, total, nombre, dirección, cookie, token) | OK |
| 2 | Rechazos del comando (código 2, sin tocar la página): sin variables; autorización de Etapa 1; sin condiciones de uso revisadas; otra empresa confirmada; `--reanudar`; mapa con clic en «Vista Previa» | OK (6/6) |
| 3 | Autoguardado (POST inesperado al cambiar un campo): estado `detenido_por_alerta`, solicitud `POST …/api/autoguardado` bloqueada, no llega al paso siguiente, 0 POST al servidor | OK |
| 4 | Diálogo inesperado: `detenido_por_alerta` | OK |
| 5 | Pérdida de sesión en pleno llenado: `sesion_perdida`, sin esperar ni reanudar | OK |
| 6 | Campo ambiguo (`Descripcion0` input + select): `interrumpido`, error en `p120`, no sigue | OK |
| 7 | Radio NIT sin marcar: `interrumpido`, error en `p010`, **no se pulsa**, no se escribe nada | OK |
| 8 | Tramo 2B: el mapa tal como se entrega se niega por `p026`; confirmado en copia local pero sin `permitir_get` para la consulta a otro dominio, la petición se bloquea y se detiene | OK |

En todas las anomalías: código de salida ≠ 0 y ≠ 2 (detención en ejecución, no rechazo previo), 0 POST, Vista Previa/impuestos intactos y sin llegar al fin del plan.

## 3. Pruebas del motor (en proceso, sin CLI)

Llenado 2A con modelos AngularJS y total numérico; formatos del total (coma sin declarar → se detiene; con `decimal=","` pasa; sin decimales dentro de tolerancia; valor distinto → falla); GET a dominio no listado con y sin regla aprobada y fechada; localizador ambiguo; acciones inalcanzables (el mapa de Etapa 2 no contiene clics ni `marcar`; los campos fuera de la lista cerrada, `permitir_post` y `permitir_get` sin `aprobado_por`/`fecha` se rechazan); mapa real sin confirmar.

## 4. Baterías completas (re-ejecutadas)

| Batería | Resultado |
|---|---|
| Unitarias (`node --test`) | 32/32 |
| Navegador (Chrome real/CDP) | 32/32 |
| Simulación AngularJS (incluye Etapa 1 y Etapa 2) | 39/39 |
| Simulación con pausa artificial de 300 ms por paso (independencia de velocidad) | 39/39 |
| CI de GitHub (commit anterior `951dd1e`) | verde; el del commit de este informe se verifica al subirlo |

Ninguna protección se eliminó ni se debilitó; las pruebas previas siguen intactas (25 de simulación + 10 + 4 nuevas de Etapa 2 y 4 unitarias).

## 5. Errores encontrados y correcciones

**En el producto (ejecutor, guardia, mapa): ninguno.** El ensayo extremo a extremo no destapó ningún defecto de las protecciones.

**En mis propias pruebas (corregidos antes de dar el resultado por bueno):**
1. Mi primera versión comprobaba las anomalías buscando palabras («diálogo», «sesión», «ambiguo») en la salida del comando, pero el aviso inicial del propio comando las contiene todas: la aserción habría pasado aunque no hubiera detención. Se reemplazó por el estado final registrado (`detenido_por_alerta`, `sesion_perdida`, `interrumpido`), la solicitud bloqueada concreta y el id del paso que falló.
2. Ajustes de arnés: API del monitor de sesión, intervalo mínimo 1000 ms, nombre del gancho `antesDeEjecutar`, `--hasta` no acepta el paso `detener` (se usa el plan completo), y las anomalías corren con el tramo 2A para no mezclar el paso `p026` sin confirmar.
3. La simulación se amplió con variantes (`?radio=nit`, `?autosave=1`, `?alerta=1`, `?expirar=1`, `?formato=coma|entero`), y la portada pasa sus parámetros al iframe.

## 6. Riesgos pendientes (no cubiertos por una simulación)

- El portal real puede tener manejadores (`ng-blur`, `ng-keyup`, jQuery) y efectos al escribir que no observamos: la simulación solo reproduce los que declaramos.
- Posible autoguardado real o consultas de red distintas: si ocurren, el robot se detiene (probado en simulación), pero eso ya sería un hallazgo contra el portal real.
- Formato real del total (coma/punto/miles) desconocido; el mapa lo compara con separador declarado y si no coincide se detiene.
- La consulta del CF a `felav02` (otro dominio) sigue sin revisar: bloquea el tramo 2B hasta una decisión específica.
- Subtotal y total del documento no observados; efecto de cambiar el tipo de línea no observado.
- Condiciones de uso de SAT sin revisar: sin revisión no se debe ejecutar.
- Las pruebas corren en Linux con Chromium; en Windows con Chrome 157 la verificación completa debe repetirse (`npm run verificar:chrome`) antes de cualquier prueba real.
- El ensayo con Chrome local no demuestra seguridad frente al portal real: demuestra que, ante las anomalías simuladas, el robot se detiene y no pulsa nada.

## 7. Próximo paso

Revisión conjunta de este informe y de `fase-3-etapa-2-diseno.md`. Nada se ejecuta contra SAT sin una autorización nueva, explícita e independiente para la Etapa 2 (plantilla en D.6 del documento de diseño).
