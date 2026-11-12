# NEXA FEL · Versión práctica (demostración simulada)

Todo lo que ves es **SIMULADO · SIN VALOR FISCAL**. No se conecta a SAT ni a Digifact; no hay pasarela de pago; no se usan credenciales. Los datos viven en memoria y se pierden al cerrar el programa.

## 0. La forma más sencilla (sin instalar nada)
En GitHub → *Actions* → ejecución más reciente de **«NEXA FEL · paquete de la demostración»** → artefacto **nexa-fel-demo** → descarga el `.zip` de tu sistema (`…windows-msvc.zip`), descomprímelo y haz doble clic en `INICIAR.cmd` (se abre el navegador; usuario `ana`, contraseña `demo1234`). Para el teléfono: `INICIAR-TELEFONO.cmd` (misma Wi‑Fi; contraseñas **aleatorias** que se muestran solo en esa ventana). Windows puede avisar porque el programa no está firmado: *Más información → Ejecutar de todos modos*. El ejecutable lo construye y prueba (arranque, interfaz, login y plan) el propio CI.

**Acceso remoto:** `--lan` o `FEL_DEMO_CLAVE_ALEATORIA=1` generan contraseñas aleatorias por sesión y la pantalla de inicio no muestra ninguna; no se publica ningún acceso con contraseña fija.

## 1. Cómo ejecutarla

