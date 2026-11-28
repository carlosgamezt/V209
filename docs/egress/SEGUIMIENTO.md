# Seguimiento del proyecto de optimización de NEXA (retomar desde aquí)
Rama `ccr-9b56cef8-3yibwu`; `main` = v513 (7d87921). Referencia v512 = d06e3c1. Actualizado: 28-nov-2026.
## Estado
| Área | Estado | Dónde |
|---|---|---|
| P0 v513 (sondeo incremental, Realtime con recuperación, puerta entre pestañas, firmas de Arqueos/Descargas/Supervisión) | **Publicada** (main) | `INFORME-POSTPUBLICACION-V513.md` |
| v515 (Arqueos incremental, guardado parcial, baliza; caché y descarga directa apagadas) | **Publicada** (main 3be8cf2) | `ESTADO-PRODUCCION.md` |
| E0 respaldo / recuperación / verificación de 386 miniaturas | Probado en PostgreSQL local | `supabase/propuestas/egress/E0_*.sql`, `consultas/verificacion_e1.sql` |
| E0, E1a, V1, E1, E3 | **Aplicados en producción y verificados** | `ESTADO-PRODUCCION.md` |
| E1 completa (miniaturas aparte + disparador) | Probada con las políticas reales y 12 perfiles; pendiente de funciones `pa_*` reales | `E1_miniaturas_y_listados.sql`, `rls_real/` |
| E2 compactar | Evaluada; opcional | `E2_*.sql`, `medir_e2.sh` |
| E3 guardado parcial | Probado (PG real + cliente) | `E3_guardado_parcial.sql`, `parcial_test.cjs` |
| Matriz con volúmenes reales (146 planes, 384 miniaturas) | v512/v513/E1 completas; v514 en curso | `resultados/`, `proyeccion.py` |
## Pendiente
1. Indicadores/dashboard en PostgreSQL y paginación visible: requieren rediseño de lógica y de interfaz (ver `INFORME-EGRESS-CONSOLIDADO.md` §6).
2. `super-api`: sin acceso al código (entrega de originales con CORS, qué devuelve `get`).
3. Resultado de `politicas_rls.sql` (funciones `pa_role`, `pa_xmode`, … reales).
4. Medición real en Supabase tras publicar (`PROCEDIMIENTO-MEDICION-REAL.md`).
## Cómo retomar
`git checkout ccr-9b56cef8-3yibwu`; referencia: `git archive d06e3c1 nexa | tar -x -C /tmp/baseline`; v513: `git archive 7d87921 nexa | tar -x -C /tmp/pub`; pruebas: ver `pruebas/egress/LEEME.md`; `bash pruebas/egress/test_rls_real.sh && bash pruebas/egress/test_sql.sh`.
