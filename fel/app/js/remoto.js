// Backend REAL: lecturas directas a Supabase con el JWT del usuario (la RLS decide qué ve) y escrituras por la Edge Function fel-api.
// La sesión vive solo en memoria (al recargar hay que iniciar sesión otra vez). No se guarda ninguna credencial en el navegador.
// Pendiente (no incluido en la Fase 1.1): verificación en dos pasos (MFA), necesaria solo para acciones administrativas.
import { ErrorApi } from "./api.js";

// Lo ÚNICO que se guarda en el navegador (sessionStorage: se borra al cerrar la pestaña): el token de renovación y dos marcas de tiempo
// NO secretas (cuándo se autenticó la persona y cuándo fue su última actividad) para aplicar la duración máxima y la inactividad.
const CLAVE_RT = "fel.rt", CLAVE_T0 = "fel.t0", CLAVE_UA = "fel.ua";
const RE_CODIGO = /^\d{6}$/;
const almacen = {
  leer: (k = CLAVE_RT) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  guardar(v, k = CLAVE_RT) { try { sessionStorage.setItem(k, String(v)); } catch { /* sin almacenamiento: la sesión no sobrevivirá a una recarga */ } },
  borrar() { try { for (const k of [CLAVE_RT, CLAVE_T0, CLAVE_UA]) sessionStorage.removeItem(k); } catch { /* nada */ } },
};
const POLITICA_CLAVE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,72}$/; // igual que config.toml: 12+ con minúsculas, mayúsculas y dígitos
function claims(jwt) { // solo para mostrar el nivel en pantalla; quien decide es el servidor
  try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; }
}

