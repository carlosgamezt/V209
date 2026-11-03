-- Registro de descargas de los planes de Inventarios (para saber si Inventarios ya descargó las fotos).
-- Tabla NUEVA: no toca ninguna tabla ni regla existente. Solo se agrega; nadie puede editar ni borrar un registro.
-- La hora, el usuario, el nombre y el rol los pone el SERVIDOR (no se pueden falsificar desde la app).
-- Es seguro correrlo más de una vez.

create table if not exists public.pa_descargas (
  id         bigint generated always as identity primary key,
  plan_id    text        not null,
  user_id    text        not null default '',
  user_name  text,
  role       text,
  manual     boolean     not null default false,   -- true = el administrador lo marcó a mano (planes anteriores)
  created_at timestamptz not null default now()
);
create index if not exists pa_descargas_plan_idx on public.pa_descargas (plan_id, created_at desc);

alter table public.pa_descargas enable row level security;

-- El servidor completa quién y cuándo, sin importar lo que mande la app
create or replace function public.pa_descargas_fill() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  new.user_id    := coalesce(pa_uid(), '');
  new.role       := pa_role();
  new.user_name  := (select d.data->>'name' from public.pa_docs d where d.col = 'users' and d.id = pa_uid());
  new.created_at := now();
  return new;
end $$;

drop trigger if exists pa_descargas_fill_t on public.pa_descargas;
create trigger pa_descargas_fill_t before insert on public.pa_descargas
for each row execute function public.pa_descargas_fill();

-- Ver: admin, supervisor, visualizador, analista, gerencia e inventarios, solo de los planes que ya pueden ver
drop policy if exists pa_desc_sel on public.pa_descargas;
create policy pa_desc_sel on public.pa_descargas for select to authenticated
using (
  pa_role() in ('admin','supervisor','visualizador','analista','gerencia','inventarios')
  and exists (select 1 from public.pa_docs d where d.col = 'plans' and d.id = plan_id)
);

-- Registrar: Inventarios, administrador, supervisor y visualizador al descargar; "manual" solo el administrador
drop policy if exists pa_desc_ins on public.pa_descargas;
create policy pa_desc_ins on public.pa_descargas for insert to authenticated
with check (
  exists (select 1 from public.pa_docs d where d.col = 'plans' and d.id = plan_id and (d.data->>'type') = 'Inventarios')
  and (
    (manual = false and pa_role() in ('inventarios','admin','supervisor','visualizador'))
    or (manual = true and pa_role() = 'admin')
  )
);
-- No hay políticas de UPDATE ni DELETE: los registros no se pueden cambiar ni borrar desde la app.
