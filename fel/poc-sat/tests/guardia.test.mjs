import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  textoProhibido, textoAmbiguo, clasificarControl, patronHostValido, hostPermitido, validarEndpointCdp, rutaDentroDe, evaluarSolicitud,
  validarMapeo, validarDatos, validarAislamiento, TIPOS_PASO,
} from "../src/guardia.mjs";
import { crearRegistro } from "../src/registro.mjs";
import { borradorMapeo } from "../src/observar.mjs";

const mapeoOk = () => ({ version: 1, dominios_permitidos: ["portal.ejemplo.gt"], permitir_post: [], pasos: [
  { id: "a", tipo: "manual", instruccion: "abre el formulario" },
  { id: "b", tipo: "llenar", localizador: { estrategia: "etiqueta", valor: "Nombre" }, dato: "cliente.nombre", verificado: true },
  { id: "z", tipo: "detener" }] });
const datosOk = () => JSON.parse(fs.readFileSync(new URL("../config/datos-ficticios.json", import.meta.url), "utf8"));

test("texto prohibido: emitir, certificar, enviar… con tildes y mayúsculas", () => {
  for (const t of ["Emitir documento", "EMISIÓN", "Certificar", "Enviar a SAT", "Firmar y enviar", "Guardar borrador", "Generar factura", "Confirmar", "Procesar", "Submit", "Anular"]) assert.equal(textoProhibido(t).prohibido, true, t);
  for (const t of ["Datos del receptor", "Detalle", "Cantidad", "Precio unitario", "Datos generales", "Buscar", "Agregar línea", ""]) assert.equal(textoProhibido(t).prohibido, false, t);
});
test("texto ambiguo: siguiente, continuar, aceptar…", () => { assert.equal(textoAmbiguo("Siguiente").ambiguo, true); assert.equal(textoAmbiguo("Detalle").ambiguo, false); });
test("clasificarControl: submit y botones dentro de formulario se tratan como riesgo", () => {
  assert.equal(clasificarControl({ tag: "button", type: "submit", texto: "Aceptar" }).envia_formulario, true);
  assert.equal(clasificarControl({ tag: "button", type: "", texto: "Detalle", enFormulario: true }).envia_formulario, true);   // sin type dentro de form = submit implícito
  assert.equal(clasificarControl({ tag: "button", type: "button", texto: "Detalle", enFormulario: true }).nivel, "ok");
  assert.equal(clasificarControl({ tag: "button", type: "button", texto: "Emitir" }).nivel, "prohibido");
  assert.equal(clasificarControl({ tag: "a", texto: "Ir", href: "/factura/emitir" }).nivel, "prohibido");
  assert.equal(clasificarControl({ tag: "input", type: "submit", texto: "Ok" }).nivel, "ambiguo");
});

test("hosts: comodines y endpoints de depuración", () => {
  assert.ok(patronHostValido("portal.ejemplo.gt") && patronHostValido("*.ejemplo.gt"));
  for (const x of ["*", "*.gt", "https://a.gt", "a.gt/ruta", "a.gt:443", "a b", "", null, "*.*.gt", "u@a.gt"]) assert.equal(patronHostValido(x), false, String(x));
  assert.ok(hostPermitido("a.ejemplo.gt", ["*.ejemplo.gt"])); assert.ok(!hostPermitido("ejemplo.gt", ["*.ejemplo.gt"])); assert.ok(!hostPermitido("evil-ejemplo.gt", ["*.ejemplo.gt"]));
  assert.ok(validarEndpointCdp("http://127.0.0.1:9222").ok && validarEndpointCdp("http://localhost:9222").ok);
  for (const x of ["http://192.168.1.5:9222", "http://0.0.0.0:9222", "http://miequipo.local:9222", "ftp://127.0.0.1", "basura"]) assert.equal(validarEndpointCdp(x).ok, false, x);
});
test("el perfil de Chrome no puede estar dentro del repositorio", () => {
  assert.ok(rutaDentroDe("/repo/fel/perfiles/a", "/repo")); assert.ok(rutaDentroDe("/repo", "/repo")); assert.ok(!rutaDentroDe("/home/u/perfiles/a", "/repo")); assert.ok(!rutaDentroDe("/repo-otro/x", "/repo"));
});

