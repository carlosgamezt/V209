# NEXA FEL · Decisión de arquitectura: credenciales de Digifact (ADR) y diseño del cifrado por sobre para la fase multiempresa

Estado: **decisión aprobada; diseño NO implementado.** No existe ninguna tabla, función ni migración de credenciales, y la migración 29 no se ha iniciado.

## 1. Decisión (aprobada por el responsable)
1. **No se almacenan credenciales Digifact en Supabase Vault con los privilegios actuales.** Motivo verificado en `nexa-demo` (diagnóstico #5): `service_role` puede hacer SELECT y DELETE sobre `vault.decrypted_secrets` y `vault.secrets` y ejecutar `vault.create_secret`/`update_secret`; esos privilegios los otorgó `supabase_admin` y no los controlamos.
2. **Temporalmente, las credenciales de TEST siguen como secretos seguros del entorno, accesibles solo al backend autorizado.**
3. **Para la fase multiempresa se diseña un cifrado por sobre con claves administradas FUERA de Supabase.**
4. Se comparan KMS y gestores externos por seguridad, costo, rotación e integración (§4).
5. **No se implementa todavía el almacenamiento definitivo.**

## 2. Estado actual de las credenciales de TEST (se mantiene)
- Viven como secretos del entorno protegido `demo-privada` de GitHub (`DEMO_DIGIFACT_TEST_USERNAME`, `…_PASSWORD`, `…_NIT`): el trabajo exige tu aprobación manual, solo corre desde `fel-proveedores-diseno` y los secretos se inyectan **únicamente en el paso que los usa**.
- El cliente de Digifact recibe la contraseña por una función (`obtenerClave`), **no la guarda como propiedad**, y el token vive solo en memoria; nunca llegan al navegador (una prueba lo verifica) ni a errores o auditoría.
- **No hay credenciales en la base de datos.** Nada que migrar ni borrar.
- Higiene pendiente (recomendada, no urgente): rotar la contraseña de TEST de Digifact y no reutilizarla en ningún otro sitio.

## 3. Diseño del cifrado por sobre (fase multiempresa; SOLO DISEÑO)
**Objetivo:** que una llave `service_role` filtrada (o un volcado de la base) **solo revele texto cifrado**, y que descifrar exija una identidad distinta, fuera de Supabase, con permisos mínimos y auditoría propia.
- **Claves.** *KEK* (clave maestra) en un KMS externo: nunca sale del KMS. *DEK* (clave de datos) de 256 bits por empresa, proveedor y ambiente, generada al azar.
- **Qué se guarda en la base** (tabla cerrada por RLS, sin privilegios para `anon`/`authenticated`, sin función que devuelva texto claro): `empresa_id`, `proveedor_id`, `ambiente`, versión, identificador de la KEK, **DEK envuelta** (cifrada por el KMS con contexto de cifrado `empresa_id|proveedor|ambiente`), nonce, **texto cifrado** (AES-256-GCM con datos asociados `empresa_id|proveedor|ambiente|versión`), estado y fechas. Nunca el valor en claro.
- **Quién descifra:** solo el servicio backend que llama a Digifact, **en memoria**: lee la fila, pide al KMS desenvolver la DEK (la política del KMS permite `Decrypt` únicamente a esa identidad y exige el contexto de cifrado de la empresa), descifra con AES-GCM (WebCrypto de Deno), usa y descarta. Caché en memoria por empresa con vida corta (minutos), nunca en disco ni en la base.
- **Rotación.** KEK: rotación automática o programada del KMS y reenvoltura periódica de las DEK. DEK: nueva al cambiar la credencial o a demanda. Credencial de Digifact: procedimiento de cambio con versión nueva y la anterior inhabilitada. **Revocación inmediata:** marcar la fila inactiva (el backend deja de usarla) y/o deshabilitar la clave en el KMS.
- **Falla cerrado:** si el KMS no responde, no se certifica nada (no hay caída a un camino inseguro).
- **Auditoría:** registros del KMS (quién descifró y cuándo) más nuestra auditoría (sin valores); alerta ante descifrados fuera de patrón.
- **Modelo de amenazas (resumen):**
| Escenario | Qué obtiene el atacante | Mitigación |
|---|---|---|
| Fuga de la llave `service_role` o volcado de la base | Solo texto cifrado y DEK envueltas | Sin acceso al KMS no descifra |
| Fuga de las credenciales del KMS **sin** la base | Capacidad de desenvolver, pero nada que desenvolver | Contexto de cifrado por empresa, permisos mínimos, alertas |
| Ambas | Todo | Dominios de confianza separados, identidades de vida corta donde la plataforma lo permita, alertas y revocación rápida |
- **Reconocer el «secreto cero»:** el backend necesita credenciales para llamar al KMS. En GitHub Actions se puede usar federación OIDC (sin claves de larga vida); en el entorno de ejecución del servidor (por ejemplo, funciones de Supabase) probablemente haga falta una credencial de larga vida para el KMS, guardada como secreto del entorno. Es un riesgo residual a evaluar en la fase de pruebas de concepto.

## 4. Comparación de alternativas (para tu decisión; costos orientativos, **a verificar en las páginas oficiales antes de elegir**)
Escala supuesta: unas 10 empresas, 1 KEK, del orden de mil descifrados al mes. Muchas cifras de terceros se contradicen; solo la página oficial de Google fue legible en esta búsqueda.
| Opción | Qué es | Seguridad | Costo orientativo | Rotación | Integración con nuestro backend (Deno) |
|---|---|---|---|---|---|
| **AWS KMS** | KMS gestionado; claves nunca exportables | Muy madura; políticas IAM con condiciones por contexto de cifrado; el nivel exacto de certificación de sus HSM **a verificar** | Clave gestionada por el cliente ≈ **US$1/mes**; ≈ US$0,03 por 10 000 solicitudes simétricas (alcance de la capa gratuita de 20 000 solicitudes: dudoso según las fuentes) → centavos a pocos dólares/mes ([fuentes de terceros](https://cloudburn.io/blog/aws-kms-pricing); [página oficial](https://aws.amazon.com/kms/pricing/)) | Automática anual (el cargo por versiones rotadas: **a verificar**) | API REST firmada (SigV4) con `fetch` + WebCrypto, o el SDK de AWS vía `npm:` en Deno; OIDC desde GitHub Actions |
| **Google Cloud KMS** | KMS gestionado | Madura; versiones de clave; HSM opcional | Versión de clave de software ≈ **US$0,06/mes** (otras fuentes dicen US$0,03: **a verificar**); ≈ US$0,03 por 10 000 operaciones; la capa gratuita oficial solo aplica a claves creadas con Autokey ([página oficial](https://cloud.google.com/kms/pricing)) | Crear una versión nueva es gratis; reenvolver cuenta como operaciones | REST con token OAuth2 de cuenta de servicio (firma RS256 con WebCrypto); algo más de código |
| **Azure Key Vault** | Bóveda de claves y secretos | Madura; nivel Premium con HSM | Estándar ≈ US$0,03 por 10 000 operaciones; HSM ≈ US$1–5 por clave/mes según fuentes; Managed HSM ≈ US$3,20/hora (**a verificar**; [precios oficiales](https://azure.microsoft.com/pricing/details/key-vault/)) | Rotación de claves soportada | OAuth2 contra Entra ID; más piezas |
| **Infisical (Cloud o autoalojado)** | Plataforma de secretos | El proveedor SaaS custodia secretos; autoalojar traslada la operación a nosotros | Plan gratuito reportado para unas 5 identidades; de pago ≈ US$18 por identidad/mes (fuentes discrepan) | Integraciones de rotación | API sencilla; **no es un KMS**: no cumple «clave que nunca sale» salvo uso como almacén de la KEK |
| **Doppler** | Plataforma de secretos SaaS | Igual que arriba | Plan gratuito reportado de 3 usuarios; de pago ≈ US$21 por usuario/mes | Limitada | API sencilla; **no es un KMS** |
| **HashiCorp Vault (motor Transit)** | Cifrado como servicio | Muy completo | Autoalojado: una máquina y su operación; HCP: más caro. Una fuente indica que **HCP Vault Secrets terminó su venta en 2025 y su vida útil en 2026** (**a verificar con HashiCorp**) | Sí | Hay que operar y proteger el propio Vault |
| **Clave maestra en variable de entorno** (sin KMS) | Cifrado propio | La custodia de la clave queda en nuestro entorno (el riesgo central) | Sin costo | Manual | La más simple; la menos segura |
**Lectura preliminar (sujeta a tu aprobación y a las verificaciones):**
- Para la custodia de la KEK, un **KMS gestionado** (AWS o Google) es la opción adecuada; Azure es viable si ya hay cuenta de Microsoft; Infisical y Doppler resuelven operación de secretos pero **no** la propiedad «la clave nunca sale».
- Entre AWS KMS y Google Cloud KMS la diferencia de costo es despreciable a nuestra escala; decide la **facilidad de integración** (AWS: SigV4 y SDK conocido; Google: OAuth2) y **qué cuenta ya tienes**.
- Descartar «clave en variable de entorno» como solución definitiva.

## 5. Qué necesito de ti para cerrar la elección (antes de cualquier implementación)
1. ¿Tienes ya una cuenta en AWS, Google Cloud o Azure que quieras usar?
2. ¿Hay requisitos de cumplimiento (módulos HSM certificados, residencia de datos)?
3. ¿Dónde correrá el backend que llama a Digifact: funciones de Supabase, un servidor propio o ambos? (determina el «secreto cero»).
4. Presupuesto mensual tolerable (a nuestra escala, centavos a pocos dólares para el KMS).
Con eso prepararía una **prueba de concepto aislada** (sin datos reales ni tablas) que mida latencia, falla cerrado y el manejo del secreto cero, y la presentaría para tu aprobación **antes de diseñar el esquema definitivo**.

## 6. Qué NO se hace
No se crea ninguna tabla ni función de credenciales; no se usa Vault; no se toca la migración 29; no se modifican secretos ni permisos.
