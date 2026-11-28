# NEXA FEL · fallo de CI «Paginación de clientes y conceptos…» — diagnóstico (SIN cambios al candidato)

Rama `fel-proveedores-diseno`. Candidato aprobado: 53857a9. **No se modificó el candidato estable ni se mezcló con la optimización de NEXA principal; este documento solo registra el diagnóstico.**

## Evidencia (registros públicos de GitHub Actions)
| Ejecución | Commit | Resultado |
|---|---|---|
| «NEXA FEL · pruebas» #46006125787 (13:19 UTC) | 53857a9 (candidato) | trabajo «Interfaz (modo demostración)» **falla** solo en el paso `e2e_paginacion.cjs`; las otras 5 áreas pasan (Migraciones y RLS, Integración con Supabase local real, `fel-api` Deno, `rls_auto_enable`, Agente en Windows) |
| «NEXA FEL · pruebas» #46008874462 (13:38 UTC) | bac4f24 | mismo fallo, mismo paso |
| «NEXA FEL · navegadores (Firefox y WebKit)» #46006125893 | 53857a9 | éxito |
| «NEXA FEL · paquete de la demostración» #46006125835 | 53857a9 | falla (no analizado aquí) |
Mensaje exacto del registro:
```
page.waitForFunction: EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: "script-src 'self'".
    at predicate (eval at evaluate (:234:30), <anonymous>:11:37)
    at .../tests/e2e_paginacion.cjs:31:69
```
## Causa
La demostración sirve cada página con `Content-Security-Policy: … script-src 'self' …` (sin `unsafe-eval`; `servidor.ts` línea 38, **correcto y deseable**). `page.waitForFunction()` de Playwright evalúa su predicado dentro de la página con `eval`, que esa política bloquea. `e2e_paginacion.cjs` es la **única** prueba de navegador que usa `waitForFunction` (las demás, p. ej. `e2e_vistas.cjs`, no lo usan, por eso pasan en CI). Es un defecto **de la prueba**, no de la paginación ni de la aplicación.
Por qué pasa en local: en el entorno local (Playwright 1.63 con un Chromium más reciente) la espera no llega a bloquearse; el CI usa Chromium 131 fijado (guarda «Se esperaba Chromium 131»). Es la explicación más probable de la diferencia; se confirma ejecutando la prueba con la versión de Playwright que instala el CI.
## Corrección propuesta (NO aplicada; requiere tu autorización y va en una rama de FEL aparte)
1. Reemplazar cada `p.waitForFunction(() => /…/.test(document.querySelector(…)?.textContent ?? ""))` por esperas sin `eval`: `await p.locator('.paginacion .mut', { hasText: /Mostrando 6 a 10/ }).waitFor()`; `await expect`-equivalentes con `locator.count()` para los `querySelectorAll(...).length === 5`; `p.waitForSelector('text=/Zzz Remoto/', { timeout: 8000 })` para el cliente fuera del conjunto de trabajo. Mantiene la política de seguridad de la aplicación intacta.
2. Alternativa menos preferible: `newContext({ bypassCSP: true })` solo en esa prueba (deja de probar la CSP en ese recorrido).
3. Validación: ejecutar la prueba localmente con la misma versión de Playwright y Chromium 131 del CI, y relanzar «NEXA FEL · pruebas» en la rama de FEL.
## Fuera de alcance de este documento
El fallo de «paquete de la demostración» (no se revisó) y cualquier cambio al candidato 53857a9.
