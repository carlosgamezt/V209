create schema if not exists t; grant usage on schema t to public;
create table if not exists t.ids (clave text primary key, id uuid); grant select on t.ids to public;
create or replace function t.como(p_user text, p_aal text default 'aal1', p_modulo text default null, p_rol text default 'authenticated') returns void language plpgsql as $$
declare uid uuid; sid uuid;
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  if p_user is not null then
    select id into uid from auth.users where email = p_user;
    select id into sid from auth.sessions where user_id = uid and aal = p_aal and (not_after is null or not_after > now()) limit 1;
    if sid is null then insert into auth.sessions (user_id, aal) values (uid, p_aal) returning id into sid; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'session_id', sid, 'aal', p_aal, 'modulo', p_modulo, 'role', p_rol)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
  end if;
  execute format('set local role %I', p_rol);
end $$;
create or replace function t.falla(p_sql text, p_frag text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return position(p_frag in sqlerrm) > 0; end $$;
create or replace function t.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'FALLO: %', p_msg; end if; raise notice 'OK    %', p_msg; end $$;
create or replace function t.id(p_clave text) returns uuid language sql stable as $$ select id from t.ids where clave = p_clave $$;
create or replace function t.vigente(e uuid, m text) returns boolean language sql security definer set search_path = '' as $$ select core.modulo_vigente(e, m) $$;
create or replace function t.q(p text) returns text language plpgsql security definer set search_path = '' as $$ declare r text; begin execute p into r; return r; end $$;
grant execute on all functions in schema t to public;
