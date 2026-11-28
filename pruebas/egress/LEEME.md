# Banco de pruebas de Egress (local, sin red ni credenciales)
Supabase simulado dentro del navegador (`fake_supabase.js`, `server_extra.js` = capacidades de la migración E1). Cuenta solicitudes y bytes de lo que Supabase cobraría como salida.
```
node escenarios.cjs --root <carpeta con index.html> --out resultado.json [--span 30] [--extra server_extra.js --data '{...,"caps":{"lite":true}}']   # consumo por escenario
node funcional.cjs  --root <carpeta> --out f.json [--movil] [--extra server_extra.js --caps '{"lite":true}']                                       # lo que ve cada rol
node recuperacion.cjs --root <carpeta> --out x.json                                                                                               # caída/recuperación de Realtime
bash test_sql.sh                                                                                                                                  # E1/E2 en PostgreSQL real temporal
python3 comparar_mediciones.py ; python3 comparar_funcional.py pc|movil                                                                           # tablas comparativas
```
Referencia: `git archive nexa-v512-referencia-egress nexa | tar -x -C /tmp/baseline`. Requiere Chromium de Playwright y PostgreSQL local. Los datos se calibran con `--data` (`maxPlans, acts, thumbs, notifs, arqueos, descargas, mensual`).
