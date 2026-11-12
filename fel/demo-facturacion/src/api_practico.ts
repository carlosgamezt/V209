// Funciones de la versión PRÁCTICA de la demostración: inicio de sesión, Digifact SIMULADO (certificar con cobertura, consultar, anular),
// plan / saldo / consumo de la empresa y panel de la PLATAFORMA (empresas, planes, contratos, pagos simulados y bolsón global).
// Todo usa las MISMAS funciones SQL y servicios que las pruebas. Nada sale de este equipo: «SIMULADO - SIN VALOR FISCAL».
import { registroSimulado } from "../../proveedores/src/registro.ts";
import { ErrorBd } from "../../proveedores/src/rpc.ts";
import type { MockProvider } from "../../proveedores/src/mock.ts";
import type { BdDemo } from "./bd.ts";
import { EXTRA, esMaestro } from "./mundo_practico.ts";
import { Sesiones } from "./sesiones.ts";
import { pdfDemo } from "./pdf_demo.ts";
import { verificar as verificarTotp } from "./totp.ts";

export class ErrorPr extends Error { constructor(public status: number, mensaje: string, public codigo = "error") { super(mensaje); } }
type Obj = Record<string, unknown>;
const uuidOk = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const RE_MONTO = /^\d{1,12}(\.\d{1,6})?$/;
const texto = (x: unknown, min: number, max: number, campo: string): string => { if (typeof x !== "string" || x.trim().length < min || x.length > max) throw new ErrorPr(400, `${campo}: texto de ${min} a ${max} caracteres`, "entrada_invalida"); return x.trim(); };
const monto = (x: unknown, campo: string): string => { if (typeof x !== "string" || !RE_MONTO.test(x)) throw new ErrorPr(400, `${campo}: número con hasta 6 decimales`, "entrada_invalida"); return x; };

interface Deps { mock: MockProvider; emp: () => string; sesiones?: Sesiones; mfa?: Map<string, string> }
interface CtxEmpresa { req: Request; url: URL; a: { clave: string; id: string }; ruta: string; m: string; cuerpo: () => Promise<Obj>; id: (x: string) => string;
  json: (x: unknown, s?: number) => Response; canalDe: (p: string) => Promise<string>; detalle: (id: string) => Promise<unknown>; permisos: () => Promise<string[]> }

