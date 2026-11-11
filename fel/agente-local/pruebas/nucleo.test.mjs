// Pruebas del NÚCLEO del simulador FEL (sin navegador): validación, cálculo, estados, confirmación, interrupciones y duplicados.
import test from "node:test";
import assert from "node:assert/strict";
import { crearNucleo, validarFormulario, calcular, ErrorSim } from "../simulador/nucleo.mjs";

const formOk = (o = {}) => ({
  tipo_documento: "FACT-SIM", fecha: "2026-11-11", moneda: "GTQ", establecimiento: { codigo: "1" },
  receptor: { tipo_id: "NIT", id: "1234567-8", nombre: "Cliente de prueba", direccion: "Ciudad" },
  lineas: [{ tipo: "Servicio", descripcion: "Asesoría", cantidad: "2", precio_unitario: "10.50", descuento: "1" }], observaciones: "", ...o,
});
const campos = (f) => validarFormulario(f).errores.map((e) => e.campo);
const sesion = (n, o = {}) => n.crearSesion({ empresa: "emp-a", referencia: "ref-00000001", ...o });
const previa = (n, s, f = formOk()) => { const r = n.previsualizar(s, f); assert.ok(r.ok, JSON.stringify(r)); return r; };
const codigo = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ErrorSim, String(e)); return e.codigo; } assert.fail("debía fallar"); };

test("validación: el formulario correcto pasa y cada campo obligatorio se señala por separado", () => {
  assert.deepEqual(validarFormulario(formOk()), { ok: true, errores: [] });
  assert.deepEqual(campos(formOk({ tipo_documento: "" })), ["tipo_documento"]);
  assert.deepEqual(campos(formOk({ fecha: "2026-02-30" })), ["fecha"]);
  assert.deepEqual(campos(formOk({ moneda: "USD" })), ["moneda"]);
  assert.deepEqual(campos(formOk({ establecimiento: { codigo: "" } })), ["establecimiento_codigo"]);
  assert.deepEqual(campos(formOk({ receptor: { tipo_id: "", id: "", nombre: "" } })), ["receptor_tipo"]);
  assert.deepEqual(campos(formOk({ receptor: { tipo_id: "NIT", id: "12 34", nombre: "" } })).sort(), ["receptor_id", "receptor_nombre"]);
  assert.deepEqual(campos(formOk({ receptor: { tipo_id: "CF", id: "CF" } })), [], "consumidor final no exige nombre");
  assert.deepEqual(campos(formOk({ receptor: { tipo_id: "CF", id: "123" } })), ["receptor_id"]);
  assert.deepEqual(campos(formOk({ lineas: [] })), ["lineas"]);
  assert.deepEqual(campos(formOk({ lineas: Array(51).fill(formOk().lineas[0]) })), ["lineas"]);
  assert.deepEqual(campos(formOk({ observaciones: "x".repeat(501) })), ["observaciones"]);
  assert.equal(validarFormulario(null).ok, false); assert.equal(validarFormulario("x").ok, false);
});

test("validación de conceptos: cantidad, precio, descuento, tipo y descripción", () => {
  const l = (o) => formOk({ lineas: [{ ...formOk().lineas[0], ...o }] });
  assert.deepEqual(campos(l({ tipo: "" })), ["linea-1-tipo"]);
  assert.deepEqual(campos(l({ descripcion: "  " })), ["linea-1-descripcion"]);
  assert.deepEqual(campos(l({ cantidad: "0" })), ["linea-1-cantidad"]);
  assert.deepEqual(campos(l({ cantidad: "-1" })), ["linea-1-cantidad"]);
  assert.deepEqual(campos(l({ cantidad: "1e3" })), ["linea-1-cantidad"]);
  assert.deepEqual(campos(l({ precio_unitario: "abc" })), ["linea-1-precio"]);
  assert.deepEqual(campos(l({ precio_unitario: "1.1234567" })), ["linea-1-precio"], "más de 6 decimales");
  assert.deepEqual(campos(l({ descuento: "21.01" })), ["linea-1-descuento"], "el descuento no supera el importe (2 × 10.50 = 21.00)");
  assert.deepEqual(campos(l({ descuento: "21.00" })), []);
  assert.deepEqual(campos(l({ descuento: "" })), [], "descuento vacío = 0");
  assert.deepEqual(campos(l({ descripcion: "a\u0000b" })), ["linea-1-descripcion"], "caracteres de control");
  const dos = formOk({ lineas: [formOk().lineas[0], { ...formOk().lineas[0], cantidad: "" }] });
  assert.deepEqual(campos(dos), ["linea-2-cantidad"], "el error nombra el concepto exacto");
});

