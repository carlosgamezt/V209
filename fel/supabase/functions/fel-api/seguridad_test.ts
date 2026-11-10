// Pruebas de seguridad de la API: cuenta bloqueada con JWT vigente, administrador maestro desactivado, límites de peticiones
// y candados de la emisión real. Usan clientes falsos: sin red, sin credenciales, sin base de datos.
import { assertEquals } from "jsr:@std/assert@1";
import { manejar, type Deps } from "./nucleo.ts";
import { acciones as reales, EMISION_REAL_DISPONIBLE } from "./acciones.ts";
import { construirDeps } from "./lib/deps.ts";
import { LIMITES } from "./lib/limites.ts";
import { fabricarToken } from "./lib/jwt_test.ts";
import { decodificarClaims } from "./lib/jwt.ts";

const tk = (sub: string, extra: Record<string, unknown> = {}) => fabricarToken({ sub, role: "authenticated", aal: "aal1", ...extra });
const EMPRESA = "10000000-0000-0000-0000-00000000000a";
const OTRA = "10000000-0000-0000-0000-00000000000b";
const MAESTRO = "00000000-0000-0000-0000-0000000000a1";
const CONFIG = { origenesPermitidos: [], emisionRealPermitida: false, appUrl: "https://app.test" };

// ---- base de datos falsa que imita las reglas de las funciones SQL
interface Estado { bloqueados: Set<string>; sinPerfil?: Set<string>; maestros: Set<string>; permisos: Record<string, string[]>; fallar?: Set<string> }
function adminFalso(e: Estado, llamadas: string[]) {
  return {
    auth: { getUser: (t: string) => { const sub = decodificarClaims(t).sub;
      return Promise.resolve(sub === MAESTRO ? { data: { user: { id: MAESTRO, email: "m@test.com" } }, error: null }
        : sub === "u1" ? { data: { user: { id: "u1", email: "u1@test.com" } }, error: null }
        : { data: { user: null }, error: { message: "invalid" } }); } },
    rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push(nombre);
      if (e.fallar?.has(nombre)) return Promise.resolve({ data: null, error: { message: "boom" } });
      switch (nombre) {
        case "fel_estado_cuenta": return Promise.resolve({ data: e.bloqueados.has(args.p_user as string) ? "bloqueada" : e.sinPerfil?.has(args.p_user as string) ? "sin_perfil" : "activa", error: null });
        case "fel_es_plataforma": return Promise.resolve({ data: !e.bloqueados.has(args.p_user as string) && e.maestros.has(args.p_user as string), error: null });
        case "fel_permisos_efectivos": return Promise.resolve({ data: e.bloqueados.has(args.p_user as string) ? [] : (e.permisos[`${args.p_empresa}:${args.p_user}`] ?? []), error: null });
        case "fel_limite_consumir": return Promise.resolve({ data: [{ permitido: true, reintentar_en: 1 }], error: null });
        default: return Promise.resolve({ data: { id: "x" }, error: null });
      }
    },
    from: () => { throw new Error("no debía consultarse una tabla"); },
  };
}
const T_MAESTRO = tk(MAESTRO), T_U1 = tk("u1");
const estado = (): Estado => ({ bloqueados: new Set(), maestros: new Set([MAESTRO]), permisos: {} });
const pedir = (cuerpo: unknown, d: Deps, token = tk(MAESTRO), extra: Record<string, string> = {}) =>
  manejar(new Request("https://fel.test/fel-api", { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": `ip-de-${token}`, ...extra }, body: JSON.stringify(cuerpo) }), d, reales);
const leer = async (r: Response) => ({ status: r.status, retry: r.headers.get("retry-after"), ...(await r.json().catch(() => ({}))) });
const mutaciones = (ll: string[]) => ll.filter((n) => /^fel_(admin|op)_/.test(n));

// ================================================================ PRIORIDAD 1: cuenta bloqueada / maestro desactivado
Deno.test("construirDeps.esPlataforma: maestro activo sí; maestro con perfil bloqueado, usuario común o error de base de datos, no", async () => {
  const e = estado(); e.maestros.add("u2");
  const d = construirDeps(adminFalso(e, []), CONFIG);
  assertEquals(await d.esPlataforma(MAESTRO), true);
  e.bloqueados.add(MAESTRO);
  assertEquals(await d.esPlataforma(MAESTRO), false);       // el hueco corregido
  assertEquals(await d.esPlataforma("u1"), false);
  const roto = estado(); roto.fallar = new Set(["fel_es_plataforma"]);
  assertEquals(await construirDeps(adminFalso(roto, []), CONFIG).esPlataforma(MAESTRO), false); // ante la duda, no
});

Deno.test("construirDeps.estadoCuenta: bloqueada / sin_perfil / activa; error = 503 (no se asume permiso)", async () => {
  const e = estado(); e.bloqueados.add("u1"); e.sinPerfil = new Set(["u3"]);
  const d = construirDeps(adminFalso(e, []), CONFIG);
  assertEquals(await d.estadoCuenta("u1"), "bloqueada");
  assertEquals(await d.estadoCuenta("u3"), "sin_perfil");
  assertEquals(await d.estadoCuenta("u2"), "activa");
  const roto = estado(); roto.fallar = new Set(["fel_estado_cuenta"]);
  const r = await leer(await pedir({ accion: "yo" }, construirDeps(adminFalso(roto, []), CONFIG), T_U1));
  assertEquals([r.status, r.codigo], [503, "verificacion"]);
});

Deno.test("administrador maestro desactivado con JWT vigente: NINGUNA acción administrativa se ejecuta", async () => {
  const e = estado(); e.bloqueados.add(MAESTRO);
  for (const [nombre, a] of Object.entries(reales)) {
    if (!a.requisito.plataforma) continue;
    const ll: string[] = [];
    const d = construirDeps(adminFalso(e, ll), CONFIG);
    const r = await leer(await pedir({ accion: nombre, empresa_id: EMPRESA, motivo: "Motivo válido" }, d, T_MAESTRO));
    assertEquals([nombre, r.status, r.codigo], [nombre, 403, "cuenta_desactivada"]);
    assertEquals(mutaciones(ll), [], `${nombre} llegó a ejecutar una función de escritura`);
  }
});

Deno.test("cuenta bloqueada: ninguna acción real (administrativa, de empresa o de sesión) llega a la base de datos", async () => {
  const e = estado(); e.bloqueados.add("u1"); e.permisos[`${EMPRESA}:u1`] = ["clientes.escribir", "usuarios.gestionar", "borradores.ver"];
  for (const nombre of Object.keys(reales)) {
    const ll: string[] = [];
    const r = await leer(await pedir({ accion: nombre, empresa_id: EMPRESA }, construirDeps(adminFalso(e, ll), CONFIG), T_U1));
    assertEquals([nombre, r.status, r.codigo], [nombre, 403, "cuenta_desactivada"]);
    assertEquals(ll.filter((n) => n !== "fel_estado_cuenta" && n !== "fel_limite_consumir"), [], `${nombre} hizo consultas con la cuenta bloqueada`);
  }
});

Deno.test("maestro retirado de plataforma_admins (cuenta activa): las acciones administrativas dan 403 y no escriben", async () => {
  const e = estado(); e.maestros.delete(MAESTRO);
  for (const [nombre, a] of Object.entries(reales)) {
    if (!a.requisito.plataforma) continue;
    const ll: string[] = [];
    const cuerpo = { accion: nombre, empresa_id: EMPRESA, motivo: "Motivo válido", regimen_id: OTRA, codigo: "general" };
    const r = await leer(await pedir(cuerpo, construirDeps(adminFalso(e, ll), CONFIG), T_MAESTRO));
    assertEquals([400, 403].includes(r.status), true, `${nombre}: ${r.status}`);
    assertEquals(mutaciones(ll), [], nombre);
  }
  const ll: string[] = [];
  const r = await leer(await pedir({ accion: "empresa_suspender", empresa_id: EMPRESA, motivo: "Motivo válido" }, construirDeps(adminFalso(e, ll), CONFIG), T_MAESTRO));
  assertEquals(r.status, 403);
});

// ================================================================ PRIORIDAD 2: límites de peticiones
function limitadorFalso() {
  const reloj = { t: 0 };
  const cubetas = new Map<string, number>(); const claves: string[] = [];
  const limitar: Deps["limitar"] = (clave, vent, max) => {
    claves.push(clave);
    const ini = Math.floor(reloj.t / vent) * vent, k = `${clave}@${ini}`, c = cubetas.get(k) ?? 0;
    if (c >= max) return Promise.resolve({ permitido: false, reintentarEn: ini + vent - reloj.t });
    cubetas.set(k, c + 1);
    return Promise.resolve({ permitido: true, reintentarEn: ini + vent - reloj.t });
  };
  return { reloj, claves, limitar };
}
function depsLim(o: { limitar: Deps["limitar"]; permisos?: string[]; getUser?: Deps["getUser"]; maestro?: boolean; llamadasRpc?: string[] }): Deps {
  return {
    admin: { rpc: (n: string) => { o.llamadasRpc?.push(n); return Promise.resolve({ data: { id: "x" }, error: null }); } },
    config: CONFIG, limitar: o.limitar, estadoCuenta: () => Promise.resolve("activa" as const),
    getUser: o.getUser ?? ((t) => Promise.resolve(t ? { id: t, email: `${t}@test.com` } : null)),
    esPlataforma: () => Promise.resolve(o.maestro ?? false), permisos: () => Promise.resolve(o.permisos ?? []),
  };
}
const cli = (emp = EMPRESA) => ({ accion: "cliente_estado", empresa_id: emp, id: "10000000-0000-0000-0000-000000000001", activo: true });
const PERM = ["clientes.escribir"];

Deno.test("límite por usuario: al agotarse da 429 con Retry-After y la acción no se ejecuta", async () => {
  const L = limitadorFalso(); const ll: string[] = [];
  const d = depsLim({ limitar: L.limitar, permisos: PERM, llamadasRpc: ll });
  const max = LIMITES.escritura.cubetas.find((c) => c.ambito === "usuario")!.max;
  for (let i = 0; i < max; i++) assertEquals((await pedir(cli(), d, "userA")).status, 200);
  const antes = ll.length;
  const r = await leer(await pedir(cli(), d, "userA"));
  assertEquals([r.status, r.codigo], [429, "limite_excedido"]);
  assertEquals(Number(r.retry) >= 1, true);
  assertEquals(ll.length, antes, "la acción se ejecutó pese al límite");
});

Deno.test("los límites son independientes por usuario", async () => {
  const L = limitadorFalso();
  const d = depsLim({ limitar: L.limitar, permisos: PERM });
  const max = LIMITES.escritura.cubetas.find((c) => c.ambito === "usuario")!.max;
  for (let i = 0; i < max; i++) await pedir(cli(), d, "userA");
  assertEquals((await pedir(cli(), d, "userA")).status, 429);
  assertEquals((await pedir(cli(), d, "userB")).status, 200);
});

Deno.test("límite por empresa: se comparte entre usuarios de la misma empresa y no afecta a otra", async () => {
  const L = limitadorFalso();
  const d = depsLim({ limitar: L.limitar, permisos: PERM });
  const maxE = LIMITES.escritura.cubetas.find((c) => c.ambito === "empresa")!.max;
  const maxU = LIMITES.escritura.cubetas.find((c) => c.ambito === "usuario")!.max;
  let n = 0;
  for (let u = 0; n < maxE; u++) for (let i = 0; i < maxU && n < maxE; i++, n++) assertEquals((await pedir(cli(), d, `usuario${u}`)).status, 200);
  assertEquals((await leer(await pedir(cli(), d, "usuarioNuevo"))).codigo, "limite_excedido");
  assertEquals((await pedir(cli(OTRA), d, "usuarioNuevo")).status, 200);
});

Deno.test("el cupo de una empresa NO se consume sin autorización (nadie puede agotar una empresa ajena enviando su id)", async () => {
  const L = limitadorFalso();
  const d = depsLim({ limitar: L.limitar, permisos: [] }); // sin permisos en la empresa
  for (let i = 0; i < 20; i++) assertEquals((await pedir(cli(), d, "intruso")).status, 403);
  assertEquals(L.claves.filter((k) => k.startsWith("empresa:")), [], "se consumió el cupo de la empresa sin autorización");
});

Deno.test("límite previo a la autenticación por origen: se aplica antes de validar el token y la IP se guarda solo como hash", async () => {
  const L = limitadorFalso(); let getUserLlamado = 0;
  const d = depsLim({ limitar: L.limitar, permisos: PERM, getUser: () => { getUserLlamado++; return Promise.resolve(null); } });
  const h = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
  for (let i = 0; i < 600; i++) await pedir({ accion: "yo" }, d, "falso", h);
  assertEquals(getUserLlamado, 600);
  const r = await leer(await pedir({ accion: "yo" }, d, "falso", h));
  assertEquals([r.status, r.codigo], [429, "limite_excedido"]);
  assertEquals(getUserLlamado, 600, "se consultó Auth pese al límite por origen");
  assertEquals(L.claves.some((k) => k.includes("203.0.113.7")), false, "la IP quedó en claro");
  // otro origen no se ve afectado
  assertEquals((await pedir({ accion: "yo" }, d, "falso", { "x-forwarded-for": "198.51.100.9" })).status, 401);
});

Deno.test("limitador caído: acciones sensibles se rechazan con 503; la lectura de sesión sigue disponible", async () => {
  const roto: Deps["limitar"] = () => Promise.reject(new Error("db caída"));
  const ll: string[] = [];
  const d = depsLim({ limitar: roto, permisos: PERM, llamadasRpc: ll });
  // el límite por origen es "cerrado": con el limitador caído nada pasa (ni la sesión)
  const r0 = await leer(await pedir({ accion: "yo" }, d, "userA"));
  assertEquals(r0.status, 503);
  assertEquals(ll.length, 0);
  // solo el límite de la categoría "sesion" es abierto: se prueba con el límite por origen funcionando
  const L = limitadorFalso();
  const parcial: Deps["limitar"] = (k, v, m) => k.startsWith("ip:") ? L.limitar(k, v, m) : Promise.reject(new Error("db caída"));
  const dyo = depsLim({ limitar: parcial, permisos: PERM, getUser: (t) => Promise.resolve({ id: t, email: `${t}@t.com` }) });
  dyo.admin = { rpc: () => Promise.resolve({ data: [], error: null }), from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }),
    gt: () => Promise.resolve({ data: [], error: null }) }) }) }) };
  const ok = await leer(await pedir({ accion: "yo" }, dyo, "userA"));
  assertEquals(ok.status === 503, false); // la categoría "sesion" falla en abierto
  assertEquals(ok.status === 503, false);
  const bloqueada = await leer(await pedir(cli(), depsLim({ limitar: parcial, permisos: PERM }), "userA"));
  assertEquals([bloqueada.status, bloqueada.codigo], [503, "limitador"]);
});

