// Acciones de la Fase 1.0. La API valida entradas y permisos; la base de datos vuelve a validar y deja la auditoría
// en la misma transacción (funciones fel_admin_* y fel_op_*).
import { ErrorFel, traducirErrorPg } from "./lib/errores.ts";
import * as v from "./lib/validacion.ts";
import { calcular, type LineaEntrada } from "./lib/calculo.ts";
import type { Acciones, Contexto } from "./nucleo.ts";

// Candado de código: mientras sea false, la API jamás pide habilitar la emisión real, sin importar la configuración.
// Cambiarlo exige modificar el código Y la prueba que lo vigila, y además se necesita abrir el interruptor de la base de datos.
export const EMISION_REAL_DISPONIBLE = false as boolean;

const ROLES = ["propietario", "administrador", "emisor", "lector"] as const;

async function rpc(ctx: Contexto, nombre: string, args: Record<string, unknown>) {
  const { data, error } = await ctx.admin.rpc(nombre, args);
  if (error) throw traducirErrorPg(error);
  return data;
}

// Invitación NATIVA de Supabase Auth (sin tokens propios). Si la persona ya tiene cuenta, verá la invitación al iniciar sesión.
async function enviarInvitacion(ctx: Contexto, correo: string): Promise<{ enviado: boolean; aviso?: string }> {
  const { error } = await ctx.admin.auth.admin.inviteUserByEmail(correo, { redirectTo: ctx.config.appUrl });
  if (!error) return { enviado: true };
  if (/already|registered|exists/i.test(error.message ?? "")) {
    return { enviado: false, aviso: "La persona ya tiene cuenta: verá la invitación al iniciar sesión" };
  }
  throw new ErrorFel(502, "No se pudo enviar el correo de invitación", "invitacion");
}

