# fel/fiscal — motor fiscal NEXA FEL (D1-A)
Validación y verificación de DTE con aritmética decimal exacta y recursos oficiales de SAT verificados por hash. **No calcula ni certifica** (ver `fel/docs/fiscal-d1a-reglas.md`).
- `src/decimal.ts` racionales exactos · `src/recursos.ts` carga verificada · `src/estructura.ts` XSD · `src/frases.ts` · `src/fechas.ts` · `src/aritmetica.ts` (tolerancia obligatoria) · `src/escenarios.ts` (bloqueo) · `src/validar.ts`.
- `recursos/sat-fel/` copias sin modificar de https://github.com/notificacioneselectfel/Catalogo-FEL (GPL-3.0), con `MANIFIESTO.json`.
