// SUITE DE CONTRATO reutilizable: cualquier adaptador (mock, portal_playwright, digifact en pruebas) debe pasarla.
// Cada adaptador aporta un «arnés» que sabe provocar los escenarios abstractos en SU simulador/entorno de pruebas.
import assert from "node:assert/strict";
import { ErrorProveedor } from "../src/tipos.ts";
import type { Ambiente, DocumentoCongelado, EmissionProvider, SolicitudCertificacion } from "../src/tipos.ts";
import { CTX, clave, documento } from "./datos.ts";

export type EscenarioContrato = "exito" | "rechazo" | "desconocido_certificado" | "desconocido_no_certificado" | "indeterminado";
export interface ArnesAdaptador {
  proveedor: EmissionProvider;
  /** Prepara el entorno de pruebas para que el próximo envío de ese documento produzca ese escenario. */
  preparar(escenario: EscenarioContrato, documentoId: string): void;
  /** Cuántas certificaciones REALES (del simulador/entorno de pruebas) existen para el documento. */
  certificacionesDe(documentoId: string): number;
}
const sol = (doc: DocumentoCongelado, n: number, ambiente: Ambiente = "simulado"): SolicitudCertificacion => ({ empresaId: doc.empresaId, establecimientoId: doc.establecimientoId, documentoId: doc.id, operacionId: `op-${n}`, claveIdempotencia: clave(n), hashContenido: "a".repeat(64), instantanea: doc, ambiente });

