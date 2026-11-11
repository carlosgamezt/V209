import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  textoProhibido, textoAmbiguo, clasificarControl, patronHostValido, hostPermitido, validarEndpointCdp, rutaDentroDe, evaluarSolicitud,
  validarMapeo, validarDatos, validarAislamiento, TIPOS_PASO, evaluarAutorizacionSat,
} from "../src/guardia.mjs";
import { crearRegistro } from "../src/registro.mjs";
import { borradorMapeo } from "../src/observar.mjs";
import { sanearRuta, CLAVES_SESION } from "../src/guardia.mjs";
import { evaluarSenales } from "../src/sesion.mjs";
import { planificarReanudacion, esIdempotente, crearProgreso } from "../src/progreso.mjs";
import { crearLibro, claveIdempotencia, ESTADOS_BLOQUEANTES } from "../src/libro.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { opcionesNavegador } from "./navegador.mjs";

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

// ======================================================================= sesión SAT
test("sesión: evaluarSenales — solo hay «activa» con un indicador confirmado y sin señales de login", () => {
  const cfg = { hosts_login: ["acceso.ejemplo.gt"], rutas_login: ["/login"], indicadores_sesion_activa: [{}], campo_clave_visible: true };
  const obs = (o = {}) => ({ host: "portal.ejemplo.gt", ruta: "/factura", claveVisible: false, activos: [{ id: "a0", presente: true }], login: [], respuestas401: 0, ...o });
  assert.deepEqual(evaluarSenales(obs(), cfg), { estado: "activa", razones: ["indicador_de_sesion_activa"] });
  assert.equal(evaluarSenales(obs({ host: "acceso.ejemplo.gt" }), cfg).estado, "requiere_login");
  assert.equal(evaluarSenales(obs({ ruta: "/login/entrar" }), cfg).estado, "requiere_login");
  assert.equal(evaluarSenales(obs({ claveVisible: true }), cfg).estado, "requiere_login");
  assert.equal(evaluarSenales(obs({ respuestas401: 1 }), cfg).estado, "requiere_login");
  assert.equal(evaluarSenales(obs({ login: [{ id: "l0", presente: true }] }), cfg).estado, "requiere_login");
  assert.equal(evaluarSenales(obs({ claveVisible: true, activos: [{ presente: true }] }), cfg).estado, "requiere_login", "una señal de login gana al indicador activo");
  assert.equal(evaluarSenales(obs({ activos: [{ id: "a0", presente: false }] }), cfg).estado, "desconocida", "sin indicador ni login: no se asume nada");
  assert.equal(evaluarSenales(obs({ activos: [] }), {}).estado, "desconocida");
  assert.equal(evaluarSenales(obs({ claveVisible: true, activos: [] }), { campo_clave_visible: false }).estado, "desconocida", "heurística desactivable");
  assert.equal(evaluarSenales(obs({ host: "otro.gt", activos: [] }), { hosts_login: ["*.ejemplo.gt"] }).estado, "desconocida");
});
test("sesión: el esquema es estricto y no admite mecanismos para mantener viva la sesión", () => {
  const con = (se) => validarMapeo({ ...mapeoOk(), sesion: se });
  assert.ok(con({ hosts_login: ["acceso.ejemplo.gt"], rutas_login: ["/login"], indicadores_sesion_activa: [{ localizador: { estrategia: "texto", valor: "Mi cuenta" }, verificado: true }], intervalo_ms: 5000, espera_max_ms: 1800000 }).ok);
  for (const k of ["keepalive", "ping", "mantener_activa", "refrescar", "clic_periodico", "heartbeat", "recargar_cada_ms"]) assert.equal(con({ [k]: true }).ok, false, k);
  assert.ok(!con({ indicadores_sesion_activa: [{ localizador: { estrategia: "texto", valor: "x" }, verificado: false }] }).ok, "indicador sin confirmar");
  assert.ok(!con({ indicadores_login: [{ localizador: { estrategia: "xpath", valor: "//x" }, verificado: true }] }).ok);
  assert.ok(!con({ intervalo_ms: 100 }).ok, "sondeo demasiado agresivo"); assert.ok(!con({ espera_max_ms: 99 * 3600 * 1000 }).ok); assert.ok(!con({ hosts_login: ["*"] }).ok); assert.ok(!con({ rutas_login: ["login"] }).ok);
  assert.ok(!validarMapeo({ ...mapeoOk(), sesion: [] }).ok);
  assert.equal(CLAVES_SESION.some((k) => /keep|ping|alive|refresc|recarg|click|clic|heart/i.test(k)), false);
});
test("reanudación: solo se reaplican campos posteriores al último paso NO idempotente; nunca se repiten clics", () => {
  const pasos = [{ id: "m", tipo: "manual" }, { id: "n", tipo: "llenar" }, { id: "c1", tipo: "clic_seguro" }, { id: "c2", tipo: "clic_seguro" }, { id: "t", tipo: "seleccionar" }, { id: "d", tipo: "llenar" }, { id: "z", tipo: "detener" }];
  const hechos = ["m", "n", "c1", "c2", "t", "d"];
  assert.deepEqual(planificarReanudacion(pasos, hechos, { n: "ok", t: "ok", d: "ok" }), { accion: "continuar", reaplicar: [] });
  assert.deepEqual(planificarReanudacion(pasos, hechos, { n: "ok", t: "distinto", d: "ausente" }), { accion: "reaplicar", reaplicar: ["t", "d"] });
  assert.equal(planificarReanudacion(pasos, hechos, { n: "distinto", t: "ok", d: "ok" }).accion, "reinicio_manual", "un campo anterior a un clic se perdió: repetir el clic podría duplicar");
  assert.equal(planificarReanudacion(pasos, hechos, { n: "ausente", t: "ausente", d: "ausente" }).accion, "reinicio_manual");
  assert.equal(planificarReanudacion(pasos, ["m", "n"], { n: "distinto" }).accion, "reaplicar", "sin clics hechos, se puede reaplicar desde el principio");
  assert.ok(esIdempotente({ tipo: "llenar" }) && !esIdempotente({ tipo: "clic_seguro" }) && esIdempotente({ tipo: "clic_seguro", idempotente: true }) && !esIdempotente({ tipo: "llenar", idempotente: false }));
});
test("saneado de rutas: sin query, hash, parámetros de ruta ni identificadores/tokens", () => {
  assert.equal(sanearRuta("/login;jsessionid=ABCDEF1234567890?token=SECRETO#x"), "/login");
  assert.equal(sanearRuta("/factura/12345678/detalle"), "/factura/:id/detalle");
  assert.equal(sanearRuta("/s/AbCdEfGhIjKlMnOpQrStUvWx"), "/s/:id");
  assert.equal(sanearRuta("/a/3f2b8c1e-aaaa-bbbb-cccc-1234567890ab"), "/a/:id");
  assert.equal(sanearRuta("/x/token=abc"), "/x/:id"); assert.equal(sanearRuta("/factura/nueva"), "/factura/nueva"); assert.ok(sanearRuta("/" + "a/".repeat(200)).length <= 120);
  const r = crearRegistro({ empresa: "x", salida: () => {} }); r.navegacion({ host: "h.gt", ruta: "/login;jsessionid=ZZZZZZZZZZZZZZZZZZZZZZ?t=SECRETO" }); r.solicitudBloqueada({ metodo: "POST", host: "h.gt", ruta: "/api/12345678901/x", razon: "r" });
  const txt = JSON.stringify(r.eventos()); assert.ok(!/jsessionid|SECRETO|ZZZZ|12345678901/.test(txt), txt);
});
test("progreso y libro: escritura atómica, sin valores; el libro bloquea y exige conciliación", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fel-u-")), plan = mapeoOk(), datos = datosOk();
  const pr = crearProgreso({ dir, plan, datos }); pr.iniciar(); pr.marcarPaso(plan.pasos[1]); pr.marcarPaso(plan.pasos[1]);
  assert.deepEqual(pr.completados(), ["b"]); assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith(".tmp")), "sin temporales");
  assert.ok(!fs.readFileSync(pr.archivo, "utf8").includes("CLIENTE DE PRUEBA")); assert.equal(pr.cargar().estado, "en_curso");
  assert.notEqual(crearProgreso({ dir, plan, datos: { ...datos, extra: 1 } }).archivo, pr.archivo, "otro dato = otro progreso");
  const l = crearLibro({ dir }), k = claveIdempotencia("a", datos);
  assert.equal(l.puedeEjecutar(k).permitir, true); l.registrar(k, "preparado"); assert.equal(l.puedeEjecutar(k).permitir, true);
  for (const e of ESTADOS_BLOQUEANTES) { l.registrar(k, e); assert.equal(l.puedeEjecutar(k).permitir, false, e); }
  l.registrar(k, "descartado"); assert.equal(l.puedeEjecutar(k).permitir, true); assert.throws(() => l.registrar(k, "inventado"));
  assert.notEqual(k, claveIdempotencia("b", datos)); assert.notEqual(k, claveIdempotencia("a", { ...datos, cliente: { ...datos.cliente, nombre: "OTRO DE PRUEBA" } }));
});

