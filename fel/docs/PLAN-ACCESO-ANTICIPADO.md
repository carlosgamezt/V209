# NEXA FEL · Plan de acceso anticipado y mejoras continuas (PROPUESTA; nada desplegado)

Reglas: solo `fel-proveedores-diseno`; `main` intacto; sin migraciones ni despliegues sin autorización expresa; sin credenciales fiscales reales; nada se presenta como certificado; todo lo no persistente se rotula **DEMO**.

## 1. Estado actual del frontend (verificado hoy ejecutando la demostración en local, PC 1280 px y móvil 390 px)
**Dos interfaces existen:**
- `fel/demo-facturacion/web` — la **demostración funcional completa** (servidor Deno + PostgreSQL real en memoria con PGlite; mismas migraciones, orquestador y proveedor **simulado**). Es lo que se puede usar ya.
- `fel/app` — interfaz **remota contra Supabase** (login con MFA TOTP, usuarios, invitaciones, recuperación de acceso; clientes, conceptos y borradores). Probada con un Supabase falso interceptado; **nunca contra uno real** (la base hospedada está vacía).

| Pantalla (demostración) | Estado |
|---|---|
| Inicio de sesión (cookie HttpOnly, bloqueo tras 5 fallos) | Disponible |
| Panel, Facturas (lista con filtros por estado) | Disponible |
| Nueva factura (Datos → Ítems → Vista previa) con receptor nuevo o existente, líneas, cantidades, precios y validaciones | Disponible |
| Clientes (alta/edición, frecuentes, CSV), Conceptos | Disponible |
| Configuración (empresa, establecimientos, canal, numeración…), Usuarios, Plan y consumo, Mi cuenta | Disponible |
| Plataforma (`maestro`): empresas, planes, bolsón | Disponible |
| Certificación y anulación | **Solo simulada** (SIM, «SIN VALOR FISCAL»); real: bloqueada |
| Importar clientes | Deshabilitada a propósito |
| Impuestos (IVA) | «Pendientes»: sin régimen verificado |
Resultado de hoy: las 5 rutas principales cargan en PC y móvil **sin desbordes** y la única respuesta de error en consola es `/api/sesion` 404 en el modo de pruebas (esperado, no hay sesión).

## 2. Qué puedes probar inmediatamente
Crear facturas con varios ítems, validaciones, vista previa, revisar, "enviar" al proveedor simulado y sus escenarios (éxito, rechazo, tiempo agotado, caídas), clientes, conceptos, usuarios y roles. **Los datos viven en memoria: se pierden al cerrar** (modo **DEMO**, rotulado en pantalla).

## 3. Para abrirlo desde el teléfono (sin desplegar nada en la nube)
| Ruta | Pasos | Persistencia | Seguridad |
|---|---|---|---|
| **A. Paquete de CI (ya construido)** | Descargar el ZIP del artefacto de la ejecución de `fel-paquete` y ejecutar `INICIAR.cmd` (PC) o `INICIAR-TELEFONO.cmd` (misma Wi‑Fi; contraseñas aleatorias) | No (DEMO) | Local; login obligatorio en LAN; sin nube |
| **B. Túnel temporal HTTPS** | Con A en marcha, `cloudflared tunnel --url http://127.0.0.1:8787` y abrirlo en el teléfono; permite «Instalar app» (PWA) | No (DEMO) | Solo con contraseñas aleatorias; cerrar el túnel al terminar |
| **C. Nube privada** (Supabase `nexa-demo` + Cloudflare Pages) | Requiere aprobar etapas 1–2 de migraciones, secretos y `publicar-nube` | **Sí**, cuando se autorice | Entorno protegido `demo-privada` |
**Más rápida: A (minutos) y, si quieres abrirla fuera de casa, B.** La C es la que da persistencia y acceso privado permanente, y depende de decisiones tuyas ya pendientes.

## 4. Primer conjunto de cambios propuesto (solo código y documentación; sin tocar nube)
1. **Rotulado DEMO inequívoco** (franja fija «DEMO · datos no persistentes · SIN VALOR FISCAL») y confirmar que no aparece ninguna etiqueta «certificado» sin SIM.
2. **Móvil:** la barra inferior corta «Plan y consumo» (9 entradas); pasar a 4–5 accesos + «Más»; botones de acción en vista de formulario más compactos; selectores de 16 px para evitar el zoom de iOS.
3. **Mensaje de error de sesión** amigable en lugar del 404 de `/api/sesion` en consola (solo modo pruebas).
4. **Registro de hallazgos:** una pantalla/archivo `HALLAZGOS.md` y un botón «Reportar problema» que copie ruta, rol y versión (sin datos de la factura) para detectar errores mientras la usas.
5. Revisar flujos de **cliente → ítems → totales** con validaciones de borde (cantidades 0/negativas, precios con decimales, descuentos) y añadir pruebas donde falten.
6. Ajuste visual fino con la identidad NEXA (sin rediseño).
Cada cambio con pruebas locales y CI; entrega por paquete (A) para que lo pruebes.

## 5. Borradores persistentes
Solo cuando exista la base preparada: **etapa 1 → V1 → etapa 2 → V2** (ver `PROPUESTA-FINAL-APLICACION-SEGURA.md`), más la **migración 29** (almacén persistente para el formulario Digifact; aún no iniciada). Hasta entonces, borradores en memoria (DEMO). Certificación Digifact: **deshabilitada** hasta verificaciones y autorización específica.

## 6. Qué se puede posponer sin comprometer la seguridad
Migración 28b (M2), cifrado por sobre/KMS, IVA y frases fiscales, plantillas, almacenamiento privado de PDF/XML, importación de clientes, agente SAT, producción. **No se pospone:** aislamiento por empresa (RLS), login con contraseñas no fijas en LAN/túnel, rotulado DEMO, certificación real apagada.

## 7. Decisiones que necesito de ti
1. ¿Empezamos con A (y B si la quieres fuera de casa)? 2. ¿Autorizas el primer conjunto de cambios (§4) para implementarlo y probarlo en local/CI, sin despliegue? 3. ¿Cuándo quieres decidir la ruta C (nube privada con persistencia)?
