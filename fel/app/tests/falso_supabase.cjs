// Supabase FALSO para probar la interfaz en modo remoto: Auth (contraseña, TOTP, renovación, cierre), PostgREST y la Edge Function.
// Sin red real, sin credenciales reales: intercepta las peticiones del navegador. Imita las reglas del servidor (cuenta sin perfil,
// bloqueada, rol lector, nivel aal1/aal2, token vencido) para comprobar cómo reacciona la interfaz.
const URL_FALSA = "https://fel-test.supabase.co";
const ANON = "anon-de-prueba";
const CLAVE = "Clave-Segura-123";
const CODIGO_OK = "123456";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function crear() {
  const e = {
    expiresIn: 3600, limitarMfa: false, log: [], violaciones: [], sesiones: new Map(), refrescos: new Map(), n: 0,
    usuarios: {
      "propietario@fel.test": { id: "u-prop", rol: "propietario", factor: null },
      "lector@fel.test": { id: "u-lect", rol: "lector", factor: null },
      "mfa@fel.test": { id: "u-mfa", rol: "propietario", factor: { id: "f-1", verificado: true } },
      "maestro@fel.test": { id: "u-mae", rol: "propietario", plataforma: true, factor: { id: "f-2", verificado: true } },
      "nuevo@fel.test": { id: "u-nue", estado: "sin_perfil" },
      "bloqueado@fel.test": { id: "u-blo", estado: "bloqueada" },
    },
  };
  const porId = (id) => Object.values(e.usuarios).find((u) => u.id === id);
  const correo = (u) => Object.keys(e.usuarios).find((k) => e.usuarios[k] === u);
  const jwt = (u, aal) => `${b64({ alg: "HS256" })}.${b64({ sub: u.id, aal, exp: Math.floor(Date.now() / 1000) + e.expiresIn })}.firma-falsa`;
  e.nuevaSesion = (u, aal) => {
    const n = ++e.n, access = jwt(u, aal) + `.${n}`, refresh = `rt-${u.id}-${n}`;
    e.sesiones.set(access, { u, aal, vencido: false }); e.refrescos.set(refresh, { u, aal });
    return { access_token: access, refresh_token: refresh, expires_in: e.expiresIn, user: { email: correo(u) } };
  };
  e.vencer = (access) => { const s = e.sesiones.get(access); if (s) s.vencido = true; };
  e.revocarRefrescos = () => e.refrescos.clear();
  e.sembrarRefresco = (email, aal) => { const u = e.usuarios[email]; const rt = `rt-sembrado-${++e.n}`; e.refrescos.set(rt, { u, aal }); return rt; };
  e.cuenta = (u) => u.estado ?? "activa";

  const cab = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "retry-after", "content-type": "application/json" };
  const json = (route, status, cuerpo, extra = {}) => route.fulfill({ status, headers: { ...cab, ...extra }, body: JSON.stringify(cuerpo) });

  const CLIENTES = [{ id: "c1", empresa_id: "emp-1", tipo_identificacion: "NIT", numero_identificacion: "1234567-8", nombre: "Comercial Los Pinos, S.A.", direccion: null, email: null, telefono: null, activo: true, version: 1 },
    { id: "c2", empresa_id: "emp-1", tipo_identificacion: "CF", numero_identificacion: "CF", nombre: "Consumidor final", direccion: null, email: null, telefono: null, activo: true, version: 1 }];
  const CONCEPTOS = [{ id: "k1", empresa_id: "emp-1", codigo: "SRV-001", descripcion: "Consultoría", tipo: "servicio", unidad_medida: "SRV", precio_unitario: "250.00", categoria_fiscal: null, activo: true, version: 1 }];

  e.instalar = async (ctx, base) => {
    await ctx.route("**/config.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: `window.FEL_CONFIG = { modo: "remoto", supabaseUrl: "${URL_FALSA}", anonKey: "${ANON}" };` }));
    // todo lo que no sea el servidor local ni Supabase falso se corta y se registra como violación (excepto las fuentes de Google)
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
        if (!u || cuerpo.password !== CLAVE) return json(route, 400, { error: "invalid_grant" });
        return json(route, 200, e.nuevaSesion(u, "aal1"));
      }
      if (g === "refresh_token") {
        const r = e.refrescos.get(cuerpo.refresh_token);
        if (!r) return json(route, 400, { error: "invalid_grant" });
        e.refrescos.delete(cuerpo.refresh_token);
        return json(route, 200, e.nuevaSesion(r.u, r.aal));
      }
    }
    if (ruta === "/auth/v1/user" && m === "GET") {
      if (!valida) return json(route, 401, { msg: "token inválido" });
      const f = ses.u.factor;
      return json(route, 200, { id: ses.u.id, email: correo(ses.u), factors: f ? [{ id: f.id, factor_type: "totp", status: f.verificado ? "verified" : "unverified" }] : [] });
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

    // ---------------- datos (PostgREST con RLS) y Edge Function
    if (!valida) return json(route, 401, { message: "JWT expirado" });
    if (ses.u.estado) return json(route, ruta.startsWith("/rest/") ? 200 : 403, ruta.startsWith("/rest/") ? [] : { ok: false, error: ses.u.estado === "bloqueada" ? "La cuenta está desactivada" : "Tu cuenta todavía no tiene acceso a NEXA FEL; necesitas una invitación vigente", codigo: ses.u.estado === "bloqueada" ? "cuenta_desactivada" : "sin_perfil" });
    if (ruta === "/rest/v1/clientes") return json(route, 200, CLIENTES);
    if (ruta === "/rest/v1/conceptos") return json(route, 200, CONCEPTOS);
    if (ruta === "/rest/v1/documentos") return json(route, 200, []);
    if (ruta === "/rest/v1/identificaciones_tipos") return json(route, 200, [{ codigo: "NIT", nombre: "NIT", verificado: false }, { codigo: "CF", nombre: "CF", verificado: false }]);
    if (ruta === "/functions/v1/fel-api") {
      const a = cuerpo.accion;
      if (a === "aceptar_invitacion") return json(route, ses.u.estado ? 403 : 200, ses.u.estado ? { ok: false, error: "No tienes una invitación vigente", codigo: "no_autorizado" } : { ok: true, datos: { aceptadas: 0 } });
      if (a === "yo") return json(route, 200, { ok: true, datos: { usuario: { id: ses.u.id, email: correo(ses.u) }, plataforma: !!ses.u.plataforma, mfa: ses.aal,
        empresas: [{ empresa: { id: "emp-1", nombre_comercial: "Distribuidora Prueba", razon_social: "Distribuidora Prueba, S.A.", nit: "1111111-1", emision_real_habilitada: false }, rol: ses.u.rol,
          permisos: ses.u.rol === "lector" ? ["empresa.ver", "clientes.ver", "conceptos.ver", "borradores.ver", "historial.ver"] : ["empresa.ver", "clientes.ver", "clientes.escribir", "conceptos.ver", "conceptos.escribir", "borradores.ver", "borradores.crear", "borradores.editar", "borradores.revisar", "borradores.archivar", "historial.ver"] }], invitaciones_pendientes: [] } });
      if (ses.u.rol === "lector") return json(route, 403, { ok: false, error: "No tienes permiso para esta operación", codigo: "no_autorizado" });
      return json(route, 200, { ok: true, datos: { cliente: CLIENTES[0] } });
    }
    return json(route, 404, {});
  }
  return e;
}
module.exports = { crear, URL_FALSA, ANON, CLAVE, CODIGO_OK };