Deno.test("expiración: al terminar la ventana el cupo se renueva", async () => {
  const L = limitadorFalso();
  const d = depsLim({ limitar: L.limitar, permisos: PERM, maestro: true });
  const tok = "maestroA";
  const adm = (n: number) => ({ accion: "emision_real_deshabilitar", empresa_id: EMPRESA, motivo: `Motivo ${n} válido` });
  const maxA = LIMITES.admin.cubetas[0].max, vent = LIMITES.admin.cubetas[0].ventanaSeg;
  // aal2 es obligatorio en estas acciones: el token lleva aal2 y la identidad se fija en getUser
  const dUser: Deps = { ...d, getUser: () => Promise.resolve({ id: tok, email: "m@test.com" }) };
  const tk = fabricarToken({ aal: "aal2" });
  const llamar = (i: number) => manejar(new Request("https://fel.test/fel-api", { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tk}` }, body: JSON.stringify(adm(i)) }), dUser, reales);
  for (let i = 0; i < maxA; i++) assertEquals((await llamar(i)).status, 200);
  const r = await llamar(99);
  assertEquals(r.status, 429);
  assertEquals(Number(r.headers.get("retry-after")) > 0, true);
  L.reloj.t += vent;                    // pasa la ventana
  assertEquals((await llamar(100)).status, 200);
});

Deno.test("concurrencia: 300 peticiones simultáneas de un usuario no superan el máximo permitido", async () => {
  const L = limitadorFalso();
  const d = depsLim({ limitar: L.limitar, permisos: PERM });
  const max = LIMITES.escritura.cubetas.find((c) => c.ambito === "usuario")!.max;
  const rs = await Promise.all(Array.from({ length: 300 }, () => pedir(cli(), d, "userA")));
  const ok = rs.filter((r) => r.status === 200).length;
  assertEquals(ok, max);
  assertEquals(rs.filter((r) => r.status === 429).length, 300 - max);
});

Deno.test("todas las acciones declaran una categoría de límite existente y las sensibles usan la categoría estricta", () => {
  for (const [nombre, a] of Object.entries(reales)) {
    assertEquals(Object.prototype.hasOwnProperty.call(LIMITES, a.limite), true, `${nombre} sin categoría válida (${a.limite})`);
    if (a.requisito.plataforma) assertEquals(a.limite, "admin", nombre);
    assertEquals(a.limite === "fiscal", false, `${nombre}: la categoría fiscal está reservada`);
  }
  assertEquals(reales.miembro_invitar.limite, "invitacion_envio");
  assertEquals(reales.documento_guardar.limite, "escritura");
  assertEquals(reales.yo.limite, "sesion");
});

// ================================================================ PRIORIDAD 3: la emisión real no se puede habilitar por accidente
Deno.test("candado de código: EMISION_REAL_DISPONIBLE es false (cambiarlo obliga a tocar esta prueba)", () => {
  assertEquals(EMISION_REAL_DISPONIBLE, false);
});

Deno.test("aunque FEL_EMISION_REAL_PERMITIDA sea true, emision_real_habilitar da 403 y no toca la base de datos", async () => {
  const e = estado(); const ll: string[] = [];
  const d = construirDeps(adminFalso(e, ll), { ...CONFIG, emisionRealPermitida: true });
  const tk = fabricarToken({ aal: "aal2" });
  const r = await leer(await manejar(new Request("https://fel.test/fel-api", { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tk}` },
    body: JSON.stringify({ accion: "emision_real_habilitar", empresa_id: EMPRESA, motivo: "Intento con configuración abierta" }) }), { ...d,
    getUser: () => Promise.resolve({ id: MAESTRO, email: "m@test.com" }) }, reales));
  assertEquals([r.status, r.codigo], [403, "no_disponible"]);
  assertEquals(ll.filter((n) => n === "fel_admin_emision"), []);
});

