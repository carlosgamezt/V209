// PRUEBA DE PROPIEDADES contra la base real: secuencias aleatorias (semilla fija) de solicitudes, caídas del proceso en cualquier punto, reinicios,
// respuestas tardías, conciliaciones (del proveedor y manuales), alertas y correcciones, con un proveedor que NO deduplica.
// Invariantes en cada paso: nunca más de una certificación en el proveedor por documento; ningún envío repetido por referencia;
// los envíos al proveedor nunca superan las operaciones con envío marcado; una sola operación abierta por documento; coherencia de estados.
import assert from "node:assert/strict";
import { MockProvider, type Escenario } from "../src/mock.ts";
import { ErrorBd } from "../src/rpc.ts";
import { OrquestadorDb, ProcesoCaido } from "../src/orquestador_db.ts";
import { conexion, documentoRevisado, estadoDoc, nuevoMundo, parametros, clave } from "./mundo.ts";

function prng(semilla: number) { let a = semilla >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ESCENARIOS: Escenario[] = ["exito", "rechazo", "timeout_antes", "timeout_despues", "corte_despues", "respuesta_ilegible", "codigo_desconocido_certificado", "codigo_desconocido_no_certificado", "timeout_indeterminado", "timeout_tardio", "limite_tasa", "caida", "accion_humana"];
const CTX = { ambiente: "simulado" as const, ahora: () => new Date() };

Deno.test({ name: "propiedades en la base: 40 secuencias × 25 acciones con caídas, reinicios, tardías y conciliaciones (proveedor sin deduplicación)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const cx = conexion(); let acciones = 0; const vistos = { certificados: 0, por_verificar: 0, caidas: 0, alertas: 0, liberadas: 0, manuales: 0, humanas: 0 };
  try {
    await parametros(cx, 0, 0, 0);
    for (let semilla = 1; semilla <= 40; semilla++) {
      const r = prng(semilla * 7919), pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
      const m = await nuevoMundo(cx), mock = new MockProvider({ idempotenciaNativa: false }), docs: string[] = [];
      for (let i = 0; i < 3; i++) { const d = await documentoRevisado(cx, m); docs.push(d); mock.fijarEscenario(d, pick(ESCENARIOS)); }
      const ordenes = new Set<string>();
      const orq = (gancho?: "a" | "b" | "c" | "d") => new OrquestadorDb(cx.rpc, mock, { ganchos: gancho ? {
        despuesDeSolicitar: gancho === "a" ? () => { throw new ProcesoCaido("a"); } : undefined, despuesDeMarcarEnvio: gancho === "b" ? () => { throw new ProcesoCaido("b"); } : undefined,
        despuesDeEnviar: gancho === "c" ? () => { throw new ProcesoCaido("c"); } : undefined, despuesDeEvento: gancho === "d" ? () => { throw new ProcesoCaido("d"); } : undefined } : {} });
      const abierta = async (d: string) => (await cx.sql.unsafe("select id, estado, orden_externa from public.operaciones_fiscales where documento_id = $1 and estado in ('iniciada','desconocida') limit 1", [d]))[0];
      for (let paso = 0; paso < 25; paso++) {
        const d = pick(docs), a = Math.floor(r() * 11); acciones++;
        try {
          if (a <= 3) {   // solicitar (con caída aleatoria en un punto del proceso)
            const g = r() < 0.35 ? pick(["a", "b", "c", "d"] as const) : undefined; if (g) vistos.caidas++;
            const k = clave(Math.floor(r() * 4));
            await Promise.allSettled(Array.from({ length: 1 + Math.floor(r() * 3) }, () => orq(g).solicitar({ actor: m.propietario, empresa: m.empresa, documento: d, clave: k, canal: m.canal })));
          } else if (a === 4) await orq().recuperar({ umbralMin: 0, empresaId: m.empresa });
          else if (a === 5) { const o = await abierta(d); if (o) await orq().conciliar(m.empresa, o.id); }
          else if (a === 6) await mock.liberarTardios(CTX);
          else if (a === 7) mock.fijarEscenario(d, pick(ESCENARIOS));
          else if (a === 8) {   // conciliación MANUAL: solo si el proveedor dijo «indeterminado» y la persona verifica que de verdad no hay nada pendiente
            const o = await abierta(d);
            if (o && o.estado === "desconocida" && !o.orden_externa && mock.certificacionesDe(d) === 0 && mock.pendientesDe(d) === 0) {
              const c = await orq().conciliar(m.empresa, o.id);
              if (c.resultado === "indeterminado") {
                const p = await cx.rpc("fel_op_conciliacion_proponer", { p_actor: m.propietario, p_empresa: m.empresa, p_op: o.id, p_tipo: "manual_fallida", p_evidencia: { fuente: "portal_sat_consulta", referencia: "consulta-prop-001", fecha_consulta: new Date().toISOString(), conclusion: "no_figura" }, p_datos: null }) as { id: string };
                await cx.rpc("fel_op_conciliacion_decidir", { p_actor: m.admin2, p_empresa: m.empresa, p_conciliacion: p.id, p_aprobar: true, p_nota: "verificado por segunda persona" }); vistos.manuales++;
              }
            }
          } else if (a === 9) {   // acción humana pendiente: la persona termina
            const o = await abierta(d);
            if (o?.orden_externa && !ordenes.has(o.orden_externa)) { ordenes.add(o.orden_externa); const fin = await mock.completarAccionHumana(o.orden_externa, CTX); await orq().resolverAccionHumana(m.empresa, o.id, fin); vistos.humanas++; }
          } else if (a === 10) {   // corregir un documento rechazado y volver a revisarlo
            const e = await estadoDoc(cx, d);
            if (e.estado_fiscal === "rechazado") { await cx.rpc("fel_op_documento_reabrir", { p_actor: m.emisor, p_empresa: m.empresa, p_doc: d, p_version: e.version as number }); const v = (await estadoDoc(cx, d)).version as number; await cx.sql.unsafe("select public.fel_op_documento_preparacion($1, $2, $3, 'revisado', null, $4)", [m.propietario, m.empresa, d, v] as never); }
          }
        } catch (e) { if (!(e instanceof ErrorBd) && !(e instanceof ProcesoCaido)) throw e; }
        // ---- invariantes ----
        const envios = new Map<string, number>(); for (const l of mock.llamadasEnviar) envios.set(l.referencia, (envios.get(l.referencia) ?? 0) + 1);
        for (const [ref, n] of envios) assert.ok(n <= 1, `semilla ${semilla} paso ${paso}: la referencia ${ref} se envió ${n} veces`);
        for (const doc of docs) {
          assert.ok(mock.certificacionesDe(doc) <= 1, `semilla ${semilla} paso ${paso}: ${mock.certificacionesDe(doc)} certificaciones del proveedor para un documento`);
          const ops = await cx.sql.unsafe("select estado, enviada_en is not null as enviada from public.operaciones_fiscales where documento_id = $1", [doc]);
          assert.ok(ops.filter((o) => o.estado === "iniciada" || o.estado === "desconocida").length <= 1, `semilla ${semilla} paso ${paso}: más de una operación abierta`);
          assert.ok(mock.llamadasEnviar.filter((l) => l.documentoId === doc).length <= ops.filter((o) => o.enviada).length, `semilla ${semilla} paso ${paso}: más envíos que operaciones marcadas`);
          const e = await estadoDoc(cx, doc);
          if (e.estado_fiscal === "certificado") { assert.equal(mock.certificacionesDe(doc), 1, `semilla ${semilla} paso ${paso}: certificado en la base sin certificación en el proveedor`); assert.equal(ops.filter((o) => o.estado === "confirmada_exitosa").length, 1); assert.match(String(e.autorizacion_sat), /^SIM-/); }
          if (e.estado_fiscal === "por_verificar") assert.equal(ops.filter((o) => o.estado === "desconocida").length, 1, `semilla ${semilla} paso ${paso}: por_verificar sin operación desconocida`);
          if (e.estado_fiscal === "pendiente_certificacion") assert.equal(ops.filter((o) => o.estado === "iniciada").length, 1);
        }
      }
      // cierre de la secuencia: tras reinicio y recuperación, nada queda con un envío no marcado y los certificados cuadran con el proveedor
      await orq().recuperar({ umbralMin: 0, empresaId: m.empresa });
      for (const doc of docs) { const e = await estadoDoc(cx, doc); if (e.estado_fiscal === "certificado") vistos.certificados++; if (e.estado_fiscal === "por_verificar") vistos.por_verificar++; if (mock.certificacionesDe(doc) === 1 && e.estado_fiscal === "rechazado") vistos.alertas++; }
      vistos.liberadas += Number((await cx.sql.unsafe("select count(*)::int as n from public.operaciones_fiscales where empresa_id = $1 and resolucion = 'sistema_no_enviada'", [m.empresa]))[0].n);
    }
  } finally { await cx.cerrar(); }
  assert.equal(acciones, 1000);
  assert.ok(vistos.certificados > 10 && vistos.por_verificar > 5 && vistos.caidas > 100 && vistos.liberadas > 3, `la prueba debe ejercitar los caminos: ${JSON.stringify(vistos)}`);
  console.log("cobertura de la prueba de propiedades:", JSON.stringify({ acciones, ...vistos }));
} });