export function ejecutarSuiteContrato(nombre: string, fabrica: () => ArnesAdaptador) {
  const T = (t: string, f: () => Promise<void> | void) => Deno.test(`contrato[${nombre}] ${t}`, f);
  T("capacidades coherentes", () => { const c = fabrica().proveedor.capacidades; assert.ok(c.ambientes.length > 0 && c.tiposDte.length > 0 && c.tiempoMaximoMs > 0 && c.id); });
  T("validar acepta un documento válido y rechaza uno inválido (sin efectos fiscales)", async () => {
    const a = fabrica(); assert.equal((await a.proveedor.validar(documento("d1"), CTX)).ok, true);
    const mal = await a.proveedor.validar(documento("d2", { lineas: [], total: "0.000000" }), CTX); assert.equal(mal.ok, false); assert.ok(mal.errores.length > 0);
    assert.equal(a.certificacionesDe("d1"), 0);
  });
  T("éxito: devuelve serie, número, autorización y fecha no vacíos y artefactos con SHA-256 coherente", async () => {
    const a = fabrica(); a.preparar("exito", "d1"); const r = await a.proveedor.enviar(sol(documento("d1"), 1), CTX);
    assert.equal(r.tipo, "certificado"); if (r.tipo !== "certificado") return;
    for (const v of [r.serie, r.numero, r.autorizacion, r.fechaCertificacion]) assert.ok(typeof v === "string" && v.trim().length > 0);
    for (const x of r.artefactos) if (x.contenido) { const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", x.contenido as unknown as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join(""); assert.equal(h, x.sha256); }
    assert.equal(a.certificacionesDe("d1"), 1);
  });
  T("rechazo confirmado: solo si el proveedor garantiza que NO hay DTE", async () => {
    const a = fabrica(); a.preparar("rechazo", "d1"); const r = await a.proveedor.enviar(sol(documento("d1"), 1), CTX);
    assert.equal(r.tipo, "rechazado_confirmado"); assert.equal(a.certificacionesDe("d1"), 0);
  });
  T("resultado desconocido (certificado o no): nunca se presenta como éxito ni como fallo", async () => {
    for (const e of ["desconocido_certificado", "desconocido_no_certificado", "indeterminado"] as const) {
      const a = fabrica(); a.preparar(e, "d1"); const r = await a.proveedor.enviar(sol(documento("d1"), 1), CTX);
      assert.ok(r.tipo === "desconocido", `${e} debe devolver desconocido (devolvió ${r.tipo})`);
    }
  });
  T("conciliar es solo lectura y coherente con la realidad del proveedor", async () => {
    const a = fabrica(); a.preparar("desconocido_certificado", "d1"); const s = sol(documento("d1"), 1); await a.proveedor.enviar(s, CTX);
    const antes = a.certificacionesDe("d1"); const ref = { empresaId: s.empresaId, documentoId: s.documentoId, operacionId: s.operacionId, claveIdempotencia: s.claveIdempotencia, ambiente: s.ambiente };
    const c1 = await a.proveedor.conciliar(ref, CTX), c2 = await a.proveedor.conciliar(ref, CTX);
    assert.equal(c1.tipo, "certificado"); assert.deepEqual(c1.tipo, c2.tipo); assert.equal(a.certificacionesDe("d1"), antes, "conciliar no cambia nada");
    const b = fabrica(); b.preparar("desconocido_no_certificado", "d9"); const s9 = sol(documento("d9"), 9); await b.proveedor.enviar(s9, CTX);
    const c9 = await b.proveedor.conciliar({ empresaId: s9.empresaId, documentoId: "d9", operacionId: s9.operacionId, claveIdempotencia: s9.claveIdempotencia, ambiente: s9.ambiente }, CTX);
    assert.ok(c9.tipo === "no_existe_confirmado" || c9.tipo === "indeterminado");
    const i = fabrica(); i.preparar("indeterminado", "d8"); const s8 = sol(documento("d8"), 8); await i.proveedor.enviar(s8, CTX);
    assert.equal((await i.proveedor.conciliar({ empresaId: s8.empresaId, documentoId: "d8", operacionId: s8.operacionId, claveIdempotencia: s8.claveIdempotencia, ambiente: s8.ambiente }, CTX)).tipo, "indeterminado", "nunca afirma que no existe si no lo sabe");
  });
  T("un ambiente que el adaptador no declara se rechaza con un error normalizado", async () => {
    const a = fabrica(); const no = (["simulado", "pruebas", "produccion"] as const).find((x) => !a.proveedor.capacidades.ambientes.includes(x))!;
    await assert.rejects(() => a.proveedor.enviar(sol(documento("d1"), 1, no), { ...CTX, ambiente: no }), (e: unknown) => e instanceof ErrorProveedor && e.codigo === "NO_SOPORTADO");
    assert.equal(a.certificacionesDe("d1"), 0);
  });
  T("salud no tiene efectos", async () => { const a = fabrica(); assert.equal((await a.proveedor.salud(CTX)).ok, true); assert.equal(a.certificacionesDe("d1"), 0); });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// SUITE DE CONTRATO PARA ADAPTADORES ASISTIDOS (emiteSinHumano = false): «enviar» nunca certifica; crea una orden y exige acción humana.
export interface ArnesAsistido {
  proveedor: EmissionProvider;
  ordenesCreadas(): number;
  /** Fija el estado de la orden de una operación en el doble de pruebas (como si el agente hubiera avanzado). */
  fijarOrden(operacionId: string, estado: string, datos?: { serie: string; numero: string; autorizacion: string }): void;
}
export function ejecutarSuiteContratoAsistido(nombre: string, fabrica: () => ArnesAsistido) {
  const T = (t: string, f: () => Promise<void> | void) => Deno.test(`contrato-asistido[${nombre}] ${t}`, f);
  const ref = (s: SolicitudCertificacion) => ({ empresaId: s.empresaId, documentoId: s.documentoId, operacionId: s.operacionId, claveIdempotencia: s.claveIdempotencia, ambiente: s.ambiente });
  T("capacidades: solo ambiente simulado y la emisión final la hace una persona", () => {
    const c = fabrica().proveedor.capacidades; assert.equal(c.emiteSinHumano, false); assert.deepEqual(c.ambientes, ["simulado"]); assert.ok(c.tiempoMaximoMs > 0);
  });
  T("validar acepta un documento válido y rechaza uno inválido sin crear órdenes", async () => {
    const a = fabrica(); assert.equal((await a.proveedor.validar(documento("d1"), CTX)).ok, true);
    assert.equal((await a.proveedor.validar(documento("d2", { lineas: [], total: "0.000000" }), CTX)).ok, false); assert.equal(a.ordenesCreadas(), 0);
  });
  T("enviar NUNCA certifica: crea exactamente una orden y devuelve requiere_accion_humana", async () => {
    const a = fabrica(); const r = await a.proveedor.enviar(sol(documento("d1"), 1), CTX);
    assert.equal(r.tipo, "requiere_accion_humana"); if (r.tipo !== "requiere_accion_humana") return;
    assert.ok(r.ordenId.length > 0 && r.instruccion.length > 0); assert.equal(a.ordenesCreadas(), 1);
  });
  T("una segunda orden para la misma operación se rechaza (sin duplicar)", async () => {
    const a = fabrica(); const s = sol(documento("d1"), 1); await a.proveedor.enviar(s, CTX);
    await assert.rejects(() => a.proveedor.enviar(s, CTX)); assert.equal(a.ordenesCreadas(), 1);
  });
  T("ambientes no simulados se rechazan con NO_SOPORTADO ANTES de crear nada", async () => {
    for (const amb of ["pruebas", "produccion"] as const) {
      const a = fabrica();
      await assert.rejects(() => a.proveedor.enviar(sol(documento("d1"), 1, amb), { ...CTX, ambiente: amb }), (e: unknown) => e instanceof ErrorProveedor && e.codigo === "NO_SOPORTADO");
      await assert.rejects(() => a.proveedor.enviar(sol(documento("d1"), 1, amb), CTX), (e: unknown) => e instanceof ErrorProveedor && e.codigo === "NO_SOPORTADO");   // solicitud de otro ambiente en contexto simulado
      await assert.rejects(() => a.proveedor.conciliar({ ...ref(sol(documento("d1"), 1, amb)) }, CTX), (e: unknown) => e instanceof ErrorProveedor && e.codigo === "NO_SOPORTADO");
      assert.equal(a.ordenesCreadas(), 0);
    }
  });
  T("conciliar es solo lectura y refleja lo que la orden PRUEBA", async () => {
    const mapa: [string, string][] = [["pendiente", "indeterminado"], ["reclamada", "indeterminado"], ["llenada", "indeterminado"], ["incierta", "indeterminado"], ["descartada", "no_existe_confirmado"], ["fallida", "no_existe_confirmado"], ["cancelada", "no_existe_confirmado"]];
    for (const [estado, esperado] of mapa) {
      const a = fabrica(); const s = sol(documento("d1"), 1); await a.proveedor.enviar(s, CTX); a.fijarOrden(s.operacionId, estado);
      const antes = a.ordenesCreadas(); assert.equal((await a.proveedor.conciliar(ref(s), CTX)).tipo, esperado, estado); assert.equal(a.ordenesCreadas(), antes);
    }
    const a = fabrica(); const s = sol(documento("d1"), 1); await a.proveedor.enviar(s, CTX); a.fijarOrden(s.operacionId, "completada", { serie: "SIMA", numero: "00000001", autorizacion: "SIM-ABC" });
    const c = await a.proveedor.conciliar(ref(s), CTX); assert.equal(c.tipo, "certificado"); if (c.tipo === "certificado") assert.match(c.autorizacion, /^SIM-/);
    a.fijarOrden(s.operacionId, "completada"); assert.equal((await a.proveedor.conciliar(ref(s), CTX)).tipo, "indeterminado", "completada sin datos fiscales no se acepta");
  });
  T("sin orden alguna: «no existe» confirmado (nada pudo presentarse)", async () => {
    const a = fabrica(); assert.equal((await a.proveedor.conciliar({ empresaId: "empresa-prueba-1", documentoId: "d1", operacionId: "op-sin-orden", claveIdempotencia: "clave-sin-orden-0001", ambiente: "simulado" }, CTX)).tipo, "no_existe_confirmado");
  });
  T("artefactos y salud sin efectos", async () => { const a = fabrica(); assert.deepEqual(await a.proveedor.obtenerArtefactos({ empresaId: "e", documentoId: "d", operacionId: "o", claveIdempotencia: "clave-de-prueba-000001", ambiente: "simulado" }, CTX), []); assert.equal((await a.proveedor.salud(CTX)).ok, true); assert.equal(a.ordenesCreadas(), 0); });
}
