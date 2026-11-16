# NEXA FEL · Diseño técnico de la fase siguiente (SOLO DISEÑO: nada de esto está implementado ni aplicado)

Decisiones confirmadas: Vault prioritario si se verifica; conservación provisional de 10 años configurable; revisión fiscal con casos de referencia; doble plantilla con comparador; la migración 28 va primero.
Lo marcado **«a verificar»** no se ha comprobado. Producción fiscal, certificación real y despliegues siguen bloqueados.

## 1. Secretos por empresa: Supabase Vault y evaluación de alternativas
### Estado de la verificación de Vault
| Dato | Estado |
|---|---|
| Supabase recomienda Vault y marca pgsodium como «pending deprecation» | Visto en resultados de búsqueda de la documentación oficial; **la página oficial no se pudo abrir desde esta sesión** (el host `supabase.com` no está permitido en la red de la sesión). |
| Cualquiera con acceso a `vault.decrypted_secrets` ve los secretos en claro | Misma fuente. Obliga a cerrar permisos y a leer solo con una función de servidor. |
| Los permisos de Vault cambiaron entre versiones (el rol de servicio gestionaba secretos en versiones antiguas) | Visto en un commit del repositorio de Supabase vía búsqueda; **a verificar** en la versión instalada. |
| Disponibilidad en el plan Free y versión instalada en `nexa-demo` | **A verificar.** |
**Cómo se cerrará la verificación (sin modificar nada):** (1) leer la documentación oficial (requiere permitir `supabase.com` o que me pegues la página); (2) una consulta de solo lectura en `nexa-demo` con el flujo «verificar»: `pg_available_extensions` para `supabase_vault` y `pgsodium` (versión disponible e instalada) y los privilegios de los roles sobre el esquema `vault`. Vault no se puede emular localmente: las pruebas locales usarán un doble de prueba del esquema `vault` marcado como tal, y la prueba real se hace tras aplicar en la demo, con un secreto de mentira.

### Evaluación de alternativas (se presenta antes de cualquier cifrado propio)
| Criterio | Supabase Vault | Cifrado por sobre en la aplicación (clave en el entorno) | Gestor externo (AWS/GCP Secret Manager, etc.) | Secretos de plataforma (GitHub/Edge) por empresa |
|---|---|---|---|---|
| Aislamiento por empresa | Sí: un secreto por empresa, referenciado por `empresa_id` | Sí, con clave de datos por empresa | Sí | **No escala** (un secreto manual por empresa) |
| Nunca llega al navegador | Sí, si solo se lee con función de servidor | Sí | Sí | Sí |
| Rotación y revocación | `update_secret`, auditable | A construir | Nativa | Manual |
| Custodia de la clave | La gestiona Supabase (**a verificar** modelo exacto) | **La custodiamos nosotros** (riesgo principal) | Proveedor externo | Plataforma |
| Complejidad | Baja | Alta y delicada | Media; cuenta y red nuevas | Baja pero inviable |
| Costo y disponibilidad | **A verificar** en Free | Sin costo | Costo y nueva dependencia | Sin costo |
**Recomendación:** Vault, solo si la verificación confirma disponibilidad y permisos. Si no, volver contigo con esta tabla antes de implementar nada propio.

### Diseño (migración posterior a la 28; cada objeto con prueba)
- `empresa_credenciales`: `empresa_id`, `proveedor_id`, `ambiente`, `secreto_id` (referencia a Vault), `nit`, `estado`, `version`, rotada/creada por y en. Único activo por `(empresa_id, proveedor_id, ambiente)`. **Nunca guarda el valor.** RLS: quien tenga `canales.configurar` ve solo los metadatos de SU empresa; ningún rol de la API ve secretos.
- `fel_op_credencial_guardar(...)`: exige permiso y aal2, escribe en Vault, audita (sin valores). `fel_sys_credencial_obtener(empresa, proveedor, ambiente)`: `SECURITY DEFINER`, ejecutable solo por el rol de servicio, audita cada lectura y valida que el NIT del secreto coincide con el de la empresa.
- En el servidor: un cliente Digifact **por empresa**, token en memoria con clave `(empresa, versión)`, nunca compartido; al rotar o revocar se descarta; sin registrar secretos.
- Pruebas: dos empresas con secretos distintos no se cruzan; sin permiso o sin aal2 no se guarda; ni `authenticated` ni `anon` leen nada; la lectura queda auditada; rotación sin cortes.

## 2. Conservación de documentos: política provisional de 10 años
- Tabla `politicas_conservacion` (`empresa_id` nulo = valor por defecto de la plataforma, `tipo_artefacto`, `anos` = 10, `estado` = `provisional` | `validada`, quién y cuándo la validó, nota). Pantalla de administración muestra siempre «PROVISIONAL, pendiente de validación legal y contable» mientras no esté validada.
- `artefactos_documento` gana `conservar_hasta` (fecha de certificación + años de la política vigente al guardar) y `retencion_legal` (bloqueo manual). Se calcula al insertar con un disparador; cambiar la política **no reescribe** lo ya guardado (se aplica a lo nuevo, y un cambio explícito a lo anterior requiere acción de plataforma auditada).
- **No existe eliminación automática**: ni función, ni trabajo programado, ni política de borrado en el almacenamiento. Un futuro purgado exigiría una migración propia, validación legal y aprobación de dos personas.
- Almacenamiento privado (bucket `fel-documentos`, ruta `{empresa}/{documento}/{operacion}/{sha256}.{xml|pdf}`, nombres direccionados por contenido, sin sobrescritura, sin permisos para `anon` ni `authenticated`), descarga por enlace firmado de vida corta tras comprobar sesión, empresa y permiso. Verificación periódica de hashes y copia de respaldo fuera del proyecto (**a verificar** cupo y capacidades del plan).

