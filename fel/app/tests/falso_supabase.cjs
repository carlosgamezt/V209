// Supabase FALSO para probar la interfaz en modo remoto: Auth (contraseña, TOTP, recuperación, renovación, cierre), PostgREST y la Edge Function.
// Sin red real, sin credenciales reales: intercepta las peticiones del navegador. Imita las reglas del servidor (cuenta sin perfil, bloqueada,
// roles por empresa, nivel aal1/aal2, token vencido, aislamiento entre empresas) para comprobar cómo reacciona la interfaz.
const URL_FALSA = "https://fel-test.supabase.co";
const ANON = "anon-de-prueba";
const CLAVE = "Clave-Segura-123";
const CODIGO_OK = "123456";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

const TODOS = ["empresa.ver", "usuarios.ver", "usuarios.gestionar", "clientes.ver", "clientes.escribir", "conceptos.ver", "conceptos.escribir", "borradores.ver", "borradores.crear", "borradores.editar", "borradores.revisar", "borradores.archivar", "historial.ver", "auditoria.ver", "fiscal.ver"];
const BASE = { propietario: TODOS, administrador: TODOS,
  emisor: ["empresa.ver", "clientes.ver", "clientes.escribir", "conceptos.ver", "conceptos.escribir", "borradores.ver", "borradores.crear", "borradores.editar", "historial.ver", "fiscal.ver"],
  lector: ["empresa.ver", "clientes.ver", "conceptos.ver", "borradores.ver", "historial.ver", "fiscal.ver"] };
const RANGO = { propietario: 4, administrador: 3, emisor: 2, lector: 1 };
const EMPRESAS = { "emp-1": "Distribuidora Prueba", "emp-2": "Ferretería Dos" };

