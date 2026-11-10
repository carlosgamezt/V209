# PoC de viabilidad — formulario FEL gratuito con Playwright (NO es producción)

Lee primero **`fel/docs/prueba-viabilidad-portal-sat.md`** (plan, fases, criterios y lista de verificaciones que requieren Chrome en una computadora).

```bash
cd fel/poc-sat
npm install
npm test                                   # guardia (12) + autoprueba con Chrome contra una página de EJEMPLO local (15)

# En tu computadora, con sesión SAT iniciada A MANO en un Chrome con puerto de depuración local:
cp config/empresa.ejemplo.json config/empresa.local.json
node bin/observar.mjs --empresa=config/empresa.local.json                 # solo lectura → observaciones/ + borrador de mapeo
node bin/ejecutar.mjs --empresa=config/empresa.local.json --mapeo=mapeo.local.json --datos=config/datos-ficticios.json
```
Garantías: no se teclean credenciales · datos ficticios · la red es de solo lectura (todo POST se bloquea) · ningún paso emite, certifica ni envía · parada obligatoria (`detener`) · sin Supabase · sin selectores del portal en el código (se generan a partir de lo observado y los confirma una persona).