test("cálculo exacto en decimales (sin coma flotante)", () => {
  const f = formOk({ lineas: [
    { tipo: "Bien", descripcion: "a", cantidad: "3", precio_unitario: "0.10", descuento: "" },
    { tipo: "Bien", descripcion: "b", cantidad: "0.333333", precio_unitario: "3", descuento: "0.5" },
    { tipo: "Servicio", descripcion: "c", cantidad: "1.5", precio_unitario: "1234.567891", descuento: "" },
  ] });
  const c = calcular(f);
  assert.equal(c.lineas[0].importe, "0.30");            // 3 × 0.10 (en coma flotante daría 0.30000000000000004)
  assert.equal(c.lineas[1].importe, "1.00");            // 0.333333 × 3 = 0.999999 → 1.00
  assert.equal(c.lineas[2].importe, "1851.85");         // 1.5 × 1234.567891 = 1851.8518365
  assert.equal(c.subtotal, "1853.15"); assert.equal(c.descuentos, "0.50"); assert.equal(c.total, "1852.65");
});

test("flujo feliz: abrir → vista previa → confirmación humana → una emisión simulada registrada", () => {
  const n = crearNucleo(), s = sesion(n);
  assert.equal(s.estado, "creada"); n.abrir(s); assert.equal(s.estado, "abierta");
  const p = previa(n, s); assert.equal(s.estado, "previsualizada"); assert.equal(p.resumen.total, "20.00"); assert.equal(n.totalEmisiones(), 0, "la vista previa no emite nada");
  const r = n.confirmar(s, { csrf: p.csrf, origen: "humano" });
  assert.equal(s.estado, "confirmada"); assert.equal(n.totalEmisiones(), 1);
  assert.match(r.emision.autorizacion, /^SIM-/); assert.equal(r.emision.serie, "SIMA"); assert.equal(r.cortar, false);
  assert.deepEqual(n.eventos({ empresa: "emp-a", sesion: s.id }).map((e) => e.evento), ["sesion_creada", "formulario_abierto", "vista_previa", "confirmacion_solicitada", "emision_registrada"]);
});

test("la confirmación solo la puede hacer una persona: origen «agente», sin vista previa, sin token o con token ajeno se bloquean", () => {
  const n = crearNucleo(), s = sesion(n); n.abrir(s);
  assert.equal(codigo(() => n.confirmar(s, { csrf: "x".repeat(32), origen: "humano" })), "ESTADO", "sin vista previa");
  const p = previa(n, s);
  assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "agente" })), "SOLO_HUMANO", "el agente nunca confirma, ni con token válido");
  assert.equal(codigo(() => n.confirmar(s, { csrf: undefined, origen: "humano" })), "CSRF");
  assert.equal(codigo(() => n.confirmar(s, { csrf: "0".repeat(32), origen: "humano" })), "CSRF");
  const otra = sesion(n, { referencia: "ref-00000002" }); const po = previa(n, otra);
  assert.equal(codigo(() => n.confirmar(s, { csrf: po.csrf, origen: "humano" })), "CSRF", "el token de otra sesión no sirve");
  assert.equal(n.totalEmisiones(), 0); assert.equal(s.estado, "previsualizada", "los intentos bloqueados no cambian el estado");
  assert.ok(n.eventos({ empresa: "emp-a", sesion: s.id }).filter((e) => e.evento === "confirmacion_bloqueada").length >= 4, "cada bloqueo queda registrado");
  n.confirmar(s, { csrf: p.csrf, origen: "humano" }); assert.equal(n.totalEmisiones(), 1);
});

test("doble confirmación en la misma sesión: la segunda se rechaza y no se emite dos veces", () => {
  const n = crearNucleo(), s = sesion(n), p = previa(n, s);
  n.confirmar(s, { csrf: p.csrf, origen: "humano" });
  assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "humano" })), "YA_CONFIRMADA");
  assert.equal(n.totalEmisiones(), 1);
  assert.ok(n.eventos({ empresa: "emp-a" }).some((e) => e.evento === "confirmacion_repetida_bloqueada"));
});

test("vista previa inválida no avanza; volver a editar invalida el token; el token anterior ya no sirve", () => {
  const n = crearNucleo(), s = sesion(n);
  const mal = n.previsualizar(s, formOk({ lineas: [] })); assert.equal(mal.ok, false); assert.equal(s.estado, "abierta");
  const p1 = previa(n, s); n.volver(s); assert.equal(s.estado, "abierta");
  assert.equal(codigo(() => n.confirmar(s, { csrf: p1.csrf, origen: "humano" })), "ESTADO");
  const p2 = previa(n, s, formOk({ observaciones: "cambiado" })); assert.notEqual(p2.csrf, p1.csrf);
  assert.equal(codigo(() => n.confirmar(s, { csrf: p1.csrf, origen: "humano" })), "CSRF");
});