Deno.test("ninguna acción de la API puede certificar, anular, conciliar ni tocar SAT; ninguna llama a funciones fiscales", () => {
  const fuente = Object.values(reales).map((a) => a.ejecutar.toString()).join("\n");
  for (const prohibida of ["fel_op_certificacion", "fel_op_anulacion", "fel_op_operacion", "certificador", "sat.gob", "fel_bootstrap", "fel_agregar_maestro", "fel_registrar_recuperacion_manual"]) {
    assertEquals(fuente.includes(prohibida), false, `una acción referencia ${prohibida}`);
  }
  // la única forma de tocar el indicador de emisión es fel_admin_emision, y solo desde las dos acciones de emisión
  const conEmision = Object.entries(reales).filter(([, a]) => a.ejecutar.toString().includes("fel_admin_emision")).map(([n]) => n).sort();
  assertEquals(conEmision, ["emision_real_deshabilitar", "emision_real_habilitar"]);
});

// ================================================================ cuenta SIN perfil: sin acceso, salvo aceptar una invitación vigente
Deno.test("cuenta sin perfil: TODAS las acciones dan 403 sin_perfil salvo aceptar_invitacion, y no tocan la base de datos", async () => {
  const e = estado(); e.sinPerfil = new Set(["u1"]); e.permisos[`${EMPRESA}:u1`] = ["clientes.escribir", "borradores.ver", "usuarios.gestionar"];
  for (const nombre of Object.keys(reales)) {
    if (nombre === "aceptar_invitacion") continue;
    const ll: string[] = [];
    const r = await leer(await pedir({ accion: nombre, empresa_id: EMPRESA }, construirDeps(adminFalso(e, ll), CONFIG), T_U1));
    assertEquals([nombre, r.status, r.codigo], [nombre, 403, "sin_perfil"]);
    assertEquals(ll.filter((n) => n !== "fel_estado_cuenta" && n !== "fel_limite_consumir"), [], `${nombre} hizo consultas sin perfil`);
  }
});

