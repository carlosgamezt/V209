# NEXA FEL · demostración funcional de la facturación individual SIMULADA

**Todo es simulado.** No usa credenciales, no se conecta a SAT ni a ningún certificador, no emite nada, y cada pantalla y cada archivo llevan **«SIMULADO - SIN VALOR FISCAL»**.
No es una maqueta: la interfaz habla con un servidor local que usa **las mismas migraciones SQL, el mismo orquestador y el mismo proveedor simulado** que las pruebas del proyecto (base PostgreSQL real en memoria con PGlite). Playwright contra SAT **no** interviene.

## Ejecutarla en tu PC (Windows)
1. Instala **Deno** una sola vez (programa gratuito): en PowerShell, `winget install DenoLand.Deno` (o `irm https://deno.land/install.ps1 | iex`) y vuelve a abrir la ventana.
2. Descomprime el ZIP y entra a `fel\demo-facturacion`.
3. Haz doble clic en **`INICIAR-DEMO.cmd`** (o en PowerShell: `deno task demo`). La primera vez descarga un componente de base de datos.
4. Abre en Chrome la dirección que aparece, normalmente **http://127.0.0.1:8787/**. Para salir: `Ctrl+C`.

En Linux/macOS: `cd fel/demo-facturacion && deno task demo`. Los datos viven solo en la memoria del programa: al cerrarlo, todo vuelve al estado inicial. Solo escucha en `127.0.0.1` (no es accesible desde la red).
Nota: probada en Linux con Chromium; en Windows no la pude probar desde aquí (Deno y PGlite funcionan en Windows).

## Pantallas (según las referencias aprobadas)
Menú lateral: **Nueva factura** (3 pasos: Datos → Ítems → Vista previa, con resumen lateral), **Facturas**, **Clientes** (indicadores, búsqueda, filtros, paginación, alta/edición, CSV), **Conceptos** (catálogo que alimenta las líneas) y **Configuración** (Empresa, Establecimientos, Canal de emisión, Numeración, Impuestos, Preferencias). La campana lista lo que requiere atención (por verificar, alertas, envíos en curso). Decisiones respecto a las referencias: no hay usuario/contraseña de SAT ni «Conectado a SAT» (se muestra el estado real del canal simulado), el botón final dice «certificación simulada» y «Importar» clientes queda deshabilitado (fase posterior). Dirección, teléfono y correo de la empresa son ficticios.

## Recorrido sugerido (5 minutos)
La demostración trae una **empresa y cuatro personas ficticias**; cambia de persona arriba a la derecha («Actuar como»):

| Persona | Rol | Puede |
|---|---|---|
| Ana Torres | propietaria | todo, incluida la aprobación de conciliaciones |
| Luis Méndez | administrador | ser la **segunda persona** que aprueba conciliaciones |
| Marta Ruiz | emisora | crear y editar borradores; **no** revisa, certifica ni concilia |
| Pedro Díaz | lector | solo consultar y descargar |

1. **Crear** (como Marta): «Nueva factura» → receptor, establecimiento, líneas (agrega, quita, prueba datos inválidos), mira la **vista previa** y guarda.
2. **Revisar** (como Ana): «Validar con el proveedor» y «Marcar como revisado» (el contenido queda congelado).
3. **Enviar** con el comportamiento del proveedor simulado que elijas:
   - **Éxito** → certificado en simulación (serie `SIMA`, autorización `SIM-…`); descarga el XML y el PDF.
   - **Tiempo agotado · el proveedor SÍ certificó** → queda **«Por verificar»** y **no hay botón de envío**: se bloquea todo hasta conciliar. «Consultar al proveedor» lo resuelve sin duplicar.
   - **Sin forma de saberlo** → «Consultar» responde «indeterminado» → solo entonces aparece la **conciliación manual**: Ana propone, **otra persona** (Luis) aprueba. Tras aprobar, antes de reintentar hay que **auditar al proveedor** (controles de la demostración).
   - **Respuesta tardía** → el proveedor certifica después; mientras no se sepa, sigue bloqueado. Si ya se había dado por fallida a mano, aparece una **alerta de certificación huérfana** que bloquea todo.
   - **Canal asistido** → imita al futuro canal de Playwright: el sistema llena y una persona emite en el portal; aquí lo simula un botón.
4. **Caídas**: en «Controles de la demostración», «Enviar y simular la caída» en cualquiera de los cuatro puntos y luego «Reiniciar y recuperar»: el sistema **nunca reenvía**; prueba qué ocurrió y libera solo lo que prueba que nunca salió.
5. **Doble clic** en «Enviar»: una sola operación (misma clave de idempotencia).

## Qué es real y qué es simulado
| Real (el mismo código del proyecto) | Simulado |
|---|---|
| Migraciones SQL, funciones, triggers y reglas de estado | El proveedor de emisión (`mock`): serie, número, autorización, XML y PDF |
| Orquestador: operación guardada antes de enviar, un solo envío, `por_verificar`, recuperación | El «servidor» del proveedor y sus fallos |
| Conciliación verificable de dos personas, alertas, auditoría | Las personas y la empresa |
| Cálculo exacto de importes (sin impuestos: pendientes de régimen verificado) | La **espera** de la conciliación manual: aquí es 0 minutos para poder recorrerla (por defecto 120 / 1440 / 10) |

No hay ninguna conexión a SAT, a Digifact ni a ningún otro servicio. La integración con Playwright y el agente local son de fases posteriores.

## Pruebas
```bash
# extremo a extremo en navegador (arranca su propio servidor)
NODE_PATH=<ruta a node_modules con playwright> node tests/e2e.cjs [carpeta-de-capturas]
deno task check
```
La prueba recorre todo lo anterior: validaciones, líneas, vista previa, estados, descargas con marca de simulación, doble clic, conciliación manual de dos personas, alerta huérfana, caídas con recuperación, canal asistido, móvil sin desborde y ausencia de errores en la consola.