export function crearRemoto(config, fetchFn = (...a) => fetch(...a)) {
  const { supabaseUrl, anonKey } = config;
  const apiUrl = config.apiUrl ?? `${supabaseUrl}/functions/v1/fel-api`;
  // fase: anonimo → (mfa_pendiente) → autenticado. Solo "autenticado" puede leer o escribir datos.
  const inactividadMs = Number(config.inactividadMs) || 30 * 60 * 1000;      // sin actividad: se cierra la sesión
  const duracionMaximaMs = Number(config.duracionMaximaMs) || 8 * 60 * 60 * 1000;   // desde que la persona se autenticó, como máximo
  let fase = "anonimo", sesion = null, pendiente = null, restablecer = null, temporizador = null, vigilante = null, refrescando = null, t0 = 0, ultima = 0, ultimaGuardada = 0;
  const api = { modo: "remoto", alPerderSesion: null, alCambiarPermisos: null, pedirCodigoMfa: null };

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
  const alActividad = () => { ultima = Date.now(); if (ultima - ultimaGuardada > 15000) { ultimaGuardada = ultima; almacen.guardar(ultima, CLAVE_UA); } };
  const EVENTOS = ["pointerdown", "keydown", "visibilitychange"];
  function olvidar() {
    clearTimeout(temporizador); clearInterval(vigilante); temporizador = vigilante = null; sesion = null; pendiente = null; restablecer = null; fase = "anonimo"; almacen.borrar();
    for (const e of EVENTOS) globalThis.removeEventListener?.(e, alActividad);
  }
  // Duración máxima e inactividad (cierre del lado del cliente: el límite REAL lo fija el servidor, ver docs/seguridad-sesion.md)
  function vigilar() {
    clearInterval(vigilante);
    vigilante = setInterval(async () => {
      if (fase !== "autenticado") return;
      const ahora = Date.now();
      const motivo = ahora - t0 > duracionMaximaMs ? "Tu sesión alcanzó su duración máxima. Inicia sesión de nuevo." : ahora - ultima > inactividadMs ? "Cerraste sesión por inactividad." : null;
      if (motivo) { await api.cerrarSesion(); api.alPerderSesion?.(motivo); }
    }, Math.min(30000, Math.max(200, Math.floor(Math.min(inactividadMs, duracionMaximaMs) / 4))));
  }
  function confirmar(s, { nueva = true } = {}) {
    sesion = s; pendiente = null; fase = "autenticado"; almacen.guardar(s.refresh_token);
    if (nueva) { t0 = Date.now(); almacen.guardar(t0, CLAVE_T0); }   // la duración máxima cuenta desde la AUTENTICACIÓN, no desde cada renovación
    ultima = ultimaGuardada = Date.now(); almacen.guardar(ultima, CLAVE_UA);
    for (const e of EVENTOS) globalThis.addEventListener?.(e, alActividad);
    vigilar();
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { refrescar().catch(() => {}); }, Math.max(5000, (s.expira - Date.now()) * 0.8));
  }
  // Renovación única aunque varias peticiones la pidan a la vez (el token de renovación rota: dos renovaciones simultáneas se pisarían).
  function refrescar() {
    if (!sesion?.refresh_token) return Promise.reject(new ErrorApi("Inicia sesión.", "sin_sesion", 401));
    refrescando ??= (async () => {
      try { confirmar(await pedirToken("refresh_token", { refresh_token: sesion.refresh_token }), { nueva: false }); }
      catch (e) { const habia = fase === "autenticado"; olvidar(); if (habia) api.alPerderSesion?.(); throw e; }
      finally { refrescando = null; }
    })();
    return refrescando;
  }
  async function vigente() {
    if (fase !== "autenticado") throw new ErrorApi("Inicia sesión.", "sin_sesion", 401);
    if (Date.now() > sesion.expira - 15000) await refrescar();
  }
  // 401: se renueva el token y se reintenta UNA vez. Si sigue siendo 401 (p. ej. la sesión fue revocada tras recuperar el MFA: renovar un
  // token viejo no crea una autenticación nueva), se cierra la sesión y se pide iniciar sesión de nuevo.
  async function con401(fn) {
    await vigente();
    let r = await fn();
    if (r.status === 401) {
      await refrescar();
      r = await fn();
      if (r.status === 401) {
        await api.cerrarSesion(); api.alPerderSesion?.("Tu sesión fue revocada o venció. Inicia sesión de nuevo.");
        throw new ErrorApi("Tu sesión fue revocada o venció.", "sin_sesion", 401);
      }
    }
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
      const antes = Number(almacen.leer(CLAVE_T0)), ua = Number(almacen.leer(CLAVE_UA)), ahora = Date.now();
      if (!antes || !ua || ahora - antes > duracionMaximaMs || ahora - ua > inactividadMs) { almacen.borrar(); return false; }   // sin marcas o vencidas: no se recupera
      t0 = antes;
      try {
        const s = await pedirToken("refresh_token", { refresh_token: rt });
        const totp = await factoresVerificados(s.access_token);
        if (totp.length && s.aal !== "aal2") { almacen.borrar(); return false; }
        confirmar(s, { nueva: false }); return true;
      } catch { olvidar(); return false; }
    },
    async cerrarSesion() {
      const token = sesion?.access_token ?? pendiente?.sesion.access_token ?? restablecer?.sesion.access_token;
      olvidar();
      if (token) { try { await auth("logout?scope=local", { token }); } catch { /* el cierre local ya se hizo */ } }
    },
    // Paso intermedio: confirma de nuevo el TOTP con la sesión actual y obtiene tokens con un evento TOTP reciente (sin ampliar la duración máxima).
    async reautenticarMfa(codigo) {
      await vigente();
      const { r, j } = await auth("user", { metodo: "GET", token: sesion.access_token });
      const totp = r.ok ? (j.factors ?? []).find((f) => f.factor_type === "totp" && f.status === "verified") : null;
      if (!totp) throw new ErrorApi("Esta cuenta no tiene verificación en dos pasos activa.", "mfa_requerido", 403);
      confirmar(await desafiarYVerificar(totp.id, codigo, sesion.access_token), { nueva: false });
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
      confirmar(await desafiarYVerificar(factorId, codigo, sesion.access_token), { nueva: false });
    },
    async sesion() {
      // Una cuenta nueva con invitación vigente la acepta aquí; si no tiene invitación, el servidor responde 403 y se sigue al paso siguiente.
      try { await accion("aceptar_invitacion", {}, { silencioso: true }); } catch (e) { if (e.status !== 403) throw e; }
      return accion("yo", {}, { silencioso: true });
    },
    // Revalida el acceso (al cambiar de pantalla o volver a la pestaña): un bloqueo o un cambio de permisos se nota en seguida.
    revalidar: () => accion("yo"),

    // ---------------- recuperación de contraseña (Supabase Auth: correo con enlace → nueva contraseña)
    // La respuesta es SIEMPRE la misma exista o no la cuenta (no se revela quién tiene cuenta).
    async solicitarRestablecimiento(email) {
      const destino = config.urlRetorno ?? (globalThis.location ? globalThis.location.origin + globalThis.location.pathname : "");
      const { r } = await auth(`recover?redirect_to=${encodeURIComponent(destino)}`, { cuerpo: { email } });
      if (r.status === 429) { const e = new ErrorApi("Ya pediste un enlace hace poco. Espera unos minutos.", "limite_excedido", 429); e.reintentarEn = Number(r.headers?.get?.("retry-after")) || undefined; throw e; }
    },
    // Llega con el enlace del correo (recuperación o invitación). Esta sesión NO sirve para entrar: solo para fijar la contraseña.
    // Si la cuenta tiene TOTP, primero hay que dar el código (Supabase exige aal2 para cambiar la contraseña con MFA activo).
    async iniciarRestablecimiento({ access_token, refresh_token }) {
      olvidar();
      const s = aSesion({ access_token, refresh_token, expires_in: 3600 });
      const [totp] = await factoresVerificados(access_token).catch(() => { throw new ErrorApi("El enlace venció o no es válido. Pide uno nuevo.", "enlace", 401); });
      restablecer = { sesion: s, factorId: totp?.id ?? null };
      return { requiereMfa: !!totp && s.aal !== "aal2" };
    },
    async verificarMfaRestablecimiento(codigo) {
      if (!restablecer?.factorId) throw new ErrorApi("El enlace venció; pide uno nuevo.", "enlace", 401);
      restablecer.sesion = await desafiarYVerificar(restablecer.factorId, codigo, restablecer.sesion.access_token);
    },
    async fijarContrasena(nueva) {
      if (!restablecer) throw new ErrorApi("El enlace venció; pide uno nuevo.", "enlace", 401);
      if (!POLITICA_CLAVE.test(nueva)) throw new ErrorApi("La contraseña necesita 12 caracteres o más, con mayúsculas, minúsculas y números.", "entrada_invalida", 400);
      const { r, j } = await auth("user", { metodo: "PUT", token: restablecer.sesion.access_token, cuerpo: { password: nueva } });
      if (!r.ok) {
        const e = new ErrorApi(/aal/i.test(`${j.error_code ?? ""} ${j.msg ?? ""}`) ? "Falta verificar el código de tu app autenticadora." : "No se pudo cambiar la contraseña. Puede que el enlace haya vencido, que sea débil o igual a la anterior.", "contrasena", r.status);
        throw e;
      }
      const token = restablecer.sesion.access_token; restablecer = null;
      try { await auth("logout?scope=local", { token }); } catch { /* el enlace de un solo uso ya no sirve */ }
    },
    // Pérdida del dispositivo TOTP: se registra una SOLICITUD. No cambia nada del MFA: la aprueba otra persona tras verificar la identidad.
    async solicitarRecuperacionMfa(motivo) {
      const token = pendiente?.sesion.access_token ?? restablecer?.sesion.access_token ?? sesion?.access_token;
      if (!token) throw new ErrorApi("Inicia sesión.", "sin_sesion", 401);
      const r = await fetchFn(apiUrl, { method: "POST", headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ accion: "mfa_recuperacion_solicitar", motivo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) { const e = new ErrorApi(j.error ?? "No se pudo registrar la solicitud.", j.codigo ?? "error", r.status); e.reintentarEn = Number(r.headers?.get?.("retry-after")) || undefined; throw e; }
    },
  });

  async function leer(ruta, { uno = false } = {}) {
    const r = await con401(() => fetchFn(`${supabaseUrl}/rest/v1/${ruta}`, { headers: { ...cab(), ...(uno ? { accept: "application/vnd.pgrst.object+json" } : {}) } }));
    if (!r.ok) throw new ErrorApi(r.status === 406 ? "No encontrado." : "No se pudo leer la información.", r.status === 406 ? "no_encontrado" : "lectura", r.status === 406 ? 404 : r.status);
    return r.json();
  }
  // silencioso: no reaccionar a un 403 (se usa durante el arranque, donde el 403 es una respuesta esperada)
  async function accion(nombre, datos = {}, { silencioso = false, reintento = false } = {}) {
    const r = await con401(() => fetchFn(apiUrl, { method: "POST", headers: { ...cab(), "content-type": "application/json" }, body: JSON.stringify({ accion: nombre, ...datos }) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      const e = new ErrorApi(j.error ?? "No se pudo completar la operación.", j.codigo ?? "error", r.status);
      e.reintentarEn = Number(r.headers?.get?.("retry-after")) || undefined;
      // Acción sensible con un código TOTP antiguo: se pide confirmar el código de nuevo (paso intermedio) y se reintenta UNA vez.
      if (r.status === 403 && e.codigo === "mfa_reciente" && !reintento && api.pedirCodigoMfa) {
        const ok = await api.pedirCodigoMfa((c) => api.reautenticarMfa(c));
        if (ok) return accion(nombre, datos, { silencioso, reintento: true });
      }
      if (!silencioso && r.status === 403) {
        // Acceso revocado o cambiado mientras la persona trabajaba: cuenta bloqueada / sin perfil = fuera; permisos distintos = se recargan
        if (e.codigo === "cuenta_desactivada" || e.codigo === "sin_perfil") { await api.cerrarSesion(); api.alPerderSesion?.("Tu acceso fue revocado. Contacta a tu administrador."); }
        else if (e.codigo === "no_autorizado") api.alCambiarPermisos?.();
      }
      throw e;
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
    // ---------------- usuarios, invitaciones a la empresa, roles y permisos (siempre de LA empresa indicada; la RLS y la API lo vuelven a imponer)
    async listarMiembros(e) { return (await accion("miembros_listar", { empresa_id: e })).miembros; },
    listarInvitaciones: (e) => leer(`invitaciones?select=*&empresa_id=eq.${encodeURIComponent(e)}&order=creado_en.desc`),
    async listarRolesPermisos() {
      const [catalogo, rp] = await Promise.all([leer("permisos_catalogo?select=*&order=codigo.asc"), leer("rol_permisos?select=*")]);
      const roles = { propietario: [], administrador: [], emisor: [], lector: [] };
      for (const x of rp) roles[x.rol]?.push(x.permiso);
      return { catalogo, roles };
    },
    invitarMiembro: (e, d) => accion("miembro_invitar", { empresa_id: e, email: d.email, rol: d.rol, permisos_extra: d.permisos_extra ?? [] }),
    revocarInvitacion: (e, id) => accion("invitacion_revocar", { empresa_id: e, invitacion_id: id }),
    actualizarMiembro: (e, userId, c) => accion("miembro_actualizar", { empresa_id: e, user_id: userId, ...c }),
    async listarSolicitudesMfa() { return (await accion("mfa_recuperacion_listar")).solicitudes; },
    aprobarSolicitudMfa: (id, verificacion) => accion("mfa_recuperacion_aprobar", { solicitud_id: id, verificacion }),
    rechazarSolicitudMfa: (id, motivo) => accion("mfa_recuperacion_rechazar", { solicitud_id: id, motivo }),

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