Deno.test("cuenta sin perfil: aceptar_invitacion SÍ llega a la base de datos con el usuario del token (la base exige la invitación vigente)", async () => {
  const e = estado(); e.sinPerfil = new Set(["u1"]);
  const ll: string[] = []; const args: Array<Record<string, unknown>> = [];
  const admin = adminFalso(e, ll); const rpc = admin.rpc.bind(admin);
  admin.rpc = (n: string, a: Record<string, unknown>) => { if (n === "fel_op_invitacion_aceptar") args.push(a); return rpc(n, a); };
  const r = await leer(await pedir({ accion: "aceptar_invitacion" }, construirDeps(admin, CONFIG), T_U1));
  assertEquals(r.status, 200);
  assertEquals(args, [{ p_user: "u1", p_email: "u1@test.com" }]);   // identidad y correo salen del token validado por Auth
  // el cliente no puede mandar otro usuario ni otro correo
  const r2 = await leer(await pedir({ accion: "aceptar_invitacion", user_id: "otro", email: "x@x.com" }, construirDeps(admin, CONFIG), T_U1));
  assertEquals(r2.status, 400);
});

Deno.test("cuenta bloqueada: ni siquiera aceptar_invitacion llega a la base de datos", async () => {
  const e = estado(); e.bloqueados.add("u1");
  const ll: string[] = [];
  const r = await leer(await pedir({ accion: "aceptar_invitacion" }, construirDeps(adminFalso(e, ll), CONFIG), T_U1));
  assertEquals([r.status, r.codigo], [403, "cuenta_desactivada"]);
  assertEquals(ll.includes("fel_op_invitacion_aceptar"), false);
});

