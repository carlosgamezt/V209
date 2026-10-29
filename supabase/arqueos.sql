-- Arqueos de caja de Nexa: permisos para la colección 'arqueos' dentro de pa_docs.
-- Solo AGREGA políticas (no cambia ni borra ninguna existente). Es seguro correrlo más de una vez.
--   Ver:     admin, visualizador, analista, gerencia (todo) · supervisor y comodín (su región; el supervisor también las regiones que le dieron acceso)
--   Crear:   admin (ya lo permite pa_ins) · supervisor y comodín de su región
--   Editar:  admin (ya lo permite pa_upd) · supervisor y comodín de su región (el supervisor también si tiene modo "editar")
--   Borrar:  solo admin (ya lo permite pa_del)

drop policy if exists pa_arq_sel on public.pa_docs;
create policy pa_arq_sel on public.pa_docs for select to authenticated
using (
  col = 'arqueos' and pa_role() is not null and (
    pa_role() in ('admin','visualizador','analista','gerencia')
    or (pa_role() in ('supervisor','comodin') and (
         (data->>'region') = pa_region()
         or (pa_role() = 'supervisor' and pa_xmode(data->>'region') is not null)))
  )
);

drop policy if exists pa_arq_ins on public.pa_docs;
create policy pa_arq_ins on public.pa_docs for insert to authenticated
with check (
  col = 'arqueos' and pa_role() in ('supervisor','comodin')
  and (data->>'region') = pa_region()
);

drop policy if exists pa_arq_upd on public.pa_docs;
create policy pa_arq_upd on public.pa_docs for update to authenticated
using (
  col = 'arqueos' and pa_role() in ('supervisor','comodin') and (
    (data->>'region') = pa_region()
    or (pa_role() = 'supervisor' and pa_xmode(data->>'region') = 'editar'))
)
with check (
  col = 'arqueos' and pa_role() in ('supervisor','comodin') and (
    (data->>'region') = pa_region()
    or (pa_role() = 'supervisor' and pa_xmode(data->>'region') = 'editar'))
);