function crear() {
  const e = {
    expiresIn: 3600, limitarMfa: false, limitarRecover: false, config: {}, log: [], violaciones: [], sesiones: new Map(), refrescos: new Map(), n: 0, correosRecuperacion: [], solicitudes: [], ultimaAccion: null, urls: [],
    usuarios: {
      "propietario@fel.test": { id: "u-prop", empresas: { "emp-1": "propietario" }, factor: null },
      "lector@fel.test": { id: "u-lect", empresas: { "emp-1": "lector" }, factor: null },
      "emisor@fel.test": { id: "u-emi", empresas: { "emp-1": "emisor" }, factor: { id: "f-e", verificado: true } },
      "mfa@fel.test": { id: "u-mfa", empresas: { "emp-1": "propietario" }, factor: { id: "f-1", verificado: true } },
      "maestro@fel.test": { id: "u-mae", empresas: { "emp-1": "propietario" }, plataforma: true, factor: { id: "f-2", verificado: true } },
      "multi@fel.test": { id: "u-mul", empresas: { "emp-1": "lector", "emp-2": "propietario" }, factor: null },
      "nuevo@fel.test": { id: "u-nue", estado: "sin_perfil", empresas: {} },
      "bloqueado@fel.test": { id: "u-blo", estado: "bloqueada", empresas: {} },
    },
    invitaciones: { "emp-1": [{ id: "i-1", empresa_id: "emp-1", email: "pendiente@fel.test", rol: "lector", estado: "pendiente", creado_en: "2026-11-09T10:00:00Z", expira_en: "2026-11-16T10:00:00Z" },
      { id: "i-2", empresa_id: "emp-1", email: "vieja@fel.test", rol: "emisor", estado: "aceptada", creado_en: "2026-10-01T10:00:00Z", expira_en: "2026-10-08T10:00:00Z" }], "emp-2": [{ id: "i-9", empresa_id: "emp-2", email: "secreta-de-b@fel.test", rol: "lector", estado: "pendiente", creado_en: "2026-11-09T10:00:00Z", expira_en: "2026-11-16T10:00:00Z" }] },
  };
  const correo = (u) => Object.keys(e.usuarios).find((k) => e.usuarios[k] === u);
  const jwt = (u, aal) => `${b64({ alg: "HS256" })}.${b64({ sub: u.id, role: "authenticated", aal, exp: Math.floor(Date.now() / 1000) + e.expiresIn })}.firma-falsa`;
  e.nuevaSesion = (u, aal) => {
    const n = ++e.n, access = jwt(u, aal) + `.${n}`, refresh = `rt-${u.id}-${n}`;
    e.sesiones.set(access, { u, aal, vencido: false }); e.refrescos.set(refresh, { u, aal });
    return { access_token: access, refresh_token: refresh, expires_in: e.expiresIn, user: { email: correo(u) } };
  };
  e.vencer = (access) => { const s = e.sesiones.get(access); if (s) s.vencido = true; };
  e.revocarRefrescos = () => e.refrescos.clear();
  e.sembrarRefresco = (email, aal) => { const u = e.usuarios[email]; const rt = `rt-sembrado-${++e.n}`; e.refrescos.set(rt, { u, aal }); return rt; };
  e.enlaceCorreo = (email, tipo = "recovery") => { const s = e.nuevaSesion(e.usuarios[email], "aal1"); return `#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=${tipo}`; };
  e.setRol = (email, emp, rol) => { e.usuarios[email].empresas[emp] = rol; };            // cambio hecho "por un administrador" mientras la persona trabaja
  e.setEstado = (email, estado) => { e.usuarios[email].estado = estado; };
  e.ultimoAccess = () => [...e.sesiones.keys()].pop();
  e.cuenta = (u) => u.estado ?? "activa";
  const permisos = (u, emp) => { const r = u.empresas[emp]; if (!r) return []; const s = new Set(BASE[r]); for (const p of u.extra?.[emp] ?? []) s.add(p); for (const p of u.quitados?.[emp] ?? []) s.delete(p); return [...s].sort(); };

  const cab = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "retry-after", "content-type": "application/json" };
  const json = (route, status, cuerpo, extra = {}) => route.fulfill({ status, headers: { ...cab, ...extra }, body: JSON.stringify(cuerpo) });
  const CLIENTES = { "emp-1": [{ id: "c1", empresa_id: "emp-1", tipo_identificacion: "NIT", numero_identificacion: "1234567-8", nombre: "Comercial Los Pinos, S.A.", direccion: null, email: null, telefono: null, activo: true, version: 1 },
    { id: "c2", empresa_id: "emp-1", tipo_identificacion: "CF", numero_identificacion: "CF", nombre: "Consumidor final", direccion: null, email: null, telefono: null, activo: true, version: 1 }],
    "emp-2": [{ id: "c9", empresa_id: "emp-2", tipo_identificacion: "NIT", numero_identificacion: "9999999-9", nombre: "Cliente Exclusivo de la Empresa Dos", direccion: null, email: null, telefono: null, activo: true, version: 1 }] };
  const CONCEPTOS = { "emp-1": [{ id: "k1", empresa_id: "emp-1", codigo: "SRV-001", descripcion: "Consultoría", tipo: "servicio", unidad_medida: "SRV", precio_unitario: "250.00", categoria_fiscal: null, activo: true, version: 1 }], "emp-2": [] };

  e.instalar = async (ctx) => {
    await ctx.route("**/config.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: `window.FEL_CONFIG = ${JSON.stringify({ modo: "remoto", supabaseUrl: URL_FALSA, anonKey: ANON, ...e.config })};` }));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
      const url = r.request().url();
      if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return r.abort();
      if (!url.startsWith(URL_FALSA)) { e.violaciones.push(`petición a host no previsto: ${url}`); return r.abort(); }
      return manejar(r);
    });
  };

  async function manejar(route) {
    const req = route.request(), url = new URL(req.url()), ruta = url.pathname, m = req.method();
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cab });
    e.urls.push(ruta + url.search);
    e.log.push(`${m} ${ruta}${url.searchParams.get("grant_type") ? "?" + url.searchParams.get("grant_type") : ""}`);
    const h = req.headers(); const bearer = (h.authorization ?? "").replace(/^Bearer /, "");
    if (h.apikey !== ANON) e.violaciones.push(`petición sin la clave anon: ${m} ${ruta}`);
    let cuerpo = {}; try { cuerpo = JSON.parse(req.postData() ?? "{}"); } catch { /* sin cuerpo */ }
    const ses = e.sesiones.get(bearer);
    const valida = ses && !ses.vencido;

    // ---------------- Auth
    if (ruta === "/auth/v1/token") {
      const g = url.searchParams.get("grant_type");
      if (g === "password") {
        const u = e.usuarios[cuerpo.email];
        if (!u || cuerpo.password !== (u.pass ?? CLAVE)) return json(route, 400, { error: "invalid_grant" });
        return json(route, 200, e.nuevaSesion(u, "aal1"));
      }
      if (g === "refresh_token") {
        const r = e.refrescos.get(cuerpo.refresh_token);
        if (!r) return json(route, 400, { error: "invalid_grant" });
        e.refrescos.delete(cuerpo.refresh_token);
        return json(route, 200, e.nuevaSesion(r.u, r.aal));
      }
    }
    if (ruta === "/auth/v1/recover" && m === "POST") {
      e.correosRecuperacion.push({ email: cuerpo.email, redirect_to: url.searchParams.get("redirect_to") });
      if (e.limitarRecover) return json(route, 429, { msg: "rate limit" }, { "retry-after": "9" });
      return json(route, 200, {});     // idéntica exista o no la cuenta
    }
    if (ruta === "/auth/v1/user" && m === "GET") {
      if (!valida) return json(route, 401, { msg: "token inválido" });
      const f = ses.u.factor;
      return json(route, 200, { id: ses.u.id, email: correo(ses.u), factors: f ? [{ id: f.id, factor_type: "totp", status: f.verificado ? "verified" : "unverified" }] : [] });
    }
    if (ruta === "/auth/v1/user" && m === "PUT") {
      if (!valida) return json(route, 401, { msg: "token inválido" });
      if (ses.u.factor?.verificado && ses.aal !== "aal2") return json(route, 422, { error_code: "insufficient_aal", msg: "AAL2 session is required to update email or password when MFA is enabled." });
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/.test(cuerpo.password ?? "") || cuerpo.password === (ses.u.pass ?? CLAVE)) return json(route, 422, { error_code: "weak_password", msg: "Password rejected" });
      ses.u.pass = cuerpo.password; e.ultimaAccion = `password:${correo(ses.u)}`;
      return json(route, 200, { id: ses.u.id });
    }
    if (ruta === "/auth/v1/factors" && m === "POST") {
      if (!valida) return json(route, 401, {});
      ses.u.factor = { id: `f-nuevo-${++e.n}`, verificado: false };
      return json(route, 200, { id: ses.u.factor.id, type: "totp", totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="%23000"/><rect x="2" y="2" width="6" height="6" fill="%23fff"/></svg>', secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/NEXA%20FEL" } });
    }
    let mm;
    if ((mm = ruta.match(/^\/auth\/v1\/factors\/([^/]+)\/challenge$/))) {
      if (!valida) return json(route, 401, {});
      if (e.limitarMfa) return json(route, 429, { msg: "rate limit" }, { "retry-after": "7" });
      return json(route, 200, { id: `ch-${++e.n}` });
    }
    if ((mm = ruta.match(/^\/auth\/v1\/factors\/([^/]+)\/verify$/))) {
      if (!valida || !cuerpo.challenge_id) return json(route, 401, {});
      if (cuerpo.code !== CODIGO_OK) return json(route, 400, { msg: "código inválido" });
      ses.u.factor = { ...(ses.u.factor ?? {}), id: mm[1], verificado: true };
      return json(route, 200, e.nuevaSesion(ses.u, "aal2"));
    }
    if (ruta === "/auth/v1/logout") { if (ses) e.sesiones.delete(bearer); return json(route, 204, {}); }

    // ---------------- datos (PostgREST con RLS): la empresa pedida solo responde si la persona es miembro activa
    if (!valida) return json(route, 401, { message: "JWT expirado" });
    const emp = (url.searchParams.get("empresa_id") ?? "").replace(/^eq\./, "");
    const miembro = !ses.u.estado && !!ses.u.empresas[emp];
    if (ruta.startsWith("/rest/v1/")) {
      if (ruta === "/rest/v1/identificaciones_tipos") return json(route, 200, [{ codigo: "NIT", nombre: "NIT", verificado: false }, { codigo: "CF", nombre: "CF", verificado: false }]);
      if (ruta === "/rest/v1/permisos_catalogo") return json(route, 200, ses.u.estado ? [] : TODOS.map((c) => ({ codigo: c, descripcion: `Permite ${c}` })));
      if (ruta === "/rest/v1/rol_permisos") return json(route, 200, ses.u.estado ? [] : Object.entries(BASE).flatMap(([rol, ps]) => ps.map((permiso) => ({ rol, permiso }))));
      if (ruta === "/rest/v1/clientes") return json(route, 200, miembro ? CLIENTES[emp] ?? [] : []);
      if (ruta === "/rest/v1/conceptos") return json(route, 200, miembro ? CONCEPTOS[emp] ?? [] : []);
      if (ruta === "/rest/v1/documentos") return json(route, 200, []);
      if (ruta === "/rest/v1/invitaciones") return json(route, 200, miembro && permisos(ses.u, emp).includes("usuarios.gestionar") ? e.invitaciones[emp] ?? [] : []);
      return json(route, 404, {});
    }
    if (ruta === "/functions/v1/fel-api") {
      const a = cuerpo.accion;
      const err = (status, error, codigo) => json(route, status, { ok: false, error, codigo }, codigo === "limite_excedido" ? { "retry-after": "5" } : {});
      if (ses.u.estado === "bloqueada") return err(403, "La cuenta está desactivada", "cuenta_desactivada");
      if (a === "aceptar_invitacion") return ses.u.estado ? err(403, "No tienes una invitación vigente", "no_autorizado") : json(route, 200, { ok: true, datos: { aceptadas: 0 } });
      if (a === "mfa_recuperacion_solicitar") {
        if (ses.u.estado) return err(403, "La cuenta no puede solicitar una recuperación", "no_autorizado");
        if (String(cuerpo.motivo ?? "").length < 10) return err(400, "motivo: entre 10 y 500 caracteres.", "entrada_invalida");
        if (e.solicitudes.some((s) => s.user === ses.u && ["pendiente", "aprobada"].includes(s.estado))) return err(409, "Ya tienes una solicitud en curso", "conflicto");
        e.solicitudes.push({ id: `s-${++e.n}`, user: ses.u, motivo: cuerpo.motivo, estado: "pendiente", solicitada_en: "2026-11-10T09:00:00Z" });
        return json(route, 200, { ok: true, datos: { solicitud_id: `s-${e.n}` } });
      }
      if (ses.u.estado === "sin_perfil") return err(403, "Tu cuenta todavía no tiene acceso a NEXA FEL; necesitas una invitación vigente", "sin_perfil");
      if (a === "yo") return json(route, 200, { ok: true, datos: { usuario: { id: ses.u.id, email: correo(ses.u) }, plataforma: !!ses.u.plataforma, mfa: ses.aal,
        empresas: Object.keys(ses.u.empresas).map((id) => ({ empresa: { id, nombre_comercial: EMPRESAS[id], razon_social: `${EMPRESAS[id]}, S.A.`, nit: "1111111-1", emision_real_habilitada: false }, rol: ses.u.empresas[id], permisos: permisos(ses.u, id) })), invitaciones_pendientes: [] } });
      const pe = permisos(ses.u, cuerpo.empresa_id);
      const necesitaAal2 = ["miembro_invitar", "miembro_actualizar", "invitacion_revocar", "mfa_recuperacion_listar", "mfa_recuperacion_aprobar", "mfa_recuperacion_rechazar"].includes(a);
      if (necesitaAal2 && ses.aal !== "aal2") return err(403, "Esta operación exige verificación en dos pasos (MFA)", "mfa_requerido");
      if (a === "miembros_listar") {
        if (!pe.includes("usuarios.ver")) return err(403, "No tienes permiso para esta operación", "no_autorizado");
        return json(route, 200, { ok: true, datos: { miembros: Object.entries(e.usuarios).filter(([, u]) => u.empresas[cuerpo.empresa_id]).map(([mail, u]) => ({ user_id: u.id, email: mail, nombre: null, rol: u.empresas[cuerpo.empresa_id], permisos_extra: u.extra?.[cuerpo.empresa_id] ?? [], permisos_revocados: u.quitados?.[cuerpo.empresa_id] ?? [], activo: true, cuenta: "activa", permisos_efectivos: permisos(u, cuerpo.empresa_id), creado_en: "2026-10-01T00:00:00Z" })) } });
      }
      if (a === "miembro_invitar") {
        if (!pe.includes("usuarios.gestionar")) return err(403, "No tienes permiso para esta operación", "no_autorizado");
        if (e.invitaciones[cuerpo.empresa_id].some((i) => i.email === cuerpo.email && i.estado === "pendiente")) return err(409, "Ya existe un registro con esos datos", "duplicado");
        e.invitaciones[cuerpo.empresa_id].unshift({ id: `i-${++e.n}`, empresa_id: cuerpo.empresa_id, email: cuerpo.email, rol: cuerpo.rol, estado: "pendiente", creado_en: "2026-11-10T09:00:00Z", expira_en: "2026-11-17T09:00:00Z" });
        e.ultimaAccion = `invitar:${cuerpo.empresa_id}:${cuerpo.email}`;
        return json(route, 200, { ok: true, datos: { invitacion_id: `i-${e.n}`, correo_enviado: true, aviso: null } });
      }
      if (a === "invitacion_revocar") {
        if (!pe.includes("usuarios.gestionar")) return err(403, "No tienes permiso para esta operación", "no_autorizado");
        const i = (e.invitaciones[cuerpo.empresa_id] ?? []).find((x) => x.id === cuerpo.invitacion_id && x.estado === "pendiente");
        if (!i) return err(404, "Invitación pendiente no encontrada", "no_encontrado");
        i.estado = "revocada"; return json(route, 200, { ok: true, datos: {} });
      }
      if (a === "miembro_actualizar") {
        if (!pe.includes("usuarios.gestionar")) return err(403, "No tienes permiso para esta operación", "no_autorizado");
        const obj = Object.values(e.usuarios).find((u) => u.id === cuerpo.user_id && u.empresas[cuerpo.empresa_id]);
        if (!obj) return err(404, "Miembro no encontrado", "no_encontrado");
        if (obj === ses.u) return err(403, "No puedes modificar tu propia membresía", "no_autorizado");
        const miRol = ses.u.empresas[cuerpo.empresa_id];
        if (miRol !== "propietario" && (RANGO[obj.empresas[cuerpo.empresa_id]] >= RANGO[miRol] || (cuerpo.rol && RANGO[cuerpo.rol] >= RANGO[miRol]))) return err(403, "No puedes modificar a un usuario de rol igual o superior", "no_autorizado");
        if ((cuerpo.permisos_extra ?? []).some((p) => !pe.includes(p))) return err(403, "No puedes conceder permisos que tú no tienes", "no_autorizado");
        if (cuerpo.rol) obj.empresas[cuerpo.empresa_id] = cuerpo.rol;
        obj.extra = { ...(obj.extra ?? {}), [cuerpo.empresa_id]: cuerpo.permisos_extra ?? [] }; obj.quitados = { ...(obj.quitados ?? {}), [cuerpo.empresa_id]: cuerpo.permisos_revocados ?? [] };
        e.ultimaAccion = `actualizar:${cuerpo.empresa_id}:${cuerpo.user_id}`;
        return json(route, 200, { ok: true, datos: { user_id: cuerpo.user_id } });
      }
      const resolutor = (s) => s.user !== ses.u && (ses.u.plataforma || Object.entries(ses.u.empresas).some(([emp2, r]) => r === "propietario" && s.user.empresas[emp2]));
      if (a === "mfa_recuperacion_listar") return json(route, 200, { ok: true, datos: { solicitudes: e.solicitudes.filter((s) => ["pendiente", "aprobada"].includes(s.estado) && resolutor(s)).map((s) => ({ id: s.id, user_id: s.user.id, email: correo(s.user), motivo: s.motivo, estado: s.estado, solicitada_en: s.solicitada_en })) } });
      if (a === "mfa_recuperacion_aprobar" || a === "mfa_recuperacion_rechazar") {
        const s = e.solicitudes.find((x) => x.id === cuerpo.solicitud_id);
        if (!s || !resolutor(s)) return err(403, "No puedes resolver esta solicitud", "no_autorizado");
        if (a === "mfa_recuperacion_rechazar") { s.estado = "rechazada"; return json(route, 200, { ok: true, datos: {} }); }
        if (String(cuerpo.verificacion ?? "").length < 20) return err(422, "Describe cómo verificaste la identidad", "regla");
        const n = s.user.factor ? 1 : 0; s.user.factor = null; s.estado = "ejecutada"; e.ultimaAccion = `mfa-recuperada:${s.user.id}`;
        return json(route, 200, { ok: true, datos: { factores_eliminados: n } });
      }
      if (ses.u.estado) return err(403, "Sin acceso", "sin_perfil");
      if (!pe.includes("clientes.escribir")) return err(403, "No tienes permiso para esta operación", "no_autorizado");
      return json(route, 200, { ok: true, datos: { cliente: CLIENTES["emp-1"][0] } });
    }
    return json(route, 404, {});
  }
  return e;
}
module.exports = { crear, URL_FALSA, ANON, CLAVE, CODIGO_OK };