Deno.test("la excepción para cuentas sin perfil está acotada a UNA sola acción", () => {
  const conExcepcion = Object.entries(reales).filter(([, a]) => a.permiteSinPerfil).map(([n]) => n);
  assertEquals(conExcepcion, ["aceptar_invitacion"]);
});

// ================================================================ claims: solo de sesiones verificadas, coherentes con el usuario
Deno.test("getUser rechaza un token cuyo sub no es el usuario que Auth validó, o que no es de usuario (role)", async () => {
  const admin = { auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1", email: "u1@test.com" } }, error: null }) }, rpc: () => Promise.resolve({ data: "activa", error: null }) };
  const d = construirDeps(admin, CONFIG);
  assertEquals((await d.getUser(tk("u1")))?.id, "u1");
  assertEquals(await d.getUser(tk("otro-usuario")), null);                          // sub de otra persona
  assertEquals(await d.getUser(fabricarToken({ sub: "u1", role: "anon", aal: "aal2" })), null);   // clave anon / rol equivocado
  assertEquals(await d.getUser(fabricarToken({ sub: "u1", aal: "aal2" })), null);   // sin role
  assertEquals(await d.getUser("no-es-un-jwt"), null);
  const rechazado = { auth: { getUser: () => Promise.resolve({ data: { user: null }, error: { message: "invalid JWT" } }) } };
  assertEquals(await construirDeps(rechazado, CONFIG).getUser(tk("u1", { aal: "aal2" })), null);   // Auth no valida la firma/sesión → no hay nivel que valga
});

Deno.test("solo 'aal2' exacto cuenta como verificación en dos pasos (no 'AAL2', números ni listas)", async () => {
  for (const aal of ["AAL2", " aal2", "aal2 ", 2, ["aal2"], null, undefined, "aal3"]) {
    const e = estado(); const ll: string[] = [];
    const r = await leer(await pedir({ accion: "empresa_suspender", empresa_id: EMPRESA, motivo: "Motivo válido" }, construirDeps(adminFalso(e, ll), CONFIG), tk(MAESTRO, { aal })));
    assertEquals([r.status, r.codigo], [403, "mfa_requerido"], `aal=${JSON.stringify(aal)}`);
    assertEquals(mutaciones(ll), []);
  }
  const e = estado(); const ll: string[] = [];
  const ok = await leer(await pedir({ accion: "empresa_suspender", empresa_id: EMPRESA, motivo: "Motivo válido" }, construirDeps(adminFalso(e, ll), CONFIG), tk(MAESTRO, { aal: "aal2" })));
  assertEquals(ok.status, 200);
});

// ================================================================ recuperación de MFA: la API nunca omite la verificación administrativa
function adminMfa(opts: { factores?: string[]; fallaBorrado?: boolean } = {}) {
  const llamadas: Array<[string, unknown]> = []; const borrados: Array<{ id: string; userId: string }> = [];
  const base = adminFalso(estado(), []);
  return {
    llamadas, borrados,
    admin: { ...base,
      rpc(n: string, a: Record<string, unknown>) {
        llamadas.push([n, a]);
        if (n === "fel_op_mfa_recuperacion_aprobar") return Promise.resolve({ data: { user_id: "usuario-objetivo", factores: opts.factores ?? ["f1", "f2"] }, error: null });
        return base.rpc(n, a);
      },
      auth: { ...base.auth, admin: { mfa: { deleteFactor: (x: { id: string; userId: string }) => { borrados.push(x); return Promise.resolve({ error: opts.fallaBorrado ? { message: "boom" } : null }); } } } } },
  };
}
const aprobar = { accion: "mfa_recuperacion_aprobar", solicitud_id: "20000000-0000-0000-0000-000000000001", verificacion: "Videollamada con documento en mano y confirmación del cargo" };

Deno.test("aprobar recuperación: exige aal2; con aal1 no llega a la base ni borra nada", async () => {
  const m = adminMfa();
  const r = await leer(await pedir(aprobar, construirDeps(m.admin, CONFIG), tk("u1", { aal: "aal1" })));
  assertEquals([r.status, r.codigo], [403, "mfa_requerido"]);
  assertEquals(m.llamadas.filter(([n]) => n.startsWith("fel_op_mfa")), []); assertEquals(m.borrados, []);
});

Deno.test("aprobar recuperación: el usuario y los factores salen de la base de datos, nunca del cliente; se cierra al terminar", async () => {
  const m = adminMfa();
  const r = await leer(await pedir(aprobar, construirDeps(m.admin, CONFIG), tk("u1", { aal: "aal2" })));
  assertEquals(r.status, 200); assertEquals(r.datos.factores_eliminados, 2);
  assertEquals(m.borrados, [{ id: "f1", userId: "usuario-objetivo" }, { id: "f2", userId: "usuario-objetivo" }]);
  const nombres = m.llamadas.map(([n]) => n).filter((n) => n.startsWith("fel_op_mfa"));
  assertEquals(nombres, ["fel_op_mfa_recuperacion_aprobar", "fel_op_mfa_recuperacion_cerrar"]);
  const args = m.llamadas.find(([n]) => n === "fel_op_mfa_recuperacion_aprobar")![1] as Record<string, unknown>;
  assertEquals(args.p_actor, "u1");
  // el cliente no puede indicar a quién ni qué factores borrar
  for (const extra of [{ user_id: "otro" }, { factor_id: "f9" }, { factores: ["f9"] }, { userId: "otro" }]) {
    const mm = adminMfa();
    const x = await leer(await pedir({ ...aprobar, ...extra }, construirDeps(mm.admin, CONFIG), tk("u1", { aal: "aal2" })));
    assertEquals(x.status, 400); assertEquals(mm.borrados, []);
  }
  // sin evidencia suficiente de la verificación no se llega a la base
  const m2 = adminMfa();
  const corto = await leer(await pedir({ ...aprobar, verificacion: "ok" }, construirDeps(m2.admin, CONFIG), tk("u1", { aal: "aal2" })));
  assertEquals(corto.status, 400); assertEquals(m2.llamadas.filter(([n]) => n.startsWith("fel_op_mfa")), []);
});

Deno.test("aprobar recuperación: si falla el borrado en Auth, la solicitud NO se cierra y el error es 502 repetible", async () => {
  const m = adminMfa({ fallaBorrado: true });
  const r = await leer(await pedir(aprobar, construirDeps(m.admin, CONFIG), tk("u1", { aal: "aal2" })));
  assertEquals([r.status, r.codigo], [502, "recuperacion_parcial"]);
  assertEquals(m.llamadas.some(([n]) => n === "fel_op_mfa_recuperacion_cerrar"), false);
});

Deno.test("solicitar recuperación: funciona con sesión aal1 de una cuenta activa; bloqueada o sin perfil, no; y no toca el MFA", async () => {
  const body = { accion: "mfa_recuperacion_solicitar", motivo: "Perdí mi teléfono con la app autenticadora" };
  const m = adminMfa();
  const ok = await leer(await pedir(body, construirDeps(m.admin, CONFIG), tk("u1", { aal: "aal1" })));
  assertEquals(ok.status, 200); assertEquals(m.borrados, []);
  assertEquals((m.llamadas.find(([n]) => n === "fel_op_mfa_recuperacion_solicitar")![1] as Record<string, unknown>).p_user, "u1");
  for (const [campo, cod] of [["bloqueados", "cuenta_desactivada"], ["sinPerfil", "sin_perfil"]] as const) {
    const e = estado(); (e as unknown as Record<string, Set<string>>)[campo] = new Set(["u1"]); const ll: string[] = [];
    const r = await leer(await pedir(body, construirDeps(adminFalso(e, ll), CONFIG), tk("u1")));
    assertEquals([r.status, r.codigo], [403, cod]); assertEquals(ll.some((n) => n === "fel_op_mfa_recuperacion_solicitar"), false);
  }
  // el cliente no puede pedir la recuperación de OTRA persona
  const x = await leer(await pedir({ ...body, user_id: "otra" }, construirDeps(adminMfa().admin, CONFIG), tk("u1")));
  assertEquals(x.status, 400);
});

Deno.test("las acciones de usuarios exigen su permiso y la empresa indicada", async () => {
  const consultas: Array<[string, string]> = [];
  const d = { ...depsLim({ limitar: () => Promise.resolve({ permitido: true, reintentarEn: 1 }) }), permisos: (e: string, u: string) => { consultas.push([e, u]); return Promise.resolve(e === EMPRESA ? ["usuarios.ver"] : []); },
    admin: { rpc: () => Promise.resolve({ data: [], error: null }) } } as Deps;
  assertEquals((await pedir({ accion: "miembros_listar", empresa_id: EMPRESA }, d, "userA")).status, 200);
  assertEquals((await pedir({ accion: "miembros_listar", empresa_id: OTRA }, d, "userA")).status, 403);       // ser de A no da nada en B
  const sin = { ...d, permisos: () => Promise.resolve(["clientes.ver"]) } as Deps;
  assertEquals((await pedir({ accion: "miembros_listar", empresa_id: EMPRESA }, sin, "userA")).status, 403);   // sin usuarios.ver
  assertEquals((await pedir({ accion: "miembros_listar", empresa_id: EMPRESA, actor: "x" }, d, "userA")).status, 400);
});