test("interrupción: una sesión interrumpida o descartada no emite y es definitiva; no se reanuda sola", () => {
  const n = crearNucleo(); let s = sesion(n); const p = previa(n, s);
  n.interrumpir(s, "prueba"); assert.equal(s.estado, "interrumpida");
  assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "humano" })), "ESTADO");
  assert.equal(codigo(() => n.previsualizar(s, formOk())), "ESTADO"); assert.equal(codigo(() => n.interrumpir(s)), "ESTADO");
  assert.equal(n.totalEmisiones(), 0);
  s = sesion(n, { referencia: "ref-00000003" }); const p2 = previa(n, s);
  n.descartar(s, p2.csrf); assert.equal(s.estado, "descartada"); assert.equal(codigo(() => n.confirmar(s, { csrf: p2.csrf, origen: "humano" })), "ESTADO");
  const x = sesion(n, { referencia: "ref-00000005" }); previa(n, x);
  assert.equal(codigo(() => n.descartar(x, "00".repeat(16))), "CSRF", "descartar desde la vista previa exige el token"); assert.equal(x.estado, "previsualizada");
  assert.equal(n.totalEmisiones(), 0);
});

test("error ANTES de registrar: la sesión queda en «error» y NO hay emisión", () => {
  const n = crearNucleo(), s = sesion(n, { fallo: "error_antes" }), p = previa(n, s);
  assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "humano" })), "ERROR_SERVIDOR");
  assert.equal(s.estado, "error"); assert.equal(n.totalEmisiones(), 0);
});

test("corte DESPUÉS de registrar: el cliente no ve respuesta pero el libro SÍ tiene la emisión (resultado incierto para el agente)", () => {
  const n = crearNucleo(), s = sesion(n, { fallo: "corte_tras_confirmar" }), p = previa(n, s);
  const r = n.confirmar(s, { csrf: p.csrf, origen: "humano" });
  assert.equal(r.cortar, true); assert.equal(n.totalEmisiones(), 1); assert.equal(s.estado, "confirmada");
  assert.ok(n.eventos({ empresa: "emp-a", sesion: s.id }).some((e) => e.evento === "error_inyectado"));
});

test("operaciones duplicadas: el simulador NO deduplica a propósito, pero las detecta y las registra (la defensa es de NEXA)", () => {
  const n = crearNucleo();
  for (let i = 0; i < 2; i++) { const s = sesion(n); const p = previa(n, s); n.confirmar(s, { csrf: p.csrf, origen: "humano" }); }
  assert.equal(n.emisiones({ empresa: "emp-a", referencia: "ref-00000001" }).length, 2);
  assert.equal(n.eventos({ empresa: "emp-a" }).filter((e) => e.evento === "emision_duplicada_de_referencia").length, 1);
  const a = n.emisiones({ empresa: "emp-a" }); assert.notEqual(a[0].numero, a[1].numero); assert.notEqual(a[0].autorizacion, a[1].autorizacion);
});

test("aislamiento por empresa: libro, eventos y sesiones no se ven entre empresas", () => {
  const n = crearNucleo(); const a = sesion(n), b = sesion(n, { empresa: "emp-b" });
  for (const s of [a, b]) { const p = previa(n, s); n.confirmar(s, { csrf: p.csrf, origen: "humano" }); }
  assert.equal(n.emisiones({ empresa: "emp-a" }).length, 1); assert.equal(n.emisiones({ empresa: "emp-b" }).length, 1);
  assert.ok(n.eventos({ empresa: "emp-a" }).every((e) => e.empresa === "emp-a"));
  assert.equal(n.sesionDeEmpresa(a.id, "emp-b"), null); assert.equal(n.sesionDeEmpresa(a.id, "emp-a")?.id, a.id);
});

test("entradas de control inválidas se rechazan (empresa, referencia y fallo)", () => {
  const n = crearNucleo();
  for (const o of [{ empresa: "", referencia: "ref-00000001" }, { empresa: "a b", referencia: "ref-00000001" }, { empresa: "emp", referencia: "corta" }, { empresa: "emp", referencia: "ref-00000001", fallo: "otro" }])
    assert.equal(codigo(() => n.crearSesion(o)), "DATOS");
});

test("el registro de eventos tiene tope y no guarda datos del receptor ni tokens", () => {
  const n = crearNucleo({ maxEventos: 5 }); const s = sesion(n);
  for (let i = 0; i < 20; i++) n.previsualizar(s, formOk({ lineas: [] }));
  assert.equal(n.eventos({ empresa: "emp-a" }).length, 5);
  const p = previa(n, s); const texto = JSON.stringify(n.eventos({ empresa: "emp-a" }));
  assert.ok(!texto.includes(p.csrf) && !texto.includes("Cliente de prueba") && !texto.includes("1234567-8"));
});
