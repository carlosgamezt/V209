-- Explica la diferencia entre las miniaturas contadas por medicion_egress.sql (todas las imágenes «data:image/» dentro de los planes) y las que E1 puede separar (objetos foto con llave «k» y campo «t»). SOLO LECTURA.
select json_agg(x) as planes_con_diferencia from (
  select id,
         (length(data::text) - length(replace(data::text, '"data:image/', ''))) / 12 as imagenes_en_total,
         (length(data::text) - length(replace(data::text, '"t": "data:image/', ''))) / 17 as en_campo_t,
         (select count(*) from jsonb_path_query(data, 'strict $.**.t') v where jsonb_typeof(v) = 'string' and v #>> '{}' like 'data:image/%') as campos_t_por_ruta
    from public.pa_docs where col = 'plans' and data::text like '%"data:image/%'
) x where x.imagenes_en_total <> x.en_campo_t or x.imagenes_en_total <> x.campos_t_por_ruta;
