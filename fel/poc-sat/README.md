# PoC de viabilidad — formulario FEL gratuito con Playwright (NO es producción)

Lee primero **`fel/docs/prueba-viabilidad-portal-sat.md`** (plan, fases, criterios y lista de verificaciones que requieren Chrome en una computadora).

```bash
cd fel/poc-sat
npm install
npm test                                   # 20 tests + 26 casos con Chrome contra una página de EJEMPLO local

# En tu computadora, con sesión SAT iniciada A MANO en un Chrome con puerto de depuración local:
cp config/empresa.ejemplo.json config/empresa.local.json
node bin/observar.mjs --empresa=config/empresa.local.json                 # solo lectura → observaciones/ + borrador de mapeo
node bin/ejecutar.mjs --empresa=config/empresa.local.json --mapeo=mapeo.local.json --datos=config/datos-ficticios.json
```
Sesión SAT (pausa al cerrarse, verificación, reanudación, anti-duplicados, medición): **`fel/docs/gestion-sesion-sat.md`**.
```bash
node bin/medir-sesion.mjs --empresa=config/empresa.local.json     # sin tocar la ventana: mide cuánto tarda el portal en pedir iniciar sesión
node bin/ejecutar.mjs … --reanudar | --reiniciar                  # tras una interrupción
```
Garantías: no se teclean credenciales · datos ficticios · la red es de solo lectura (todo POST se bloquea) · ningún paso emite, certifica ni envía · parada obligatoria (`detener`) · sin Supabase · sin selectores del portal en el código (se generan a partir de lo observado y los confirma una persona).
