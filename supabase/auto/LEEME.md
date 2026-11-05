# SQL automático
Los archivos `.sql` de esta carpeta se ejecutan solos en Supabase cuando se publica (push a `main`) y el archivo cambió.
Deben poder correrse más de una vez (`create ... if not exists`, `drop ... if exists`). No pongas aquí claves ni secretos.
Los scripts con textos para reemplazar (como los de recordatorios) se quedan en `supabase/` y se corren a mano.
