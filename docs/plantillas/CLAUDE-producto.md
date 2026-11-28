# CLAUDE.md — NEXA {{PRODUCTO}} (plantilla; copiar a la raíz del repositorio o carpeta del producto)
Hereda TODAS las reglas del `CLAUDE.md` de `carlosgamezt/V209` (léelo): no publicar sin autorización expresa, no afectar NEXA principal/FEL ni otros productos, sin costos, sin exponer secretos, sin debilitar RLS, sin eliminar datos, pruebas locales/simuladas primero, vista previa con enlace de pruebas, informes breves en español con real vs simulado.

## Este producto
- Propósito y alcance: {{una frase}}. Fuera de alcance: {{lista}}.
- Roles: {{roles}} · Recursos y permisos: ver `{{PRODUCTO}}/supabase/auto/*.sql` y la matriz de `pruebas/{{PRODUCTO}}/`.
- Proyecto de Supabase: propio, `{{PRODUCTO}}`; URL pública y clave **publicable** en `{{PRODUCTO}}/app/config.js`; la clave secreta NUNCA en el repositorio.
- Prefijo de tablas y funciones: `{{PRODUCTO}}_`. `empresa_id` en cada tabla de negocio; membresías para permisos.
- Almacenamiento de archivos: directo con credencial temporal por ruta + alternativa por función; sin Base64 en registros listados.
- Estado actual y siguiente paso exacto: `{{PRODUCTO}}/ESTADO.md` (actualizar al terminar cada tarea importante).

## Cómo probar y publicar
Pruebas: `pruebas/{{PRODUCTO}}/` (SQL local con RLS, funciones con Deno, Playwright) y una sola suite integral antes de proponer. Vista previa con enlace de pruebas: flujo manual `preview-{{PRODUCTO}}.yml` (rama `{{RAMA}}`, nunca main). Producción: solo tras autorización expresa, en pasos y con verificación.
