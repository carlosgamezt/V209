# Plantilla para un producto nuevo de NEXA (POS, Colegios, Hotel, …) — inerte hasta copiarla
Nada de aquí se ejecuta solo: son plantillas (los flujos viven en `docs/plantillas/` y NO en `.github/workflows/`). Se copian a su sitio **en la rama del producto**, reemplazando `{{PRODUCTO}}` (por ejemplo `pos`), `{{RAMA}}` (`pos-fase-1`) y `{{PROYECTO_PAGES}}` (`nexa-pos`).

## 1. Estructura recomendada (en este mismo repositorio, rama `{{RAMA}}`)
```
{{PRODUCTO}}/app/                 interfaz (HTML/JS como NEXA; sin dependencias de pago)
{{PRODUCTO}}/supabase/auto/       migraciones SQL (prefijo {{PRODUCTO}}_ en tablas y funciones; aditivas, idempotentes, con comprobación que se deshace sola)
{{PRODUCTO}}/supabase/functions/  Edge Functions (verify_jwt en config.toml; autorización real por recurso)
{{PRODUCTO}}/supabase/consultas/  SQL de solo lectura
pruebas/{{PRODUCTO}}/             banco de pruebas propio (copiar el patrón de pruebas/egress)
```
Cuando el producto ya esté probado, se promueve a su **propio repositorio** (o se queda aquí si el usuario lo prefiere). No se comparten tablas, claves ni proyectos con otros productos.

## 2. Orden de trabajo (un producto a la vez)
1. **Plan en una página** (módulos, tablas, roles/permisos, pantallas, datos de ejemplo, riesgos, pruebas) → visto bueno del usuario.
2. **Réplica local:** PostgreSQL local efímero con las políticas RLS del producto (patrón `pruebas/egress/test_sql.sh`, `rls_real/`): matriz perfil × recurso de lectura/escritura, probada contra una función auxiliar y contra el acceso directo.
3. **Funciones:** Deno con PostgREST/almacén simulados (patrón `super_api_test.ts` y `super_api_stub.ts`): autorización por recurso, errores, concurrencia, límites.
4. **Interfaz:** Playwright con un Supabase falso (patrón `fake_supabase.js` + `funcional.cjs`): por rol, en teléfono y computadora, sin cambios visuales no pedidos.
5. **CI de pruebas** (`pruebas-producto.yml`): corre sola en la rama con un Supabase LOCAL efímero; nunca se conecta a un proyecto real.
6. **Vista previa con enlace de pruebas** (`preview-producto.yml`): despliegue de Cloudflare Pages desde la rama (nunca producción) con confirmación manual; el usuario prueba desde su dispositivo con datos de ejemplo.
7. **Proyecto de Supabase del producto:** lo crea el usuario (gratis mientras quepa en los 2 proyectos gratuitos; si no, Pro ≈ 10 USD por proyecto Micro adicional: decisión del usuario). Se entrega solo la URL y la clave **publicable**. Las migraciones se aplican con el flujo de `supabase/auto` DESPUÉS de autorizarlas y verificadas contra los perfiles reales.
8. **Integración con NEXA principal:** portal con enlace (o indicadores resumidos por función que solo entrega agregados); cada producto conserva sus usuarios. Nada se mezcla con `pa_docs`.

## 3. Lista de verificación antes de pedir autorización para publicar
- [ ] Suite integral completa en verde sobre el commit exacto a publicar (comprobaciones por rol y por recurso).
- [ ] Ninguna migración sin respaldo, sin idempotencia y sin reversión; reversión probada conservando cambios posteriores.
- [ ] RLS: matriz perfil × recurso comprobada; vistas `security_invoker`; funciones `SECURITY INVOKER` (o justificadas).
- [ ] Archivos pesados: directo al almacenamiento con credencial temporal por ruta + alternativa por función; medida de bytes que pasan por Supabase.
- [ ] Presupuesto de Egress medido (login de cada rol, pantalla principal, descarga típica) y proyectado a 35/100/250/500/1000 usuarios.
- [ ] Sin secretos en el repositorio ni en registros; sin enlaces permanentes.
- [ ] Activación progresiva documentada (modo registro → obligar; piloto administrador → todos; apagado en un paso).
- [ ] `ESTADO-PRODUCCION` (o `{{PRODUCTO}}/ESTADO.md`) actualizado con el siguiente paso exacto.

## 4. Archivos de esta carpeta
`preview-producto.yml` (vista previa con enlace de pruebas), `verificar-destino.sh` (guarda de destino, solo lectura), `pruebas-producto.yml` (CI con Supabase local), `CLAUDE-producto.md` (CLAUDE.md para el repositorio o carpeta del producto).