**Requisito único:** [Deno](https://deno.com) (`winget install DenoLand.Deno`). En Windows: doble clic en `fel/demo-facturacion/INICIAR-DEMO.cmd`. En cualquier sistema:

```
cd fel/demo-facturacion
deno run -A servidor.ts            # http://127.0.0.1:8787/   (--puerto=NNNN para otro puerto)
```

La primera vez descarga la base de datos embebida (PGlite) y tarda un poco.

**Usuarios ficticios** (contraseña de todos: `demo1234`):

| Usuario | Rol | Para qué |
|---|---|---|
| `ana` | Propietaria de *Empresa Demo* | todo, incluida la anulación y la conciliación |
| `luis` | Administrador de *Empresa Demo* | segunda persona que aprueba conciliaciones |
| `marta` | Emisora | crea borradores (no certifica, no ve el plan) |
| `pedro` | Lector | solo consulta |
| `sofia` | Propietaria de *Servicios Aguilar* | segunda empresa (prueba del aislamiento) |
| `maestro` | Administrador de la plataforma | empresas, planes, pagos simulados, bolsón global |

### Desde el teléfono
- **Misma red Wi‑Fi:** `deno run -A servidor.ts --lan`, y en el teléfono abre `http://<IP del PC>:8787/`. El modo `--lan` exige inicio de sesión y solo acepta direcciones IP como `Host`. *Una página `http://` en red local se usa bien, pero Chrome solo ofrece «Instalar app» en HTTPS o `localhost`.*
- **Instalable (HTTPS):** con un túnel (p. ej. `cloudflared tunnel --url http://127.0.0.1:8787`) y `FEL_DEMO_LAN=1 FEL_DEMO_HOSTS=<nombre-del-túnel> deno run -A servidor.ts`. En Chrome: menú ⋮ → *Instalar app*. Cierra el túnel al terminar (la demo tiene contraseña fija pública).
- Modo de pruebas automáticas (selector de personas, sin contraseña, solo 127.0.0.1): `FEL_DEMO_LOGIN=0`.

## 2. Recorrido de 10 pasos (todo implementado y probado)
1. **Iniciar sesión** (cookie HttpOnly, SameSite=Strict, «Recordar este dispositivo» opcional: 7 días sin actividad / 14 máx.; sesión normal 30 min de inactividad; 5 intentos fallidos = bloqueo de 1 min).
2. **Registrar y administrar empresas** (`maestro` → *Empresas* → *Nueva empresa*: alta, propietario con usuario y contraseña, habilitar/suspender).
3. **Configurar la empresa emisora** (propietario → *Configuración*: datos, establecimientos, canal).
4. **Crear una factura con varios ítems** (3 pasos; importes con decimales exactos).
5. **Ver cálculos y vista previa** (subtotal, descuentos, base imponible; impuestos «pendientes»: ver §5).
6. **Certificar con Digifact simulado** (*Canal de certificación → Digifact (simulado)*; escenarios: éxito, rechazo, sin saldo, tiempo agotado, sin forma de saberlo…). Antes de enviar se reserva saldo; sin plan/saldo no sale nada.
7. **Consultar el documento y su estado ante el proveedor** (botón *Consultar a Digifact*, solo lectura) y descargar PDF/XML simulados.
8. **Anular (simulado)** con motivo; se puede probar rechazo, tiempo agotado y conciliación.
9. **Planes, saldos y consumo**: empresa → *Plan y consumo*; plataforma → *Planes y tarifas*, *Empresa → Administrar* (asignar plan, pago simulado, cobros) y *Bolsón global*.
10. **Teléfono con PWA**: manifiesto, íconos (192/512/maskable), service worker solo de recursos estáticos (nunca la API ni datos fiscales).

## 3. Qué se construyó (fases autorizadas)
- **D2-3** `20261112000400_fel_comercial.sql`: planes versionados, tarifas, contratos, monedero, pagos **simulados**, cargos, cobros, cobertura atómica (monedero → bolsón), política de cargos. Pruebas SQL `21_comercial.sql` y concurrencia.
- **D3-1/D3-2** `…000300…`, `…000500…`: Digifact **solo** en ambiente `simulado` (barrera de tabla; producción y pruebas cerradas), bolsón simulado, anulación simulada, cierre de cobertura.
- **TypeScript**: `DigifactProvider` + `DigifactSimulador` (transporte inyectable), `ServicioDigifact` (cobertura + anulación), `ProveedorEnrutado` (conciliar cada operación con SU proveedor).
- **Demostración**: inicio de sesión, API de empresa y de plataforma, pantallas, PWA, contraste/móvil (D6 parcial).

## 4. Decisiones y desviaciones (registro)
- `EmissionProvider` (`tipos.ts`) y `orquestador_db.ts` **no se tocaron** (hash protegido). La cobertura se añade con un *decorador* del proveedor.
- **Sin saldo/plan/cupo = rechazo propio confirmado** («COBERTURA_…»): nada salió hacia el proveedor, así que es un resultado garantizado; el documento puede reintentarse tras recargar.
- **Política de cargos:** un rechazo confirmado del proveedor y una anulación **no se cobran** al cliente por política, aunque el bolsón del proveedor sí consuma (se confirma por prudencia). Un resultado desconocido **mantiene la reserva** hasta conocerlo; nunca se libera por tiempo.
- NEXA **no calcula impuestos de sus propias facturas**: el cobro guarda neto + referencia y total del documento emitido fuera del sistema.
- Solo existe el medio de pago `simulado`. Las respuestas «autorización» de Digifact simulado llevan prefijo `SIM-`.
- El **inicio de sesión de la demo no es el Auth de producción** (Supabase Auth con MFA para el maestro); contraseña fija y pública, solo para probar.
- La anulación simulada **no aplica el plazo normativo** (V12 sigue bloqueado: sin fuente oficial verificada).
- Corrección de interfaz: al elegir un concepto del catálogo ya no se redibujan las líneas (se perdía lo escrito en el campo siguiente).
- Pruebas: NIT ficticio aleatorio en los fixtures (colisión intermitente) y «token erróneo» de la prueba del agente (fallo 1/16).

## 5. Pendiente y bloqueado
**Para conectar Digifact TEST** (D4): credenciales de pruebas; documentación oficial de la API (autenticación, certificación, consulta, anulación, consumos); ajustar solo `digifact.ts` y el simulador (el contrato HTTP actual es una *hipótesis documentada*); habilitar ambiente `pruebas` en la base con su barrera y cuentas de bolsón reales de pruebas.
**Para producción:** además, régimen/reglas fiscales verificadas con contador y fuente oficial (D1-B: V1–V12 siguen bloqueadas; IVA/redondeo no se calculan), verificación MFA real del maestro, pasarela de pago (hoy inexistente), alta de Supabase Auth, dominio HTTPS en Cloudflare, plazo de anulación (V12).
**D2-4 (hecho):** `20261112000600_fel_bolson_conciliacion.sql` — extractos (idempotentes, sin duplicar líneas solapadas), partidas (coincide / falta en NEXA / sobra en NEXA / diferencia de unidades), aprobación por **otra** persona (`maestro` propone, `maestro2` decide), resolución única con motivo (ajuste de saldo, consumo extraordinario atribuido a una empresa, o justificación) que deja un movimiento en el libro. Pruebas SQL `23_*`, API y e2e.
**Aún no hecho de lo autorizado:** sesión persistente con BFF de producción, pruebas en WebKit/Firefox reales y en un teléfono físico (solo Chromium emulado).

## 6. Añadidos recientes
- **Usuarios y roles** (pantalla *Usuarios*), **Panel** con indicadores y reportes CSV, **PDF de demostración** («DOCUMENTO NO FISCAL»), **Mi cuenta** (cambiar contraseña; cierra las demás sesiones).
- **Verificación en dos pasos (TOTP)** del administrador de la plataforma: obligatoria en modo remoto (`--lan`) o con `FEL_DEMO_MFA=1`; la clave de la aplicación de autenticación se muestra solo en la ventana del programa.
- **Multiproveedor:** `RegistroCertificadores` (`proveedores/src/registro.ts`) describe cada certificador (nombre, escenarios de simulación, anulación); la API y las pantallas se dibujan a partir de él. Hay dos certificadores *simulados*: **Digifact** (simulador HTTP) y **Certificador B** (otra API simulada). Para incorporar uno nuevo: implementar `EmissionProvider` (+ `ProveedorAnulacion`), describirlo en el registro y añadir su id al catálogo con una migración (siempre «simulado» hasta autorización). No cambian el orquestador, la cobertura ni las pantallas.
- **Seguridad probada:** cookies manipuladas, fijación de sesión, falsificación entre sitios, CORS, entradas hostiles, escalada de privilegios, rutas estáticas, fuerza bruta de contraseña y del segundo factor, aislamiento entre empresas con identificadores reales de otra.
