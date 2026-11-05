-- Carga inicial de encargados de fondo fijo y montos de la región 2 (Excel de arqueos + hoja de personal).
-- Segura de repetir: solo agrega a las sucursales que todavía no tienen una asignación vigente.
with datos(branch, nombre, monto) as (values
  ('br2-chimaltenango',  'Joel Eleodoro Oliva García',             3000),
  ('br2-huehuetenango',  'Gladys Maribel Vicente Solís',           5000),
  ('br2-jocotenango',    'Edvin Orlando López Polo',               3000),
  ('br2-quiche',         'Oscar José Alejandro Morales Pérez',     4000),
  ('br2-sacapulas',      'Pedro Enrique Aceituno Paz',             4000),
  ('br2-san.juan.sac',   'Jhony Ottoniel López Chávez',            3000),
  ('br2-solola',         'Ancelmo Gómez Alinan',                   3000),
  ('br2-totonicapan',    'Gustavo Conrado Cox Velásquez',          3000),
  ('br2-quetzaltenango', 'Iván Federico Vicente Carrillo',         5000)
),
nuevos as (
  insert into public.pa_ff_asignaciones (branch_user_id, encargado_user_id, encargado_nombre, monto, creado_por)
  select d.branch, d.branch, d.nombre, d.monto, 'admin' from datos d
  where exists (select 1 from public.pa_docs u where u.col = 'users' and u.id = d.branch)
    and not exists (select 1 from public.pa_ff_asignaciones a where a.branch_user_id = d.branch and a.hasta is null)
  returning branch_user_id, encargado_nombre, monto
)
insert into public.pa_arqueo_audit (branch_user_id, accion, user_id, user_name, detalle)
select branch_user_id, 'ff_asignado', 'admin', 'Carga inicial región 2', jsonb_build_object('encargado', encargado_nombre, 'monto', monto) from nuevos;