test("red: solo lectura; los POST se bloquean salvo permiso explícito que no parezca emisión", () => {
  for (const m of ["GET", "HEAD", "OPTIONS"]) assert.ok(evaluarSolicitud({ metodo: m, url: "https://p.gt/x" }).permitir);
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) assert.equal(evaluarSolicitud({ metodo: m, url: "https://p.gt/x" }).permitir, false, m);
  const pol = { permitir_post: [{ metodo: "POST", host: "p.gt", ruta_prefijo: "/api/catalogo" }] };
  assert.ok(evaluarSolicitud({ metodo: "POST", url: "https://p.gt/api/catalogo/buscar" }, pol).permitir);
  assert.equal(evaluarSolicitud({ metodo: "POST", url: "https://p.gt/api/otro" }, pol).permitir, false);
  assert.equal(evaluarSolicitud({ metodo: "PUT", url: "https://p.gt/api/catalogo/buscar" }, pol).permitir, false);
  assert.equal(evaluarSolicitud({ metodo: "POST", url: "https://otro.gt/api/catalogo/buscar" }, pol).permitir, false);
  const emi = { permitir_post: [{ metodo: "POST", host: "p.gt", ruta_prefijo: "/api/dte/emitir" }] };
  assert.equal(evaluarSolicitud({ metodo: "POST", url: "https://p.gt/api/dte/emitir" }, emi).permitir, false);
  assert.equal(evaluarSolicitud({ metodo: "POST", url: "no es url" }, pol).permitir, false);
});

test("mapeo válido pasa; faltas de seguridad se rechazan", () => {
  assert.ok(validarMapeo(mapeoOk()).ok);
  const malo = (f) => { const m = mapeoOk(); f(m); return validarMapeo(m); };
  assert.ok(!malo((m) => { m.dominios_permitidos = []; }).ok, "sin dominios");
  assert.ok(!malo((m) => { m.dominios_permitidos = ["*"]; }).ok, "comodín total");
  assert.ok(!malo((m) => { m.dominios_permitidos = ["127.0.0.1"]; }).ok, "host local fuera de la autoprueba");
  assert.ok(validarMapeo({ ...mapeoOk(), dominios_permitidos: ["127.0.0.1"] }, { local: true }).ok);
  assert.ok(!malo((m) => { m.pasos.pop(); }).ok, "sin detener");
  assert.ok(!malo((m) => { m.pasos.push({ id: "y", tipo: "llenar", localizador: { estrategia: "id", valor: "x" }, dato: "a", verificado: true }); }).ok, "algo después de detener");
  assert.ok(!malo((m) => { m.pasos.splice(2, 0, { id: "d2", tipo: "detener" }); }).ok, "dos detener");
  assert.ok(!malo((m) => { m.pasos[1].verificado = false; }).ok, "no verificado");
  assert.ok(validarMapeo((() => { const m = mapeoOk(); m.pasos[1].verificado = false; return m; })(), { local: true }).ok, "no verificado permitido solo en local");
  for (const tipo of ["emitir", "enviar", "submit", "certificar", "press", "evaluar", "ir_a"]) assert.ok(!malo((m) => { m.pasos.splice(1, 0, { id: "x", tipo }); }).ok, `tipo ${tipo}`);
  assert.ok(!malo((m) => { m.pasos.splice(1, 0, { id: "c", tipo: "clic_seguro", motivo: "x", localizador: { estrategia: "texto", valor: "Emitir factura" }, verificado: true }); }).ok, "clic a Emitir");
  assert.ok(!malo((m) => { m.pasos.splice(1, 0, { id: "c", tipo: "clic_seguro", motivo: "enviar todo", localizador: { estrategia: "texto", valor: "Detalle" }, verificado: true }); }).ok, "motivo con palabra prohibida");
  assert.ok(!malo((m) => { m.pasos.splice(1, 0, { id: "c", tipo: "clic_seguro", localizador: { estrategia: "texto", valor: "Detalle" }, verificado: true }); }).ok, "clic sin motivo");
  assert.ok(!malo((m) => { m.pasos[1].dato = ""; }).ok, "sin dato");
  assert.ok(!malo((m) => { m.pasos[1].localizador = { estrategia: "xpath", valor: "//a" }; }).ok, "xpath no permitido");
  assert.ok(!malo((m) => { m.pasos[1].id = "a"; }).ok, "id repetido");
  assert.ok(!malo((m) => { m.permitir_post = [{ metodo: "POST", host: "p.gt", ruta_prefijo: "/dte/emitir" }]; }).ok, "permitir_post de emisión");
  assert.ok(!validarMapeo(null).ok && !validarMapeo({ version: 1, dominios_permitidos: ["a.gt"], pasos: [] }).ok);
  assert.ok(!malo((m) => { m.version = 2; }).ok);
  assert.equal(TIPOS_PASO.some((t) => /emit|certific|envi|submit|press|firm/.test(t)), false, "ningún tipo de paso emite");
});
test("plantilla de mapeo para el portal real NO es ejecutable hasta completarla", () => {
  const p = JSON.parse(fs.readFileSync(new URL("../config/mapeo.plantilla.json", import.meta.url), "utf8"));
  const r = validarMapeo(p); assert.equal(r.ok, false); assert.ok(r.errores.some((e) => /dominios_permitidos/.test(e)));
});

