import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  textoProhibido, textoAmbiguo, clasificarControl, patronHostValido, hostPermitido, validarEndpointCdp, rutaDentroDe, evaluarSolicitud,
  validarMapeo, validarDatos, validarAislamiento, TIPOS_PASO,
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
  assert.deepEqual(mp.dominios_permitidos, ["felav.c.sat.gob.gt"]); assert.deepEqual(mp.permitir_post, []);
  for (const p of mp.pasos.filter((x) => x.localizador)) assert.ok(p.verificado === false && p.dato);
  const cl = JSON.parse(fs.readFileSync(new URL("../analisis/obs1/clasificacion.json", import.meta.url), "utf8")), conocidos = new Set(cl.filas.map((f) => f.mejor_localizador));
  for (const p of mp.pasos.filter((x) => x.localizador && x.localizador.estrategia !== "rol")) { const l = p.localizador, k = `${l.estrategia}${l.tag ? `[${l.tag}]` : ""}: ${l.valor}`; assert.ok(conocidos.has(k), `el localizador «${k}» no sale de la observación 1`); }
  assert.equal(cl.total, 211); assert.equal(cl.visibles, 31);
  for (const f of cl.filas.filter((x) => /Vista Previa|Eliminar item/.test(x.funcion))) assert.match(f.accion, /BLOQUEADA/);
  const dl = JSON.parse(fs.readFileSync(new URL("../config/datos-ficticios-lineas.json", import.meta.url), "utf8")); assert.ok(validarDatos(dl).ok);
});
