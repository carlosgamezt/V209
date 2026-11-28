-- REVERSIÓN de la corrección de abb824e (nexa_foto_acceso reconoce números de plan con espacios): vuelve a la versión publicada en 55fefa9 (comparación exacta de número y de clave).
-- Sin efecto sobre datos ni políticas. Uso: ejecutar este archivo (o copiarlo a supabase/auto/ y publicar). Efecto de volver atrás: 3 fotos de planes automáticos con espacios en el número dejarían de reconocerse si la autorización estuviera en modo obligatorio (en modo registro solo se registra).
begin;
create or replace function public.nexa_foto_acceso(p_tipo text, p_planid text, p_k text, p_escritura boolean default false) returns boolean
language plpgsql volatile security invoker set search_path = '' as $f$
declare rol text; cfg jsonb; refd boolean := false;
begin
  if p_k is not null and not p_escritura then
    select exists (select 1 from public.pa_docs d where d.col = 'plans' and (
        d.data @> jsonb_build_object('acts', jsonb_build_array(jsonb_build_object('ev', jsonb_build_object('k', p_k))))
     or d.data @> jsonb_build_object('acts', jsonb_build_array(jsonb_build_object('ref', jsonb_build_object('k', p_k)))))) into refd;
    if refd then return true; end if;
  end if;
  if p_tipo = 'ev' then
    if p_planid is null then return false; end if;
    if p_escritura then
      perform 1 from public.pa_docs where col = 'plans' and id = p_planid for share;
      return found;
    end if;
    return exists (select 1 from public.pa_docs where col = 'plans' and id = p_planid);
  elsif p_tipo = 'ref' then
    if not p_escritura then return false; end if;
    select p.role into rol from public.pa_profiles p where p.auth_id = auth.uid();
    if rol is null then return false; end if;
    if rol in ('admin', 'supervisor', 'comodin', 'inventarios') then return true; end if;
    select d.data into cfg from public.pa_docs d where d.col = 'meta' and d.id = 'cfg';
    return coalesce(cfg #> array['roles', rol, 'perm', 'views'], '[]'::jsonb) ? 'nuevo';
  end if;
  return false;
end $f$;
revoke all on function public.nexa_foto_acceso(text, text, text, boolean) from public, anon;
grant execute on function public.nexa_foto_acceso(text, text, text, boolean) to authenticated;
commit;
select json_build_object('paso', 'reversion nexa_foto_acceso', 'existe', to_regprocedure('public.nexa_foto_acceso(text,text,text,boolean)') is not null) as reversion;