export const acciones: Acciones = {
  // ------------------------------------------------------------ cualquier usuario con sesión
  yo: {
    limite: "sesion",
    requisito: {},
    validar: (b) => { v.soloCampos(b, []); return {}; },
    async ejecutar(ctx) {
      const u = ctx.usuario;
      const esPlataforma = await ctx.esPlataforma(u.id);
      const { data: ms, error } = await ctx.admin.from("miembros")
        .select("empresa_id, rol, activo, empresas(id, nombre_comercial, razon_social, nit, estado, regimen_id, emision_real_habilitada)")
        .eq("user_id", u.id).eq("activo", true);
      if (error) throw traducirErrorPg(error);
      const empresas = [];
      for (const m of ms ?? []) {
        empresas.push({ empresa: m.empresas, rol: m.rol, permisos: await ctx.permisos(m.empresa_id, u.id) });
      }
      const { data: inv } = await ctx.admin.from("invitaciones").select("id, empresa_id, rol, expira_en")
        .eq("email", u.email.toLowerCase()).eq("estado", "pendiente").gt("expira_en", new Date().toISOString());
      return { usuario: { id: u.id, email: u.email }, plataforma: esPlataforma, mfa: ctx.aal ?? null, empresas, invitaciones_pendientes: inv ?? [] };
    },
  },

  aceptar_invitacion: {
    limite: "gestion_usuarios",
    permiteSinPerfil: true,
    requisito: {},
    validar: (b) => { v.soloCampos(b, []); return {}; },
    async ejecutar(ctx) {
      const n = await rpc(ctx, "fel_op_invitacion_aceptar", { p_user: ctx.usuario.id, p_email: ctx.usuario.email });
      return { aceptadas: n };
    },
  },

  // ------------------------------------------------------------ administrador maestro (MFA obligatorio)
  empresa_crear: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => {
      v.soloCampos(b, ["nombre_comercial", "razon_social", "nit", "regimen_codigo", "propietario_email"]);
      return {
        nombre_comercial: v.texto(b, "nombre_comercial", 2, 150), razon_social: v.texto(b, "razon_social", 2, 200),
        nit: v.numeroIdentificacion(b, "nit"), regimen_codigo: v.texto(b, "regimen_codigo", 3, 41), propietario_email: v.email(b, "propietario_email"),
      };
    },
    async ejecutar(ctx, p) {
      const { data: reg } = await ctx.admin.from("regimenes_fiscales").select("id").eq("codigo", p.regimen_codigo)
        .neq("estado", "obsoleto").order("version", { ascending: false }).limit(1).maybeSingle();
      if (!reg) throw new ErrorFel(404, "Régimen no encontrado", "no_encontrado");
      const empresaId = await rpc(ctx, "fel_admin_empresa_crear", {
        p_actor: ctx.usuario.id, p_nombre_comercial: p.nombre_comercial, p_razon_social: p.razon_social, p_nit: p.nit, p_regimen_id: reg.id });
      const invitacionId = await rpc(ctx, "fel_admin_invitar_propietario", { p_actor: ctx.usuario.id, p_empresa: empresaId, p_email: p.propietario_email });
      const envio = await enviarInvitacion(ctx, p.propietario_email);
      return { empresa_id: empresaId, invitacion_id: invitacionId, correo_enviado: envio.enviado, aviso: envio.aviso ?? null };
    },
  },

  empresa_habilitar: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => { v.soloCampos(b, ["empresa_id", "motivo"]); return { empresa_id: v.uuid(b, "empresa_id"), motivo: v.texto(b, "motivo", 5, 500) }; },
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_admin_empresa_estado", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_estado: "habilitada", p_motivo: p.motivo });
      return { empresa_id: p.empresa_id, estado: "habilitada" };
    },
  },

  empresa_suspender: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => { v.soloCampos(b, ["empresa_id", "motivo"]); return { empresa_id: v.uuid(b, "empresa_id"), motivo: v.texto(b, "motivo", 5, 500) }; },
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_admin_empresa_estado", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_estado: "suspendida", p_motivo: p.motivo });
      return { empresa_id: p.empresa_id, estado: "suspendida" };
    },
  },

  // Cambios fiscales críticos: administrador maestro + MFA + motivo obligatorio + auditoría.
  empresa_asignar_regimen: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => {
      v.soloCampos(b, ["empresa_id", "regimen_id", "motivo"]);
      return { empresa_id: v.uuid(b, "empresa_id"), regimen_id: v.uuid(b, "regimen_id"), motivo: v.texto(b, "motivo", 5, 500) };
    },
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_admin_empresa_regimen", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_regimen: p.regimen_id, p_motivo: p.motivo });
      return { empresa_id: p.empresa_id, regimen_id: p.regimen_id };
    },
  },

  regimen_crear_version: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => {
      v.soloCampos(b, ["codigo", "nombre", "reglas", "fuente", "vigente_desde"]);
      const desde = v.textoOpt(b, "vigente_desde", 10);
      if (desde !== null && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new ErrorFel(400, "vigente_desde: usa el formato AAAA-MM-DD", "entrada_invalida");
      return { codigo: v.texto(b, "codigo", 3, 41), nombre: v.texto(b, "nombre", 3, 120), reglas: v.objeto(b, "reglas"), fuente: v.textoOpt(b, "fuente", 500), vigente_desde: desde };
    },
    async ejecutar(ctx, p) {
      const id = await rpc(ctx, "fel_admin_regimen_crear_version", {
        p_actor: ctx.usuario.id, p_codigo: p.codigo, p_nombre: p.nombre, p_reglas: p.reglas, p_fuente: p.fuente, p_vigente_desde: p.vigente_desde });
      return { regimen_id: id, estado: "sin_verificar" };
    },
  },

  regimen_verificar: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => {
      v.soloCampos(b, ["regimen_id", "referencia", "motivo"]);
      return { regimen_id: v.uuid(b, "regimen_id"), referencia: v.texto(b, "referencia", 5, 500), motivo: v.texto(b, "motivo", 5, 500) };
    },
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_admin_regimen_verificar", { p_actor: ctx.usuario.id, p_regimen: p.regimen_id, p_referencia: p.referencia, p_motivo: p.motivo });
      return { regimen_id: p.regimen_id, estado: "verificado" };
    },
  },

  emision_real_habilitar: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => { v.soloCampos(b, ["empresa_id", "motivo"]); return { empresa_id: v.uuid(b, "empresa_id"), motivo: v.texto(b, "motivo", 5, 500) }; },
    async ejecutar(ctx, p) {
      if (!EMISION_REAL_DISPONIBLE || !ctx.config.emisionRealPermitida) {
        throw new ErrorFel(403, "La emisión real no está disponible en esta versión de NEXA FEL", "no_disponible");
      }
      await rpc(ctx, "fel_admin_emision", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_habilitar: true, p_motivo: p.motivo });
      return { empresa_id: p.empresa_id, emision_real_habilitada: true };
    },
  },

  emision_real_deshabilitar: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => { v.soloCampos(b, ["empresa_id", "motivo"]); return { empresa_id: v.uuid(b, "empresa_id"), motivo: v.texto(b, "motivo", 5, 500) }; },
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_admin_emision", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_habilitar: false, p_motivo: p.motivo });
      return { empresa_id: p.empresa_id, emision_real_habilitada: false };
    },
  },

  // ------------------------------------------------------------ usuarios de la empresa
  miembro_invitar: {
    limite: "invitacion_envio",
    requisito: { permiso: "usuarios.gestionar", aal2: true },
    validar: (b) => {
      v.soloCampos(b, ["empresa_id", "email", "rol", "permisos_extra"]);
      return { empresa_id: v.uuid(b, "empresa_id"), email: v.email(b, "email"), rol: v.enumerado(b, "rol", ROLES), permisos_extra: v.listaPermisos(b, "permisos_extra") ?? [] };
    },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      const invitacionId = await rpc(ctx, "fel_op_invitacion_registrar", {
        p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_email: p.email, p_rol: p.rol, p_permisos_extra: p.permisos_extra });
      try {
        const envio = await enviarInvitacion(ctx, p.email);
        return { invitacion_id: invitacionId, correo_enviado: envio.enviado, aviso: envio.aviso ?? null };
      } catch (e) {
        await rpc(ctx, "fel_op_invitacion_revocar", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_invitacion: invitacionId });
        throw e;
      }
    },
  },

  invitacion_revocar: {
    limite: "gestion_usuarios",
    requisito: { permiso: "usuarios.gestionar", aal2: true },
    validar: (b) => { v.soloCampos(b, ["empresa_id", "invitacion_id"]); return { empresa_id: v.uuid(b, "empresa_id"), invitacion_id: v.uuid(b, "invitacion_id") }; },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_op_invitacion_revocar", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_invitacion: p.invitacion_id });
      return { invitacion_id: p.invitacion_id, estado: "revocada" };
    },
  },

  miembro_actualizar: {
    limite: "gestion_usuarios",
    requisito: { permiso: "usuarios.gestionar", aal2: true },
    validar: (b) => {
      v.soloCampos(b, ["empresa_id", "user_id", "rol", "permisos_extra", "permisos_revocados", "activo"]);
      const rol = b.rol === undefined || b.rol === null ? null : v.enumerado(b, "rol", ROLES);
      return {
        empresa_id: v.uuid(b, "empresa_id"), user_id: v.uuid(b, "user_id"), rol,
        permisos_extra: v.listaPermisos(b, "permisos_extra"), permisos_revocados: v.listaPermisos(b, "permisos_revocados"), activo: v.booleanoOpt(b, "activo"),
      };
    },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_op_miembro_actualizar", {
        p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_user: p.user_id, p_rol: p.rol,
        p_permisos_extra: p.permisos_extra, p_permisos_revocados: p.permisos_revocados, p_activo: p.activo });
      return { user_id: p.user_id };
    },
  },

  // ------------------------------------------------------------ usuarios de la empresa: lista con correo (solo 'usuarios.ver')
  miembros_listar: {
    limite: "lectura",
    requisito: { permiso: "usuarios.ver" },
    validar: (b) => { v.soloCampos(b, ["empresa_id"]); return { empresa_id: v.uuid(b, "empresa_id") }; },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      return { miembros: await rpc(ctx, "fel_op_miembros_listar", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id }) };
    },
  },

  // ------------------------------------------------------------ administradores maestros ADICIONALES: autorización (la emite un maestro con aal2)
  // El primer maestro y la incorporación de un adicional se hacen en la consola SQL (no por la API); aquí solo se AUTORIZA.
  maestro_autorizar: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => { v.soloCampos(b, ["email", "motivo"]); return { email: v.email(b, "email"), motivo: v.texto(b, "motivo", 10, 500) }; },
    async ejecutar(ctx, p) {
      const id = await rpc(ctx, "fel_admin_maestro_autorizar", { p_actor: ctx.usuario.id, p_email: p.email, p_motivo: p.motivo });
      return { autorizacion_id: id, vence_en_horas: 24 };
    },
  },
  maestro_autorizacion_revocar: {
    limite: "admin",
    requisito: { plataforma: true, aal2: true },
    validar: (b) => { v.soloCampos(b, ["autorizacion_id"]); return { autorizacion_id: v.uuid(b, "autorizacion_id") }; },
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_admin_maestro_revocar_autorizacion", { p_actor: ctx.usuario.id, p_id: p.autorizacion_id });
      return { autorizacion_id: p.autorizacion_id, estado: "revocada" };
    },
  },

  // ------------------------------------------------------------ recuperación del acceso cuando se pierde el dispositivo TOTP
  // Solicitar: cualquier cuenta ACTIVA, incluso con sesión aal1 (aún no pudo dar el código). NO cambia nada del MFA.
  mfa_recuperacion_solicitar: {
    limite: "recuperacion",
    requisito: {},
    validar: (b) => { v.soloCampos(b, ["motivo"]); return { motivo: v.texto(b, "motivo", 10, 500) }; },
    async ejecutar(ctx, p) {
      const id = await rpc(ctx, "fel_op_mfa_recuperacion_solicitar", { p_user: ctx.usuario.id, p_motivo: p.motivo });
      return { solicitud_id: id };
    },
  },
  // Resolver (listar/aprobar/rechazar): exige aal2 de quien resuelve; la base decide si puede (maestro, o propietario de una empresa compartida; nunca la propia).
  mfa_recuperacion_listar: {
    limite: "lectura",
    requisito: { aal2: true },
    validar: (b) => { v.soloCampos(b, []); return {}; },
    async ejecutar(ctx) { return { solicitudes: await rpc(ctx, "fel_op_mfa_recuperacion_listar", { p_actor: ctx.usuario.id }) }; },
  },
  mfa_recuperacion_aprobar: {
    limite: "gestion_usuarios",
    requisito: { aal2: true },
    validar: (b) => { v.soloCampos(b, ["solicitud_id", "verificacion"]); return { solicitud_id: v.uuid(b, "solicitud_id"), verificacion: v.texto(b, "verificacion", 20, 500) }; },
    async ejecutar(ctx, p) {
      // 1) la base valida quién puede y exige la evidencia de la verificación de identidad; devuelve los factores a eliminar
      const r = await rpc(ctx, "fel_op_mfa_recuperacion_aprobar", { p_actor: ctx.usuario.id, p_solicitud: p.solicitud_id, p_verificacion: p.verificacion });
      // 2) se eliminan con la API de administración de Auth; si falla, la solicitud queda "aprobada" y se puede repetir
      let eliminados = 0;
      for (const id of (r.factores ?? []) as string[]) {
        const { error } = await ctx.admin.auth.admin.mfa.deleteFactor({ id, userId: r.user_id });
        if (error) throw new ErrorFel(502, "No se pudo eliminar el factor; la solicitud quedó aprobada, vuelve a intentarlo", "recuperacion_parcial");
        eliminados++;
      }
      // 3) se cierra la solicitud
      await rpc(ctx, "fel_op_mfa_recuperacion_cerrar", { p_actor: ctx.usuario.id, p_solicitud: p.solicitud_id, p_eliminados: eliminados });
      return { solicitud_id: p.solicitud_id, factores_eliminados: eliminados, siguiente_paso: "La persona inicia sesión con su contraseña y activa un dispositivo nuevo" };
    },
  },
  mfa_recuperacion_rechazar: {
    limite: "gestion_usuarios",
    requisito: { aal2: true },
    validar: (b) => { v.soloCampos(b, ["solicitud_id", "motivo"]); return { solicitud_id: v.uuid(b, "solicitud_id"), motivo: v.texto(b, "motivo", 5, 300) }; },
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_op_mfa_recuperacion_rechazar", { p_actor: ctx.usuario.id, p_solicitud: p.solicitud_id, p_motivo: p.motivo });
      return { solicitud_id: p.solicitud_id, estado: "rechazada" };
    },
  },

  // ------------------------------------------------------------ clientes y conceptos
  cliente_guardar: {
    limite: "escritura",
    requisito: { permiso: "clientes.escribir" },
    validar: (b) => {
      v.soloCampos(b, ["empresa_id", "id", "tipo_identificacion", "numero_identificacion", "nombre", "direccion", "email", "telefono", "version"]);
      const id = v.uuidOpt(b, "id");
      return {
        empresa_id: v.uuid(b, "empresa_id"), id, tipo_identificacion: v.tipoIdentificacion(b, "tipo_identificacion"), numero_identificacion: v.numeroIdentificacion(b, "numero_identificacion"), nombre: v.texto(b, "nombre", 1, 200),
        direccion: v.textoOpt(b, "direccion", 300), email: v.emailOpt(b, "email"), telefono: v.textoOpt(b, "telefono", 30),
        version: id ? v.entero(b, "version") : null,
      };
    },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      const c = await rpc(ctx, "fel_op_cliente_guardar", {
        p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_id: p.id, p_tipo_identificacion: p.tipo_identificacion, p_numero_identificacion: p.numero_identificacion, p_nombre: p.nombre,
        p_direccion: p.direccion, p_email: p.email, p_telefono: p.telefono, p_version: p.version });
      return { cliente: c };
    },
  },

  cliente_estado: {
    limite: "escritura",
    requisito: { permiso: "clientes.escribir" },
    validar: (b) => { v.soloCampos(b, ["empresa_id", "id", "activo"]); return { empresa_id: v.uuid(b, "empresa_id"), id: v.uuid(b, "id"), activo: v.booleano(b, "activo") }; },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_op_cliente_estado", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_id: p.id, p_activo: p.activo });
      return { id: p.id, activo: p.activo };
    },
  },

  concepto_guardar: {
    limite: "escritura",
    requisito: { permiso: "conceptos.escribir" },
    validar: (b) => {
      v.soloCampos(b, ["empresa_id", "id", "codigo", "descripcion", "tipo", "unidad_medida", "precio_unitario", "categoria_fiscal", "version"]);
      const id = v.uuidOpt(b, "id");
      return {
        empresa_id: v.uuid(b, "empresa_id"), id, codigo: v.texto(b, "codigo", 1, 40), descripcion: v.texto(b, "descripcion", 1, 300),
        tipo: v.enumerado(b, "tipo", ["bien", "servicio"] as const), unidad_medida: v.textoOpt(b, "unidad_medida", 20),
        precio_unitario: v.montoNoNegativo(b, "precio_unitario"), categoria_fiscal: v.textoOpt(b, "categoria_fiscal", 60),
        version: id ? v.entero(b, "version") : null,
      };
    },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      const c = await rpc(ctx, "fel_op_concepto_guardar", {
        p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_id: p.id, p_codigo: p.codigo, p_descripcion: p.descripcion, p_tipo: p.tipo,
        p_unidad_medida: p.unidad_medida, p_precio_unitario: p.precio_unitario, p_categoria_fiscal: p.categoria_fiscal, p_version: p.version });
      return { concepto: c };
    },
  },

  concepto_estado: {
    limite: "escritura",
    requisito: { permiso: "conceptos.escribir" },
    validar: (b) => { v.soloCampos(b, ["empresa_id", "id", "activo"]); return { empresa_id: v.uuid(b, "empresa_id"), id: v.uuid(b, "id"), activo: v.booleano(b, "activo") }; },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_op_concepto_estado", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_id: p.id, p_activo: p.activo });
      return { id: p.id, activo: p.activo };
    },
  },
  // ------------------------------------------------------------ borradores (NO certifican nada)
  // La API solo gatea con "borradores.ver"; el permiso exacto (crear/editar/revisar/archivar) lo exige la base de datos.
  documento_guardar: {
    limite: "escritura",
    requisito: { permiso: "borradores.ver" },
    validar: (b) => {
      v.soloCampos(b, ["empresa_id", "id", "cliente_id", "fecha_emision_prevista", "observaciones", "lineas", "version"]);
      const id = v.uuidOpt(b, "id");
      const crudas = b.lineas;
      if (!Array.isArray(crudas) || crudas.length > 200) throw new ErrorFel(400, "lineas: debe ser una lista de hasta 200", "entrada_invalida");
      const lineas = crudas.map((l: unknown, i: number) => {
        if (typeof l !== "object" || l === null || Array.isArray(l)) throw new ErrorFel(400, `lineas[${i}]: debe ser un objeto`, "entrada_invalida");
        const o = l as Record<string, unknown>;
        v.soloCampos(o, ["concepto_id", "descripcion", "cantidad", "precio_unitario", "descuento_tipo", "descuento_valor"]);
        const tipo = o.descuento_tipo === undefined ? "ninguno" : v.enumerado(o, "descuento_tipo", ["ninguno", "monto", "porcentaje"] as const);
        return {
          concepto_id: v.uuidOpt(o, "concepto_id"), descripcion: v.texto(o, "descripcion", 1, 300),
          cantidad: v.montoNoNegativo(o, "cantidad"), precio_unitario: v.montoNoNegativo(o, "precio_unitario"),
          descuento_tipo: tipo, descuento_valor: o.descuento_valor === undefined ? "0" : v.montoNoNegativo(o, "descuento_valor"),
        };
      });
      return {
        empresa_id: v.uuid(b, "empresa_id"), id, cliente_id: v.uuidOpt(b, "cliente_id"),
        fecha: v.fechaOpt(b, "fecha_emision_prevista"), observaciones: v.textoOpt(b, "observaciones", 500), lineas,
        version: id ? v.entero(b, "version") : null,
      };
    },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      const c = calcular(p.lineas as LineaEntrada[]);
      const lineas = (p.lineas as Array<Record<string, unknown>>).map((l, i) => ({
        orden: i + 1, ...l, importes: c.lineas[i],
      }));
      const doc = await rpc(ctx, "fel_op_documento_guardar", {
        p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_id: p.id, p_cliente: p.cliente_id, p_fecha: p.fecha,
        p_observaciones: p.observaciones, p_lineas: lineas, p_subtotal: c.subtotal, p_descuento_total: c.descuento_total,
        p_base: c.base_imponible, p_calculo: c.meta, p_version: p.version });
      return { documento: doc, vista_previa: { oficial: false, lineas: c.lineas, subtotal: c.subtotal, descuento_total: c.descuento_total,
        base_imponible: c.base_imponible, impuestos: null, total: null, nota: c.meta.nota } };
    },
  },

  documento_preparacion: {
    limite: "escritura",
    requisito: { permiso: "borradores.ver" },
    validar: (b) => {
      v.soloCampos(b, ["empresa_id", "id", "estado", "motivo", "version"]);
      return { empresa_id: v.uuid(b, "empresa_id"), id: v.uuid(b, "id"),
        estado: v.enumerado(b, "estado", ["borrador", "revisado", "archivado"] as const),
        motivo: v.textoOpt(b, "motivo", 300), version: v.entero(b, "version") };
    },
    empresaDe: (p) => p.empresa_id,
    async ejecutar(ctx, p) {
      await rpc(ctx, "fel_op_documento_preparacion", { p_actor: ctx.usuario.id, p_empresa: p.empresa_id, p_id: p.id,
        p_nuevo: p.estado, p_motivo: p.motivo, p_version: p.version });
      return { id: p.id, estado_preparacion: p.estado };
    },
  },
};