export function crearPractico(bd: BdDemo, d: Deps) {
  const registro = registroSimulado(bd.rpc), ids = registro.ids();   // certificadores simulados registrados: las pantallas y esta API solo conocen su descriptor
  const CTX = { ambiente: "simulado" as const, ahora: () => new Date() };
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  const leer = async (req: Request): Promise<Obj> => {
    if (req.headers.get("x-demo") !== "1") throw new ErrorPr(403, "Falta la cabecera de la demostración", "no_autorizado");
    const t = await req.text(); if (t.length > 262144) throw new ErrorPr(413, "Cuerpo demasiado grande", "entrada_invalida");
    try { const j = t ? JSON.parse(t) : {}; if (j === null || typeof j !== "object" || Array.isArray(j)) throw 0; return j as Obj; } catch { throw new ErrorPr(400, "Cuerpo no válido", "entrada_invalida"); }
  };
  const seguro = (req: Request) => !!d.sesiones?.forzarSeguro || new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

  /** Aplica a consumos y cargos el resultado confirmado de las operaciones de los certificadores (p. ej. tras conciliar). Seguro de repetir. */
  async function sincronizar() {
    const pend = await bd.filas<{ id: string; empresa_id: string }>("select o.id, o.empresa_id from public.operaciones_fiscales o join public.consumos c on c.operacion_id = o.id and c.empresa_id = o.empresa_id where c.estado = 'reservado' and o.estado in ('confirmada_exitosa','confirmada_fallida') and o.proveedor = any($1::text[])", [ids]);
    for (const p of pend) { const prov = (await bd.filas<{ proveedor: string }>("select proveedor from public.operaciones_fiscales where id = $1", [p.id]))[0]?.proveedor; await registro.obtener(prov)?.servicio.cerrarCobertura(p.empresa_id, p.id); }
  }

  async function certOp(docId: string, empresa: string) {
    const [o] = await bd.filas<{ clave_idempotencia: string; proveedor: string }>("select clave_idempotencia, proveedor from public.operaciones_fiscales where documento_id = $1 and empresa_id = $2 and tipo = 'certificacion' and estado = 'confirmada_exitosa' and proveedor = any($3::text[]) and ambiente = 'simulado' order by iniciada_en desc limit 1", [docId, empresa, ids]);
    const [doc] = await bd.filas<{ autorizacion_sat: string | null }>("select autorizacion_sat from public.documentos where id = $1 and empresa_id = $2", [docId, empresa]);
    return o && doc?.autorizacion_sat && registro.obtener(o.proveedor)?.soportaAnulacion ? { clave: o.clave_idempotencia, autorizacion: doc.autorizacion_sat, proveedor: o.proveedor } : null;
  }

  const nom = (id: unknown) => registro.obtener(String(id))?.nombre ?? String(id ?? "—");   // nombre del certificador: las pantallas no los conocen por id
  async function planDe(empresa: string) {
    const [cuenta] = await bd.filas<Obj>("select id, estado, cupo_mensual_unidades::text as cupo from public.cuentas_comerciales where empresa_id = $1", [empresa]);
    const contratos = await bd.filas<Obj>(`select ct.id, ct.desde, ct.hasta, pv.id as version_id, pv.version, pl.codigo, pl.nombre, pl.modalidad, pv.cuota_fija::text as cuota_fija, pv.unidades_incluidas::text as unidades_incluidas, pv.permite_sobregiro, pv.limite_sobregiro::text as limite_sobregiro
      from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = $1 order by ct.desde desc`, [empresa]);
    const vigente = contratos.find((c) => !c.hasta) ?? contratos[0] ?? null;
    const tarifas = vigente ? await bd.filas<Obj>("select evento_tipo, precio_unitario::text as precio_unitario, cargable from public.tarifas where plan_version_id = $1 order by evento_tipo", [vigente.version_id]) : [];
    const [mon] = await bd.filas<Obj>("select recargado::text, consumido::text, reservado::text, reembolsado::text, ajustado::text, sobregiro::text, (recargado + ajustado - consumido - reservado - reembolsado + sobregiro)::text as disponible from public.monedero_saldos where empresa_id = $1", [empresa]);
    const pagos = await bd.filas<Obj>("select id, monto::text as monto, referencia_pago, estado, confirmado_en from public.pagos where empresa_id = $1 order by confirmado_en desc limit 30", [empresa]);
    const consumos = await bd.filas<Obj>(`select c.id, c.evento_tipo, c.estado, c.unidades_reservadas::text as unidades_reservadas, c.unidades_consumidas::text as unidades_consumidas, c.reservado_en, c.resuelto_en, c.documento_id, b.proveedor_id as certificador,
        d.numero_borrador, (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.consumo_id = c.id) as cargado
      from public.consumos c join public.bolson_cuentas b on b.id = c.cuenta_id left join public.documentos d on d.id = c.documento_id and d.empresa_id = c.empresa_id where c.empresa_id = $1 order by c.reservado_en desc limit 50`, [empresa]);
    const porCertificador = await bd.filas<Obj>(`select b.proveedor_id as certificador, count(*) filter (where c.estado = 'confirmado')::int as confirmados, count(*) filter (where c.estado = 'reservado')::int as retenidos, count(*) filter (where c.estado = 'liberado')::int as liberados,
        coalesce(sum(c.unidades_consumidas) filter (where c.estado = 'confirmado'), 0)::text as unidades, coalesce(sum(g.monto), 0)::text as cargado
      from public.consumos c join public.bolson_cuentas b on b.id = c.cuenta_id left join (select consumo_id, sum(monto) as monto from public.cargos where naturaleza = 'cargo' group by consumo_id) g on g.consumo_id = c.id
      where c.empresa_id = $1 group by b.proveedor_id order by b.proveedor_id`, [empresa]);
    const cargos = await bd.filas<Obj>("select id, concepto, naturaleza, cantidad::text as cantidad, precio_unitario::text as precio_unitario, monto::text as monto, periodo, estado, creado_en from public.cargos where empresa_id = $1 order by creado_en desc limit 50", [empresa]);
    const cobros = await bd.filas<Obj>("select id, tipo, periodo, monto_neto::text as monto_neto, referencia_documento, monto_total_documento::text as monto_total_documento, estado from public.cobros where empresa_id = $1 order by periodo desc", [empresa]);
    const [res] = await bd.filas<Obj>("select count(*) filter (where estado = 'confirmado' and evento_tipo = 'certificacion')::int as certificaciones, count(*) filter (where estado = 'reservado')::int as reservadas, coalesce(sum(unidades_consumidas) filter (where estado = 'confirmado'), 0)::text as unidades from public.consumos where empresa_id = $1", [empresa]);
    return { cuenta: cuenta ?? null, contrato: vigente, contratos, tarifas, monedero: mon ?? null, pagos, consumos: consumos.map((x) => ({ ...x, certificador_nombre: nom(x.certificador) })), porCertificador: porCertificador.map((x) => ({ ...x, certificador_nombre: nom(x.certificador) })), cargos, cobros, resumen: res, aviso: "Pagos y cobros SIMULADOS: no hay pasarela de pago. NEXA no calcula impuestos de sus propias facturas: guarda la referencia del documento emitido fuera de este sistema." };
  }

  return {
    registro, sincronizar,
    async estadoExtra() { return { certificadores: registro.listar().map((x) => ({ id: x.id, nombre: x.nombre, soportaAnulacion: x.soportaAnulacion, escenarios: x.escenarios, escenariosAnulacion: x.escenariosAnulacion })), canales: (await bd.filas<{ proveedor_id: string }>("select proveedor_id from public.empresa_canales where empresa_id = $1 and ambiente = 'simulado' and habilitado", [d.emp()])).map((c) => c.proveedor_id) }; },
    async detalleExtra(docId: string) {
      const cobertura = await bd.filas<Obj>(`select c.id, c.evento_tipo, c.estado, c.unidades_reservadas::text as reservadas, c.unidades_consumidas::text as consumidas, c.operacion_id,
          (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.consumo_id = c.id) as cargado from public.consumos c where c.documento_id = $1 and c.empresa_id = $2 order by c.reservado_en`, [docId, d.emp()]);
      return { cobertura, escenarioCertificador: registro.listar().map((x) => x.simulacion.escenarioDe(docId)).find((e) => e) ?? null, anulable: !!(await certOp(docId, d.emp())) };
    },
    async certificar(a: { id: string }, docId: string, b: Obj, canal: string) {
      const cert = registro.obtener(String(b.proveedor)); if (!cert) throw new ErrorPr(400, "Certificador no válido", "entrada_invalida");
      const esc = typeof b.escenario === "string" ? b.escenario : "exito"; if (!cert.escenarios.some((e) => e.id === esc)) throw new ErrorPr(400, "Escenario no válido", "entrada_invalida");
      const clave = texto(b.clave, 16, 80, "Clave de idempotencia");
      cert.simulacion.fijarEscenario(docId, esc);
      return await cert.servicio.certificar({ actor: a.id, empresa: d.emp(), documento: docId, clave, canal });
    },

    // ---------------------------------------------------------------- sesión (no requiere sesión previa)
    async rutasSesion(req: Request, url: URL): Promise<Response | null> {
      const S = d.sesiones; if (!S || !url.pathname.startsWith("/api/sesion")) return null;
      if (req.method === "GET" && url.pathname === "/api/sesion") {
        const s = await S.validar(Sesiones.idDeCookie(req)), p = s ? await S.persona(s.usuario) : undefined;
        return json(s && p ? { autenticado: true, usuario: s.usuario, nombre: p.nombre } : { autenticado: false, usuarios: (await S.almacen.cuentas()).map((c) => ({ clave: c.usuario, nombre: c.persona.nombre, rol: c.persona.rol, descripcion: c.persona.descripcion })), clave_demo: S.claveDemoPublica });
      }
      if (req.method === "POST" && url.pathname === "/api/sesion/entrar") {
        const b = await leer(req); const usuario = String(b.usuario ?? "").toLowerCase().trim();
        const segundo = d.mfa ? async (u: string) => { const sem = d.mfa!.get(u); if (!sem) return "ok" as const; const c = String(b.codigo ?? "").trim(); return c === "" ? "falta" as const : (await verificarTotp(sem, c)) ? "ok" as const : "mal" as const; } : undefined;
        const r = await S.entrar(usuario, String(b.clave ?? ""), b.recordar === true, segundo);
        if (r.mfa === "falta") return json({ codigo: "mfa_requerido", mensaje: "Escribe el código de 6 dígitos de tu aplicación de autenticación." }, 401);
        if (r.mfa === "mal") return json({ codigo: "mfa_incorrecto", mensaje: "El código no es correcto o venció. Inténtalo con el siguiente." }, 401);
        if (r.bloqueado) return json({ codigo: "bloqueado", mensaje: "Demasiados intentos. Espera un minuto e inténtalo de nuevo." }, 429);
        if (!r.sesion) return json({ codigo: "credenciales", mensaje: "Usuario o contraseña incorrectos." }, 401);
        return new Response(JSON.stringify({ autenticado: true, usuario: r.sesion.usuario, nombre: (await S.persona(r.sesion.usuario))?.nombre }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": Sesiones.cookie(r.sesion, seguro(req)) } });
      }
      if (req.method === "POST" && url.pathname === "/api/sesion/salir") {
        await leer(req); await S.salir(Sesiones.idDeCookie(req));
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": Sesiones.cookie(null, seguro(req)) } });
      }
      throw new ErrorPr(404, "Ruta no encontrada", "no_encontrado");
    },

    // ---------------------------------------------------------------- rutas de una empresa
    async rutasEmpresa(c: CtxEmpresa): Promise<Response | null> {
      const { m, ruta, a } = c; let r: RegExpExecArray | null; const E = d.emp();
      if (m === "POST" && ruta === "/api/cuenta/clave") {   // «Mi cuenta»: cambiar la propia contraseña; cierra todas las sesiones de la persona
        const b = await c.cuerpo(), S = d.sesiones; if (!S) throw new ErrorPr(404, "No disponible en este modo", "no_disponible");
        const nueva = texto(b.nueva, 8, 80, "Contraseña nueva"); if (nueva === String(b.actual)) throw new ErrorPr(400, "La contraseña nueva debe ser distinta de la actual", "entrada_invalida");
        if (!(await S.verificar(a.clave, String(b.actual ?? "")))) throw new ErrorPr(403, "La contraseña actual no es correcta", "no_autorizado");
        await S.cambiarClave(a.clave, nueva); return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": Sesiones.cookie(null, !!d.sesiones?.forzarSeguro || new URL(c.req.url).protocol === "https:" || c.req.headers.get("x-forwarded-proto") === "https") } });
      }
      // ---------------- usuarios, roles y permisos de la empresa (las reglas de jerarquía viven en la base)
      if (m === "GET" && ruta === "/api/usuarios") {
        const permisos = await c.permisos(); if (!permisos.includes("usuarios.ver")) throw new ErrorPr(403, "No tienes permiso para ver los usuarios", "no_autorizado");
        const miembros = await bd.rpc("fel_op_miembros_listar", { p_actor: a.id, p_empresa: E }) as Obj[];
        const invitaciones = await bd.filas<Obj>("select id, email, rol, estado, expira_en from public.invitaciones where empresa_id = $1 and estado = 'pendiente' order by creado_en desc", [E]);
        const roles = await bd.filas<Obj>("select rol, array_agg(permiso order by permiso) as permisos from public.rol_permisos group by rol order by case rol when 'propietario' then 0 when 'administrador' then 1 when 'emisor' then 2 else 3 end");
        const catalogo = await bd.filas<Obj>("select codigo, descripcion from public.permisos_catalogo order by codigo");
        const cuentasU = d.sesiones ? await d.sesiones.almacen.cuentas() : [], claveDe = (uid: unknown) => cuentasU.find((c) => c.persona.id === uid)?.usuario ?? null;
        return c.json({ miembros: miembros.map((x) => ({ ...x, usuario: claveDe(x.user_id) })), invitaciones, roles, catalogo, puedeGestionar: permisos.includes("usuarios.gestionar"), yo: a.id });
      }
      if (m === "POST" && ruta === "/api/usuarios") {   // alta de una persona de la demostración: invitación real (con su chequeo de jerarquía) + cuenta + aceptación
        const b = await c.cuerpo(); const usuario = texto(b.usuario, 3, 20, "Usuario").toLowerCase(), nombre = texto(b.nombre, 3, 80, "Nombre"), clave = texto(b.clave, 8, 80, "Contraseña"), rol = String(b.rol);
        if (!/^[a-z][a-z0-9_]{2,19}$/.test(usuario)) throw new ErrorPr(400, "Usuario: letras minúsculas, números o guion bajo (3 a 20)", "entrada_invalida");
        if (!["administrador", "emisor", "lector"].includes(rol)) throw new ErrorPr(400, "Rol no válido", "entrada_invalida");
        if (!d.sesiones) throw new ErrorPr(404, "No disponible en este modo", "no_disponible"); if (await d.sesiones.persona(usuario)) throw new ErrorPr(409, "Ese usuario ya existe", "conflicto"); const email = `${usuario}@demo.example`;
        await bd.rpc("fel_op_invitacion_registrar", { p_actor: a.id, p_empresa: E, p_email: email, p_rol: rol, p_permisos_extra: [] });   // aquí se valida que quien invita puede dar ese rol
        const uid = crypto.randomUUID(); await bd.ejecutar("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [uid, email]); await bd.ejecutar("insert into public.perfiles (user_id, nombre) values ($1, $2) on conflict (user_id) do update set nombre = excluded.nombre", [uid, nombre]);
        await bd.rpc("fel_op_invitacion_aceptar", { p_user: uid, p_email: email });
        await d.sesiones.registrar(usuario, clave, { id: uid, nombre, rol, descripcion: `${rol} de la empresa`, empresa: E });
        return c.json({ ok: true, usuario });
      }
      if (m === "POST" && (r = /^\/api\/usuarios\/([^/]+)\/actualizar$/.exec(ruta))) {
        const b = await c.cuerpo(); const uid = c.id(r[1]);
        await bd.rpc("fel_op_miembro_actualizar", { p_actor: a.id, p_empresa: E, p_user: uid, p_rol: typeof b.rol === "string" ? b.rol : null, p_permisos_extra: null, p_permisos_revocados: null, p_activo: typeof b.activo === "boolean" ? b.activo : null });
        return c.json({ ok: true });
      }
      // ---------------- panel (indicadores) y reportes
      if (m === "GET" && ruta === "/api/panel") {
        const permisos = await c.permisos(); if (!permisos.includes("borradores.ver")) throw new ErrorPr(403, "No tienes permiso para ver el panel", "no_autorizado");
        const [est] = await bd.filas<Obj>(`select count(*)::int as total, count(*) filter (where estado_preparacion = 'borrador' and estado_fiscal = 'ninguno')::int as borradores, count(*) filter (where estado_preparacion = 'revisado' and estado_fiscal = 'ninguno')::int as revisados,
            count(*) filter (where estado_fiscal = 'certificado')::int as certificados, count(*) filter (where estado_fiscal = 'anulado')::int as anulados, count(*) filter (where estado_fiscal = 'por_verificar')::int as por_verificar,
            count(*) filter (where estado_fiscal = 'rechazado')::int as rechazados, coalesce(sum(base_imponible) filter (where estado_fiscal = 'certificado'), 0)::text as base_certificada from public.documentos where empresa_id = $1`, [E]);
        const serie = await bd.filas<Obj>(`select to_char(g.d, 'YYYY-MM-DD') as dia, coalesce(x.n, 0)::int as certificados from generate_series(current_date - 13, current_date, interval '1 day') as g(d)
            left join (select (resuelta_en at time zone 'America/Guatemala')::date as dia, count(*) as n from public.operaciones_fiscales where empresa_id = $1 and tipo = 'certificacion' and estado = 'confirmada_exitosa' group by 1) x on x.dia = g.d::date order by g.d`, [E]);
        const clientes = await bd.filas<Obj>(`select c.nombre, count(*)::int as documentos, sum(d.base_imponible)::text as base from public.documentos d join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id where d.empresa_id = $1 and d.estado_fiscal = 'certificado' group by c.nombre order by sum(d.base_imponible) desc limit 5`, [E]);
        const pendientes = await bd.filas<Obj>("select id, numero_borrador, estado_fiscal from public.documentos where empresa_id = $1 and (estado_fiscal in ('por_verificar','pendiente_certificacion') or exists (select 1 from public.alertas_fiscales a where a.documento_id = documentos.id and a.resuelta_en is null)) order by actualizado_en desc limit 5", [E]);
        return c.json({ documentos: est, serie, clientes, pendientes, plan: permisos.includes("facturacion.ver") ? await planDe(E) : null, aviso: "Cifras de la SIMULACIÓN: sin valor fiscal." });
      }
      if (m === "GET" && (r = /^\/api\/reportes\/(documentos|consumos)\.csv$/.exec(ruta))) {
        const permisos = await c.permisos(); const celda = (v: unknown) => { let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
        let filas: Obj[], cols: string[];
        if (r[1] === "documentos") {
          if (!permisos.includes("borradores.ver")) throw new ErrorPr(403, "No tienes permiso para este reporte", "no_autorizado");
          cols = ["borrador", "fecha_prevista", "receptor", "identificacion", "estado", "estado_fiscal", "base_imponible", "serie", "numero", "autorizacion_simulada"];
          filas = await bd.filas<Obj>(`select 'BR-' || lpad(d.numero_borrador::text, 4, '0') as borrador, d.fecha_emision_prevista::text as fecha_prevista, cl.nombre as receptor, cl.numero_identificacion as identificacion, d.estado_preparacion as estado, d.estado_fiscal, d.base_imponible::text as base_imponible,
              d.serie, d.numero_fiscal as numero, d.autorizacion_sat as autorizacion_simulada from public.documentos d left join public.clientes cl on cl.id = d.cliente_id and cl.empresa_id = d.empresa_id where d.empresa_id = $1 order by d.numero_borrador`, [E]);
        } else {
          if (!permisos.includes("facturacion.ver")) throw new ErrorPr(403, "No tienes permiso para este reporte", "no_autorizado");
          cols = ["fecha", "certificador", "evento", "documento", "estado", "unidades", "cargado"];
          filas = await bd.filas<Obj>(`select to_char(c.reservado_en at time zone 'America/Guatemala', 'YYYY-MM-DD HH24:MI') as fecha, b.proveedor_id as certificador, c.evento_tipo as evento, 'BR-' || lpad(d.numero_borrador::text, 4, '0') as documento, c.estado, case when c.estado = 'confirmado' then c.unidades_consumidas else c.unidades_reservadas end::text as unidades,
              (select coalesce(sum(g.monto), 0) from public.cargos g where g.consumo_id = c.id)::text as cargado from public.consumos c join public.bolson_cuentas b on b.id = c.cuenta_id left join public.documentos d on d.id = c.documento_id and d.empresa_id = c.empresa_id where c.empresa_id = $1 order by c.reservado_en`, [E]);
        }
        const csv = "\uFEFF" + [cols.join(","), ...filas.map((f) => cols.map((k) => celda(f[k])).join(","))].join("\r\n") + "\r\n# SIMULADO - SIN VALOR FISCAL\r\n";
        return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="SIMULADO-${r[1]}.csv"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      if (m === "GET" && (r = /^\/api\/documentos\/([^/]+)\/pdf-demo$/.exec(ruta))) {
        if (!(await c.permisos()).includes("borradores.ver")) throw new ErrorPr(403, "No tienes permiso para ver documentos", "no_autorizado");
        const det = await c.detalle(c.id(r[1])) as { documento: Obj; lineas: Obj[] }; const [emp] = await bd.filas<Obj>("select razon_social, nit from public.empresas where id = $1", [E]); const dc = det.documento;
        const ESTADO: Record<string, string> = { ninguno: "Sin estado fiscal", pendiente_certificacion: "Pendiente de certificación (simulación)", por_verificar: "Por verificar (simulación)", certificado: "Certificado en SIMULACIÓN", rechazado: "Rechazado (simulación)", anulado: "Anulado (simulación)", anulacion_solicitada: "Anulación solicitada (simulación)" };
        const f = String(dc.fecha_emision_prevista ?? "").slice(0, 10).split("-").reverse().join("/");
        const bytes = pdfDemo({ empresa: String(emp.razon_social), nit: String(emp.nit), receptor: String(dc.cliente_nombre ?? "Sin receptor"), receptorId: `${dc.cliente_tipo ?? ""} ${dc.cliente_numero ?? ""}`.trim(), fecha: f || "—", numeroBorrador: `BR-${String(dc.numero_borrador).padStart(4, "0")}`,
          estado: dc.estado_fiscal === "ninguno" ? (dc.estado_preparacion === "revisado" ? "Revisado" : "Borrador") : ESTADO[String(dc.estado_fiscal)] ?? String(dc.estado_fiscal), serie: dc.serie as string | null, numero: dc.numero_fiscal as string | null, autorizacion: dc.autorizacion_sat as string | null,
          lineas: det.lineas.map((l) => ({ descripcion: String(l.descripcion), cantidad: String(l.cantidad), precio: String(l.precio_unitario), neto: String((l.importes as Obj)?.neto ?? "0") })), subtotal: String(dc.subtotal ?? dc.base_imponible), descuento: String(dc.descuento_total ?? "0"), base: String(dc.base_imponible) });
        return new Response(bytes as unknown as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="NO-FISCAL-DEMO-BR-${dc.numero_borrador}.pdf"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      if (m === "GET" && ruta === "/api/plan") {
        if (!(await c.permisos()).includes("facturacion.ver")) throw new ErrorPr(403, "No tienes permiso para ver el plan y el consumo", "no_autorizado");
        return c.json(await planDe(E));
      }
      if (m === "GET" && (r = /^\/api\/documentos\/([^/]+)\/consultar-proveedor$/.exec(ruta))) {   // solo lectura: pregunta al certificador (simulado) y NO cambia nada
        const docId = c.id(r[1]); const [o] = await bd.filas<{ id: string; clave_idempotencia: string; estado: string; proveedor: string }>("select id, clave_idempotencia, estado, proveedor from public.operaciones_fiscales where documento_id = $1 and empresa_id = $2 and tipo = 'certificacion' and proveedor = any($3::text[]) order by iniciada_en desc limit 1", [docId, E, ids]);
        if (!o) throw new ErrorPr(404, "Este documento no se envió a un certificador simulado", "no_encontrado");
        const x = await registro.obtener(o.proveedor)!.proveedor.conciliar({ empresaId: E, documentoId: docId, operacionId: o.id, claveIdempotencia: o.clave_idempotencia, ambiente: "simulado" }, CTX);
        return c.json({ operacion_estado: o.estado, respuesta_del_proveedor: x.tipo === "certificado" ? { tipo: x.tipo, serie: x.serie, numero: x.numero, autorizacion: x.autorizacion } : x, nota: "Consulta de solo lectura al proveedor simulado; no modifica el documento." });
      }
      if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/anular$/.exec(ruta))) {
        const b = await c.cuerpo(), docId = c.id(r[1]); const cert = await certOp(docId, E);
        if (!cert) throw new ErrorPr(422, "Solo se anula un documento certificado con un certificador simulado que soporte la anulación", "regla");
        const cd = registro.obtener(cert.proveedor)!; const esc = typeof b.escenario === "string" ? b.escenario : "exito"; if (!cd.escenariosAnulacion.some((e) => e.id === esc)) throw new ErrorPr(400, "Escenario de anulación no válido", "entrada_invalida");
        cd.simulacion.fijarEscenarioAnulacion(docId, esc);
        await cd.servicio.anular({ actor: a.id, empresa: E, documento: docId, clave: texto(b.clave, 16, 80, "Clave de idempotencia"), motivo: texto(b.motivo, 5, 300, "Motivo"), canal: await c.canalDe(cert.proveedor), certificacion: { clave: cert.clave, autorizacion: cert.autorizacion } });
        return c.json(await c.detalle(docId));
      }
      if (m === "POST" && (r = /^\/api\/operaciones\/([^/]+)\/conciliar-anulacion$/.exec(ruta))) {
        if (!(await c.permisos()).includes("fiscal.conciliar")) throw new ErrorPr(403, "No tienes permiso para conciliar", "no_autorizado");
        const opId = c.id(r[1]); const [o] = await bd.filas<{ documento_id: string; clave_idempotencia: string; motivo: string | null }>("select documento_id, clave_idempotencia, motivo from public.operaciones_fiscales where id = $1 and empresa_id = $2 and tipo = 'anulacion'", [opId, E]);
        if (!o) throw new ErrorPr(404, "Anulación no encontrada", "no_encontrado"); const cert = await certOp(o.documento_id, E);
        if (!cert) throw new ErrorPr(422, "No se encontró la certificación de este documento", "regla");
        await registro.obtener(cert.proveedor)!.servicio.conciliarAnulacion({ empresa: E, operacion: opId, documento: o.documento_id, clave: o.clave_idempotencia, certificacion: { clave: cert.clave, autorizacion: cert.autorizacion }, motivo: o.motivo ?? "conciliación" });
        return c.json(await c.detalle(o.documento_id));
      }
      return null;
    },

    // ---------------------------------------------------------------- administrador de la plataforma
    async rutasMaestro(req: Request, url: URL, a: { clave: string; id: string }): Promise<Response> {
      const ruta = url.pathname, m = req.method; let r: RegExpExecArray | null; const M = a.id;
      if (m === "GET" && ruta === "/api/estado") return json({ usuario: { clave: a.clave, ...(await d.sesiones?.persona(a.clave)) }, esMaestro: true, login: true, practico: true, permisos: [], aviso: "SIMULADO - SIN VALOR FISCAL" });
      if (m === "GET" && ruta === "/api/plataforma/resumen") {
        const empresas = await bd.filas<Obj>(`select e.id, e.nombre_comercial, e.razon_social, e.nit, e.estado,
            (select pl.nombre from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = e.id and ct.hasta is null limit 1) as plan,
            (select pl.modalidad from public.contratos_plan ct join public.plan_versiones pv on pv.id = ct.plan_version_id join public.planes pl on pl.codigo = pv.plan_codigo where ct.empresa_id = e.id and ct.hasta is null limit 1) as modalidad,
            (select (s.recargado + s.ajustado - s.consumido - s.reservado - s.reembolsado + s.sobregiro)::text from public.monedero_saldos s where s.empresa_id = e.id) as disponible,
            (select count(*)::int from public.consumos c where c.empresa_id = e.id and c.estado = 'confirmado' and c.evento_tipo = 'certificacion') as certificaciones,
            (select coalesce(sum(c.unidades_consumidas), 0)::text from public.consumos c where c.empresa_id = e.id and c.estado = 'confirmado') as unidades,
            (select coalesce(sum(g.monto), 0)::text from public.cargos g where g.empresa_id = e.id and g.estado = 'pendiente') as pendiente
          from public.empresas e order by e.nombre_comercial`);
        return json({ empresas, verificacion: await this.verificacion() });
      }
      if (m === "GET" && ruta === "/api/plataforma/planes") {
        const planes = await bd.filas<Obj>("select codigo, nombre, modalidad, activo from public.planes order by codigo");
        const versiones = await bd.filas<Obj>("select pv.id, pv.plan_codigo, pv.version, pv.vigente_desde, pv.cuota_fija::text as cuota_fija, pv.unidades_incluidas::text as unidades_incluidas, pv.permite_sobregiro, pv.limite_sobregiro::text as limite_sobregiro, (select json_agg(json_build_object('evento', t.evento_tipo, 'precio', t.precio_unitario::text, 'cargable', t.cargable) order by t.evento_tipo) from public.tarifas t where t.plan_version_id = pv.id) as tarifas from public.plan_versiones pv order by pv.plan_codigo, pv.version desc");
        return json({ planes, versiones, eventos: await bd.filas("select codigo from public.evento_tipos order by codigo") });
      }
      if (m === "POST" && ruta === "/api/plataforma/planes") {
        const b = await leer(req); const mod = String(b.modalidad); if (!["prepago", "consumo_mensual", "suscripcion"].includes(mod)) throw new ErrorPr(400, "Modalidad no válida", "entrada_invalida");
        await bd.rpc("fel_admin_plan_crear", { p_actor: M, p_codigo: texto(b.codigo, 3, 40, "Código"), p_nombre: texto(b.nombre, 3, 80, "Nombre"), p_modalidad: mod }); return json({ ok: true });
      }
      if (m === "POST" && (r = /^\/api\/plataforma\/planes\/([a-z][a-z0-9_]{2,39})\/versiones$/.exec(ruta))) {
        const b = await leer(req); const tarifas = Array.isArray(b.tarifas) ? b.tarifas : []; if (tarifas.length < 1) throw new ErrorPr(400, "Indica al menos una tarifa", "entrada_invalida");
        const t = tarifas.map((x) => { const o = x as Obj; return { evento: texto(o.evento, 1, 40, "Evento"), precio: monto(String(o.precio ?? "0"), "Precio"), cargable: o.cargable === true }; });
        const v = await bd.rpc("fel_admin_plan_version_crear", { p_actor: M, p_plan: r[1], p_desde: typeof b.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.desde) ? b.desde : new Date().toISOString().slice(0, 10), p_cuota_fija: monto(String(b.cuota_fija ?? "0"), "Cuota fija"),
          p_unidades_incluidas: monto(String(b.unidades_incluidas ?? "0"), "Unidades incluidas"), p_permite_sobregiro: b.permite_sobregiro === true, p_limite_sobregiro: monto(String(b.limite_sobregiro ?? "0"), "Límite de sobregiro"), p_tarifas: t });
        return json(v);
      }
      if (m === "POST" && ruta === "/api/plataforma/contratos") {
        const b = await leer(req); if (!uuidOk(b.empresa) || !uuidOk(b.plan_version)) throw new ErrorPr(400, "Empresa o versión de plan no válidas", "entrada_invalida");
        await bd.rpc("fel_admin_contrato_asignar", { p_actor: M, p_empresa: b.empresa, p_plan_version: b.plan_version, p_desde: typeof b.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.desde) ? b.desde : new Date().toISOString().slice(0, 10) }); return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/pagos") {
        const b = await leer(req); if (!uuidOk(b.empresa)) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida");
        await bd.rpc("fel_admin_pago_simulado_registrar", { p_actor: M, p_empresa: b.empresa, p_monto: monto(String(b.monto ?? ""), "Monto"), p_referencia: texto(b.referencia, 1, 120, "Referencia"), p_clave: texto(b.clave, 16, 80, "Clave de idempotencia") }); return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/cuentas") {
        const b = await leer(req); if (!uuidOk(b.empresa)) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida"); const est = String(b.estado);
        if (!["activa", "suspendida", "cerrada"].includes(est)) throw new ErrorPr(400, "Estado no válido", "entrada_invalida");
        const cupo = b.cupo === null || b.cupo === "" || b.cupo === undefined ? null : monto(String(b.cupo), "Cupo");
        await bd.rpc("fel_admin_cuenta_comercial_ajustar", { p_actor: M, p_empresa: b.empresa, p_estado: est, p_cupo: cupo, p_motivo: texto(b.motivo, 5, 300, "Motivo") }); return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/cobros/generar") {
        const b = await leer(req); if (!uuidOk(b.empresa)) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida");
        return json(await bd.rpc("fel_admin_cobro_generar", { p_actor: M, p_empresa: b.empresa, p_periodo: typeof b.periodo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.periodo) ? b.periodo : new Date().toISOString().slice(0, 10) }));
      }
      if (m === "POST" && ruta === "/api/plataforma/cobros/emitir") {
        const b = await leer(req); if (!uuidOk(b.cobro)) throw new ErrorPr(400, "Cobro no válido", "entrada_invalida");
        return json(await bd.rpc("fel_admin_cobro_emitir", { p_actor: M, p_cobro: b.cobro, p_referencia: texto(b.referencia, 3, 120, "Referencia del documento"), p_monto_total: monto(String(b.monto_total ?? ""), "Total del documento") }));
      }
      if (m === "GET" && (r = /^\/api\/plataforma\/empresas\/([^/]+)\/plan$/.exec(ruta))) { if (!uuidOk(r[1])) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida"); return json(await planDe(r[1])); }
      if (m === "POST" && (r = /^\/api\/plataforma\/empresas\/([^/]+)\/estado$/.exec(ruta))) {
        const b = await leer(req); if (!uuidOk(r[1])) throw new ErrorPr(400, "Empresa no válida", "entrada_invalida");
        await bd.rpc("fel_admin_empresa_estado", { p_actor: M, p_empresa: r[1], p_estado: String(b.estado), p_motivo: texto(b.motivo, 5, 300, "Motivo") }); return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/empresas") {
        const b = await leer(req); const usuario = texto(b.propietario_usuario, 3, 20, "Usuario del propietario").toLowerCase(); if (!/^[a-z][a-z0-9_]{2,19}$/.test(usuario)) throw new ErrorPr(400, "Usuario: letras minúsculas, números o guion bajo (3 a 20)", "entrada_invalida");
        if (await d.sesiones?.persona(usuario)) throw new ErrorPr(409, "Ese usuario ya existe", "conflicto"); const clave = texto(b.propietario_clave, 8, 80, "Contraseña del propietario");
        const [reg] = await bd.filas<{ id: string }>("select id from public.regimenes_fiscales where codigo = $1", [typeof b.regimen === "string" ? b.regimen : "general"]); if (!reg) throw new ErrorPr(422, "Régimen no encontrado", "regla");
        const empresa = await bd.rpc("fel_admin_empresa_crear", { p_actor: M, p_nombre_comercial: texto(b.nombre_comercial, 1, 120, "Nombre comercial"), p_razon_social: texto(b.razon_social, 1, 200, "Razón social"), p_nit: texto(b.nit, 3, 20, "NIT"), p_regimen_id: reg.id }) as string;
        await bd.rpc("fel_admin_empresa_estado", { p_actor: M, p_empresa: empresa, p_estado: "habilitada", p_motivo: "Alta de la empresa en la demostración" });
        const uid = crypto.randomUUID(), nombre = texto(b.propietario_nombre, 3, 80, "Nombre del propietario");
        await bd.ejecutar("insert into auth.users (id, email) values ($1, $2)", [uid, `${usuario}@demo.example`]); await bd.ejecutar("insert into public.perfiles (user_id) values ($1) on conflict (user_id) do nothing", [uid]);
        await bd.ejecutar("insert into public.miembros (empresa_id, user_id, rol) values ($1, $2, 'propietario')", [empresa, uid]);
        for (const p of ["mock", ...ids]) await bd.filas("select public.fel_op_canal_configurar($1, $2, null, $3, 'simulado', true)", [uid, empresa, p]);
        await d.sesiones?.registrar(usuario, clave, { id: uid, nombre, rol: "propietario", descripcion: `Propietario de ${texto(b.nombre_comercial, 1, 120, "Nombre comercial")}`, empresa });
        return json({ empresa, usuario, aviso: "Empresa habilitada con canal simulado y Digifact simulado. Asígnale un plan y registra un pago simulado para que pueda certificar." });
      }
      if (m === "GET" && ruta === "/api/plataforma/bolson") {
        const cuentas = await bd.filas<Obj>("select (select case when sum(l.unidades) > 0 then (sum(l.costo_total) / sum(l.unidades))::numeric(18,6)::text end from public.bolson_lotes l where l.cuenta_id = c.id) as costo_unitario, c.id, c.proveedor_id, c.ambiente, c.referencia_externa, c.estado, s.comprado::text as comprado, s.consumido::text as consumido, s.reservado::text as reservado, s.ajustado::text as ajustado, (s.comprado + s.ajustado - s.consumido - s.reservado)::text as disponible from public.bolson_cuentas c join public.bolson_saldos s on s.cuenta_id = c.id order by c.creada_en");
        const lotes = await bd.filas<Obj>("select l.id, l.cuenta_id, l.unidades::text as unidades, l.costo_total::text as costo_total, l.referencia_proveedor, l.registrado_en from public.bolson_lotes l order by l.registrado_en desc limit 20");
        const porEmpresa = await bd.filas<Obj>(`with costo as (select b.id as cuenta_id, case when sum(l.unidades) > 0 then sum(l.costo_total) / sum(l.unidades) else 0 end as unitario from public.bolson_cuentas b left join public.bolson_lotes l on l.cuenta_id = b.id group by b.id),
            cargado as (select consumo_id, sum(monto) as monto from public.cargos where naturaleza = 'cargo' group by consumo_id)
          select e.id, e.nombre_comercial, b.proveedor_id as certificador, count(*) filter (where c.estado = 'confirmado')::int as confirmados, count(*) filter (where c.estado = 'reservado')::int as reservados, count(*) filter (where c.estado = 'liberado')::int as liberados,
            coalesce(sum(c.unidades_consumidas) filter (where c.estado = 'confirmado'), 0)::text as unidades, coalesce(sum(g.monto), 0)::text as cargado,
            coalesce(sum(c.unidades_consumidas * k.unitario) filter (where c.estado = 'confirmado'), 0)::numeric(18,6)::text as costo_estimado
          from public.empresas e left join public.consumos c on c.empresa_id = e.id left join public.bolson_cuentas b on b.id = c.cuenta_id left join costo k on k.cuenta_id = c.cuenta_id left join cargado g on g.consumo_id = c.id
          group by e.id, e.nombre_comercial, b.proveedor_id order by e.nombre_comercial, b.proveedor_id`);
        const reglas = await bd.filas<Obj>("select r.cuenta_id, r.evento_tipo, r.consume, r.unidades::text as unidades from public.bolson_reglas_consumo r where r.vigente_hasta is null order by r.evento_tipo");
        const alertas = await bd.filas<Obj>("select a.id, a.tipo, a.detalle, a.creada_en, a.resuelta_en, e.nombre_comercial from public.bolson_alertas a left join public.empresas e on e.id = a.empresa_id order by a.creada_en desc limit 20");
        return json({ cuentas: cuentas.map((x) => ({ ...x, certificador_nombre: nom(x.proveedor_id) })), lotes, porEmpresa: porEmpresa.map((x) => ({ ...x, certificador_nombre: x.certificador ? nom(x.certificador) : null })), reglas, alertas, simuladores: registro.listar().map((x) => ({ id: x.id, nombre: x.nombre, saldo_reportado: x.simulacion.saldoReportado(), certificaciones: x.simulacion.certificaciones(), llamadas: x.simulacion.llamadas() })), verificacion: await this.verificacion() });
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/lotes") {
        const b = await leer(req); if (!uuidOk(b.cuenta)) throw new ErrorPr(400, "Cuenta no válida", "entrada_invalida");
        await bd.rpc("fel_admin_bolson_lote_registrar", { p_actor: M, p_cuenta: b.cuenta, p_unidades: monto(String(b.unidades ?? ""), "Unidades"), p_costo_total: monto(String(b.costo_total ?? "0"), "Costo total"), p_referencia: texto(b.referencia, 1, 120, "Referencia del proveedor") });
        const prov = (await bd.filas<{ proveedor_id: string }>("select proveedor_id from public.bolson_cuentas where id = $1", [b.cuenta]))[0]?.proveedor_id; registro.obtener(prov)?.simulacion.sumarSaldo(Number(b.unidades)); return json({ ok: true });
      }
      if (m === "POST" && (r = /^\/api\/plataforma\/bolson\/alertas\/([^/]+)\/resolver$/.exec(ruta))) {
        const b = await leer(req); if (!uuidOk(r[1])) throw new ErrorPr(400, "Alerta no válida", "entrada_invalida");
        await bd.rpc("fel_admin_bolson_alerta_resolver", { p_actor: M, p_alerta: r[1], p_nota: texto(b.nota, 3, 300, "Nota") }); return json({ ok: true });
      }
      if (m === "GET" && ruta === "/api/plataforma/bolson/conciliaciones") {
        const extractos = await bd.filas<Obj>("select x.id, x.periodo_desde, x.periodo_hasta, x.saldo_final::text as saldo_final, x.importado_en, (select count(*)::int from public.bolson_extracto_lineas l where l.extracto_id = x.id) as lineas, c.id as conciliacion_id from public.bolson_extractos x left join public.bolson_conciliaciones c on c.extracto_id = x.id order by x.importado_en desc limit 20");
        const conciliaciones = await bd.filas<Obj>("select id, extracto_id, estado, propuesta_por, propuesta_en, decidida_por, decidida_en, nota, resumen from public.bolson_conciliaciones order by propuesta_en desc limit 20");
        const partidas = await bd.filas<Obj>(`select p.id, p.conciliacion_id, p.clasificacion, p.referencia, p.unidades_extracto::text as unidades_extracto, p.unidades_nexa::text as unidades_nexa, p.diferencia::text as diferencia, e.nombre_comercial,
            r.accion, r.motivo as resolucion_motivo, r.unidades::text as resolucion_unidades, re.nombre_comercial as resolucion_empresa
          from public.bolson_conciliacion_partidas p left join public.empresas e on e.id = p.empresa_id left join public.bolson_partida_resoluciones r on r.partida_id = p.id left join public.empresas re on re.id = r.empresa_id
          order by p.clasificacion = 'coincide', p.referencia`);
        return json({ extractos, conciliaciones, partidas, yo: M, nombres: Object.fromEntries((d.sesiones ? await d.sesiones.almacen.cuentas() : []).map((c) => [c.persona.id, c.persona.nombre])), empresas: await bd.filas("select id, nombre_comercial from public.empresas order by nombre_comercial") });
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/extractos/importar") {
        const b = await leer(req); const cuenta = uuidOk(b.cuenta) ? b.cuenta : null; if (!cuenta) throw new ErrorPr(400, "Cuenta no válida", "entrada_invalida");
        const hoy = new Date(), ayer = new Date(hoy.getTime() - 86_400_000), f = (x: Date) => x.toISOString().slice(0, 10);
        const prov = (await bd.filas<{ proveedor_id: string }>("select proveedor_id from public.bolson_cuentas where id = $1", [cuenta]))[0]?.proveedor_id, cert = registro.obtener(prov); if (!cert) throw new ErrorPr(404, "Cuenta de un certificador simulado no encontrada", "no_encontrado");
        return json(await cert.servicio.importarExtracto({ actor: M, cuenta, desde: f(ayer), hasta: f(hoy), saldoFinal: cert.simulacion.saldoReportado() }));
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/conciliaciones/proponer") { const b = await leer(req); if (!uuidOk(b.extracto)) throw new ErrorPr(400, "Extracto no válido", "entrada_invalida"); return json(await bd.rpc("fel_admin_bolson_conciliar_proponer", { p_actor: M, p_extracto: b.extracto })); }
      if (m === "POST" && (r = /^\/api\/plataforma\/bolson\/conciliaciones\/([^/]+)\/decidir$/.exec(ruta))) {
        const b = await leer(req); if (!uuidOk(r[1])) throw new ErrorPr(400, "Conciliación no válida", "entrada_invalida");
        return json(await bd.rpc("fel_admin_bolson_conciliar_decidir", { p_actor: M, p_conciliacion: r[1], p_aprobar: b.aprobar === true, p_nota: texto(b.nota, 5, 300, "Nota") }));
      }
      if (m === "POST" && (r = /^\/api\/plataforma\/bolson\/partidas\/([^/]+)\/resolver$/.exec(ruta))) {
        const b = await leer(req); if (!uuidOk(r[1])) throw new ErrorPr(400, "Partida no válida", "entrada_invalida");
        return json(await bd.rpc("fel_admin_bolson_partida_resolver", { p_actor: M, p_partida: r[1], p_accion: String(b.accion), p_empresa: uuidOk(b.empresa) ? b.empresa : null, p_motivo: texto(b.motivo, 10, 300, "Motivo") }));
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/simulador") {   // controles de la DEMOSTRACIÓN: reproducen lo que en la realidad hace el proveedor por su cuenta
        const b = await leer(req);
        const cert = registro.obtener(String(b.proveedor ?? "digifact")); if (!cert) throw new ErrorPr(400, "Certificador no válido", "entrada_invalida");
        if (b.accion === "consumo_ajeno") cert.simulacion.consumoAjeno();
        else if (b.accion === "omitir_ultimo") { if (!cert.simulacion.omitirUltimoConsumo()) throw new ErrorPr(422, "No hay consumos que omitir", "regla"); }
        else throw new ErrorPr(400, "Acción no válida", "entrada_invalida");
        return json({ ok: true });
      }
      if (m === "POST" && ruta === "/api/plataforma/bolson/revisar") { await leer(req); await bd.rpc("fel_sys_bolson_revisar", {}); return json({ verificacion: await this.verificacion() }); }
      throw new ErrorPr(403, "Esta función no está disponible para el administrador de la plataforma", "no_autorizado");
    },
    async verificacion() {
      const s = await bd.filas<{ ok: boolean }>("select ok from public.fel_sys_verificar_saldos()"), w = await bd.filas<{ ok: boolean }>("select ok from public.fel_sys_verificar_monederos()");
      return { comprobaciones: s.length + w.length, fallos: [...s, ...w].filter((x) => !x.ok).length };
    },
  };
}
export { ErrorBd, EXTRA, esMaestro };
