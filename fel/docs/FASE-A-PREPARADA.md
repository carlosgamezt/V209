# NEXA FEL · Fase A preparada: `verificar-api-vault` (#8) y validación inicial de Supabase
Estado: 17/11/2026. **Nada de esto se ha ejecutado por mi parte desde que lo pediste; todo es de solo lectura y cada paso lo apruebas tú en `demo-privada`.** Meta: llegar cuanto antes a una URL de demostración funcional para Android y PC sin saltarse ningún control.

## 1. Qué secretos usa esta fase (solo nombres; los valores nunca se ven ni se pegan)
| Paso | Secretos del entorno `demo-privada` | ¿Ya existen? |
|---|---|---|
| `verificar-inicial` (A2) | `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_BD_URL` | **Sí**: la ejecución #7 los usó y dio 0 REVISAR |
| `verificar-api-vault` (A1 · #8) | `DEMO_SUPABASE_PROYECTO_REF`, **`DEMO_SUPABASE_ANON_KEY`** | La referencia sí. **La clave pública: no lo sé** (no puedo listar secretos) |
Cómo comprobarlo: GitHub → repositorio → *Settings → Environments → demo-privada → Environment secrets*: muestra solo los nombres. Si falta `DEMO_SUPABASE_ANON_KEY`, la ejecución #8 se detiene sola antes de enviar nada, con «Falta FEL_DEMO_ANON_KEY…».

## 2. Si falta `DEMO_SUPABASE_ANON_KEY` (lo creas tú)
1. Supabase → proyecto `nexa-demo` → *Project Settings → API (API Keys)* → copia la clave **pública**: la `anon` (JWT que empieza por `eyJ…`) **o** la «publishable» (`sb_publishable_…`).
2. GitHub → *Settings → Environments → demo-privada → Add environment secret* → nombre exacto `DEMO_SUPABASE_ANON_KEY` → pega la clave.
3. **Nunca** `service_role`, `sb_secret_…` ni la de otro proyecto: el verificador las rechaza antes de hacer ninguna petición.

## 3. Orden exacto de la Fase A (de uno en uno)
| # | Qué | Cómo | Resultado posible | Yo después |
|---|---|---|---|---|
| A1 | `verificar-api-vault` | Aprobar en `demo-privada` la ejecución **#8** (ya está en espera): https://github.com/carlosgamezt/V209/actions/runs/43955049367 | **OK** (la API no expone `vault`) · **REVISAR** (lo expone) · **NO VERIFICADO** (no se pudo comprobar; nunca se toma por seguro) | Leo el registro (sin claves) y te presento el resultado exacto, distinguiendo acceso por API de privilegios de PostgreSQL |
| A2 | `verificar-inicial` (justo antes de migrar) | **Solo después** de que #8 termine: lanzo `migraciones-nube` con `accion=verificar-inicial` y tú la apruebas | 0 REVISAR · o diferencias que se presentan sin ajustar nada | Te presento las filas; si hay cualquier REVISAR, me detengo |
**Importante (concurrencia):** los dos flujos comparten el grupo `publicar-nube`; GitHub guarda solo la ejecución pendiente más reciente. Lanzar A2 mientras #8 espera **cancelaría #8**. Por eso A2 se lanza únicamente cuando #8 haya terminado.

## 4. Qué decide cada resultado de A1
- **OK:** se sigue con A2 y luego la Fase B.
- **REVISAR (vault expuesto):** me detengo y te propongo cómo cerrarlo en los ajustes de la API del proyecto (sin tocar esquemas ni permisos por mi cuenta); no se migra hasta resolverlo.
- **NO VERIFICADO:** se explica la causa (clave inválida, red, 401…) y se repite tras corregirla; no se continúa como si fuera seguro.
Nota: el privilegio directo de PostgreSQL de `service_role` sobre `vault` ya está verificado (diagnóstico #5) y no depende de A1; por eso las credenciales de Digifact **no** irán a Vault.

## 5. Después de la Fase A (camino más corto hacia la URL, sin atajos de seguridad)
B1 etapa 1 → V1 → B2 etapa 2 → V2 → C1 `publicar-nube` en modo `verificar` → C2 `publicar` (Digifact apagado) → C3 URL verificada con la prueba de humo. Detalle y criterios de parada: `OPERACIONES-HABILITAR-DEMO-NUBE.md`. Son 6 aprobaciones tuyas (A1, A2, B1, B2, C1, C2) en `demo-privada` y, antes de C1, comprobar que existen los 12 secretos `DEMO_*` de publicación (lista en `PREPARACION-DEMO-NUBE.md` §4).