## 3. Revisión fiscal: IVA, regímenes y frases FEL
- **Ya existe una compuerta:** `fel__emision_real_activa` exige régimen en estado `verificado`, empresa habilitada, y los interruptores de plataforma y de empresa. La certificación real seguirá bloqueada hasta que una persona (contador) marque las reglas como verificadas.
- Reglas versionadas en datos (reutilizando `regimenes_fiscales` y `reglas_normativas`): afiliación IVA × tipo de documento × frases × códigos de unidad gravable, con vigencia, fuente y quién las verificó. Todo lo no cubierto se bloquea (hoy: solo GEN con IVA 12 % incluido).
- **Casos de referencia** (archivos JSON versionados en el repositorio, con entrada y resultado esperado) y pruebas automáticas que los recorren: gravado, descuentos por monto y por porcentaje, varias líneas, redondeos (mitad hacia arriba a 6 decimales y a 2), receptor CF, NIT, CUI y extranjero, afiliaciones distintas de GEN (deben **bloquearse**), frases ausentes o inconsistentes.
- Cada caso se contrasta luego con el XML devuelto por Digifact en TEST; **cada certificación de contraste requiere tu autorización expresa**. Hasta entonces las pruebas automáticas usan solo simulaciones.
- Entregable de la revisión: matriz «afiliación × frase × escenario» con su fuente oficial, pendiente de firma del contador.

## 4. Plantillas: PDF de Digifact y plantilla NEXA FEL
- Se conserva siempre el PDF original de Digifact (artefacto inmutable). La plantilla de NEXA se dibuja **solo a partir del XML certificado**, nunca de un borrador.
- Preferencia por empresa: `plantilla_predeterminada` (`digifact` | `nexa`), cambia con permiso y queda auditada. La impresión directa usa la predeterminada: PDF original abierto para imprimir, o la plantilla NEXA con CSS de impresión mediante el navegador.
- **Comparador lado a lado:** izquierda el PDF de Digifact, derecha la plantilla NEXA, más una tabla campo por campo (serie, número, autorización, fechas, emisor, receptor, líneas, totales, frases) con las diferencias resaltadas. Se usa en las pruebas y queda después como herramienta administrativa (permiso propio).
- La plantilla NEXA debe incluir los elementos obligatorios del documento tributario electrónico (**a verificar con el contador**) y, en TEST, la marca «TEST - SIN VALOR FISCAL».
- Pruebas: regresión visual con capturas, pruebas unitarias de la tabla de diferencias, y que ninguna plantilla pueda dibujar datos no certificados.

## 5. Persistencia de operaciones reales en TEST (migración 29, posterior a la 28)
**Hallazgo de la auditoría que cambia el diseño:** la base ya trae lo necesario para operar sin duplicar ni perder estado: operación guardada antes de enviar, un solo envío, estados `iniciada → confirmada_*/desconocida`, índice único «una operación abierta por documento», clave de idempotencia única, conciliación de dos personas, recuperación tras caídas y consumo único por operación (todo con pruebas de concurrencia). Hoy solo se limita al ambiente `simulado` mediante barreras deliberadas.
**Propuesta:** en vez de un almacén nuevo, conectar un adaptador real de Digifact TEST (`EmissionProvider`) al orquestador de la base que ya existe, y relajar **de forma estrecha** las barreras `simulado` solo para `(digifact, pruebas)`:
- Restricciones a revisar: `proveedores_digifact_solo_simulado_chk`, `canal_solo_simulado_chk`; funciones: `fel_op_canal_configurar`, `fel_op_certificacion_solicitar` (hoy exige que «SIM-» coincida con ambiente simulado), `fel__cerrar_certificacion`, `fel_sys_consumo_reservar` y `fel_admin_bolson_cuenta_crear` (estas dos ya admiten `pruebas`).
- Nuevo interruptor de plataforma `emision_pruebas_disponible` (apagado) y habilitación por empresa; producción sigue detrás de `emision_real_disponible` y el régimen verificado.
- Cada cambio con su prueba SQL y de concurrencia contra PostgreSQL real; reversible con otra migración.
- Con esto, el servicio actual (`felgt_servicio`) pasaría a ser una capa fina sobre el orquestador (o se retira su almacén), manteniendo la confirmación manual y la autorización por prueba.
**Riesgo:** tocar varias funciones de la ruta fiscal; mitigación: no mezclarlo con la 28, empezar por pruebas fallando y revisar con auditoría propia antes de pedir aplicación.
