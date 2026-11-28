-- NEXA CORE · reversión completa (solo desarrollo/ensayo): elimina los esquemas de CORE y el disparador de perfiles. NO borra auth.users.
begin;
drop trigger if exists core_perfil_nuevo on auth.users;
drop schema if exists core_sys cascade;
drop schema if exists api cascade;
drop schema if exists core cascade;
commit;
