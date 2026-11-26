-- M-D · Permisos nuevos de la configuración fiscal y de la conexión con Digifact por empresa (PROPUESTA; fuera de supabase/migrations; NO se aplica sin autorización).
-- Los permisos y roles existentes no cambian.
insert into public.permisos_catalogo (codigo, descripcion) values
  ('fiscal.configurar',     'Editar el borrador de los datos del emisor de la empresa'),
  ('fiscal.aprobar_emisor', 'Aprobar los datos del emisor (confirmando su huella)'),
  ('digifact.conectar',     'Guardar, reemplazar o suspender las credenciales de Digifact de la empresa y sus interruptores'),
  ('digifact.probar',       'Probar la conexión con Digifact sin certificar nada');
insert into public.rol_permisos (rol, permiso) values
  ('propietario', 'fiscal.configurar'), ('propietario', 'fiscal.aprobar_emisor'), ('propietario', 'digifact.conectar'), ('propietario', 'digifact.probar'),
  ('administrador', 'fiscal.configurar'), ('administrador', 'digifact.probar');
