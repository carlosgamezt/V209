// Backend REAL: lecturas directas a Supabase con el JWT del usuario (la RLS decide qué ve) y escrituras por la Edge Function fel-api.
// La sesión vive solo en memoria (al recargar hay que iniciar sesión otra vez). No se guarda ninguna credencial en el navegador.
// Pendiente (no incluido en la Fase 1.1): verificación en dos pasos (MFA), necesaria solo para acciones administrativas.
import { ErrorApi } from "./api.js";

export function crearRemoto(config, fetchFn = (...a) => fetch(...a)) {
  const { supabaseUrl, anonKey } = config;
  const apiUrl = config.apiUrl ?? `${supabaseUrl}/functions/v1/fel-api`;
  let sesion = null; // { access_token, refresh_token, email }

  async function tokenRequest(grant, cuerpo) {
    const r = await fetchFn(`${supabaseUrl}/auth/v1/token?grant_type=${grant}`, { method: "POST", headers: { apikey: anonKey, "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new ErrorApi(grant === "password" ? "Correo o contraseña incorrectos." : "La sesión venció; inicia sesión de nuevo.", "sin_sesion", 401);
    sesion = { access_token: j.access_token, refresh_token: j.refresh_token, email: j.user?.email ?? sesion?.email };
  }

  async function con401(fn) {
    if (!sesion) throw new ErrorApi("Inicia sesión.", "sin_sesion", 401);
    let r = await fn();
    if (r.status === 401 && sesion.refresh_token) { await tokenRequest("refresh_token", { refresh_token: sesion.refresh_token }); r = await fn(); }
    return r;
  }
  const cab = () => ({ apikey: anonKey, authorization: `Bearer ${sesion.access_token}` });

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

  return {
    modo: "remoto",
    async iniciarSesion(email, password) { await tokenRequest("password", { email, password }); },
    cerrarSesion() { sesion = null; },
    haySesion: () => !!sesion,
    async sesion() {
      // Una cuenta nueva con invitación vigente la acepta aquí; si no tiene invitación, el servidor responde 403 y se sigue al paso siguiente.
      try { await accion("aceptar_invitacion"); } catch (e) { if (e.status !== 403) throw e; }
      return accion("yo");
    },
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
  };
}
