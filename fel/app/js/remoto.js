// Backend REAL: lecturas directas a Supabase con el JWT del usuario (la RLS decide qué ve) y escrituras por la Edge Function fel-api.
// La sesión vive solo en memoria (al recargar hay que iniciar sesión otra vez). No se guarda ninguna credencial en el navegador.
// Pendiente (no incluido en la Fase 1.1): verificación en dos pasos (MFA), necesaria solo para acciones administrativas.
import { ErrorApi } from "./api.js";

const CLAVE_RT = "fel.rt"; // única cosa que se guarda en el navegador: el token de renovación, en sessionStorage (se borra al cerrar la pestaña)
const RE_CODIGO = /^\d{6}$/;
const almacen = {
  leer() { try { return sessionStorage.getItem(CLAVE_RT); } catch { return null; } },
  guardar(v) { try { sessionStorage.setItem(CLAVE_RT, v); } catch { /* sin almacenamiento: la sesión no sobrevivirá a una recarga */ } },
  borrar() { try { sessionStorage.removeItem(CLAVE_RT); } catch { /* nada */ } },
};
function claims(jwt) { // solo para mostrar el nivel en pantalla; quien decide es el servidor
  try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; }
}

export function crearRemoto(config, fetchFn = (...a) => fetch(...a)) {
  const { supabaseUrl, anonKey } = config;
  const apiUrl = config.apiUrl ?? `${supabaseUrl}/functions/v1/fel-api`;
  // fase: anonimo → (mfa_pendiente) → autenticado. Solo "autenticado" puede leer o escribir datos.
  let fase = "anonimo", sesion = null, pendiente = null, temporizador = null, refrescando = null;
  const api = { modo: "remoto", alPerderSesion: null };

  const auth = async (ruta, { metodo = "POST", token, cuerpo } = {}) => {
    const r = await fetchFn(`${supabaseUrl}/auth/v1/${ruta}`, { method: metodo, headers: { apikey: anonKey, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  };
  const aSesion = (j, previo) => ({ access_token: j.access_token, refresh_token: j.refresh_token, email: j.user?.email ?? previo?.email,
    expira: Date.now() + (Number(j.expires_in) || 3600) * 1000, aal: claims(j.access_token).aal ?? "aal1" });

  async function pedirToken(grant, cuerpo) {
    const { r, j } = await auth(`token?grant_type=${grant}`, { cuerpo });
    if (r.status === 429) { const e = new ErrorApi("Demasiados intentos. Espera un momento.", "limite_excedido", 429); e.reintentarEn = Number(r.headers?.get?.("retry-after")) || undefined; throw e; }
    if (!r.ok || !j.access_token) throw new ErrorApi(grant === "password" ? "Correo o contraseña incorrectos." : "La sesión venció; inicia sesión de nuevo.", "sin_sesion", 401);
    return aSesion(j, sesion);
  }
  async function factoresVerificados(token) {
    const { r, j } = await auth("user", { metodo: "GET", token });
    if (!r.ok) throw new ErrorApi("No se pudo verificar la seguridad de tu cuenta. Intenta de nuevo.", "verificacion", 503);
    return (j.factors ?? []).filter((f) => f.factor_type === "totp" && f.status === "verified");
  }
  function olvidar() {
    clearTimeout(temporizador); temporizador = null; sesion = null; pendiente = null; fase = "anonimo"; almacen.borrar();
  }
  function confirmar(s) {
    sesion = s; pendiente = null; fase = "autenticado"; almacen.guardar(s.refresh_token);
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { refrescar().catch(() => {}); }, Math.max(5000, (s.expira - Date.now()) * 0.8));
  }
  // Renovación única aunque varias peticiones la pidan a la vez (el token de renovación rota: dos renovaciones simultáneas se pisarían).
  function refrescar() {
    if (!sesion?.refresh_token) return Promise.reject(new ErrorApi("Inicia sesión.", "sin_sesion", 401));
    refrescando ??= (async () => {
      try { confirmar(await pedirToken("refresh_token", { refresh_token: sesion.refresh_token })); }
      catch (e) { const habia = fase === "autenticado"; olvidar(); if (habia) api.alPerderSesion?.(); throw e; }
      finally { refrescando = null; }
    })();
    return refrescando;
  }
  async function vigente() {
    if (fase !== "autenticado") throw new ErrorApi("Inicia sesión.", "sin_sesion", 401);
    if (Date.now() > sesion.expira - 15000) await refrescar();
  }
  async function con401(fn) {
    await vigente();
    let r = await fn();
    if (r.status === 401) { await refrescar(); r = await fn(); }
    return r;
  }
  const cab = () => ({ apikey: anonKey, authorization: `Bearer ${sesion.access_token}` });

  async function desafiarYVerificar(factorId, codigo, token) {
    if (!RE_CODIGO.test(String(codigo ?? ""))) throw new ErrorApi("El código tiene 6 dígitos.", "entrada_invalida", 400);
    const c = await auth(`factors/${encodeURIComponent(factorId)}/challenge`, { token });
    if (c.r.status === 429) { const e = new ErrorApi("Demasiados intentos. Espera un momento.", "limite_excedido", 429); e.reintentarEn = Number(c.r.headers?.get?.("retry-after")) || undefined; throw e; }
    if (!c.r.ok || !c.j.id) throw new ErrorApi("No se pudo iniciar la verificación. Intenta de nuevo.", "verificacion", 503);
    const v = await auth(`factors/${encodeURIComponent(factorId)}/verify`, { token, cuerpo: { challenge_id: c.j.id, code: String(codigo) } });
    if (v.r.status === 429) { const e = new ErrorApi("Demasiados intentos. Espera un momento.", "limite_excedido", 429); e.reintentarEn = Number(v.r.headers?.get?.("retry-after")) || undefined; throw e; }
    if (!v.r.ok || !v.j.access_token) throw new ErrorApi("Código incorrecto o vencido.", "mfa_incorrecto", 400);
    return aSesion(v.j, sesion ?? pendiente?.sesion);
  }

  Object.assign(api, {
    fase: () => fase,
    haySesion: () => fase === "autenticado",
    // Paso 1: contraseña. Si la cuenta tiene TOTP verificado, NO se entra: queda pendiente del código (nada de datos hasta aal2).
    async iniciarSesion(email, password) {
      olvidar();
      const s = await pedirToken("password", { email, password });
      let totp;
      try { [totp] = await factoresVerificados(s.access_token); } catch (e) { olvidar(); throw e; }
      if (totp) { pendiente = { sesion: s, factorId: totp.id }; fase = "mfa_pendiente"; return { mfa: true }; }
      confirmar(s); return { mfa: false };
    },
    // Paso 2: código TOTP de 6 dígitos.
    async verificarMfa(codigo) {
      if (fase !== "mfa_pendiente" || !pendiente) throw new ErrorApi("Inicia sesión.", "sin_sesion", 401);
      confirmar(await desafiarYVerificar(pendiente.factorId, codigo, pendiente.sesion.access_token));
    },
    // Recuperación al recargar: renueva con el token guardado. Si la cuenta exige TOTP y la sesión no es aal2, no se recupera.
    async recuperarSesion() {
      const rt = almacen.leer();
      if (!rt) return false;
      try {
        const s = await pedirToken("refresh_token", { refresh_token: rt });
        const totp = await factoresVerificados(s.access_token);
        if (totp.length && s.aal !== "aal2") { almacen.borrar(); return false; }
        confirmar(s); return true;
      } catch { olvidar(); return false; }
    },
    async cerrarSesion() {
      const token = sesion?.access_token ?? pendiente?.sesion.access_token;
      olvidar();
      if (token) { try { await auth("logout?scope=local", { token }); } catch { /* el cierre local ya se hizo */ } }
    },
    async estadoMfa() {
      await vigente();
      const { r, j } = await auth("user", { metodo: "GET", token: sesion.access_token });
      if (!r.ok) throw new ErrorApi("No se pudo leer el estado de seguridad.", "verificacion", 503);
      return { aal: sesion.aal, factores: (j.factors ?? []).filter((f) => f.factor_type === "totp").map((f) => ({ id: f.id, verificado: f.status === "verified" })) };
    },
    async iniciarEnrolamientoTotp() {
      await vigente();
      const { r, j } = await auth("factors", { token: sesion.access_token, cuerpo: { factor_type: "totp", friendly_name: `NEXA FEL ${new Date().toISOString().slice(0, 16)}`, issuer: "NEXA FEL" } });
      if (!r.ok || !j.id || !j.totp) throw new ErrorApi("No se pudo iniciar la activación. Intenta de nuevo.", "verificacion", 503);
      const qr = typeof j.totp.qr_code === "string" && j.totp.qr_code.startsWith("data:image/svg+xml") ? j.totp.qr_code : null;
      return { factorId: j.id, qr, secreto: String(j.totp.secret ?? "") };
    },
    async confirmarEnrolamientoTotp(factorId, codigo) {
      await vigente();
      confirmar(await desafiarYVerificar(factorId, codigo, sesion.access_token));
    },
    async sesion() {
      // Una cuenta nueva con invitación vigente la acepta aquí; si no tiene invitación, el servidor responde 403 y se sigue al paso siguiente.
      try { await accion("aceptar_invitacion"); } catch (e) { if (e.status !== 403) throw e; }
      return accion("yo");
    },
  });

  async function leer(ruta, { uno = false } = {}) {
    const r = await con401(() => fetchFn(`${supabaseUrl}/rest/v1/${ruta}`, { headers: { ...cab(), ...(uno ? { accept: "application/vnd.pgrst.object+json" } : {}) } }));
    if (!r.ok) throw new ErrorApi(r.status === 406 ? "No encontrado." : "No se pudo leer la información.", r.status === 406 ? "no_encontrado" : "lectura", r.status === 406 ? 404 : r.status);
    return r.json();
  }
  async function accion(nombre, datos = {}) {
    const r = await con401(() => fetchFn(apiUrl, { method: "POST", headers: { ...cab(), "content-type": "application/json" }, body: JSON.stringify({ accion: nombre, ...datos }) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      const e = new ErrorApi(j.error ?? "No se pudo completar la operación.", j.codigo ?? "error", r.status);
      e.reintentarEn = Number(r.headers?.get?.("retry-after")) || undefined; throw e;
    }
    return j.datos;
  }
  const ilike = (q) => encodeURIComponent(`*${q.replace(/[,()*%]/g, " ").trim()}*`);
  const filtro = (e, { buscar = "", inactivos = false } = {}, cols) => {
    let f = `empresa_id=eq.${encodeURIComponent(e)}`;
    if (!inactivos) f += "&activo=eq.true";
    if (buscar.trim()) f += `&or=(${cols.map((c) => `${c}.ilike.${ilike(buscar)}`).join(",")})`;
    return f;
  };

  return Object.assign(api, {
    tiposIdentificacion: () => leer("identificaciones_tipos?select=codigo,nombre,verificado&activo=eq.true&order=codigo"),

    listarClientes: (e, o) => leer(`clientes?select=*&${filtro(e, o, ["nombre", "numero_identificacion", "email"])}&order=nombre.asc`),
    async guardarCliente(e, d) { return (await accion("cliente_guardar", { empresa_id: e, id: d.id ?? undefined, version: d.id ? d.version : undefined,
      tipo_identificacion: d.tipo_identificacion, numero_identificacion: d.numero_identificacion, nombre: d.nombre, direccion: d.direccion || undefined, email: d.email || undefined, telefono: d.telefono || undefined })).cliente; },
    estadoCliente: (e, id, activo) => accion("cliente_estado", { empresa_id: e, id, activo }),

    listarConceptos: (e, o) => leer(`conceptos?select=*&${filtro(e, o, ["codigo", "descripcion"])}&order=codigo.asc`),
    async guardarConcepto(e, d) { return (await accion("concepto_guardar", { empresa_id: e, id: d.id ?? undefined, version: d.id ? d.version : undefined,
      codigo: d.codigo, descripcion: d.descripcion, tipo: d.tipo, unidad_medida: d.unidad_medida || undefined, precio_unitario: d.precio_unitario, categoria_fiscal: d.categoria_fiscal || undefined })).concepto; },
    estadoConcepto: (e, id, activo) => accion("concepto_estado", { empresa_id: e, id, activo }),

    listarDocumentos: (e) => leer(`documentos?select=*&empresa_id=eq.${encodeURIComponent(e)}&order=numero_borrador.desc`),
    async obtenerDocumento(e, id) {
      const d = await leer(`documentos?select=*,documento_lineas(*)&id=eq.${encodeURIComponent(id)}&empresa_id=eq.${encodeURIComponent(e)}`, { uno: true });
      d.lineas = (d.documento_lineas ?? []).sort((a, b) => a.orden - b.orden); delete d.documento_lineas; return d;
    },
    async guardarDocumento(e, d) {
      const r = await accion("documento_guardar", { empresa_id: e, id: d.id ?? undefined, version: d.id ? d.version : undefined, cliente_id: d.cliente_id || undefined,
        fecha_emision_prevista: d.fecha_emision_prevista || undefined, observaciones: d.observaciones || undefined,
        lineas: d.lineas.map((l) => ({ concepto_id: l.concepto_id || undefined, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario,
          descuento_tipo: l.descuento_tipo, descuento_valor: l.descuento_valor })) });
      return r.documento;
    },
    cambiarPreparacion: (e, id, estado, motivo, version) => accion("documento_preparacion", { empresa_id: e, id, estado, motivo: motivo || undefined, version }),
  });
}