test("datos ficticios: exige ficticio, PRUEBA y NIT permitido", () => {
  assert.ok(validarDatos(datosOk()).ok);
  const d = (f) => { const x = datosOk(); f(x); return validarDatos(x); };
  assert.ok(!d((x) => { x.ficticio = false; }).ok);
  assert.ok(!d((x) => { delete x.ficticio; }).ok);
  assert.ok(!d((x) => { x.cliente.nit = "1234567-8"; }).ok, "NIT real no declarado");
  assert.ok(d((x) => { x.cliente.nit = "1234567-8"; x.nits_de_prueba_declarados = ["1234567-8"]; }).ok, "NIT declarado por la persona");
  assert.ok(!d((x) => { x.cliente.nombre = "JUAN PEREZ"; }).ok, "nombre sin PRUEBA");
  assert.ok(!d((x) => { x.detalle.descripcion = "venta de cemento"; }).ok);
  assert.ok(!validarDatos(null).ok);
});

test("aislamiento entre empresas: nada compartido", () => {
  const e = (a, p, perfil) => ({ alias: a, cdp: `http://127.0.0.1:${p}`, perfil_dir: perfil });
  assert.ok(validarAislamiento([e("empresa-a", 9222, "/p/a"), e("empresa-b", 9223, "/p/b")]).ok);
  assert.ok(!validarAislamiento([e("empresa-a", 9222, "/p/a"), e("empresa-b", 9222, "/p/b")]).ok, "mismo puerto");
  assert.ok(!validarAislamiento([e("empresa-a", 9222, "/p/a"), e("empresa-b", 9223, "/p/a")]).ok, "mismo perfil");
  assert.ok(!validarAislamiento([e("empresa-a", 9222, "/p/a"), e("empresa-a", 9223, "/p/b")]).ok, "mismo alias");
  assert.ok(!validarAislamiento([e("EMPRESA A", 9222, "/p/a")]).ok, "alias inválido");
});

test("registro: tiempos manual vs automático, errores y bloqueos; no guarda valores", () => {
  let t = 1000; const reloj = () => t, salida = () => {};
  const r = crearRegistro({ empresa: "x", reloj, salida });
  r.paso({ id: "a", tipo: "manual", modo: "manual", ms: 4000, resultado: "ok" });
  r.paso({ id: "b", tipo: "llenar", modo: "auto", ms: 120, resultado: "ok", detalle: "campo llenado (cliente.nombre)" });
  r.paso({ id: "c", tipo: "clic_seguro", modo: "auto", ms: 30, resultado: "bloqueado", detalle: "clic RECHAZADO" });
  r.paso({ id: "d", tipo: "llenar", modo: "auto", ms: 50, resultado: "error", detalle: "no encontró" });
  r.solicitudBloqueada({ metodo: "POST", host: "h", ruta: "/x", razon: "r" }); t += 5000;
  const s = r.resumen({ detenidoAntesDeEmitir: true });
  assert.deepEqual([s.pasos, s.automaticos, s.manuales, s.errores.length, s.bloqueos_de_guardia.length, s.solicitudes_bloqueadas, s.duracion_total_ms, s.emitio], [4, { n: 3, ms: 200 }, { n: 1, ms: 4000 }, 1, 1, ["POST h/x"], 5000, false]);
  assert.ok(!JSON.stringify(r.eventos()).includes("CLIENTE DE PRUEBA"));
});

test("borrador: omite riesgo y contraseñas, deja verificado=false y dato=null", () => {
  const ctl = (o) => ({ n: "c1", tag: "input", type: "text", visible: true, deshabilitado: false, soloLectura: false, etiqueta: "X", clasificacion: "ok", envia_formulario: false, razones: [], mejor: { estrategia: "etiqueta", valor: "X", unico: true }, ...o });
  const inv = { marcos: [{ principal: true, host: "h.gt" }], controles: [ctl({ n: "c1" }), ctl({ n: "c2", type: "password", etiqueta: "Clave" }), ctl({ n: "c3", tag: "button", type: "submit", clasificacion: "prohibido", envia_formulario: true, razones: ["emitir"] }), ctl({ n: "c4", mejor: null }), ctl({ n: "c5", tag: "select" })] };
  const b = borradorMapeo(inv);
  assert.deepEqual(b.pasos.map((p) => p.tipo), ["manual", "llenar", "seleccionar", "detener"]);
  assert.ok(b.pasos.filter((p) => p.localizador).every((p) => p.verificado === false && p.dato === null));
  assert.equal(b.omitidos_por_riesgo.length, 2); assert.deepEqual(b.dominios_permitidos, ["h.gt"]);
  assert.equal(validarMapeo(b).ok, false, "un borrador no es ejecutable sin revisión");
});