// ======================================================================= escaneos estáticos del código
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const fuentes = ["../src", "../bin"].flatMap((d) => fs.readdirSync(path.join(AQUI, d)).filter((f) => f.endsWith(".mjs")).map((f) => [`${d}/${f}`, fs.readFileSync(path.join(AQUI, d, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")]));
test("independencia: el PoC no usa Supabase ni código de NEXA, ni lee cookies/almacenamiento/estado de sesión del navegador", () => {
  const prohibido = /supabase|storageState|\.cookies\s*\(|addCookies|localStorage|sessionStorage|document\.cookie|from\s+["'][^"']*(\/app\/|\/supabase\/)/i;
  for (const [f, c] of fuentes) assert.equal(prohibido.test(c), false, `${f} toca algo que no debe`);
  assert.ok(fuentes.length >= 10);
});
test("sin «mantener viva» la sesión: el módulo de sesión solo hace lecturas pasivas (ni clics, ni teclas, ni recargas, ni peticiones, ni temporizadores de acción)", () => {
  const c = fuentes.find(([f]) => f.endsWith("src/sesion.mjs"))[1];
  assert.equal(/\.(click|dblclick|tap|hover|press|type|fill|check|uncheck|selectOption|setChecked|dispatchEvent|focus|reload|goto|goBack|goForward|evaluate|evaluateHandle|route|waitForTimeout)\s*\(|\bmouse\b|\bkeyboard\b|\btouchscreen\b|\bfetch\s*\(|XMLHttpRequest|setInterval|sendBeacon/.test(c), false);
  for (const [f, cc] of fuentes.filter(([f]) => /src\/(progreso|libro|registro)\.mjs$/.test(f))) assert.equal(/\.(click|fill|press|goto|reload|evaluate)\s*\(|\bfetch\s*\(|page\./.test(cc), false, `${f} no debe tocar la página`);
  const bins = fuentes.find(([f]) => f.endsWith("bin/medir-sesion.mjs"))[1]; assert.equal(/\.(click|fill|press|goto|reload|evaluate)\s*\(/.test(bins), false, "medir-sesion es solo lectura");
});
test("no hay ningún clic, tecla ni envío fuera del ejecutor (que pasa por la guardia)", () => {
  for (const [f, c] of fuentes) if (!/src\/ejecutor\.mjs$/.test(f)) assert.equal(/\.(click|dblclick|press|type|check|setChecked|selectOption|fill)\s*\(|requestSubmit|\.submit\s*\(/.test(c), false, `${f}`);
  const ej = fuentes.find(([f]) => f.endsWith("src/ejecutor.mjs"))[1];
  assert.equal((ej.match(/\.click\s*\(/g) ?? []).length, 1, "un único punto de clic, precedido de clasificarControl"); assert.equal(/\.press\s*\(|keyboard|requestSubmit|\.submit\s*\(/.test(ej), false);
});

// ======================================================================= observación 1 del formulario real (solo estructura)
test("acciones sensibles del formulario real: vista previa, eliminar y editar impuestos nunca se pulsan solos", () => {
  assert.equal(clasificarControl({ tag: "button", type: "button", texto: "Vista Previa" }).nivel, "prohibido");
  assert.equal(clasificarControl({ tag: "button", type: "", titulo: "Eliminar item" }).nivel, "prohibido");
  assert.equal(clasificarControl({ tag: "button", type: "", titulo: "Eliminar item espectáculo" }).nivel, "prohibido");
  assert.notEqual(clasificarControl({ tag: "button", type: "", titulo: "Editar impuestos" }).nivel, "ok");
  assert.notEqual(clasificarControl({ tag: "button", type: "button", texto: "Agregar item" }).nivel, "ok");
  assert.notEqual(clasificarControl({ tag: "button", type: "button", texto: "Agregar ítem" }).nivel, "ok");
});
test("mapeo preliminar de SAT: no es ejecutable (solo falla por verificado=false), no contiene acciones bloqueadas y es coherente con la clasificación", () => {
  const mp = JSON.parse(fs.readFileSync(new URL("../config/mapeo.sat-preliminar.json", import.meta.url), "utf8")), v = validarMapeo(mp);
  assert.equal(v.ok, false); assert.ok(v.errores.every((e) => /verificado no es true/.test(e)), v.errores.join("\n"));
  assert.ok(!mp.pasos.some((p) => p.tipo === "clic_seguro"), "ningún clic en el mapeo preliminar");
  assert.deepEqual(mp.dominios_permitidos, ["felav.c.sat.gob.gt", "farm3.sat.gob.gt"]); assert.ok(mp.pasos.filter((x) => x.localizador).every((x) => x.localizador.marco?.url_contiene === "felav.c.sat.gob.gt/fel-web/privado/vistas/fel.jsf"), "todos los localizadores apuntan al iframe"); assert.deepEqual(mp.permitir_post, []);
  for (const p of mp.pasos.filter((x) => x.localizador)) assert.ok(p.verificado === false && (p.dato || ["salir_del_campo", "verificar_ausente"].includes(p.tipo)));
  const cl = JSON.parse(fs.readFileSync(new URL("../analisis/obs1/clasificacion.json", import.meta.url), "utf8")), c2 = JSON.parse(fs.readFileSync(new URL("../analisis/obs2a/clasificacion.json", import.meta.url), "utf8")), c3 = JSON.parse(fs.readFileSync(new URL("../analisis/obs2d/clasificacion.json", import.meta.url), "utf8")), conocidos = new Set([...cl.filas, ...c2.filas, ...c3.filas].map((f) => f.mejor_localizador.replace(" (:visible)", "")));
  for (const p of mp.pasos.filter((x) => x.localizador && x.localizador.estrategia !== "rol")) { const l = p.localizador, k = `${l.estrategia}${l.tag ? `[${l.tag}]` : ""}: ${l.valor}`; assert.ok(conocidos.has(k), `el localizador «${k}» no sale de la observación 1`); }
  assert.equal(cl.total, 211); assert.equal(cl.visibles, 31); assert.equal(c2.total, 211); assert.equal(c2.visibles, 30);
  assert.ok(c2.filas.filter((f) => f.estabilidad === "sin_identificador").length <= 11 && c2.filas.every((f) => !("opciones" in f)), "la clasificación 2a no guarda el texto de las opciones de las listas (pueden llevar datos personales)");
  assert.ok(!mp.pasos.some((p) => p.localizador?.estrategia === "ng_model" && !p.localizador.visible && /resultadoNIT/.test(p.localizador.valor)), "modelo compartido solo con :visible");
  assert.equal(mp.decision_sat2b.necesario_ahora, false);
  for (const f of cl.filas.filter((x) => /Vista Previa|Eliminar item/.test(x.funcion))) assert.match(f.accion, /BLOQUEADA/);
  const dl = JSON.parse(fs.readFileSync(new URL("../config/datos-ficticios-lineas.json", import.meta.url), "utf8")); assert.ok(validarDatos(dl).ok);
});

test("pasos nuevos (salir_del_campo, verificar_ausente, estrategia clase): válidos, idempotentes y sin permitir nada de emisión", () => {
  const con = (extra) => { const m = mapeoOk(); m.pasos.splice(2, 0, { id: "n1", verificado: true, ...extra }); return validarMapeo(m); };
  assert.ok(con({ tipo: "salir_del_campo", localizador: { estrategia: "ng_model", valor: "datosGenerales.nitReceptor", tag: "input", visible: true } }).ok);
  assert.ok(con({ tipo: "verificar_ausente", localizador: { estrategia: "clase", valor: "ng-invalid", visible: true } }).ok);
  assert.ok(con({ tipo: "verificar_ausente", localizador: { estrategia: "texto", valor: "Cantidad no válida" } }).ok);
  assert.ok(!con({ tipo: "verificar_ausente", localizador: { estrategia: "clase", valor: "a b; x" } }).ok, "clase con caracteres no permitidos");
  assert.ok(!con({ tipo: "salir_del_campo", localizador: { estrategia: "ng_model", valor: "x", tag: "form" } }).ok, "tag no permitido");
  assert.ok(esIdempotente({ tipo: "salir_del_campo" }) && esIdempotente({ tipo: "verificar_ausente" }) && !esIdempotente({ tipo: "clic_seguro" }));
  assert.equal(TIPOS_PASO.some((t) => /emit|certific|envi|submit|press|firm|clic|click|enter/.test(t) && t !== "clic_seguro"), false);
  assert.equal(clasificarControl({ tag: "button", type: "button", texto: "Aceptar", ngclick: "validarInformacion()" }).nivel, "prohibido", "ng-click validar… = vista previa");
  assert.equal(clasificarControl({ tag: "button", type: "button", titulo: "x", ngclick: "eliminarItem($index,1)" }).nivel, "prohibido");
  assert.equal(clasificarControl({ tag: "button", type: "button", texto: "Siguiente", ngclick: "guardarBorrador()" }).nivel, "prohibido");
});

test("aparece_tras: solo puede referirse a un paso anterior; y GET dinámicos con ruta de emisión/guardado se bloquean (los demás pasan)", () => {
  const mk = (ref) => { const m = mapeoOk(); m.pasos.splice(2, 0, { id: "n1", tipo: "leer", dato: "a.b", verificado: true, aparece_tras: ref, localizador: { estrategia: "ng_model", valor: "x.y", tag: "input" } }); return validarMapeo(m); };
  assert.ok(mk("b").ok); assert.ok(!mk("zz").ok); assert.ok(!mk("n1").ok, "no a sí mismo ni a uno posterior");
  const ev = (u, tipo, m = "GET") => evaluarSolicitud({ metodo: m, url: u, tipoRecurso: tipo });
  for (const r of ["/consulta/emitir/x", "/a/guardar", "/x/Certificar", "/api/anular/3", "/doc/firma", "/api/envio", "/x/transmitir"]) { assert.equal(ev("https://p.gt" + r, "fetch").permitir, false, r); assert.equal(ev("https://p.gt" + r, "xhr", "HEAD").permitir, false, r); }
  for (const r of ["/consulta/receptor/CF", "/catalogos/monedas", "/menu/portada.jsf", "/fel-web/privado/vistas/fel.jsf"]) assert.equal(ev("https://p.gt" + r, "fetch").permitir, true, r);
  assert.equal(ev("https://p.gt/js/emision.js", "script").permitir, true, "los recursos estáticos no se filtran por nombre"); assert.equal(ev("https://p.gt/api/emitir", "fetch", "OPTIONS").permitir, true, "OPTIONS (preflight) no lleva efectos");
});

test("solo-comprobar: el mapeo preliminar (verificado=false) vale para COMPROBAR pero no para ejecutar; el portal real exige autorización explícita por etapa", () => {
  const mp = JSON.parse(fs.readFileSync(new URL("../config/mapeo.sat-preliminar.json", import.meta.url), "utf8"));
  assert.equal(validarMapeo(mp).ok, false); assert.equal(validarMapeo(mp, { soloComprobar: true }).ok, true, validarMapeo(mp, { soloComprobar: true }).errores.join("\n"));
  const m2 = structuredClone(mp); m2.pasos = m2.pasos.filter((p) => p.tipo !== "detener"); assert.equal(validarMapeo(m2, { soloComprobar: true }).ok, false, "sigue exigiendo detener");
  const m3 = structuredClone(mp); m3.dominios_permitidos = []; assert.equal(validarMapeo(m3, { soloComprobar: true }).ok, false, "sigue exigiendo dominios");
  const m4 = structuredClone(mp); m4.pasos.splice(1, 0, { id: "z1", tipo: "clic_seguro", motivo: "x", localizador: { estrategia: "texto", valor: "Vista Previa" } }); assert.equal(validarMapeo(m4, { soloComprobar: true }).ok, false, "palabras prohibidas siguen rechazadas");
  const aut = (env, sc) => evaluarAutorizacionSat({ env, dominios: mp.dominios_permitidos, soloComprobar: sc });
  assert.equal(aut({}, true).permitido, false); assert.equal(aut({ FEL_AUTORIZACION_SAT: "si" }, true).permitido, false);
  assert.equal(aut({ FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa2" }, true).permitido, false, "la etapa 2 no autoriza la 1");
  assert.equal(aut({ FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa1" }, false).permitido, false, "la etapa 1 NO autoriza llenar");
  assert.equal(aut({ FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa1" }, true).permitido, true); assert.equal(aut({ FEL_AUTORIZACION_SAT: "SI", FEL_ETAPA_AUTORIZADA: "etapa1" }, true).permitido, false);
  assert.equal(evaluarAutorizacionSat({ env: {}, dominios: ["127.0.0.1"] }).permitido, true, "páginas locales: sin requisitos");
});
test("red: un XHR/fetch GET a un dominio NO listado (p. ej. felav02) se bloquea; solo pasa con una regla permitir_get revisada; el hallazgo consultaFallecido NO está autorizado", () => {
  const mp = JSON.parse(fs.readFileSync(new URL("../config/mapeo.sat-preliminar.json", import.meta.url), "utf8")), dominios = mp.dominios_permitidos;
  const ev = (url, tipoRecurso, pol = { dominios }, metodo = "GET") => evaluarSolicitud({ metodo, url, tipoRecurso }, pol);
  const f02 = "https://felav02.c.sat.gob.gt/fel-rest/rest/publico/consultaFallecido/CF";
  assert.equal(ev(f02, "xhr").permitir, false); assert.match(ev(f02, "xhr").razon, /revisión específica/); assert.equal(ev(f02, "fetch", { dominios }, "HEAD").permitir, false);
  assert.equal(ev("https://felav.c.sat.gob.gt/fel-rest/rest/publico/catalogo/monedas", "xhr").permitir, true, "XHR al dominio permitido pasa (y se registra)");
  assert.equal(ev(f02, "xhr", { dominios }, "OPTIONS").permitir, true, "OPTIONS no lleva efectos");
  for (const t of ["script", "image", "stylesheet", "font", "document"]) assert.equal(ev("https://cdn.otro.example/x.js", t).permitir, true, `recurso estático ${t}`);
  assert.equal(ev(f02, "xhr", {}).permitir, true, "sin lista de dominios (modo antiguo/pruebas) no se filtra por host");
  const regla = { host: "felav02.c.sat.gob.gt", ruta_prefijo: "/fel-rest/rest/publico/consultaFallecido/", motivo: "revisada por la persona responsable", revisado: true };
  assert.equal(ev(f02, "xhr", { dominios, permitir_get: [regla] }).permitir, true, "con regla explícita");
  assert.equal(ev("https://felav02.c.sat.gob.gt/fel-rest/rest/publico/otra/CF", "xhr", { dominios, permitir_get: [regla] }).permitir, false, "otra ruta del mismo dominio sigue bloqueada");
  assert.equal(ev("https://felav03.c.sat.gob.gt/fel-rest/rest/publico/consultaFallecido/CF", "xhr", { dominios, permitir_get: [regla] }).permitir, false, "otro host sigue bloqueado");
  assert.equal(ev("https://felav02.c.sat.gob.gt/fel-rest/rest/publico/emitir/1", "xhr", { dominios, permitir_get: [{ ...regla, ruta_prefijo: "/fel-rest/rest/publico/" }] }).permitir, false, "ni con regla amplia pasa una ruta de emisión");
  const con = (r) => validarMapeo({ ...mapeoOk(), permitir_get: [r] });
  assert.ok(con(regla).ok); for (const mal of [{ ...regla, revisado: false }, { ...regla, motivo: "" }, { ...regla, host: "*.c.sat.gob.gt" }, { ...regla, ruta_prefijo: "/" }, { ...regla, ruta_prefijo: "/api/emitir/" }, { host: "x.gt" }]) assert.equal(con(mal).ok, false, JSON.stringify(mal));
  assert.deepEqual(mp.permitir_get, [], "el mapeo NO autoriza ninguna ruta adicional"); assert.ok(!dominios.includes("felav02.c.sat.gob.gt"), "felav02 no está en dominios_permitidos");
  assert.match(mp.red_observada_sat2d.interpretacion, /NO se puede atribuir/); assert.equal(mp.red_observada_sat2d.peticion_confirmada.ruta, "/fel-rest/rest/publico/consultaFallecido/CF");
});

test("navegador de las pruebas: Chromium por defecto; Chrome solo con FEL_NAVEGADOR=chrome; ruta explícita tiene prioridad; valores raros se rechazan", () => {
  assert.deepEqual(opcionesNavegador({}), {}); assert.deepEqual(opcionesNavegador({ FEL_NAVEGADOR: "" }), {}); assert.deepEqual(opcionesNavegador({ FEL_NAVEGADOR: "chromium" }), {});
  assert.deepEqual(opcionesNavegador({ FEL_NAVEGADOR: "chrome" }), { channel: "chrome" }); assert.deepEqual(opcionesNavegador({ FEL_NAVEGADOR: " Chrome " }), { channel: "chrome" });
  assert.deepEqual(opcionesNavegador({ FEL_NAVEGADOR: "chrome", FEL_NAVEGADOR_RUTA: "C:\\x\\chrome.exe" }), { executablePath: "C:\\x\\chrome.exe" }, "la ruta manda sobre el canal (no pueden ir juntos)");
  for (const mal of ["firefox", "edge", "chrome;x", "webkit"]) assert.throws(() => opcionesNavegador({ FEL_NAVEGADOR: mal }), /no válido/, mal);
  const fuentes = ["src", "bin"].flatMap((d) => fs.readdirSync(new URL(`../${d}/`, import.meta.url)).filter((f) => f.endsWith(".mjs") && f !== "verificar.mjs").map((f) => fs.readFileSync(new URL(`../${d}/${f}`, import.meta.url), "utf8")));
  assert.ok(fuentes.every((c) => !/FEL_NAVEGADOR/.test(c)), "el motor real (src/ y bin/ salvo verificar) no depende de FEL_NAVEGADOR");
});

test("ejecutor: toda acción que modifica la página (fill, selectOption, setChecked, blur, click) está precedida por su salida de solo-comprobar", () => {
  const src = fs.readFileSync(new URL("../src/ejecutor.mjs", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const acciones = [...src.matchAll(/\.(fill|selectOption|setChecked|blur|click)\s*\(/g)];
  assert.ok(acciones.length >= 5, `acciones encontradas: ${acciones.length}`);
  for (const m of acciones) { const antes = src.slice(Math.max(0, m.index - 420), m.index); assert.ok(/soloComprobar/.test(antes), `.${m[1]}( no está protegida por soloComprobar: …${antes.slice(-120).replace(/\s+/g, " ")}`); }
  assert.ok(/if \(soloComprobar\) \{ progreso = null; libro = null; reanudar = false; \}/.test(src), "comprobar no deja progreso ni libro");
  assert.ok(!/\.(press|pressSequentially|check|dispatchEvent|hover|dblclick|setInputFiles|dragTo)\s*\(|\.type\s*\(\s*[^)\s]/.test(src), "el ejecutor no usa otras acciones de interacción (.type() sin argumentos es solo el tipo del diálogo)");
});

// ───── Etapa 2 ─────
import { compararValor, recortarPlan, aNumero } from "../src/guardia.mjs";
test("etapa2: compararValor numérico exige separador decimal declarado y respeta la tolerancia", () => {
  assert.equal(compararValor("241.00", "241", { comparacion: "numerica", decimal: "." }), true);
  assert.equal(compararValor("241,00", "241.00", { comparacion: "numerica", decimal: "," }), true);
  assert.equal(compararValor("251,00", "251.00", { comparacion: "numerica", decimal: "." }), false, "coma con decimal «.» no se supone");
  assert.equal(compararValor("241.50", "241.00", { comparacion: "numerica", decimal: "." }), false);
  assert.equal(compararValor("Consumidor Final", "CONSUMIDOR FINAL", { comparacion: "sin_mayusculas" }), true);
  assert.equal(compararValor("a", "A", { comparacion: "exacta" }), false);
  assert.equal(aNumero("abc", "."), null);
});
test("etapa2: recortarPlan conserva el orden y falla con un id inexistente", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../config/mapeo.sat-etapa2.json", import.meta.url), "utf8"));
  const a = recortarPlan(m, "p150-linea0-leer-total");
  assert.equal(a.pasos.at(-1).id, "p999-detener"); assert.equal(a.pasos.at(-2).id, "p150-linea0-leer-total"); assert.ok(!a.pasos.some((p) => /p020|p025|p026/.test(p.id)));
  assert.throws(() => recortarPlan(m, "no-existe"));
});
test("etapa2: el mapa real se rechaza hasta que una persona confirme sesión y p026; nunca trae permitir_post/permitir_get", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../config/mapeo.sat-etapa2.json", import.meta.url), "utf8"));
  const v = validarMapeo(m, { etapa2: true }); assert.equal(v.ok, false);
  assert.deepEqual([m.permitir_post, m.permitir_get], [[], []]);
  assert.ok(!m.pasos.some((p) => ["clic_seguro", "marcar"].includes(p.tipo)));
});
test("etapa2: la autorización de etapa1 no habilita etapa2 y faltan las condiciones propias", () => {
  const dominios = ["felav.c.sat.gob.gt"], datos = { receptor: { nit: "CF" } }, empresa = { alias: "e", identidad: { confirmacion_manual: true } };
  const base = { dominios, soloComprobar: false, empresa, datos };
  assert.equal(evaluarAutorizacionSat({ ...base, env: {} }).permitido, false);
  assert.equal(evaluarAutorizacionSat({ ...base, env: { FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa1" } }).permitido, false);
  assert.equal(evaluarAutorizacionSat({ ...base, env: { FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa2" } }).permitido, false, "faltan condiciones de uso y empresa confirmada");
  assert.equal(evaluarAutorizacionSat({ ...base, datos: { receptor: { nit: "1234567" } }, env: { FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa2", FEL_CONDICIONES_USO_REVISADAS: "si", FEL_EMPRESA_CONFIRMADA: "e" } }).permitido, false, "NIT distinto de CF");
  assert.equal(evaluarAutorizacionSat({ ...base, env: { FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa2", FEL_CONDICIONES_USO_REVISADAS: "si", FEL_EMPRESA_CONFIRMADA: "e" } }).permitido, true);
});

// ───── O-1 / O-2 (observación pasiva) ─────
import { analizarO1, leerRegistroO2, analizarO2, ROJO } from "../src/o1o2.mjs";
const ctrlBase = (c) => ({ tag: "input", tipo: "text", name: null, id: null, ng_model: null, titulo: null, visible: true, ng: {}, atributos_on: {}, nativos: {}, jquery: {}, ...c });
const o1Limpio = () => ({
  herramientas: { getEventListeners: true, jquery: "3.7.1", jquery_data: true, angular: "1.5.8" }, marco: { host: "felav.c.sat.gob.gt", ruta: "/fel-web/x", en_iframe: true }, totales: { controles_encontrados: 7, controles_listados: 7 },
  controles: [
    ctrlBase({ ng_model: "datosGenerales.nitReceptor", ng: { "ng-blur": { llama_a: ["consultarNit"] } } }),
    ctrlBase({ ng_model: "datosGenerales.direccionReceptor" }),
    ctrlBase({ tag: "select", name: "BienOServicio0" }),
    ctrlBase({ name: "Cantidad0", ng: { "ng-change": { llama_a: ["calcularTotal", "limpiarFrasesEspeciales", "limpiarReferencia"] } } }),
    ctrlBase({ name: "Descripcion0" }),
    ctrlBase({ name: "PrecioUnitario0", ng: { "ng-change": { llama_a: ["calcularTotal"] } }, nativos: { input: [{ nombre: "(anónima)", llama_a: ["$setViewValue", "scope.$apply"] }] } }),
    ctrlBase({ name: "Descuento0", ng: { "ng-change": { llama_a: ["calcularTotal"] } } }), ctrlBase({ name: "OtrosDescuento0" }),
  ],
  globales: { document: { nativos: {}, jquery: {} } }, angular: { debug_info: true, truncado: false, scopes: [{ id: 1, funciones: ["calcularTotal", "guardar"], n_watchers: 0 }], watchers: [], watchers_por_llamada: {} },
});
test("o1: sin manejadores peligrosos y con funciones aprobadas → VERDE; sin aprobar → AMARILLO", () => {
  assert.equal(analizarO1(o1Limpio(), { aprobadas: ["calcularTotal", "limpiarFrasesEspeciales", "limpiarReferencia"] }).veredicto, "VERDE");
  const a = analizarO1(o1Limpio()); assert.equal(a.veredicto, "AMARILLO"); assert.ok(a.amarillos.some((h) => h.nombre === "calcularTotal"));
  assert.ok(!a.amarillos.some((h) => /consultarNit/.test(h.nombre)), "el NIT no cuenta en el tramo 2A");
  const b = analizarO1(o1Limpio(), { tramo: "2B", aprobadas: ["calcularTotal", "limpiarFrasesEspeciales", "limpiarReferencia"] }); assert.equal(b.veredicto, "AMARILLO"); assert.ok(b.amarillos.some((h) => h.nombre === "consultarNit"));
});
test("o1: cualquier llamada a guardar/enviar/http en un campo, un manejador global o un watcher → ROJO", () => {
  for (const mut of [(o) => { o.controles[3].ng["ng-change"].llama_a.push("guardarBorrador"); }, (o) => { o.controles[1].jquery = { blur: [{ nombre: "x", llama_a: ["$http.post"] }] }; }, (o) => { o.globales.document.jquery = { change: [{ nombre: "d", selector_delegado: "input", llama_a: ["fetch"] }] }; }, (o) => { o.angular.watchers = [{ exp: "detalleFactura", funcion: "(anónima)", llama_a: ["autoGuardar"], profundo: true }]; }]) {
    const o = o1Limpio(); mut(o); assert.equal(analizarO1(o, { aprobadas: ["calcularTotal", "limpiarFrasesEspeciales", "limpiarReferencia"] }).veredicto, "ROJO");
  }
});
test("o1: resultados incompletos nunca son VERDE (sin getEventListeners, sin debug de AngularJS, campo ausente o duplicado, contexto equivocado)", () => {
  const ap = ["calcularTotal", "limpiarFrasesEspeciales", "limpiarReferencia"];
  for (const mut of [(o) => { o.herramientas.getEventListeners = false; }, (o) => { o.angular.debug_info = false; }, (o) => { o.controles.splice(3, 1); }, (o) => { o.controles.push(o.controles[3]); }, (o) => { o.marco = { host: "farm3.sat.gob.gt", en_iframe: false }; }, (o) => { o.totales.controles_listados = 3; }]) {
    const o = o1Limpio(); mut(o); assert.equal(analizarO1(o, { aprobadas: ap }).veredicto, "INCOMPLETO");
  }
});
test("o1: el fragmento 4 no contiene operaciones de escritura, eventos, red, almacenamiento ni credenciales (análisis estático del código sin comentarios)", () => {
  const src = fs.readFileSync(new URL("../consola/observar-consola-4.js", import.meta.url), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const prohibidos = [/\.click\s*\(/, /\.focus\s*\(/, /\.blur\s*\(/, /dispatchEvent/, /new\s+(Mouse|Keyboard|Input|Focus)?Event\s*\(/, /\.trigger\s*\(/, /\.submit\s*\(/, /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /\$http/, /\$injector|\.injector\s*\(/, /document\.cookie/, /localStorage|sessionStorage|indexedDB/, /\bcopy\s*\(/, /\beval\s*\(/, /new\s+Function/, /\.setAttribute\s*\(|\.removeAttribute\s*\(|\.appendChild|\.insertBefore|\.innerHTML\s*=|\.outerHTML\s*=|\.textContent\s*=|\.value\s*=[^=]/, /\.checked\s*=[^=]/, /window\.\w+\s*=[^=]/, /\.\$apply|\.\$digest|\.\$eval|\.\$broadcast|\.\$emit/, /\.addEventListener|\.removeEventListener/, /\.value\b/, /\.checked\b/, /\.innerText|\.textContent/, /\.options\b/, /\.last\b/, /ajaxSettings|\.headers/];
  for (const re of prohibidos) assert.ok(!re.test(src), `el fragmento 4 no debe contener ${re}`);
  assert.ok(!ROJO.test("calcularTotal"));
});
test("o2: solo lecturas conocidas y sin periodicidad → VERDE; POST, host nuevo, ruta de guardado, periódicas y canales persistentes → ROJO/AMARILLO", () => {
  const ok = leerRegistroO2("# comentario\nsegundo,metodo,host,ruta,tipo\n0,GET,felav.c.sat.gob.gt,/fel-web/privado/vistas/fel.jsf,document\n");
  assert.equal(ok.errores.length, 0); assert.equal(analizarO2(ok.filas).veredicto, "VERDE");
  const r = (t) => analizarO2(leerRegistroO2(t).filas);
  assert.equal(r("10,POST,felav.c.sat.gob.gt,/fel-web/rest/x,xhr").veredicto, "ROJO");
  assert.equal(r("10,GET,felav02.c.sat.gob.gt,/fel-rest/rest/publico/consultaFallecido/CF,xhr").veredicto, "ROJO");
  assert.equal(r("10,GET,felav.c.sat.gob.gt,/fel-web/guardarBorrador,xhr").veredicto, "ROJO");
  assert.equal(r("30,GET,felav.c.sat.gob.gt,/fel-web/ping,xhr\n90,GET,felav.c.sat.gob.gt,/fel-web/ping,xhr\n150,GET,felav.c.sat.gob.gt,/fel-web/ping,xhr").veredicto, "AMARILLO");
  assert.equal(r("5,GET,felav.c.sat.gob.gt,/fel-web/canal,websocket").veredicto, "AMARILLO");
  assert.equal(analizarO2(leerRegistroO2("30,GET,felav.c.sat.gob.gt,/fel-web/ping,xhr\n90,GET,felav.c.sat.gob.gt,/fel-web/ping,xhr\n150,GET,felav.c.sat.gob.gt,/fel-web/ping,xhr").filas, { aprobadas: ["GET felav.c.sat.gob.gt/fel-web/ping"] }).veredicto, "AMARILLO", "aprobar la ruta no elimina la periodicidad: sigue siendo hallazgo");
  assert.equal(analizarO2([]).veredicto, "INCOMPLETO"); assert.ok(leerRegistroO2("x,GET,a,b,c").errores.length === 1);
  assert.equal(leerRegistroO2("1,GET,felav.c.sat.gob.gt,/fel-web/consulta/12345678901234567890?token=abc#x,xhr").filas[0].ruta.includes("token"), false, "la ruta se sanea: sin consulta ni ids largos");
});
test("o2: un registro vacío solo es válido si la persona lo declara («# sin solicitudes»)", () => {
  assert.equal(analizarO2([]).veredicto, "INCOMPLETO");
  const d = leerRegistroO2("# sin solicitudes en 300 s\n"); assert.equal(d.vacio_confirmado, true); assert.equal(analizarO2(d.filas, { vacio_confirmado: d.vacio_confirmado }).veredicto, "VERDE");
});

// ───── O-1 mínimo (fragmento 5) ─────
import { analizarO1Minimo } from "../src/o1o2.mjs";
test("o1m: el fragmento 5 no contiene escritura, eventos, red, almacenamiento, temporizadores, observadores ni interceptores (análisis estático; el bloque de patrones solo contiene expresiones regulares)", () => {
  const txt = fs.readFileSync(new URL("../consola/observar-consola-5.js", import.meta.url), "utf8");
  const bloque = /\/\/ PATRONES-INICIO\n([\s\S]*?)\n\s*\/\/ PATRONES-FIN/.exec(txt); assert.ok(bloque, "falta el bloque de patrones delimitado");
  for (const l of bloque[1].split("\n").map((x) => x.trim()).filter(Boolean)) assert.ok(/^(const PATRONES = \{|\w+: \/.+\/[gimsu]*,\s*(\/\/.*)?|\};)$/.test(l), `línea no permitida en el bloque de patrones: ${l}`);
  const codigo = txt.replace(bloque[0], "").split("\n").filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/ .*$/, "")).join("\n");
  const prohibidos = [/\.click\s*\(/, /\.focus\s*\(/, /\.blur\s*\(/, /dispatchEvent/, /new\s+(Mouse|Keyboard|Input|Focus)?Event\s*\(/, /\.trigger\s*\(/, /\.submit\s*\(/, /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /\$http/, /\$injector|\.injector\s*\(/, /document\.cookie/, /localStorage|sessionStorage|indexedDB/, /\bcopy\s*\(/, /\beval\s*\(/, /new\s+Function/, /\.setAttribute\s*\(|\.removeAttribute\s*\(|\.appendChild|\.insertBefore|\.innerHTML\s*=|\.outerHTML\s*=|\.textContent\s*=|\.value\s*=[^=]/, /window\.\w+\s*=[^=]/, /\.\$apply|\.\$digest|\.\$eval|\.\$broadcast|\.\$emit|\.\$watch/, /\.addEventListener|\.removeEventListener/, /(?<!\bd)\.value\b/, /\.checked\b/, /\.innerText|\.textContent/, /\.options\b/, /\.last\b/, /ajaxSettings|\.headers/, /setTimeout|setInterval|requestAnimationFrame|requestIdleCallback/, /MutationObserver|PerformanceObserver|IntersectionObserver|ResizeObserver/, /XMLHttpRequest\.prototype|window\.fetch\s*=|navigator\.\w+\s*=/, /Object\.defineProperty|Object\.assign\(window|Proxy\s*\(/, /(?<!toString|slice)\.call\s*\(/, /\.apply\s*\(/, /\b(el|e|x|h|f)\(\)/];
  for (const re of prohibidos) assert.ok(!re.test(codigo), `el fragmento 5 no debe contener ${re}`);
  for (const campo of ["nombre", "name:", "id:", "selector", "titulo", "ng_model", "host", "ruta", "href", "url"]) assert.ok(!new RegExp(`\\b${campo}\\b`, "i").test(txt.replace(bloque[0], "").replace(/\/\/.*$/gm, "").replace(/getAttribute\("(name|ng-model)"\)/g, "")), `la salida no debe tener campo «${campo}»`);
});
test("o1m: veredictos por mecanismo y tramo; INCOMPLETO nunca es VERDE", () => {
  const base = () => ({ herramientas: { getEventListeners: true, jquery: null, jquery_data: false, angular: "1.5.8", angular_debug: true }, contexto: { en_iframe: true, dominio_sat: true }, cobertura: { truncado: false }, por_clase: {}, globales: {}, autoguardado: { angular: { watchers_con: {} }, formularios: { metodo_post: 0 }, meta_refresco: 0, service_worker_activo: false },
    lista_cerrada: Object.fromEntries(["nit_receptor", "direccion_receptor", "tipo_linea0", "cantidad0", "descripcion0", "precio0", "descuento0", "otros_descuentos0"].map((k) => [k, { encontrados: 1, eventos: {}, mecanismos: {} }])) });
  assert.equal(analizarO1Minimo(base()).veredicto, "VERDE");
  const a = base(); a.lista_cerrada.cantidad0.mecanismos = { change: { http: 1 } }; assert.equal(analizarO1Minimo(a).veredicto, "ROJO");
  const b = base(); b.lista_cerrada.nit_receptor.mecanismos = { blur: { http: 1 } }; assert.equal(analizarO1Minimo(b, { tramo: "2A" }).veredicto, "VERDE"); assert.equal(analizarO1Minimo(b, { tramo: "2B" }).veredicto, "ROJO");
  const c = base(); c.globales.ventana = { eventos: { nativo: { beforeunload: 1 }, jquery: {}, ng: {} }, mecanismos: { beforeunload: { envio_beacon: 1 } } }; assert.equal(analizarO1Minimo(c).veredicto, "ROJO");
  const d = base(); d.autoguardado.angular.watchers_con = { temporizador: 2 }; assert.equal(analizarO1Minimo(d).veredicto, "AMARILLO");
  const e = base(); e.autoguardado.angular.watchers_con = { palabra_guardado: 1 }; assert.equal(analizarO1Minimo(e).veredicto, "ROJO");
  for (const mut of [(o) => { o.herramientas.getEventListeners = false; }, (o) => { o.herramientas.angular_debug = false; }, (o) => { o.cobertura.truncado = true; }, (o) => { o.contexto.dominio_sat = false; }, (o) => { o.lista_cerrada.cantidad0.encontrados = 2; }, (o) => { delete o.lista_cerrada.precio0; }]) { const o = base(); mut(o); assert.equal(analizarO1Minimo(o).veredicto, "INCOMPLETO"); }
});

// ───── Mapa de Etapa 2: estado inicial observado (solo documentación; el comportamiento no cambia) ─────
import crypto from "node:crypto";
test("mapa etapa2: los campos que gobiernan el comportamiento del robot no cambiaron con la documentación (huella fija)", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../config/mapeo.sat-etapa2.json", import.meta.url), "utf8"));
  const canon = JSON.stringify({ d: m.dominios_permitidos, pp: m.permitir_post, pg: m.permitir_get, s: m.sesion, t: m.tramos, pasos: m.pasos.map((p) => { const { comentario, evidencia, ...r } = p; return r; }) });
  assert.equal(crypto.createHash("sha256").update(canon).digest("hex"), "7a18da8dfd3e15b08d1bb2215a03b5dadba78b5e3bb6716a572d235d257e9cf3", "si cambias pasos, localizadores, dominios, sesión, tramos o permisos, actualiza esta huella a conciencia (es un cambio de comportamiento)");
  assert.equal(m.pasos.find((p) => p.id === "p010-receptor-radio-nit").tipo, "verificar_marcado");
  assert.deepEqual(m.pasos.filter((p) => ["clic_seguro", "marcar"].includes(p.tipo)), []);
});
test("mapa etapa2: documenta valores iniciales, radio sin marcar, total con seis decimales y controles inferiores; sin datos personales ni fiscales", () => {
  const raw = fs.readFileSync(new URL("../config/mapeo.sat-etapa2.json", import.meta.url), "utf8"), m = JSON.parse(raw), e = m.estado_inicial_observado;
  assert.equal(e.receptor.radio_nit, "SIN MARCAR"); assert.match(e.receptor.consecuencia, /evaluación independiente/);
  assert.deepEqual(e.linea0_valores_iniciales, { tipo: "Servicio", cantidad: "1", descripcion: "vacía", precio_unitario: "0", descuentos: "0", otros_descuentos: "0", total: "0.000000 (seis decimales, campo deshabilitado)", impuestos: "columna vacía" });
  const p150 = m.pasos.find((p) => p.id === "p150-linea0-leer-total"); assert.equal(p150.comparacion, "numerica"); assert.match(p150.comentario, /SEIS decimales/);
  const nombres = m.controles_inferiores_observados.controles.map((c) => c.control); for (const x of [/Agregar item/, /Frase Especial/, /medios de pago/, /Vista Previa/]) assert.ok(nombres.some((n) => x.test(n)), `falta ${x}`);
  for (const c of m.controles_inferiores_observados.controles) assert.ok(/^ninguna/.test(c.accion_del_robot), `el robot no actúa sobre ${c.control}`);
  assert.equal(m.controles_inferiores_observados.controles.find((c) => c.control === "Vista Previa").clasificacion_de_la_guardia, "prohibido");
  const limpio = (t) => t.replace(/20261028\.1439/g, "").replace(/\d+\.\d{6}\b/g, ""); /* se permiten el build visible del portal y los importes con seis decimales */ const docs = [JSON.stringify([m.estado_inicial_observado, m.controles_inferiores_observados, m.pasos.map((p) => p.comentario)]), fs.readFileSync(new URL("../../docs/fase-3-estado-inicial-formulario.md", import.meta.url), "utf8")].map(limpio);   // del mapa se revisa solo lo documental (el resto lleva tiempos en ms)
  for (const t of docs) { assert.ok(!/\d{6,}/.test(t), "no debe haber números largos (NIT, DPI, teléfonos)"); assert.ok(!/@/.test(t), "no debe haber correos"); }
});
